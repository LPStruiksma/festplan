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
//     On final failure it:
//       • pushes the payload to festplan_pending_writes[] in localStorage
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

import { createContext, useContext, useEffect, useState, useCallback } from 'react'

// ── Pending writes queue ─────────────────────────────────────────────────────

const LS_PENDING_KEY = 'festplan_pending_writes'

function loadPending() {
  try { return JSON.parse(localStorage.getItem(LS_PENDING_KEY) || '[]') } catch { return [] }
}

export function pushPendingWrite(payload) {
  localStorage.setItem(LS_PENDING_KEY, JSON.stringify([...loadPending(), payload]))
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
 */
export async function withSync(fn, payload) {
  _inflight++
  // Don't stomp an existing error — let it stay red until the user retries.
  if (_status !== 'error') { _status = 'syncing'; _notify() }

  let lastErr
  for (const delay of BACKOFF_MS) {
    if (delay) await new Promise(r => setTimeout(r, delay))
    try {
      await fn()
      // Success path
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
  const pending = getPendingWrites()
  if (!pending.length) return

  clearPendingWrites()  // remove before retry so partial success doesn't re-queue old items
  resetSyncError()

  for (const payload of pending) {
    const handler = _handlers[payload.type]
    if (handler) {
      // withSync will re-queue to localStorage if this attempt also fails
      await withSync(() => handler(...payload.args), payload)
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

  return (
    <SyncContext.Provider value={{ status, retry }}>
      {children}
    </SyncContext.Provider>
  )
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
