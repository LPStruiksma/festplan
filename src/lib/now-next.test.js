import { describe, it, expect } from 'vitest'
import {
  computeNowNext, slotTimeToEpoch, festivalDayIndex, festivalDayCount,
  zonedTimeToEpoch, formatDuration,
} from './now-next'

// Summer festival, Amsterdam time is UTC+2. Friday 26 June 2026 is day 0.
const FEST = { startDate: '2026-06-26', days: ['Fri Jun 26', 'Sat Jun 27', 'Sun Jun 28'] }

const pick = (artist, day, start, end, stage = 'Main') => ({ artist, day, start, end, stage })

const SCHEDULE = [
  pick('Opener', 0, '14:00', '15:00', 'Alpha'),
  pick('Headliner', 0, '21:00', '22:30', 'Main'),
  pick('Night DJ', 0, '01:00', '03:00', 'Club'), // night of Friday → Sat 01:00
  pick('Saturday Act', 1, '16:00', '17:00', 'Bravo'),
]

// Amsterdam wall time → instant (summer: UTC+2).
const ams = (y, mo, d, h, mi) => new Date(Date.UTC(y, mo - 1, d, h - 2, mi))

describe('slotTimeToEpoch', () => {
  it('places a slot on its festival day in Amsterdam time', () => {
    expect(slotTimeToEpoch('2026-06-26', 0, '14:00')).toBe(ams(2026, 6, 26, 14, 0).getTime())
  })
  it('puts sets before 06:00 on the next calendar day', () => {
    expect(slotTimeToEpoch('2026-06-26', 0, '01:00')).toBe(ams(2026, 6, 27, 1, 0).getTime())
  })
  it('returns null for missing data', () => {
    expect(slotTimeToEpoch(null, 0, '14:00')).toBeNull()
    expect(slotTimeToEpoch('2026-06-26', 0, null)).toBeNull()
  })
})

describe('festivalDayIndex / festivalDayCount', () => {
  it('counts the night before 06:00 as the previous festival day', () => {
    expect(festivalDayIndex('2026-06-26', ams(2026, 6, 27, 2, 0).getTime())).toBe(0)
    expect(festivalDayIndex('2026-06-26', ams(2026, 6, 27, 7, 0).getTime())).toBe(1)
    expect(festivalDayIndex('2026-06-26', ams(2026, 6, 25, 12, 0).getTime())).toBe(-1)
  })
  it('uses days, else endDate, else one day', () => {
    expect(festivalDayCount(FEST)).toBe(3)
    expect(festivalDayCount({ startDate: '2026-06-26', endDate: '2026-06-29' })).toBe(4)
    expect(festivalDayCount({ startDate: '2026-06-26' })).toBe(1)
  })
})

describe('computeNowNext', () => {
  const at = now => computeNowNext({ fest: FEST, schedule: SCHEDULE, now })

  it('shows what is playing now with minutes left, and what is next', () => {
    const r = at(ams(2026, 6, 26, 14, 20))
    expect(r.status).toBe('live')
    expect(r.playing).toEqual([{ slot: SCHEDULE[0], minsLeft: 40 }])
    expect(r.next).toEqual({ slot: SCHEDULE[1], minsUntil: 400, today: true })
    expect(r.clashes).toEqual([])
  })

  it('before the first set of the day: nothing playing, next is today', () => {
    const r = at(ams(2026, 6, 26, 11, 0))
    expect(r.playing).toEqual([])
    expect(r.next).toMatchObject({ slot: SCHEDULE[0], minsUntil: 180, today: true })
  })

  it('handles sets after midnight as part of the same festival day', () => {
    const r = at(ams(2026, 6, 27, 1, 30))
    expect(r.dayIndex).toBe(0)
    expect(r.playing).toEqual([{ slot: SCHEDULE[2], minsLeft: 90 }])
    expect(r.next).toMatchObject({ slot: SCHEDULE[3], today: false })
  })

  it('after the last pick of a day, next is a later day', () => {
    const r = at(ams(2026, 6, 27, 4, 0))
    expect(r.playing).toEqual([])
    expect(r.next).toMatchObject({ slot: SCHEDULE[3], today: false })
  })

  it('none: no more picks on the last day', () => {
    const r = at(ams(2026, 6, 28, 12, 0))
    expect(r.status).toBe('live')
    expect(r.playing).toEqual([])
    expect(r.next).toBeNull()
  })

  it('is hidden outside the festival days', () => {
    expect(at(ams(2026, 6, 25, 12, 0)).status).toBe('hidden')
    expect(at(ams(2026, 6, 29, 12, 0)).status).toBe('hidden')
  })

  it('is hidden without a start date or without timed picks', () => {
    const now = ams(2026, 6, 26, 14, 0)
    expect(computeNowNext({ fest: { days: ['a'] }, schedule: SCHEDULE, now }).status).toBe('hidden')
    expect(computeNowNext({ fest: FEST, schedule: [pick('Lineup only', 0, null, null)], now }).status).toBe('hidden')
    expect(computeNowNext({ fest: FEST, schedule: [], now }).status).toBe('hidden')
  })

  it('warns about picks that overlap within the next 2 hours', () => {
    const schedule = [
      pick('A', 0, '18:00', '19:00'),
      pick('B', 0, '18:30', '19:30'),
      pick('C', 0, '22:00', '23:00'),
      pick('D', 0, '22:30', '23:30'),
    ]
    const r = computeNowNext({ fest: FEST, schedule, now: ams(2026, 6, 26, 17, 0) })
    expect(r.clashes).toEqual([[schedule[0], schedule[1]]])
  })

  it('does not count back-to-back sets as a clash', () => {
    const schedule = [pick('A', 0, '18:00', '19:00'), pick('B', 0, '19:00', '20:00')]
    const r = computeNowNext({ fest: FEST, schedule, now: ams(2026, 6, 26, 17, 30) })
    expect(r.clashes).toEqual([])
  })

  it('lists two picks playing at once', () => {
    const schedule = [pick('A', 0, '18:00', '19:00'), pick('B', 0, '18:30', '19:30')]
    const r = computeNowNext({ fest: FEST, schedule, now: ams(2026, 6, 26, 18, 45) })
    expect(r.playing.map(p => p.slot.artist)).toEqual(['A', 'B'])
    expect(r.clashes).toHaveLength(1)
  })

  it('is DST-safe: a set across the autumn clock change has its real length', () => {
    // 25 Oct 2026: 03:00 CEST becomes 02:00 CET. A 01:00–04:00 set lasts 4 real hours.
    const fest = { startDate: '2026-10-24', days: ['Sat'] }
    const schedule = [pick('ADE closing', 0, '01:00', '04:00')]
    const start = zonedTimeToEpoch(2026, 10, 25, 1, 0)
    expect(start).toBe(Date.UTC(2026, 9, 24, 23, 0)) // 01:00 CEST
    const end = slotTimeToEpoch('2026-10-24', 0, '04:00')
    expect(end).toBe(Date.UTC(2026, 9, 25, 3, 0)) // 04:00 CET
    const r = computeNowNext({ fest, schedule, now: start })
    expect(r.playing[0].minsLeft).toBe(240)
  })

  it('is DST-safe in spring: minutes until next across the clock jump', () => {
    // 29 Mar 2026: 02:00 CET becomes 03:00 CEST. 01:30 → 04:00 is 90 real minutes.
    const fest = { startDate: '2026-03-28', days: ['Sat'] }
    const schedule = [pick('Late set', 0, '04:00', '05:00')]
    const now = zonedTimeToEpoch(2026, 3, 29, 1, 30)
    const r = computeNowNext({ fest, schedule, now })
    expect(r.next.minsUntil).toBe(90)
  })

  it('accepts a number or a Date as the clock', () => {
    const d = ams(2026, 6, 26, 14, 20)
    expect(computeNowNext({ fest: FEST, schedule: SCHEDULE, now: d.getTime() })).toEqual(at(d))
  })
})

describe('formatDuration', () => {
  it('formats minutes and hours', () => {
    expect(formatDuration(5)).toBe('5 min')
    expect(formatDuration(60)).toBe('1 h')
    expect(formatDuration(65)).toBe('1 h 05 min')
  })
})

describe('zonedTimeToEpoch around DST changes', () => {
  it('maps times next to the spring change exactly', () => {
    expect(zonedTimeToEpoch(2026, 3, 29, 1, 30)).toBe(Date.UTC(2026, 2, 29, 0, 30))
    expect(zonedTimeToEpoch(2026, 3, 29, 3, 30)).toBe(Date.UTC(2026, 2, 29, 1, 30))
  })
  it('moves a skipped spring time an hour later', () => {
    expect(zonedTimeToEpoch(2026, 3, 29, 2, 30)).toBe(Date.UTC(2026, 2, 29, 1, 30))
  })
  it('takes the first occurrence of a repeated autumn time', () => {
    expect(zonedTimeToEpoch(2026, 10, 25, 2, 30)).toBe(Date.UTC(2026, 9, 25, 0, 30))
  })
})
