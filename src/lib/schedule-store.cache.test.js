// @vitest-environment jsdom
import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('./supabase', () => ({ supabase: { from: vi.fn() } }))
vi.mock('./sync-state', () => ({ withSync: vi.fn(fn => fn()), registerWriteHandler: vi.fn() }))
const cached = vi.hoisted(() => ({ tables: [] }))
// trackRead is called once per query, in order: resolutions, then ratings.
vi.mock('./cache-source', () => {
  const order = ['schedule_resolutions', 'artist_ratings']
  let n = 0
  return {
    trackRead: () => {
      const table = order[n++ % 2]
      return { signal: {}, fromCache: () => cached.tables.includes(table) }
    },
  }
})

import { supabase } from './supabase'
import { loadSchedule } from './schedule-store'

const ROWS = {
  schedule_resolutions: [{ artist_a: 'A', artist_b: 'B', chosen_artist: 'B' }],
  artist_ratings: [{ artist_name: 'A', rating: 4 }],
}

function chain(table) {
  const c = {
    select: () => c,
    eq: () => c,
    abortSignal: () => c,
    then: (ok, err) => Promise.resolve({ data: ROWS[table], error: null }).then(ok, err),
  }
  return c
}

beforeEach(() => {
  localStorage.clear()
  supabase.from.mockImplementation(chain)
  cached.tables = []
})

describe('loadSchedule and the service-worker cache (festplan#82)', () => {
  it('returns and caches fresh server data', async () => {
    const r = await loadSchedule('u1', 'f')
    expect(r).toEqual({ resolved: { 'A|||B': 'B' }, ratings: { A: 4 } })
    expect(JSON.parse(localStorage.getItem('festplan_ratings_f'))).toEqual({ A: 4 })
  })

  it('treats cache-served ratings as no server data and keeps the local copy', async () => {
    localStorage.setItem('festplan_ratings_f', JSON.stringify({ A: 5 }))
    cached.tables = ['artist_ratings']
    const r = await loadSchedule('u1', 'f')
    expect(r.ratings).toBeNull()
    expect(r.resolved).toEqual({ 'A|||B': 'B' })
    expect(JSON.parse(localStorage.getItem('festplan_ratings_f'))).toEqual({ A: 5 })
  })
})
