import { describe, it, expect } from 'vitest'
import { festivalEndDate, isPastFestival, splitPastFestivals, localISODate } from './upcoming'

// One injected "today" for every case: Tuesday 3 November 2026, mid-afternoon.
const TODAY = new Date(2026, 10, 3, 15, 30)

const past     = { id: 'past',     startDate: '2026-08-13', endDate: '2026-08-16' }
const running  = { id: 'running',  startDate: '2026-11-01', endDate: '2026-11-03' }
const upcoming = { id: 'upcoming', startDate: '2027-06-24', endDate: '2027-06-28' }

describe('localISODate', () => {
  it('uses the local calendar day', () => {
    expect(localISODate(TODAY)).toBe('2026-11-03')
    expect(localISODate(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05')
  })
})

describe('festivalEndDate', () => {
  it('prefers endDate', () => {
    expect(festivalEndDate(past)).toBe('2026-08-16')
  })
  it('falls back to startDate plus the number of days', () => {
    expect(festivalEndDate({ startDate: '2026-12-30', days: ['a', 'b', 'c'] })).toBe('2027-01-01')
  })
  it('falls back to startDate alone, then null', () => {
    expect(festivalEndDate({ startDate: '2026-11-02' })).toBe('2026-11-02')
    expect(festivalEndDate({ id: 'undated' })).toBeNull()
  })
})

describe('isPastFestival', () => {
  it('a festival that ended before today is past', () => {
    expect(isPastFestival(past, TODAY)).toBe(true)
  })
  it('a festival running today is not past', () => {
    expect(isPastFestival(running, TODAY)).toBe(false)
  })
  it('an upcoming festival is not past', () => {
    expect(isPastFestival(upcoming, TODAY)).toBe(false)
  })
  it('a festival whose last day was yesterday is past', () => {
    expect(isPastFestival({ startDate: '2026-10-30', endDate: '2026-11-02' }, TODAY)).toBe(true)
  })
  it('uses startDate plus days when endDate is missing', () => {
    expect(isPastFestival({ startDate: '2026-11-01', days: ['a', 'b', 'c'] }, TODAY)).toBe(false)
    expect(isPastFestival({ startDate: '2026-10-31', days: ['a', 'b', 'c'] }, TODAY)).toBe(true)
  })
  it('keeps a festival without dates (cannot tell, so do not hide it)', () => {
    expect(isPastFestival({ id: 'undated' }, TODAY)).toBe(false)
  })
})

describe('splitPastFestivals', () => {
  it('splits a list into upcoming and past, keeping order', () => {
    const { upcoming: up, past: gone } = splitPastFestivals([past, running, upcoming], TODAY)
    expect(up.map(f => f.id)).toEqual(['running', 'upcoming'])
    expect(gone.map(f => f.id)).toEqual(['past'])
  })
  it('handles a missing list', () => {
    expect(splitPastFestivals(undefined, TODAY)).toEqual({ upcoming: [], past: [] })
  })
})
