// spotify-auth.js
// Resolves a valid Spotify access token for a given Supabase user.
//
// ── Why this file exists ─────────────────────────────────────────────────────
// Supabase exposes session.provider_token immediately after OAuth, but the
// value disappears on the next page refresh.  We fix this by:
//   1. Storing both tokens + an expiry in the profiles table at login
//      (see AuthCallback.jsx).
//   2. Reading + auto-refreshing them here, so every Spotify API call gets a
//      fresh token regardless of how long ago the user logged in.
//
// ── Required env var ─────────────────────────────────────────────────────────
// VITE_SPOTIFY_CLIENT_ID — your Spotify app's Client ID.
//
//   1. Go to https://developer.spotify.com/dashboard and open your app.
//   2. Copy the "Client ID" value.
//   3. Add it to your .env file (create one if it doesn't exist):
//
//        VITE_SPOTIFY_CLIENT_ID=your_client_id_here
//
//   No Client Secret is needed: Supabase uses PKCE for its Spotify OAuth
//   integration, so refresh tokens are bound to the client ID alone.
//
//   ⚠️  If you ever switch to the non-PKCE Authorization Code flow (e.g. by
//   overriding Supabase's OAuth settings) the refresh call will require a
//   Client Secret.  In that case, move this refresh logic to a Supabase Edge
//   Function and keep SPOTIFY_CLIENT_SECRET server-side only.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from './supabase'

const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token'

// Treat tokens expiring within the next 2 minutes as already expired so we
// never hand a near-dead token to an API call that might take a few seconds.
const REFRESH_BUFFER_MS = 2 * 60 * 1000

/**
 * Returns a valid Spotify access token for `userId`.
 *
 * Flow:
 *   1. Read cached token + expiry from profiles.
 *   2. If still fresh (> 2 min remaining), return it immediately.
 *   3. Otherwise call Spotify's token endpoint with the stored refresh_token
 *      and VITE_SPOTIFY_CLIENT_ID (PKCE — no client secret needed).
 *   4. Write the new token + expiry back to profiles.
 *   5. Return the new access token.
 *
 * @param {string} userId  Supabase auth user ID (session.user.id)
 * @returns {Promise<string>} A valid Spotify access token
 * @throws  If no token is stored, the refresh fails, or the env var is missing
 */
export async function getValidSpotifyToken(userId) {
  if (!userId) throw new Error('getValidSpotifyToken: userId is required')

  // ── 1. Read cached tokens ─────────────────────────────────────────────────
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('spotify_access_token, spotify_refresh_token, spotify_token_expires_at')
    .eq('id', userId)
    .single()

  if (error) {
    throw new Error(`Could not load Spotify tokens from database: ${error.message}`)
  }

  const {
    spotify_access_token:     accessToken,
    spotify_refresh_token:    refreshToken,
    spotify_token_expires_at: expiresAt,
  } = profile

  if (!accessToken) {
    throw new Error(
      'No Spotify token found. Please sign out and reconnect your Spotify account.'
    )
  }

  // ── 2. Return early if still fresh ───────────────────────────────────────
  const expiresMs = expiresAt ? new Date(expiresAt).getTime() : 0
  if (expiresMs - Date.now() > REFRESH_BUFFER_MS) {
    return accessToken
  }

  // ── 3. Token is expired — refresh it ─────────────────────────────────────
  if (!refreshToken) {
    throw new Error(
      'Spotify token expired and no refresh token is stored. ' +
      'Please sign out and log in again to restore Spotify features.'
    )
  }

  const clientId = import.meta.env.VITE_SPOTIFY_CLIENT_ID
  if (!clientId) {
    throw new Error(
      'VITE_SPOTIFY_CLIENT_ID is not set.\n' +
      'Add it to your .env file:\n' +
      '  VITE_SPOTIFY_CLIENT_ID=your_spotify_client_id\n' +
      'Find it at https://developer.spotify.com/dashboard'
    )
  }

  const tokenRes = await fetch(SPOTIFY_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'refresh_token',
      refresh_token: refreshToken,
      client_id:     clientId,
    }),
  })

  if (!tokenRes.ok) {
    const detail = await tokenRes.text().catch(() => tokenRes.status)
    throw new Error(
      `Spotify token refresh failed (HTTP ${tokenRes.status}): ${detail}\n` +
      'If this keeps happening, try signing out and logging back in.'
    )
  }

  const tokens = await tokenRes.json()
  const newAccessToken  = tokens.access_token
  // Spotify may return a new refresh token; if not, keep the existing one.
  const newRefreshToken = tokens.refresh_token ?? refreshToken
  const newExpiresAt    = new Date(
    Date.now() + (tokens.expires_in ?? 3600) * 1000
  ).toISOString()

  // ── 4. Persist refreshed tokens ───────────────────────────────────────────
  const { error: updateError } = await supabase
    .from('profiles')
    .update({
      spotify_access_token:     newAccessToken,
      spotify_refresh_token:    newRefreshToken,
      spotify_token_expires_at: newExpiresAt,
    })
    .eq('id', userId)

  if (updateError) {
    // Non-fatal: the token is still valid for this session even if we couldn't
    // persist it.  Log the error so it shows up in the console.
    console.warn('[festplan] Could not persist refreshed Spotify token:', updateError.message)
  }

  // ── 5. Return fresh token ─────────────────────────────────────────────────
  return newAccessToken
}
