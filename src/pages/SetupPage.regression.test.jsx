// @vitest-environment jsdom
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../lib/api', () => ({
  discoverFestivals: vi.fn(async () => ({ source: 'fallback', festivals: [] })),
  mergeFestivals: vi.fn(async items => items),
  fetchAllFestivals: vi.fn(async () => []),
  artistCache: [],
  ensureFestivalIngested: vi.fn(async () => true),
}))
vi.mock('../lib/spotify', () => ({ getAllUserArtists: vi.fn(async () => []) }))
vi.mock('../lib/supabase', () => ({ supabase: {} }))
vi.mock('../lib/profile', () => ({
  loadArtistsFromCache: vi.fn(() => []),
  loadArtistsWithSource: vi.fn(async () => ({ artists: [], fromCache: false })),
  saveArtistsRemote: vi.fn(async () => {}),
}))
vi.mock('../lib/sync-state', () => ({
  getPendingWrites: vi.fn(() => []),
  usePendingCount: vi.fn(() => 0),
}))

import { loadArtistsFromCache, loadArtistsWithSource, saveArtistsRemote } from '../lib/profile'
import SetupPage from './SetupPage'

function setup() {
  return render(<MemoryRouter><SetupPage session={{ user: { id: 'user-1' } }} today={new Date(2026, 10, 3)} /></MemoryRouter>)
}

describe('SetupPage cache precedence and sync status', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('reports Synced after restoring a fresh server artist list without writing it back', async () => {
    loadArtistsWithSource.mockResolvedValue({ artists: ['Server Artist'], fromCache: false })
    setup()

    expect(await screen.findByText('Server Artist')).toBeInTheDocument()
    expect(await screen.findByText('Synced')).toBeInTheDocument()
    expect(saveArtistsRemote).not.toHaveBeenCalled()
  })

  it('keeps a newer local list when an older service-worker response contains artists', async () => {
    loadArtistsFromCache.mockReturnValue(['Local Artist'])
    loadArtistsWithSource.mockResolvedValue({ artists: ['Stale Artist'], fromCache: true })
    setup()

    expect(await screen.findByText('Local Artist')).toBeInTheDocument()
    expect(screen.queryByText('Stale Artist')).not.toBeInTheDocument()
    expect(saveArtistsRemote).not.toHaveBeenCalled()
  })

  it('restores the server list when the response is fresh even if a local list exists', async () => {
    loadArtistsFromCache.mockReturnValue(['Old Local Artist'])
    loadArtistsWithSource.mockResolvedValue({ artists: ['Fresh Server Artist'], fromCache: false })
    setup()

    expect(await screen.findByText('Fresh Server Artist')).toBeInTheDocument()
    expect(screen.queryByText('Old Local Artist')).not.toBeInTheDocument()
    expect(await screen.findByText('Synced')).toBeInTheDocument()
    expect(saveArtistsRemote).not.toHaveBeenCalled()
  })
})
