import { describe, it, expect, beforeEach } from 'vitest'
import { makeTrackingFetch, lastReadFromCache, resetCacheSource, FROM_CACHE_HEADER } from './cache-source'

const response = (fromCache) => ({ headers: new Headers(fromCache ? { [FROM_CACHE_HEADER]: '1' } : {}) })

beforeEach(resetCacheSource)

describe('cache-source', () => {
  it('records a GET served from the service-worker cache', async () => {
    const f = makeTrackingFetch(async () => response(true))
    await f('https://x.supabase.co/rest/v1/user_artists?select=artist_name')
    expect(lastReadFromCache('user_artists')).toBe(true)
  })

  it('a fresh GET clears the flag for that table only', async () => {
    let cached = true
    const f = makeTrackingFetch(async () => response(cached))
    await f('https://x.supabase.co/rest/v1/user_artists')
    await f('https://x.supabase.co/rest/v1/artist_ratings')
    cached = false
    await f('https://x.supabase.co/rest/v1/user_artists')
    expect(lastReadFromCache('user_artists')).toBe(false)
    expect(lastReadFromCache('artist_ratings')).toBe(true)
  })

  it('ignores writes, non-REST URLs and Request objects without a method', async () => {
    const f = makeTrackingFetch(async () => response(true))
    await f('https://x.supabase.co/rest/v1/user_artists', { method: 'POST' })
    await f('https://x.supabase.co/auth/v1/user')
    expect(lastReadFromCache('user_artists')).toBe(false)
    await f({ url: 'https://x.supabase.co/rest/v1/friends?x=1' })
    expect(lastReadFromCache('friends')).toBe(true)
  })

  it('passes the response through untouched', async () => {
    const res = response(false)
    const f = makeTrackingFetch(async () => res)
    expect(await f('https://x/rest/v1/t')).toBe(res)
  })
})
