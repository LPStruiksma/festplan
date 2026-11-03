import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('./supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(() => Promise.resolve({ data: { session: { access_token: 'jwt-admin' } } })),
    },
  },
}))

import {
  notYetIngested,
  ingestRequestBody,
  discoverFestivalsLive,
  ingestDiscoveredFestival,
} from './admin-api'

const discovered = [
  { id: 'alpha-fest', name: 'Alpha Fest 2026', tmEventIds: ['A1'] },
  { id: 'beta-fest',  name: 'Beta Fest 2026',  tmEventIds: ['B1', 'B2', 'B3'] },
  { id: 'gamma-fest', name: 'Gamma Fest 2026', tmEventIds: ['G1'] },
  { id: 'delta-fest', name: 'Delta Fest 2026', tmEventIds: [] },
  { id: 'eps-fest',   name: 'Eps Fest 2026' },
]

describe('notYetIngested', () => {
  test('keeps only discovered festivals whose key is not in festival_meta', () => {
    const rows = [{ festival_key: 'alpha-fest' }, { festival_key: 'gamma-fest' }]
    expect(notYetIngested(discovered, rows).map(f => f.id)).toEqual(['beta-fest'])
  })

  test('drops festivals without Ticketmaster event IDs (nothing to ingest)', () => {
    expect(notYetIngested(discovered, []).map(f => f.id))
      .toEqual(['alpha-fest', 'beta-fest', 'gamma-fest'])
  })

  test('handles missing inputs', () => {
    expect(notYetIngested(null, null)).toEqual([])
    expect(notYetIngested(undefined, [{ festival_key: 'x' }])).toEqual([])
  })
})

describe('ingestRequestBody', () => {
  test('sends every known event ID and pins the slug to the discovered key', () => {
    expect(ingestRequestBody(discovered[1])).toEqual({
      eventIds:     ['B1', 'B2', 'B3'],
      festivalSlug: 'beta-fest',
    })
  })

  test('a single-day festival still uses the multi-day shape, so the key matches', () => {
    expect(ingestRequestBody(discovered[0])).toEqual({
      eventIds:     ['A1'],
      festivalSlug: 'alpha-fest',
    })
  })
})

describe('edge function calls', () => {
  let fetchMock

  beforeEach(() => {
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key')
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  test('ingestDiscoveredFestival posts the request body with the admin JWT', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, festivalKey: 'beta-fest' }) })

    const result = await ingestDiscoveredFestival(discovered[1])

    expect(result).toEqual({ ok: true, festivalKey: 'beta-fest' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toMatch(/\/functions\/v1\/ingest-festival-timetable$/)
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer jwt-admin')
    expect(JSON.parse(init.body)).toEqual({ eventIds: ['B1', 'B2', 'B3'], festivalSlug: 'beta-fest' })
  })

  test('ingestDiscoveredFestival throws the server error message', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403, json: () => Promise.resolve({ error: 'Forbidden — admin only' }) })
    await expect(ingestDiscoveredFestival(discovered[0])).rejects.toThrow('Forbidden — admin only')
  })

  test('ingestDiscoveredFestival refuses a festival without event IDs and sends nothing', async () => {
    await expect(ingestDiscoveredFestival(discovered[3])).rejects.toThrow(/event ID/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('discoverFestivalsLive posts the artists and returns the festivals', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ festivals: discovered }) })

    const result = await discoverFestivalsLive(['Radiohead', 'Bicep'])

    expect(result).toBe(discovered)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toMatch(/\/functions\/v1\/discover-festivals$/)
    expect(JSON.parse(init.body)).toEqual({ artists: ['Radiohead', 'Bicep'] })
  })

  test('discoverFestivalsLive throws instead of falling back on an error', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503, json: () => Promise.resolve({ error: 'TICKETMASTER_API_KEY not configured' }) })
    await expect(discoverFestivalsLive(['Radiohead'])).rejects.toThrow('TICKETMASTER_API_KEY not configured')
  })
})
