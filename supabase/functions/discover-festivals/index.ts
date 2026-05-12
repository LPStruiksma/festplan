// supabase/functions/discover-festivals/index.ts
//
// Takes a list of artist names (from Spotify), queries the Ticketmaster
// Discovery API for their upcoming events, groups results into festivals,
// and returns matches ranked by how many of the user's artists are playing.
//
// Ticketmaster Discovery API — free tier:
//   5,000 requests/day, 5 requests/second
//   Register at https://developer.ticketmaster.com/
//   Covers: US, CA, MX, GB, IE, AU, NZ, NL, DE, BE, AT, DK, ES, FI,
//           NO, PL, SE, CH, CZ, IT, FR, ZA, TR, BR, CL, PE
//
// Request:  POST { artists: string[] }
//           POST { festivalKey: string }
// Response: { festivals: Festival[] }
//           { festival, timetable, hasTimetable }

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, jsonResponse } from '../_shared/cors.ts'

// ── CONFIG ───────────────────────────────────────────────────────────────────

const TM_KEY     = Deno.env.get('TICKETMASTER_API_KEY') || ''
const TM_BASE    = 'https://app.ticketmaster.com/discovery/v2'
const CACHE_TTL  = 24 * 60 * 60 * 1000  // 24h
const BATCH_SIZE = 4                      // stay well under 5 req/s
const BATCH_DELAY = 250                   // ms between requests within a batch
const MIN_LINEUP = 3                      // min attractions to consider "festival"

// ── TYPES ────────────────────────────────────────────────────────────────────

interface TmEvent {
  id: string
  name: string
  url?: string
  dates?: {
    start?: { localDate?: string; localTime?: string }
    end?: { localDate?: string }
  }
  _embedded?: {
    attractions?: { name: string; id: string }[]
    venues?: {
      name: string
      city?: { name: string }
      state?: { stateCode?: string }
      country?: { name: string; countryCode: string }
      location?: { latitude: string; longitude: string }
    }[]
  }
  classifications?: {
    segment?: { name: string }
    genre?: { name: string }
    subGenre?: { name: string }
  }[]
}

interface FestivalGroup {
  key: string
  name: string
  location: string
  country: string
  lat: number
  lng: number
  dates: Set<string>
  allArtists: Set<string>           // lowercase keys for dedup
  allArtistsDisplay: Map<string, string>  // lowercase → display name
  matchedArtists: Map<string, string>     // lowercase → display name
  tmUrl?: string
  tmEventIds: Set<string>           // one TM event ID per festival day (for ingest)
}

// ── TICKETMASTER QUERIES ─────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function searchArtistEvents(artist: string): Promise<TmEvent[]> {
  const params = new URLSearchParams({
    apikey: TM_KEY,
    keyword: artist,
    classificationName: 'music',
    size: '50',
    sort: 'date,asc',
  })

  try {
    const res = await fetch(`${TM_BASE}/events.json?${params}`)
    if (res.status === 429) {
      // Rate limited — wait and retry once
      await sleep(1100)
      const retry = await fetch(`${TM_BASE}/events.json?${params}`)
      if (!retry.ok) return []
      const data = await retry.json()
      return data?._embedded?.events || []
    }
    if (!res.ok) return []
    const data = await res.json()
    return data?._embedded?.events || []
  } catch {
    return []
  }
}

// Tag events with which queried artist triggered them
interface TaggedEvent extends TmEvent {
  _queriedArtist: string
}

async function fetchAllArtistEvents(
  artists: string[],
  cache: Map<string, TmEvent[]>
): Promise<TaggedEvent[]> {
  const allEvents: TaggedEvent[] = []
  const uncached = artists.filter(a => !cache.has(a.toLowerCase()))

  // Add cached results
  for (const a of artists) {
    const cached = cache.get(a.toLowerCase())
    if (cached) {
      allEvents.push(...cached.map(e => ({ ...e, _queriedArtist: a })))
    }
  }

  // Fetch uncached in rate-limited batches
  for (let i = 0; i < uncached.length; i += BATCH_SIZE) {
    const batch = uncached.slice(i, i + BATCH_SIZE)
    const results: TmEvent[][] = []

    for (const artist of batch) {
      results.push(await searchArtistEvents(artist))
      if (batch.indexOf(artist) < batch.length - 1) await sleep(BATCH_DELAY)
    }

    for (let j = 0; j < batch.length; j++) {
      const events = results[j]
      allEvents.push(...events.map(e => ({ ...e, _queriedArtist: batch[j] })))
      cache.set(batch[j].toLowerCase(), events)
    }

    // Pause between batches
    if (i + BATCH_SIZE < uncached.length) await sleep(500)
  }

  return allEvents
}

// ── FESTIVAL DETECTION & GROUPING ────────────────────────────────────────────

function isFestivalEvent(event: TmEvent): boolean {
  const name = (event.name || '').toLowerCase()
  const attractionCount = event._embedded?.attractions?.length || 0

  // A festival must have at least MIN_LINEUP (3) attractions.
  // A single headliner — even at a venue called a festival — isn't a festival.
  if (attractionCount < MIN_LINEUP) return false

  // Additionally require a festival signal in the name OR genre.
  // Previously this was an independent OR branch with the attraction count, which
  // let tour-stop events with a vague genre tag slip through.  AND is much tighter.
  const hasFestivalName  = /festival|fest\b|festi|open air/i.test(name)
  const cls              = event.classifications?.[0]
  const genre            = (cls?.genre?.name    || '').toLowerCase()
  const subGenre         = (cls?.subGenre?.name || '').toLowerCase()
  const hasFestivalGenre = /festival/i.test(genre) || /festival/i.test(subGenre)

  return hasFestivalName || hasFestivalGenre
}

// Check if an event is an artist tour stop at a festival
// (e.g. "Kneecap - Fenian Tour | Locus Festival 2026")
// These clutter the list when the actual festival also appears
function isTourStopName(eventName: string, queriedArtist: string): boolean {
  const name = eventName.toLowerCase()
  const artist = queriedArtist.toLowerCase()
  // Pattern: starts with the artist name, followed by separator
  return name.startsWith(artist) && /^[^|]*[-–—|]/.test(name)
}

function makeGroupKey(event: TmEvent): string {
  const venue = event._embedded?.venues?.[0]
  if (!venue?.location?.latitude || !venue?.location?.longitude) {
    // Fallback: group by venue name + date
    const vName = (venue?.name || 'unknown').toLowerCase().replace(/[^a-z0-9]/g, '')
    const date = event.dates?.start?.localDate || ''
    return `${vName}|${date.substring(0, 7)}` // venue + year-month
  }

  const lat = Math.round(parseFloat(venue.location.latitude) * 100) / 100
  const lng = Math.round(parseFloat(venue.location.longitude) * 100) / 100
  const date = event.dates?.start?.localDate || ''
  // Group events within same 10-day window at same location
  const dayBucket = Math.floor(new Date(date).getTime() / (10 * 86400000))
  return `${lat}|${lng}|${dayBucket}`
}

function slugify(name: string): string {
  return name.toLowerCase()
    // Strip leading date-range prefixes that produce junk slugs like
    // "2-july-5-july-rock-werchter".  Run both passes before anything else.
    .replace(/^\d+\s*-?\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*/i, '')
    .replace(/^\d{1,2}(st|nd|rd|th)\s+\w+/i, '')
    // Strip common suffixes that differ between sources
    .replace(/\s*-?\s*(festivalticket|combi|weekend|day ticket|friday|saturday|sunday|thursday).*$/i, '')
    .replace(/\s*\d{4}\s*/g, ' ')        // strip years
    .replace(/\s*\|\s*/g, ' ')           // pipes to spaces
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00Z')
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${days[d.getUTCDay()]} ${months[d.getUTCMonth()]} ${d.getUTCDate()}`
}

function groupIntoFestivals(
  events: TaggedEvent[],
  userArtists: Set<string>
): FestivalGroup[] {
  const groups = new Map<string, FestivalGroup>()

  for (const event of events) {
    if (!isFestivalEvent(event)) continue

    // Belt-and-suspenders: a single attraction starting after 18:00 is a concert.
    // isFestivalEvent already requires ≥3 attractions, so this guard is for any
    // future loosening of that threshold.
    const _ac        = event._embedded?.attractions?.length || 0
    const _localTime = event.dates?.start?.localTime
    if (_ac === 1 && _localTime && _localTime >= '18:00') continue

    // Reject tour stops: if the longest alphabetic word in the event name
    // equals the queried artist (case-insensitive), this is a solo show.
    // e.g. queried "Muse", event name "Muse" → longest word "Muse" = artist → skip.
    const _nameWords    = (event.name || '').split(/\s+/).filter(w => /[a-zA-Z]/.test(w))
    const _longestWord  = _nameWords.reduce((a, b) => a.length >= b.length ? a : b, '')
    if (_longestWord.toLowerCase() === event._queriedArtist.toLowerCase()) continue

    const key = makeGroupKey(event)
    const venue = event._embedded?.venues?.[0]

    if (!groups.has(key)) {
      const city = venue?.city?.name || ''
      const country = venue?.country?.name || venue?.country?.countryCode || ''

      groups.set(key, {
        key,
        name: event.name,
        location: [city, country].filter(Boolean).join(', '),
        country: venue?.country?.countryCode || '',
        lat: parseFloat(venue?.location?.latitude || '0'),
        lng: parseFloat(venue?.location?.longitude || '0'),
        dates: new Set(),
        allArtists: new Set(),
        allArtistsDisplay: new Map(),
        matchedArtists: new Map(),
        tmUrl: event.url,
        tmEventIds: new Set(),
      })
    }

    const group = groups.get(key)!

    // Collect dates and TM event IDs (one per festival day, deduped)
    if (event.dates?.start?.localDate) {
      group.dates.add(event.dates.start.localDate)
    }
    group.tmEventIds.add(event.id)

    // The queried artist is a confirmed match
    const qLower = event._queriedArtist.toLowerCase()
    group.allArtists.add(qLower)
    group.allArtistsDisplay.set(qLower, event._queriedArtist)
    group.matchedArtists.set(qLower, event._queriedArtist)

    // Add all attractions from the event lineup
    if (event._embedded?.attractions) {
      for (const attr of event._embedded.attractions) {
        const aLower = attr.name.toLowerCase()
        group.allArtists.add(aLower)
        group.allArtistsDisplay.set(aLower, attr.name)
        if (userArtists.has(aLower)) {
          group.matchedArtists.set(aLower, attr.name)
        }
      }
    }

    // Prefer longer/more descriptive names, but strip tour-stop prefixes
    let candidateName = event.name
    if (isTourStopName(event.name, event._queriedArtist)) {
      // Extract the festival name from after the pipe/dash
      // "Kneecap - Fenian Tour | Locus Festival 2026" → "Locus Festival 2026"
      const parts = event.name.split(/\s*\|\s*/)
      if (parts.length > 1) {
        candidateName = parts[parts.length - 1].trim()
      }
    }
    if (candidateName.length > group.name.length || isTourStopName(group.name, event._queriedArtist)) {
      if (!isTourStopName(candidateName, event._queriedArtist)) {
        group.name = candidateName
      }
    }
  }

  return [...groups.values()]
    .filter(g => {
      // Must have at least one matched artist
      if (g.matchedArtists.size === 0) return false
      // Filter out single-artist tour stops at festivals:
      // if total known lineup is tiny AND it's basically one artist, skip it
      if (g.allArtists.size <= 2 && g.matchedArtists.size <= 1) return false
      return true
    })
    .sort((a, b) => {
      // Primary: match count descending
      if (b.matchedArtists.size !== a.matchedArtists.size)
        return b.matchedArtists.size - a.matchedArtists.size
      // Secondary: bigger festivals first (more known artists = more legit)
      return b.allArtists.size - a.allArtists.size
    })
}

// ── SUPABASE: CACHE + TIMETABLE ─────────────────────────────────────────────

function getSupabaseClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )
}

async function loadCache(sb: ReturnType<typeof createClient>, artists: string[]) {
  const cache = new Map<string, TmEvent[]>()
  const cutoff = new Date(Date.now() - CACHE_TTL).toISOString()

  const { data } = await sb
    .from('artist_events_cache')
    .select('artist_name, events')
    .in('artist_name', artists.map(a => a.toLowerCase()))
    .gte('fetched_at', cutoff)

  if (data) {
    for (const row of data) {
      const parsed = typeof row.events === 'string' ? JSON.parse(row.events) : row.events
      cache.set(row.artist_name, parsed as TmEvent[])
    }
  }
  return cache
}

async function saveCache(
  sb: ReturnType<typeof createClient>,
  cache: Map<string, TmEvent[]>
) {
  const rows = [...cache.entries()].map(([artist_name, events]) => ({
    artist_name,
    events: events,
    fetched_at: new Date().toISOString(),
  }))

  if (rows.length > 0) {
    for (let i = 0; i < rows.length; i += 50) {
      await sb.from('artist_events_cache')
        .upsert(rows.slice(i, i + 50), { onConflict: 'artist_name' })
    }
  }
}

async function getTimetable(sb: ReturnType<typeof createClient>, festivalKey: string) {
  const { data } = await sb
    .from('timetable_slots')
    .select('*')
    .eq('festival_key', festivalKey)
    .order('day_index')
    .order('start_time')

  return data || []
}

async function getFestivalMeta(sb: ReturnType<typeof createClient>, festivalKey: string) {
  const { data } = await sb
    .from('festival_meta')
    .select('*')
    .eq('festival_key', festivalKey)
    .single()

  return data
}

// ── MAIN HANDLER ─────────────────────────────────────────────────────────────

serve(async (req) => {
  const corsRes = handleCors(req)
  if (corsRes) return corsRes

  if (!TM_KEY) {
    return jsonResponse({
      error: 'TICKETMASTER_API_KEY not configured. Set it via: supabase secrets set TICKETMASTER_API_KEY=your-key',
    }, 503)
  }

  try {
    const { artists, festivalKey } = await req.json()
    const sb = getSupabaseClient()

    // ── MODE A: Fetch timetable for a specific festival ──
    if (festivalKey) {
      const [meta, slots] = await Promise.all([
        getFestivalMeta(sb, festivalKey),
        getTimetable(sb, festivalKey),
      ])

      return jsonResponse({
        festival: meta,
        timetable: slots,
        // hasTimetable is true only when at least one slot has actual times.
        // Slots with null start_time were ingested as lineup-only data and
        // should render in "lineup-only" mode, not as a full timetable.
        hasTimetable: slots.some(s => s.start_time !== null),
      })
    }

    // ── MODE B: Discover festivals from artist list ──
    if (!artists || !Array.isArray(artists) || artists.length === 0) {
      return jsonResponse({ error: 'artists[] is required' }, 400)
    }

    const uniqueArtists = [...new Set(
      artists.map((a: string) => a.trim()).filter(Boolean)
    )].slice(0, 80) // cap to stay within daily rate limits

    const userArtistSet = new Set(uniqueArtists.map(a => a.toLowerCase()))

    // Load cache → fetch events → save cache
    const cache = await loadCache(sb, uniqueArtists)
    const allEvents = await fetchAllArtistEvents(uniqueArtists, cache)
    saveCache(sb, cache).catch(() => {}) // fire-and-forget

    // Group into festivals
    const groups = groupIntoFestivals(allEvents, userArtistSet)

    // Check which festivals have timetable data in Supabase
    const festivalKeys = groups.map(g => slugify(g.name))

    const { data: metaRows } = await sb
      .from('festival_meta')
      .select('festival_key, emoji, accent_color, days, stages')
      .in('festival_key', festivalKeys)

    const metaMap = new Map((metaRows || []).map(r => [r.festival_key, r]))

    // Only count slots that have actual times — lineup-only slots (null
    // start_time) must NOT cause hasTimetable to be set to true, because
    // SchedulePage would try to render a grid with no time data.
    const { data: slotCounts } = await sb
      .from('timetable_slots')
      .select('festival_key')
      .in('festival_key', festivalKeys)
      .not('start_time', 'is', null)

    const hasTimetable = new Set((slotCounts || []).map(r => r.festival_key))

    // Build response
    const festivals = groups.map(g => {
      const key = slugify(g.name)
      const meta = metaMap.get(key)
      const sortedDates = [...g.dates].sort()

      return {
        id: key,
        name: g.name,
        location: g.location,
        country: g.country,
        lat: g.lat,
        lng: g.lng,
        startDate: sortedDates[0] || null,
        endDate: sortedDates[sortedDates.length - 1] || null,
        days: sortedDates.map(d => formatDate(d)),
        matchedArtists: [...g.matchedArtists.values()],
        totalKnownArtists: g.allArtists.size,
        matchCount: g.matchedArtists.size,
        hasTimetable: hasTimetable.has(key),
        emoji: meta?.emoji || '🎵',
        accentColor: meta?.accent_color || null,
        stages: meta?.stages || null,
        ticketUrl: g.tmUrl || null,
        tmEventIds: [...g.tmEventIds],  // TM event IDs for client-side ingest
      }
    })

    return jsonResponse({ festivals })

  } catch (err) {
    console.error('discover-festivals error:', err)
    return jsonResponse({ error: 'Internal server error' }, 500)
  }
})
