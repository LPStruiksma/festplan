import React from 'react'
import { T } from '../../lib/ui'

/**
 * Amber warning section shown above the tabs when there are unresolved conflicts.
 *
 * Props:
 *   conflicts  — array of { key, a, b } (unresolved only — parent filters)
 *   fest       — festival object (needs .days for the day label)
 *   fa         — festival accent colour (accepted, currently unused)
 *   onResolve  — (conflictKey, chosenArtist) => void
 *   droppedPicks     — array of { conflict, picked, other }: picks whose winner
 *                      lost another clash, leaving the slot empty (optional)
 *   onDismissDropped — (conflictKey) => void, hides that pick-again prompt
 */
// Only announce schedule metadata that is actually available. A missing day,
// time or stage must never appear as "undefined" in a decision.
function textValue(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function dayLabel(slot, fest) {
  const day = slot?.day
  return Number.isInteger(day) && day >= 0 ? textValue(fest?.days?.[day]) : ''
}

function timeLabel(slot) {
  const start = textValue(slot?.start)
  const end = textValue(slot?.end)
  if (start && end) return `${start}–${end}`
  if (start) return `Starts ${start}`
  if (end) return `Ends ${end}`
  return ''
}

function slotDetails(slot, fest) {
  return [dayLabel(slot, fest), timeLabel(slot), textValue(slot?.stage)].filter(Boolean)
}

export default function ConflictBanner({ conflicts, fest, onResolve, droppedPicks = [], onDismissDropped }) {
  if (!conflicts.length && !droppedPicks.length) return null

  return (
    <div className="fp-animate-in" style={{ marginBottom: 22 }}>
      {conflicts.length > 0 && <div style={{
        fontFamily: T.body,
        fontSize: 9, fontWeight: 800, letterSpacing: 4,
        color: 'var(--fp-warn)', textTransform: 'uppercase', marginBottom: 12,
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0zM12 9v4M12 17h.01"/>
        </svg>
        {conflicts.length} Scheduling Conflict{conflicts.length > 1 ? 's' : ''}
      </div>}

      {conflicts.map(c => {
        const aDay = dayLabel(c.a, fest)
        const bDay = dayLabel(c.b, fest)
        const sharedDay = aDay && aDay === bDay ? aDay : ''
        return (
        <div key={c.key} role="group"
          aria-label={`Scheduling conflict: ${c.a.artist} and ${c.b.artist}${sharedDay ? ` on ${sharedDay}` : ''}`} style={{
          background: 'var(--fp-warn)' + '08',
          border: '1px solid var(--fp-warn)' + '40',
          borderRadius: 'var(--fp-radius-lg)',
          padding: '16px 18px',
          marginBottom: 10,
          animation: 'fp-scaleIn 0.3s ease both',
        }}>
          <div style={{
            fontFamily: T.body,
            fontSize: 13, color: 'var(--fp-warn)', marginBottom: 12, lineHeight: 1.5,
          }}>
            <strong>{c.a.artist}</strong> and <strong>{c.b.artist}</strong> overlap{sharedDay ? ` on ${sharedDay}` : ''}. Who do you want to see?
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {[c.a, c.b].map((slot, index) => {
              const other = index === 0 ? c.b : c.a
              const details = slotDetails(slot, fest)
              return (
              <button key={index} type="button"
                aria-label={[`Choose ${slot.artist} instead of ${other.artist}`, ...details].join(', ')}
                onClick={() => onResolve(c.key, slot.artist)}
                style={{
                  background: 'var(--fp-s2)',
                  color: 'var(--fp-text)',
                  border: '1px solid var(--fp-warn)' + '50',
                  borderRadius: 'var(--fp-radius-md)',
                  padding: '12px 16px',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontFamily: T.body,
                  transition: 'all 0.2s ease',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.borderColor = 'var(--fp-warn)'
                  e.currentTarget.style.background = 'var(--fp-warn)' + '12'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.borderColor = 'var(--fp-warn)' + '50'
                  e.currentTarget.style.background = 'var(--fp-s2)'
                }}
              >
                <div style={{
                  fontFamily: T.display,
                  fontSize: 15, fontWeight: 700,
                }}>Choose {slot.artist}</div>
                {details.length > 0 && <div style={{
                  fontSize: 10, color: 'var(--fp-text-dim)', marginTop: 3,
                  textTransform: 'uppercase', letterSpacing: 1.5,
                }}>{details.join(' · ')}</div>}
              </button>
              )
            })}
          </div>
        </div>
        )
      })}

      {droppedPicks.map(({ conflict, picked, other }) => {
        const pickedDetails = slotDetails(picked, fest)
        const otherDetails = slotDetails(other, fest)
        return (
        <div key={conflict.key} role="group" aria-label={`Pick again for ${picked.artist}`} style={{
          background: 'var(--fp-s2)',
          border: '1px solid var(--fp-border)',
          borderRadius: 'var(--fp-radius-lg)',
          padding: '12px 16px',
          marginBottom: 10,
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          fontFamily: T.body,
          animation: 'fp-scaleIn 0.3s ease both',
        }}>
          <div style={{ flex: '1 1 220px', fontSize: 13, color: 'var(--fp-text)', lineHeight: 1.5 }}>
            <strong>Pick again?</strong>{' '}
            {picked.artist} lost another clash, leaving this slot empty{pickedDetails.length ? ` (${pickedDetails.join(' · ')})` : ''}.
          </div>
          <button type="button"
            aria-label={[`See ${other.artist} instead of ${picked.artist}`, ...otherDetails].join(', ')}
            onClick={() => onResolve(conflict.key, other.artist)} style={{
            background: 'none', color: 'var(--fp-text)',
            border: '1px solid var(--fp-border)', borderRadius: 'var(--fp-radius-md)',
            padding: '8px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: T.body,
          }}>See {other.artist} instead</button>
          <button type="button" aria-label={`Leave it — keep ${picked.artist}'s slot empty`}
            onClick={() => onDismissDropped?.(conflict.key)} style={{
            background: 'none', color: 'var(--fp-text-dim)', border: 'none',
            padding: '8px 4px', fontSize: 12, cursor: 'pointer', fontFamily: T.body,
          }}>Leave it</button>
        </div>
        )
      })}
    </div>
  )
}
