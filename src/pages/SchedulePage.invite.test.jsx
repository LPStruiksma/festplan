// @vitest-environment jsdom
import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../lib/api', () => ({ fetchTimetable: vi.fn() }))
vi.mock('../lib/invites', () => ({ createInvite: vi.fn() }))
vi.mock('../lib/realtime', () => ({
  useGroupSync: vi.fn(),
  useFriendsSync: vi.fn(),
}))
vi.mock('../lib/schedule-store', () => ({
  loadSchedule: vi.fn(async () => ({ resolved: null, ratings: null })),
  loadFriends: vi.fn(async () => null),
  saveResolution: vi.fn(),
  saveRating: vi.fn(),
  saveFestivalKey: vi.fn(),
  saveFriends: vi.fn(),
  loadResolvedFromCache: vi.fn(() => ({})),
  loadRatingsFromCache: vi.fn(() => ({})),
  loadFriendsFromCache: vi.fn(() => []),
}))
vi.mock('../components/schedule/HeaderBar', () => ({ default: () => null }))
vi.mock('../components/schedule/ConflictBanner', () => ({ default: () => null }))
vi.mock('../components/schedule/MyScheduleTab', () => ({ default: () => null }))
vi.mock('../lib/use-is-mobile', () => ({ useIsMobile: () => false }))

import { fetchTimetable } from '../lib/api'
import { createInvite } from '../lib/invites'
import SchedulePage from './SchedulePage'

const URL = 'https://festplan.app/join/synthetic-invite'
const SESSION = { user: { id: 'synthetic-user' } }
const FEST = {
  id: 'synthetic-festival', name: 'Synthetic Festival',
  days: [], stages: [], lineup: [], hasTimetable: false,
}

async function openGroup() {
  render(
    <MemoryRouter>
      <SchedulePage session={SESSION} />
    </MemoryRouter>
  )
  fireEvent.click(await screen.findByRole('button', { name: /Group \(1\)/ }))
  return screen.getByRole('button', { name: /Invite Friend/ })
}

function setClipboard(value) {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value })
}

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('festplan_festival', FEST.id)
  localStorage.setItem('festplan_artists', JSON.stringify(['Synthetic Artist']))
  fetchTimetable.mockReset()
  fetchTimetable.mockResolvedValue({ festival: FEST })
  createInvite.mockReset()
  createInvite.mockResolvedValue('synthetic-invite')
  setClipboard({ writeText: vi.fn(async () => {}) })
})

afterEach(() => {
  setClipboard(undefined)
  vi.restoreAllMocks()
})

describe('SchedulePage invitation clipboard recovery (synthetic)', () => {
  it('retains the created URL when the clipboard rejects; selecting it never creates another invite', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('NotAllowedError'))
    setClipboard({ writeText })
    fireEvent.click(await openGroup())

    const link = await screen.findByRole('textbox', { name: 'Invitation link' })
    expect(link).toHaveValue(URL)
    expect(link).toHaveAttribute('readonly')
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/select and copy/i))
    expect(screen.queryByRole('alert')).toBeEmptyDOMElement()
    expect(screen.queryByRole('button', { name: /Try Again/i })).not.toBeInTheDocument()
    expect(writeText).toHaveBeenCalledWith(URL)
    expect(createInvite).toHaveBeenCalledTimes(1)

    link.focus()
    expect(link).toHaveFocus()
    expect(link.selectionStart).toBe(0)
    expect(link.selectionEnd).toBe(URL.length)
    expect(screen.getByRole('button', { name: /Link Ready/i })).toBeDisabled()
    expect(createInvite).toHaveBeenCalledTimes(1)
  })

  it('shows the same manually selectable link when the clipboard API does not exist', async () => {
    setClipboard(undefined)
    fireEvent.click(await openGroup())
    expect(await screen.findByRole('textbox', { name: 'Invitation link' })).toHaveValue(URL)
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/select and copy/i))
    expect(createInvite).toHaveBeenCalledTimes(1)
  })

  it('preserves the copied confirmation when auto-copy succeeds', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    setClipboard({ writeText })
    fireEvent.click(await openGroup())

    await waitFor(() => expect(screen.getByRole('button', { name: '✓ Link Copied!' })).toBeInTheDocument())
    expect(screen.getByRole('status')).toHaveTextContent('Invitation link copied.')
    expect(writeText).toHaveBeenCalledWith(URL)
    expect(screen.getByRole('textbox', { name: 'Invitation link' })).toHaveValue(URL)
    expect(createInvite).toHaveBeenCalledTimes(1)
  })

  it('keeps true invite creation failures retryable without showing a nonexistent link', async () => {
    createInvite.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce('synthetic-invite')
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    fireEvent.click(await openGroup())

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not prepare invitation link. Please try again.')
    expect(screen.queryByRole('textbox', { name: 'Invitation link' })).not.toBeInTheDocument()
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '✕ Try Again' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '✓ Link Copied!' })).toBeInTheDocument())
    expect(createInvite).toHaveBeenCalledTimes(2)
    expect(err).toHaveBeenCalled()
  })
})
