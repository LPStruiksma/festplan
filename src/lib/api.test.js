import { describe, test, expect, vi } from 'vitest'

// ── Test fixtures (hoisted so they're accessible inside vi.mock) ──────────────
//
// vi.mock factories are hoisted to the top of the file by Vitest, which means
// they run before any top-level const declarations.  vi.hoisted() lifts these
// fixtures to the same level so the mock factory can reference them.

const { MOCK_METAS, MOCK_SLOTS } = vi.hoisted(() => {
  const MOCK_METAS = [
    {
      festival_key: 'alpha',
      name:         'Alpha Fest 2026',
      location:     'Alphaville',
      emoji:        '🎪',
      accent_color: '#ff0000',
      days:         ['Fri Jun 5', 'Sat Jun 6'],
      stages:       ['Main Stage', 'Side Stage'],
      start_date:   '2026-06-05',
      end_date:     '2026-06-06',
    },
    {
      festival_key: 'beta',
      name:         'Beta Fest 2026',
      location:     'Betatown',
      emoji:        '🎵',
      accent_color: '#0000ff',
      days:         ['Sat Jul 4', 'Sun Jul 5'],
      stages:       ['Big Stage'],
      start_date:   '2026-07-04',
      end_date:     '2026-07-05',
    },
  ]

  // Alpha has 3 unique artists; Beta has 2 unique artists.
  const MOCK_SLOTS = [
    { festival_key: 'alpha', artist: 'Radiohead' },
    { festival_key: 'alpha', artist: 'Bicep' },
    { festival_key: 'alpha', artist: 'Slowdive' },
    { festival_key: 'beta',  artist: 'Gorillaz' },
    { festival_key: 'beta',  artist: 'Little Simz' },
  ]

  return { MOCK_METAS, MOCK_SLOTS }
})

// ── Supabase mock ─────────────────────────────────────────────────────────────
// supabase.js calls createClient() at import time and throws when env vars are
// absent.  We replace the whole module with a minimal stub so importing api.js
// doesn't trigger network or env-var validation.

vi.mock('./supabase', () => {
  // Build a thenable query-builder that resolves to { data, error: null }.
  const makeBuilder = (data) => {
    const resolved = Promise.resolve({ data, error: null })
    const builder = {
      select:  () => builder,
      order:   () => builder,
      eq:      () => builder,
      single:  () => resolved,
      // Make the builder itself awaitable so `await supabase.from(...).select(...)` works.
      then:    (res, rej) => resolved.then(res, rej),
      catch:   (rej)      => resolved.catch(rej),
      finally: (fn)       => resolved.finally(fn),
    }
    return builder
  }

  return {
    supabase: {
      auth: {
        getSession: () => Promise.resolve({ data: { session: null } }),
      },
      from: (table) => {
        if (table === 'festival_meta') return makeBuilder(MOCK_METAS)
        if (table === 'timetable_slots') return makeBuilder(MOCK_SLOTS)
        return makeBuilder([])
      },
    },
  }
})

import { fallbackDiscover } from './api'

// ─────────────────────────────────────────────────────────────────────────────
// fallbackDiscover(artists)
//
// Matches an artist list against every festival in Supabase and returns
// a list sorted descending by matchCount.
// ─────────────────────────────────────────────────────────────────────────────

describe('fallbackDiscover', () => {
  // ── Result shape ────────────────────────────────────────────────────────────
  test('returns one result per festival returned by Supabase', async () => {
    const results = await fallbackDiscover([])
    expect(results).toHaveLength(MOCK_METAS.length)
  })

  test('every result has the required fields', async () => {
    for (const r of await fallbackDiscover([])) {
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

  test('festivals with seeded slots report hasTimetable: true', async () => {
    const results = await fallbackDiscover([])
    results.forEach(r => expect(r.hasTimetable).toBe(true))
  })

  // ── Empty / unknown artists ─────────────────────────────────────────────────
  test('returns matchCount 0 for all festivals when the artist list is empty', async () => {
    const results = await fallbackDiscover([])
    results.forEach(r => expect(r.matchCount).toBe(0))
  })

  test('returns matchCount 0 everywhere for completely unknown artists', async () => {
    const results = await fallbackDiscover(['__phantom__', '__nobody__'])
    results.forEach(r => expect(r.matchCount).toBe(0))
  })

  // ── Sorting guarantee ───────────────────────────────────────────────────────
  test('result array is sorted descending by matchCount', async () => {
    // Match all three Alpha artists → Alpha scores higher than Beta.
    const results = await fallbackDiscover(['Radiohead', 'Bicep', 'Slowdive'])
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].matchCount).toBeGreaterThanOrEqual(results[i].matchCount)
    }
  })

  test('the first result always has the maximum matchCount', async () => {
    const results = await fallbackDiscover(['Radiohead', 'Bicep', 'Slowdive'])
    const max = Math.max(...results.map(r => r.matchCount))
    expect(results[0].matchCount).toBe(max)
  })

  // ── Artist matching ─────────────────────────────────────────────────────────
  test('matching is case-insensitive', async () => {
    const byOriginal = (await fallbackDiscover(['Radiohead'])).find(r => r.id === 'alpha').matchCount
    const byUpper    = (await fallbackDiscover(['RADIOHEAD'])).find(r => r.id === 'alpha').matchCount
    const byLower    = (await fallbackDiscover(['radiohead'])).find(r => r.id === 'alpha').matchCount

    expect(byUpper).toBe(byOriginal)
    expect(byLower).toBe(byOriginal)
  })

  test('matchedArtists includes artists present in that festival', async () => {
    const result = (await fallbackDiscover(['Radiohead'])).find(r => r.id === 'alpha')
    expect(result.matchedArtists).toContain('Radiohead')
    expect(result.matchCount).toBe(1)
  })

  test('matchedArtists does not include artists absent from a festival', async () => {
    const result = (await fallbackDiscover(['__not_in_any__'])).find(r => r.id === 'alpha')
    expect(result.matchedArtists).not.toContain('__not_in_any__')
  })

  test('matchedArtists only includes artists from that specific festival', async () => {
    // 'Gorillaz' is only in Beta, not Alpha.
    const alphaResult = (await fallbackDiscover(['Gorillaz'])).find(r => r.id === 'alpha')
    const betaResult  = (await fallbackDiscover(['Gorillaz'])).find(r => r.id === 'beta')
    expect(alphaResult.matchedArtists).not.toContain('Gorillaz')
    expect(betaResult.matchedArtists).toContain('Gorillaz')
  })

  test('totalKnownArtists equals the number of unique artists in the festival lineup', async () => {
    const results      = await fallbackDiscover([])
    const alphaResult  = results.find(r => r.id === 'alpha')
    const betaResult   = results.find(r => r.id === 'beta')
    expect(alphaResult.totalKnownArtists).toBe(3)  // Radiohead, Bicep, Slowdive
    expect(betaResult.totalKnownArtists).toBe(2)   // Gorillaz, Little Simz
  })

  test('multiple artist matches accumulate correctly', async () => {
    const result = (await fallbackDiscover(['Radiohead', 'Bicep'])).find(r => r.id === 'alpha')
    expect(result.matchCount).toBe(2)
    expect(result.matchedArtists).toContain('Radiohead')
    expect(result.matchedArtists).toContain('Bicep')
  })
})
