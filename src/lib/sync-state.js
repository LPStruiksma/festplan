// sync-state.js
// Reliable write feedback for all Supabase mutations.
//
// ── How it fits together ────────────────────────────────────────────────────
//
//  1. schedule-store.js / profile.js call withSync(fn, payload) around every
//     Supabase write.  fn is the raw async write; payload is a serialisable
//     description of the call so it can be replayed later.
//
//  2. withSync() runs fn up to 3 times with exponential back-off.
//     On success it transitions the state machine: syncing → idle.
//     Each call is stamped with a sequence number (seq) when it starts, so
//     overlapping writes to one row can be ordered by when the user made them.
//     On success it also drops queued writes to the same row that are older
//     than this call, so an older failed value can't be replayed over the
//     newer one, and a newer queued value isn't lost to an older success.
//     It also records the highest seq that succeeded for each row.
//     On final failure it:
//       • pushes the payload to festplan_pending_writes[] in localStorage,
//         replacing any older queued write to the same row (but never a
//         newer one), and skipping it entirely if a newer write to that row
//         already succeeded
//       • transitions the state machine: syncing → error
//
//  3. SyncProvider makes the current status available to any component
//     via useSync().  HeaderBar renders a small pill showing the status.
//
//  4. On app boot, App.jsx calls drainPendingWrites() once a session is
//     available.  retry() in useSync() also calls it when the user taps
//     the error pill.
//
// ── Handler registry ────────────────────────────────────────────────────────
//  schedule-store.js and profile.js each call registerWriteHandler(type, fn)
//  at module-load time.  drainPendingWrites() uses this registry to replay
//  queued writes without creating circular imports.

import { createElement, createContext, useContext, useEffect, useState, useCallback } from 'react'

// ── Pending writes queue ─────────────────────────────────────────────────────

const LS_PENDING_KEY = 'festplan_pending_writes'
const LS_SEQ_KEY     = 'festplan_write_seq'
const LS_DONE_KEY    = 'festplan_write_done'   // { [row identity]: highest succeeded seq }
const DONE_LIMIT     = 500                     // rows kept, newest seqs first

function loadPending() {
  try { return JSON.parse(localStorage.getItem(LS_PENDING_KEY) || '[]') } catch { return [] }
}

function savePending(list) {
  localStorage.setItem(LS_PENDING_KEY, JSON.stringify(list))
}

// Which server row a payload writes.  Two payloads with the same identity
// overwrite each other, so only the newest one is worth replaying.  Derived
// from type + args so entries already queued by older builds still match.
// Returns null for unknown types, which are never merged.
function writeIdentity(payload) {
  const [userId, a, b] = payload?.args || []
  switch (payload?.type) {
    case 'rating':     return JSON.stringify(['rating', userId, a, b])      // user, fest, artist
    case 'resolution': return JSON.stringify(['resolution', userId, a, b])  // user, fest, conflictKey
    case 'friends':    return JSON.stringify(['friends', userId, a])        // user, fest
    case 'artists':    return JSON.stringify(['artists', userId])           // user
    default:           return null
  }
}

// Entries queued by older builds have no seq; they count as older than any
// stamped write.
function seqOf(payload) {
  return Number.isFinite(payload?.seq) ? payload.seq : 0
}

// Sequence numbers must keep rising across reloads, because queued entries
// outlive the page.  Start above both the stored counter and every queued seq.
let _lastSeq = 0
function nextSeq() {
  let stored = 0
  try { stored = Number(localStorage.getItem(LS_SEQ_KEY)) || 0 } catch { /* storage unavailable */ }
  const queued = loadPending().reduce((max, p) => Math.max(max, seqOf(p)), 0)
  _lastSeq = Math.max(_lastSeq, stored, queued) + 1
  try { localStorage.setItem(LS_SEQ_KEY, String(_lastSeq)) } catch { /* storage unavailable */ }
  return _lastSeq
}

function loadDone() {
  try { return JSON.parse(localStorage.getItem(LS_DONE_KEY) || '{}') || {} } catch { return {} }
}

// Remember the newest write that reached the server for this row.  Only a
// write still in flight can fail after it, so the oldest rows can be dropped.
function markDone(id, seq) {
  const done = loadDone()
  if ((done[id] ?? -1) >= seq) return
  done[id] = seq
  const ids = Object.keys(done)
  if (ids.length > DONE_LIMIT) {
    ids.sort((x, y) => done[y] - done[x]).slice(DONE_LIMIT).forEach(k => delete done[k])
  }
  try { localStorage.setItem(LS_DONE_KEY, JSON.stringify(done)) } catch { /* storage unavailable */ }
}

/**
 * Queue a failed write, replacing any older queued write to the same row.
 * If a newer write to that row is already queued, or already succeeded,
 * this one is dropped.
 */
export function pushPendingWrite(payload) {
  const id = writeIdentity(payload)
  const pending = loadPending()
  if (id !== null && seqOf(payload) <= (loadDone()[id] ?? -1)) return
  if (id !== null && pending.some(p => writeIdentity(p) === id && seqOf(p) > seqOf(payload))) return
  savePending([...(id === null ? pending : pending.filter(p => writeIdentity(p) !== id)), payload])
}

// A write to the same row succeeded, so queued values from before it are
// stale, and so is any older write that fails later.  Queued values from
// after it started are newer and stay.
function dropPendingWrite(payload) {
  const id = writeIdentity(payload)
  if (id === null) return
  markDone(id, seqOf(payload))
  const pending = loadPending()
  const kept = pending.filter(p => writeIdentity(p) !== id || seqOf(p) > seqOf(payload))
  if (kept.length !== pending.length) savePending(kept)
}

export function getPendingWrites()   { return loadPending() }
export function clearPendingWrites() { localStorage.removeItem(LS_PENDING_KEY) }

// ── Write handler registry ───────────────────────────────────────────────────

const _handlers = {}

/**
 * Register a raw (non-withSync-wrapped) write function for a given payload
 * type.  Called as a side-effect at the top of schedule-store.js / profile.js
 * so the registry is populated before any user interaction.
 *
 * @param {string}   type  e.g. 'resolution', 'rating', 'friends', 'artists'
 * @param {Function} fn    (...args) => Promise<void>, throws on failure
 */
export function registerWriteHandler(type, fn) {
  _handlers[type] = fn
}

// ── Module-level state machine ───────────────────────────────────────────────
// Lives outside React so write functions in other modules can update it
// without prop-drilling or importing the context directly.

let _status   = 'idle'   // 'idle' | 'syncing' | 'error'
let _inflight = 0        // how many withSync() calls are currently in-flight
const _listeners = new Set()

function _notify() {
  _listeners.forEach(fn => fn(_status))
}

function _subscribe(fn) {
  _listeners.add(fn)
  return () => _listeners.delete(fn)
}

export function resetSyncError() {
  if (_status === 'error') {
    _status = _inflight > 0 ? 'syncing' : 'idle'
    _notify()
  }
}

// ── withSync ─────────────────────────────────────────────────────────────────

// Back-off delays in milliseconds between the 3 attempts.
const BACKOFF_MS = [0, 1000, 2000]

/**
 * Wrap a Supabase write with retry logic and sync-state reporting.
 *
 * @param {() => Promise<void>} fn       The write to attempt.  Must throw on
 *                                       failure (use the _raw helpers in
 *                                       schedule-store.js / profile.js).
 * @param {object}              payload  Serialisable call description stored
 *                                       in localStorage on final failure so
 *                                       drainPendingWrites() can replay it.
 *                                       Shape: { type: string, args: any[] }
 *                                       A payload that already has a seq
 *                                       (a replayed queue entry) keeps it.
 */
export async function withSync(fn, payload) {
  if (payload && !('seq' in payload)) payload = { ...payload, seq: nextSeq() }
  _inflight++
  // Don't stomp an existing error — let it stay red until the user retries.
  if (_status !== 'error') { _status = 'syncing'; _notify() }

  let lastErr
  for (const delay of BACKOFF_MS) {
    if (delay) await new Promise(r => setTimeout(r, delay))
    try {
      await fn()
      // Success path
      dropPendingWrite(payload)
      _inflight = Math.max(0, _inflight - 1)
      if (_inflight === 0 && _status === 'syncing') { _status = 'idle'; _notify() }
      return
    } catch (err) {
      lastErr = err
      console.warn(`[festplan] withSync attempt failed (delay ${delay}ms):`, err?.message)
    }
  }

  // All 3 attempts failed
  _inflight = Math.max(0, _inflight - 1)
  pushPendingWrite(payload)
  _status = 'error'
  _notify()
  console.error('[festplan] withSync gave up after 3 attempts:', lastErr?.message)
}

// ── Drain pending writes ──────────────────────────────────────────────────────

/**
 * Re-attempt every write in festplan_pending_writes[].
 * Called on app boot (App.jsx) and when the user taps the error pill.
 * Safe to call when the queue is empty — exits immediately.
 */
export async function drainPendingWrites() {
  const queued = getPendingWrites()
  if (!queued.length) return

  // Older builds appended duplicates; replay only the newest write per row
  // (highest seq, and among equal seqs the one queued last).
  const pending = queued.filter((p, i) => {
    const id = writeIdentity(p)
    return id === null || !queued.some((q, j) =>
      j !== i && writeIdentity(q) === id &&
      (seqOf(q) > seqOf(p) || (seqOf(q) === seqOf(p) && j > i)))
  })

  clearPendingWrites()  // remove before retry so partial success doesn't re-queue old items
  resetSyncError()

  for (const payload of pending) {
    const handler = _handlers[payload.type]
    if (handler) {
      // withSync will re-queue to localStorage if this attempt also fails
      // Keep the entry's original seq (0 for old entries) so a late success
      // can't drop a newer write the user made while this replay ran.
      await withSync(() => handler(...payload.args), { ...payload, seq: seqOf(payload) })
    } else {
      console.warn('[festplan] drainPendingWrites: no handler for type', payload.type)
    }
  }
}

// ── React context ─────────────────────────────────────────────────────────────

const SyncContext = createContext(null)

/**
 * Mount above the route tree in App.jsx.
 * Subscribes to the module-level state machine and distributes status
 * changes to any component that calls useSync().
 */
export function SyncProvider({ children }) {
  const [status, setStatus] = useState('idle')

  useEffect(() => _subscribe(setStatus), [])

  const retry = useCallback(async () => {
    const pending = getPendingWrites()
    if (pending.length) {
      await drainPendingWrites()
    } else {
      // No queued writes — just clear the error flag
      resetSyncError()
    }
  }, [])

  // Use createElement instead of JSX so this .js file stays valid for
  // parsers (like Vite's oxc) that only allow JSX syntax in .jsx files.
  return createElement(SyncContext.Provider, { value: { status, retry } }, children)
}

/**
 * Returns { status, retry } for the nearest SyncProvider.
 *
 * status — 'idle' | 'syncing' | 'error'
 * retry  — async () => void — re-attempts queued writes or clears the error
 */
export function useSync() {
  const ctx = useContext(SyncContext)
  if (!ctx) throw new Error('useSync must be used inside <SyncProvider>')
  return ctx
}
