// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./supabase', () => ({ supabase: { from: vi.fn() } }))
vi.mock('./sync-state', () => ({
  withSync: vi.fn(fn => fn()),
  registerWriteHandler: vi.fn(),
}))
vi.mock('./cache-source', () => ({ trackRead: vi.fn() }))

import { supabase } from './supabase'
import { trackRead } from './cache-source'
import { loadSchedule } from './schedule-store'

function readChain(data) {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    abortSignal: vi.fn(async () => ({ data, error: null })),
  }
  return chain
}

describe('loadSchedule festival query and service-worker cache', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    trackRead.mockImplementation(() => ({ signal: new AbortController().signal, fromCache: () => false }))
  })

  it('filters both schedule tables by the festival_key column', async () => {
    const resolutions = readChain([{ artist_a: 'A', artist_b: 'B', chosen_artist: 'A' }])
    const ratings = readChain([{ artist_name: 'A', rating: 5 }])
    supabase.from.mockReturnValueOnce(resolutions).mockReturnValueOnce(ratings)

    const result = await loadSchedule('user-1', 'festival-1')

    expect(supabase.from).toHaveBeenNthCalledWith(1, 'schedule_resolutions')
    expect(supabase.from).toHaveBeenNthCalledWith(2, 'artist_ratings')
    expect(resolutions.eq.mock.calls).toEqual([['user_id', 'user-1'], ['festival_key', 'festival-1']])
    expect(ratings.eq.mock.calls).toEqual([['user_id', 'user-1'], ['festival_key', 'festival-1']])
    expect(result).toEqual({ resolved: { 'A|||B': 'A' }, ratings: { A: 5 } })
  })

  it('does not overwrite local resolutions when the resolutions read came from cache', async () => {
    localStorage.setItem('festplan_resolved_festival-1', JSON.stringify({ 'A|||B': 'B' }))
    trackRead.mockReturnValueOnce({ signal: new AbortController().signal, fromCache: () => true })
      .mockReturnValueOnce({ signal: new AbortController().signal, fromCache: () => false })
    supabase.from.mockReturnValueOnce(readChain([{ artist_a: 'A', artist_b: 'B', chosen_artist: 'A' }]))
      .mockReturnValueOnce(readChain([]))

    expect(await loadSchedule('user-1', 'festival-1')).toEqual({ resolved: null, ratings: {} })
    expect(JSON.parse(localStorage.getItem('festplan_resolved_festival-1'))).toEqual({ 'A|||B': 'B' })
  })
})
