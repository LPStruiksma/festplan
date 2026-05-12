import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

/* ═══════════════════════════════════════════════════════════════════════════
   ADMIN INGEST PAGE
   Ingests a festival from Ticketmaster into Supabase via the
   ingest-festival-timetable edge function.

   Single-day mode:  sends { eventId }          — one TM event, day_index = 0
   Multi-day mode:   sends { eventIds, festivalSlug? } — parallel fetch,
                     each event gets its own day_index

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
  fontFamily:    T.body,
  fontSize:      10,
  fontWeight:    800,
  letterSpacing: 2,
  textTransform: 'uppercase',
  color:         'var(--fp-text-mute)',
  marginBottom:  6,
  display:       'block',
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

const textarea = {
  ...input,
  resize:     'vertical',
  minHeight:  110,
  lineHeight: 1.6,
}

// ── Toggle ────────────────────────────────────────────────────────────────────

function ModeToggle({ multiDay, onChange }) {
  const btnBase = {
    flex:          1,
    padding:       '7px 0',
    border:        'none',
    borderRadius:  'var(--fp-radius-md)',
    fontFamily:    T.body,
    fontSize:      11,
    fontWeight:    800,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    cursor:        'pointer',
    transition:    'background 0.15s, color 0.15s',
  }
  return (
    <div style={{
      display:       'flex',
      gap:           4,
      background:    'var(--fp-s2)',
      border:        '1px solid var(--fp-border)',
      borderRadius:  'var(--fp-radius-md)',
      padding:       4,
      marginBottom:  20,
    }}>
      <button
        onClick={() => onChange(false)}
        style={{
          ...btnBase,
          background: !multiDay ? '#c8f400' : 'transparent',
          color:      !multiDay ? '#000'    : 'var(--fp-text-mute)',
        }}
      >
        Single-day
      </button>
      <button
        onClick={() => onChange(true)}
        style={{
          ...btnBase,
          background: multiDay ? '#c8f400' : 'transparent',
          color:      multiDay ? '#000'    : 'var(--fp-text-mute)',
        }}
      >
        Multi-day
      </button>
    </div>
  )
}

// ── Primary button ────────────────────────────────────────────────────────────

function PrimaryBtn({ onClick, disabled, children }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background:    disabled ? 'var(--fp-s2)' : '#c8f400',
        color:         disabled ? 'var(--fp-text-dim)' : '#000',
        border:        'none',
        borderRadius:  'var(--fp-radius-md)',
        padding:       '10px 22px',
        fontFamily:    T.body,
        fontSize:      12,
        fontWeight:    800,
        letterSpacing: 1.5,
        textTransform: 'uppercase',
        cursor:        disabled ? 'default' : 'pointer',
        transition:    'opacity 0.15s',
        opacity:       disabled ? 0.5 : 1,
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
                ['Festival key',   result.festivalKey],
                ['Name',           result.festivalName],
                ['Dates',          result.startDate && result.endDate
                  ? result.startDate === result.endDate
                    ? result.startDate
                    : `${result.startDate} → ${result.endDate}`
                  : '—'],
                ['Days stored',    result.days?.join(', ') || '—'],
                ['Artists stored', result.artistCount],
                ...(result.eventsIngested !== undefined
                  ? [['Events fetched', result.eventsIngested]]
                  : []),
              ].map(([k, v]) => (
                <tr key={k}>
                  <td style={{
                    padding:       '3px 12px 3px 0',
                    color:         'var(--fp-text-mute)',
                    fontSize:      11,
                    fontWeight:    700,
                    letterSpacing: 1,
                    textTransform: 'uppercase',
                    whiteSpace:    'nowrap',
                    verticalAlign: 'top',
                  }}>{k}</td>
                  <td style={{
                    padding: '3px 0',
                    color:   'var(--fp-text)',
                    fontSize: 13,
                  }}>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{
            marginTop:  12,
            fontSize:   11,
            color:      'var(--fp-text-mute)',
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
  const navigate   = useNavigate()
  const adminEmail = import.meta.env.VITE_ADMIN_EMAIL

  // Gate: only the configured admin email may access this page
  if (!session || session.user.email !== adminEmail) {
    return (
      <div style={{
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'center',
        height:         '100vh',
        flexDirection:  'column',
        gap:            16,
        fontFamily:     T.body,
      }}>
        <div style={{ fontSize: 32 }}>🚫</div>
        <div style={{ fontSize: 14, color: 'var(--fp-text-mute)', letterSpacing: 1 }}>
          Access denied
        </div>
        <button
          onClick={() => navigate('/')}
          style={{
            marginTop:    8,
            background:   'none',
            border:       '1px solid var(--fp-border)',
            borderRadius: 'var(--fp-radius-md)',
            padding:      '8px 18px',
            color:        'var(--fp-text)',
            fontFamily:   T.body,
            fontSize:     12,
            cursor:       'pointer',
          }}
        >
          ← Back
        </button>
      </div>
    )
  }

  // ── State ──
  const [multiDay,   setMultiDay]   = useState(false)
  const [eventId,    setEventId]    = useState('')         // single-day
  const [eventIds,   setEventIds]   = useState('')         // multi-day: one per line
  const [slugOverride, setSlugOverride] = useState('')     // multi-day optional
  const [loading,    setLoading]    = useState(false)
  const [result,     setResult]     = useState(null)

  // ── Submission ──
  function isReady() {
    if (loading) return false
    if (multiDay) return eventIds.trim().split('\n').some(l => l.trim())
    return Boolean(eventId.trim())
  }

  async function handleIngest() {
    if (!isReady()) return
    setLoading(true)
    setResult(null)

    try {
      const { data: { session: currentSession } } = await supabase.auth.getSession()

      let payload
      if (multiDay) {
        const ids = eventIds
          .split('\n')
          .map(l => l.trim())
          .filter(Boolean)
        payload = { eventIds: ids }
        if (slugOverride.trim()) payload.festivalSlug = slugOverride.trim()
      } else {
        payload = { eventId: eventId.trim() }
      }

      const res = await fetch(`${EDGE_FN_BASE}/ingest-festival-timetable`, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${currentSession?.access_token || ''}`,
          'apikey':        import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify(payload),
      })

      const data = await res.json()
      setResult(data)
    } catch (e) {
      setResult({ error: e.message || 'Network error' })
    } finally {
      setLoading(false)
    }
  }

  // ── Reset result when switching mode ──
  function handleModeChange(isMulti) {
    setMultiDay(isMulti)
    setResult(null)
  }

  // ── Render ──
  return (
    <div style={{
      minHeight:      '100vh',
      background:     'var(--fp-bg)',
      display:        'flex',
      flexDirection:  'column',
      alignItems:     'center',
      padding:        '40px 20px',
      gap:            24,
    }}>
      {/* Header */}
      <div style={{ width: '100%', maxWidth: 560 }}>
        <button
          onClick={() => navigate('/')}
          style={{
            background:    'none',
            border:        '1px solid var(--fp-border)',
            borderRadius:  'var(--fp-radius-md)',
            padding:       '6px 14px',
            color:         'var(--fp-text-dim)',
            fontFamily:    T.body,
            fontSize:      11,
            fontWeight:    700,
            letterSpacing: 1,
            cursor:        'pointer',
            marginBottom:  24,
          }}
        >
          ← Back
        </button>

        <div style={{
          fontFamily:    T.display,
          fontSize:      28,
          fontWeight:    900,
          color:         'var(--fp-text)',
          textTransform: 'uppercase',
          letterSpacing: 1,
          lineHeight:    1.1,
        }}>
          🎛 Admin Ingest
        </div>
        <div style={{
          fontFamily:    T.body,
          fontSize:      12,
          color:         'var(--fp-text-mute)',
          marginTop:     6,
          letterSpacing: 0.3,
        }}>
          Import a festival lineup from Ticketmaster into Supabase.
          Logged in as <strong style={{ color: 'var(--fp-text)' }}>{session.user.email}</strong>
        </div>
      </div>

      {/* Card */}
      <div style={card}>

        {/* Mode toggle */}
        <ModeToggle multiDay={multiDay} onChange={handleModeChange} />

        {multiDay ? (
          /* ── Multi-day fields ── */
          <>
            <div style={{ marginBottom: 16 }}>
              <label style={label} htmlFor="event-ids">
                Ticketmaster Event IDs — one per line
              </label>
              <textarea
                id="event-ids"
                value={eventIds}
                onChange={e => setEventIds(e.target.value)}
                placeholder={'G5v0Z9Yb5c6Ql\nG5v0Z9Yb5c6Qm\nG5v0Z9Yb5c6Qn'}
                style={textarea}
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
                Paste one event ID per line — one per festival day. The slug and
                dates will be derived from the first event unless you override
                them below.
              </div>
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={label} htmlFor="slug-override">
                Festival slug override{' '}
                <span style={{ fontWeight: 400, letterSpacing: 0 }}>(optional)</span>
              </label>
              <input
                id="slug-override"
                type="text"
                value={slugOverride}
                onChange={e => setSlugOverride(e.target.value)}
                placeholder="e.g. glastonbury-2026"
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
                If left blank, the slug is auto-derived from the first event's
                name (e.g. "Glastonbury Festival 2026" → "glastonbury-festival").
                Use this to match an existing festival key or to control the URL.
              </div>
            </div>
          </>
        ) : (
          /* ── Single-day field ── */
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
        )}

        <PrimaryBtn onClick={handleIngest} disabled={!isReady()}>
          {loading
            ? (multiDay ? 'Ingesting…' : 'Ingesting…')
            : (multiDay ? 'Ingest Multi-day Festival' : 'Ingest Festival')}
        </PrimaryBtn>

        <ResultCard result={result} />
      </div>

      {/* Info box */}
      <div style={{
        maxWidth:     560,
        width:        '100%',
        padding:      '14px 18px',
        background:   'var(--fp-s1)',
        border:       '1px solid var(--fp-border)',
        borderRadius: 'var(--fp-radius-md)',
        fontFamily:   T.body,
        fontSize:     12,
        color:        'var(--fp-text-mute)',
        lineHeight:   1.6,
      }}>
        <div style={{
          fontWeight:    800,
          letterSpacing: 1.5,
          textTransform: 'uppercase',
          fontSize:      10,
          marginBottom:  8,
        }}>
          How it works
        </div>
        {multiDay
          ? 'Fetches each event from Ticketmaster in parallel and stores artists as lineup-only slots. Each event\'s artists are tagged with the correct day (day 0 = first event date, day 1 = second, etc.). Use the slug override to match an existing festival or keep the same key across re-ingests.'
          : 'Fetches the event from Ticketmaster and stores artists as lineup-only slots (no stage or time data). The festival will appear in discovery results and render a "lineup" view in the schedule. Once a full timetable is available, re-ingest or manually update the slots.'}
      </div>
    </div>
  )
}
