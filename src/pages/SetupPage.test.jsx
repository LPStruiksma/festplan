// @vitest-environment jsdom
import React from 'react'
import { render, screen, within, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import { MemoryRouter } from 'react-router-dom'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

vi.mock('../lib/api', () => ({
  discoverFestivals: vi.fn(async () => ({ source: 'fallback', festivals: [] })),
  mergeFestivals: vi.fn(async f => f),
  fetchAllFestivals: vi.fn(),
  artistCache: [],
  ensureFestivalIngested: vi.fn(async () => true),
}))
vi.mock('../lib/spotify', () => ({ getAllUserArtists: vi.fn(async () => []) }))
vi.mock('../lib/spotify-auth', () => ({ getValidSpotifyToken: vi.fn(async () => null) }))
vi.mock('../lib/supabase', () => ({ supabase: {} }))
vi.mock('../lib/profile', () => ({
  loadArtistsFromCache: vi.fn(() => []),
  loadArtists: vi.fn(async () => []),
  saveArtistsRemote: vi.fn(async () => {}),
}))

import { fetchAllFestivals, discoverFestivals } from '../lib/api'
import { loadArtistsFromCache, loadArtists } from '../lib/profile'
import SetupPage from './SetupPage'

// Injected "today": 3 November 2026.
const TODAY = new Date(2026, 10, 3, 12, 0)

function fest(id, name, startDate, endDate) {
  return { id, name, location: 'Somewhere', emoji: '🎵', days: ['Fri Jan 1', 'Sat Jan 2'], startDate, endDate }
}

const PAST     = fest('lowlands', 'Lowlands 2026', '2026-08-13', '2026-08-16')
const RUNNING  = fest('running',  'Running Fest',  '2026-11-01', '2026-11-03')
const UPCOMING = fest('next',     'Next Summer',   '2027-06-24', '2027-06-28')

function renderSetup() {
  return render(
    <MemoryRouter>
      <SetupPage session={null} today={TODAY} />
    </MemoryRouter>
  )
}

beforeEach(() => {
  fetchAllFestivals.mockReset()
  loadArtistsFromCache.mockReturnValue([])
  loadArtists.mockResolvedValue([])
  localStorage.clear()
})

describe('SetupPage plan picker hides festivals that are over', () => {
  it('shows running and upcoming festivals, and puts past ones in a collapsed group', async () => {
    fetchAllFestivals.mockResolvedValue([PAST, RUNNING, UPCOMING])
    renderSetup()

    expect(await screen.findByText('Running Fest')).toBeVisible()
    expect(screen.getByText('Next Summer')).toBeVisible()

    const group = screen.getByText(/Past festivals/).closest('details')
    expect(group).not.toHaveAttribute('open')
    expect(within(group).getByText('Lowlands 2026')).toBeInTheDocument()
    expect(screen.queryByText('No upcoming festivals yet')).not.toBeInTheDocument()
  })

  it('says so when nothing upcoming remains', async () => {
    fetchAllFestivals.mockResolvedValue([PAST])
    renderSetup()

    expect(await screen.findByText('No upcoming festivals yet')).toBeInTheDocument()
    const group = screen.getByText(/Past festivals/).closest('details')
    expect(within(group).getByText('Lowlands 2026')).toBeInTheDocument()
  })

  it('shows no past group when every festival is still to come', async () => {
    fetchAllFestivals.mockResolvedValue([UPCOMING])
    renderSetup()

    expect(await screen.findByText('Next Summer')).toBeVisible()
    expect(screen.queryByText(/Past festivals/)).not.toBeInTheDocument()
  })
})

describe('SetupPage find mode hides festivals that are over', () => {
  function found(f, matchCount) {
    return { ...f, matchCount, matchedArtists: ['Daft Punk'], lineup: [] }
  }

  beforeEach(() => {
    fetchAllFestivals.mockResolvedValue([])
    loadArtists.mockResolvedValue(['Daft Punk'])
  })

  it('ranks only running and upcoming festivals', async () => {
    discoverFestivals.mockResolvedValue({
      source: 'fallback',
      festivals: [found(PAST, 1), found(RUNNING, 1), found(UPCOMING, 1)],
    })
    renderSetup()
    fireEvent.click(await screen.findByText(/Find My Festival/))

    expect(await screen.findByText('Running Fest')).toBeInTheDocument()
    expect(screen.getByText('Next Summer')).toBeInTheDocument()
    expect(screen.queryByText('Lowlands 2026')).not.toBeInTheDocument()
  })

  it('says so when every found festival is over', async () => {
    discoverFestivals.mockResolvedValue({ source: 'fallback', festivals: [found(PAST, 1)] })
    renderSetup()
    fireEvent.click(await screen.findByText(/Find My Festival/))

    expect(await screen.findByText('No upcoming festivals yet')).toBeInTheDocument()
    expect(screen.queryByText('Lowlands 2026')).not.toBeInTheDocument()
  })
})

// Related Artists is unavailable to Spotify Development Mode apps (festplan#31,
// Lukas chose to stay in Development Mode in #35), so the related-artist
// "You might also like" section and its edge function call were removed.
describe('SetupPage without related-artist recommendations', () => {
  const FIVE = ['Daft Punk', 'Justice', 'Air', 'Phoenix', 'Cassius']

  beforeEach(() => {
    fetchAllFestivals.mockResolvedValue([])
    loadArtists.mockResolvedValue(FIVE)
    discoverFestivals.mockReset()
    discoverFestivals.mockResolvedValue({ source: 'fallback', festivals: [{ ...UPCOMING, matchCount: 2, matchedArtists: ['Daft Punk'], lineup: [] }] })
  })

  it('shows Find results with no "You might also like" section and no unavailable line', async () => {
    renderSetup()
    fireEvent.click(await screen.findByText(/Find My Festival/))

    expect(await screen.findByText('Next Summer')).toBeInTheDocument()
    expect(discoverFestivals).toHaveBeenCalledWith(FIVE)
    expect(screen.queryByText('You might also like')).not.toBeInTheDocument()
    expect(screen.queryByText('Recommendations are unavailable right now')).not.toBeInTheDocument()
    expect(screen.queryByText('RELATED ARTISTS')).not.toBeInTheDocument()
  })

  it('no longer asks for a Spotify token on the Setup page', () => {
    const src = readFileSync(join(import.meta.dirname, 'SetupPage.jsx'), 'utf8')
    expect(src).not.toMatch(/recommendFestivals|getValidSpotifyToken/)
  })
})


describe('SetupPage Plan mode search', () => {
  const AMSTERDAM = { ...UPCOMING, location: 'Amsterdam, Netherlands' }
  const LOWLANDS = { ...PAST, location: 'Biddinghuizen, Netherlands' }

  beforeEach(() => {
    fetchAllFestivals.mockResolvedValue([LOWLANDS, RUNNING, AMSTERDAM])
  })

  it('matches festival names case-insensitively while retaining the past group', async () => {
    renderSetup()
    await screen.findByText('Next Summer')

    fireEvent.change(screen.getByRole('searchbox', { name: /search festivals by name or location/i }), {
      target: { value: 'lOwLaNdS' },
    })

    expect(screen.queryByText('Next Summer')).not.toBeInTheDocument()
    expect(screen.queryByText('Running Fest')).not.toBeInTheDocument()
    const past = screen.getByText('Past festivals (1)').closest('details')
    expect(past).not.toHaveAttribute('open')
    expect(within(past).getByText('Lowlands 2026')).toBeInTheDocument()
    expect(screen.queryByText('No festivals match your search')).not.toBeInTheDocument()
  })

  it('matches locations regardless of case and clearing the input restores both groups', async () => {
    renderSetup()
    await screen.findByText('Next Summer')
    const search = screen.getByRole('searchbox', { name: /search festivals by name or location/i })

    fireEvent.change(search, { target: { value: 'AMSTERDAM' } })
    expect(screen.getByText('Next Summer')).toBeInTheDocument()
    expect(screen.queryByText('Running Fest')).not.toBeInTheDocument()
    expect(screen.queryByText(/Past festivals/)).not.toBeInTheDocument()

    fireEvent.change(search, { target: { value: '' } })
    expect(screen.getByText('Running Fest')).toBeInTheDocument()
    expect(screen.getByText('Past festivals (1)')).toBeInTheDocument()
    expect(screen.getByText('Lowlands 2026')).toBeInTheDocument()
  })

  it('shows a distinct no-match message, not the no-upcoming empty state', async () => {
    renderSetup()
    await screen.findByText('Next Summer')

    fireEvent.change(screen.getByRole('searchbox', { name: /search festivals by name or location/i }), {
      target: { value: 'not a real festival' },
    })

    expect(screen.getByText('No festivals match your search')).toBeInTheDocument()
    expect(screen.queryByText('No upcoming festivals yet')).not.toBeInTheDocument()
    expect(screen.queryByText(/Past festivals/)).not.toBeInTheDocument()
  })

  it('keeps a selected festival active when hidden and permits clearing and reselecting', async () => {
    loadArtists.mockResolvedValue(['Daft Punk'])
    renderSetup()
    await screen.findByText('Next Summer')
    const search = screen.getByRole('searchbox', { name: /search festivals by name or location/i })
    const schedule = screen.getByRole('button', { name: /Build My Schedule/i })

    fireEvent.click(screen.getByRole('button', { name: /Next Summer/i }))
    expect(schedule).toBeEnabled()

    fireEvent.change(search, { target: { value: 'lowlands' } })
    expect(screen.queryByRole('button', { name: /Next Summer/i })).not.toBeInTheDocument()
    expect(screen.getByText('Selected: Next Summer')).toBeInTheDocument()
    expect(schedule).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: /clear festival selection/i }))
    expect(schedule).toBeDisabled()
    fireEvent.change(search, { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: /Next Summer/i }))
    expect(schedule).toBeEnabled()
    fireEvent.click(schedule)
    expect(localStorage.getItem('festplan_festival')).toBe('next')
  })
})
