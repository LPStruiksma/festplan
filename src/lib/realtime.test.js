// @vitest-environment jsdom
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// ── Mocks ─────────────────────────────────────────────────────────────────────
// A fake Realtime channel that records its listeners so tests can fire
// postgres_changes payloads at it.

const channels = []

vi.mock('./supabase', () => ({
  supabase: {
    channel: vi.fn((name) => {
      const ch = {
        name,
        listeners: [],
        on: vi.fn((type, opts, cb) => {
          ch.listeners.push({ type, opts, cb })
          return ch
        }),
        subscribe: vi.fn(() => ch),
      }
      channels.push(ch)
      return ch
    }),
    removeChannel: vi.fn(),
  },
}))

import { supabase } from './supabase'
import { useFriendsSync } from './realtime'

function fire(ch, payload) {
  ch.listeners.forEach(l => l.cb(payload))
}

const FRIENDS = [{ name: 'Sam', artists: ['Bicep'], source_user_id: null }]

describe('useFriendsSync', () => {
  beforeEach(() => {
    channels.length = 0
    vi.clearAllMocks()
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('subscribes to the friends table for the own user only', () => {
    renderHook(() => useFriendsSync('u1', 'fest-a', {
      load: vi.fn(), onFriends: vi.fn(),
    }))
    expect(channels).toHaveLength(1)
    expect(channels[0].name).toBe('friends-sync:fest-a:u1')
    const [l] = channels[0].listeners
    expect(l.type).toBe('postgres_changes')
    expect(l.opts).toEqual({
      event: '*', schema: 'public', table: 'friends', filter: 'user_id=eq.u1',
    })
    expect(channels[0].subscribe).toHaveBeenCalled()
  })

  it('does not subscribe without a user or festival', () => {
    renderHook(() => useFriendsSync(null, 'fest-a', { load: vi.fn(), onFriends: vi.fn() }))
    renderHook(() => useFriendsSync('u1', null, { load: vi.fn(), onFriends: vi.fn() }))
    expect(supabase.channel).not.toHaveBeenCalled()
  })

  it('coalesces a delete-then-insert burst into one reload and applies it', async () => {
    const load = vi.fn().mockResolvedValue(FRIENDS)
    const onFriends = vi.fn()
    renderHook(() => useFriendsSync('u1', 'fest-a', { load, onFriends }))
    const ch = channels[0]

    // saveFriends rewrites the set: DELETE (old has only the id) then INSERTs.
    fire(ch, { eventType: 'DELETE', new: {}, old: { id: 'r1' } })
    fire(ch, { eventType: 'INSERT', new: { festival_key: 'fest-a', name: 'Sam' }, old: {} })
    fire(ch, { eventType: 'INSERT', new: { festival_key: 'fest-a', name: 'Kim' }, old: {} })
    expect(load).not.toHaveBeenCalled()

    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(load).toHaveBeenCalledTimes(1)
    expect(load).toHaveBeenCalledWith('u1', 'fest-a')
    expect(onFriends).toHaveBeenCalledWith(FRIENDS)
  })

  it('ignores rows for another festival', async () => {
    const load = vi.fn().mockResolvedValue(FRIENDS)
    renderHook(() => useFriendsSync('u1', 'fest-a', { load, onFriends: vi.fn() }))
    fire(channels[0], { eventType: 'INSERT', new: { festival_key: 'fest-b' }, old: {} })
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(load).not.toHaveBeenCalled()
  })

  it('does not apply a failed reload (load returns null)', async () => {
    const load = vi.fn().mockResolvedValue(null)
    const onFriends = vi.fn()
    renderHook(() => useFriendsSync('u1', 'fest-a', { load, onFriends }))
    fire(channels[0], { eventType: 'INSERT', new: { festival_key: 'fest-a' }, old: {} })
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(load).toHaveBeenCalledTimes(1)
    expect(onFriends).not.toHaveBeenCalled()
  })

  it('waits while a local friends save is pending, then reloads', async () => {
    const load = vi.fn().mockResolvedValue(FRIENDS)
    const onFriends = vi.fn()
    let busy = true
    renderHook(() => useFriendsSync('u1', 'fest-a', {
      load, onFriends, isLocalSavePending: () => busy,
    }))
    fire(channels[0], { eventType: 'INSERT', new: { festival_key: 'fest-a' }, old: {} })
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(load).not.toHaveBeenCalled()

    busy = false
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(load).toHaveBeenCalledTimes(1)
    expect(onFriends).toHaveBeenCalledWith(FRIENDS)
  })

  it('removes the channel and drops pending reloads on unmount', async () => {
    const load = vi.fn().mockResolvedValue(FRIENDS)
    const { unmount } = renderHook(() => useFriendsSync('u1', 'fest-a', {
      load, onFriends: vi.fn(),
    }))
    const ch = channels[0]
    fire(ch, { eventType: 'INSERT', new: { festival_key: 'fest-a' }, old: {} })
    unmount()
    expect(supabase.removeChannel).toHaveBeenCalledWith(ch)
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(load).not.toHaveBeenCalled()
  })

  it('does not apply a reload that resolves after unmount', async () => {
    let resolve
    const load = vi.fn(() => new Promise(r => { resolve = r }))
    const onFriends = vi.fn()
    const { unmount } = renderHook(() => useFriendsSync('u1', 'fest-a', { load, onFriends }))
    fire(channels[0], { eventType: 'INSERT', new: { festival_key: 'fest-a' }, old: {} })
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(load).toHaveBeenCalledTimes(1)
    unmount()
    await act(async () => { resolve(FRIENDS) })
    expect(onFriends).not.toHaveBeenCalled()
  })
})
