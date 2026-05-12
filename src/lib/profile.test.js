import { vi, describe, it, expect, beforeEach } from 'vitest'

// ── Mocks ─────────────────────────────────────────────────────────────────────
// vi.mock calls are hoisted by vitest so they run before any import resolution.

vi.mock('./supabase', () => ({
  supabase: { from: vi.fn() },
}))

vi.mock('./sync-state', () => ({
  // Invoke the wrapped function directly so _rawSaveArtistsRemote actually runs.
  withSync: vi.fn((fn) => fn()),
  registerWriteHandler: vi.fn(),
}))

import { supabase } from './supabase'
import { saveArtistsRemote, loadArtists } from './profile'

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a chainable Supabase query-builder mock that resolves to `result`.
 * All builder methods return the chain itself; awaiting the chain resolves to
 * `result` via the thenable protocol.
 */
function makeChain(result) {
  const chain = {
    select: vi.fn(() => chain),
    delete: vi.fn(() => chain),
    insert: vi.fn(() => chain),
    eq:     vi.fn(() => chain),
    is:     vi.fn(() => chain),
    order:  vi.fn(() => chain),
    then:   (onFulfilled, onRejected) =>
      Promise.resolve(result).then(onFulfilled, onRejected),
    catch:  (onRejected) => Promise.resolve(result).catch(onRejected),
  }
  return chain
}

// ── saveArtistsRemote ─────────────────────────────────────────────────────────

describe('saveArtistsRemote', () => {
  let deleteChain
  let insertChain

  beforeEach(() => {
    // Reset queued return values from any previous test, then wire up fresh chains.
    // First .from() call → delete path; second .from() call → insert path.
    supabase.from.mockReset()
    deleteChain = makeChain({ error: null })
    insertChain = makeChain({ error: null })
    supabase.from
      .mockReturnValueOnce(deleteChain)
      .mockReturnValueOnce(insertChain)
  })

  it('dedupes case-insensitive duplicates before inserting', async () => {
    await saveArtistsRemote('user-1', ['Radiohead', 'radiohead', 'RADIOHEAD', 'Blur'])

    expect(insertChain.insert).toHaveBeenCalledOnce()
    const rows = insertChain.insert.mock.calls[0][0]
    expect(rows.map(r => r.artist_name)).toEqual(['Radiohead', 'Blur'])
  })

  it('assigns sequential positions 0..N-1 after dedup', async () => {
    await saveArtistsRemote('user-1', [
      'Radiohead', 'radiohead',    // deduped → 'Radiohead' at 0
      'Blur',      'blur',         // deduped → 'Blur' at 1
      'Oasis',                     //           'Oasis' at 2
    ])

    const rows = insertChain.insert.mock.calls[0][0]
    expect(rows.map(r => r.artist_name)).toEqual(['Radiohead', 'Blur', 'Oasis'])
    expect(rows.map(r => r.position)).toEqual([0, 1, 2])
  })

  it('preserves first-occurrence casing', async () => {
    await saveArtistsRemote('user-1', ['the beatles', 'The Beatles', 'THE BEATLES'])

    const rows = insertChain.insert.mock.calls[0][0]
    expect(rows).toHaveLength(1)
    expect(rows[0].artist_name).toBe('the beatles')
  })

  it('skips the insert when the artist list is empty', async () => {
    // Empty input → nothing to insert; only the delete .from() call fires.
    supabase.from.mockReset()
    supabase.from.mockReturnValue(deleteChain)

    await saveArtistsRemote('user-1', [])

    expect(supabase.from).toHaveBeenCalledTimes(1)
    expect(insertChain.insert).not.toHaveBeenCalled()
  })

  it('passes the correct user_id and null festival_key on every row', async () => {
    await saveArtistsRemote('user-abc', ['Artist A', 'Artist B'])

    const rows = insertChain.insert.mock.calls[0][0]
    for (const row of rows) {
      expect(row.user_id).toBe('user-abc')
      expect(row.festival_key).toBeNull()
    }
  })
})

// ── loadArtists ───────────────────────────────────────────────────────────────

describe('loadArtists', () => {
  beforeEach(() => {
    supabase.from.mockReset()
  })

  it('dedupes case-insensitive duplicates in the returned list', async () => {
    supabase.from.mockReturnValue(makeChain({
      data: [
        { artist_name: 'Radiohead' },
        { artist_name: 'radiohead' },
        { artist_name: 'Blur' },
      ],
      error: null,
    }))

    const result = await loadArtists('user-1')
    expect(result).toEqual(['Radiohead', 'Blur'])
  })

  it('preserves first-occurrence casing on dedup', async () => {
    supabase.from.mockReturnValue(makeChain({
      data: [
        { artist_name: 'Oasis' },
        { artist_name: 'oasis' },
        { artist_name: 'OASIS' },
      ],
      error: null,
    }))

    const result = await loadArtists('user-1')
    expect(result).toEqual(['Oasis'])
  })

  it('returns a clean list when there are no duplicates', async () => {
    supabase.from.mockReturnValue(makeChain({
      data: [
        { artist_name: 'Radiohead' },
        { artist_name: 'Blur' },
        { artist_name: 'Oasis' },
      ],
      error: null,
    }))

    const result = await loadArtists('user-1')
    expect(result).toEqual(['Radiohead', 'Blur', 'Oasis'])
  })

  it('returns null when the fetch fails', async () => {
    supabase.from.mockReturnValue(makeChain({
      data: null,
      error: { message: 'connection refused' },
    }))

    const result = await loadArtists('user-1')
    expect(result).toBeNull()
  })

  it('returns null and skips the DB call for a missing userId', async () => {
    const result = await loadArtists(undefined)
    expect(result).toBeNull()
    expect(supabase.from).not.toHaveBeenCalled()
  })
})
