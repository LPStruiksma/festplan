import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

// Spotify's February 2026 Development Mode migration renamed the playlist
// track endpoint to /playlists/{id}/items, renamed the playlist's `tracks`
// count object to `items`, and only serves items for playlists the user owns
// or collaborates on (festplan#31, unit B).

vi.mock('./spotify-auth', () => ({
  getValidSpotifyToken: vi.fn(() => Promise.resolve('token-1')),
}))

import { getPlaylists, getPlaylistArtists } from './spotify'

function jsonResponse(body, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  })
}

beforeEach(() => {
  globalThis.fetch = vi.fn()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('getPlaylists', () => {
  it('reads the renamed items.total count', async () => {
    fetch.mockReturnValue(jsonResponse({
      items: [{ id: 'p1', name: 'Mine', items: { total: 12 }, images: [{ url: 'img' }] }],
    }))
    await expect(getPlaylists('u1')).resolves.toEqual([
      { id: 'p1', name: 'Mine', trackCount: 12, image: 'img' },
    ])
  })

  it('falls back to the old tracks.total, then to 0', async () => {
    fetch.mockReturnValue(jsonResponse({
      items: [
        { id: 'p1', name: 'Old', tracks: { total: 7 }, images: [] },
        { id: 'p2', name: 'None' },
        null,
      ],
    }))
    const lists = await getPlaylists('u1')
    expect(lists.map(p => p.trackCount)).toEqual([7, 0])
    expect(lists[1].image).toBeNull()
  })
})

describe('getPlaylistArtists', () => {
  it('calls /playlists/{id}/items and dedupes artists from item or track', async () => {
    fetch.mockReturnValue(jsonResponse({
      items: [
        { item: { artists: [{ name: 'A' }, { name: 'B' }] } },
        { track: { artists: [{ name: 'A' }] } },
        { item: null },
      ],
    }))
    await expect(getPlaylistArtists('u1', 'p1')).resolves.toEqual(['A', 'B'])
    const url = fetch.mock.calls[0][0]
    expect(url).toMatch(/\/playlists\/p1\/items\?/)
    expect(url).not.toMatch(/\/tracks/)
  })

  it('gives a clear message when Spotify refuses a playlist the user does not own', async () => {
    fetch.mockReturnValue(jsonResponse({ error: { status: 403 } }, 403))
    await expect(getPlaylistArtists('u1', 'p1')).rejects.toThrow(
      /only lets FestPlan read playlists you own or collaborate on/
    )
  })
})
