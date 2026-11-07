import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

// A callback is successful only after a fresh token-bearing Spotify session
// has been persisted. The previous unconditional timeout could send users to
// setup/join with an old session and no Spotify connection.
const AUTH_TIMEOUT_MS = 15_000
const PENDING_INVITE_KEY = 'festplan_pending_invite'

function getRedirectTarget() {
  const pendingSlug = localStorage.getItem(PENDING_INVITE_KEY)
  return pendingSlug ? `/join/${pendingSlug}` : '/setup'
}

function oauthReturnedError() {
  const query = new URLSearchParams(window.location.search)
  const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  return query.has('error') || fragment.has('error')
}

async function persistSpotifyTokens(session) {
  const userId = session.user.id
  const accessToken = session.provider_token
  const refreshToken = session.provider_refresh_token
  const expiresAt = new Date(Date.now() + 3600 * 1000).toISOString()

  // Retain an existing refresh token when Spotify omits it on a re-login.
  const { error } = await supabase.from('profiles').upsert({
    id: userId,
    spotify_access_token: accessToken,
    ...(refreshToken ? { spotify_refresh_token: refreshToken } : {}),
    spotify_token_expires_at: expiresAt,
  }, { onConflict: 'id' })

  // A failed write must not be displayed as a completed Spotify connection.
  if (error) throw error
}

export default function AuthCallback() {
  const navigate = useNavigate()
  const [error, setError] = useState('')
  const [retrying, setRetrying] = useState(false)

  useEffect(() => {
    if (oauthReturnedError()) {
      setError('Spotify sign-in failed or was cancelled. Please try again.')
      return
    }

    let active = true
    let terminal = false
    let processing = false
    let writeTimer
    let timeoutId
    let subscription

    const fail = message => {
      if (!active || terminal) return
      terminal = true
      clearTimeout(writeTimer)
      clearTimeout(timeoutId)
      setError(message)
    }

    const accept = session => {
      // An old Supabase session can have a user but no Spotify provider token.
      // It is not proof that this OAuth callback completed successfully.
      if (!active || terminal || processing || !session?.user?.id || !session?.provider_token) return
      processing = true

      // Run the database write after Supabase releases the auth callback lock.
      // Claim this session synchronously so SIGNED_IN and getSession races
      // cannot persist or navigate twice.
      writeTimer = setTimeout(async () => {
        if (!active || terminal) return
        try {
          await persistSpotifyTokens(session)
          if (!active || terminal) return
          const target = getRedirectTarget()
          terminal = true
          clearTimeout(timeoutId)
          navigate(target, { replace: true })
        } catch {
          fail('We could not save your Spotify connection. Please try again.')
        }
      }, 0)
    }

    timeoutId = setTimeout(() => {
      fail('We could not confirm a fresh Spotify sign-in. Please try again.')
    }, AUTH_TIMEOUT_MS)

    try {
      const result = supabase.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_IN') accept(session)
      })
      subscription = result.data.subscription
    } catch {
      fail('We could not check your Spotify session. Please try again.')
    }

    if (!terminal) {
      // A token-bearing session may already exist if SIGNED_IN fired before
      // this component subscribed. A stale/tokenless one cannot complete OAuth.
      Promise.resolve()
        .then(() => supabase.auth.getSession())
        .then(({ data, error: sessionError }) => {
          if (sessionError && !processing) {
            fail('We could not check your Spotify session. Please try again.')
          } else {
            accept(data?.session)
          }
        })
        .catch(() => {
          if (!processing) fail('We could not check your Spotify session. Please try again.')
        })
    }

    return () => {
      active = false
      subscription?.unsubscribe()
      clearTimeout(writeTimer)
      clearTimeout(timeoutId)
    }
  }, [navigate])

  const tryAgain = async () => {
    if (retrying) return
    setRetrying(true)
    try {
      // These are the existing JoinPage and LoginPage Spotify scopes, not
      // additional permissions. Keep a pending invite through retry and
      // through the eventual fresh-session redirect.
      const hasPendingInvite = Boolean(localStorage.getItem(PENDING_INVITE_KEY))
      const scopes = hasPendingInvite
        ? 'user-library-read user-top-read'
        : 'user-library-read playlist-read-private user-top-read playlist-modify-private'
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: 'spotify',
        options: {
          redirectTo: window.location.origin + '/auth/callback',
          scopes,
        },
      })
      if (oauthError) throw oauthError
    } catch {
      setError('We could not restart Spotify sign-in. Check your connection and try again.')
    } finally {
      setRetrying(false)
    }
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', minHeight: '100vh', padding: 24,
      color: 'var(--fp-text-dim, #888)', textAlign: 'center',
      fontFamily: 'var(--fp-font-body, sans-serif)',
    }}>
      {error ? (
        <>
          <h1 style={{ fontSize: 20, color: 'var(--fp-warn, #ffaf5c)' }}>
            Spotify connection problem
          </h1>
          <p role="alert" style={{ fontSize: 14, lineHeight: 1.6, maxWidth: 360 }}>
            {error}
          </p>
          <button
            type="button"
            onClick={tryAgain}
            disabled={retrying}
            style={{
              marginTop: 16, padding: '12px 24px',
              border: 0, borderRadius: 6,
              background: 'var(--fp-accent, #c8f400)',
              color: '#000', fontWeight: 700,
              cursor: retrying ? 'not-allowed' : 'pointer',
            }}
          >
            {retrying ? 'Connecting…' : 'Try Again'}
          </button>
        </>
      ) : (
        <p style={{ fontSize: 12, letterSpacing: 3, textTransform: 'uppercase' }}>
          Connecting your Spotify…
        </p>
      )}
    </div>
  )
}
