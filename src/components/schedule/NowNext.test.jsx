// @vitest-environment jsdom
import React from 'react'
import { render, screen, act } from '@testing-library/react'
import '@testing-library/jest-dom'
import { afterEach, describe, it, expect, vi } from 'vitest'
import NowNext from './NowNext'

const FEST = { startDate: '2026-06-26', days: ['Fri Jun 26', 'Sat Jun 27', 'Sun Jun 28'] }
const pick = (artist, day, start, end, stage = 'Main') => ({ artist, day, start, end, stage })
const SCHEDULE = [
  pick('Opener', 0, '14:00', '15:00', 'Alpha'),
  pick('Headliner', 0, '21:00', '22:30', 'Main'),
  pick('Night DJ', 0, '01:00', '03:00', 'Club'),
  pick('Saturday Act', 1, '16:00', '17:00', 'Bravo'),
]
// Amsterdam summer wall time → Date (UTC+2).
const ams = (mo, d, h, mi) => new Date(Date.UTC(2026, mo - 1, d, h - 2, mi))

const panel = () => screen.queryByRole('region', { name: 'Now and next' })

afterEach(() => vi.useRealTimers())

describe('NowNext', () => {
  it('shows the pick playing now and the next one', () => {
    render(<NowNext fest={FEST} schedule={SCHEDULE} now={ams(6, 26, 14, 20)} />)
    expect(panel()).toHaveTextContent('Opener · Alpha · 40 min left')
    expect(panel()).toHaveTextContent('Headliner · 21:00 · Main · in 6 h 40 min')
  })

  it('says when the first pick of the day starts before anything is on', () => {
    render(<NowNext fest={FEST} schedule={SCHEDULE} now={ams(6, 26, 11, 0)} />)
    expect(panel()).toHaveTextContent('Nothing from your picks is on right now.')
    expect(panel()).toHaveTextContent('Opener · 14:00 · Alpha · in 3 h')
  })

  it('treats an after-midnight set as part of the same night', () => {
    render(<NowNext fest={FEST} schedule={SCHEDULE} now={ams(6, 27, 1, 30)} />)
    expect(panel()).toHaveTextContent('Night DJ · Club · 1 h 30 min left')
    expect(panel()).toHaveTextContent('Your first pick on Sat Jun 27 is Saturday Act · 16:00 · Bravo.')
  })

  it('says when there is nothing left', () => {
    render(<NowNext fest={FEST} schedule={SCHEDULE} now={ams(6, 28, 12, 0)} />)
    expect(panel()).toHaveTextContent('That was your last pick.')
  })

  it('warns about a clash in the next 2 hours', () => {
    const schedule = [pick('A', 0, '18:00', '19:00'), pick('B', 0, '18:30', '19:30')]
    render(<NowNext fest={FEST} schedule={schedule} now={ams(6, 26, 17, 0)} />)
    expect(screen.getByRole('note')).toHaveTextContent('A (18:00–19:00) and B (18:30–19:30) overlap in the next 2 hours.')
  })

  it('renders nothing outside the festival, for lineup-only festivals, or without a start date', () => {
    const { rerender } = render(<NowNext fest={FEST} schedule={SCHEDULE} now={ams(6, 20, 12, 0)} />)
    expect(panel()).toBeNull()
    rerender(<NowNext fest={FEST} schedule={SCHEDULE} isLineupOnly now={ams(6, 26, 14, 20)} />)
    expect(panel()).toBeNull()
    rerender(<NowNext fest={{ days: FEST.days }} schedule={SCHEDULE} now={ams(6, 26, 14, 20)} />)
    expect(panel()).toBeNull()
  })

  it('follows the device clock when no clock is given', () => {
    vi.useFakeTimers()
    vi.setSystemTime(ams(6, 26, 14, 59))
    render(<NowNext fest={FEST} schedule={SCHEDULE} />)
    expect(panel()).toHaveTextContent('Opener · Alpha · 1 min left')
    act(() => { vi.setSystemTime(ams(6, 26, 15, 1)); vi.advanceTimersByTime(30 * 1000) })
    expect(panel()).toHaveTextContent('Nothing from your picks is on right now.')
  })
})
