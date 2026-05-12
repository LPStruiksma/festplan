import { useState } from 'react'
import { supabase } from '../lib/supabase'

/* ═══════════════════════════════════════════════════════════════════════════
   LOGIN PAGE — Festival Noir aesthetic
   Dramatic full-screen hero with staggered reveals and subtle gradient orb
   ═══════════════════════════════════════════════════════════════════════════ */

const S = {
  root: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '32px 24px',
    position: 'relative',
    overflow: 'hidden',
  },

  /* Ambient gradient orb */
  orb: {
    position: 'absolute',
    width: '60vw',
    height: '60vw',
    maxWidth: 600,
    maxHeight: 600,
    borderRadius: '50%',
    background: 'radial-gradient(circle, var(--fp-accent-dim) 0%, transparent 70%)',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -55%)',
    filter: 'blur(80px)',
    pointerEvents: 'none',
    opacity: 0.4,
    animation: 'fp-fadeIn 2s ease both',
  },

  /* Top accent line */
  topLine: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 2,
    background: 'linear-gradient(90deg, transparent 0%, var(--fp-accent) 50%, transparent 100%)',
    opacity: 0.6,
  },

  content: {
    position: 'relative',
    zIndex: 1,
    textAlign: 'center',
    maxWidth: 520,
  },

  eyebrow: {
    fontFamily: 'var(--fp-font-body)',
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: 5,
    color: 'var(--fp-accent)',
    textTransform: 'uppercase',
    marginBottom: 28,
    animation: 'fp-slideDown 0.6s cubic-bezier(0.16, 1, 0.3, 1) 0.1s both',
  },

  heading: {
    fontFamily: 'var(--fp-font-display)',
    fontSize: 'clamp(40px, 9vw, 76px)',
    fontWeight: 800,
    color: 'var(--fp-text)',
    lineHeight: 0.95,
    letterSpacing: '-2px',
    textTransform: 'uppercase',
    margin: '0 0 28px',
    animation: 'fp-slideUp 0.7s cubic-bezier(0.16, 1, 0.3, 1) 0.2s both',
  },

  headingAccent: {
    color: 'var(--fp-accent)',
    display: 'block',
  },

  subtitle: {
    fontFamily: 'var(--fp-font-body)',
    fontSize: 15,
    fontWeight: 400,
    color: 'var(--fp-text-dim)',
    maxWidth: 380,
    margin: '0 auto 48px',
    lineHeight: 1.7,
    animation: 'fp-slideUp 0.7s cubic-bezier(0.16, 1, 0.3, 1) 0.3s both',
  },

  btnWrap: {
    animation: 'fp-slideUp 0.7s cubic-bezier(0.16, 1, 0.3, 1) 0.4s both',
  },

  btn: (loading) => ({
    display: 'inline-flex',
    alignItems: 'center',
    gap: 12,
    background: 'var(--fp-accent)',
    color: '#000',
    border: 'none',
    borderRadius: 'var(--fp-radius-md)',
    padding: '16px 36px',
    fontFamily: 'var(--fp-font-body)',
    fontSize: 12,
    fontWeight: 800,
    letterSpacing: 3,
    textTransform: 'uppercase',
    cursor: loading ? 'not-allowed' : 'pointer',
    opacity: loading ? 0.6 : 1,
    transition: 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
    boxShadow: '0 0 30px -5px var(--fp-accent-dim)',
    position: 'relative',
    overflow: 'hidden',
  }),

  btnHover: {
    transform: 'translateY(-2px)',
    boxShadow: '0 0 50px -5px var(--fp-accent-dim)',
  },

  error: {
    marginTop: 24,
    color: 'var(--fp-warn)',
    fontSize: 13,
    fontWeight: 500,
    textAlign: 'center',
    maxWidth: 360,
    lineHeight: 1.6,
    animation: 'fp-scaleIn 0.3s ease both',
  },

  privacy: {
    marginTop: 40,
    fontSize: 11,
    fontWeight: 400,
    color: 'var(--fp-text-mute)',
    textAlign: 'center',
    maxWidth: 320,
    lineHeight: 1.8,
    letterSpacing: 0.3,
    animation: 'fp-fadeIn 1s ease 0.6s both',
  },

  /* Decorative corner markers */
  corner: (pos) => ({
    position: 'absolute',
    width: 24,
    height: 24,
    borderColor: 'var(--fp-border2)',
    borderStyle: 'solid',
    borderWidth: 0,
    opacity: 0.4,
    ...(pos === 'tl' && { top: 20, left: 20, borderTopWidth: 1, borderLeftWidth: 1 }),
    ...(pos === 'tr' && { top: 20, right: 20, borderTopWidth: 1, borderRightWidth: 1 }),
    ...(pos === 'bl' && { bottom: 20, left: 20, borderBottomWidth: 1, borderLeftWidth: 1 }),
    ...(pos === 'br' && { bottom: 20, right: 20, borderBottomWidth: 1, borderRightWidth: 1 }),
    animation: 'fp-fadeIn 1.2s ease 0.8s both',
  }),

  /* Bottom accent bar */
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: '50%',
    transform: 'translateX(-50%)',
    width: 80,
    height: 3,
    borderRadius: 2,
    background: 'var(--fp-accent)',
    opacity: 0.15,
  },
}

export default function LoginPage() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [hovered, setHovered] = useState(false)

  const handleSpotifyLogin = async () => {
    setLoading(true)
    setError(null)

    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'spotify',
      options: {
        scopes: 'user-library-read playlist-read-private user-top-read playlist-modify-private',
        redirectTo: window.location.origin + '/auth/callback',
      },
    })

    if (error) {
      setError(error.message)
      setLoading(false)
    }
  }

  return (
    <div style={S.root}>
      {/* Decorative elements */}
      <div style={S.topLine} />
      <div style={S.orb} />
      <div style={S.corner('tl')} />
      <div style={S.corner('tr')} />
      <div style={S.corner('bl')} />
      <div style={S.corner('br')} />
      <div style={S.bottomBar} />

      <div style={S.content}>
        <div style={S.eyebrow}>Your Festival Companion</div>

        <h1 style={S.heading}>
          Know Your{'\n'}Festival
          <span style={S.headingAccent}>Inside Out.</span>
        </h1>

        <p style={S.subtitle}>
          Connect Spotify and instantly see which of your favourite
          artists are playing — when, where, and on which stage.
        </p>

        <div style={S.btnWrap}>
          <button
            onClick={handleSpotifyLogin}
            disabled={loading}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            style={{
              ...S.btn(loading),
              ...(hovered && !loading ? S.btnHover : {}),
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
            </svg>
            {loading ? 'Connecting...' : 'Connect with Spotify'}
          </button>
        </div>

        {error && (
          <p style={S.error}>{error}</p>
        )}

        <p style={S.privacy}>
          We only read your listening data to match artists.
          We never modify your Spotify account or post anything.
        </p>
      </div>
    </div>
  )
}
