// @vitest-environment jsdom
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import ConflictBanner from './ConflictBanner'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const FEST = {
  days: ['Fri Apr 10', 'Sat Apr 11', 'Sun Apr 12'],
}

/**
 * Build a conflict object that matches the shape SchedulePage produces:
 *   { key, a: slot, b: slot }
 * where key = [artistA, artistB].sort().join('|||')
 */
function makeConflict(artistA, slotA, artistB, slotB) {
  const key = [artistA, artistB].sort().join('|||')
  return {
    key,
    a: { artist: artistA, stage: slotA.stage, start: slotA.start, end: slotA.end, day: slotA.day ?? 0 },
    b: { artist: artistB, stage: slotB.stage, start: slotB.start, end: slotB.end, day: slotB.day ?? 0 },
  }
}

// A pair of genuinely overlapping Friday slots
const C1 = makeConflict(
  'Radiohead',  { stage: 'Pyramid Stage', start: '21:00', end: '22:30', day: 0 },
  'Bicep',      { stage: 'Other Stage',   start: '21:30', end: '23:00', day: 0 },
)

// A second conflict on Saturday
const C2 = makeConflict(
  'The xx',     { stage: 'Main Stage',    start: '20:00', end: '21:30', day: 1 },
  'FKA twigs',  { stage: 'West Holts',    start: '20:30', end: '22:00', day: 1 },
)

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ConflictBanner', () => {

  // ── Empty state ─────────────────────────────────────────────────────────────

  test('renders nothing when the conflicts array is empty', () => {
    const { container } = render(
      <ConflictBanner conflicts={[]} fest={FEST} fa="#c8f400" onResolve={() => {}} />
    )
    expect(container.firstChild).toBeNull()
  })

  // ── Single conflict ─────────────────────────────────────────────────────────

  test('shows both artist names for a single conflict', () => {
    render(<ConflictBanner conflicts={[C1]} fest={FEST} fa="#c8f400" onResolve={() => {}} />)

    // Each artist name appears in two places (description <strong> + button label).
    // Use getAllByText to allow multiple matches.
    expect(screen.getAllByText('Radiohead').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Bicep').length).toBeGreaterThan(0)
  })

  test('displays start, end and stage for each option button', () => {
    render(<ConflictBanner conflicts={[C1]} fest={FEST} fa="#c8f400" onResolve={() => {}} />)

    // The component renders "{start}–{end} · {stage}" inside each button
    expect(screen.getByText(/21:00.+22:30.+Pyramid Stage/)).toBeInTheDocument()
    expect(screen.getByText(/21:30.+23:00.+Other Stage/)).toBeInTheDocument()
  })

  test('shows the correct day label in the prompt text', () => {
    render(<ConflictBanner conflicts={[C1]} fest={FEST} fa="#c8f400" onResolve={() => {}} />)

    // "overlap on Fri Apr 10" — day index 0 → FEST.days[0]
    expect(screen.getByText(/Fri Apr 10/)).toBeInTheDocument()
  })

  // ── Click → onResolve ───────────────────────────────────────────────────────

  test('clicking the first option calls onResolve with (conflictKey, artistName)', () => {
    const onResolve = vi.fn()
    render(<ConflictBanner conflicts={[C1]} fest={FEST} fa="#c8f400" onResolve={onResolve} />)

    // Use getByRole so we target the button directly even though the artist name
    // also appears in the description text above the buttons.
    fireEvent.click(screen.getByRole('button', { name: /Radiohead/ }))

    expect(onResolve).toHaveBeenCalledTimes(1)
    expect(onResolve).toHaveBeenCalledWith(C1.key, 'Radiohead')
  })

  test('clicking the second option calls onResolve with that artist instead', () => {
    const onResolve = vi.fn()
    render(<ConflictBanner conflicts={[C1]} fest={FEST} fa="#c8f400" onResolve={onResolve} />)

    fireEvent.click(screen.getByRole('button', { name: /Bicep/ }))

    expect(onResolve).toHaveBeenCalledWith(C1.key, 'Bicep')
  })

  test('onResolve is not called before any button is clicked', () => {
    const onResolve = vi.fn()
    render(<ConflictBanner conflicts={[C1]} fest={FEST} fa="#c8f400" onResolve={onResolve} />)

    expect(onResolve).not.toHaveBeenCalled()
  })

  // ── Multiple conflicts ──────────────────────────────────────────────────────

  test('renders a card for each conflict when there are two', () => {
    render(<ConflictBanner conflicts={[C1, C2]} fest={FEST} fa="#c8f400" onResolve={() => {}} />)

    expect(screen.getAllByText('Radiohead').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Bicep').length).toBeGreaterThan(0)
    expect(screen.getAllByText('The xx').length).toBeGreaterThan(0)
    expect(screen.getAllByText('FKA twigs').length).toBeGreaterThan(0)
  })

  test('shows the count in the section heading', () => {
    render(<ConflictBanner conflicts={[C1, C2]} fest={FEST} fa="#c8f400" onResolve={() => {}} />)

    expect(screen.getByText(/2 Scheduling Conflicts/)).toBeInTheDocument()
  })

  test('uses the singular label for exactly one conflict', () => {
    render(<ConflictBanner conflicts={[C1]} fest={FEST} fa="#c8f400" onResolve={() => {}} />)

    // The heading text "1 Scheduling Conflict" is split across sibling text nodes,
    // so we check it via the container's text content instead of a single-element query.
    // We verify the plural 's' is absent and the singular label is present.
    expect(screen.queryByText(/Scheduling Conflicts/)).not.toBeInTheDocument()
    expect(screen.getByText(/Scheduling Conflict/)).toBeInTheDocument()
  })

  // ── Resolving one of two conflicts ─────────────────────────────────────────
  //
  // The parent (SchedulePage) filters `unresolvedConflicts` before passing
  // them down.  We simulate that by rerendering with the resolved conflict
  // removed from the array.

  test('removing a resolved conflict from the array unmounts only its card', () => {
    const { rerender } = render(
      <ConflictBanner conflicts={[C1, C2]} fest={FEST} fa="#c8f400" onResolve={() => {}} />
    )

    // Both cards are initially present (artist names appear in description + buttons)
    expect(screen.getAllByText('Radiohead').length).toBeGreaterThan(0)
    expect(screen.getAllByText('The xx').length).toBeGreaterThan(0)

    // Parent resolves C1 → passes only C2
    rerender(
      <ConflictBanner conflicts={[C2]} fest={FEST} fa="#c8f400" onResolve={() => {}} />
    )

    expect(screen.queryByText('Radiohead')).not.toBeInTheDocument()
    expect(screen.queryByText('Bicep')).not.toBeInTheDocument()
    // C2 is still rendered
    expect(screen.getAllByText('The xx').length).toBeGreaterThan(0)
    expect(screen.getAllByText('FKA twigs').length).toBeGreaterThan(0)
  })

  test('resolving the last conflict collapses the banner entirely', () => {
    const { rerender, container } = render(
      <ConflictBanner conflicts={[C1]} fest={FEST} fa="#c8f400" onResolve={() => {}} />
    )

    expect(container.firstChild).not.toBeNull()

    rerender(
      <ConflictBanner conflicts={[]} fest={FEST} fa="#c8f400" onResolve={() => {}} />
    )

    expect(container.firstChild).toBeNull()
  })
})
