import { useState, useEffect } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { fetchTimetable } from '../lib/api'
import { norm } from '../lib/festivals'
import { pillBtn, T as uiT } from '../lib/ui'

/* ═══════════════════════════════════════════════════════════════════════════
   COMPARE PAGE  —  /compare?ids=a,b,c[,d]

   Fetches full timetable data for each selected festival, intersects with
   the user's saved artists, then renders:

     ① Horizontal SVG bar chart — one bar per festival, match counts
     ② Artist × Festival table   — rows = union of matched artists (alpha)
                                    cols = one per festival
                                    cells = "Stage · HH:MM" or "—"
     ③ Footer row — bold totals per festival column

   Festival accent colours are used as column header backgrounds.
   ═══════════════════════════════════════════════════════════════════════════ */

// Re-export ui.js T so the rest of this file uses the same alias
const T = uiT

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Read the user's saved artist list from localStorage. */
function readMyArtists() {
  try {
    return JSON.parse(localStorage.getItem('festplan_artists') || '[]')
  } catch {
    return []
  }
}

/**
 * Given a festival's lineup array and the user's artist list, return:
 *   matchedSlots:  Map<normalizedArtistName, slot[]>  — only matched artists
 *   matchCount:    number of unique matched artists
 */
function computeMatches(lineup, myArtists) {
  const matchedSlots = new Map()  // normName → slot[]

  for (const slot of lineup) {
    const n = norm(slot.artist)
    if (myArtists.some(m => norm(m) === n)) {
      if (!matchedSlots.has(n)) matchedSlots.set(n, [])
      matchedSlots.get(n).push(slot)
    }
  }

  // Within each artist, prefer a slot with start_time data.
  for (const [k, slots] of matchedSlots) {
    slots.sort((a, b) => {
      if (a.start && !b.start) return -1
      if (!a.start && b.start) return  1
      return (a.day ?? 0) - (b.day ?? 0)
    })
    matchedSlots.set(k, slots)
  }

  return { matchedSlots, matchCount: matchedSlots.size }
}

/** Format a slot as "Stage · HH:MM" — falls back to just the pieces available. */
function formatSlot(slot) {
  if (!slot) return null
  const parts = []
  if (slot.stage) parts.push(slot.stage)
  if (slot.start) parts.push(slot.start.length > 5 ? slot.start.substring(0, 5) : slot.start)
  return parts.length > 0 ? parts.join(' · ') : '✓'
}

// ── SVG bar chart ─────────────────────────────────────────────────────────────

function MatchBarChart({ festivals }) {
  // Layout constants (SVG user units)
  const W          = 480
  const LABEL_W    = 148   // right-aligned label area
  const GAP        = 10    // gap between label and bar
  const BAR_START  = LABEL_W + GAP
  const BAR_MAX    = 240   // max bar width
  const COUNT_X    = BAR_START + BAR_MAX + 12
  const ROW_H      = 38
  const ROW_GAP    = 10
  const PAD_V      = 8
  const H          = festivals.length * (ROW_H + ROW_GAP) - ROW_GAP + PAD_V * 2

  const maxCount = Math.max(...festivals.map(f => f.matchCount), 1)

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      style={{ display: 'block', maxHeight: 220 }}
      aria-label="Match count bar chart"
    >
      {festivals.map((f, i) => {
        const y      = PAD_V + i * (ROW_H + ROW_GAP)
        const barW   = (f.matchCount / maxCount) * BAR_MAX
        const color  = f.accentColor || '#c8f400'
        const midY   = y + ROW_H / 2

        // Festival label — truncate long names
        const label  = `${f.emoji || '🎵'} ${f.name}`
        const short  = label.length > 22 ? label.slice(0, 21) + '…' : label

        return (
          <g key={f.id}>
            {/* Festival name */}
            <text
              x={LABEL_W}
              y={midY + 4}
              fontFamily="var(--fp-font-body, sans-serif)"
              fontSize={11.5}
              fontWeight={600}
              fill="var(--fp-text-mute, #888)"
              textAnchor="end"
            >
              {short}
            </text>

            {/* Background track */}
            <rect
              x={BAR_START} y={y + 4}
              width={BAR_MAX} height={ROW_H - 8}
              rx={4}
              fill="var(--fp-s2, #1a1a1a)"
            />

            {/* Filled bar */}
            {f.matchCount > 0 && (
              <rect
                x={BAR_START} y={y + 4}
                width={barW} height={ROW_H - 8}
                rx={4}
                fill={color}
                opacity={0.88}
              />
            )}

            {/* Match count */}
            <text
              x={COUNT_X}
              y={midY + 5}
              fontFamily="var(--fp-font-display, sans-serif)"
              fontSize={15}
              fontWeight={900}
              fill={f.matchCount > 0 ? color : 'var(--fp-text-mute, #555)'}
            >
              {f.matchCount}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ComparePage({ session }) {
  const [searchParams] = useSearchParams()
  const navigate       = useNavigate()

  const ids = (searchParams.get('ids') || '').split(',').map(s => s.trim()).filter(Boolean)

  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState(null)
  const [festivals, setFestivals] = useState([])  // enriched festival objects
  const [retrying,  setRetrying]  = useState(new Set())  // IDs currently being re-fetched

  const myArtists = readMyArtists()

  /** Enrich one raw fetchTimetable result into the shape this page needs. */
  function enrichFestival(f) {
    const { matchedSlots, matchCount } = computeMatches(f.lineup, myArtists)
    return { ...f, matchedSlots, matchCount }
  }

  /** Build an error-placeholder object for a festival that failed to load. */
  function errorEntry(id, reason) {
    return {
      id,
      error: true,
      errorMessage: reason || 'Festival data unavailable',
      name:         id,
      emoji:        null,
      accentColor:  null,
      lineup:       [],
      matchedSlots: new Map(),
      matchCount:   0,
    }
  }

  useEffect(() => {
    if (ids.length === 0) { navigate('/setup', { replace: true }); return }

    Promise.allSettled(ids.map(id => fetchTimetable(id)))
      .then(results => {
        const enriched = ids.map((id, i) => {
          const r = results[i]
          if (r.status === 'fulfilled' && r.value?.festival) {
            return enrichFestival(r.value.festival)
          }
          const msg = r.status === 'rejected'
            ? (r.reason?.message || 'Unknown error')
            : 'Festival data unavailable'
          return errorEntry(id, msg)
        })

        if (enriched.every(f => f.error)) {
          setError('None of the selected festivals could be loaded.')
        } else {
          setFestivals(enriched)
        }
        setLoading(false)
      })
  }, [])   // eslint-disable-line react-hooks/exhaustive-deps — ids are from URL, stable on mount

  /** Re-fetch a single failed column without touching the others. */
  async function retryFestival(id) {
    setRetrying(prev => new Set([...prev, id]))
    try {
      const result = await fetchTimetable(id)
      if (result?.festival) {
        setFestivals(prev =>
          prev.map(f => f.id === id ? enrichFestival(result.festival) : f)
        )
      }
    } catch {
      // Leave the error state as-is; user can retry again.
    } finally {
      setRetrying(prev => { const n = new Set(prev); n.delete(id); return n })
    }
  }

  // ── Union of matched artists (use myArtists canonical name for display) ──
  const allMatchedArtists = myArtists
    .filter(artist => festivals.some(f => f.matchedSlots.has(norm(artist))))
    .sort((a, b) => a.localeCompare(b))

  // ── Loading state ──────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        height: '100vh', gap: 16,
        background: 'var(--fp-bg)',
        fontFamily: T.body,
      }}>
        <div style={{
          width: 22, height: 22,
          border: '2px solid #c8f400', borderTopColor: 'transparent',
          borderRadius: '50%', animation: 'fp-spin 0.8s linear infinite',
        }} />
        <div style={{ fontSize: 11, color: 'var(--fp-text-mute)', letterSpacing: 4, textTransform: 'uppercase' }}>
          Loading {ids.length} festival{ids.length !== 1 ? 's' : ''}…
        </div>
      </div>
    )
  }

  // ── Error state ────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        height: '100vh', gap: 16,
        background: 'var(--fp-bg)', fontFamily: T.body,
      }}>
        <div style={{ color: '#f44336', fontSize: 13 }}>{error}</div>
        <button onClick={() => navigate('/setup')} style={backBtnStyle}>
          ← Back to Setup
        </button>
      </div>
    )
  }

  const colW      = `${Math.floor(100 / (festivals.length + 1))}%`
  const artistColW = colW  // same width as data columns for symmetry

  return (
    <div style={{ minHeight: '100vh', background: 'var(--fp-bg)', color: 'var(--fp-text)' }}>

      {/* ── Header ── */}
      <header style={{
        borderBottom: '1px solid var(--fp-border)',
        padding:      '14px 24px',
        display:      'flex',
        alignItems:   'center',
        gap:          12,
        background:   'var(--fp-s1)',
      }}>
        <button onClick={() => navigate(-1)} style={{
          ...pillBtn(false),
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
          Back
        </button>
        <span style={{
          fontFamily:    T.display,
          fontSize:      13,
          fontWeight:    800,
          letterSpacing: 3,
          textTransform: 'uppercase',
          color:         'var(--fp-text)',
        }}>
          Festival Comparison
        </span>
        <span style={{
          marginLeft:    4,
          fontFamily:    T.body,
          fontSize:      10,
          fontWeight:    600,
          color:         'var(--fp-text-mute)',
          letterSpacing: 1,
        }}>
          {myArtists.length} artist{myArtists.length !== 1 ? 's' : ''} · {festivals.length} festival{festivals.length !== 1 ? 's' : ''}
        </span>
      </header>

      <div style={{ maxWidth: 900, margin: '0 auto', padding: '32px 20px 64px' }}>

        {/* ── Bar chart ── */}
        <div style={{
          background:   'var(--fp-card)',
          border:       '1px solid var(--fp-border)',
          borderRadius: 'var(--fp-radius-lg)',
          padding:      '22px 28px',
          marginBottom: 24,
          position:     'relative',
          overflow:     'hidden',
        }}>
          {/* Accent top strip */}
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, height: 2,
            background: 'linear-gradient(90deg, ' +
              festivals.filter(f => !f.error).map(f => f.accentColor || '#c8f400').join(', ') + ')',
          }} />

          <div style={{
            fontFamily:    T.body,
            fontSize:      10,
            fontWeight:    800,
            letterSpacing: 3,
            textTransform: 'uppercase',
            color:         'var(--fp-text-mute)',
            marginBottom:  18,
          }}>
            Your matches at a glance
          </div>

          <MatchBarChart festivals={festivals.filter(f => !f.error)} />
        </div>

        {/* ── Comparison table ── */}
        {allMatchedArtists.length === 0 ? (
          <div style={{
            background:   'var(--fp-card)',
            border:       '1px solid var(--fp-border)',
            borderRadius: 'var(--fp-radius-lg)',
            padding:      '40px 28px',
            textAlign:    'center',
            color:        'var(--fp-text-mute)',
            fontFamily:   T.body,
            fontSize:     13,
          }}>
            None of your saved artists appear in these festivals.
          </div>
        ) : (
          <div style={{
            background:   'var(--fp-card)',
            border:       '1px solid var(--fp-border)',
            borderRadius: 'var(--fp-radius-lg)',
            overflow:     'hidden',
          }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{
                width:           '100%',
                borderCollapse:  'collapse',
                minWidth:        festivals.length * 180 + 160,
                fontFamily:      T.body,
              }}>

                {/* Column headers */}
                <thead>
                  <tr>
                    {/* Artist column header */}
                    <th style={{
                      ...thBase,
                      width:       160,
                      minWidth:    140,
                      textAlign:   'left',
                      background:  'var(--fp-s1)',
                      position:    'sticky',
                      left:        0,
                      zIndex:      3,
                    }}>
                      Artist
                    </th>

                    {/* Festival column headers */}
                    {festivals.map(f => {
                      // ── Error column ──────────────────────────────────────
                      if (f.error) {
                        const isRetrying = retrying.has(f.id)
                        return (
                          <th key={f.id} style={{
                            ...thBase,
                            minWidth:      180,
                            background:    'var(--fp-s2)',
                            verticalAlign: 'middle',
                            textAlign:     'center',
                            padding:       '18px 16px',
                          }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
                              <span style={{ fontSize: 20 }}>⚠️</span>
                              <span style={{
                                fontFamily: T.body,
                                fontSize:   10,
                                fontWeight: 600,
                                color:      'var(--fp-text-mute)',
                                lineHeight: 1.4,
                                maxWidth:   140,
                              }}>
                                Couldn't load this festival
                              </span>
                              <button
                                onClick={() => retryFestival(f.id)}
                                disabled={isRetrying}
                                style={{
                                  ...pillBtn(false),
                                  padding:  '5px 14px',
                                  opacity:  isRetrying ? 0.5 : 1,
                                  cursor:   isRetrying ? 'default' : 'pointer',
                                }}
                              >
                                {isRetrying ? 'Loading…' : 'Retry?'}
                              </button>
                            </div>
                          </th>
                        )
                      }

                      // ── Normal column ─────────────────────────────────────
                      const ac = f.accentColor || '#c8f400'
                      return (
                        <th key={f.id} style={{
                          ...thBase,
                          minWidth:   180,
                          background: ac,
                          color:      '#000',
                          verticalAlign: 'top',
                        }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center' }}>
                            <span style={{ fontSize: 22, lineHeight: 1 }}>{f.emoji || '🎵'}</span>
                            <span style={{
                              fontFamily:    T.display,
                              fontSize:      11,
                              fontWeight:    900,
                              textTransform: 'uppercase',
                              letterSpacing: 1,
                              lineHeight:    1.2,
                              color:         '#000',
                            }}>
                              {f.name}
                            </span>
                            <span style={{
                              fontFamily: T.body,
                              fontSize:   13,
                              fontWeight: 800,
                              color:      '#000',
                            }}>
                              {f.matchCount} match{f.matchCount !== 1 ? 'es' : ''}
                            </span>
                          </div>
                        </th>
                      )
                    })}
                  </tr>
                </thead>

                {/* Artist rows */}
                <tbody>
                  {allMatchedArtists.map((artist, rowIdx) => {
                    const normArtist = norm(artist)
                    const isEven     = rowIdx % 2 === 0

                    return (
                      <tr key={artist} style={{ background: isEven ? 'transparent' : 'var(--fp-s1)' }}>

                        {/* Artist name (sticky) */}
                        <td style={{
                          ...tdBase,
                          fontWeight: 600,
                          fontSize:   13,
                          color:      'var(--fp-text)',
                          background: isEven ? 'var(--fp-card)' : 'var(--fp-s1)',
                          position:   'sticky',
                          left:       0,
                          zIndex:     1,
                        }}>
                          {artist}
                        </td>

                        {/* Festival cells */}
                        {festivals.map(f => {
                          // Error column — no data to show
                          if (f.error) {
                            return (
                              <td key={f.id} style={{ ...tdBase, color: 'var(--fp-text-mute)', textAlign: 'center' }}>
                                —
                              </td>
                            )
                          }

                          const slots  = f.matchedSlots.get(normArtist)
                          const ac     = f.accentColor || '#c8f400'
                          const isHit  = !!slots && slots.length > 0

                          if (!isHit) {
                            return (
                              <td key={f.id} style={{ ...tdBase, color: 'var(--fp-text-mute)', textAlign: 'center' }}>
                                —
                              </td>
                            )
                          }

                          // Show all occurrences (multiple days) separated by line breaks
                          const texts = slots.map(formatSlot).filter(Boolean)

                          return (
                            <td key={f.id} style={{
                              ...tdBase,
                              textAlign: 'center',
                              color:     ac,
                              fontWeight: 600,
                            }}>
                              {texts.map((t, ti) => (
                                <div key={ti} style={{ lineHeight: 1.5 }}>{t}</div>
                              ))}
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                </tbody>

                {/* Footer — total match counts */}
                <tfoot>
                  <tr style={{ borderTop: '1px solid var(--fp-border)' }}>
                    <td style={{
                      ...tdBase,
                      fontWeight:    800,
                      fontSize:      10,
                      letterSpacing: 1.5,
                      textTransform: 'uppercase',
                      color:         'var(--fp-text-mute)',
                      background:    'var(--fp-s1)',
                      position:      'sticky',
                      left:          0,
                    }}>
                      Your Matches
                    </td>

                    {festivals.map(f => {
                      if (f.error) {
                        return (
                          <td key={f.id} style={{ ...tdBase, textAlign: 'center', color: 'var(--fp-text-mute)' }}>
                            —
                          </td>
                        )
                      }
                      const ac = f.accentColor || '#c8f400'
                      return (
                        <td key={f.id} style={{
                          ...tdBase,
                          textAlign:  'center',
                          fontFamily: T.display,
                          fontSize:   20,
                          fontWeight: 900,
                          color:      ac,
                          background: `${ac}10`,
                        }}>
                          {f.matchCount}
                        </td>
                      )
                    })}
                  </tr>
                </tfoot>

              </table>
            </div>

            {/* Row count */}
            <div style={{
              padding:    '10px 18px',
              borderTop:  '1px solid var(--fp-border)',
              fontFamily: T.body,
              fontSize:   10,
              fontWeight: 600,
              color:      'var(--fp-text-mute)',
              letterSpacing: 1.5,
              textTransform: 'uppercase',
              background: 'var(--fp-s1)',
            }}>
              {allMatchedArtists.length} matched artist{allMatchedArtists.length !== 1 ? 's' : ''} shown
              {myArtists.length > allMatchedArtists.length && (
                <> · {myArtists.length - allMatchedArtists.length} of your artists don't play any of these festivals</>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Shared micro-styles ───────────────────────────────────────────────────────

const backBtnStyle = {
  background:    'transparent',
  color:         'var(--fp-text-mute)',
  border:        '1px solid var(--fp-border)',
  borderRadius:  'var(--fp-radius-sm)',
  padding:       '6px 14px',
  fontSize:      10,
  fontWeight:    700,
  letterSpacing: 2,
  textTransform: 'uppercase',
  cursor:        'pointer',
  fontFamily:    "var(--fp-font-body, sans-serif)",
  transition:    'all 0.2s ease',
  flexShrink:    0,
}

const thBase = {
  padding:       '14px 16px',
  fontFamily:    "var(--fp-font-body, sans-serif)",
  fontSize:      10,
  fontWeight:    800,
  letterSpacing: 1.5,
  textTransform: 'uppercase',
  color:         'var(--fp-text-mute)',
  borderBottom:  '1px solid var(--fp-border)',
  whiteSpace:    'nowrap',
}

const tdBase = {
  padding:    '9px 16px',
  fontFamily: "var(--fp-font-body, sans-serif)",
  fontSize:   12,
  borderBottom: '1px solid var(--fp-border)',
}
