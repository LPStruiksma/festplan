// supabase/functions/refresh-spotify-token/index.ts
//
// Silently refreshes a user's Spotify access token using the stored
// refresh_token, then persists the new tokens back to their profile row.
//
// Called by src/lib/spotify-auth.js via supabase.functions.invoke()
// whenever the cached access token is within 60 s of expiry.
//
// ── Environment variables required ───────────────────────────────────────────
//   SPOTIFY_CLIENT_ID      — your Spotify app client ID
//   SPOTIFY_CLIENT_SECRET  — your Spotify app client secret
//
//   Set them with:
//     supabase secrets set SPOTIFY_CLIENT_ID=<id> SPOTIFY_CLIENT_SECRET=<secret>
//
//   SUPABASE_URL and SUPABASE_ANON_KEY are injected automatically by the
//   Supabase runtime; you do NOT need to set them.
//
// ── Auth flow ────────────────────────────────────────────────────────────────
//   1. Extract the caller's Supabase JWT from the Authorization header.
//   2. Validate it with auth.getUser() to get a trusted user_id.
//   3. Read spotify_refresh_token from their profiles row (RLS-protected).
//   4. Exchange it at Spotify's token endpoint using HTTP Basic auth.
//   5. Update profiles with the new access_token, expires_at, and
//      refresh_token (if Spotify rotated it).
//   6. Return { access_token, expires_at } to the caller.
// ─────────────────────────────────────────────────────────────────────────────

import { serve }        from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, jsonResponse } from '../_shared/cors.ts'

const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token'

serve(async (req: Request) => {
  // ── Preflight ───────────────────────────────────────────────────────────────
  const corsRes = handleCors(req)
  if (corsRes) return corsRes

  // ── 1. Validate the caller's JWT ───────────────────────────────────────────
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return jsonResponse({ error: 'Missing Authorization header' }, 401)
  }

  // A user-scoped client so RLS applies when we read/write profiles.
  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  )

  const { data: { user }, error: authError } = await userClient.auth.getUser()
  if (authError || !user) {
    return jsonResponse({ error: 'Invalid or expired session token' }, 401)
  }
  const userId = user.id

  // ── 2. Read the stored Spotify refresh token ───────────────────────────────
  const { data: profile, error: profileError } = await userClient
    .from('profiles')
    .select('spotify_refresh_token')
    .eq('id', userId)
    .maybeSingle()

  if (profileError) {
    console.error('refresh-spotify-token: profile read error:', profileError.message)
    return jsonResponse({ error: 'Could not read Spotify tokens from database' }, 500)
  }

  const refreshToken = profile?.spotify_refresh_token ?? null
  if (!refreshToken) {
    return jsonResponse(
      { error: 'No Spotify refresh token found — please sign out and reconnect Spotify.' },
      422
    )
  }

  // ── 3. Read client credentials from environment ────────────────────────────
  const clientId     = Deno.env.get('SPOTIFY_CLIENT_ID')
  const clientSecret = Deno.env.get('SPOTIFY_CLIENT_SECRET')

  if (!clientId || !clientSecret) {
    console.error('refresh-spotify-token: SPOTIFY_CLIENT_ID or SPOTIFY_CLIENT_SECRET not set')
    return jsonResponse(
      { error: 'Spotify client credentials are not configured on the server.' },
      503
    )
  }

  // ── 4. POST to Spotify's token endpoint ───────────────────────────────────
  //   Basic auth: base64(client_id:client_secret)
  const credentials = btoa(`${clientId}:${clientSecret}`)

  const tokenRes = await fetch(SPOTIFY_TOKEN_URL, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/x-www-form-urlencoded',
      'Authorization': `Basic ${credentials}`,
    },
    body: new URLSearchParams({
      grant_type:    'refresh_token',
      refresh_token: refreshToken,
      client_id:     clientId,
    }),
  })

  if (!tokenRes.ok) {
    const detail = await tokenRes.text().catch(() => String(tokenRes.status))
    console.error(`refresh-spotify-token: Spotify returned ${tokenRes.status}:`, detail)
    return jsonResponse(
      { error: `Spotify token refresh failed (HTTP ${tokenRes.status}). ` +
               'If this persists, sign out and reconnect Spotify.' },
      502
    )
  }

  const tokens = await tokenRes.json()
  const newAccessToken   = tokens.access_token as string
  // Spotify may rotate the refresh token; fall back to the existing one if not.
  const newRefreshToken  = (tokens.refresh_token as string | undefined) ?? refreshToken
  const newExpiresAt     = new Date(
    Date.now() + ((tokens.expires_in as number | undefined) ?? 3600) * 1000
  ).toISOString()

  // ── 5. Persist the refreshed tokens ───────────────────────────────────────
  const { error: updateError } = await userClient
    .from('profiles')
    .update({
      spotify_access_token:     newAccessToken,
      spotify_refresh_token:    newRefreshToken,
      spotify_token_expires_at: newExpiresAt,
    })
    .eq('id', userId)

  if (updateError) {
    // Non-fatal: the token is valid for this session even if persistence failed.
    console.warn('refresh-spotify-token: failed to persist tokens:', updateError.message)
  }

  // ── 6. Return fresh credentials to the caller ─────────────────────────────
  return jsonResponse({ access_token: newAccessToken, expires_at: newExpiresAt })
})
