import { describe, it, expect } from 'vitest'
import { readStoredSession, isNetworkAuthError, resolveSession } from './offline-session'

const STORED = { access_token: 'a', refresh_token: 'r', expires_at: 1, user: { id: 'u1' } }
const memory = value => ({ getItem: () => (value === undefined ? null : value) })

describe('readStoredSession', () => {
  it('reads the session supabase-js stored', () => {
    expect(readStoredSession(memory(JSON.stringify(STORED)), 'k')).toEqual(STORED)
  })
  it('reads the old wrapped format', () => {
    expect(readStoredSession(memory(JSON.stringify({ currentSession: STORED })), 'k')).toEqual(STORED)
  })
  it('returns null for missing, corrupt or incomplete data', () => {
    expect(readStoredSession(memory(undefined), 'k')).toBeNull()
    expect(readStoredSession(memory('{nope'), 'k')).toBeNull()
    expect(readStoredSession(memory(JSON.stringify({ user: { id: 'u1' } })), 'k')).toBeNull()
    expect(readStoredSession(null, 'k')).toBeNull()
    expect(readStoredSession(memory(JSON.stringify(STORED)), '')).toBeNull()
  })
})

describe('isNetworkAuthError', () => {
  it('recognises network failures only', () => {
    expect(isNetworkAuthError({ name: 'AuthRetryableFetchError', status: 0 })).toBe(true)
    expect(isNetworkAuthError({ name: 'AuthApiError', status: 400 })).toBe(false)
    expect(isNetworkAuthError(null)).toBe(false)
  })
})

describe('resolveSession', () => {
  const live = { user: { id: 'live' } }
  it('uses a live session when there is one', () => {
    expect(resolveSession(live, { offline: true, stored: STORED })).toBe(live)
  })
  it('keeps the stored session while offline (expired token, refresh impossible)', () => {
    expect(resolveSession(null, { offline: true, stored: STORED })).toBe(STORED)
  })
  it('keeps the stored session after a network error even if navigator says online', () => {
    expect(resolveSession(null, { error: { name: 'AuthRetryableFetchError', status: 0 }, stored: STORED })).toBe(STORED)
  })
  it('signs out when online with no session, on an auth error, or on SIGNED_OUT', () => {
    expect(resolveSession(null, { offline: false, stored: STORED })).toBeNull()
    expect(resolveSession(null, { error: { name: 'AuthApiError', status: 400 }, stored: STORED })).toBeNull()
    expect(resolveSession(null, { offline: true, stored: STORED, event: 'SIGNED_OUT' })).toBeNull()
  })
  it('signs out when nothing is stored', () => {
    expect(resolveSession(null, { offline: true, stored: null })).toBeNull()
  })
})
