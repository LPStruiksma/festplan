// supabase/functions/ingest-festival-timetable/index.ts
//
// Admin-only edge function that ingests a festival from the Ticketmaster
// Discovery API into Supabase (festival_meta + timetable_slots).
//
// The stored slots have start_time / end_time = NULL so that SchedulePage
// renders in "lineup-only" mode until a full timetable is published.
//
// ── Request shapes ────────────────────────────────────────────────────────────
//
//   Single-day (backward-compatible):
//     POST { eventId: string }
//     → ingests one event; all attractions get day_index = 0
//
//   Multi-day:
//     POST { eventIds: string[], festivalSlug?: string }
//     → fetches all events in parallel; each event's attractions get
//       day_index = (event_date - earliest_event_date) in days
//     → festival_meta.stages = union of all TM venue names
//     → festivalSlug overrides the auto-derived slug when provided
//
// Response: { ok: true, festivalKey, festivalName, startDate, endDate,
//             days, artistCount, eventsIngested? }
//   or      { error: string }  with an appropriate HTTP status

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, jsonResponse } from '../_shared/cors.ts'

// ── CONFIG ───────────────────────────────────────────────────────────────────

const TM_KEY      = Deno.env.get('TICKETMASTER_API_KEY') || ''
const TM_BASE     = 'https://app.ticketmaster.com/discovery/v2'
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

/** Days between two ISO date strings (eventDate - startDate), rounded. */
function daysBetween(eventDate: string, startDate: string): number {
  const evMs    = new Date(eventDate  + 'T12:00:00Z').getTime()
  const startMs = new Date(startDate  + 'T12:00:00Z').getTime()
  return Math.round((evMs - startMs) / (1000 * 60 * 60 * 24))
}

// ── TICKETMASTER ─────────────────────────────────────────────────────────────

interface TmAttraction {
  id:   string
  name: string
}

interface TmEvent {
  id:    string
  name:  string
  dates?: {
    start?: { localDate?: string }
    end?:   { localDate?: string }
  }
  _embedded?: {
    attractions?: TmAttraction[]
    venues?: {
      name?:    string
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

// ── SLOT ROW TYPE ─────────────────────────────────────────────────────────────

interface SlotRow {
  festival_key: string
  artist:       string
  stage:        null
  day_index:    number
  start_time:   null
  end_time:     null
}

// ── SHARED DB WRITE ───────────────────────────────────────────────────────────

/** Upsert festival_meta + timetable_slots and return a summary response. */
async function persistFestival(opts: {
  festivalKey:  string
  festivalName: string
  location:     string
  days:         string[]
  stages:       string[]
  startDate:    string
  endDate:      string
  slots:        SlotRow[]
  eventsIngested?: number
}) {
  const sb = getServiceClient()

  // ── Upsert festival_meta ──
  const { error: metaError } = await sb
    .from('festival_meta')
    .upsert({
      festival_key: opts.festivalKey,
      name:         opts.festivalName,
      location:     opts.location,
      emoji:        '🎵',
      days:         opts.days,
      stages:       opts.stages,
      start_date:   opts.startDate,
      end_date:     opts.endDate,
    }, { onConflict: 'festival_key' })

  if (metaError) {
    console.error('festival_meta upsert error:', metaError)
    return jsonResponse({ error: 'Failed to upsert festival_meta', detail: metaError.message }, 500)
  }

  // ── Deduplicate slots by (artist, day_index) ──
  const seen  = new Set<string>()
  const deduped = opts.slots.filter(s => {
    const key = `${s.artist}::${s.day_index}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  // ── Batch-upsert timetable_slots (50 rows at a time) ──
  const BATCH = 50
  for (let i = 0; i < deduped.length; i += BATCH) {
    const { error: slotError } = await sb
      .from('timetable_slots')
      .upsert(deduped.slice(i, i + BATCH), { onConflict: 'festival_key,artist,day_index' })

    if (slotError) {
      console.error('timetable_slots upsert error:', slotError)
      return jsonResponse({
        error: 'Failed to upsert timetable_slots',
        detail: slotError.message,
      }, 500)
    }
  }

  return jsonResponse({
    ok:             true,
    festivalKey:    opts.festivalKey,
    festivalName:   opts.festivalName,
    startDate:      opts.startDate,
    endDate:        opts.endDate,
    days:           opts.days,
    artistCount:    deduped.length,
    ...(opts.eventsIngested !== undefined
      ? { eventsIngested: opts.eventsIngested }
      : {}),
  })
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

  // ── Parse request body ──
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Request body must be valid JSON' }, 400)
  }

  // ── Dispatch: multi-day vs single-day ────────────────────────────────────

  const rawEventIds = body.eventIds
  const isMultiDay  = Array.isArray(rawEventIds) && rawEventIds.length > 0

  if (isMultiDay) {
    // ════════════════════════════════════════════════════════════════════════
    // MULTI-DAY MODE  { eventIds: string[], festivalSlug?: string }
    // ════════════════════════════════════════════════════════════════════════

    const eventIds: string[] = (rawEventIds as unknown[])
      .map(id => String(id).trim())
      .filter(Boolean)

    if (eventIds.length === 0) {
      return jsonResponse({ error: 'eventIds array contains no valid IDs' }, 400)
    }

    const slugOverride = typeof body.festivalSlug === 'string'
      ? body.festivalSlug.trim()
      : ''

    // ── Fetch all TM events in parallel ──
    const tmEvents = await Promise.all(eventIds.map(fetchTmEvent))

    const failedIds = eventIds.filter((_, i) => !tmEvents[i])
    if (failedIds.length > 0) {
      return jsonResponse(
        { error: `Could not fetch Ticketmaster event(s): ${failedIds.join(', ')}` },
        404
      )
    }

    const validEvents = tmEvents as TmEvent[]
    const firstEvent  = validEvents[0]

    // ── Festival key / name ──
    const festivalName = firstEvent.name
    const festivalKey  = slugOverride || slugify(festivalName)

    // ── Compute date range across all events ──
    const eventDates = validEvents
      .map(e => e.dates?.start?.localDate)
      .filter((d): d is string => Boolean(d))

    if (eventDates.length === 0) {
      return jsonResponse({ error: 'None of the events have a start date' }, 422)
    }

    const startDate = eventDates.reduce((a, b) => (a < b ? a : b))
    const endDate   = eventDates.reduce((a, b) => (a > b ? a : b))
    const days      = dateRange(startDate, endDate).map(formatDate)

    // ── Location from first event's venue ──
    const firstVenue = firstEvent._embedded?.venues?.[0]
    const city       = firstVenue?.city?.name    || ''
    const country    = firstVenue?.country?.name || ''
    const location   = [city, country].filter(Boolean).join(', ')

    // ── Union all venue names into stages[] ──
    const stagesSet = new Set<string>()
    for (const ev of validEvents) {
      for (const v of ev._embedded?.venues || []) {
        if (v.name) stagesSet.add(v.name)
      }
    }
    const stages = [...stagesSet]

    // ── Build slot rows with per-event day_index ──
    const slots: SlotRow[] = []
    for (const ev of validEvents) {
      const evDate   = ev.dates?.start?.localDate ?? startDate
      const dayIndex = daysBetween(evDate, startDate)
      for (const attr of ev._embedded?.attractions || []) {
        slots.push({
          festival_key: festivalKey,
          artist:       attr.name,
          stage:        null,
          day_index:    dayIndex,
          start_time:   null,
          end_time:     null,
        })
      }
    }

    if (slots.length === 0) {
      return jsonResponse({ error: 'No artists found across any of the events' }, 422)
    }

    return persistFestival({
      festivalKey,
      festivalName,
      location,
      days,
      stages,
      startDate,
      endDate,
      slots,
      eventsIngested: validEvents.length,
    })

  } else {
    // ════════════════════════════════════════════════════════════════════════
    // SINGLE-DAY MODE  { eventId: string }  (existing behaviour, unchanged)
    // ════════════════════════════════════════════════════════════════════════

    const eventId = typeof body.eventId === 'string' ? body.eventId.trim() : ''
    if (!eventId) {
      return jsonResponse(
        { error: 'Provide eventId (string) for a single-day ingest, or eventIds (array) for multi-day' },
        400
      )
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
    const days      = startDate ? dateRange(startDate, endDate!).map(formatDate) : []

    const venue    = tmEvent._embedded?.venues?.[0]
    const city     = venue?.city?.name    || ''
    const country  = venue?.country?.name || ''
    const location = [city, country].filter(Boolean).join(', ')

    // Single-day: all attractions on day 0
    const slots: SlotRow[] = attractions.map((attr: TmAttraction) => ({
      festival_key: festivalKey,
      artist:       attr.name,
      stage:        null,
      day_index:    0,
      start_time:   null,
      end_time:     null,
    }))

    return persistFestival({
      festivalKey,
      festivalName,
      location,
      days,
      stages: [],
      startDate:  startDate ?? '',
      endDate:    endDate   ?? '',
      slots,
    })
  }
})
