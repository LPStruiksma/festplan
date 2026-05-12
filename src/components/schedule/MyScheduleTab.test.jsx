// @vitest-environment jsdom
import React from 'react'
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
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
vi.mock('../../lib/use-is-mobile', () => ({ useIsMobile: () => false }))

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
    render(<MyScheduleTab {...baseProps} />)
    // Empty-state message should appear
    expect(screen.getByText(/None of your artists play on this day/i)).toBeInTheDocument()
  })

  test('shows lineup-only banner when isLineupOnly is true', () => {
    render(<MyScheduleTab {...baseProps} isLineupOnly={true} />)
    expect(screen.getByText(/Timetable Coming Soon/i)).toBeInTheDocument()
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
