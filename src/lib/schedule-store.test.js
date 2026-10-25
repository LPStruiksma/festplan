import { vi, describe, it, expect, beforeEach } from 'vitest'

// ── Mocks ─────────────────────────────────────────────────────────────────────
// vi.mock calls are hoisted by vitest so they run before any import resolution.

vi.mock('./supabase', () => ({
  supabase: { from: vi.fn() },
}))

vi.mock('./sync-state', () => ({
  // Invoke the wrapped function directly so _rawSaveFriends actually runs.
  withSync: vi.fn((fn) => fn()),
  registerWriteHandler: vi.fn(),
}))

import { supabase } from './supabase'
import { saveFriends } from './schedule-store'

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Chainable Supabase query-builder mock that resolves to `result`. */
function makeChain(result) {
  const chain = {
    delete: vi.fn(() => chain),
    insert: vi.fn(() => chain),
    eq:     vi.fn(() => chain),
    then:   (onFulfilled, onRejected) =>
      Promise.resolve(result).then(onFulfilled, onRejected),
  }
  return chain
}

// ── saveFriends ───────────────────────────────────────────────────────────────

describe('saveFriends', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps source_user_id for invite-linked friends and null for manual ones', async () => {
    const delChain = makeChain({ error: null })
    const insChain = makeChain({ error: null })
    supabase.from.mockReturnValueOnce(delChain).mockReturnValueOnce(insChain)

    await saveFriends('u1', 'fest', [
      { name: 'Invited', artists: ['A'], source_user_id: 'u2' },
      { name: 'Manual',  artists: ['B'] },
    ])

    expect(insChain.insert).toHaveBeenCalledWith([
      { user_id: 'u1', festival_key: 'fest', name: 'Invited', artists: ['A'], position: 0, source_user_id: 'u2' },
      { user_id: 'u1', festival_key: 'fest', name: 'Manual',  artists: ['B'], position: 1, source_user_id: null },
    ])
  })
})
