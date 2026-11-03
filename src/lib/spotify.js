// All Spotify API calls go through this file.
//
// Each function now takes a `userId` (Supabase auth user ID) instead of a raw
// access token.  The token is resolved — and silently refreshed if expired —
// inside getValidSpotifyToken() in ./spotify-auth.js.
//
// This means Spotify features keep working after a page refresh, which was
// impossible when the token came from session.provider_token (only available
// immediately after OAuth).

import { getValidSpotifyToken } from './spotify-auth'

const API = 'https://api.spotify.com/v1'

// Helper: make an authenticated call to the Spotify API.
// accessToken is resolved by the caller before this function runs.
async function spotifyFetch(endpoint, accessToken) {
  const res = await fetch(`${API}${endpoint}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  })
  if (res.status === 401) throw new Error('Spotify token expired. Please log in again.')
  if (!res.ok) {
    const err = new Error(`Spotify API error: ${res.status}`)
    err.status = res.status
    throw err
  }
  return res.json()
}

// Get the user's top 50 artists (based on medium-term listening history)
export async function getTopArtists(userId) {
  const token = await getValidSpotifyToken(userId)
  const data = await spotifyFetch(
    '/me/top/artists?limit=50&time_range=medium_term',
    token
  )
  return data.items.map(a => a.name)
}

// Get artists from the user's liked songs (up to 50 tracks)
export async function getLikedSongArtists(userId) {
  const token = await getValidSpotifyToken(userId)
  const data = await spotifyFetch('/me/tracks?limit=50', token)
  const artists = data.items
    .filter(item => item.track)
    .flatMap(item => item.track.artists.map(a => a.name))
  return [...new Set(artists)]
}

// Get the user's playlists (name, id, track count, cover image).
// Spotify's February 2026 migration renamed the playlist's `tracks` count
// object to `items`; read the new name first and fall back to the old one.
export async function getPlaylists(userId) {
  const token = await getValidSpotifyToken(userId)
  const data = await spotifyFetch('/me/playlists?limit=50', token)
  return data.items
    .filter(p => p) // remove any nulls
    .map(p => ({
      id: p.id,
      name: p.name,
      trackCount: p.items?.total ?? p.tracks?.total ?? 0,
      image: p.images?.[0]?.url ?? null
    }))
}

// Get all artists from a specific playlist (up to 100 items).
// Since Spotify's February 2026 migration this is /playlists/{id}/items (was
// /tracks), each entry holds the track under `item` (was `track`), and
// Spotify only serves playlists the user owns or collaborates on (403 otherwise).
export const PLAYLIST_NOT_OWNED_MESSAGE =
  'Spotify only lets FestPlan read playlists you own or collaborate on. ' +
  'Pick one of your own playlists, or copy this one to your library first.'

export async function getPlaylistArtists(userId, playlistId) {
  const token = await getValidSpotifyToken(userId)
  let data
  try {
    data = await spotifyFetch(
      `/playlists/${encodeURIComponent(playlistId)}/items?limit=100`,
      token
    )
  } catch (err) {
    if (err.status === 403) throw new Error(PLAYLIST_NOT_OWNED_MESSAGE)
    throw err
  }
  const artists = (data.items ?? [])
    .map(entry => entry?.item ?? entry?.track)
    .filter(track => track?.artists)
    .flatMap(track => track.artists.map(a => a.name))
  return [...new Set(artists)]
}

// Main function: combine top artists + liked songs into one deduplicated list.
// Top artists come first (they're the strongest signal of taste).
export async function getAllUserArtists(userId) {
  const [topArtists, likedArtists] = await Promise.all([
    getTopArtists(userId),
    getLikedSongArtists(userId)
  ])

  const combined = [...topArtists]
  for (const artist of likedArtists) {
    const alreadyIn = combined.some(
      a => a.toLowerCase() === artist.toLowerCase()
    )
    if (!alreadyIn) combined.push(artist)
  }

  return combined
}
