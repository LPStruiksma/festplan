import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

// This page exists solely to catch the redirect back from Spotify.
// Supabase sends the user here with a short-lived code in the URL.
//
// On a successful sign-in we do two things before redirecting:
//   1. Persist the Spotify access + refresh tokens to the profiles table.
//      This is the only moment Supabase exposes session.provider_token and
//      session.provider_refresh_token — they're gone after the next navigation.
//      Storing them here lets the app call the Spotify API on any future visit
//      without asking the user to log in again.
//   2. Redirect to the right destination:
//        • If there's a pending invite slug in localStorage  → /join/<slug>
//        • Otherwise                                         → /setup

function getRedirectTarget() {
  const pendingSlug = localStorage.getItem('festplan_pending_invite')
  return pendingSlug ? `/join/${pendingSlug}` : '/setup'
}

/**
 * Upserts Spotify tokens into the user's profile row.
 * Safe to call on every login — uses UPDATE so it never races with the
 * auto-create trigger that already inserted the row.
 */
async function persistSpotifyTokens(session) {
  const userId       = session?.user?.id
  const accessToken  = session?.provider_token
  const refreshToken = session?.provider_refresh_token  // may be null for re-logins

  if (!userId || !accessToken) return  // nothing to persist

  // Spotify access tokens are valid for 3,600 seconds.  Store the expiry so
  // getValidSpotifyToken() knows when to refresh without an extra round-trip.
  const expiresAt = new Date(Date.now() + 3600 * 1000).toISOString()

  const { error } = await supabase
    .from('profiles')
    .update({
      spotify_access_token:     accessToken,
      // Only overwrite the refresh token if Spotify gave us one.
      // Re-logins sometimes omit it; keeping the old one is safer than nulling it.
      ...(refreshToken ? { spotify_refresh_token: refreshToken } : {}),
      spotify_token_expires_at: expiresAt,
    })
    .eq('id', userId)

  if (error) {
    // Non-fatal — the user can still browse, but Spotify features may ask them
    // to re-login once the in-memory token expires.
    console.warn('[festplan] Could not persist Spotify tokens:', error.message)
  }
}

export default function AuthCallback() {
  const navigate = useNavigate()

  useEffect(() => {
    // Check if session already exists — the auth event sometimes fires
    // before this component finishes mounting and starts listening.
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session) {
        await persistSpotifyTokens(session)
        navigate(getRedirectTarget(), { replace: true })
      }
    })

    // Also listen for the event in case it fires after mount.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === 'SIGNED_IN' && session) {
          await persistSpotifyTokens(session)
          navigate(getRedirectTarget(), { replace: true })
        }
      }
    )

    return () => subscription.unsubscribe()
  }, [navigate])

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: '100vh', color: '#888', fontSize: 12,
      letterSpacing: 3, textTransform: 'uppercase',
    }}>
      Connecting your Spotify…
    </div>
  )
}
