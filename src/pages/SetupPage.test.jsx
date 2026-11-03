// @vitest-environment jsdom
import React from 'react'
import { render, screen, within, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../lib/api', () => ({
  discoverFestivals: vi.fn(async () => ({ source: 'fallback', festivals: [] })),
  mergeFestivals: vi.fn(async f => f),
  fetchAllFestivals: vi.fn(),
  artistCache: [],
  recommendFestivals: vi.fn(async () => []),
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
