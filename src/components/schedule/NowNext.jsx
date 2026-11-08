import React, { useEffect, useState } from 'react'
import { T } from '../../lib/ui'
import { computeNowNext, formatDuration, FESTIVAL_TZ } from '../../lib/now-next'

/**
 * "Now & next" panel for the festival ground. Shows only on festival days.
 *
 * Props:
 *   fest          — festival ({ startDate, days })
 *   schedule      — your picks (finalSchedule from SchedulePage)
 *   isLineupOnly  — true when the festival has no timetable (panel hides)
 *   fa            — festival accent colour
 *   now           — optional fixed clock (Date or ms) for tests; when left
 *                   out the panel reads the device clock every 30 seconds
 *   tz            — festival time zone (default Europe/Amsterdam)
 */
const TICK_MS = 30 * 1000

function useClock(fixed) {
  const [tick, setTick] = useState(() => Date.now())
  useEffect(() => {
    if (fixed != null) return undefined
    const id = setInterval(() => setTick(Date.now()), TICK_MS)
    return () => clearInterval(id)
  }, [fixed])
  return fixed != null ? fixed : tick
}

const where = slot => [slot.start, slot.stage].filter(Boolean).join(' · ')

function Row({ label, color, children }) {
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'baseline', padding: '6px 0' }}>
      <div style={{
        flex: '0 0 44px', fontSize: 9, fontWeight: 800, letterSpacing: 2,
        textTransform: 'uppercase', color,
      }}>{label}</div>
      <div style={{ flex: 1, fontSize: 13, lineHeight: 1.5, color: 'var(--fp-text)' }}>{children}</div>
    </div>
  )
}

export default function NowNext({ fest, schedule, isLineupOnly, fa = 'var(--fp-text)', now, tz = FESTIVAL_TZ }) {
  const clock = useClock(now)
  if (isLineupOnly) return null

  const r = computeNowNext({ fest, schedule, now: clock, tz })
  if (r.status !== 'live') return null

  const { playing, next, clashes } = r
  const dim = { color: 'var(--fp-text-dim)' }
  const nextDay = next && !next.today ? fest?.days?.[next.slot.day] : ''

  return (
    <section aria-label="Now and next" className="fp-animate-in" style={{
      background: 'var(--fp-s1)',
      border: '1px solid var(--fp-border)',
      borderRadius: 'var(--fp-radius-lg)',
      padding: '14px 18px',
      marginBottom: 22,
      fontFamily: T.body,
    }}>
      <div style={{
        fontSize: 9, fontWeight: 800, letterSpacing: 4, textTransform: 'uppercase',
        color: fa, marginBottom: 6,
      }}>Now &amp; next</div>

      {playing.map(({ slot, minsLeft }) => (
        <Row key={`now-${slot.artist}`} label="Now" color={fa}>
          <strong>{slot.artist}</strong>
          {slot.stage && <span style={dim}> · {slot.stage}</span>}
          <span style={dim}> · {formatDuration(minsLeft)} left</span>
        </Row>
      ))}

      {next && next.today && (
        <Row label="Next" color="var(--fp-text-dim)">
          {!playing.length && <span style={dim}>Nothing from your picks is on right now. </span>}
          <strong>{next.slot.artist}</strong>
          {where(next.slot) && <span style={dim}> · {where(next.slot)}</span>}
          <span style={dim}> · in {formatDuration(next.minsUntil)}</span>
        </Row>
      )}

      {next && !next.today && (
        <Row label="Next" color="var(--fp-text-dim)">
          <span style={dim}>No more picks today. </span>
          Your first pick{nextDay ? ` on ${nextDay}` : ''} is <strong>{next.slot.artist}</strong>
          {where(next.slot) && <span style={dim}> · {where(next.slot)}</span>}.
        </Row>
      )}

      {!next && !playing.length && (
        <Row label="Done" color="var(--fp-text-dim)">
          That was your last pick. Enjoy the rest of the festival!
        </Row>
      )}

      {clashes.map(([a, b]) => (
        <div key={`clash-${a.artist}-${b.artist}`} role="note" style={{
          marginTop: 8, fontSize: 12, lineHeight: 1.5, color: 'var(--fp-warn)',
        }}>
          Heads-up: <strong>{a.artist}</strong> ({a.start}–{a.end}) and <strong>{b.artist}</strong> ({b.start}–{b.end}) overlap in the next 2 hours.
        </div>
      ))}
    </section>
  )
}
