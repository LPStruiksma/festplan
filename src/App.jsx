import AuthCallback from './pages/AuthCallback'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useEffect, useState, useRef } from 'react'
import { supabase } from './lib/supabase'
import { ensureProfile } from './lib/profile'
import { SyncProvider, drainPendingWrites } from './lib/sync-state'
import { usePwaInstallPrompt } from './lib/pwa-install'
import LoginPage from './pages/LoginPage'
import SetupPage from './pages/SetupPage'
import SchedulePage from './pages/SchedulePage'
import JoinPage from './pages/JoinPage'
import AdminIngest from './pages/AdminIngest'
import AdminFestivals from './pages/AdminFestivals'
import AdminFestivalEdit from './pages/AdminFestivalEdit'

// ── PWA install banner ────────────────────────────────────────────────────────

const DISMISS_KEY   = 'festplan_pwa_dismiss_until'
const DISMISS_MS    = 30 * 24 * 60 * 60 * 1000   // 30 days

function InstallBanner() {
  const { canInstall, promptInstall, isInstalled } = usePwaInstallPrompt()
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!canInstall || isInstalled) return
    const until = parseInt(localStorage.getItem(DISMISS_KEY) || '0', 10)
    if (Date.now() < until) return
    setVisible(true)
  }, [canInstall, isInstalled])

  if (!visible) return null

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, String(Date.now() + DISMISS_MS))
    setVisible(false)
  }

  async function install() {
    const result = await promptInstall()
    if (result?.outcome === 'accepted') setVisible(false)
    else dismiss()
  }

  return (
    <div style={{
      position:        'fixed',
      bottom:          16,
      left:            '50%',
      transform:       'translateX(-50%)',
      zIndex:          9999,
      display:         'flex',
      alignItems:      'center',
      gap:             10,
      padding:         '10px 14px',
      background:      'var(--fp-s1, #111)',
      border:          '1px solid rgba(200,244,0,0.35)',
      borderRadius:    '999px',
      boxShadow:       '0 4px 24px rgba(0,0,0,0.5)',
      fontFamily:      "var(--fp-font-body, 'Outfit', sans-serif)",
      fontSize:        12,
      whiteSpace:      'nowrap',
      animation:       'fp-slideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1) both',
    }}>
      <span style={{ fontSize: 16 }}>⚡</span>
      <span style={{ color: 'var(--fp-text, #e8e8e8)', fontWeight: 500 }}>
        Install Festplan for offline access
      </span>
      <button
        onClick={install}
        style={{
          background:   '#c8f400',
          color:        '#000',
          border:       'none',
          borderRadius: '999px',
          padding:      '5px 14px',
          fontFamily:   "var(--fp-font-body, 'Outfit', sans-serif)",
          fontSize:     11,
          fontWeight:   800,
          letterSpacing: 1.5,
          textTransform: 'uppercase',
          cursor:       'pointer',
        }}
      >
        Install
      </button>
      <button
        onClick={dismiss}
        aria-label="Dismiss install banner"
        style={{
          background:  'transparent',
          border:      'none',
          color:       'var(--fp-text-mute, #555)',
          cursor:      'pointer',
          fontSize:    16,
          lineHeight:  1,
          padding:     '2px 4px',
        }}
      >
        ×
      </button>
    </div>
  )
}

export default function App() {
  const [session, setSession] = useState(undefined)
  const drainedRef = useRef(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => setSession(session)
    )

    return () => subscription.unsubscribe()
  }, [])

  // Create/refresh the profiles row whenever a session is available.
  // The DB trigger handles first-time creation; this keeps metadata fresh.
  useEffect(() => {
    if (session) ensureProfile(session)
  }, [session])

  // On first sign-in after app boot, drain any writes that failed in a
  // previous session and were queued in festplan_pending_writes[].
  // drainPendingWrites() is a no-op when the queue is empty.
  useEffect(() => {
    if (session && !drainedRef.current) {
      drainedRef.current = true
      drainPendingWrites()
    }
  }, [session])

  if (session === undefined) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        gap: 16,
      }}>
        <div style={{
          width: 20,
          height: 20,
          border: '2px solid var(--fp-accent, #c8f400)',
          borderTopColor: 'transparent',
          borderRadius: '50%',
          animation: 'fp-spin 0.8s linear infinite',
        }} />
        <div style={{
          fontFamily: "var(--fp-font-body, 'Outfit', sans-serif)",
          color: 'var(--fp-text-mute, #555)',
          fontSize: 11,
          letterSpacing: 4,
          textTransform: 'uppercase',
          fontWeight: 600,
        }}>
          Loading
        </div>
      </div>
    )
  }

  return (
    <SyncProvider>
      <InstallBanner />
      <Routes>
        <Route
          path="/"
          element={session ? <Navigate to="/setup" replace /> : <LoginPage />}
        />
        <Route
          path="/setup"
          element={session ? <SetupPage session={session} /> : <Navigate to="/" replace />}
        />
        <Route
          path="/schedule"
          element={session ? <SchedulePage session={session} /> : <Navigate to="/" replace />}
        />
        <Route path="/auth/callback" element={<AuthCallback />} />
        {/* /join/:slug works whether logged in or not — JoinPage handles both */}
        <Route path="/join/:slug" element={<JoinPage session={session} />} />
        <Route
          path="/admin/ingest"
          element={<AdminIngest session={session} />}
        />
        <Route
          path="/admin/festivals"
          element={<AdminFestivals session={session} />}
        />
        <Route
          path="/admin/festivals/:id"
          element={<AdminFestivalEdit session={session} />}
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </SyncProvider>
  )
}
