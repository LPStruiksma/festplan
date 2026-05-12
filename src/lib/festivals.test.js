import { describe, test, expect } from 'vitest'
import { norm, toMins, overlaps } from './festivals'

// ─────────────────────────────────────────────────────────────────────────────
// norm — case-insensitive artist name normalisation
// ─────────────────────────────────────────────────────────────────────────────
describe('norm', () => {
  test('lower-cases the input', () => {
    expect(norm('Radiohead')).toBe('radiohead')
    expect(norm('IDLES')).toBe('idles')
    expect(norm('Charli XCX')).toBe('charli xcx')
  })

  test('trims surrounding whitespace', () => {
    expect(norm('  Tame Impala  ')).toBe('tame impala')
    expect(norm('\tBillie Eilish\n')).toBe('billie eilish')
  })

  test('is idempotent — already-normalised strings pass through unchanged', () => {
    expect(norm('the prodigy')).toBe('the prodigy')
  })

  test('preserves internal spaces and punctuation', () => {
    expect(norm("Guns N' Roses")).toBe("guns n' roses")
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// toMins — "HH:MM" → total minutes, with post-midnight correction
//
// Convention (matches SchedulePage): hours 0–5 are treated as 24–29 so that
// a set ending at "01:30" sorts after a set starting at "23:00" on the same day.
// ─────────────────────────────────────────────────────────────────────────────
describe('toMins', () => {
  // ── Null / undefined guard ──────────────────────────────────────────────────
  test('returns 0 for null (lineup-only slots)', () => {
    expect(toMins(null)).toBe(0)
  })

  test('returns 0 for undefined', () => {
    expect(toMins(undefined)).toBe(0)
  })

  // ── Daytime hours ───────────────────────────────────────────────────────────
  test('converts a standard afternoon time', () => {
    expect(toMins('14:00')).toBe(14 * 60)       // 840
  })

  test('converts a late-evening time', () => {
    expect(toMins('23:30')).toBe(23 * 60 + 30)  // 1410
  })

  // ── Post-midnight boundary ──────────────────────────────────────────────────
  // Hour 5 is the last post-midnight hour (5 < 6); hour 6 is NOT post-midnight.
  test('treats 00:00 as post-midnight (hour 24)', () => {
    expect(toMins('00:00')).toBe(24 * 60)        // 1440
  })

  test('treats 01:30 as post-midnight (hour 25)', () => {
    expect(toMins('01:30')).toBe(25 * 60 + 30)  // 1530
  })

  test('treats 05:59 as post-midnight (hour 29)', () => {
    expect(toMins('05:59')).toBe(29 * 60 + 59)  // 1799
  })

  test('treats 06:00 as NOT post-midnight — exact boundary stays daytime', () => {
    expect(toMins('06:00')).toBe(6 * 60)         // 360, not 30*60
  })

  test('treats 06:01 as NOT post-midnight', () => {
    expect(toMins('06:01')).toBe(6 * 60 + 1)     // 361
  })

  // ── Ordering guarantees ─────────────────────────────────────────────────────
  test('a post-midnight slot ends after a late-night slot on the same day', () => {
    expect(toMins('01:00')).toBeGreaterThan(toMins('23:30'))
  })

  test('00:30 is later than 23:00 (cross-midnight ordering)', () => {
    expect(toMins('00:30')).toBeGreaterThan(toMins('23:00'))
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// overlaps — slot conflict detection
//
// Slots: { day: number, start: "HH:MM" | null, end: "HH:MM" | null, ... }
// Two slots overlap when they share any time on the same calendar day.
// Open-ended comparison (start < end, end < start) means touching boundaries
// (e.g. 15:00–16:00 vs 16:00–17:00) do NOT overlap.
// ─────────────────────────────────────────────────────────────────────────────

// Helpers for building minimal slot objects
const slot = (day, start, end) => ({ artist: 'X', day, start, end })

describe('overlaps', () => {
  // ── Basic non-overlap cases ────────────────────────────────────────────────
  test('non-overlapping slots on the same day → false', () => {
    expect(overlaps(slot(0, '14:00', '15:00'), slot(0, '16:00', '17:00'))).toBe(false)
  })

  test('touching boundary slots (back-to-back) → false', () => {
    // 14:00–15:00 and 15:00–16:00: end of A equals start of B → no overlap
    expect(overlaps(slot(0, '14:00', '15:00'), slot(0, '15:00', '16:00'))).toBe(false)
  })

  test('slots on different days → false, even if times match', () => {
    expect(overlaps(slot(0, '14:00', '16:00'), slot(1, '14:30', '15:30'))).toBe(false)
  })

  // ── Basic overlap cases ────────────────────────────────────────────────────
  test('partially overlapping slots → true', () => {
    // 14:00–16:00 and 15:00–17:00 share 15:00–16:00
    expect(overlaps(slot(0, '14:00', '16:00'), slot(0, '15:00', '17:00'))).toBe(true)
  })

  test('one slot fully inside another → true', () => {
    expect(overlaps(slot(0, '14:00', '18:00'), slot(0, '15:00', '16:00'))).toBe(true)
  })

  test('identical time slots → true', () => {
    expect(overlaps(slot(0, '20:00', '21:00'), slot(0, '20:00', '21:00'))).toBe(true)
  })

  // ── Post-midnight overlap cases ────────────────────────────────────────────
  test('two post-midnight slots that overlap → true', () => {
    // 23:30–01:30 and 00:30–02:30 share 00:30–01:30
    // toMins: 23:30=1410, 01:30=1530, 00:30=1470, 02:30=1590
    // 1410 < 1590 && 1470 < 1530 → true
    expect(overlaps(slot(0, '23:30', '01:30'), slot(0, '00:30', '02:30'))).toBe(true)
  })

  test('late-night slot and post-midnight slot that overlap → true', () => {
    // 23:00–01:00 and 00:00–00:30
    // toMins: 23:00=1380, 01:00=1500, 00:00=1440, 00:30=1470
    // 1380 < 1470 && 1440 < 1500 → true
    expect(overlaps(slot(0, '23:00', '01:00'), slot(0, '00:00', '00:30'))).toBe(true)
  })

  test('post-midnight slots that do NOT overlap → false', () => {
    // 23:00–00:00 and 01:00–02:00 (gap between midnight and 1 am)
    // toMins: 23:00=1380, 00:00=1440, 01:00=1500, 02:00=1560
    // 1380 < 1560 (true) && 1500 < 1440 (false) → false
    expect(overlaps(slot(0, '23:00', '00:00'), slot(0, '01:00', '02:00'))).toBe(false)
  })

  // ── Lineup-only (null times) ───────────────────────────────────────────────
  test('slot with null start never overlaps → false', () => {
    expect(overlaps(slot(0, null, null), slot(0, '14:00', '15:00'))).toBe(false)
  })

  test('two null-time slots never overlap → false', () => {
    expect(overlaps(slot(0, null, null), slot(0, null, null))).toBe(false)
  })
})
