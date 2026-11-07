import { describe, test, expect, vi } from 'vitest'

// ── Test fixtures (hoisted so they're accessible inside vi.mock) ──────────────
//
// vi.mock factories are hoisted to the top of the file by Vitest, which means
// they run before any top-level const declarations.  vi.hoisted() lifts these
// fixtures to the same level so the mock factory can reference them.

const { MOCK_METAS, MOCK_SLOTS, queryResponses } = vi.hoisted(() => {
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

  // A per-query override can return an explicit { data, error } or throw/reject.
  const queryResponses = { festival_meta: null, timetable_slots: null }
  return { MOCK_METAS, MOCK_SLOTS, queryResponses }
})

// ── Supabase mock ─────────────────────────────────────────────────────────────
// supabase.js calls createClient() at import time and throws when env vars are
// absent.  We replace the whole module with a minimal stub so importing api.js
// doesn't trigger network or env-var validation.

vi.mock('./supabase', () => {
  // Resolve on each await so tests exercise the exported helper against
  // independent festival_meta / timetable_slots failures without network calls.
  const makeBuilder = (table, data) => {
    const resolveQuery = () => {
      const override = queryResponses[table]
      return typeof override === 'function' ? override() : override ?? { data, error: null }
    }
    const resolved = () => Promise.resolve().then(resolveQuery)
    const builder = {
      select:  () => builder,
      order:   () => builder,
      eq:      () => builder,
      single:  () => resolved(),
      maybeSingle: () => resolved(),
      // Make the builder itself awaitable so `await supabase.from(...).select(...)` works.
      then:    (res, rej) => resolved().then(res, rej),
      catch:   (rej)      => resolved().catch(rej),
      finally: (fn)       => resolved().finally(fn),
    }
    return builder
  }

  return {
    supabase: {
      auth: {
        getSession: () => Promise.resolve({ data: { session: null } }),
      },
      from: (table) => {
        if (table === 'festival_meta') return makeBuilder(table, MOCK_METAS)
        if (table === 'timetable_slots') return makeBuilder(table, MOCK_SLOTS)
        return makeBuilder(table, [])
      },
    },
  }
})

import { fallbackDiscover, fetchAllFestivals, fetchTimetable, artistCache } from './api'

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

// festplan#31 unit C: the related-artist recommender depended on Spotify's
// Related Artists endpoint, which Development Mode apps can't call. The edge
// function and its client were removed rather than left failing.
describe('recommend-festivals removal', () => {
  test('api.js has no recommendFestivals client and the edge function is gone', async () => {
    const { readFileSync, existsSync } = await import('node:fs')
    const { join } = await import('node:path')
    const root = join(import.meta.dirname, '..', '..')
    const api = await import('./api.js')
    expect(api.recommendFestivals).toBeUndefined()
    expect(readFileSync(join(root, 'src', 'lib', 'api.js'), 'utf8')).not.toContain('recommend-festivals')
    expect(existsSync(join(root, 'supabase', 'functions', 'recommend-festivals'))).toBe(false)
  })
})

 
// #66: a real failed Supabase list request must reject, not masquerade as [].
// These cases call the exported helper, rather than mocking it at SetupPage.
describe('fetchAllFestivals query contract', () => {
  beforeEach(() => {
    queryResponses.festival_meta = null
    queryResponses.timetable_slots = null
  })

  test('rejects a thrown festival_meta transport failure', async () => {
    const failure = new Error('transport unavailable')
    queryResponses.festival_meta = () => { throw failure }
    await expect(fetchAllFestivals()).rejects.toBe(failure)
  })

  test('rejects a rejected timetable_slots transport request', async () => {
    const failure = new Error('slots connection lost')
    queryResponses.timetable_slots = () => Promise.reject(failure)
    await expect(fetchAllFestivals()).rejects.toBe(failure)
  })

  test('propagates an explicit festival_meta query error', async () => {
    const failure = { message: 'festival_meta permission denied', code: '42501' }
    queryResponses.festival_meta = { data: null, error: failure }
    await expect(fetchAllFestivals()).rejects.toBe(failure)
  })

  test('propagates an explicit timetable_slots query error', async () => {
    const failure = { message: 'timetable_slots unavailable', code: '08006' }
    queryResponses.timetable_slots = { data: null, error: failure }
    await expect(fetchAllFestivals()).rejects.toBe(failure)
  })

  test('rejects malformed response instead of interpreting missing data as an empty list', async () => {
    queryResponses.festival_meta = { data: null, error: null }
    await expect(fetchAllFestivals()).rejects.toThrow('invalid Supabase query response')
  })

  test('resolves [] for successful empty festival metadata', async () => {
    queryResponses.festival_meta = { data: [], error: null }
    queryResponses.timetable_slots = { data: [], error: null }
    await expect(fetchAllFestivals()).resolves.toEqual([])
  })

  test('maps successful festivals and hydrates the deduplicated sorted artist cache', async () => {
    queryResponses.festival_meta = { data: [MOCK_METAS[0]], error: null }
    queryResponses.timetable_slots = {
      data: [{ artist: 'Slowdive' }, { artist: 'Bicep' }, { artist: 'Slowdive' }],
      error: null,
    }
    await expect(fetchAllFestivals()).resolves.toEqual([{
      id: 'alpha',
      name: 'Alpha Fest 2026',
      location: 'Alphaville',
      emoji: '🎪',
      days: ['Fri Jun 5', 'Sat Jun 6'],
      startDate: '2026-06-05',
      endDate: '2026-06-06',
      accentColor: '#ff0000',
      stages: ['Main Stage', 'Side Stage'],
      hasTimetable: true,
    }])
    expect(artistCache).toEqual(['Bicep', 'Slowdive'])
  })
})

// U9: timetable transport/query errors cannot masquerade as a missing festival
// or an unpublished timetable. These tests invoke the exported real helper.
describe('fetchTimetable error vs absence contract', () => {
  beforeEach(() => {
    queryResponses.festival_meta = null
    queryResponses.timetable_slots = null
  })

  test('propagates a rejected festival metadata transport request', async () => {
    const failure = new Error('synthetic metadata transport failure')
    queryResponses.festival_meta = () => Promise.reject(failure)
    await expect(fetchTimetable('alpha')).rejects.toBe(failure)
  })

  test('propagates an explicit metadata permission error', async () => {
    const failure = { code: '42501', message: 'synthetic permission failure' }
    queryResponses.festival_meta = { data: null, error: failure }
    await expect(fetchTimetable('alpha')).rejects.toBe(failure)
  })

  test('propagates a thrown timetable slots transport request', async () => {
    const failure = new Error('synthetic slots transport failure')
    queryResponses.festival_meta = { data: MOCK_METAS[0], error: null }
    queryResponses.timetable_slots = () => { throw failure }
    await expect(fetchTimetable('alpha')).rejects.toBe(failure)
  })

  test('propagates an explicit timetable slots error', async () => {
    const failure = { code: '08006', message: 'synthetic slots failure' }
    queryResponses.festival_meta = { data: MOCK_METAS[0], error: null }
    queryResponses.timetable_slots = { data: null, error: failure }
    await expect(fetchTimetable('alpha')).rejects.toBe(failure)
  })

  test('resolves null only when metadata is genuinely absent with no query error', async () => {
    queryResponses.festival_meta = { data: null, error: null }
    await expect(fetchTimetable('does-not-exist')).resolves.toBeNull()
  })

  test('accepts a seeded festival with a genuinely empty, successful slot list', async () => {
    queryResponses.festival_meta = { data: MOCK_METAS[0], error: null }
    queryResponses.timetable_slots = { data: [], error: null }
    const result = await fetchTimetable('alpha')
    expect(result.festival.name).toBe('Alpha Fest 2026')
    expect(result.festival.hasTimetable).toBe(false)
    expect(result.festival.lineup).toEqual([])
  })

  test('rejects malformed slots data instead of silently reporting no timetable', async () => {
    queryResponses.festival_meta = { data: MOCK_METAS[0], error: null }
    queryResponses.timetable_slots = { data: null, error: null }
    await expect(fetchTimetable('alpha')).rejects.toThrow('invalid Supabase query response')
  })
})
