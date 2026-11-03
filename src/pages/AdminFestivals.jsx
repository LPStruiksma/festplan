import React, { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { T, pillBtn } from '../lib/ui'
import {
  listFestivals, discoverFestivalsLive, ingestDiscoveredFestival, notYetIngested,
} from '../lib/admin-api'
import { loadArtistsFromCache } from '../lib/profile'

/* ═══════════════════════════════════════════════════════════════════════════
   ADMIN FESTIVALS — /admin/festivals
   Lists all festival_meta rows.  Clicking one opens the editor.
   Below them, festivals discovered on Ticketmaster for the admin's saved
   artists that are not stored yet, each with a one-click Ingest button.
   ═══════════════════════════════════════════════════════════════════════════ */

export default function AdminFestivals({ session }) {
  const navigate    = useNavigate()
  const adminEmail  = import.meta.env.VITE_ADMIN_EMAIL

  // ── Auth gate ────────────────────────────────────────────────────────────
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
        <button onClick={() => navigate('/')} style={{ ...pillBtn(false), marginTop: 8 }}>
          ← Back
        </button>
      </div>
    )
  }

  return <AdminFestivalsContent />
}

// Hooks live here, below the auth gate component, so the hook count never
// changes when the session arrives after mount.
function AdminFestivalsContent() {
  const navigate = useNavigate()

  const [festivals, setFestivals] = useState(null)   // null = loading
  const [error, setError]         = useState(null)

  const reload = useCallback(() =>
    listFestivals()
      .then(setFestivals)
      .catch(e => setError(e.message))
  , [])

  useEffect(() => { reload() }, [reload])

  // ── Layout ───────────────────────────────────────────────────────────────
  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--fp-bg)',
      padding: '40px 24px',
      fontFamily: T.body,
    }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, marginBottom: 32, flexWrap: 'wrap' }}>
          <button onClick={() => navigate('/')} style={{ ...pillBtn(false), marginBottom: 2 }}>
            ← Home
          </button>
          <div style={{ flex: 1 }}>
            <div style={{
              fontFamily: T.display, fontSize: 28, fontWeight: 900,
              color: 'var(--fp-text)', textTransform: 'uppercase', letterSpacing: 1,
            }}>
              🗂 Festival Admin
            </div>
            <div style={{ fontSize: 11, color: 'var(--fp-text-mute)', marginTop: 4, letterSpacing: 0.3 }}>
              {festivals ? `${festivals.length} festival${festivals.length !== 1 ? 's' : ''} in database` : 'Loading…'}
            </div>
          </div>
          <button
            onClick={() => navigate('/admin/ingest')}
            style={{ ...pillBtn(false), display: 'flex', alignItems: 'center', gap: 6 }}
          >
            + Ingest from Ticketmaster
          </button>
        </div>

        {/* Error */}
        {error && (
          <div style={{
            padding: '12px 16px', marginBottom: 20,
            background: 'rgba(244,67,54,0.08)', border: '1px solid rgba(244,67,54,0.3)',
            borderRadius: 'var(--fp-radius-md)', color: '#f44336', fontSize: 13,
          }}>
            {error}
          </div>
        )}

        {/* Loading skeleton */}
        {festivals === null && !error && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[1, 2, 3].map(i => (
              <div key={i} style={{
                height: 60,
                background: 'var(--fp-s1)',
                border: '1px solid var(--fp-border)',
                borderRadius: 'var(--fp-radius-md)',
                opacity: 0.5,
                animation: 'fp-fadeIn 0.3s ease both',
              }} />
            ))}
          </div>
        )}

        {/* Festival list */}
        {festivals !== null && festivals.length === 0 && (
          <div style={{
            padding: '40px 24px', textAlign: 'center',
            color: 'var(--fp-text-mute)', fontSize: 13,
            border: '1px dashed var(--fp-border)', borderRadius: 'var(--fp-radius-lg)',
          }}>
            No festivals yet.  Use the Ingest button to add one from Ticketmaster.
          </div>
        )}

        {festivals && festivals.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {festivals.map(f => (
              <FestivalRow key={f.festival_key} festival={f} onClick={() =>
                navigate(`/admin/festivals/${encodeURIComponent(f.festival_key)}`)
              } />
            ))}
          </div>
        )}

        <DiscoveredSection festivals={festivals} onIngested={reload} />
      </div>
    </div>
  )
}

// ── Discovered festivals (one-click ingest) ──────────────────────────────────

function DiscoveredSection({ festivals, onIngested }) {
  const [discovered, setDiscovered] = useState(null)   // null = not searched
  const [searching, setSearching]   = useState(false)
  const [busyId, setBusyId]         = useState(null)
  const [message, setMessage]       = useState(null)   // { error?: string, text: string }

  async function handleFind() {
    const artists = loadArtistsFromCache()
    if (!artists.length) {
      setMessage({ error: true, text: 'No saved artists yet. Add artists on the setup page first.' })
      return
    }
    setSearching(true)
    setMessage(null)
    try {
      setDiscovered(await discoverFestivalsLive(artists))
    } catch (e) {
      setMessage({ error: true, text: `Discovery failed: ${e.message}` })
    } finally {
      setSearching(false)
    }
  }

  async function handleIngest(f) {
    setBusyId(f.id)
    setMessage(null)
    try {
      await ingestDiscoveredFestival(f)
      setMessage({ text: `Ingested ${f.name}.` })
      await onIngested()
    } catch (e) {
      setMessage({ error: true, text: `Ingest of ${f.name} failed: ${e.message}` })
    } finally {
      setBusyId(null)
    }
  }

  const pending = discovered && festivals ? notYetIngested(discovered, festivals) : []

  return (
    <div style={{ marginTop: 40 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={{
          flex: 1, fontFamily: T.display, fontSize: 16, fontWeight: 900,
          color: 'var(--fp-text)', textTransform: 'uppercase', letterSpacing: 1,
        }}>
          Discovered on Ticketmaster
        </div>
        <button onClick={handleFind} disabled={searching} style={pillBtn(false)}>
          {searching ? 'Searching…' : 'Find festivals for my artists'}
        </button>
      </div>

      {message && (
        <div style={{
          padding: '10px 14px', marginBottom: 12, fontSize: 13,
          borderRadius: 'var(--fp-radius-md)',
          color: message.error ? '#f44336' : 'var(--fp-text)',
          border: `1px solid ${message.error ? 'rgba(244,67,54,0.3)' : 'var(--fp-border)'}`,
        }}>
          {message.text}
        </div>
      )}

      {discovered && pending.length === 0 && (
        <div style={{ fontSize: 13, color: 'var(--fp-text-mute)' }}>
          Every discovered festival is already in the database.
        </div>
      )}

      {pending.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {pending.map(f => (
            <div key={f.id} style={{
              display: 'flex', alignItems: 'center', gap: 14,
              padding: '12px 18px',
              background: 'var(--fp-s1)',
              border: '1px solid var(--fp-border)',
              borderRadius: 'var(--fp-radius-md)',
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 800, fontSize: 14, color: 'var(--fp-text)' }}>{f.name}</div>
                <div style={{ fontSize: 11, color: 'var(--fp-text-mute)', marginTop: 2 }}>
                  {[f.location, f.startDate === f.endDate ? f.startDate : `${f.startDate} → ${f.endDate}`]
                    .filter(Boolean).join(' · ')}
                  {` · ${f.tmEventIds.length} event${f.tmEventIds.length !== 1 ? 's' : ''}`}
                </div>
              </div>
              <button
                onClick={() => handleIngest(f)}
                disabled={busyId !== null}
                aria-label={`Ingest ${f.name}`}
                style={pillBtn(false)}
              >
                {busyId === f.id ? 'Ingesting…' : 'Ingest'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Row component ─────────────────────────────────────────────────────────────

function FestivalRow({ festival: f, onClick }) {
  const [hovered, setHovered] = useState(false)
  const accent = f.accent_color || '#c8f400'

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 14,
        padding: '14px 18px',
        background: hovered ? 'var(--fp-s2)' : 'var(--fp-s1)',
        border: `1px solid ${hovered ? accent + '60' : 'var(--fp-border)'}`,
        borderLeft: `3px solid ${accent}`,
        borderRadius: 'var(--fp-radius-md)',
        cursor: 'pointer',
        transition: 'all 0.15s ease',
        animation: 'fp-fadeIn 0.3s ease both',
      }}
    >
      {/* Emoji */}
      <div style={{ fontSize: 22, flexShrink: 0, width: 32, textAlign: 'center' }}>
        {f.emoji || '🎵'}
      </div>

      {/* Name + location */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontFamily: T.body, fontWeight: 800, fontSize: 14,
          color: 'var(--fp-text)', letterSpacing: 0.3,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {f.name}
        </div>
        {f.location && (
          <div style={{
            fontFamily: T.body, fontSize: 11,
            color: 'var(--fp-text-mute)', marginTop: 2,
          }}>
            {f.location}
          </div>
        )}
      </div>

      {/* Dates */}
      {(f.start_date || f.days?.length > 0) && (
        <div style={{
          fontFamily: T.body, fontSize: 11, color: 'var(--fp-text-dim)',
          whiteSpace: 'nowrap', flexShrink: 0,
        }}>
          {f.start_date
            ? f.start_date === f.end_date || !f.end_date
              ? f.start_date
              : `${f.start_date} → ${f.end_date}`
            : `${f.days.length} day${f.days.length !== 1 ? 's' : ''}`
          }
        </div>
      )}

      {/* Slot count pill */}
      <div style={{
        padding: '3px 10px',
        borderRadius: 99,
        background: 'var(--fp-s2)',
        border: '1px solid var(--fp-border)',
        fontFamily: T.body, fontSize: 10, fontWeight: 700,
        color: 'var(--fp-text-mute)', letterSpacing: 1,
        flexShrink: 0,
      }}>
        {(f.stages?.length || 0)} stages
      </div>

      {/* Arrow */}
      <div style={{ color: hovered ? accent : 'var(--fp-text-mute)', fontSize: 16, flexShrink: 0 }}>
        →
      </div>
    </div>
  )
}
