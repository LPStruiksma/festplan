import { supabase } from './supabase'
import { withSync, registerWriteHandler } from './sync-state'

const LS_ARTISTS_KEY = 'festplan_artists'

// ─────────────────────────────────────────────────────────────────────────────
// PROFILE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ensure a profiles row exists for the signed-in user and keep it fresh.
 *
 * The DB trigger (handle_new_user) already inserts the row on auth.users
 * INSERT, but calling this from the client after every sign-in keeps
 * display_name / avatar_url current without requiring a separate update call.
 *
 * Safe to call multiple times — uses ON CONFLICT DO UPDATE.
 *
 * @param {import('@supabase/supabase-js').Session} session
 */
export async function ensureProfile(session) {
  if (!session?.user) return
  const { id, user_metadata: m } = session.user
  const { error } = await supabase
    .from('profiles')
    .upsert(
      {
        id,
        display_name: m?.full_name ?? m?.name ?? null,
        avatar_url:   m?.avatar_url ?? m?.picture ?? null,
        // Strip the "spotify:" prefix that Supabase sometimes prepends
        spotify_id:   (m?.provider_id ?? m?.sub ?? '').replace(/^spotify:/, ''),
      },
      { onConflict: 'id' }
    )
  if (error) console.warn('[festplan] ensureProfile:', error.message)
}

// ─────────────────────────────────────────────────────────────────────────────
// ARTIST LIST
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Read the artist list from localStorage (synchronous, instant).
 *
 * Use this as a lazy initialiser for useState so the UI paints with the
 * previous session's list before any network request completes.
 *
 * @returns {string[]}
 */
export function loadArtistsFromCache() {
  try {
    return JSON.parse(localStorage.getItem(LS_ARTISTS_KEY) || '[]')
  } catch {
    return []
  }
}

/**
 * Load the persisted artist list from Supabase.
 *
 * Returns:
 *   - string[]  — the saved list (may be empty if user cleared it)
 *   - null      — fetch failed (caller should fall back to Spotify data)
 *
 * Uses festival_key IS NULL to target the global pre-festival list
 * (festival-scoped lists are a separate concern — see user_schedules).
 *
 * @param {string | undefined} userId  auth.users UUID
 * @returns {Promise<string[] | null>}
 */
export async function loadArtists(userId) {
  if (!userId) return null
  const { data, error } = await supabase
    .from('user_artists')
    .select('artist_name')
    .eq('user_id', userId)
    .is('festival_key', null)
    .order('position', { ascending: true })
  if (error) {
    console.warn('[festplan] loadArtists:', error.message)
    return null
  }
  // Defensive dedup: guard against any pre-constraint rows that survived cleanup.
  const seen = new Set()
  return data
    .map(r => r.artist_name)
    .filter(a => {
      const key = a.toLowerCase().trim()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

/**
 * Raw Supabase write — throws on error so withSync() can detect failures.
 * Registered as the 'artists' drain handler so queued writes can be replayed.
 */
async function _rawSaveArtistsRemote(userId, artists) {
  // Dedupe case-insensitively, preserving first-occurrence order.
  // Prevents tripping the UNIQUE INDEX on (user_id, COALESCE(festival_key,''), lower(artist_name)).
  const seen = new Set()
  const unique = artists.filter(a => {
    const key = a.toLowerCase().trim()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  const { error: delErr } = await supabase
    .from('user_artists')
    .delete()
    .eq('user_id', userId)
    .is('festival_key', null)

  if (delErr) throw new Error(delErr.message)
  if (!unique.length) return

  const { error: insErr } = await supabase
    .from('user_artists')
    .insert(
      unique.map((artist_name, position) => ({
        user_id:      userId,
        festival_key: null,   // global list — not yet tied to a festival
        artist_name,
        position,             // 0-based; ORDER BY position ASC on read
      }))
    )
  if (insErr) throw new Error(insErr.message)
}

registerWriteHandler('artists', _rawSaveArtistsRemote)

/**
 * Persist the artist list to Supabase only (no localStorage write).
 *
 * Implements a delete-then-insert pattern to preserve insertion order
 * cleanly — supabase-js v2 doesn't support positional upserts in one
 * shot without a stored procedure.
 *
 * Called from the debounced auto-save effect in SetupPage so that
 * rapid edits only fire a single network write.  Wrapped in withSync so
 * transient failures are retried and surfaced in the sync pill.
 *
 * @param {string}   userId
 * @param {string[]} artists  Ordered list of artist name strings
 */
export function saveArtistsRemote(userId, artists) {
  if (!userId) return Promise.resolve()
  return withSync(
    () => _rawSaveArtistsRemote(userId, artists),
    { type: 'artists', args: [userId, artists] }
  )
}

/**
 * Write-through save: update localStorage immediately, then persist to
 * Supabase.  Use this when you need the cache to be current right away
 * (e.g. before a navigation that will read from localStorage).
 *
 * For debounced auto-saves prefer saveArtistsRemote so the immediate
 * localStorage write doesn't happen redundantly on every render.
 *
 * @param {string} userId
 * @param {string[]} artists
 */
export async function saveArtists(userId, artists) {
  localStorage.setItem(LS_ARTISTS_KEY, JSON.stringify(artists))
  await saveArtistsRemote(userId, artists)
}
