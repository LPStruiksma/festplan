// cache-source.js
// Tells whether a Supabase read came from the service worker's cache
// instead of the server.
//
// The service worker marks responses it serves from its cache with the
// header `x-festplan-from-cache: 1` (vite.config.js, MARK_FROM_CACHE). That
// happens offline and when the server is slower than the NetworkFirst
// timeout. Code that would write loaded data back (Setup's artist list) or
// let it replace newer local data (ratings, conflict picks) checks this first,
// and a cached read never counts as "last synced".
//
// Tracking is per request: a loader starts a read with trackRead(), passes
// its signal to the query (`.abortSignal(read.signal)`), and asks
// read.fromCache() afterwards. The Supabase client's fetch (supabase.js)
// records the header against that signal, so two reads running at the same
// time can never swap answers.

export const FROM_CACHE_HEADER = 'x-festplan-from-cache'

const fromCacheBySignal = new WeakMap()   // AbortSignal → boolean

/** fetch() for the Supabase client that records where each tracked GET came from. */
export function makeTrackingFetch(baseFetch = (...a) => globalThis.fetch(...a)) {
  return async (input, init) => {
    const res = await baseFetch(input, init)
    const signal = init?.signal || input?.signal
    if (signal && fromCacheBySignal.has(signal)) {
      fromCacheBySignal.set(signal, res.headers?.get?.(FROM_CACHE_HEADER) === '1')
    }
    return res
  }
}

/**
 * Start a tracked read.
 * @returns {{ signal: AbortSignal, fromCache: () => boolean }}
 */
export function trackRead() {
  const { signal } = new AbortController()
  fromCacheBySignal.set(signal, false)
  return { signal, fromCache: () => fromCacheBySignal.get(signal) === true }
}
