import { vi, describe, it, expect, beforeEach } from 'vitest'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('./supabase', () => ({
  supabase: { from: vi.fn(), functions: { invoke: vi.fn() } },
}))

import { supabase } from './supabase'
import { getValidSpotifyToken } from './spotify-auth'

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Mock the profiles read so every call sees the given token row. */
function mockProfile(profile) {
  supabase.from.mockImplementation(() => {
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      maybeSingle: vi.fn(() => Promise.resolve({ data: profile, error: null })),
    }
    return chain
  })
}

const expiredProfile = {
  spotify_access_token: 'old-token',
  spotify_token_expires_at: new Date(Date.now() - 1000).toISOString(),
}

/** A promise whose resolution the test controls. */
function deferred() {
  let resolve
  const promise = new Promise((r) => { resolve = r })
  return { promise, resolve }
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('getValidSpotifyToken refresh sharing', () => {
  it('runs one refresh for two concurrent callers and gives both the new token', async () => {
    mockProfile(expiredProfile)
    const pending = deferred()
    supabase.functions.invoke.mockReturnValue(pending.promise)

    const a = getValidSpotifyToken('user-1')
    const b = getValidSpotifyToken('user-1')
    // Let both callers finish reading the profile before the refresh resolves.
    await new Promise((r) => setTimeout(r, 0))
    pending.resolve({ data: { access_token: 'new-token' }, error: null })

    await expect(Promise.all([a, b])).resolves.toEqual(['new-token', 'new-token'])
    expect(supabase.functions.invoke).toHaveBeenCalledTimes(1)
  })

  it('does not refresh a fresh token', async () => {
    mockProfile({
      spotify_access_token: 'fresh-token',
      spotify_token_expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    })

    await expect(getValidSpotifyToken('user-1')).resolves.toBe('fresh-token')
    expect(supabase.functions.invoke).not.toHaveBeenCalled()
  })

  it('rejects every waiting caller when the refresh fails, and the next call retries', async () => {
    mockProfile(expiredProfile)
    const pending = deferred()
    supabase.functions.invoke.mockReturnValueOnce(pending.promise)

    const a = getValidSpotifyToken('user-1')
    const b = getValidSpotifyToken('user-1')
    await new Promise((r) => setTimeout(r, 0))
    pending.resolve({ data: null, error: { message: 'boom' } })

    await expect(a).rejects.toThrow(/refresh failed: boom/)
    await expect(b).rejects.toThrow(/refresh failed: boom/)
    expect(supabase.functions.invoke).toHaveBeenCalledTimes(1)

    supabase.functions.invoke.mockResolvedValueOnce({ data: { access_token: 'retry-token' }, error: null })
    await expect(getValidSpotifyToken('user-1')).resolves.toBe('retry-token')
    expect(supabase.functions.invoke).toHaveBeenCalledTimes(2)
  })

  it('does not share a refresh between different users', async () => {
    mockProfile(expiredProfile)
    supabase.functions.invoke.mockResolvedValue({ data: { access_token: 'new-token' }, error: null })

    await Promise.all([getValidSpotifyToken('user-1'), getValidSpotifyToken('user-2')])
    expect(supabase.functions.invoke).toHaveBeenCalledTimes(2)
  })
})
