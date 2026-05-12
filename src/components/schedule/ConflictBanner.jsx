import React from 'react'
import { T } from '../../lib/ui'

/**
 * Amber warning section shown above the tabs when there are unresolved conflicts.
 *
 * Props:
 *   conflicts  — array of { key, a, b } (unresolved only — parent filters)
 *   fest       — festival object (needs .days for the day label)
 *   fa         — festival accent colour
 *   onResolve  — (conflictKey, chosenArtist) => void
 */
export default function ConflictBanner({ conflicts, fest, fa, onResolve }) {
  if (!conflicts.length) return null

  return (
    <div className="fp-animate-in" style={{ marginBottom: 22 }}>
      <div style={{
        fontFamily: T.body,
        fontSize: 9, fontWeight: 800, letterSpacing: 4,
        color: 'var(--fp-warn)', textTransform: 'uppercase', marginBottom: 12,
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0zM12 9v4M12 17h.01"/>
        </svg>
        {conflicts.length} Scheduling Conflict{conflicts.length > 1 ? 's' : ''}
      </div>

      {conflicts.map(c => (
        <div key={c.key} style={{
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
            <strong>{c.a.artist}</strong> and <strong>{c.b.artist}</strong> overlap on{' '}
            {fest.days[c.a.day]}. Who do you want to see?
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {[c.a, c.b].map(slot => (
              <button key={slot.artist}
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
                }}>{slot.artist}</div>
                <div style={{
                  fontSize: 10, color: 'var(--fp-text-dim)', marginTop: 3,
                  textTransform: 'uppercase', letterSpacing: 1.5,
                }}>{slot.start}–{slot.end} · {slot.stage}</div>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
