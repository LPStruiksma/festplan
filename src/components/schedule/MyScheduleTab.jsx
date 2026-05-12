import { T } from '../../lib/ui'
import DaySelector from './DaySelector'
import ViewToggle from './ViewToggle'
import ListView from './ListView'
import GridView from './GridView'

/**
 * "My Schedule" tab content.
 *
 * Props:
 *   isLineupOnly  — boolean — switches layout between timetable and lineup-only modes
 *   fa            — festival accent colour
 *   fest          — festival object
 *   day           — selected day index
 *   setDay        — (index) => void
 *   viewMode      — 'list' | 'grid'
 *   setViewMode   — (mode) => void
 *   dayMatched    — conflict-resolved slots for the selected day (or all for lineup-only)
 *   dayLineup     — all slots for the selected day (full lineup, not just mine)
 *   myArtists     — user's saved artist list
 *   ratings       — { [artistName]: 1–5 }
 *   onRate        — (artist, stars) => void
 *   friends       — current friends array (used to decide whether to show group dots)
 *   allParticipants — [{ name, artists, color }] incl. "Me"
 *   finalSchedule — full conflict-resolved list (passed to DaySelector for counts)
 */
export default function MyScheduleTab({
  isLineupOnly, fa, fest,
  day, setDay, viewMode, setViewMode,
  dayMatched, dayLineup, myArtists,
  ratings, onRate,
  friends, allParticipants, finalSchedule,
}) {
  return (
    <>
      {/* Timetable coming soon banner — only for lineup-only festivals */}
      {isLineupOnly && (
        <div className="fp-animate-in" style={{
          display: 'flex', alignItems: 'center', gap: 12,
          background: `${fa}0a`,
          border: `1px solid ${fa}30`,
          borderRadius: 'var(--fp-radius-md)',
          padding: '12px 16px',
          marginBottom: 18,
          animation: 'fp-fadeIn 0.4s ease both',
        }}>
          <span style={{ fontSize: 18, flexShrink: 0 }}>🕐</span>
          <div>
            <div style={{
              fontFamily: T.body,
              fontSize: 10, fontWeight: 800, letterSpacing: 2,
              textTransform: 'uppercase', color: fa, marginBottom: 2,
            }}>Timetable Coming Soon</div>
            <div style={{ fontSize: 12, color: 'var(--fp-text-dim)' }}>
              The full stage schedule hasn't been published yet. Your matched artists are listed
              below — ratings and group matching already work.
            </div>
          </div>
        </div>
      )}

      {/* Day selector + view toggle — only for full-timetable festivals */}
      {!isLineupOnly && (
        <div className="fp-animate-in fp-stagger-2" style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
          flexWrap: 'wrap',
          gap: 10,
        }}>
          <DaySelector
            days={fest.days}
            day={day}
            onDayChange={setDay}
            finalSchedule={finalSchedule}
            fa={fa}
          />
          <ViewToggle viewMode={viewMode} onViewChange={setViewMode} />
        </div>
      )}

      {/* Empty state */}
      {dayMatched.length === 0 && (
        <div style={{
          textAlign: 'center', padding: '52px 20px',
          color: 'var(--fp-text-mute)',
          animation: 'fp-fadeIn 0.4s ease both',
        }}>
          <div style={{ fontSize: 36, marginBottom: 10, opacity: 0.4 }}>—</div>
          <div style={{
            fontFamily: T.body,
            fontSize: 11, letterSpacing: 2, textTransform: 'uppercase',
          }}>
            {isLineupOnly
              ? 'None of your artists are on this lineup.'
              : 'None of your artists play on this day.'}
          </div>
        </div>
      )}

      {/* Lineup-only: always list view; timetable: honour viewMode */}
      {(isLineupOnly || viewMode === 'list')
        ? <ListView
            dayLineup={dayLineup}
            myArtists={myArtists}
            fa={fa}
            ratings={ratings}
            onRate={onRate}
            groupPeople={friends.length > 0 ? allParticipants : null}
          />
        : <GridView
            dayLineup={dayLineup}
            stages={fest.stages}
            myArtists={myArtists}
            fa={fa}
          />
      }

      {dayMatched.length > 0 && (
        <p style={{
          fontSize: 11, color: 'var(--fp-text-mute)', marginTop: 16,
          animation: 'fp-fadeIn 0.5s ease 0.3s both',
        }}>
          ★ Click stars on your picks to rate acts after the festival.
        </p>
      )}
    </>
  )
}
