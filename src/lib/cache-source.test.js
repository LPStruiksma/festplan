import { describe, it, expect } from 'vitest'
import { makeTrackingFetch, trackRead, FROM_CACHE_HEADER } from './cache-source'

const response = (fromCache) => ({ headers: new Headers(fromCache ? { [FROM_CACHE_HEADER]: '1' } : {}) })

describe('cache-source (per request)', () => {
  it('records a response served from the service-worker cache', async () => {
    const f = makeTrackingFetch(async () => response(true))
    const read = trackRead()
    await f('https://x.supabase.co/rest/v1/user_artists', { signal: read.signal })
    expect(read.fromCache()).toBe(true)
  })

  it('a fresh response reads as not cached', async () => {
    const f = makeTrackingFetch(async () => response(false))
    const read = trackRead()
    await f('https://x.supabase.co/rest/v1/user_artists', { signal: read.signal })
    expect(read.fromCache()).toBe(false)
  })

  it('two overlapping reads of the same table keep their own answers', async () => {
    let releaseCached
    const f = makeTrackingFetch((url, init) =>
      init.cached ? new Promise(r => { releaseCached = () => r(response(true)) }) : Promise.resolve(response(false)))
    const slow = trackRead()
    const fast = trackRead()
    const pSlow = f('https://x/rest/v1/user_artists', { signal: slow.signal, cached: true })
    await f('https://x/rest/v1/user_artists', { signal: fast.signal })
    releaseCached()
    await pSlow
    expect(slow.fromCache()).toBe(true)
    expect(fast.fromCache()).toBe(false)
  })

  it('ignores untracked requests and passes the response through', async () => {
    const res = response(true)
    const f = makeTrackingFetch(async () => res)
    expect(await f('https://x/rest/v1/t')).toBe(res)
    expect(await f('https://x/rest/v1/t', { signal: new AbortController().signal })).toBe(res)
  })

  it('a read that never ran reports not cached', () => {
    expect(trackRead().fromCache()).toBe(false)
  })
})
