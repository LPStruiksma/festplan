import { vi, describe, it, expect, beforeEach } from 'vitest'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('./supabase', () => ({
  supabase: { from: vi.fn() },
}))

vi.mock('./profile', () => ({
  loadArtists:          vi.fn(),
  loadArtistsFromCache: vi.fn(() => []),
}))

import { supabase } from './supabase'
import { loadArtists, loadArtistsFromCache } from './profile'
import { createInvite } from './invites'

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Chainable query-builder mock; awaiting it (or .single()) resolves to `result`. */
function makeChain(result) {
  const chain = {
    select: vi.fn(() => chain),
    delete: vi.fn(() => chain),
    insert: vi.fn(() => chain),
    eq:     vi.fn(() => chain),
    is:     vi.fn(() => chain),
    single: vi.fn(() => Promise.resolve(result)),
    then:   (onFulfilled, onRejected) =>
      Promise.resolve(result).then(onFulfilled, onRejected),
  }
  return chain
}

/** Route supabase.from(table) calls to per-table chains, recording each one. */
function wireTables() {
  const calls = { user_artists: [], group_invites: [] }
  supabase.from.mockImplementation((table) => {
    const chain = table === 'group_invites'
      ? makeChain({ data: { slug: 'slug-1' }, error: null })
      : makeChain({ error: null })
    calls[table].push(chain)
    return chain
  })
  return calls
}

// ── createInvite ──────────────────────────────────────────────────────────────

describe('createInvite', () => {
  beforeEach(() => {
    supabase.from.mockReset()
    loadArtists.mockReset()
    loadArtistsFromCache.mockReset()
    loadArtistsFromCache.mockReturnValue([])
  })

  it('shares the global list as rows for the invited festival only', async () => {
    loadArtists.mockResolvedValue(['Clipse', 'Dijon'])
    const calls = wireTables()

    const slug = await createInvite('u1', 'lowlands')
    expect(slug).toBe('slug-1')

    const [del, ins] = calls.user_artists
    expect(del.delete).toHaveBeenCalledOnce()
    expect(del.eq).toHaveBeenCalledWith('user_id', 'u1')
    expect(del.eq).toHaveBeenCalledWith('festival_key', 'lowlands')
    expect(del.is).not.toHaveBeenCalled()   // never touches the festival_key IS NULL rows

    expect(ins.insert).toHaveBeenCalledWith([
      { user_id: 'u1', festival_key: 'lowlands', artist_name: 'Clipse', position: 0 },
      { user_id: 'u1', festival_key: 'lowlands', artist_name: 'Dijon',  position: 1 },
    ])
    for (const chain of calls.user_artists) {
      expect(chain.is).not.toHaveBeenCalled()
    }
  })

  it('falls back to the cached list when the remote read fails', async () => {
    loadArtists.mockResolvedValue(null)
    loadArtistsFromCache.mockReturnValue(['Clipse'])
    const calls = wireTables()

    await createInvite('u1', 'lowlands')

    const ins = calls.user_artists[1]
    expect(ins.insert.mock.calls[0][0].map(r => r.artist_name)).toEqual(['Clipse'])
  })

  it('dedupes case-insensitively so the unique index is not tripped', async () => {
    loadArtists.mockResolvedValue(['Clipse', 'clipse ', 'Dijon'])
    const calls = wireTables()

    await createInvite('u1', 'lowlands')

    const rows = calls.user_artists[1].insert.mock.calls[0][0]
    expect(rows.map(r => r.artist_name)).toEqual(['Clipse', 'Dijon'])
    expect(rows.map(r => r.position)).toEqual([0, 1])
  })

  it('clears the festival rows but inserts nothing for an empty list', async () => {
    loadArtists.mockResolvedValue([])
    const calls = wireTables()

    await createInvite('u1', 'lowlands')

    expect(calls.user_artists).toHaveLength(1)
    expect(calls.user_artists[0].delete).toHaveBeenCalledOnce()
    expect(calls.group_invites).toHaveLength(1)
  })

  it('throws and creates no invite when the share write fails', async () => {
    loadArtists.mockResolvedValue(['Clipse'])
    supabase.from.mockImplementation(() => makeChain({ error: { message: 'denied' } }))

    await expect(createInvite('u1', 'lowlands')).rejects.toThrow(/denied/)
    expect(supabase.from).not.toHaveBeenCalledWith('group_invites')
  })
})
