// @vitest-environment jsdom
// Setup's artist list is written to Supabase only after a real change (an
// edit, or a first-visit seed), never because it was loaded. A loaded list
// can be stale (service-worker cache on a slow or missing network) and
// writing it back would delete newer artists (festplan#82).
import React from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'
import '@testing-library/jest-dom'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../lib/api', () => ({
  discoverFestivals: vi.fn(async () => ({ source: 'fallback', festivals: [] })),
  mergeFestivals: vi.fn(async f => f),
  fetchAllFestivals: vi.fn(async () => []),
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
vi.mock('../lib/cache-source', () => ({ lastReadFromCache: vi.fn(() => false) }))

import { getAllUserArtists } from '../lib/spotify'
import { loadArtistsFromCache, loadArtists, saveArtistsRemote } from '../lib/profile'
import { lastReadFromCache } from '../lib/cache-source'
import SetupPage from './SetupPage'

const SESSION = { user: { id: 'u1' } }

async function renderSetup() {
  render(<MemoryRouter><SetupPage session={SESSION} today={new Date(2026, 10, 3)} /></MemoryRouter>)
  await act(async () => { await vi.advanceTimersByTimeAsync(0) })
}
const afterDebounce = () => act(async () => { await vi.advanceTimersByTimeAsync(1500) })

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  localStorage.clear()
  saveArtistsRemote.mockClear()
  loadArtistsFromCache.mockReturnValue([])
  loadArtists.mockResolvedValue([])
  getAllUserArtists.mockResolvedValue([])
  lastReadFromCache.mockReturnValue(false)
})
afterEach(() => vi.useRealTimers())

describe('SetupPage artist write-back (festplan#82)', () => {
  it('does not write a freshly loaded list back', async () => {
    loadArtists.mockResolvedValue(['Daft Punk', 'Bicep'])
    await renderSetup()
    expect(await screen.findByText('Bicep')).toBeInTheDocument()
    await afterDebounce()
    expect(saveArtistsRemote).not.toHaveBeenCalled()
  })

  it('writes after the user adds an artist', async () => {
    loadArtists.mockResolvedValue(['Daft Punk'])
    await renderSetup()
    const input = await screen.findByPlaceholderText('Add an artist manually...')
    fireEvent.change(input, { target: { value: 'Fred again..' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await afterDebounce()
    expect(saveArtistsRemote).toHaveBeenCalledWith('u1', ['Daft Punk', 'Fred again..'])
  })

  it('writes after the user removes an artist', async () => {
    loadArtists.mockResolvedValue(['Daft Punk', 'Bicep'])
    await renderSetup()
    fireEvent.click((await screen.findByText('Bicep')).querySelector('span'))
    await afterDebounce()
    expect(saveArtistsRemote).toHaveBeenCalledWith('u1', ['Daft Punk'])
  })

  it('saves the Spotify seed on a real first visit (server says: no list yet)', async () => {
    loadArtists.mockResolvedValue([])
    getAllUserArtists.mockResolvedValue(['Spotify Artist'])
    await renderSetup()
    await afterDebounce()
    expect(saveArtistsRemote).toHaveBeenCalledWith('u1', ['Spotify Artist'])
  })

  it('does not save the Spotify list when Supabase could not be read', async () => {
    loadArtists.mockResolvedValue(null)
    getAllUserArtists.mockResolvedValue(['Spotify Artist'])
    await renderSetup()
    expect(await screen.findByText('Spotify Artist')).toBeInTheDocument()
    await afterDebounce()
    expect(saveArtistsRemote).not.toHaveBeenCalled()
  })

  it('keeps this device’s list over a cache-served one, and writes nothing', async () => {
    loadArtistsFromCache.mockReturnValue(['Daft Punk', 'Added Here'])
    loadArtists.mockResolvedValue(['Daft Punk'])          // older copy from the SW cache
    lastReadFromCache.mockReturnValue(true)
    await renderSetup()
    await afterDebounce()
    expect(screen.getByText('Added Here')).toBeInTheDocument()
    expect(saveArtistsRemote).not.toHaveBeenCalled()
  })

  it('does not treat a cache-served empty list as a first visit', async () => {
    loadArtists.mockResolvedValue([])
    lastReadFromCache.mockReturnValue(true)
    getAllUserArtists.mockResolvedValue(['Spotify Artist'])
    await renderSetup()
    await afterDebounce()
    expect(saveArtistsRemote).not.toHaveBeenCalled()
  })
})
