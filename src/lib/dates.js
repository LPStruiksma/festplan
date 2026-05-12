/**
 * dates.js
 * Helpers for turning a festival's ISO startDate + a 0-based day index into
 * useful date objects / display strings.
 *
 * Used by:
 *  - SchedulePage › exportCalendar (replaces the regex-year + MONTHS hack)
 *  - Future: day-header display, "X days away" countdown, etc.
 */

const DAY_NAMES   = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                     'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * Return a Date object for a festival day.
 *
 * @param {string} startDate  ISO date string, e.g. "2026-06-25"
 * @param {number} dayIndex   0-based index (0 = first day of festival)
 * @returns {Date}            Midnight local time on that calendar day
 */
export function getDayDate(startDate, dayIndex) {
  // Parse as local midnight (YYYY-MM-DD without time/zone → local)
  const [y, m, d] = startDate.split('-').map(Number)
  const base = new Date(y, m - 1, d)        // month is 0-based in Date()
  base.setDate(base.getDate() + dayIndex)
  return base
}

/**
 * Format a festival day as a short human-readable string.
 *
 * @param {string} startDate  ISO date string, e.g. "2026-06-25"
 * @param {number} dayIndex   0-based index
 * @returns {string}          e.g. "Thu Jun 25"
 */
export function formatFestivalDay(startDate, dayIndex) {
  const date = getDayDate(startDate, dayIndex)
  const dow   = DAY_NAMES[date.getDay()]
  const mon   = MONTH_NAMES[date.getMonth()]
  const day   = date.getDate()
  return `${dow} ${mon} ${day}`
}

/**
 * Build a Date from an iCal-style "DTSTART" given a festival startDate and
 * a slot's day index + time string ("HH:MM").
 *
 * Equivalent to the old parseSlotDate() inside SchedulePage but reads the
 * year/month/day from the festival model instead of regex-extracting the year
 * from the festival name.
 *
 * @param {string} startDate  ISO date string, e.g. "2026-06-25"
 * @param {number} dayIndex   0-based day index within the festival
 * @param {string} timeStr    "HH:MM" (24-hour, local time)
 * @returns {Date}
 */
export function getSlotDate(startDate, dayIndex, timeStr) {
  const base = getDayDate(startDate, dayIndex)
  const [hh, mm] = timeStr.split(':').map(Number)
  base.setHours(hh, mm, 0, 0)
  return base
}
