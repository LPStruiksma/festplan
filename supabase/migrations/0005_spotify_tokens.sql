-- =============================================================================
-- Migration : 0005_spotify_tokens
-- Purpose   : Persist Spotify access + refresh tokens to the profiles table so
--             the Spotify Playlist feature survives page refreshes.
--
--             Supabase only exposes session.provider_token in the moments
--             immediately after OAuth — that window closes on the next page
--             navigation.  This migration adds three columns so the frontend
--             can store and silently refresh the tokens without asking the user
--             to re-login.
--
-- See also  :
--   • src/lib/spotify-auth.js  — getValidSpotifyToken(userId), refresh logic
--   • src/pages/AuthCallback.jsx — captures tokens right after login
-- =============================================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS spotify_access_token     TEXT,
  ADD COLUMN IF NOT EXISTS spotify_refresh_token    TEXT,
  ADD COLUMN IF NOT EXISTS spotify_token_expires_at TIMESTAMPTZ;

COMMENT ON COLUMN public.profiles.spotify_access_token
  IS 'Current Spotify access token; written at login and refreshed automatically when expired.';

COMMENT ON COLUMN public.profiles.spotify_refresh_token
  IS 'Spotify refresh token stored at login; used to obtain a new access token without re-login.';

COMMENT ON COLUMN public.profiles.spotify_token_expires_at
  IS 'Expiry timestamp of the current access token. Frontend refreshes when within 2 minutes of this.';

-- ---------------------------------------------------------------------------
-- No RLS changes needed: the existing "profiles: owner can update own row"
-- policy already covers these new columns — any UPDATE WHERE id = auth.uid()
-- is permitted.  The trigger-created INSERT at sign-up leaves the columns
-- NULL; AuthCallback fills them in on the same request, using UPDATE.
-- ---------------------------------------------------------------------------
