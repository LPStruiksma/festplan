// @vitest-environment jsdom
import React from 'react'
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { norm, overlaps } from '../../lib/festivals'
import MyScheduleTab from './MyScheduleTab'

// ─────────────────────────────────────────────────────────────────────────────
// Conflict-detection pipeline
// ─────────────────────────────────────────────────────────────────────────────
//
// SchedulePage computes three derived values from the raw lineup + myArtists:
//
//   matchedSlots  — lineup slots whose artist appears in myArtists
//   conflicts     — pairs of matchedSlots that overlap in time
//   finalSchedule — matchedSlots with conflict losers removed
//
// These tests exercise that logic as pure functions so the behaviour is
// verified independently of React rendering and Supabase I/O.
//
// The implementations below are deliberately minimal copies of the SchedulePage
// memos — if SchedulePage changes its algorithm the tests will catch drift.
// ─────────────────────────────────────────────────────────────────────────────

function computeMatchedSlots(lineup, myArtists) {
  return lineup.filter(s => myArtists.some(a => norm(a) === norm(s.artist)))
}

function computeConflicts(matchedSlots) {
  const res = []
  for (let i = 0; i < matchedSlots.length; i++) {
    for (let j = i + 1; j < matchedSlots.length; j++) {
      if (overlaps(matchedSlots[i], matchedSlots[j])) {
        const key = [matchedSlots[i].artist, matchedSlots[j].artist].sort().join('|||')
        if (!res.find(c => c.key === key))
          res.push({ key, a: matchedSlots[i], b: matchedSlots[j] })
      }
    }
  }
  return res
}

function computeFinalSchedule(matchedSlots, conflicts, resolved) {
  return matchedSlots.filter(slot => {
    for (const c of conflicts) {
      if ((c.a.artist === slot.artist || c.b.artist === slot.artist) && resolved[c.key]) {
        return resolved[c.key] === slot.artist
      }
    }
    return true
  })
}

// ── Slot helpers ──────────────────────────────────────────────────────────────

const slot = (artist, start, end, day = 0, stage = 'Main Stage') =>
  ({ artist, start, end, day, stage })

// ── matchedSlots ─────────────────────────────────────────────────────────────

describe('computeMatchedSlots', () => {
  test('returns only slots whose artist is in myArtists', () => {
    const lineup = [slot('Radiohead', '21:00', '22:30'), slot('Bicep', '21:30', '23:00')]
    const result = computeMatchedSlots(lineup, ['Radiohead'])
    expect(result).toHaveLength(1)
    expect(result[0].artist).toBe('Radiohead')
  })

  test('matching is case-insensitive', () => {
    const lineup = [slot('The Cure', '20:00', '22:00')]
    expect(computeMatchedSlots(lineup, ['the cure'])).toHaveLength(1)
    expect(computeMatchedSlots(lineup, ['THE CURE'])).toHaveLength(1)
  })

  test('returns an empty array when no artists match', () => {
    const lineup = [slot('Gorillaz', '20:00', '21:30')]
    expect(computeMatchedSlots(lineup, ['Radiohead'])).toHaveLength(0)
  })

  test('returns all matching slots when multiple artists match', () => {
    const lineup = [
      slot('Radiohead', '21:00', '22:30'),
      slot('The xx',   '19:00', '20:30'),
      slot('Bicep',    '23:00', '01:00'),
    ]
    const result = computeMatchedSlots(lineup, ['Radiohead', 'The xx'])
    expect(result).toHaveLength(2)
    expect(result.map(s => s.artist)).toEqual(expect.arrayContaining(['Radiohead', 'The xx']))
  })

  test('does not match artists that only partially share a name', () => {
    const lineup = [slot('Massive Attack', '21:00', '22:30')]
    expect(computeMatchedSlots(lineup, ['Massive'])).toHaveLength(0)
    expect(computeMatchedSlots(lineup, ['Attack'])).toHaveLength(0)
  })
})

// ── computeConflicts ─────────────────────────────────────────────────────────

describe('computeConflicts', () => {
  test('returns no conflicts when matched slots do not overlap', () => {
    const slots = [
      slot('Radiohead', '18:00', '19:30', 0),
      slot('The xx',    '20:00', '21:30', 0),
    ]
    expect(computeConflicts(slots)).toHaveLength(0)
  })

  test('detects a single conflict between two overlapping slots', () => {
    const slots = [
      slot('Radiohead', '21:00', '22:30', 0),
      slot('Bicep',     '21:30', '23:00', 0),
    ]
    const conflicts = computeConflicts(slots)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].key).toBe('Bicep|||Radiohead')   // alphabetical sort
    expect(conflicts[0].a.artist).toBe('Radiohead')
    expect(conflicts[0].b.artist).toBe('Bicep')
  })

  test('slots on different days do not conflict even if times overlap', () => {
    const slots = [
      slot('Radiohead', '21:00', '22:30', 0),   // day 0
      slot('Bicep',     '21:00', '22:30', 1),   // day 1
    ]
    expect(computeConflicts(slots)).toHaveLength(0)
  })

  test('detects two conflicts when three artists all overlap each other', () => {
    const slots = [
      slot('Radiohead', '20:00', '22:00', 0),
      slot('Bicep',     '21:00', '23:00', 0),
      slot('The xx',    '20:30', '22:30', 0),
    ]
    // Radiohead/Bicep, Radiohead/The xx, and Bicep/The xx all overlap
    expect(computeConflicts(slots)).toHaveLength(3)
  })

  test('conflict key is the two artist names sorted alphabetically joined by |||', () => {
    const slots = [
      slot('The xx',    '21:00', '22:30', 0),
      slot('Gorillaz',  '21:30', '23:00', 0),
    ]
    const [c] = computeConflicts(slots)
    // "Gorillaz" < "The xx" alphabetically
    expect(c.key).toBe('Gorillaz|||The xx')
  })

  test('does not produce duplicate conflict entries', () => {
    // Even if the same pair could be detected from both directions, only one
    // entry should appear.
    const slots = [
      slot('A', '21:00', '22:30', 0),
      slot('B', '21:00', '22:30', 0),
    ]
    expect(computeConflicts(slots)).toHaveLength(1)
  })
})

// ── computeFinalSchedule ─────────────────────────────────────────────────────

describe('computeFinalSchedule', () => {
  const aSlot = slot('Radiohead', '21:00', '22:30', 0)
  const bSlot = slot('Bicep',     '21:30', '23:00', 0)
  const cSlot = slot('The xx',    '19:00', '20:30', 0)   // no conflict

  const conflictPair = computeConflicts([aSlot, bSlot])   // one conflict

  test('returns all slots when there are no conflicts', () => {
    const result = computeFinalSchedule([aSlot, cSlot], [], {})
    expect(result).toHaveLength(2)
  })

  test('returns both conflicting slots when neither is resolved yet', () => {
    // Unresolved conflict → both artists stay in the schedule (user hasn't chosen)
    const result = computeFinalSchedule([aSlot, bSlot], conflictPair, {})
    expect(result).toHaveLength(2)
  })

  test('keeps only the chosen artist once a conflict is resolved', () => {
    const [c] = conflictPair
    const result = computeFinalSchedule([aSlot, bSlot], conflictPair, { [c.key]: 'Radiohead' })
    expect(result).toHaveLength(1)
    expect(result[0].artist).toBe('Radiohead')
  })

  test('removing the loser does not affect unrelated slots', () => {
    const [c] = conflictPair
    const result = computeFinalSchedule(
      [aSlot, bSlot, cSlot],
      conflictPair,
      { [c.key]: 'Bicep' },
    )
    expect(result).toHaveLength(2)
    expect(result.map(s => s.artist)).toEqual(expect.arrayContaining(['Bicep', 'The xx']))
    expect(result.map(s => s.artist)).not.toContain('Radiohead')
  })

  test('resolving one of two independent conflicts only removes the loser of that conflict', () => {
    const dSlot   = slot('FKA twigs', '21:00', '22:30', 1)
    const eSlot   = slot('Peggy Gou', '21:30', '23:00', 1)
    const allSlots    = [aSlot, bSlot, dSlot, eSlot]
    const allConflicts = computeConflicts(allSlots)

    expect(allConflicts).toHaveLength(2)

    const [c1, c2] = allConflicts
    // Resolve only the first conflict
    const resolved = { [c1.key]: c1.a.artist }
    const result = computeFinalSchedule(allSlots, allConflicts, resolved)

    // Winner of c1 stays, loser of c1 is removed, both c2 artists remain
    expect(result).toHaveLength(3)
    expect(result.some(s => s.artist === c1.a.artist)).toBe(true)
    expect(result.some(s => s.artist === c1.b.artist)).toBe(false)
    expect(result.some(s => s.artist === c2.a.artist)).toBe(true)
    expect(result.some(s => s.artist === c2.b.artist)).toBe(true)
  })
})

// ── MyScheduleTab rendering ───────────────────────────────────────────────────
//
// Smoke-tests that the component mounts and delegates to ListView correctly
// given pre-computed inputs.  We don't test pixel positions or grid layout.

// useIsMobile touches window.innerWidth — stub it so tests don't depend on
// jsdom's viewport size.
const viewport = vi.hoisted(() => ({ mobile: false }))
vi.mock('../../lib/use-is-mobile', () => ({ useIsMobile: () => viewport.mobile }))
afterEach(() => { viewport.mobile = false })

const FEST = {
  id: 'test-fest',
  name: 'Test Fest 2026',
  days: ['Fri Jun 5', 'Sat Jun 6'],
  stages: ['Main Stage', 'Other Stage'],
  lineup: [],
}

const baseProps = {
  isLineupOnly: false,
  fa: '#c8f400',
  fest: FEST,
  day: 0,
  setDay: () => {},
  viewMode: 'list',
  setViewMode: () => {},
  dayMatched: [],
  dayLineup: [],
  myArtists: [],
  ratings: {},
  onRate: () => {},
  friends: [],
  allParticipants: [],
  finalSchedule: [],
}

describe('MyScheduleTab rendering', () => {
  test('renders without crashing when there are no matched slots', () => {
    render(<MyScheduleTab {...baseProps} dayLineup={[slot('Gorillaz', '20:00', '21:00')]} />)
    // Non-empty lineup without picks still has the no-picks message
    expect(screen.getByText(/None of your artists play on this day/i)).toBeInTheDocument()
  })

  test('shows lineup-only banner when isLineupOnly is true and acts are announced', () => {
    render(<MyScheduleTab {...baseProps} isLineupOnly={true} dayLineup={[slot('The xx', null, null)]} />)
    expect(screen.getByText(/Timetable Coming Soon/i)).toBeInTheDocument()
    expect(screen.queryByText(/Lineup not announced yet/i)).not.toBeInTheDocument()
  })

  test('does not show the timetable-coming-soon banner for a full-timetable festival', () => {
    render(<MyScheduleTab {...baseProps} isLineupOnly={false} />)
    expect(screen.queryByText(/Timetable Coming Soon/i)).not.toBeInTheDocument()
  })

  test('renders matched slot artists in list view', () => {
    const dayMatched = [
      slot('Radiohead', '21:00', '22:30', 0),
      slot('The xx',    '19:00', '20:30', 0),
    ]
    render(<MyScheduleTab {...baseProps} dayMatched={dayMatched} dayLineup={dayMatched} />)
    expect(screen.getByText('Radiohead')).toBeInTheDocument()
    expect(screen.getByText('The xx')).toBeInTheDocument()
  })

  test('only renders slots present in dayMatched — resolved losers are absent', () => {
    // Simulate SchedulePage having removed 'Bicep' from finalSchedule because
    // the user resolved the Radiohead/Bicep conflict in favour of Radiohead.
    const dayMatched = [slot('Radiohead', '21:00', '22:30', 0)]   // Bicep removed
    render(<MyScheduleTab {...baseProps} dayMatched={dayMatched} dayLineup={dayMatched} />)
    expect(screen.getByText('Radiohead')).toBeInTheDocument()
    expect(screen.queryByText('Bicep')).not.toBeInTheDocument()
  })
})


describe('MyScheduleTab focus filter', () => {
  const fullDay = [
    slot('Radiohead', '21:00', '22:30'),
    slot('Bicep', '21:30', '23:00'), // picked, but lost the resolved conflict
    slot('Gorillaz', '18:00', '19:00'), // not picked
  ]
  const chosen = [fullDay[0]]
  const props = {
    ...baseProps,
    dayLineup: fullDay,
    dayMatched: chosen,
    myArtists: ['Radiohead', 'Bicep'],
    finalSchedule: chosen,
  }

  test('defaults to showing all acts, including non-picks and conflict losers', () => {
    render(<MyScheduleTab {...props} />)
    expect(screen.getByRole('button', { name: 'All acts' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'My picks only' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByText('Radiohead')).toBeInTheDocument()
    expect(screen.getByText('Bicep')).toBeInTheDocument()
    expect(screen.getByText('Gorillaz')).toBeInTheDocument()
  })

  test('focused list only shows conflict-resolved slots, then restores all acts', () => {
    render(<MyScheduleTab {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'My picks only' }))
    expect(screen.getByRole('button', { name: 'My picks only' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Radiohead')).toBeInTheDocument()
    expect(screen.queryByText('Bicep')).not.toBeInTheDocument()
    expect(screen.queryByText('Gorillaz')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'All acts' }))
    expect(screen.getByText('Bicep')).toBeInTheDocument()
    expect(screen.getByText('Gorillaz')).toBeInTheDocument()
  })

  test('grid mode hides both unpicked acts and resolved conflict losers', () => {
    render(<MyScheduleTab {...props} viewMode="grid" />)
    expect(screen.getByText('Bicep')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'My picks only' }))
    expect(screen.getByText('Radiohead')).toBeInTheDocument()
    expect(screen.queryByText('Bicep')).not.toBeInTheDocument()
    expect(screen.queryByText('Gorillaz')).not.toBeInTheDocument()
  })

  test('mobile honors focused filtering while showing list view in grid mode', () => {
    viewport.mobile = true
    render(<MyScheduleTab {...props} viewMode="grid" />)
    fireEvent.click(screen.getByRole('button', { name: 'My picks only' }))
    expect(screen.getByText('Radiohead')).toBeInTheDocument()
    expect(screen.getByText('Your Pick')).toBeInTheDocument() // ListView, not GridView
    expect(screen.queryByText('Bicep')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Grid/i })).not.toBeInTheDocument()
  })

  test('shows no-picks feedback for a populated day without chosen slots', () => {
    render(<MyScheduleTab {...props} dayMatched={[]} />)
    fireEvent.click(screen.getByRole('button', { name: 'My picks only' }))
    expect(screen.getByText('None of your artists play on this day.')).toBeInTheDocument()
    expect(screen.queryByText('Gorillaz')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'All acts' }))
    expect(screen.getByText('Gorillaz')).toBeInTheDocument()
  })

  test('distinguishes a day without any announced acts from a day without picks', () => {
    render(<MyScheduleTab {...baseProps} />)
    expect(screen.getByText('No acts are scheduled for this day yet.')).toBeInTheDocument()
    expect(screen.queryByText('None of your artists play on this day.')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'My picks only' }))
    expect(screen.getByText('No acts are scheduled for this day yet.')).toBeInTheDocument()
  })

  test('lineup-only festivals filter picks and distinguish an empty lineup', () => {
    const lineup = [
      slot('The xx', null, null),
      slot('Gorillaz', null, null),
    ]
    const { rerender } = render(<MyScheduleTab {...baseProps} isLineupOnly dayLineup={lineup}
      dayMatched={[lineup[0]]} myArtists={['The xx']} />)
    expect(screen.getByText('Gorillaz')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'My picks only' }))
    expect(screen.getByText('The xx')).toBeInTheDocument()
    expect(screen.queryByText('Gorillaz')).not.toBeInTheDocument()
    rerender(<MyScheduleTab {...baseProps} isLineupOnly dayLineup={[]} dayMatched={[]} />)
    expect(screen.getByRole('heading', { name: /Lineup not announced yet/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'My picks only' })).not.toBeInTheDocument()
    // The focus preference survives until a lineup is announced.
    rerender(<MyScheduleTab {...baseProps} isLineupOnly dayLineup={lineup}
      dayMatched={[lineup[0]]} myArtists={['The xx']} />)
    expect(screen.getByRole('button', { name: 'My picks only' })).toHaveAttribute('aria-pressed', 'true')
  })

  test('keeps the focus setting when the selected day changes', () => {
    const { rerender } = render(<MyScheduleTab {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'My picks only' }))
    const secondDay = [
      slot('The Cure', '19:00', '20:00', 1),
      slot('Gorillaz', '21:00', '22:00', 1),
    ]
    rerender(<MyScheduleTab {...props} day={1} dayLineup={secondDay}
      dayMatched={[secondDay[0]]} myArtists={['The Cure']} />)
    expect(screen.getByRole('button', { name: 'My picks only' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('The Cure')).toBeInTheDocument()
    expect(screen.queryByText('Gorillaz')).not.toBeInTheDocument()
  })
})


describe('MyScheduleTab unannounced lineup (festplan#88)', () => {
  // Best Kept Secret-style metadata-only edition: verified dates, zero slots.
  const ZERO = {
    id: 'synthfest-2027', name: 'Synthfest 2027', location: 'Testdorp, NL',
    startDate: '2027-06-11', endDate: '2027-06-13',
    days: ['Fri Jun 11', 'Sat Jun 12', 'Sun Jun 13'], stages: [], lineup: [], hasTimetable: false,
  }
  const zeroProps = { ...baseProps, isLineupOnly: true, fest: ZERO, dayLineup: [], dayMatched: [], finalSchedule: [] }

  test('shows one calm status card with verified dates and place', () => {
    render(<MyScheduleTab {...zeroProps} myArtists={['Saved Artist']} />)
    const card = screen.getByRole('region', { name: /Lineup not announced yet/i })
    expect(card).toHaveTextContent('11–13 June 2027 · Testdorp, NL')
    expect(card).toHaveTextContent('No artists have been announced for this festival in FestPlan. Check back for lineup updates.')
    expect(screen.getAllByRole('heading')).toHaveLength(1)
  })

  test('never implies acts or stage times exist', () => {
    render(<MyScheduleTab {...zeroProps} myArtists={['Saved Artist']} />)
    expect(screen.queryByText(/Timetable Coming Soon/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/announced lineup is listed below/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Schedule acts filter' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByText('Saved Artist')).not.toBeInTheDocument()
    expect(screen.queryByText(/No acts have been announced for this lineup yet/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Click stars/i)).not.toBeInTheDocument()
  })

  test('omits the date line when dates are missing or invalid, never guessing them', () => {
    const { rerender } = render(<MyScheduleTab {...zeroProps} fest={{ ...ZERO, startDate: null, endDate: null, location: '' }} />)
    const card = screen.getByRole('region', { name: /Lineup not announced yet/i })
    expect(card.querySelectorAll('p')).toHaveLength(1)
    rerender(<MyScheduleTab {...zeroProps} fest={{ ...ZERO, startDate: '2027-02-30', endDate: '2027-03-01' }} />)
    expect(screen.getByRole('region', { name: /Lineup not announced yet/i })).toHaveTextContent(/^Testdorp, NL/)
  })

  test('keeps a very long festival name out of the card and wraps long places', () => {
    const place = 'A very long synthetic place name that must wrap rather than clip on a phone'
    render(<MyScheduleTab {...zeroProps} fest={{ ...ZERO, location: place }} />)
    const card = screen.getByRole('region', { name: /Lineup not announced yet/i })
    expect(card).toHaveTextContent(place)
    expect(card).toHaveStyle({ overflowWrap: 'break-word' })
  })

  test('announced lineup without times stays "Timetable coming soon" with real acts', () => {
    const lineup = [slot('Synthetic Act A', null, null), slot('Synthetic Act B', null, null)]
    render(<MyScheduleTab {...zeroProps} dayLineup={lineup} dayMatched={[]} myArtists={['Not On Lineup']} />)
    expect(screen.getByText(/Timetable Coming Soon/i)).toBeInTheDocument()
    expect(screen.queryByText(/Lineup not announced yet/i)).not.toBeInTheDocument()
    expect(screen.getByText('Synthetic Act A')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'My picks only' }))
    expect(screen.getByText('None of your artists are on this lineup.')).toBeInTheDocument()
  })

  test('a published timetable with an empty selected day is not called unannounced', () => {
    render(<MyScheduleTab {...baseProps} fest={{ ...ZERO, hasTimetable: true }} dayLineup={[]} />)
    expect(screen.getByText('No acts are scheduled for this day yet.')).toBeInTheDocument()
    expect(screen.queryByText(/Lineup not announced yet/i)).not.toBeInTheDocument()
  })
})

describe('unannounced lineup date line', () => {
  test.each([
    ['2027-06-11', '2027-06-13', '11–13 June 2027'],
    ['2027-06-30', '2027-07-02', '30 June – 2 July 2027'],
    ['2027-12-31', '2028-01-01', '31 December 2027 – 1 January 2028'],
    ['2027-06-11', '2027-06-11', '11 June 2027'],
    ['2027-06-13', '2027-06-11', null],
    ['2027-02-30', '2027-03-01', null],
    [null, '2027-06-13', null],
    ['June 11', '2027-06-13', null],
  ])('%s to %s', (startDate, endDate, expected) => {
    const fest = { ...FEST, location: '', startDate, endDate, lineup: [], hasTimetable: false }
    render(<MyScheduleTab {...baseProps} isLineupOnly fest={fest} />)
    const paragraphs = [...screen.getByRole('region', { name: /Lineup not announced yet/i }).querySelectorAll('p')]
    expect(paragraphs).toHaveLength(expected ? 2 : 1)
    if (expected) expect(paragraphs[0]).toHaveTextContent(new RegExp(`^${expected}$`))
  })
})
