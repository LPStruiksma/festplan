// supabase/functions/recommend-festivals/index.ts
//
// Recommends festivals that match artists *related* to the user's taste —
// beyond what discover-festivals finds through direct artist matching.
//
// Flow:
//   1. Accept { artists: string[] } in the request body.
//   2. Require the caller's Spotify access token via the x-spotify-token header
//      (edge functions cannot issue their own user-scoped Spotify tokens).
//   3. For the first 10 artists, search Spotify for their artist IDs, then
//      fetch the top 5 related artists per input.
//   4. Build an expanded artist set = original + related (deduplicated).
//   5. Match both sets against the Supabase timetable_slots table.
//   6. Keep only festivals where expandedMatchCount > originalMatchCount.
//   7. Sort by the difference (expandedMatchCount − originalMatchCount).
//   8. Return up to 10 recommendations with both counts and the matched
//      related artist names so the client can render "5 direct · 3 via related".

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, jsonResponse } from '../_shared/cors.ts'

// ── CONFIG ───────────────────────────────────────────────────────────────────

const SPOTIFY_API        = 'https://api.spotify.com/v1'
const MAX_INPUT_ARTISTS  = 10   // cap to keep Spotify calls fast
const RELATED_PER_ARTIST = 5    // take only the top 5 related per input artist

// ── SPOTIFY HELPERS ──────────────────────────────────────────────────────────

/** Search Spotify for an artist by name and return their Spotify ID. */
async function searchArtistId(name: string, token: string): Promise<string | null> {
  try {
    const params = new URLSearchParams({ q: name, type: 'artist', limit: '1' })
    const res = await fetch(`${SPOTIFY_API}/search?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return null
    const data = await res.json()
    return data?.artists?.items?.[0]?.id ?? null
  } catch {
    return null
  }
}

/** Return the names of the top N related artists for a given Spotify artist ID. */
async function getRelatedArtistNames(
  artistId: string,
  token: string,
  limit = RELATED_PER_ARTIST,
): Promise<string[]> {
  try {
    const res = await fetch(`${SPOTIFY_API}/artists/${artistId}/related-artists`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return []
    const data = await res.json()
    return (data?.artists ?? []).slice(0, limit).map((a: { name: string }) => a.name)
  } catch {
    return []
  }
}

// ── NORMALISATION ─────────────────────────────────────────────────────────────
// Mirrors the norm() function in src/lib/festivals.js so matching is consistent.

function norm(s: string): string {
  return (s || '').toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim()
}

// ── SUPABASE CLIENT ──────────────────────────────────────────────────────────

function getSupabaseClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
}

// ── MAIN HANDLER ─────────────────────────────────────────────────────────────

serve(async (req) => {
  // Handle CORS preflight
  const corsRes = handleCors(req)
  if (corsRes) return corsRes

  try {
    // ── Validate token header ──
    const spotifyToken = req.headers.get('x-spotify-token')
    if (!spotifyToken) {
      return jsonResponse({ error: 'x-spotify-token header is required' }, 401)
    }

    // ── Validate request body ──
    const body = await req.json().catch(() => ({}))
    const artists: string[] = body?.artists ?? []

    if (!Array.isArray(artists) || artists.length < 5) {
      return jsonResponse(
        { error: 'artists[] must contain at least 5 entries' },
        400,
      )
    }

    const inputArtists = [...new Set(
      artists.map((a: string) => a.trim()).filter(Boolean),
    )].slice(0, MAX_INPUT_ARTISTS)

    const inputNormSet = new Set(inputArtists.map(norm))

    // ── Step 1: Resolve Spotify IDs for the input artists (parallel) ──────────
    const artistIds = await Promise.all(
      inputArtists.map(a => searchArtistId(a, spotifyToken)),
    )

    // ── Step 2: Fetch related artists for each input (parallel) ──────────────
    const relatedBatches: string[][] = await Promise.all(
      artistIds.map(id =>
        id ? getRelatedArtistNames(id, spotifyToken) : Promise.resolve([]),
      ),
    )

    // ── Step 3: Build the expanded set — related artists not in the user's own list ──
    // Preserve order so "most related" artists (from strongest input artists)
    // come first; use a Set to deduplicate.
    const expandedMap = new Map<string, string>()  // norm → display name
    for (const batch of relatedBatches) {
      for (const name of batch) {
        const n = norm(name)
        if (!inputNormSet.has(n) && !expandedMap.has(n)) {
          expandedMap.set(n, name)
        }
      }
    }

    // ── Step 4: Load all festival data from Supabase ──────────────────────────
    const sb = getSupabaseClient()

    const [metaRes, slotsRes] = await Promise.all([
      sb
        .from('festival_meta')
        .select('festival_key, name, location, emoji, accent_color, days, start_date, end_date')
        .order('start_date'),
      sb
        .from('timetable_slots')
        .select('festival_key, artist'),
    ])

    if (metaRes.error || !metaRes.data?.length) {
      return jsonResponse({ recommendations: [] })
    }

    // ── Step 5: Group timetable slots by festival ─────────────────────────────
    const slotsByFestival = new Map<string, string[]>()
    for (const slot of slotsRes.data ?? []) {
      if (!slotsByFestival.has(slot.festival_key)) {
        slotsByFestival.set(slot.festival_key, [])
      }
      slotsByFestival.get(slot.festival_key)!.push(slot.artist)
    }

    // ── Step 6: Score each festival ──────────────────────────────────────────
    const recommendations = metaRes.data
      .map(f => {
        const festArtistNorms = (slotsByFestival.get(f.festival_key) ?? []).map(norm)

        // Direct matches: user's own artists that play this festival
        const originalMatchCount = inputArtists.filter(
          a => festArtistNorms.some(fn => fn === norm(a)),
        ).length

        // Extended matches: related artists that play this festival
        const relatedMatchedArtists: string[] = []
        for (const [n, displayName] of expandedMap) {
          if (festArtistNorms.some(fn => fn === n)) {
            relatedMatchedArtists.push(displayName)
          }
        }

        const expandedMatchCount = originalMatchCount + relatedMatchedArtists.length
        const matchDifference    = expandedMatchCount - originalMatchCount

        return {
          id:                    f.festival_key,
          name:                  f.name,
          location:              f.location || '',
          emoji:                 f.emoji    || '🎵',
          accentColor:           f.accent_color || null,
          days:                  f.days      || [],
          startDate:             f.start_date || null,
          originalMatchCount,
          expandedMatchCount,
          relatedMatchedArtists,
          matchDifference,
        }
      })
      // Only surface festivals that bring net new matches via related artists
      .filter(f => f.matchDifference > 0)
      // Primary: most net-new matches first; secondary: highest total match count
      .sort(
        (a, b) =>
          b.matchDifference    - a.matchDifference ||
          b.expandedMatchCount - a.expandedMatchCount,
      )

    return jsonResponse({ recommendations })

  } catch (err) {
    console.error('recommend-festivals error:', err)
    return jsonResponse({ error: 'Internal server error' }, 500)
  }
})
