import React, { useEffect, useState } from 'react'
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
  const [status,   setStatus]   = useState(slug ? 'loading' : 'error')
  const [errorMsg, setErrorMsg] = useState(slug ? '' : 'No invite slug found in the URL.')
  const [attempt, setAttempt] = useState(0)


  useEffect(() => {
    if (!slug) return

    let active = true
    let timeoutId
    const fail = message => {
      if (!active) return
      setErrorMsg(message)
      setStatus('error')
    }

    // Save the slug for AuthCallback; a rejected OAuth initiation must not
    // leave a signed-out visitor indefinitely on the redirect spinner.
    if (!session) {
      async function startOAuth() {
        try {
          localStorage.setItem('festplan_pending_invite', slug)
          const { error } = await supabase.auth.signInWithOAuth({
            provider: 'spotify',
            options: {
              redirectTo: window.location.origin + '/auth/callback',
              scopes: 'user-library-read user-top-read',
            },
          })
          if (error) fail('Spotify sign-in could not start. Check your connection and try again.')
        } catch {
          fail('Spotify sign-in could not start. Check your connection and try again.')
        }
      }
      startOAuth()
      return () => { active = false }
    }

    async function process() {
      setStatus('joining')

      let invite
      try {
        invite = await getInvite(slug)
      } catch {
        fail('We could not check this invite. Check your connection and try again.')
        return
      }
      if (!active) return
      if (!invite) {
        fail("This invite link has expired or doesn't exist. Ask your friend to send a new one.")
        return
      }

      // Opening your own link must never create a friends row.
      if (invite.inviter_user_id === session.user.id) {
        try {
          localStorage.setItem(LS_FESTIVAL_KEY, invite.festival_key)
          navigate('/schedule', { replace: true })
        } catch {
          fail('We could not open this festival. Please try again.')
        }
        return
      }

      let festKey
      try {
        festKey = await acceptInvite(invite, session)
      } catch {
        fail('Something went wrong while joining. Please try again.')
        return
      }
      if (!active) return
      if (!festKey) {
        fail('Something went wrong while joining. Please try again.')
        return
      }

      // The local festival key is the schedule's source of truth; the
      // housekeeping DB write may log a warning without throwing.
      try {
        localStorage.setItem(LS_FESTIVAL_KEY, festKey)
        await saveFestivalKey(session.user.id, festKey)
        if (!active) return
        localStorage.removeItem('festplan_pending_invite')
      } catch {
        fail('We could not finish opening this festival. Please try again.')
        return
      }
      if (!active) return

      setStatus('done')
      timeoutId = setTimeout(() => {
        if (active) navigate('/schedule', { replace: true })
      }, 1400)
    }

    process()
    return () => {
      active = false
      clearTimeout(timeoutId)
    }
  }, [slug, session, navigate, attempt])

  // ── Render ─────────────────────────────────────────────────────────────────

  // Signed out with a slug: the effect has started the OAuth redirect.
  const view = slug && !session && status === 'loading' ? 'redirecting' : status

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
        {view === 'loading' && (
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
        {view === 'redirecting' && (
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
        {view === 'joining' && (
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
        {view === 'done' && (
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
        {view === 'error' && (
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
              <span role="alert">{errorMsg}</span>
            </div>
            {slug && (
              <button
                type="button"
                onClick={() => {
                  setErrorMsg('')
                  setStatus('loading')
                  setAttempt(current => current + 1)
                }}
                style={{
                  padding: '10px 22px', marginRight: 10,
                  background: fa, border: 'none',
                  borderRadius: 'var(--fp-radius-sm)',
                  color: 'var(--fp-bg)', cursor: 'pointer',
                  fontFamily: T.body, fontSize: 11, fontWeight: 700,
                  letterSpacing: 2, textTransform: 'uppercase',
                }}
              >
                Try Again
              </button>
            )}
            <button
              type="button"
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
