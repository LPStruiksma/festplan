import { describe, it, expect, vi } from 'vitest'

// SchedulePage pulls in Supabase-backed modules at import time; stub them so
// only the pure playlist builder is exercised.
vi.mock('../lib/supabase', () => ({ supabase: {} }))
vi.mock('../lib/spotify-auth', () => ({ getValidSpotifyToken: vi.fn() }))
vi.mock('../lib/schedule-store', () => ({}))
vi.mock('../lib/invites', () => ({}))
vi.mock('../lib/realtime', () => ({ useGroupSync: vi.fn(), useFriendsSync: vi.fn() }))
vi.mock('../lib/api', () => ({ fetchTimetable: vi.fn() }))

const { createSchedulePlaylist } = await import('./SchedulePage')

const fest = { name: 'Lowlands' }
const schedule = [
  { artist: 'Bicep',   day: 1, start: '20:00', end: '21:00' },
  { artist: 'Fontaines D.C.', day: 0, start: '18:00', end: '19:00' },
  { artist: 'Bicep',   day: 2, start: '22:00', end: '23:00' },
]

const json = (status, body = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => body })

// Routes each request by method + path; records every call for assertions.
function mockSpotify(routes) {
  const calls = []
  const fetchImpl = vi.fn(async (url, opts = {}) => {
    const path = url.replace('https://api.spotify.com/v1', '')
    const method = opts.method || 'GET'
    calls.push({ method, path, opts })
    for (const [test, respond] of routes) {
      if (test(method, path)) return respond(method, path, opts)
    }
    return json(404)
  })
  return { fetchImpl, calls }
}

const isSearch = (m, p) => m === 'GET' && p.startsWith('/search?')
const searchArtist = p => new URLSearchParams(p.split('?')[1]).get('q')

describe('createSchedulePlaylist', () => {
  it('searches one track per unique artist, creates via /me/playlists and adds via /items', async () => {
    const { fetchImpl, calls } = mockSpotify([
      [isSearch, (m, p) => json(200, { tracks: { items: [{ uri: `spotify:track:${searchArtist(p).length}` }] } })],
      [(m, p) => m === 'POST' && p === '/me/playlists', () => json(201, { id: 'pl1', external_urls: { spotify: 'https://open.spotify.com/playlist/pl1' } })],
      [(m, p) => m === 'POST' && p === '/playlists/pl1/items', () => json(201, { snapshot_id: 's' })],
    ])

    const res = await createSchedulePlaylist({ token: 'tok', fest, schedule, fetchImpl })

    expect(res).toMatchObject({ ok: true, count: 2, url: 'https://open.spotify.com/playlist/pl1' })
    expect(res.message).toBe('Playlist created — 2 tracks added!')

    const searches = calls.filter(c => isSearch(c.method, c.path))
    expect(searches.map(c => searchArtist(c.path))).toEqual(['artist:"Fontaines D.C."', 'artist:"Bicep"'])
    for (const c of searches) {
      const q = new URLSearchParams(c.path.split('?')[1])
      expect(q.get('type')).toBe('track')
      expect(q.get('limit')).toBe('1')
    }

    expect(calls.some(c => c.path.includes('top-tracks'))).toBe(false)
    expect(calls.some(c => c.path.startsWith('/users/'))).toBe(false)
    expect(calls.some(c => c.path.endsWith('/tracks'))).toBe(false)

    const add = calls.find(c => c.path === '/playlists/pl1/items')
    expect(JSON.parse(add.opts.body).uris).toHaveLength(2)
    expect(add.opts.headers.Authorization).toBe('Bearer tok')
    const create = calls.find(c => c.path === '/me/playlists')
    expect(JSON.parse(create.opts.body)).toMatchObject({ name: 'Lowlands — My Picks', public: false })
  })

  it('reports artists without a match in the success message', async () => {
    const { fetchImpl } = mockSpotify([
      [isSearch, (m, p) => json(200, { tracks: { items: searchArtist(p).includes('Bicep') ? [{ uri: 'spotify:track:b' }] : [] } })],
      [(m, p) => p === '/me/playlists', () => json(201, { id: 'pl2' })],
      [(m, p) => p === '/playlists/pl2/items', () => json(201, {})],
    ])
    const res = await createSchedulePlaylist({ token: 't', fest, schedule, fetchImpl })
    expect(res.ok).toBe(true)
    expect(res.message).toBe('Playlist created — 1 tracks added (no match for 1 artist).')
  })

  it('explains a 403 from playlist creation instead of a generic error', async () => {
    const { fetchImpl, calls } = mockSpotify([
      [isSearch, () => json(200, { tracks: { items: [{ uri: 'spotify:track:x' }] } })],
      [(m, p) => p === '/me/playlists', () => json(403, { error: { status: 403 } })],
    ])
    const res = await createSchedulePlaylist({ token: 't', fest, schedule, fetchImpl })
    expect(res.ok).toBe(false)
    expect(res.error.status).toBe(403)
    expect(res.message).toMatch(/refused this request \(403\)/)
    expect(res.message).toMatch(/Development Mode/)
    expect(calls.some(c => c.path.includes('/items'))).toBe(false)
  })

  it('surfaces a 403 on every search as the 403 message, not "no tracks"', async () => {
    const { fetchImpl, calls } = mockSpotify([[isSearch, () => json(403)]])
    const res = await createSchedulePlaylist({ token: 't', fest, schedule, fetchImpl })
    expect(res.ok).toBe(false)
    expect(res.message).toMatch(/\(403\)/)
    expect(calls.some(c => c.method === 'POST')).toBe(false)
  })

  it('says plainly when Spotify finds no tracks, and creates nothing', async () => {
    const { fetchImpl, calls } = mockSpotify([[isSearch, () => json(200, { tracks: { items: [] } })]])
    const res = await createSchedulePlaylist({ token: 't', fest, schedule, fetchImpl })
    expect(res.ok).toBe(false)
    expect(res.message).toBe('Spotify found no tracks for any of your 2 scheduled artists, so no playlist was created.')
    expect(res.message).not.toMatch(/region/)
    expect(calls.some(c => c.method === 'POST')).toBe(false)
  })

  it('turns a network failure into a message and never throws', async () => {
    const fetchImpl = vi.fn(async () => { throw new TypeError('Failed to fetch') })
    const res = await createSchedulePlaylist({ token: 't', fest, schedule, fetchImpl })
    expect(res.ok).toBe(false)
    expect(res.message).toMatch(/Couldn't reach Spotify/)
  })
})
