import { describe, test, expect, vi } from 'vitest'

// ── Supabase mock ─────────────────────────────────────────────────────────────
// supabase.js calls createClient() at import time and throws when the env vars
// are absent.  We replace the whole module with a minimal stub so importing
// api.js doesn't trigger network or env-var validation.
//
// vi.mock is automatically hoisted to the top of the file by Vitest, so this
// runs before any imports regardless of where it appears in the source.
vi.mock('./supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
    },
  },
}))

import { fallbackDiscover } from './api'
import { FESTIVALS } from './festivals'

// ─────────────────────────────────────────────────────────────────────────────
// fallbackDiscover(artists)
//
// Matches an artist list against every festival in the hardcoded FESTIVALS
// object and returns a list sorted descending by matchCount.
// ─────────────────────────────────────────────────────────────────────────────

describe('fallbackDiscover', () => {
  const allFestivals = Object.values(FESTIVALS)

  // ── Result shape ────────────────────────────────────────────────────────────
  test('returns one result per hardcoded festival', () => {
    expect(fallbackDiscover([])).toHaveLength(allFestivals.length)
  })

  test('every result has the required fields', () => {
    for (const r of fallbackDiscover([])) {
      expect(r).toHaveProperty('id')
      expect(r).toHaveProperty('name')
      expect(r).toHaveProperty('matchedArtists')
      expect(r).toHaveProperty('matchCount')
      expect(r).toHaveProperty('hasTimetable')
      expect(r).toHaveProperty('totalKnownArtists')
      expect(typeof r.matchCount).toBe('number')
      expect(Array.isArray(r.matchedArtists)).toBe(true)
    }
  })

  test('hardcoded festivals always report hasTimetable: true', () => {
    fallbackDiscover([]).forEach(r => expect(r.hasTimetable).toBe(true))
  })

  // ── Empty / unknown artists ─────────────────────────────────────────────────
  test('returns matchCount 0 for all festivals when the artist list is empty', () => {
    fallbackDiscover([]).forEach(r => expect(r.matchCount).toBe(0))
  })

  test('returns matchCount 0 everywhere for completely unknown artists', () => {
    fallbackDiscover(['__phantom__', '__nobody__'])
      .forEach(r => expect(r.matchCount).toBe(0))
  })

  // ── Sorting guarantee ───────────────────────────────────────────────────────
  test('result array is sorted descending by matchCount', () => {
    // Use all artists from the first festival so at least one festival has
    // a non-zero match score, exercising the sort path.
    const artists = allFestivals[0].lineup.map(s => s.artist)
    const results = fallbackDiscover(artists)

    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].matchCount).toBeGreaterThanOrEqual(results[i].matchCount)
    }
  })

  test('the first result always has the maximum matchCount', () => {
    const artists = allFestivals[0].lineup.map(s => s.artist)
    const results = fallbackDiscover(artists)
    const max = Math.max(...results.map(r => r.matchCount))
    expect(results[0].matchCount).toBe(max)
  })

  // ── Artist matching ─────────────────────────────────────────────────────────
  test('matching is case-insensitive', () => {
    const firstFest    = allFestivals[0]
    const sampleArtist = firstFest.lineup[0].artist  // e.g. "Radiohead"
    const festId       = firstFest.id

    const byOriginal = fallbackDiscover([sampleArtist]).find(r => r.id === festId).matchCount
    const byUpper    = fallbackDiscover([sampleArtist.toUpperCase()]).find(r => r.id === festId).matchCount
    const byLower    = fallbackDiscover([sampleArtist.toLowerCase()]).find(r => r.id === festId).matchCount

    expect(byUpper).toBe(byOriginal)
    expect(byLower).toBe(byOriginal)
  })

  test('matchedArtists includes artists present in that festival', () => {
    const firstFest    = allFestivals[0]
    const sampleArtist = firstFest.lineup[0].artist

    const result = fallbackDiscover([sampleArtist]).find(r => r.id === firstFest.id)

    expect(result.matchedArtists).toContain(sampleArtist)
    expect(result.matchCount).toBe(1)
  })

  test('matchedArtists does not include artists absent from a festival', () => {
    const firstFest    = allFestivals[0]
    const notInFest    = '__artist_not_in_any_festival__'

    const result = fallbackDiscover([notInFest]).find(r => r.id === firstFest.id)

    expect(result.matchedArtists).not.toContain(notInFest)
  })

  test('totalKnownArtists equals the number of unique artists in the festival lineup', () => {
    const firstFest     = allFestivals[0]
    const uniqueCount   = new Set(firstFest.lineup.map(s => s.artist)).size

    const result = fallbackDiscover([]).find(r => r.id === firstFest.id)

    expect(result.totalKnownArtists).toBe(uniqueCount)
  })
})
