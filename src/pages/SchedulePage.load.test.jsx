// @vitest-environment jsdom
import React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

vi.mock('../lib/api', () => ({ fetchTimetable: vi.fn() }))
vi.mock('../lib/invites', () => ({ createInvite: vi.fn() }))
vi.mock('../lib/spotify-auth', () => ({ getValidSpotifyToken: vi.fn(async () => null) }))
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
vi.mock('../components/schedule/HeaderBar', () => ({
  default: ({ fest }) => <h1>{fest.name}</h1>,
}))
vi.mock('../components/schedule/ConflictBanner', () => ({ default: () => null }))
vi.mock('../components/schedule/MyScheduleTab', () => ({
  default: ({ fest }) => (
    <div>Timetable {fest.hasTimetable ? 'published' : 'lineup only'}: {fest.lineup.map(s => s.artist).join(', ')}</div>
  ),
}))
vi.mock('../components/schedule/GroupTab', () => ({ default: () => null }))

import { fetchTimetable } from '../lib/api'
import SchedulePage from './SchedulePage'

const FESTIVAL_ID = 'synthetic-plan-festival'
const FESTIVAL = {
  id: FESTIVAL_ID,
  name: 'Synthetic Plan Festival',
  location: 'Test Grounds',
  days: ['Friday'],
  stages: ['Main'],
  lineup: [{ artist: 'Synthetic Artist', stage: 'Main', day: 0, start: '20:00', end: '21:00' }],
  hasTimetable: true,
}

function renderSchedule() {
  return render(
    <MemoryRouter initialEntries={['/schedule']}>
      <Routes>
        <Route path="/schedule" element={<SchedulePage session={null} />} />
        <Route path="/setup" element={<div>Setup destination</div>} />
      </Routes>
    </MemoryRouter>
  )
}

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('festplan_festival', FESTIVAL_ID)
  localStorage.setItem('festplan_artists', JSON.stringify(['Synthetic Artist']))
  fetchTimetable.mockReset()
})

describe('SchedulePage selected festival network retry (synthetic)', () => {
  test('preserves a seeded Plan festival and shows an accessible retry instead of bouncing on transport failure', async () => {
    fetchTimetable.mockRejectedValue(new Error('synthetic backend private detail'))
    renderSchedule()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/Could not load this festival/i)
    expect(alert).not.toHaveTextContent('synthetic backend private detail')
    expect(screen.getByRole('button', { name: /Retry loading festival/i })).toBeEnabled()
    expect(localStorage.getItem('festplan_festival')).toBe(FESTIVAL_ID)
    expect(screen.queryByText('Setup destination')).not.toBeInTheDocument()
    expect(fetchTimetable).toHaveBeenCalledTimes(1)
  })

  test('retries only on user action and displays the returned timetable on success', async () => {
    fetchTimetable.mockRejectedValueOnce(new Error('synthetic offline'))
      .mockResolvedValueOnce({ festival: FESTIVAL })
    renderSchedule()

    fireEvent.click(await screen.findByRole('button', { name: /Retry loading festival/i }))
    expect(await screen.findByText('Synthetic Plan Festival')).toBeInTheDocument()
    expect(screen.getByText('Timetable published: Synthetic Artist')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText('Setup destination')).not.toBeInTheDocument()
    expect(localStorage.getItem('festplan_festival')).toBe(FESTIVAL_ID)
    expect(fetchTimetable).toHaveBeenCalledTimes(2)
  })

  test('disables repeated retry while the request is pending; failed retry stays actionable', async () => {
    let rejectRetry
    fetchTimetable.mockRejectedValueOnce(new Error('offline')).mockImplementationOnce(
      () => new Promise((resolve, reject) => { rejectRetry = reject })
    )
    renderSchedule()

    fireEvent.click(await screen.findByRole('button', { name: /Retry loading festival/i }))
    await waitFor(() => expect(fetchTimetable).toHaveBeenCalledTimes(2))
    expect(screen.getByRole('status')).toHaveTextContent(/Loading festival/i)
    expect(screen.queryByRole('button', { name: /Retry loading festival/i })).not.toBeInTheDocument()

    await act(async () => { rejectRetry(new Error('still offline')) })
    expect(await screen.findByRole('alert')).toHaveTextContent(/Could not load this festival/i)
    expect(screen.getByRole('button', { name: /Retry loading festival/i })).toBeEnabled()
    expect(fetchTimetable).toHaveBeenCalledTimes(2)
    expect(screen.queryByText('Setup destination')).not.toBeInTheDocument()
  })

  test('treats genuinely missing festival metadata as missing, not as a retryable network error', async () => {
    fetchTimetable.mockResolvedValue(null)
    renderSchedule()

    expect(await screen.findByText('Setup destination')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  test('keeps the valid saved-discovery lineup-only fallback when metadata is missing', async () => {
    localStorage.setItem('festplan_festival_meta', JSON.stringify({
      id: FESTIVAL_ID,
      name: 'Cached Discovery Festival',
      matchedArtists: ['Synthetic Artist'],
      accentColor: '#123456',
    }))
    fetchTimetable.mockResolvedValue(null)
    renderSchedule()

    expect(await screen.findByText('Cached Discovery Festival')).toBeInTheDocument()
    expect(screen.getByText('Timetable lineup only: Synthetic Artist')).toBeInTheDocument()
    expect(screen.queryByText('Setup destination')).not.toBeInTheDocument()
  })

  test('invalid selections still redirect to setup', async () => {
    localStorage.removeItem('festplan_festival')
    renderSchedule()
    expect(await screen.findByText('Setup destination')).toBeInTheDocument()
    expect(fetchTimetable).not.toHaveBeenCalled()
  })

  test('no saved artists still redirects instead of leaving a retry screen', async () => {
    localStorage.setItem('festplan_artists', '[]')
    fetchTimetable.mockRejectedValue(new Error('offline'))
    renderSchedule()
    expect(await screen.findByText('Setup destination')).toBeInTheDocument()
  })

  test('late failed requests after unmount are handled without a UI update', async () => {
    let rejectLate
    fetchTimetable.mockImplementationOnce(() => new Promise((resolve, reject) => { rejectLate = reject }))
    const { unmount } = renderSchedule()
    await waitFor(() => expect(fetchTimetable).toHaveBeenCalledTimes(1))
    unmount()
    await act(async () => { rejectLate(new Error('late offline')) })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
