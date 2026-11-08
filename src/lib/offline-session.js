// offline-session.js
// Keep a signed-in user signed in on the festival ground.
//
// supabase-js refreshes an expired access token over the network. With no
// signal that refresh fails, getSession() resolves to { session: null }, and
// the router would send the user to the login page, away from the schedule
// they already have cached. The refresh token is still valid and still
// stored, so while offline we keep using the stored session: reads come from
// the local cache, writes queue in sync-state.js, and supabase-js refreshes
// the token as soon as the network is back.
//
// Only a network failure keeps the stored session. A real sign-out, or an
// auth error from the server, still signs the user out.

/** The session supabase-js keeps in storage, or null. */
export function readStoredSession(storage, key) {
  if (!storage || !key) return null
  try {
    const raw = JSON.parse(storage.getItem(key) || 'null')
    // auth-js v2 stores the session itself; very old builds wrapped it.
    const session = raw?.currentSession ?? raw
    return session?.user?.id && session.refresh_token ? session : null
  } catch {
    return null
  }
}

/** True for errors caused by the network rather than by the auth server. */
export function isNetworkAuthError(error) {
  return !!error && (error.name === 'AuthRetryableFetchError' || error.status === 0)
}

/**
 * The session the app should use.
 * @param {object|null} session  what supabase-js returned
 * @param {object} ctx
 * @param {boolean} ctx.offline   navigator reports no network
 * @param {object|null} ctx.error error supabase-js returned with the session
 * @param {object|null} ctx.stored readStoredSession(...)
 * @param {string} [ctx.event]    auth event name, when called from onAuthStateChange
 */
export function resolveSession(session, { offline = false, error = null, stored = null, event } = {}) {
  if (session) return session
  if (event === 'SIGNED_OUT') return null
  if (stored && (offline || isNetworkAuthError(error))) return stored
  return null
}
