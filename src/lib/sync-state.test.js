// @vitest-environment jsdom
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  withSync,
  pushPendingWrite,
  getPendingWrites,
  drainPendingWrites,
  registerWriteHandler,
  resetSyncError,
} from './sync-state'

// A fake server: the rating handler stores the last value per artist and can
// be switched offline so every attempt throws.
let offline
let server
const ratingHandler = vi.fn(async (userId, festKey, artist, rating) => {
  if (offline) throw new Error('offline')
  server[`${userId}|${festKey}|${artist}`] = rating
})

function saveRating(userId, festKey, artist, rating) {
  return withSync(
    () => ratingHandler(userId, festKey, artist, rating),
    { type: 'rating', args: [userId, festKey, artist, rating] }
  )
}

// withSync waits 1 s and 2 s between attempts; run them on fake timers.
async function settle(promise) {
  await vi.runAllTimersAsync()
  return promise
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  offline = false
  server = {}
  ratingHandler.mockClear()
  registerWriteHandler('rating', ratingHandler)
  localStorage.clear()
  resetSyncError()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('pending write replay', () => {
  it('does not let an old queued rating overwrite a newer successful one', async () => {
    offline = true
    await settle(saveRating('u1', 'lowlands', 'Clipse', 3))   // queued
    offline = false
    await settle(saveRating('u1', 'lowlands', 'Clipse', 5))   // server = 5

    ratingHandler.mockClear()
    await settle(drainPendingWrites())                        // next boot

    expect(server['u1|lowlands|Clipse']).toBe(5)
    expect(ratingHandler).not.toHaveBeenCalledWith('u1', 'lowlands', 'Clipse', 3)
    expect(getPendingWrites()).toEqual([])
  })

  it('keeps only the newer of two failed writes to the same artist', async () => {
    offline = true
    await settle(saveRating('u1', 'lowlands', 'Clipse', 3))
    await settle(saveRating('u1', 'lowlands', 'Clipse', 4))

    const pending = getPendingWrites()
    expect(pending).toHaveLength(1)
    expect(pending[0].args).toEqual(['u1', 'lowlands', 'Clipse', 4])
  })

  it('keeps failed writes to different artists', async () => {
    offline = true
    await settle(saveRating('u1', 'lowlands', 'Clipse', 3))
    await settle(saveRating('u1', 'lowlands', 'Dijon', 4))

    expect(getPendingWrites().map(p => p.args[2])).toEqual(['Clipse', 'Dijon'])
  })

  it('keeps failed writes for the same artist at different festivals', async () => {
    offline = true
    await settle(saveRating('u1', 'lowlands', 'Clipse', 3))
    await settle(saveRating('u1', 'pinkpop', 'Clipse', 4))

    expect(getPendingWrites()).toHaveLength(2)
  })

  it('replaces older queued friends and artists lists with newer ones', async () => {
    offline = true
    const fail = () => Promise.reject(new Error('offline'))
    await settle(withSync(fail, { type: 'friends', args: ['u1', 'lowlands', [{ name: 'A' }]] }))
    await settle(withSync(fail, { type: 'friends', args: ['u1', 'lowlands', [{ name: 'A' }, { name: 'B' }]] }))
    await settle(withSync(fail, { type: 'artists', args: ['u1', ['Clipse']] }))
    await settle(withSync(fail, { type: 'artists', args: ['u1', ['Clipse', 'Dijon']] }))
    await settle(withSync(fail, { type: 'resolution', args: ['u1', 'lowlands', 'a|||b', 'a'] }))
    await settle(withSync(fail, { type: 'resolution', args: ['u1', 'lowlands', 'a|||b', 'b'] }))

    expect(getPendingWrites().map(p => p.args)).toEqual([
      ['u1', 'lowlands', [{ name: 'A' }, { name: 'B' }]],
      ['u1', ['Clipse', 'Dijon']],
      ['u1', 'lowlands', 'a|||b', 'b'],
    ])
  })

  it('drains old-format queue entries already in localStorage', async () => {
    // Entries written by the previous version: only { type, args }.
    localStorage.setItem('festplan_pending_writes', JSON.stringify([
      { type: 'rating', args: ['u1', 'lowlands', 'Clipse', 3] },
      { type: 'rating', args: ['u1', 'lowlands', 'Dijon', 4] },
    ]))

    await settle(drainPendingWrites())

    expect(server).toEqual({ 'u1|lowlands|Clipse': 3, 'u1|lowlands|Dijon': 4 })
    expect(getPendingWrites()).toEqual([])
  })

  it('replays only the newest of duplicate old-format entries', async () => {
    localStorage.setItem('festplan_pending_writes', JSON.stringify([
      { type: 'rating', args: ['u1', 'lowlands', 'Clipse', 3] },
      { type: 'rating', args: ['u1', 'lowlands', 'Clipse', 5] },
    ]))

    await settle(drainPendingWrites())

    expect(ratingHandler).toHaveBeenCalledTimes(1)
    expect(server['u1|lowlands|Clipse']).toBe(5)
  })

  it('still queues payloads of an unknown type without merging them', () => {
    pushPendingWrite({ type: 'other', args: [1] })
    pushPendingWrite({ type: 'other', args: [1] })
    expect(getPendingWrites()).toHaveLength(2)
  })
})

// A write whose request stays open until the test settles it.
function deferred() {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

describe('overlapping writes to the same row', () => {
  it('an older write that succeeds late does not drop a newer queued write', async () => {
    const slow = deferred()
    const first = withSync(
      () => slow.promise.then(() => { server['u1|lowlands|Clipse'] = 3 }),
      { type: 'rating', args: ['u1', 'lowlands', 'Clipse', 3] }
    )
    offline = true
    await settle(saveRating('u1', 'lowlands', 'Clipse', 5))   // newer edit queued
    slow.resolve()
    await settle(first)                                       // older edit lands

    expect(getPendingWrites().map(p => p.args[3])).toEqual([5])

    offline = false
    await settle(drainPendingWrites())
    expect(server['u1|lowlands|Clipse']).toBe(5)
  })

  it('a drained old value that succeeds does not drop a newer queued write', async () => {
    offline = true
    await settle(saveRating('u1', 'lowlands', 'Clipse', 3))   // queued

    const slow = deferred()
    registerWriteHandler('rating', (...args) =>
      slow.promise.then(() => ratingHandler(...args)))
    offline = false
    const drain = drainPendingWrites()                        // replay of 3 in flight

    registerWriteHandler('rating', ratingHandler)
    offline = true
    await settle(saveRating('u1', 'lowlands', 'Clipse', 5))   // newer edit queued
    offline = false
    slow.resolve()
    await settle(drain)                                       // replay of 3 lands

    expect(getPendingWrites().map(p => p.args[3])).toEqual([5])
  })

  it('an older write that fails again does not replace a newer queued write', async () => {
    offline = true
    await settle(saveRating('u1', 'lowlands', 'Clipse', 3))   // queued

    const slow = deferred()
    registerWriteHandler('rating', (...args) =>
      slow.promise.then(() => ratingHandler(...args)))
    const drain = drainPendingWrites()                        // replay of 3 in flight

    registerWriteHandler('rating', ratingHandler)
    await settle(saveRating('u1', 'lowlands', 'Clipse', 5))   // newer edit queued
    slow.resolve()
    await settle(drain)                                       // replay of 3 fails, re-queued

    expect(getPendingWrites().map(p => p.args[3])).toEqual([5])
  })

  it('a new success drops an old-format queued entry for the row', async () => {
    localStorage.setItem('festplan_pending_writes', JSON.stringify([
      { type: 'rating', args: ['u1', 'lowlands', 'Clipse', 3] },
    ]))
    await settle(saveRating('u1', 'lowlands', 'Clipse', 5))

    expect(getPendingWrites()).toEqual([])
  })

  it('a new success drops an entry queued with a high number by an earlier session', async () => {
    localStorage.setItem('festplan_pending_writes', JSON.stringify([
      { type: 'rating', args: ['u1', 'lowlands', 'Clipse', 3], seq: 9e15 },
    ]))
    await settle(saveRating('u1', 'lowlands', 'Clipse', 5))

    expect(getPendingWrites()).toEqual([])
  })

  it('a newer failed write replaces an old-format queued entry for the row', async () => {
    localStorage.setItem('festplan_pending_writes', JSON.stringify([
      { type: 'rating', args: ['u1', 'lowlands', 'Clipse', 3] },
    ]))
    offline = true
    await settle(saveRating('u1', 'lowlands', 'Clipse', 5))

    expect(getPendingWrites().map(p => p.args[3])).toEqual([5])
  })
})

// A request that stays open until the test makes it fail.
function failLater() {
  let fail
  const promise = new Promise((_, rej) => { fail = rej })
  promise.catch(() => {})
  return { promise, fail }
}

describe('older writes that fail after a newer success', () => {
  it('does not replay an older value that failed after a newer one succeeded', async () => {
    const slow = failLater()
    const first = withSync(() => slow.promise, { type: 'rating', args: ['u1', 'lowlands', 'Clipse', 3] })
    await settle(saveRating('u1', 'lowlands', 'Clipse', 5))   // newer edit lands
    slow.fail(new Error('net'))
    await settle(first)                                       // older edit gives up

    expect(getPendingWrites()).toEqual([])
    await settle(drainPendingWrites())
    expect(server['u1|lowlands|Clipse']).toBe(5)
  })

  it('does not re-queue a drained old value that fails after a newer edit succeeded', async () => {
    offline = true
    await settle(saveRating('u1', 'lowlands', 'Clipse', 3))   // queued
    offline = false

    const slow = failLater()
    registerWriteHandler('rating', () => slow.promise)
    const drain = drainPendingWrites()                        // replay of 3 in flight
    registerWriteHandler('rating', ratingHandler)
    await settle(saveRating('u1', 'lowlands', 'Clipse', 5))   // newer edit lands
    slow.fail(new Error('net'))
    await settle(drain)                                       // replay of 3 gives up

    expect(getPendingWrites()).toEqual([])
    await settle(drainPendingWrites())
    expect(server['u1|lowlands|Clipse']).toBe(5)
  })

  it('still queues a failed write to another row', async () => {
    await settle(saveRating('u1', 'lowlands', 'Clipse', 5))
    offline = true
    await settle(saveRating('u1', 'lowlands', 'Dijon', 2))

    expect(getPendingWrites().map(p => p.args[2])).toEqual(['Dijon'])
  })
})

describe('sequence numbers and other rows', () => {
  it('keeps rising across a module reload, and after the counter is lost', async () => {
    offline = true
    await settle(saveRating('u1', 'lowlands', 'Clipse', 3))
    const before = getPendingWrites()[0].seq

    vi.resetModules()
    const reloaded = await import('./sync-state')
    await settle(reloaded.withSync(
      () => ratingHandler('u1', 'lowlands', 'Dijon', 1),
      { type: 'rating', args: ['u1', 'lowlands', 'Dijon', 1] }
    ))
    expect(reloaded.getPendingWrites().find(p => p.args[2] === 'Dijon').seq).toBeGreaterThan(before)

    localStorage.removeItem('festplan_write_seq')
    vi.resetModules()
    const again = await import('./sync-state')
    await settle(again.withSync(
      () => ratingHandler('u1', 'lowlands', 'Clipse', 4),
      { type: 'rating', args: ['u1', 'lowlands', 'Clipse', 4] }
    ))
    expect(again.getPendingWrites().find(p => p.args[2] === 'Clipse').args[3]).toBe(4)
  })

  it('leaves other rows and unknown types queued around one row\'s writes', async () => {
    offline = true
    await settle(saveRating('u1', 'lowlands', 'Dijon', 2))
    pushPendingWrite({ type: 'other', args: [1] })
    offline = false
    await settle(saveRating('u1', 'lowlands', 'Clipse', 5))
    offline = true
    await settle(saveRating('u1', 'lowlands', 'Clipse', 4))

    expect(getPendingWrites().map(p => p.type + (p.args[2] || '')))
      .toEqual(['ratingDijon', 'other', 'ratingClipse'])
  })

  it('replays the last of duplicate old-format entries alongside other rows', async () => {
    localStorage.setItem('festplan_pending_writes', JSON.stringify([
      { type: 'rating', args: ['u1', 'lowlands', 'Clipse', 1] },
      { type: 'rating', args: ['u1', 'lowlands', 'Clipse', 2] },
      { type: 'rating', args: ['u1', 'lowlands', 'Dijon', 7] },
    ]))
    await settle(drainPendingWrites())

    expect(server).toEqual({ 'u1|lowlands|Clipse': 2, 'u1|lowlands|Dijon': 7 })
    expect(getPendingWrites()).toEqual([])
  })
})

