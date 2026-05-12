// API client for FestPlan backend.
// All festival data is now sourced exclusively from Supabase
// (festival_meta + timetable_slots). Seed festivals with:
//   node --env-file=.env scripts/seed-festival.mjs scripts/festivals/<id>-2026.json

import { supabase } from './supabase'
import { FEST_COLORS, norm } from './festivals'

const EDGE_FN_BASE = import.meta.env.VITE_SUPABASE_URL + '/functions/v1'

// ── ARTIST AUTOCOMPLETE CACHE ─────────────────────────────────────────────────
// Starts empty; populated on the first fetchAllFestivals() or fallbackDiscover()
// call so that SetupPage's manual-add input has artist name hints available.
export let artistCache = []

// ── FETCH ALL FESTIVALS ───────────────────────────────────────────────────────
// Fetch all seeded festivals from Supabase for the Plan-mode picker.
// Also hydrates artistCache from timetable_slots so the autocomplete input
// works without a separate round-trip.

export async function fetchAllFestivals() {
  try {
    const [metaRes, slotsRes] = await Promise.all([
      supabase
        .from('festival_meta')
        .select('festival_key, name, location, emoji, accent_color, days, stages, start_date, end_date')
        .order('start_date'),
      supabase
        .from('timetable_slots')
        .select('artist'),
    ])

    const { data, error } = metaRes
    const { data: slotData }  = slotsRes

    // Hydrate the artist autocomplete cache from all seeded slots.
    if (slotData?.length) {
      artistCache = [...new Set(slotData.map(s => s.artist))].sort()
    }

    if (!error && data && data.length > 0) {
      return data.map(f => ({
        id:          f.festival_key,
        name:        f.name,
        location:    f.location || '',
        emoji:       f.emoji || '🎵',
        days:        f.days || [],
        startDate:   f.start_date,
        endDate:     f.end_date,
        accentColor: f.accent_color || FEST_COLORS[f.festival_key] || null,
        stages:      f.stages || [],
        hasTimetable: true,
      }))
    }
  } catch (e) {
    console.warn('fetchAllFestivals: Supabase unavailable:', e.message)
  }
  return []
}

// ── FETCH TIMETABLE ───────────────────────────────────────────────────────────
// Get full stage + time data for a specific festival from Supabase.

export async function fetchTimetable(festivalId) {
  try {
    // 1. Fetch festival metadata
    const { data: meta, error: metaErr } = await supabase
      .from('festival_meta')
      .select('*')
      .eq('festival_key', festivalId)
      .single()

    if (metaErr || !meta) {
      console.warn(`fetchTimetable: no festival_meta for "${festivalId}"`)
      return null
    }

    // 2. Fetch timetable slots
    const { data: slots, error: slotsErr } = await supabase
      .from('timetable_slots')
      .select('artist, stage, day_index, start_time, end_time')
      .eq('festival_key', festivalId)

    if (slotsErr) console.warn('fetchTimetable: timetable_slots error:', slotsErr.message)

    const hasTimetable = !slotsErr && slots && slots.length > 0

    return {
      source: 'supabase',
      festival: {
        id:          festivalId,
        name:        meta.name,
        location:    meta.location || '',
        emoji:       meta.emoji || '🎵',
        accentColor: meta.accent_color || FEST_COLORS[festivalId] || null,
        startDate:   meta.start_date || null,
        endDate:     meta.end_date   || null,
        days:        meta.days   || [],
        stages:      meta.stages || (hasTimetable
          ? [...new Set(slots.map(s => s.stage).filter(Boolean))]
          : []),
        lineup: hasTimetable
          ? slots.map(s => ({
              artist: s.artist,
              stage:  s.stage,
              day:    s.day_index,
              start:  s.start_time,
              end:    s.end_time,
            }))
          : [],
        hasTimetable,
      },
    }
  } catch (e) {
    console.warn('fetchTimetable failed:', e.message)
    return null
  }
}

// ── FALLBACK DISCOVER ─────────────────────────────────────────────────────────
// When the edge function is unavailable, query Supabase festival_meta and
// timetable_slots directly to compute match scores.
// Exported so it can be unit-tested independently of the network layer.

export async function fallbackDiscover(artists) {
  try {
    const [metaRes, slotsRes] = await Promise.all([
      supabase
        .from('festival_meta')
        .select('festival_key, name, location, emoji, accent_color, days, stages, start_date, end_date')
        .order('start_date'),
      supabase
        .from('timetable_slots')
        .select('festival_key, artist'),
    ])

    const { data: metas, error: metaErr } = metaRes
    const { data: slots } = slotsRes

    if (metaErr || !metas?.length) return []

    // Hydrate artist cache as a side-effect.
    if (slots?.length) {
      artistCache = [...new Set(slots.map(s => s.artist))].sort()
    }

    return metas.map(f => {
      const festArtists = [...new Set(
        (slots || [])
          .filter(s => s.festival_key === f.festival_key)
          .map(s => s.artist)
      )]
      const matched = artists.filter(a => festArtists.some(b => norm(b) === norm(a)))
      return {
        id:                f.festival_key,
        name:              f.name,
        location:          f.location || '',
        emoji:             f.emoji || '🎵',
        days:              f.days || [],
        startDate:         f.start_date || null,
        endDate:           f.end_date   || null,
        matchedArtists:    matched,
        totalKnownArtists: festArtists.length,
        matchCount:        matched.length,
        hasTimetable:      festArtists.length > 0,
        accentColor:       f.accent_color || FEST_COLORS[f.festival_key] || null,
        stages:            f.stages || [],
      }
    }).sort((a, b) => b.matchCount - a.matchCount)
  } catch (e) {
    console.warn('fallbackDiscover: Supabase unavailable:', e.message)
    return []
  }
}

// ── DISCOVER FESTIVALS ────────────────────────────────────────────────────────
// Send the user's Spotify artists to the Edge Function.
// Returns a ranked list of festivals with match counts.

export async function discoverFestivals(artists) {
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

  // Fallback: match against Supabase-stored timetable data directly.
  const festivals = await fallbackDiscover(artists)
  return { source: 'fallback', festivals }
}

// ── RECOMMEND FESTIVALS ───────────────────────────────────────────────────────
// Call the recommend-festivals edge function with the user's Spotify token.
// Returns festivals whose lineups contain artists *related* to the user's taste
// but not already in their own list — sorted by net-new related matches.
//
// Returns [] on any error so callers can degrade gracefully without
// breaking the main discover flow.

export async function recommendFestivals(artists, spotifyToken) {
  if (!spotifyToken || artists.length < 5) return []
  try {
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`${EDGE_FN_BASE}/recommend-festivals`, {
      method: 'POST',
      headers: {
        'Content-Type':    'application/json',
        'Authorization':   `Bearer ${session?.access_token || ''}`,
        'apikey':          import.meta.env.VITE_SUPABASE_ANON_KEY,
        'x-spotify-token': spotifyToken,
      },
      body: JSON.stringify({ artists }),
    })
    if (!res.ok) return []
    const { recommendations } = await res.json()
    return recommendations ?? []
  } catch (e) {
    console.warn('recommendFestivals: failed silently:', e.message)
    return []
  }
}

// ── ENSURE FESTIVAL INGESTED ──────────────────────────────────────────────────
// Called by SetupPage when a user picks a live-discovered festival that isn't
// already in festival_meta.  Triggers ingest-festival-timetable (multi-day
// shape) so SchedulePage gets a real lineup instead of lineup-only mode.
//
// Returns true  — festival already existed OR ingest succeeded.
// Returns false — ingest failed (network error, non-admin user, etc.).
// Never throws  — callers can navigate regardless of the outcome.

export async function ensureFestivalIngested(festivalKey, tmEventIds) {
  try {
    // (a) Already seeded — nothing to do.
    const { data } = await supabase
      .from('festival_meta')
      .select('festival_key')
      .eq('festival_key', festivalKey)
      .maybeSingle()
    if (data) return true

    // (b) Not seeded — trigger multi-day ingest via the edge function.
    if (!tmEventIds?.length) return false

    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`${EDGE_FN_BASE}/ingest-festival-timetable`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session?.access_token || ''}`,
        'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ eventIds: tmEventIds, festivalSlug: festivalKey }),
    })
    return res.ok
  } catch {
    return false
  }
}

// ── HELPERS ───────────────────────────────────────────────────────────────────

// Get the accent color for a festival, with fallback.
export function getFestivalColor(festivalId) {
  return FEST_COLORS[festivalId] || '#c8f400'
}

// Merge live-discovered festivals with the Supabase-stored set.
// Live discoveries extend the Supabase list for any not-yet-seeded festivals.
export async function mergeFestivals(liveFestivals, artists) {
  const fallbackResults = await fallbackDiscover(artists)
  const seen = new Set(fallbackResults.map(f => f.id))
  const extras = (liveFestivals || []).filter(f => !seen.has(f.id))
  return [...fallbackResults, ...extras]
    .sort((a, b) => b.matchCount - a.matchCount)
}
