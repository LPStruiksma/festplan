import React from 'react'
import { T } from '../../lib/ui'
import { toMins, norm } from '../../lib/festivals'

/**
 * Vertical slot list — the default view for both lineup-only and timetable festivals.
 *
 * Props:
 *   dayLineup   — slots to render (already filtered to day / mode by the parent)
 *   myArtists   — user's saved artist list
 *   fa          — festival accent colour hex
 *   ratings     — { [artistName]: 1–5 }
 *   onRate      — (artist, stars) => void   — null in group-view contexts
 *   groupPeople — [{ name, artists, color }] — null when group is empty
 */
export default function ListView({ dayLineup, myArtists, fa, ratings, onRate, groupPeople }) {
  // Lineup-only slots have start: null — sort alphabetically by artist.
  // Full-timetable slots sort by start time.
  const sorted = [...dayLineup].sort((a, b) =>
    a.start != null
      ? toMins(a.start) - toMins(b.start)
      : a.artist.localeCompare(b.artist)
  )

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 6,
      animation: 'fp-fadeIn 0.3s ease both',
    }}>
      {sorted.map((slot, i) => {
        const mine = myArtists.some(a => norm(a) === norm(slot.artist))
        const goingPeople = groupPeople?.filter(p => p.artists.some(a => norm(a) === norm(slot.artist))) || []
        const allGoing = groupPeople && groupPeople.length > 1 && goingPeople.length === groupPeople.length
        return (
          <div key={i} style={{
            display: 'flex',
            borderRadius: 'var(--fp-radius-md)',
            border: `1px solid ${allGoing ? '#fff' : mine ? fa : 'var(--fp-border)'}`,
            overflow: 'hidden',
            background: mine ? `${fa}0c` : 'var(--fp-card)',
            transition: 'all 0.15s ease',
            animation: `fp-slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1) ${i * 0.025}s both`,
          }}
            onMouseEnter={e => e.currentTarget.style.transform = 'translateX(3px)'}
            onMouseLeave={e => e.currentTarget.style.transform = 'translateX(0)'}
          >
            {/* Time block — hidden for lineup-only slots (no time data) */}
            {slot.start != null ? (
              <div style={{
                background: mine ? fa : 'var(--fp-s2)',
                color: mine ? '#000' : 'var(--fp-text-dim)',
                padding: '12px 14px',
                minWidth: 82,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                borderRight: `1px solid ${mine ? fa + '40' : 'var(--fp-border)'}`,
                flexShrink: 0,
              }}>
                <div style={{
                  fontFamily: T.body, fontSize: 15, fontWeight: 800,
                  letterSpacing: '-0.5px', lineHeight: 1,
                }}>{slot.start}</div>
                <div style={{
                  fontSize: 7, opacity: 0.5, letterSpacing: 2,
                  margin: '3px 0', textTransform: 'uppercase',
                }}>to</div>
                <div style={{
                  fontFamily: T.body, fontSize: 12, fontWeight: 600, opacity: 0.8,
                }}>{slot.end}</div>
              </div>
            ) : (
              /* Lineup-only: colour strip replaces the time block */
              <div style={{
                background: mine ? fa : 'var(--fp-s2)',
                width: 4, minWidth: 4, flexShrink: 0,
              }} />
            )}

            {/* Content */}
            <div style={{ padding: '12px 16px', flex: 1, display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontFamily: T.display,
                  fontSize: 15,
                  fontWeight: 700,
                  color: mine ? 'var(--fp-text)' : 'var(--fp-text-dim)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}>{slot.artist}</div>
                <div style={{
                  fontFamily: T.body,
                  fontSize: 10,
                  color: 'var(--fp-text-mute)',
                  textTransform: 'uppercase',
                  letterSpacing: 1.5,
                  marginTop: 3,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}>
                  {slot.stage && <span>{slot.stage}</span>}
                  {goingPeople.length > 0 && (
                    <span style={{ display: 'flex', gap: 3 }}>
                      {goingPeople.map(p => (
                        <span key={p.name} title={p.name} style={{
                          width: 7, height: 7, borderRadius: '50%',
                          background: p.color, display: 'inline-block',
                        }} />
                      ))}
                    </span>
                  )}
                  {allGoing && (
                    <span style={{
                      color: '#fff', fontWeight: 800, fontSize: 9, letterSpacing: 1,
                    }}>ALL GOING</span>
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5, flexShrink: 0 }}>
                {mine && (
                  <div style={{
                    fontSize: 8, fontWeight: 800, letterSpacing: 2,
                    color: fa, textTransform: 'uppercase',
                    padding: '3px 8px',
                    border: `1px solid ${fa}50`,
                    borderRadius: 3,
                    background: `${fa}08`,
                  }}>Your Pick</div>
                )}
                {mine && onRate && (
                  <div style={{ display: 'flex', gap: 2 }}>
                    {[1, 2, 3, 4, 5].map(s => (
                      <span key={s}
                        onClick={() => onRate(slot.artist, s)}
                        style={{
                          cursor: 'pointer', fontSize: 13,
                          color: (ratings[slot.artist] || 0) >= s ? fa : 'var(--fp-border2)',
                          transition: 'color 0.15s ease',
                        }}
                      >★</span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
