// @vitest-environment jsdom
import React from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom'
import DaySelector from './DaySelector'

const DAYS = ['Fri Apr 10', 'Sat Apr 11', 'Sun Apr 12']
const SLOTS = [
  { day: 0, artist: 'Act A' },
  { day: 0, artist: 'Act B' },
  { day: 1, artist: 'Act C' },
]
const FA = '#c8f400'

const props = (overrides = {}) => ({
  days: DAYS,
  day: 0,
  onDayChange: vi.fn(),
  finalSchedule: SLOTS,
  fa: FA,
  ...overrides,
})

const originalInnerWidth = window.innerWidth
const originalScrollIntoView = HTMLElement.prototype.scrollIntoView

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1024 })
})

afterEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: originalInnerWidth })
  if (originalScrollIntoView) {
    HTMLElement.prototype.scrollIntoView = originalScrollIntoView
  } else {
    delete HTMLElement.prototype.scrollIntoView
  }
})

describe('DaySelector', () => {
  test('names each day and its per-day pick count, including singular and zero, and displays the badges', () => {
    render(<DaySelector {...props()} />)

    const friday = screen.getByRole('button', { name: 'Fri Apr 10, 2 picks' })
    const saturday = screen.getByRole('button', { name: 'Sat Apr 11, 1 pick' })
    const sunday = screen.getByRole('button', { name: 'Sun Apr 12, 0 picks' })

    expect(within(friday).getByText('2')).toBeInTheDocument()
    expect(within(saturday).getByText('1')).toBeInTheDocument()
    expect(within(sunday).getByText('0')).toBeInTheDocument()
    expect(screen.getAllByRole('button')).toHaveLength(3)
  })

  test('exposes exactly one pressed day and updates when the parent selects another', () => {
    const onDayChange = vi.fn()
    const { rerender } = render(<DaySelector {...props({ onDayChange })} />)

    expect(screen.getByRole('button', { name: 'Fri Apr 10, 2 picks' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Sat Apr 11, 1 pick' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'Sun Apr 12, 0 picks' })).toHaveAttribute('aria-pressed', 'false')

    rerender(<DaySelector {...props({ day: 1, onDayChange })} />)

    expect(screen.getByRole('button', { name: 'Fri Apr 10, 2 picks' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'Sat Apr 11, 1 pick' })).toHaveAttribute('aria-pressed', 'true')
    expect(onDayChange).not.toHaveBeenCalled()
  })

  test('switching a day calls onDayChange exactly once without mutating the schedule', () => {
    const onDayChange = vi.fn()
    const snapshot = SLOTS.map(slot => ({ ...slot }))
    render(<DaySelector {...props({ onDayChange })} />)

    fireEvent.click(screen.getByRole('button', { name: 'Sun Apr 12, 0 picks' }))

    expect(onDayChange).toHaveBeenCalledExactlyOnceWith(2)
    expect(SLOTS).toEqual(snapshot)
  })

  test('keeps mobile buttons keyboard-focusable, visibly outlined, and scrolls focus into view', () => {
    window.innerWidth = 390
    const scrollIntoView = vi.fn()
    HTMLElement.prototype.scrollIntoView = scrollIntoView
    const onDayChange = vi.fn()
    render(<DaySelector {...props({ onDayChange })} />)

    const saturday = screen.getByRole('button', { name: 'Sat Apr 11, 1 pick' })
    expect(saturday).toHaveAttribute('type', 'button')
    saturday.focus()

    expect(saturday).toHaveFocus()
    expect(saturday).toHaveStyle({ outline: `2px solid ${FA}` })
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' })
    expect(onDayChange).not.toHaveBeenCalled()
  })

  test.each(['Enter', ' '])('native %s keyboard activation sends one day change', key => {
    const onDayChange = vi.fn()
    render(<DaySelector {...props({ onDayChange })} />)
    const saturday = screen.getByRole('button', { name: 'Sat Apr 11, 1 pick' })
    saturday.focus()

    // jsdom does not synthesize a native button click from keydown; model the
    // browser's single activation click after its keyboard event sequence.
    fireEvent.keyDown(saturday, { key })
    fireEvent.click(saturday)
    fireEvent.keyUp(saturday, { key })

    expect(onDayChange).toHaveBeenCalledExactlyOnceWith(1)
  })
})
