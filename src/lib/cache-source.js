// cache-source.js
// Tells whether the last read of a Supabase table came from the service
// worker's cache instead of the server.
//
// The service worker marks responses it serves from its cache with the
// header `x-festplan-from-cache: 1` (vite.config.js, MARK_FROM_CACHE). That
// happens offline and when the server is slower than the NetworkFirst
// timeout. Code that would write loaded data back (Setup's artist list) or
// let it replace newer local data (ratings, conflict picks) checks this first,
// and a cached read never counts as "last synced".

export const FROM_CACHE_HEADER = 'x-festplan-from-cache'

const lastRead = new Map()   // table → true when the last GET came from cache

function tableOf(url) {
  const m = /\/rest\/v1\/([^?/#]+)/.exec(url)
  return m ? decodeURIComponent(m[1]) : null
}

/** fetch() for the Supabase client that records where each GET came from. */
export function makeTrackingFetch(baseFetch = (...a) => globalThis.fetch(...a)) {
  return async (input, init) => {
    const res = await baseFetch(input, init)
    const url = typeof input === 'string' ? input : input?.url || String(input)
    const method = (init?.method || input?.method || 'GET').toUpperCase()
    const table = method === 'GET' ? tableOf(url) : null
    if (table) lastRead.set(table, res.headers?.get?.(FROM_CACHE_HEADER) === '1')
    return res
  }
}

/** True when the most recent read of `table` was served from the SW cache. */
export function lastReadFromCache(table) {
  return lastRead.get(table) === true
}

/** Test helper. */
export function resetCacheSource() {
  lastRead.clear()
}
