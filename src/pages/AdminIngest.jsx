import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

/* ═══════════════════════════════════════════════════════════════════════════
   ADMIN INGEST PAGE
   Ingests a festival from Ticketmaster into Supabase via the
   ingest-festival-timetable edge function.

   Access is gated on session.user.email === VITE_ADMIN_EMAIL.
   ═══════════════════════════════════════════════════════════════════════════ */

const EDGE_FN_BASE = import.meta.env.VITE_SUPABASE_URL + '/functions/v1'

const T = {
  display: "var(--fp-font-display)",
  body:    "var(--fp-font-body)",
}

// ── Inline styles ────────────────────────────────────────────────────────────

const card = {
  background:   'var(--fp-s1)',
  border:       '1px solid var(--fp-border)',
  borderRadius: 'var(--fp-radius-lg)',
  padding:      '28px 32px',
  maxWidth:     560,
  width:        '100%',
}

const label = {
  fontFamily:  T.body,
  fontSize:    10,
  fontWeight:  800,
  letterSpacing: 2,
  textTransform: 'uppercase',
  color:       'var(--fp-text-mute)',
  marginBottom: 6,
  display:     'block',
}

const input = {
  width:        '100%',
  background:   'var(--fp-s2)',
  border:       '1px solid var(--fp-border)',
  borderRadius: 'var(--fp-radius-md)',
  padding:      '10px 14px',
  fontFamily:   T.body,
  fontSize:     14,
  color:        'var(--fp-text)',
  outline:      'none',
  boxSizing:    'border-box',
}

function PrimaryBtn({ onClick, disabled, children }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background:   disabled ? 'var(--fp-s2)' : '#c8f400',
        color:        disabled ? 'var(--fp-text-dim)' : '#000',
        border:       'none',
        borderRadius: 'var(--fp-radius-md)',
        padding:      '10px 22px',
        fontFamily:   T.body,
        fontSize:     12,
        fontWeight:   800,
        letterSpacing: 1.5,
        textTransform: 'uppercase',
        cursor:       disabled ? 'default' : 'pointer',
        transition:   'opacity 0.15s',
        opacity:      disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  )
}

// ── Result display ────────────────────────────────────────────────────────────

function ResultCard({ result }) {
  if (!result) return null

  const isError = !!result.error
  const accent  = isError ? '#f44336' : '#c8f400'

  return (
    <div style={{
      marginTop:    20,
      padding:      '16px 20px',
      borderRadius: 'var(--fp-radius-md)',
      border:       `1px solid ${accent}40`,
      background:   `${accent}08`,
      fontFamily:   T.body,
      fontSize:     13,
    }}>
      {isError ? (
        <div style={{ color: '#f44336', fontWeight: 600 }}>
          ✗ {result.error}
          {result.detail && (
            <div style={{ marginTop: 6, fontWeight: 400, fontSize: 12, opacity: 0.8 }}>
              {result.detail}
            </div>
          )}
        </div>
      ) : (
        <div>
          <div style={{ color: '#c8f400', fontWeight: 700, fontSize: 14, marginBottom: 10 }}>
            ✓ Ingested successfully
          </div>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <tbody>
              {[
                ['Festival key',  result.festivalKey],
                ['Name',          result.festivalName],
                ['Dates',         result.startDate && result.endDate
                  ? result.startDate === result.endDate
                    ? result.startDate
                    : `${result.startDate} → ${result.endDate}`
                  : '—'],
                ['Days stored',   result.days?.join(', ') || '—'],
                ['Artists stored', result.artistCount],
              ].map(([k, v]) => (
                <tr key={k}>
                  <td style={{
                    padding: '3px 12px 3px 0',
                    color: 'var(--fp-text-mute)',
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: 1,
                    textTransform: 'uppercase',
                    whiteSpace: 'nowrap',
                    verticalAlign: 'top',
                  }}>{k}</td>
                  <td style={{
                    padding: '3px 0',
                    color: 'var(--fp-text)',
                    fontSize: 13,
                  }}>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{
            marginTop: 12,
            fontSize: 11,
            color: 'var(--fp-text-mute)',
            lineHeight: 1.5,
          }}>
            Slots stored with null start/end times — festival will render in
            lineup-only mode until a full timetable is ingested.
          </div>
        </div>
      )}
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function AdminIngest({ session }) {
  const navigate = useNavigate()
  const adminEmail = import.meta.env.VITE_ADMIN_EMAIL

  // Gate: only the configured admin email may access this page
  if (!session || session.user.email !== adminEmail) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100vh', flexDirection: 'column', gap: 16,
        fontFamily: T.body,
      }}>
        <div style={{ fontSize: 32 }}>🚫</div>
        <div style={{ fontSize: 14, color: 'var(--fp-text-mute)', letterSpacing: 1 }}>
          Access denied
        </div>
        <button
          onClick={() => navigate('/')}
          style={{
            marginTop: 8,
            background: 'none',
            border: '1px solid var(--fp-border)',
            borderRadius: 'var(--fp-radius-md)',
            padding: '8px 18px',
            color: 'var(--fp-text)',
            fontFamily: T.body,
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          ← Back
        </button>
      </div>
    )
  }

  const [eventId, setEventId]   = useState('')
  const [loading, setLoading]   = useState(false)
  const [result,  setResult]    = useState(null)

  async function handleIngest() {
    if (!eventId.trim()) return
    setLoading(true)
    setResult(null)

    try {
      const { data: { session: currentSession } } = await supabase.auth.getSession()
      const res = await fetch(`${EDGE_FN_BASE}/ingest-festival-timetable`, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${currentSession?.access_token || ''}`,
          'apikey':        import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ eventId: eventId.trim() }),
      })

      const data = await res.json()
      setResult(data)
    } catch (e) {
      setResult({ error: e.message || 'Network error' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--fp-bg)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      padding: '40px 20px',
      gap: 24,
    }}>
      {/* Header */}
      <div style={{ width: '100%', maxWidth: 560 }}>
        <button
          onClick={() => navigate('/')}
          style={{
            background: 'none',
            border: '1px solid var(--fp-border)',
            borderRadius: 'var(--fp-radius-md)',
            padding: '6px 14px',
            color: 'var(--fp-text-dim)',
            fontFamily: T.body,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 1,
            cursor: 'pointer',
            marginBottom: 24,
          }}
        >
          ← Back
        </button>

        <div style={{
          fontFamily:  T.display,
          fontSize:    28,
          fontWeight:  900,
          color:       'var(--fp-text)',
          textTransform: 'uppercase',
          letterSpacing: 1,
          lineHeight:  1.1,
        }}>
          🎛 Admin Ingest
        </div>
        <div style={{
          fontFamily: T.body,
          fontSize:   12,
          color:      'var(--fp-text-mute)',
          marginTop:  6,
          letterSpacing: 0.3,
        }}>
          Import a festival lineup from Ticketmaster into Supabase.
          Logged in as <strong style={{ color: 'var(--fp-text)' }}>{session.user.email}</strong>
        </div>
      </div>

      {/* Card */}
      <div style={card}>
        <div style={{ marginBottom: 20 }}>
          <label style={label} htmlFor="event-id">
            Ticketmaster Event ID
          </label>
          <input
            id="event-id"
            type="text"
            value={eventId}
            onChange={e => setEventId(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !loading && handleIngest()}
            placeholder="e.g. G5v0Z9Yb5c6Ql"
            style={input}
            spellCheck={false}
            autoComplete="off"
          />
          <div style={{
            fontFamily: T.body,
            fontSize:   11,
            color:      'var(--fp-text-mute)',
            marginTop:  7,
            lineHeight: 1.5,
          }}>
            Find the ID in the Ticketmaster URL:{' '}
            <code style={{ background: 'var(--fp-s2)', padding: '1px 5px', borderRadius: 3 }}>
              ticketmaster.com/event/<strong>G5v0Z9Yb5c6Ql</strong>/
            </code>
          </div>
        </div>

        <PrimaryBtn onClick={handleIngest} disabled={loading || !eventId.trim()}>
          {loading ? 'Ingesting…' : 'Ingest Festival'}
        </PrimaryBtn>

        <ResultCard result={result} />
      </div>

      {/* Info box */}
      <div style={{
        maxWidth:   560,
        width:      '100%',
        padding:    '14px 18px',
        background: 'var(--fp-s1)',
        border:     '1px solid var(--fp-border)',
        borderRadius: 'var(--fp-radius-md)',
        fontFamily: T.body,
        fontSize:   12,
        color:      'var(--fp-text-mute)',
        lineHeight: 1.6,
      }}>
        <div style={{ fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase', fontSize: 10, marginBottom: 8 }}>
          How it works
        </div>
        Fetches the event from Ticketmaster and stores artists as lineup-only slots
        (no stage or time data). The festival will appear in discovery results and
        render a "lineup" view in the schedule. Once a full timetable is available,
        re-ingest or manually update the slots.
      </div>
    </div>
  )
}
