// @vitest-environment jsdom
import React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
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
  default: ({ fest, onExportCalendar }) => (
    <div><h1>{fest.name}</h1><button type="button" onClick={onExportCalendar}>Export calendar</button></div>
  ),
}))
vi.mock('../components/schedule/ConflictBanner', () => ({ default: () => null }))
vi.mock('../components/schedule/MyScheduleTab', () => ({
  default: ({ fest }) => (
    <div>Timetable {fest.hasTimetable ? 'published' : 'lineup only'}: {fest.lineup.map(s => s.artist).join(', ')}</div>
  ),
}))
vi.mock('../components/schedule/GroupTab', () => ({ default: () => null }))

import { fetchTimetable } from '../lib/api'
import { loadTimetableSnapshot, getLastSynced } from '../lib/sync-state'
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

afterEach(() => vi.restoreAllMocks())

describe('SchedulePage offline (synthetic)', () => {
  test('saves the loaded timetable on this device and stamps the sync time', async () => {
    fetchTimetable.mockResolvedValue({ festival: FESTIVAL })
    renderSchedule()
    expect(await screen.findByText('Timetable published: Synthetic Artist')).toBeInTheDocument()
    expect(loadTimetableSnapshot(FESTIVAL_ID).festival).toEqual(FESTIVAL)
    expect(getLastSynced()).not.toBeNull()
    expect(screen.queryByRole('status', { name: 'Offline status' })).not.toBeInTheDocument()
  })

  test('with no network, renders the saved timetable and the offline badge instead of an error', async () => {
    localStorage.setItem(`festplan_timetable_${FESTIVAL_ID}`, JSON.stringify({ savedAt: 1, festival: FESTIVAL }))
    localStorage.setItem('festplan_last_synced', String(new Date(2026, 5, 26, 14, 32).getTime()))
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    fetchTimetable.mockRejectedValue(new TypeError('Failed to fetch'))
    renderSchedule()

    expect(await screen.findByText('Timetable published: Synthetic Artist')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Offline status' })).toHaveTextContent(/Offline, last synced (\w{3} )?14:32/)
  })

  test('offline with a saved copy: never waits on the network', async () => {
    localStorage.setItem(`festplan_timetable_${FESTIVAL_ID}`, JSON.stringify({ savedAt: 1, festival: FESTIVAL }))
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    fetchTimetable.mockReturnValue(new Promise(() => {}))  // would hang forever
    renderSchedule()
    expect(await screen.findByText('Timetable published: Synthetic Artist')).toBeInTheDocument()
    expect(fetchTimetable).not.toHaveBeenCalled()
  })

  test('slow network: shows the saved copy, then the fresh timetable when it arrives', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    localStorage.setItem(`festplan_timetable_${FESTIVAL_ID}`, JSON.stringify({ savedAt: 1, festival: FESTIVAL }))
    let respond
    fetchTimetable.mockReturnValue(new Promise(r => { respond = r }))
    renderSchedule()
    expect(screen.queryByText(/Timetable published/)).not.toBeInTheDocument()
    await act(async () => { await vi.advanceTimersByTimeAsync(6500) })
    expect(screen.getByText('Timetable published: Synthetic Artist')).toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Offline status' })).toHaveTextContent("Couldn't reach FestPlan")
    const fresh = { ...FESTIVAL, lineup: [...FESTIVAL.lineup, { artist: 'Late Addition', stage: 'Main', day: 0, start: '22:00', end: '23:00' }] }
    await act(async () => { respond({ festival: fresh }) })
    expect(screen.getByText('Timetable published: Synthetic Artist, Late Addition')).toBeInTheDocument()
    expect(screen.queryByRole('status', { name: 'Offline status' })).not.toBeInTheDocument()
    vi.useRealTimers()
  })

  test('a response served while offline (service-worker cache) does not move the last-synced time', async () => {
    // No saved copy yet, so the request goes out and the SW cache answers it.
    localStorage.setItem('festplan_last_synced', '1000')
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    fetchTimetable.mockResolvedValue({ festival: FESTIVAL })
    renderSchedule()
    expect(await screen.findByText('Timetable published: Synthetic Artist')).toBeInTheDocument()
    expect(getLastSynced()).toBe(1000)
    expect(screen.getByRole('status', { name: 'Offline status' })).toHaveTextContent('Offline')
  })

  test('online but slow: a timetable the service worker served from cache is not a sync', async () => {
    localStorage.setItem('festplan_last_synced', '1000')
    fetchTimetable.mockResolvedValue({ festival: FESTIVAL, fromCache: true })
    renderSchedule()
    expect(await screen.findByText('Timetable published: Synthetic Artist')).toBeInTheDocument()
    expect(getLastSynced()).toBe(1000)
    expect(screen.getByRole('status', { name: 'Offline status' })).toHaveTextContent("Couldn't reach FestPlan")
  })

  test('calendar export uses the chosen reminder and remembers it', async () => {
    fetchTimetable.mockResolvedValue({ festival: { ...FESTIVAL, startDate: '2026-06-26' } })
    let blob
    globalThis.URL.createObjectURL = vi.fn(b => { blob = b; return 'blob:x' })
    globalThis.URL.revokeObjectURL = vi.fn()
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    renderSchedule()

    const select = await screen.findByLabelText('Calendar reminder')
    expect(select).toHaveValue('15')
    fireEvent.change(select, { target: { value: '30' } })
    expect(localStorage.getItem('festplan_reminder_mins')).toBe('30')
    fireEvent.click(screen.getByRole('button', { name: 'Export calendar' }))
    const text = await new Promise(resolve => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.readAsText(blob)
    })
    expect(text).toContain('TRIGGER:-PT30M')
  })
})
