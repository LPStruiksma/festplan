// API client for FestPlan backend.
// Calls the Supabase Edge Function (backed by Ticketmaster Discovery API)
// for live festival discovery, falling back to hardcoded data in
// festivals.js when the backend is unavailable or not yet deployed.

import { supabase } from './supabase'
import { FESTIVALS, FEST_COLORS, norm } from './festivals'

const EDGE_FN_BASE = import.meta.env.VITE_SUPABASE_URL + '/functions/v1'

// ── DISCOVER FESTIVALS ───────────────────────────────────────────────────────
// Send the user's Spotify artists to the Edge Function.
// Returns a ranked list of festivals with match counts.

export async function discoverFestivals(artists) {
  // Try live API first
  try {
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`${EDGE_FN_BASE}/discover-festivals`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session?.access_token || ''}`,
        'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ artists }),
    })

    if (res.ok) {
      const { festivals } = await res.json()
      if (festivals && festivals.length > 0) {
        return { source: 'live', festivals }
      }
    }
  } catch (e) {
    console.warn('Live discovery unavailable, using fallback:', e.message)
  }

  // Fallback: match against hardcoded festivals.js
  return { source: 'fallback', festivals: fallbackDiscover(artists) }
}

// ── FETCH TIMETABLE ──────────────────────────────────────────────────────────
// Get detailed stage + time data for a specific festival.
// Returns the full festival object in the shape SchedulePage expects.

export async function fetchTimetable(festivalId) {
  // Check hardcoded data first (always available, most reliable for now)
  const hardcoded = FESTIVALS[festivalId]
  if (hardcoded) {
    return { source: 'hardcoded', festival: hardcoded }
  }

  // Try the Edge Function for Supabase-stored timetables
  try {
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`${EDGE_FN_BASE}/discover-festivals`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session?.access_token || ''}`,
        'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ festivalKey: festivalId }),
    })

    if (res.ok) {
      const { festival: meta, timetable, hasTimetable } = await res.json()
      if (hasTimetable && meta) {
        // Reshape into the format SchedulePage expects
        return {
          source: 'supabase',
          festival: {
            id: festivalId,
            name: meta.name,
            location: meta.location,
            emoji: meta.emoji || '🎵',
            days: meta.days || [],
            stages: meta.stages || [...new Set(timetable.map(s => s.stage).filter(Boolean))],
            lineup: timetable.map(s => ({
              artist: s.artist,
              stage: s.stage,
              day: s.day_index,
              start: s.start_time,
              end: s.end_time,
            })),
            hasTimetable: true,
          },
        }
      }

      if (!hasTimetable && meta) {
        // Festival is known but the timetable hasn't been published yet.
        // Return a lineup-only shape so SchedulePage can render without crashing.
        // Artist names come from meta.lineup, meta.artists, or meta.matchedArtists
        // depending on which edge-function path was hit.
        const knownArtists = meta.lineup || meta.artists || meta.matchedArtists || []
        return {
          source: 'supabase-lineup-only',
          festival: {
            id: festivalId,
            name: meta.name,
            location: meta.location || '',
            emoji: meta.emoji || '🎵',
            days: [],
            stages: [],
            lineup: knownArtists.map(a => ({
              artist: typeof a === 'string' ? a : a.name,
              stage: null,
              day: null,
              start: null,
              end: null,
            })),
            hasTimetable: false,
            accentColor: meta.accentColor || null,
          },
        }
      }
    }
  } catch (e) {
    console.warn('Timetable fetch failed:', e.message)
  }

  return null
}

// ── HELPERS ──────────────────────────────────────────────────────────────────

// Get the accent color for a festival, with fallback
export function getFestivalColor(festivalId) {
  return FEST_COLORS[festivalId] || '#c8f400'
}

// Fallback: discover from hardcoded data (current behavior).
// Exported so it can be unit-tested independently of the network layer.
export function fallbackDiscover(artists) {
  return Object.values(FESTIVALS).map(f => {
    const festArtists = [...new Set(f.lineup.map(s => s.artist))]
    const matched = artists.filter(a => festArtists.some(b => norm(b) === norm(a)))
    return {
      id: f.id,
      name: f.name,
      location: f.location,
      emoji: f.emoji,
      days: f.days,
      startDate: null,
      endDate: null,
      matchedArtists: matched,
      totalKnownArtists: festArtists.length,
      matchCount: matched.length,
      hasTimetable: true,  // hardcoded data always has timetables
      accentColor: FEST_COLORS[f.id] || null,
      stages: f.stages,
    }
  }).sort((a, b) => b.matchCount - a.matchCount)
}

// Merge live-discovered festivals with hardcoded ones.
// Hardcoded festivals get priority for timetable data;
// live discoveries extend the list.
export function mergeFestivals(liveFestivals, artists) {
  const hardcodedResults = fallbackDiscover(artists)
  const seen = new Set(hardcodedResults.map(f => f.id))

  // Add live discoveries that aren't already in hardcoded set
  const extras = (liveFestivals || []).filter(f => !seen.has(f.id))

  return [...hardcodedResults, ...extras]
    .sort((a, b) => b.matchCount - a.matchCount)
}
