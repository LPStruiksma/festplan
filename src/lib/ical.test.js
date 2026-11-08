import { describe, it, expect } from 'vitest'
import { buildIcs, escapeText, foldLine, normalizeReminder } from './ical'

const fest = { id: 'testfest', name: 'Test Fest 2026', startDate: '2026-04-10', days: ['Fri Apr 10', 'Sat Apr 11'] }
const NOW = new Date(2026, 3, 1, 12, 0, 0)

const slot = (artist, stage, day, start, end) => ({ artist, stage, day, start, end })
const lines = ics => ics.split('\r\n')
const unfold = ics => ics.replace(/\r\n /g, '')
const octets = s => new TextEncoder().encode(s).length
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/
const uidOf = (ics, artist) => {
  const evs = unfold(ics).split('BEGIN:VEVENT').slice(1)
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

  it('writes a real UTC DTSTAMP with seconds, not local midnight', () => {
    const instant = new Date('2027-01-01T00:20:37+02:00')
    const ics = buildIcs(fest, [slot('A', 'B', 0, '21:00', '22:00')], instant)
    expect(lines(ics)).toContain('DTSTAMP:20261231T222037Z')
  })

  it('keeps a slot UID stable across exports at different instants', () => {
    const item = slot('A', 'Main Stage', 0, '21:00', '22:00')
    const first = buildIcs(fest, [item], new Date('2026-04-01T01:02:03Z'))
    const next = buildIcs(fest, [item], new Date('2026-04-02T04:05:06Z'))
    expect(uidOf(first, 'A @ Main Stage')).toBe(uidOf(next, 'A @ Main Stage'))
    expect(first).toContain('DTSTAMP:20260401T010203Z')
    expect(next).toContain('DTSTAMP:20260402T040506Z')
  })

  it('rolls an overnight slot across New Year on the ISO startDate path', () => {
    const newYear = { ...fest, startDate: '2026-12-31', days: ['Thu Dec 31'] }
    const ics = buildIcs(newYear, [slot('A', 'Main', 0, '23:30', '00:30')], NOW)
    expect(lines(ics)).toContain('DTSTART:20261231T233000')
    expect(lines(ics)).toContain('DTEND:20270101T003000')
  })

  it('rolls a post-midnight end at or after 06:00 across a month boundary', () => {
    const january = { ...fest, startDate: '2027-01-31', days: ['Sun Jan 31'] }
    const ics = buildIcs(january, [slot('A', 'Main', 0, '23:45', '07:00')], NOW)
    expect(lines(ics)).toContain('DTSTART:20270131T234500')
    expect(lines(ics)).toContain('DTEND:20270201T070000')
  })

  it('keeps an end after a post-midnight start on the next day', () => {
    const newYear = { ...fest, startDate: '2026-12-31', days: ['Thu Dec 31'] }
    const ics = buildIcs(newYear, [slot('A', 'Main', 0, '05:30', '06:15')], NOW)
    expect(lines(ics)).toContain('DTSTART:20270101T053000')
    expect(lines(ics)).toContain('DTEND:20270101T061500')
  })

  it('handles a legacy festival crossing the end of a month', () => {
    const legacy = { id: 'old', name: 'Old Fest 2027', days: ['Sun Jan 31'] }
    const ics = buildIcs(legacy, [slot('A', 'Main', 0, '23:00', '07:00')], NOW)
    expect(lines(ics)).toContain('DTSTART:20270131T230000')
    expect(lines(ics)).toContain('DTEND:20270201T070000')
  })

  it('does not invent events for a festival without timetable slots', () => {
    const empty = Object.freeze([])
    const festival = Object.freeze({ ...fest })
    const ics = buildIcs(festival, empty, NOW)
    expect(ics).not.toContain('BEGIN:VEVENT')
    expect(ics).toContain('END:VCALENDAR')
    expect(empty).toHaveLength(0)
  })
})

describe('foldLine (RFC 5545 3.1)', () => {
  it('leaves a line of exactly 75 octets alone', () => {
    const line = 'X'.repeat(75)
    expect(foldLine(line)).toBe(line)
  })

  it('folds a 76-octet line into 75 octets plus a space-led continuation', () => {
    const line = 'X'.repeat(76)
    expect(foldLine(line)).toBe('X'.repeat(75) + '\r\n X')
  })

  it('keeps every physical line within 75 octets and unfolds to the original', () => {
    const line = 'SUMMARY:' + 'abcdefghij'.repeat(30)
    const folded = foldLine(line)
    for (const l of folded.split('\r\n')) expect(octets(l)).toBeLessThanOrEqual(75)
    expect(unfold(folded)).toBe(line)
  })

  it('counts multi-byte UTF-8 in octets and never splits a character', () => {
    // é is 2 octets, 米 is 3, the emoji is 4 (a surrogate pair in JS).
    const line = 'SUMMARY:' + 'é米🎸'.repeat(40)
    const folded = foldLine(line)
    for (const l of folded.split('\r\n')) {
      expect(octets(l)).toBeLessThanOrEqual(75)
      expect(l).not.toMatch(LONE_SURROGATE)
    }
    expect(unfold(folded)).toBe(line)
    // Octet-based folding needs more lines than a 75-character count would.
    expect(folded.split('\r\n').length).toBeGreaterThan(Math.ceil([...line].length / 74))
  })
})

describe('buildIcs folding', () => {
  it('folds long SUMMARY, LOCATION and UID lines to 75 octets', () => {
    const f = { ...fest, id: 'a-very-long-festival-identifier-that-goes-on', name: 'Ein sehr langer Festivalname mit Umlauten äöü und noch mehr Text 2026' }
    const ics = buildIcs(f, [slot('Godspeed You! Black Emperor feat. Sigur Rós', 'Großes Zelt am Wasser', 0, '21:00', '22:00')], NOW)
    for (const l of lines(ics)) {
      expect(octets(l)).toBeLessThanOrEqual(75)
      expect(l).not.toMatch(LONE_SURROGATE)
    }
    expect(lines(unfold(ics))).toContain('SUMMARY:Godspeed You! Black Emperor feat. Sigur Rós @ Großes Zelt am Wasser')
  })
})

describe('buildIcs UIDs for non-ASCII names', () => {
  const uids = ics => unfold(ics).match(/UID:.*/g)

  it('gives names with no ASCII letters a non-empty, distinct UID part', () => {
    const ics = buildIcs(fest, [slot('米津玄師', 'S', 0, '20:00', '21:00'), slot('宇多田ヒカル', 'S', 0, '20:00', '21:00')], NOW)
    const [a, b] = uids(ics)
    expect(a).not.toBe(b)
    expect(a).not.toMatch(/-@festplan\.app$/)
  })

  it('tells apart names that differ only in non-ASCII letters', () => {
    const ics = buildIcs(fest, [slot('Sigur Rós', 'S', 0, '20:00', '21:00'), slot('Sigur Rös', 'S', 0, '20:00', '21:00')], NOW)
    const [a, b] = uids(ics)
    expect(a).not.toBe(b)
  })

  it('tells apart non-ASCII stages and festival ids too', () => {
    const one = buildIcs({ ...fest, id: 'フェス' }, [slot('A', 'ステージ', 0, '20:00', '21:00')], NOW)
    const two = buildIcs({ ...fest, id: 'フェス2' }, [slot('A', '舞台', 0, '20:00', '21:00')], NOW)
    expect(uids(one)[0]).not.toMatch(/^UID:-|--/)
    expect(uids(one)[0]).not.toBe(uids(two)[0])
  })

  it('keeps a non-ASCII UID stable across exports and Unicode normalization', () => {
    const composed = 'Sigur R\u00f3s'
    const decomposed = 'Sigur Ro\u0301s'
    const a = buildIcs(fest, [slot(composed, 'S', 0, '20:00', '21:00')], NOW)
    const b = buildIcs(fest, [slot(composed, 'S', 0, '20:00', '21:00')], new Date(2026, 5, 1))
    const c = buildIcs(fest, [slot(decomposed, 'S', 0, '20:00', '21:00')], NOW)
    expect(uids(a)).toEqual(uids(b))
    expect(uids(a)).toEqual(uids(c))
  })

  it('uses only ASCII in UIDs', () => {
    const ics = buildIcs(fest, [slot('Ólafur Arnalds', 'Zelt ä', 0, '20:00', '21:00')], NOW)
    expect(uids(ics)[0]).toMatch(/^UID:[\x21-\x7e]+$/)
  })

  it('keeps UIDs for plain ASCII names unchanged', () => {
    const ics = buildIcs(fest, [slot('Big Thief', 'Main Stage', 0, '21:30', '23:00')], NOW)
    expect(uids(ics)).toEqual(['UID:testfest-d0-2130-main-stage-big-thief@festplan.app'])
  })
})

describe('buildIcs reminders (VALARM)', () => {
  const remFest = { id: 'f', name: 'Fest', startDate: '2026-06-26', days: ['Fri'] }
  const one = [{ artist: 'Bicep', stage: 'Main', day: 0, start: '21:00', end: '22:00' }]
  const alarms = ics => ics.split('\r\n').filter(l => l.startsWith('TRIGGER:'))

  it('adds one display alarm per pick, 15 minutes before by default', () => {
    const two = [...one, { artist: 'Fred', stage: 'Club', day: 0, start: '23:00', end: '23:59' }]
    const ics = buildIcs(remFest, two, NOW)
    expect(alarms(ics)).toEqual(['TRIGGER:-PT15M', 'TRIGGER:-PT15M'])
    const lines = ics.split('\r\n')
    const ev = lines.slice(lines.indexOf('BEGIN:VEVENT'), lines.indexOf('END:VEVENT') + 1)
    expect(ev.slice(-6)).toEqual([
      'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Bicep @ Main', 'TRIGGER:-PT15M', 'END:VALARM', 'END:VEVENT',
    ])
  })

  it('supports 0 and 30 minutes, and none', () => {
    expect(alarms(buildIcs(remFest, one, NOW, { reminderMins: 0 }))).toEqual(['TRIGGER:PT0M'])
    expect(alarms(buildIcs(remFest, one, NOW, { reminderMins: 30 }))).toEqual(['TRIGGER:-PT30M'])
    const none = buildIcs(remFest, one, NOW, { reminderMins: null })
    expect(none).not.toContain('VALARM')
  })

  it('falls back to 15 minutes for an unsupported value', () => {
    expect(alarms(buildIcs(remFest, one, NOW, { reminderMins: 7 }))).toEqual(['TRIGGER:-PT15M'])
    expect(alarms(buildIcs(remFest, one, NOW, { reminderMins: 'abc' }))).toEqual(['TRIGGER:-PT15M'])
  })

  it('escapes the alarm text', () => {
    const ics = buildIcs(remFest, [{ ...one[0], artist: 'Tyler, The Creator' }], NOW)
    expect(ics).toContain('DESCRIPTION:Tyler\\, The Creator @ Main')
  })
})

describe('normalizeReminder', () => {
  it('keeps 0/15/30 and null, defaults the rest to 15', () => {
    expect([0, 15, 30, '30', null, undefined, 5].map(normalizeReminder)).toEqual([0, 15, 30, 30, null, 15, 15])
  })
})
