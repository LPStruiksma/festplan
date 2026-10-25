import { describe, it, expect } from 'vitest'
import { getSlotDate } from './dates'

describe('getSlotDate', () => {
  it('puts an after-midnight slot on the next calendar day', () => {
    const d = getSlotDate('2026-04-10', 0, '00:30')
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 3, 11])
    expect([d.getHours(), d.getMinutes()]).toEqual([0, 30])
  })

  it('keeps a late-evening slot on its festival day', () => {
    const d = getSlotDate('2026-04-10', 0, '23:30')
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 3, 10])
    expect([d.getHours(), d.getMinutes()]).toEqual([23, 30])
  })

  it('ends a 23:30–00:30 set after it starts', () => {
    const start = getSlotDate('2026-04-10', 0, '23:30')
    const end = getSlotDate('2026-04-10', 0, '00:30')
    expect(end.getTime() - start.getTime()).toBe(60 * 60 * 1000)
  })

  it('crosses a month boundary', () => {
    const d = getSlotDate('2026-06-30', 0, '01:00')
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 6, 1])
    expect(d.getHours()).toBe(1)
  })

  it('treats 06:00 as the same festival day', () => {
    const d = getSlotDate('2026-04-10', 1, '06:00')
    expect(d.getDate()).toBe(11)
  })
})
