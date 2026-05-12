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
// ── Refresh flow ──────────────────────────────────────────────────────────────
// Token refreshes are handled by the `refresh-spotify-token` Supabase Edge
// Function, which keeps the Spotify client secret server-side and performs the
// Basic-auth token exchange on behalf of the caller.
//
//   supabase functions deploy refresh-spotify-token
//   supabase secrets set SPOTIFY_CLIENT_ID=<id> SPOTIFY_CLIENT_SECRET=<secret>
//
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from './supabase'

// Treat tokens expiring within the next 60 seconds as already expired so we
// never hand a near-dead token to an API call that might take a few seconds.
const REFRESH_BUFFER_MS = 60 * 1000

/**
 * Returns a valid Spotify access token for `userId`.
 *
 * Flow:
 *   1. Read cached token + expiry from profiles.
 *   2. If still fresh (> 60 s remaining), return it immediately.
 *   3. Otherwise invoke the `refresh-spotify-token` Edge Function, which:
 *        a. Reads the stored refresh_token from the caller's profile.
 *        b. Exchanges it at Spotify's token endpoint (server-side, Basic auth).
 *        c. Persists and returns the new access_token + expires_at.
 *   4. Return the fresh access token.
 *
 * @param {string} userId  Supabase auth user ID (session.user.id)
 * @returns {Promise<string>} A valid Spotify access token
 * @throws  If no token is stored, the session is invalid, or the refresh fails
 */
export async function getValidSpotifyToken(userId) {
  if (!userId) throw new Error('getValidSpotifyToken: userId is required')

  // ── 1. Read cached token + expiry ─────────────────────────────────────────
  // maybeSingle() returns null data (not an error) when the profile row doesn't
  // exist yet, avoiding the "cannot coerce to single object" PGRST116 error.
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('spotify_access_token, spotify_token_expires_at')
    .eq('id', userId)
    .maybeSingle()

  if (error) {
    throw new Error(`Could not load Spotify tokens from database: ${error.message}`)
  }

  const accessToken = profile?.spotify_access_token     ?? null
  const expiresAt   = profile?.spotify_token_expires_at ?? null

  if (!accessToken) {
    throw new Error(
      'No Spotify token found — please sign out and sign back in to reconnect Spotify.'
    )
  }

  // ── 2. Return early if still fresh ────────────────────────────────────────
  const expiresMs = expiresAt ? new Date(expiresAt).getTime() : 0
  if (expiresMs - Date.now() > REFRESH_BUFFER_MS) {
    return accessToken
  }

  // ── 3. Token is expired (or expiring) — call the Edge Function ────────────
  // The function validates the caller's session JWT, reads their refresh token,
  // exchanges it at Spotify, persists the result, and returns the new tokens.
  const { data, error: fnError } = await supabase.functions.invoke(
    'refresh-spotify-token'
  )

  if (fnError) {
    throw new Error(
      `Spotify token refresh failed: ${fnError.message || fnError}\n` +
      'If this keeps happening, try signing out and logging back in.'
    )
  }

  // The edge function returns { access_token, expires_at } on success.
  // It also returns a structured error body for non-2xx responses; surface it.
  if (!data?.access_token) {
    const detail = data?.error ?? 'No access_token in response'
    throw new Error(
      `Spotify token refresh failed: ${detail}\n` +
      'If this keeps happening, try signing out and logging back in.'
    )
  }

  // ── 4. Return the fresh token ──────────────────────────────────────────────
  return data.access_token
}
