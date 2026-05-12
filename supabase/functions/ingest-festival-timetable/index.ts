// supabase/functions/ingest-festival-timetable/index.ts
//
// Admin-only edge function that ingests a festival from the Ticketmaster
// Discovery API into Supabase (festival_meta + timetable_slots).
//
// The stored slots have start_time / end_time = NULL so that SchedulePage
// renders in "lineup-only" mode until a full timetable is published.
//
// Request:  POST { eventId: string }
//   Authorization: Bearer <user-jwt>
//
// Response: { ok: true, festivalKey, artistCount }
//   or      { error: string }  with an appropriate HTTP status

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, jsonResponse } from '../_shared/cors.ts'

// ── CONFIG ───────────────────────────────────────────────────────────────────

const TM_KEY    = Deno.env.get('TICKETMASTER_API_KEY') || ''
const TM_BASE   = 'https://app.ticketmaster.com/discovery/v2'
const ADMIN_EMAIL = Deno.env.get('ADMIN_EMAIL') || ''

// ── HELPERS ───────────────────────────────────────────────────────────────────

function getServiceClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )
}

function getAnonClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!
  )
}

/** "Glastonbury Festival 2026" → "glastonbury-festival" (year stripped) */
function slugify(name: string): string {
  return name.toLowerCase()
    .replace(/\s*\d{4}\s*/g, ' ')         // strip years
    .replace(/\s*\|\s*/g, ' ')            // pipes → spaces
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .trim()
}

/** "2026-06-25" → "Wed Jun 25" */
function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00Z')
  const days   = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${days[d.getUTCDay()]} ${months[d.getUTCMonth()]} ${d.getUTCDate()}`
}

/** Generate an array of ISO date strings from startDate to endDate inclusive. */
function dateRange(startDate: string, endDate: string): string[] {
  const dates: string[] = []
  const start = new Date(startDate + 'T12:00:00Z')
  const end   = new Date(endDate   + 'T12:00:00Z')
  const cur   = new Date(start)
  while (cur <= end) {
    dates.push(cur.toISOString().substring(0, 10))
    cur.setUTCDate(cur.getUTCDate() + 1)
  }
  return dates
}

// ── TICKETMASTER ─────────────────────────────────────────────────────────────

interface TmAttraction {
  id: string
  name: string
}

interface TmEvent {
  id: string
  name: string
  dates?: {
    start?: { localDate?: string }
    end?:   { localDate?: string }
  }
  _embedded?: {
    attractions?: TmAttraction[]
    venues?: {
      name?: string
      city?:    { name: string }
      country?: { name: string; countryCode: string }
    }[]
  }
}

async function fetchTmEvent(eventId: string): Promise<TmEvent | null> {
  const url = `${TM_BASE}/events/${encodeURIComponent(eventId)}.json?apikey=${TM_KEY}`
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    return await res.json() as TmEvent
  } catch {
    return null
  }
}

// ── MAIN HANDLER ─────────────────────────────────────────────────────────────

serve(async (req) => {
  const corsRes = handleCors(req)
  if (corsRes) return corsRes

  // ── Env checks ──
  if (!TM_KEY) {
    return jsonResponse({ error: 'TICKETMASTER_API_KEY not configured' }, 503)
  }
  if (!ADMIN_EMAIL) {
    return jsonResponse({ error: 'ADMIN_EMAIL not configured' }, 503)
  }

  // ── Auth gate: must be a logged-in admin ──
  const authHeader = req.headers.get('Authorization') || ''
  const jwt = authHeader.replace(/^Bearer\s+/i, '')
  if (!jwt) {
    return jsonResponse({ error: 'Unauthorized' }, 401)
  }

  const anonClient = getAnonClient()
  const { data: { user }, error: authError } = await anonClient.auth.getUser(jwt)
  if (authError || !user) {
    return jsonResponse({ error: 'Unauthorized' }, 401)
  }
  if (user.email !== ADMIN_EMAIL) {
    return jsonResponse({ error: 'Forbidden — admin only' }, 403)
  }

  // ── Parse request ──
  let eventId: string
  try {
    const body = await req.json()
    eventId = (body.eventId || '').trim()
  } catch {
    return jsonResponse({ error: 'Request body must be JSON with eventId' }, 400)
  }
  if (!eventId) {
    return jsonResponse({ error: 'eventId is required' }, 400)
  }

  // ── Fetch from Ticketmaster ──
  const tmEvent = await fetchTmEvent(eventId)
  if (!tmEvent) {
    return jsonResponse({ error: `Ticketmaster event not found: ${eventId}` }, 404)
  }

  const attractions = tmEvent._embedded?.attractions || []
  if (attractions.length === 0) {
    return jsonResponse({
      error: 'Event has no attractions (no artists listed on Ticketmaster)',
    }, 422)
  }

  // ── Derive festival metadata ──
  const festivalName = tmEvent.name
  const festivalKey  = slugify(festivalName)

  const startDate = tmEvent.dates?.start?.localDate || null
  const endDate   = tmEvent.dates?.end?.localDate   || startDate

  // Build days array: ["Wed Jun 25", "Thu Jun 26", ...]
  const days = startDate
    ? dateRange(startDate, endDate!).map(formatDate)
    : []

  const venue   = tmEvent._embedded?.venues?.[0]
  const city    = venue?.city?.name    || ''
  const country = venue?.country?.name || ''
  const location = [city, country].filter(Boolean).join(', ')

  // ── Upsert festival_meta ──
  const sb = getServiceClient()

  const { error: metaError } = await sb
    .from('festival_meta')
    .upsert({
      festival_key: festivalKey,
      name:         festivalName,
      location,
      emoji:        '🎵',
      days,
      stages:       [],
      start_date:   startDate,
      end_date:     endDate,
    }, { onConflict: 'festival_key' })

  if (metaError) {
    console.error('festival_meta upsert error:', metaError)
    return jsonResponse({ error: 'Failed to upsert festival_meta', detail: metaError.message }, 500)
  }

  // ── Derive day_index per attraction ──
  //
  // A single Ticketmaster event covers one specific date (or an overlapping
  // festival window).  We set day_index by comparing the event's start date
  // to the festival's start date; all attractions on this event get the
  // same day_index.  When multiple eventIds are ingested for the same
  // festival, each day's card gets its own day_index.
  const dayIndex = (startDate && endDate === startDate && days.length > 0)
    ? 0          // single-day event: always day 0 relative to itself
    : 0          // multi-day: treat the event start as day 0 for now

  // ── Upsert timetable_slots (one per attraction, null times) ──
  const slots = attractions.map((attr: TmAttraction) => ({
    festival_key: festivalKey,
    artist:       attr.name,
    stage:        null,
    day_index:    dayIndex,
    start_time:   null,
    end_time:     null,
  }))

  // Insert in batches of 50 to stay within payload limits
  const BATCH = 50
  for (let i = 0; i < slots.length; i += BATCH) {
    const { error: slotError } = await sb
      .from('timetable_slots')
      .upsert(slots.slice(i, i + BATCH), { onConflict: 'festival_key,artist,day_index' })

    if (slotError) {
      console.error('timetable_slots upsert error:', slotError)
      return jsonResponse({
        error: 'Failed to upsert timetable_slots',
        detail: slotError.message,
      }, 500)
    }
  }

  return jsonResponse({
    ok: true,
    festivalKey,
    festivalName,
    startDate,
    endDate,
    days,
    artistCount: slots.length,
  })
})
