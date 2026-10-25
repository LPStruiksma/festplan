import { describe, it, expect } from 'vitest'
import { buildIcs, escapeText } from './ical'

const fest = { id: 'testfest', name: 'Test Fest 2026', startDate: '2026-04-10', days: ['Fri Apr 10', 'Sat Apr 11'] }
const NOW = new Date(2026, 3, 1, 12, 0, 0)

const slot = (artist, stage, day, start, end) => ({ artist, stage, day, start, end })
const lines = ics => ics.split('\r\n')
const uidOf = (ics, artist) => {
  const evs = ics.split('BEGIN:VEVENT').slice(1)
  const ev = evs.find(e => e.includes(`SUMMARY:${escapeText(artist)}`))
  return ev.match(/UID:(.*)\r\n/)[1]
}

describe('escapeText', () => {
  it('escapes backslash, semicolon, comma and newlines (RFC 5545 3.3.11)', () => {
    expect(escapeText('a\\b;c,d\ne\r\nf')).toBe('a\\\\b\\;c\\,d\\ne\\nf')
  })
})

describe('buildIcs', () => {
  it('escapes commas and semicolons in SUMMARY', () => {
    const ics = buildIcs(fest, [slot('Tyler, The Creator', 'Main; Outdoor', 0, '21:00', '22:00')], NOW)
    expect(lines(ics)).toContain('SUMMARY:Tyler\\, The Creator @ Main\\; Outdoor')
  })

  it('escapes LOCATION and X-WR-CALNAME', () => {
    const f = { ...fest, name: 'Fest, Day; Night' }
    const ics = buildIcs(f, [slot('A', 'B', 0, '21:00', '22:00')], NOW)
    expect(lines(ics)).toContain('LOCATION:Fest\\, Day\\; Night')
    expect(lines(ics)).toContain('X-WR-CALNAME:Fest\\, Day\\; Night — My Schedule')
  })

  it('keeps a slot UID the same when another slot is added before it', () => {
    const later = slot('Big Thief', 'Main Stage', 0, '21:30', '23:00')
    const before = buildIcs(fest, [later], NOW)
    const after = buildIcs(fest, [slot('Alex G', 'Patronaat', 0, '20:00', '21:00'), later], NOW)
    expect(uidOf(after, 'Big Thief')).toBe(uidOf(before, 'Big Thief'))
  })

  it('gives the same artist on two days different UIDs', () => {
    const ics = buildIcs(fest, [slot('X', 'S', 0, '20:00', '21:00'), slot('X', 'S', 1, '20:00', '21:00')], NOW)
    const uids = ics.match(/UID:.*/g)
    expect(new Set(uids).size).toBe(2)
  })

  it('does not reorder the input array', () => {
    const input = [slot('Late', 'S', 1, '22:00', '23:00'), slot('Early', 'S', 0, '20:00', '21:00')]
    const copy = [...input]
    const ics = buildIcs(fest, input, NOW)
    expect(input).toEqual(copy)
    expect(input[0]).toBe(copy[0])
    expect(ics.indexOf('SUMMARY:Early')).toBeLessThan(ics.indexOf('SUMMARY:Late'))
  })

  it('puts an after-midnight end on the next calendar day', () => {
    const ics = buildIcs(fest, [slot('N', 'S', 0, '23:30', '00:30')], NOW)
    expect(lines(ics)).toContain('DTSTART:20260410T233000')
    expect(lines(ics)).toContain('DTEND:20260411T003000')
  })

  it('handles the legacy no-startDate path after midnight', () => {
    const legacy = { id: 'old', name: 'Old Fest 2025', days: ['Fri Jun 13'] }
    const ics = buildIcs(legacy, [slot('N', 'S', 0, '23:30', '01:00')], NOW)
    expect(lines(ics)).toContain('DTSTART:20250613T233000')
    expect(lines(ics)).toContain('DTEND:20250614T010000')
  })

  it('writes DTSTAMP from the given time', () => {
    const ics = buildIcs(fest, [slot('A', 'B', 0, '21:00', '22:00')], NOW)
    expect(lines(ics)).toContain('DTSTAMP:20260401T000000Z')
  })
})
