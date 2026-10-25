import { vi, describe, it, expect, beforeEach } from 'vitest'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('./supabase', () => ({
  supabase: { from: vi.fn() },
}))

import { supabase } from './supabase'
import { acceptInvite } from './invites'

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * A tiny in-memory stand-in for the Supabase tables acceptInvite touches.
 * Builder methods return the chain; eq() filters the table's rows, so a
 * duplicate check only finds rows that match every column it filters on.
 */
function makeDb(tables) {
  const inserts = []
  supabase.from.mockImplementation((table) => {
    let rows = [...(tables[table] || [])]
    let head = false
    const chain = {
      select: vi.fn((_cols, opts) => { head = !!opts?.head; return chain }),
      eq:     vi.fn((col, val) => { rows = rows.filter(r => r[col] === val); return chain }),
      gt:     vi.fn(() => chain),
      order:  vi.fn(() => chain),
      update: vi.fn(() => chain),
      insert: vi.fn((row) => { inserts.push({ table, row }); return chain }),
      maybeSingle: vi.fn(() => Promise.resolve({ data: rows[0] ?? null, error: null })),
      then: (onFulfilled, onRejected) =>
        Promise.resolve(head
          ? { count: rows.length, error: null }
          : { data: rows, error: null }).then(onFulfilled, onRejected),
    }
    return chain
  })
  return inserts
}

const session = { user: { id: 'joiner' } }
const invite = (inviter) => ({ slug: `slug-${inviter}`, festival_key: 'lowlands', inviter_user_id: inviter })

// Two inviters, neither with a display name: both fall back to 'Your friend'.
const existingFriend = {
  id: 1, user_id: 'joiner', festival_key: 'lowlands',
  name: 'Your friend', source_user_id: 'a',
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('acceptInvite duplicate check', () => {
  it('adds a second unnamed inviter instead of matching the first by name', async () => {
    const inserts = makeDb({ profiles: [], user_artists: [], friends: [existingFriend] })

    const result = await acceptInvite(invite('b'), session)

    expect(result).toBe('lowlands')
    const friendInserts = inserts.filter(i => i.table === 'friends')
    expect(friendInserts).toHaveLength(1)
    expect(friendInserts[0].row).toMatchObject({
      user_id: 'joiner', name: 'Your friend', source_user_id: 'b', position: 1,
    })
  })

  it('still inserts nothing when the same inviter is accepted again', async () => {
    const inserts = makeDb({ profiles: [], user_artists: [], friends: [existingFriend] })

    const result = await acceptInvite(invite('a'), session)

    expect(result).toBe('lowlands')
    expect(inserts.filter(i => i.table === 'friends')).toHaveLength(0)
  })
})
