import React from 'react'
import { pillBtn } from '../../lib/ui'
import { useIsMobile } from '../../lib/use-is-mobile'

/**
 * Row of pill buttons — one per festival day.
 * Shows a count badge for how many of the user's picks are on that day.
 *
 * Desktop: wraps naturally.
 * Mobile: horizontal scroll with scroll-snap so swipes land cleanly on a day.
 *
 * Props:
 *   days         — string[] from fest.days, e.g. ["Fri Apr 10", "Sat Apr 11"]
 *   day          — currently selected day index
 *   onDayChange  — (index) => void
 *   finalSchedule — the conflict-resolved slot list — used to compute per-day counts
 *   fa           — festival accent colour
 */
export default function DaySelector({ days, day, onDayChange, finalSchedule, fa }) {
  const isMobile = useIsMobile()
  const [focusedDay, setFocusedDay] = React.useState(null)

  return (
    <div role="group" aria-label="Festival days" style={{
      display: 'flex',
      gap: 6,
      // Mobile: horizontal scrolling row that snaps to each pill
      ...(isMobile ? {
        flexWrap: 'nowrap',
        overflowX: 'auto',
        scrollSnapType: 'x mandatory',
        scrollPaddingInline: 8,
        WebkitOverflowScrolling: 'touch',
        // Hide the scrollbar visually but keep it functional
        scrollbarWidth: 'none',
        msOverflowStyle: 'none',
        // Extend padding so the last pill doesn't sit flush against the edge
        paddingBottom: 4,
      } : {
        flexWrap: 'wrap',
      }),
    }}>
      {days.map((d, i) => {
        const cnt = finalSchedule.filter(s => s.day === i).length
        return (
          <button
            key={i}
            type="button"
            aria-pressed={day === i}
            aria-label={`${d}, ${cnt} ${cnt === 1 ? 'pick' : 'picks'}`}
            onClick={() => onDayChange(i)}
            onFocus={event => {
              setFocusedDay(i)
              // Tab focus should bring off-screen mobile pills into view.
              if (isMobile) event.currentTarget.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
            }}
            onBlur={() => setFocusedDay(null)}
            style={{
              ...pillBtn(day === i, fa),
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              outline: focusedDay === i ? `2px solid ${fa}` : undefined,
              outlineOffset: focusedDay === i ? 2 : undefined,
              // Mobile: snap each pill, prevent shrinking, ensure 44px tap target
              ...(isMobile ? {
                scrollSnapAlign: 'start',
                scrollMarginInline: 8,
                flexShrink: 0,
                minHeight: 44,
                whiteSpace: 'nowrap',
              } : {}),
            }}
          >
            {d}
            <span aria-hidden="true" style={{
              fontSize: 9,
              background: day === i ? 'rgba(0,0,0,.2)' : `${fa}20`,
              color: day === i ? '#000' : fa,
              borderRadius: 10,
              padding: '1px 7px',
              fontWeight: 900,
            }}>{cnt}</span>
          </button>
        )
      })}
    </div>
  )
}
