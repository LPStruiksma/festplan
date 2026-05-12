import AuthCallback from './pages/AuthCallback'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useEffect, useState, useRef } from 'react'
import { supabase } from './lib/supabase'
import { ensureProfile } from './lib/profile'
import { SyncProvider, drainPendingWrites } from './lib/sync-state'
import LoginPage from './pages/LoginPage'
import SetupPage from './pages/SetupPage'
import SchedulePage from './pages/SchedulePage'
import JoinPage from './pages/JoinPage'

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
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </SyncProvider>
  )
}
