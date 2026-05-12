import { T } from '../../lib/ui'
import { toMins, norm } from '../../lib/festivals'

const STAGE_C = ['#e8c547', '#ff5577', '#22d3ee', '#c8f400', '#c084fc', '#fb923c']
const G_START = 14 * 60, CELL_H = 42, COL_W = 128, TIME_W = 50, G_ROWS = 24

/**
 * Horizontal timetable grid — one column per stage, 30-min row increments.
 *
 * Props:
 *   dayLineup  — all slots for the selected day (from fest.lineup)
 *   stages     — ordered stage name array
 *   myArtists  — user's saved artist list (for highlight)
 *   fa         — festival accent colour hex
 */
export default function GridView({ dayLineup, stages, myArtists, fa }) {
  const totalH = G_ROWS * CELL_H
  const labels = []
  for (let r = 0; r < G_ROWS; r++) {
    const m = G_START + r * 30
    if (m % 60 === 0) {
      const h = Math.floor(m / 60) % 24
      labels.push({ r, l: `${String(h).padStart(2, '0')}:00` })
    }
  }

  return (
    <div style={{
      overflowX: 'auto', overflowY: 'auto', maxHeight: '60vh',
      border: '1px solid var(--fp-border)',
      borderRadius: 'var(--fp-radius-lg)',
      animation: 'fp-fadeIn 0.3s ease both',
    }}>
      {/* Header row */}
      <div style={{
        display: 'flex',
        position: 'sticky', top: 0, zIndex: 10,
        minWidth: TIME_W + stages.length * COL_W,
      }}>
        <div style={{
          width: TIME_W, minWidth: TIME_W, flexShrink: 0,
          background: 'var(--fp-s1)',
          borderBottom: '1px solid var(--fp-border)',
        }} />
        {stages.map((s, i) => (
          <div key={s} style={{
            width: COL_W, minWidth: COL_W,
            padding: '10px 8px',
            fontFamily: T.body,
            fontSize: 9,
            fontWeight: 800,
            color: '#000',
            letterSpacing: 1.5,
            textTransform: 'uppercase',
            background: STAGE_C[i % STAGE_C.length],
            borderLeft: '1px solid rgba(0,0,0,.12)',
            borderBottom: '1px solid rgba(0,0,0,.12)',
          }}>{s}</div>
        ))}
      </div>

      {/* Grid body */}
      <div style={{ display: 'flex', minWidth: TIME_W + stages.length * COL_W }}>
        {/* Time column */}
        <div style={{
          width: TIME_W, minWidth: TIME_W, flexShrink: 0,
          position: 'relative', height: totalH,
          background: 'var(--fp-s1)',
          borderRight: '1px solid var(--fp-border)',
        }}>
          {labels.map(({ r, l }) => (
            <div key={r} style={{
              position: 'absolute', top: r * CELL_H - 7, right: 8,
              fontFamily: T.body, fontSize: 10, fontWeight: 500,
              color: 'var(--fp-text-dim)', whiteSpace: 'nowrap',
            }}>{l}</div>
          ))}
          {Array.from({ length: G_ROWS }, (_, r) => (
            <div key={r} style={{
              position: 'absolute', top: r * CELL_H, left: 0, right: 0, height: CELL_H,
              background: r % 2 === 0 ? 'var(--fp-s1)' : 'var(--fp-s2)',
              borderBottom: '1px solid var(--fp-border)',
            }} />
          ))}
        </div>

        {/* Stage columns */}
        {stages.map((stage, si) => {
          const slots = dayLineup.filter(s => s.stage === stage)
          const stageColor = STAGE_C[si % STAGE_C.length]
          return (
            <div key={stage} style={{
              width: COL_W, minWidth: COL_W,
              position: 'relative', height: totalH,
              borderLeft: '1px solid var(--fp-border)',
            }}>
              {Array.from({ length: G_ROWS }, (_, r) => (
                <div key={r} style={{
                  position: 'absolute', top: r * CELL_H, left: 0, right: 0, height: CELL_H,
                  background: r % 2 === 0 ? 'var(--fp-s1)' : 'var(--fp-s2)',
                  borderBottom: '1px solid var(--fp-border)',
                }} />
              ))}
              {slots.map(slot => {
                const sm = toMins(slot.start), em = toMins(slot.end)
                const top = ((sm - G_START) / 30) * CELL_H + 1
                const height = Math.max(((em - sm) / 30) * CELL_H - 2, 22)
                const mine = myArtists.some(a => norm(a) === norm(slot.artist))
                return (
                  <div key={slot.artist + slot.start} style={{
                    position: 'absolute', top, left: 3, right: 3, height,
                    background: mine ? stageColor : `${stageColor}20`,
                    border: mine ? 'none' : `1px solid ${stageColor}40`,
                    borderRadius: 'var(--fp-radius-sm)',
                    padding: '4px 6px',
                    overflow: 'hidden',
                    zIndex: 1,
                    transition: 'transform 0.15s ease',
                    cursor: 'default',
                  }}
                    onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.02)'}
                    onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
                  >
                    <div style={{
                      fontFamily: T.body,
                      fontSize: 10,
                      fontWeight: mine ? 800 : 500,
                      color: mine ? '#000' : `${stageColor}aa`,
                      lineHeight: 1.2,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>{slot.artist}</div>
                    {height > 32 && (
                      <div style={{
                        fontFamily: T.body,
                        fontSize: 9,
                        color: mine ? 'rgba(0,0,0,.5)' : `${stageColor}66`,
                        marginTop: 1,
                      }}>{slot.start}–{slot.end}</div>
                    )}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}
