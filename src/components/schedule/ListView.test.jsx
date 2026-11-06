// @vitest-environment jsdom
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import ListView from './ListView'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../../lib/festivals', () => ({
  norm:   (s) => (s || '').toLowerCase().trim(),
  toMins: (t) => {
    if (!t) return 0
    const [h, m] = t.split(':').map(Number)
    return h * 60 + m
  },
}))

vi.mock('../../lib/ui', () => ({
  T: { body: 'sans-serif', display: 'serif' },
}))

// ── Fixtures ──────────────────────────────────────────────────────────────────

const FA = '#c8f400'

// Minimal prop set — override individual fields per test
const baseProps = {
  dayLineup:   [],
  myArtists:   [],
  fa:          FA,
  ratings:     {},
  onRate:      null,
  groupPeople: null,
}

// Helper: build a slot object
function slot(artist, opts = {}) {
  return { artist, stage: opts.stage ?? 'Main Stage', start: opts.start ?? null, end: opts.end ?? null }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ListView', () => {

  // ── Empty state ─────────────────────────────────────────────────────────────

  test('renders no slot cards when dayLineup is empty', () => {
    const { container } = render(<ListView {...baseProps} />)
    // The outer flex wrapper is present but contains zero children
    expect(container.firstChild.childElementCount).toBe(0)
  })

  // ── Slot rendering ──────────────────────────────────────────────────────────

  test('renders one row per slot — artist names are visible', () => {
    const lineup = [slot('Radiohead'), slot('Bicep')]
    render(<ListView {...baseProps} dayLineup={lineup} />)
    expect(screen.getByText('Radiohead')).toBeInTheDocument()
    expect(screen.getByText('Bicep')).toBeInTheDocument()
  })

  test('renders exactly as many artist names as there are slots', () => {
    const lineup = [slot('A'), slot('B'), slot('C')]
    render(<ListView {...baseProps} dayLineup={lineup} />)
    expect(screen.getByText('A')).toBeInTheDocument()
    expect(screen.getByText('B')).toBeInTheDocument()
    expect(screen.getByText('C')).toBeInTheDocument()
  })

  test('renders start and end time when slot has timetable data', () => {
    const lineup = [slot('Radiohead', { start: '21:00', end: '22:30' })]
    render(<ListView {...baseProps} dayLineup={lineup} />)
    expect(screen.getByText('21:00')).toBeInTheDocument()
    expect(screen.getByText('22:30')).toBeInTheDocument()
  })

  // ── "Your Pick" badge ───────────────────────────────────────────────────────

  test('"Your Pick" badge appears for a matched artist', () => {
    const lineup = [slot('Tame Impala')]
    render(<ListView {...baseProps} dayLineup={lineup} myArtists={['Tame Impala']} />)
    expect(screen.getByText('Your Pick')).toBeInTheDocument()
  })

  test('"Your Pick" badge is absent for a non-matched artist', () => {
    const lineup = [slot('Unknown Band')]
    render(<ListView {...baseProps} dayLineup={lineup} myArtists={['Tame Impala']} />)
    expect(screen.queryByText('Your Pick')).not.toBeInTheDocument()
  })

  test('"Your Pick" badge absent when myArtists is empty', () => {
    const lineup = [slot('Radiohead')]
    render(<ListView {...baseProps} dayLineup={lineup} myArtists={[]} />)
    expect(screen.queryByText('Your Pick')).not.toBeInTheDocument()
  })

  // ── Star rating ─────────────────────────────────────────────────────────────

  test('clicking the first star calls onRate(artist, 1)', () => {
    const onRate = vi.fn()
    const lineup = [slot('Clairo')]
    render(<ListView {...baseProps} dayLineup={lineup} myArtists={['Clairo']} onRate={onRate} />)
    fireEvent.click(screen.getByRole('button', { name: 'Rate Clairo 1 star' }))
    expect(onRate).toHaveBeenCalledTimes(1)
    expect(onRate).toHaveBeenCalledWith('Clairo', 1)
  })

  test('clicking the fifth star calls onRate(artist, 5)', () => {
    const onRate = vi.fn()
    const lineup = [slot('Clairo')]
    render(<ListView {...baseProps} dayLineup={lineup} myArtists={['Clairo']} onRate={onRate} />)
    fireEvent.click(screen.getByRole('button', { name: 'Rate Clairo 5 stars' }))
    expect(onRate).toHaveBeenCalledTimes(1)
    expect(onRate).toHaveBeenCalledWith('Clairo', 5)
  })

  test.each([1, 2, 3, 4, 5])('keyboard activation saves %i stars with Enter and Space', stars => {
    const onRate = vi.fn()
    render(<ListView {...baseProps} dayLineup={[slot('Clairo')]} myArtists={['Clairo']} onRate={onRate} />)
    const name = `Rate Clairo ${stars} ${stars === 1 ? 'star' : 'stars'}`
    const button = screen.getByRole('button', { name })

    for (const key of ['Enter', ' ']) {
      button.focus()
      expect(button).toHaveFocus()
      fireEvent.keyDown(button, { key })
      expect(onRate).toHaveBeenLastCalledWith('Clairo', stars)
    }
    expect(onRate).toHaveBeenCalledTimes(2)
  })

  test('rating has accessible names and marks only the current saved rating pressed', () => {
    render(<ListView {...baseProps} dayLineup={[slot('Clairo')]} myArtists={['Clairo']}
      ratings={{ Clairo: 3 }} onRate={vi.fn()} />)
    expect(screen.getByRole('group', { name: 'Rating for Clairo' })).toBeInTheDocument()

    for (const stars of [1, 2, 3, 4, 5]) {
      const button = screen.getByRole('button', {
        name: `Rate Clairo ${stars} ${stars === 1 ? 'star' : 'stars'}`,
      })
      expect(button).toHaveAttribute('type', 'button')
      expect(button).toHaveAttribute('aria-pressed', String(stars === 3))
    }
  })

  test('unrated artists have no selected stars', () => {
    render(<ListView {...baseProps} dayLineup={[slot('Clairo')]} myArtists={['Clairo']}
      onRate={vi.fn()} />)
    expect(screen.getAllByRole('button')).toHaveLength(5)
    screen.getAllByRole('button').forEach(button => {
      expect(button).toHaveAttribute('aria-pressed', 'false')
    })
  })

  test('star widget is absent when onRate is null', () => {
    const lineup = [slot('Clairo')]
    render(<ListView {...baseProps} dayLineup={lineup} myArtists={['Clairo']} onRate={null} />)
    expect(screen.queryByRole('group', { name: 'Rating for Clairo' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  test('star widget is absent for artists not in my picks', () => {
    render(<ListView {...baseProps} dayLineup={[slot('Clairo')]}
      myArtists={['Bicep']} onRate={vi.fn()} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  test('lineup-only slots keep their stage and rating without fake timetable times', () => {
    render(<ListView {...baseProps} dayLineup={[slot('Clairo', { stage: 'Main Stage' })]}
      myArtists={['Clairo']} onRate={vi.fn()} />)
    expect(screen.getByText('Clairo')).toBeInTheDocument()
    expect(screen.getByText('Main Stage')).toBeInTheDocument()
    expect(screen.getByText('Your Pick')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Rate Clairo 1 star' })).toBeInTheDocument()
    expect(screen.queryByText('to')).not.toBeInTheDocument()
  })

  // ── "ALL GOING" label ────────────────────────────────────────────────────────

  test('"ALL GOING" appears when every groupPerson has the artist', () => {
    const lineup = [slot('Radiohead')]
    const groupPeople = [
      { name: 'Me',    artists: ['Radiohead'], color: FA },
      { name: 'Alice', artists: ['Radiohead'], color: '#ff6b6b' },
    ]
    render(<ListView {...baseProps} dayLineup={lineup} myArtists={['Radiohead']} groupPeople={groupPeople} />)
    expect(screen.getByText('ALL GOING')).toBeInTheDocument()
  })

  test('"ALL GOING" is absent when only some groupPeople have the artist', () => {
    const lineup = [slot('Radiohead')]
    const groupPeople = [
      { name: 'Me',    artists: ['Radiohead'], color: FA },
      { name: 'Alice', artists: ['Bicep'],     color: '#ff6b6b' },
    ]
    render(<ListView {...baseProps} dayLineup={lineup} myArtists={['Radiohead']} groupPeople={groupPeople} />)
    expect(screen.queryByText('ALL GOING')).not.toBeInTheDocument()
  })

  test('"ALL GOING" is absent when groupPeople has only one person (requires > 1)', () => {
    const lineup = [slot('Radiohead')]
    const groupPeople = [{ name: 'Me', artists: ['Radiohead'], color: FA }]
    render(<ListView {...baseProps} dayLineup={lineup} myArtists={['Radiohead']} groupPeople={groupPeople} />)
    expect(screen.queryByText('ALL GOING')).not.toBeInTheDocument()
  })
})
