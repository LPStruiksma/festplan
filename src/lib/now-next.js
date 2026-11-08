// "Now & next" for the festival ground: what from your picks is playing now,
// what comes next, and which picks clash in the next couple of hours.
//
// Pure and offline: it only reads the festival and the picks that are already
// loaded, and takes the clock as an argument so tests can pin it.
//
// Times in the timetable are festival wall-clock times ("HH:MM"). Hours before
// 06:00 belong to the night of their day (same rule as `toMins`), so a 01:30
// set on day 0 happens on the next calendar day. Wall times are turned into
// real instants in the festival's time zone, so a DST change during the
// festival still gives correct "minutes left" and "minutes until".

import { toMins } from './festivals'
import { festivalEndDate } from './upcoming'

export const FESTIVAL_TZ = 'Europe/Amsterdam'
export const CLASH_HORIZON_MINS = 120

const MIN = 60 * 1000
const DAY = 24 * 60 * MIN

const formatters = new Map()
function wallFormatter(tz) {
  if (!formatters.has(tz)) {
    formatters.set(tz, new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric',
    }))
  }
  return formatters.get(tz)
}

// Wall-clock parts of an instant in `tz`.
export function wallParts(epochMs, tz = FESTIVAL_TZ) {
  const parts = {}
  for (const p of wallFormatter(tz).formatToParts(new Date(epochMs))) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value)
  }
  return {
    year: parts.year, month: parts.month, day: parts.day,
    hour: parts.hour % 24, minute: parts.minute, second: parts.second,
  }
}

// Offset of `tz` from UTC at an instant, in ms (Amsterdam summer = +2 h).
function tzOffset(epochMs, tz) {
  const p = wallParts(epochMs, tz)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return asUtc - Math.floor(epochMs / 1000) * 1000
}

// Instant for a wall-clock time in `tz`. Tries the offsets in force 12 h
// either side, so a time next to a DST change still maps exactly. A repeated
// autumn time takes its first occurrence; a time skipped in spring lands an
// hour later on the clock (02:30 becomes 03:30).
export function zonedTimeToEpoch(year, month, day, hour, minute, tz = FESTIVAL_TZ) {
  const guess = Date.UTC(year, month - 1, day, hour, minute)
  const before = guess - tzOffset(guess - 12 * 60 * MIN, tz)
  const after = guess - tzOffset(guess + 12 * 60 * MIN, tz)
  const matches = [before, after].filter(c => {
    const p = wallParts(c, tz)
    return p.year === year && p.month === month && p.day === day && p.hour === hour && p.minute === minute
  })
  return matches.length ? Math.min(...matches) : before
}

function parseISODate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '')
  return m ? { year: +m[1], month: +m[2], day: +m[3] } : null
}

function isTime(t) {
  return typeof t === 'string' && /^\d{1,2}:\d{2}$/.test(t.trim())
}

// Real instant of a slot time: day index + "HH:MM" on the festival's clock.
export function slotTimeToEpoch(startDate, dayIndex, timeStr, tz = FESTIVAL_TZ) {
  const base = parseISODate(startDate)
  if (!base || !isTime(timeStr) || !Number.isInteger(dayIndex)) return null
  const mins = toMins(timeStr.trim()) // 0..(30*60), past midnight > 24*60
  const extraDays = dayIndex + Math.floor(mins / (24 * 60))
  const wallMins = mins % (24 * 60)
  const cal = new Date(Date.UTC(base.year, base.month - 1, base.day + extraDays))
  return zonedTimeToEpoch(
    cal.getUTCFullYear(), cal.getUTCMonth() + 1, cal.getUTCDate(),
    Math.floor(wallMins / 60), wallMins % 60, tz,
  )
}

// Festival day index that `now` falls in (night hours before 06:00 count for
// the previous day). Can be negative (before) or past the last day (after).
export function festivalDayIndex(startDate, now, tz = FESTIVAL_TZ) {
  const base = parseISODate(startDate)
  if (!base) return null
  const p = wallParts(now - 6 * 60 * MIN, tz)
  return Math.round(
    (Date.UTC(p.year, p.month - 1, p.day) - Date.UTC(base.year, base.month - 1, base.day)) / DAY,
  )
}

export function festivalDayCount(fest) {
  if (Array.isArray(fest?.days) && fest.days.length) return fest.days.length
  const start = parseISODate(fest?.startDate)
  const end = parseISODate(festivalEndDate(fest))
  if (!start || !end) return 1
  return Math.round(
    (Date.UTC(end.year, end.month - 1, end.day) - Date.UTC(start.year, start.month - 1, start.day)) / DAY,
  ) + 1
}

const minutesBetween = (from, to) => Math.max(0, Math.ceil((to - from) / MIN))

/**
 * @param {object} args
 * @param {object} args.fest       festival ({ startDate, days?, endDate? })
 * @param {Array}  args.schedule   your picks: [{ artist, day, start, end, stage }]
 * @param {Date|number} args.now   the clock (injectable for tests)
 * @param {string} [args.tz]       festival time zone (default Europe/Amsterdam)
 * @returns {{ status: 'hidden' } | {
 *   status: 'live',
 *   dayIndex: number,
 *   playing: Array<{ slot, minsLeft }>,
 *   next: { slot, minsUntil, today: boolean } | null,
 *   clashes: Array<[slot, slot]>,
 * }}
 *
 * 'hidden' means there is nothing to say on the ground: no start date, no
 * timed picks, or `now` is not on one of the festival's days.
 */
export function computeNowNext({ fest, schedule, now, tz = FESTIVAL_TZ, horizonMins = CLASH_HORIZON_MINS }) {
  const t = now instanceof Date ? now.getTime() : Number(now)
  const startDate = fest?.startDate
  if (!startDate || !Number.isFinite(t)) return { status: 'hidden' }

  const dayIndex = festivalDayIndex(startDate, t, tz)
  if (dayIndex == null || dayIndex < 0 || dayIndex >= festivalDayCount(fest)) return { status: 'hidden' }

  const timed = []
  for (const slot of schedule || []) {
    if (!slot || !isTime(slot.start) || !isTime(slot.end)) continue
    const from = slotTimeToEpoch(startDate, slot.day, slot.start, tz)
    let to = slotTimeToEpoch(startDate, slot.day, slot.end, tz)
    if (from == null || to == null) continue
    if (to <= from) to = from + 60 * MIN // bad data: assume an hour
    timed.push({ slot, from, to })
  }
  if (!timed.length) return { status: 'hidden' }
  timed.sort((a, b) => a.from - b.from || a.to - b.to)

  const playing = timed
    .filter(x => x.from <= t && t < x.to)
    .map(x => ({ slot: x.slot, minsLeft: minutesBetween(t, x.to) }))

  const upcoming = timed.find(x => x.from > t)
  const next = upcoming
    ? { slot: upcoming.slot, minsUntil: minutesBetween(t, upcoming.from), today: upcoming.slot.day === dayIndex }
    : null

  // Picks that overlap each other and touch the next `horizonMins`.
  const windowEnd = t + horizonMins * MIN
  const soon = timed.filter(x => x.to > t && x.from < windowEnd)
  const clashes = []
  for (let i = 0; i < soon.length; i++) {
    for (let j = i + 1; j < soon.length; j++) {
      if (soon[i].from < soon[j].to && soon[j].from < soon[i].to) clashes.push([soon[i].slot, soon[j].slot])
    }
  }

  return { status: 'live', dayIndex, playing, next, clashes }
}

// "45 min", "1 h 05 min", "3 h"
export function formatDuration(mins) {
  if (mins < 60) return `${mins} min`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m ? `${h} h ${String(m).padStart(2, '0')} min` : `${h} h`
}
