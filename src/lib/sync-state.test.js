// @vitest-environment jsdom
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  withSync,
  pushPendingWrite,
  getPendingWrites,
  clearPendingWrites,
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
  clearPendingWrites()
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
