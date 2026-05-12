import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { getInvite, acceptInvite } from '../lib/invites'
import { saveFestivalKey, LS_FESTIVAL_KEY } from '../lib/schedule-store'

/* ═══════════════════════════════════════════════════════════════════════════
   JOIN PAGE — /join/:slug
   Handles the invite-link landing.

   Two cases:
   ① Not logged in — save the slug to localStorage then trigger Spotify OAuth.
     After the callback, AuthCallback reads the pending slug and redirects
     back here so case ② runs with a real session.

   ② Logged in — look up the invite, call acceptInvite (which creates a
     friends entry in the joiner's list), set the festival key, and navigate
     to /schedule.
   ═══════════════════════════════════════════════════════════════════════════ */

const T = {
  display: "var(--fp-font-display)",
  body:    "var(--fp-font-body)",
}

const fa = '#c8f400'   // default accent; no festival context available here

// Shared spinner used in multiple states
function Spinner() {
  return (
    <div style={{
      width: 20, height: 20,
      border: `2px solid ${fa}`,
      borderTopColor: 'transparent',
      borderRadius: '50%',
      animation: 'fp-spin 0.8s linear infinite',
      margin: '0 auto 18px',
    }} />
  )
}

export default function JoinPage({ session }) {
  const { slug }   = useParams()
  const navigate   = useNavigate()

  // 'loading' | 'redirecting' | 'joining' | 'done' | 'error'
  const [status,   setStatus]   = useState('loading')
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    if (!slug) {
      setStatus('error')
      setErrorMsg('No invite slug found in the URL.')
      return
    }

    // ── ① Not logged in ─────────────────────────────────────────────────────
    if (!session) {
      // Persist the slug so AuthCallback can redirect back here after OAuth.
      localStorage.setItem('festplan_pending_invite', slug)
      setStatus('redirecting')

      supabase.auth.signInWithOAuth({
        provider: 'spotify',
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
          scopes: 'user-library-read user-top-read',
        },
      })
      return
    }

    // ── ② Logged in — process the invite ────────────────────────────────────
    async function process() {
      setStatus('joining')

      // Fetch the invite (null if not found or expired)
      const invite = await getInvite(slug)
      if (!invite) {
        setStatus('error')
        setErrorMsg("This invite link has expired or doesn't exist. Ask your friend to send a new one.")
        return
      }

      // Edge case: the inviter opened their own link
      if (invite.inviter_user_id === session.user.id) {
        // Just send them to the schedule for that festival; no friends row needed
        localStorage.setItem(LS_FESTIVAL_KEY, invite.festival_key)
        navigate('/schedule', { replace: true })
        return
      }

      // Create the friends entry + set festival for the joiner
      const festKey = await acceptInvite(invite, session)
      if (!festKey) {
        setStatus('error')
        setErrorMsg('Something went wrong while joining. Please try again.')
        return
      }

      // Set the joiner's active festival (localStorage + DB)
      localStorage.setItem(LS_FESTIVAL_KEY, festKey)
      await saveFestivalKey(session.user.id, festKey)

      // Clean up any pending invite marker left by the OAuth flow
      localStorage.removeItem('festplan_pending_invite')

      setStatus('done')

      // Brief pause so the success state is visible, then go to schedule
      setTimeout(() => navigate('/schedule', { replace: true }), 1400)
    }

    process()
  }, [slug, session, navigate])

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--fp-bg)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: 'var(--fp-text)',
    }}>
      <div style={{
        textAlign: 'center',
        padding: '48px 24px',
        maxWidth: 380,
        animation: 'fp-fadeIn 0.4s ease both',
      }}>

        {/* Checking / loading */}
        {status === 'loading' && (
          <>
            <Spinner />
            <div style={{
              fontFamily: T.body,
              fontSize: 10, letterSpacing: 4,
              textTransform: 'uppercase',
              color: 'var(--fp-text-mute)',
            }}>
              Checking invite…
            </div>
          </>
        )}

        {/* Redirecting to Spotify OAuth */}
        {status === 'redirecting' && (
          <>
            <Spinner />
            <div style={{
              fontFamily: T.display,
              fontSize: 18, fontWeight: 800,
              color: fa, marginBottom: 8,
              textTransform: 'uppercase',
            }}>
              One sec…
            </div>
            <div style={{
              fontFamily: T.body,
              fontSize: 13,
              color: 'var(--fp-text-dim)',
              lineHeight: 1.5,
            }}>
              Log in with Spotify first and we'll bring you straight back.
            </div>
          </>
        )}

        {/* Processing the invite */}
        {status === 'joining' && (
          <>
            <Spinner />
            <div style={{
              fontFamily: T.body,
              fontSize: 10, letterSpacing: 4,
              textTransform: 'uppercase',
              color: 'var(--fp-text-mute)',
            }}>
              Joining group…
            </div>
          </>
        )}

        {/* Success */}
        {status === 'done' && (
          <>
            <div style={{ fontSize: 44, marginBottom: 16, animation: 'fp-scaleIn 0.4s ease both' }}>🎪</div>
            <div style={{
              fontFamily: T.display,
              fontSize: 24, fontWeight: 800,
              color: fa, marginBottom: 8,
              textTransform: 'uppercase',
              letterSpacing: 0.5,
            }}>
              You're in!
            </div>
            <div style={{
              fontFamily: T.body,
              fontSize: 13,
              color: 'var(--fp-text-dim)',
            }}>
              Taking you to the festival lineup…
            </div>
          </>
        )}

        {/* Error */}
        {status === 'error' && (
          <>
            <div style={{ fontSize: 36, marginBottom: 16, opacity: 0.55 }}>⚠️</div>
            <div style={{
              fontFamily: T.display,
              fontSize: 20, fontWeight: 700,
              color: 'var(--fp-warn)',
              textTransform: 'uppercase',
              marginBottom: 10,
            }}>
              Invite Problem
            </div>
            <div style={{
              fontFamily: T.body,
              fontSize: 13,
              color: 'var(--fp-text-dim)',
              lineHeight: 1.6,
              marginBottom: 24,
            }}>
              {errorMsg}
            </div>
            <button
              onClick={() => navigate('/', { replace: true })}
              style={{
                padding: '10px 22px',
                background: 'transparent',
                border: '1px solid var(--fp-border)',
                borderRadius: 'var(--fp-radius-sm)',
                color: 'var(--fp-text-dim)',
                cursor: 'pointer',
                fontFamily: T.body,
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: 2,
                textTransform: 'uppercase',
                transition: 'border-color 0.2s ease',
              }}
              onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--fp-text-dim)'}
              onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--fp-border)'}
            >
              Go Home
            </button>
          </>
        )}

      </div>
    </div>
  )
}
