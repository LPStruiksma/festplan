/**
 * ical.js
 * Builds the iCalendar (.ics) text for a user's final schedule.
 *
 * Pure: takes the festival, the schedule slots and the export time, and
 * returns the file text. SchedulePage › exportCalendar wraps it in a Blob.
 */
import { toMins } from './festivals'
import { getSlotDate } from './dates'

const pad2 = n => String(n).padStart(2, '0')

/** Escape a TEXT value (RFC 5545 §3.3.11): backslash, semicolon, comma, newline. */
export function escapeText(s) {
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n')
}

const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

// ── Date resolver ──────────────────────────────────────────────────────────
// Prefer the festival's ISO startDate (accurate, handles post-midnight
// slots correctly across month/year boundaries).
// Fall back to the legacy regex-year + MONTHS parse for live-discovered
// festivals that haven't been seeded with startDate yet.
function slotDateResolver(fest) {
  if (fest.startDate) return (dayIndex, timeStr) => getSlotDate(fest.startDate, dayIndex, timeStr)
  // Legacy path: extract year from name, parse "Mon Jan 1" day strings.
  const year   = parseInt(fest.name.match(/\d{4}/)?.[0] ?? new Date().getFullYear(), 10)
  const MONTHS = { Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12 }
  return (dayIndex, timeStr) => {
    const parts  = fest.days[dayIndex].split(' ')
    const month  = MONTHS[parts[1]]
    const dayNum = parseInt(parts[2], 10)
    const [hStr, mStr] = timeStr.split(':')
    const hour   = parseInt(hStr, 10)
    const min    = parseInt(mStr, 10)
    // Post-midnight slots (hour < 6) belong to the next calendar day.
    const calDay = hour < 6 ? dayNum + 1 : dayNum
    return new Date(year, month - 1, calDay, hour, min, 0)
  }
}

const toIcal = d =>
  `${d.getFullYear()}${pad2(d.getMonth()+1)}${pad2(d.getDate())}` +
  `T${pad2(d.getHours())}${pad2(d.getMinutes())}00`

/**
 * @param {object} fest      festival ({ id, name, startDate?, days })
 * @param {Array}  schedule  slots ({ artist, stage, day, start, end })\\; not mutated
 * @param {Date}   now       export time, used for DTSTAMP
 * @returns {string}         the .ics file text (CRLF line endings)
 */
export function buildIcs(fest, schedule, now) {
  const resolveSlotDate = slotDateResolver(fest)
  const dtstamp = toIcal(now).replace(/T\d{6}$/, 'T000000Z')

  const vevents = [...schedule]
    .sort((a, b) => a.day - b.day || toMins(a.start) - toMins(b.start))
    .map(s => [
      'BEGIN:VEVENT',
      `DTSTART:${toIcal(resolveSlotDate(s.day, s.start))}`,
      `DTEND:${toIcal(resolveSlotDate(s.day, s.end))}`,
      `SUMMARY:${escapeText(`${s.artist} @ ${s.stage}`)}`,
      `LOCATION:${escapeText(fest.name)}`,
      // Built from the slot itself, not its export position, so re-importing
      // after a schedule change updates events instead of duplicating them.
      `UID:${slug(fest.id)}-d${s.day}-${s.start.replace(':', '')}-${slug(s.stage)}-${slug(s.artist)}@festplan.app`,
      `DTSTAMP:${dtstamp}`,
      'END:VEVENT',
    ].join('\r\n'))

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Festplan//Festival Planner//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(`${fest.name} — My Schedule`)}`,
    ...vevents,
    'END:VCALENDAR',
  ].join('\r\n')
}
