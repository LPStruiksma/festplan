import { pillBtn } from '../../lib/ui'

/**
 * Row of pill buttons — one per festival day.
 * Shows a count badge for how many of the user's picks are on that day.
 *
 * Props:
 *   days         — string[] from fest.days, e.g. ["Fri Apr 10", "Sat Apr 11"]
 *   day          — currently selected day index
 *   onDayChange  — (index) => void
 *   finalSchedule — the conflict-resolved slot list — used to compute per-day counts
 *   fa           — festival accent colour
 */
export default function DaySelector({ days, day, onDayChange, finalSchedule, fa }) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {days.map((d, i) => {
        const cnt = finalSchedule.filter(s => s.day === i).length
        return (
          <button key={i} onClick={() => onDayChange(i)} style={{
            ...pillBtn(day === i, fa),
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            {d}
            {cnt > 0 && (
              <span style={{
                fontSize: 9,
                background: day === i ? 'rgba(0,0,0,.2)' : `${fa}20`,
                color: day === i ? '#000' : fa,
                borderRadius: 10,
                padding: '1px 7px',
                fontWeight: 900,
              }}>{cnt}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}
