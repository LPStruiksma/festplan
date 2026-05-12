import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

// This page exists solely to catch the redirect back from Spotify OAuth.
// Supabase sends the user here with a short-lived code in the URL (?code=…).
//
// ── Why the original getSession() approach broke ─────────────────────────────
// If the user was already logged in, getSession() returns the *old* session
// (no provider_token), persistSpotifyTokens() bails out, and we navigate away
// before onAuthStateChange fires with the *new* SIGNED_IN session that carries
// provider_token.  The tokens were silently never written.
//
// ── Fix ───────────────────────────────────────────────────────────────────────
// When there's an OAuth code in the URL we're in a fresh login flow.
// In that case we ONLY navigate from onAuthStateChange('SIGNED_IN'), which
// always carries provider_token.  getSession() is kept only as a fast-path
// for the edge case where the event fired before this component mounted.
//
// A 15-second safety timeout ensures the user is never stuck here forever.

function getRedirectTarget() {
  const pendingSlug = localStorage.getItem('festplan_pending_invite')
  return pendingSlug ? `/join/${pendingSlug}` : '/setup'
}

async function persistSpotifyTokens(session) {
  const userId       = session?.user?.id
  const accessToken  = session?.provider_token
  const refreshToken = session?.provider_refresh_token

  if (!userId || !accessToken) return   // nothing to write

  const expiresAt = new Date(Date.now() + 3600 * 1000).toISOString()

  // Use upsert so we create the profile row if it doesn't exist yet
  // (e.g. if the DB trigger failed or an INSERT policy was missing).
  const { error } = await supabase
    .from('profiles')
    .upsert({
      id:                       userId,
      spotify_access_token:     accessToken,
      // Only overwrite refresh token if Spotify gave us one — re-logins
      // sometimes omit it; keeping the old one is safer than clearing it.
      ...(refreshToken ? { spotify_refresh_token: refreshToken } : {}),
      spotify_token_expires_at: expiresAt,
    }, { onConflict: 'id' })

  if (error) {
    console.warn('[festplan] Could not persist Spotify tokens:', error.message)
  } else {
    console.log('[festplan] Spotify tokens persisted for user', userId)
  }
}

export default function AuthCallback() {
  const navigate    = useNavigate()
  const doneRef     = useRef(false)   // prevent double-navigation

  useEffect(() => {
    // Does the URL contain an OAuth code?  If so we're mid-login-flow and
    // must wait for onAuthStateChange to get the fresh session + provider_token.
    const hasOAuthCode = new URLSearchParams(window.location.search).has('code')

    const go = async (session) => {
      if (doneRef.current) return
      doneRef.current = true
      await persistSpotifyTokens(session)
      navigate(getRedirectTarget(), { replace: true })
    }

    // ── Primary path: onAuthStateChange('SIGNED_IN') ─────────────────────────
    // This event always carries provider_token right after an OAuth exchange.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === 'SIGNED_IN' && session) {
          await go(session)
        }
      }
    )

    // ── Fallback: getSession() ────────────────────────────────────────────────
    // Catches the case where the SIGNED_IN event fired before this component
    // mounted (race on fast devices / hot-module-reload).
    //
    // If there's an OAuth code in the URL, we only use this path when
    // provider_token is already present — otherwise we let onAuthStateChange
    // handle it so we don't navigate with a stale session.
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) return
      if (hasOAuthCode && !session.provider_token) return   // ← the old bug
      await go(session)
    })

    // ── Safety timeout ───────────────────────────────────────────────────────
    // If neither path produced a navigation within 15 s (e.g. Spotify is slow,
    // network hiccup), redirect anyway so the user isn't stuck.
    const timeout = setTimeout(() => {
      if (!doneRef.current) {
        console.warn('[festplan] AuthCallback timeout — navigating without tokens')
        doneRef.current = true
        navigate(getRedirectTarget(), { replace: true })
      }
    }, 15_000)

    return () => {
      subscription.unsubscribe()
      clearTimeout(timeout)
    }
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
