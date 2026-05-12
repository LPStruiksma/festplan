import { supabase } from './supabase'
import { withSync, registerWriteHandler } from './sync-state'

// ─────────────────────────────────────────────────────────────────────────────
// localStorage key helpers
// Using festival-scoped keys so returning to a different festival doesn't
// bleed state from the previous one.
// ─────────────────────────────────────────────────────────────────────────────

export const LS_FESTIVAL_KEY  = 'festplan_festival'
const lsResolvedKey = festKey => `festplan_resolved_${festKey}`
const lsRatingsKey  = festKey => `festplan_ratings_${festKey}`
const lsFriendsKey  = festKey => `festplan_friends_${festKey}`

// ─────────────────────────────────────────────────────────────────────────────
// Cache accessors — synchronous, used for lazy useState initialisation so
// the UI paints instantly from the last session before any network call.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Read the resolved-conflicts map for a festival from localStorage.
 * Returns {} if nothing is cached or the cache is corrupt.
 *
 * @param {string} festKey
 * @returns {{ [conflictKey: string]: string }}
 */
export function loadResolvedFromCache(festKey) {
  try {
    return JSON.parse(localStorage.getItem(lsResolvedKey(festKey)) || '{}')
  } catch {
    return {}
  }
}

/**
 * Read the artist-ratings map for a festival from localStorage.
 * Returns {} if nothing is cached or the cache is corrupt.
 *
 * @param {string} festKey
 * @returns {{ [artistName: string]: number }}
 */
export function loadRatingsFromCache(festKey) {
  try {
    return JSON.parse(localStorage.getItem(lsRatingsKey(festKey)) || '{}')
  } catch {
    return {}
  }
}

/**
 * Read the friends list for a festival from localStorage.
 * Returns [] if nothing is cached or the cache is corrupt.
 *
 * @param {string} festKey
 * @returns {Array<{ name: string, artists: string[] }>}
 */
export function loadFriendsFromCache(festKey) {
  try {
    return JSON.parse(localStorage.getItem(lsFriendsKey(festKey)) || '[]')
  } catch {
    return []
  }
}

// Internal write helpers — not exported; components write through the
// handler functions (handleResolve / handleRate) which call these directly.
function cacheResolved(festKey, resolved) {
  localStorage.setItem(lsResolvedKey(festKey), JSON.stringify(resolved))
}

function cacheRatings(festKey, ratings) {
  localStorage.setItem(lsRatingsKey(festKey), JSON.stringify(ratings))
}

function cacheFriends(festKey, friends) {
  localStorage.setItem(lsFriendsKey(festKey), JSON.stringify(friends))
}

// ─────────────────────────────────────────────────────────────────────────────
// Supabase reads
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Load the user's full schedule state for a given festival from Supabase.
 * Runs the resolutions and ratings fetches in parallel.
 *
 * Returns:
 *   resolved — { [conflictKey]: chosenArtist } | null (null = fetch failed)
 *   ratings  — { [artistName]: stars }         | null (null = fetch failed)
 *
 * On success the results are also written back into localStorage so the
 * cache is always as fresh as the last successful Supabase read.
 *
 * @param {string} userId
 * @param {string} festKey
 * @returns {Promise<{ resolved: object|null, ratings: object|null }>}
 */
export async function loadSchedule(userId, festKey) {
  if (!userId || !festKey) return { resolved: null, ratings: null }

  const [resResult, ratResult] = await Promise.allSettled([
    supabase
      .from('schedule_resolutions')
      .select('artist_a, artist_b, chosen_artist')
      .eq('user_id', userId)
      .eq('festival_key', festKey),
    supabase
      .from('artist_ratings')
      .select('artist_name, rating')
      .eq('user_id', userId)
      .eq('festival_key', festKey),
  ])

  // Reconstruct the frontend conflict key: "artistA|||artistB"
  // artist_a < artist_b is guaranteed by the DB CHECK constraint so the
  // join order matches what the frontend produces with .sort().join('|||').
  const resolved = resResult.status === 'fulfilled' && !resResult.value.error
    ? Object.fromEntries(
        resResult.value.data.map(r => [`${r.artist_a}|||${r.artist_b}`, r.chosen_artist])
      )
    : null

  const ratings = ratResult.status === 'fulfilled' && !ratResult.value.error
    ? Object.fromEntries(
        ratResult.value.data.map(r => [r.artist_name, r.rating])
      )
    : null

  if (resolved !== null) cacheResolved(festKey, resolved)
  if (ratings  !== null) cacheRatings(festKey, ratings)

  if (resResult.status === 'fulfilled' && resResult.value.error)
    console.warn('[festplan] loadSchedule resolutions:', resResult.value.error.message)
  if (ratResult.status === 'fulfilled' && ratResult.value.error)
    console.warn('[festplan] loadSchedule ratings:', ratResult.value.error.message)

  return { resolved, ratings }
}

// ─────────────────────────────────────────────────────────────────────────────
// Supabase writes
//
// Each write is split into:
//   _raw*  — private, throws on error, used by withSync() and the drain handler
//   public — exported, wraps _raw* in withSync() so failures are retried and
//            surfaced via the SyncProvider state machine
//
// The _raw* functions are also registered with registerWriteHandler() so
// drainPendingWrites() can replay any writes that were queued in localStorage
// after a failed session.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Record which festival the user is actively planning.
 * Not wrapped in withSync — this is a lightweight housekeeping write that
 * doesn't affect user data if it fails; the localStorage key is the source
 * of truth for SchedulePage's first paint anyway.
 *
 * @param {string} userId
 * @param {string} festKey  e.g. "lowlands", "coachella"
 */
export async function saveFestivalKey(userId, festKey) {
  if (!userId || !festKey) return
  localStorage.setItem(LS_FESTIVAL_KEY, festKey)
  const { error } = await supabase
    .from('user_schedules')
    .upsert(
      { user_id: userId, festival_key: festKey },
      { onConflict: 'user_id,festival_key' }
    )
  if (error) console.warn('[festplan] saveFestivalKey:', error.message)
}

// ── Resolution ───────────────────────────────────────────────────────────────

async function _rawSaveResolution(userId, festKey, conflictKey, chosenArtist) {
  const [artist_a, artist_b] = conflictKey.split('|||')
  const { error } = await supabase
    .from('schedule_resolutions')
    .upsert(
      {
        user_id:       userId,
        festival_key:  festKey,
        artist_a,
        artist_b,
        chosen_artist: chosenArtist,
      },
      { onConflict: 'user_id,festival_key,artist_a,artist_b' }
    )
  if (error) throw new Error(error.message)
}

registerWriteHandler('resolution', _rawSaveResolution)

/**
 * Upsert a single conflict resolution.
 *
 * conflictKey is the frontend's "[a, b].sort().join('|||')" string — already
 * alphabetically ordered, which matches the DB CHECK (artist_a < artist_b).
 * We split on '|||' to populate the two columns.
 *
 * @param {string} userId
 * @param {string} festKey
 * @param {string} conflictKey   "ArtistA|||ArtistB" (A < B alphabetically)
 * @param {string} chosenArtist  Must equal ArtistA or ArtistB
 */
export function saveResolution(userId, festKey, conflictKey, chosenArtist) {
  if (!userId || !festKey) return Promise.resolve()
  return withSync(
    () => _rawSaveResolution(userId, festKey, conflictKey, chosenArtist),
    { type: 'resolution', args: [userId, festKey, conflictKey, chosenArtist] }
  )
}

// ── Rating ────────────────────────────────────────────────────────────────────

async function _rawSaveRating(userId, festKey, artistName, rating) {
  const { error } = await supabase
    .from('artist_ratings')
    .upsert(
      {
        user_id:      userId,
        festival_key: festKey,
        artist_name:  artistName,
        rating,
      },
      { onConflict: 'user_id,festival_key,artist_name' }
    )
  if (error) throw new Error(error.message)
}

registerWriteHandler('rating', _rawSaveRating)

/**
 * Upsert a single artist rating (1–5 stars).
 *
 * @param {string} userId
 * @param {string} festKey
 * @param {string} artistName
 * @param {number} rating   Integer 1–5
 */
export function saveRating(userId, festKey, artistName, rating) {
  if (!userId || !festKey) return Promise.resolve()
  return withSync(
    () => _rawSaveRating(userId, festKey, artistName, rating),
    { type: 'rating', args: [userId, festKey, artistName, rating] }
  )
}

// ── Friends ───────────────────────────────────────────────────────────────────

/**
 * Load the friends list for a festival from Supabase.
 *
 * Returns:
 *   Array<{ name: string, artists: string[] }>  ordered by position ASC
 *   null — if the fetch failed (caller keeps the localStorage cache)
 *
 * The `position` column is 0-based insertion order. Loading in position order
 * preserves the index-based FRIEND_COLORS assignment that the UI relies on:
 * friend at position 0 → FRIEND_COLORS[0], position 1 → FRIEND_COLORS[1].
 *
 * @param {string} userId
 * @param {string} festKey
 * @returns {Promise<Array<{ name: string, artists: string[] }> | null>}
 */
export async function loadFriends(userId, festKey) {
  if (!userId || !festKey) return null
  const { data, error } = await supabase
    .from('friends')
    .select('name, artists, source_user_id')
    .eq('user_id', userId)
    .eq('festival_key', festKey)
    .order('position', { ascending: true })
  if (error) {
    console.warn('[festplan] loadFriends:', error.message)
    return null
  }
  cacheFriends(festKey, data)
  return data   // [{ name, artists, source_user_id }]
}

async function _rawSaveFriends(userId, festKey, friends) {
  const { error: delErr } = await supabase
    .from('friends')
    .delete()
    .eq('user_id', userId)
    .eq('festival_key', festKey)

  if (delErr) throw new Error(delErr.message)
  if (!friends.length) return

  const { error: insErr } = await supabase
    .from('friends')
    .insert(
      friends.map(({ name, artists }, position) => ({
        user_id:      userId,
        festival_key: festKey,
        name,
        artists,
        position,
      }))
    )
  if (insErr) throw new Error(insErr.message)
}

registerWriteHandler('friends', _rawSaveFriends)

/**
 * Replace the friends list for a festival in Supabase.
 *
 * Uses delete-then-insert to keep row ordering clean.
 * The whole operation is wrapped in withSync so a partial failure (delete OK,
 * insert fails) will retry the full delete+insert — safe because delete is
 * idempotent for an already-empty table.
 *
 * @param {string} userId
 * @param {string} festKey
 * @param {Array<{ name: string, artists: string[] }>} friends
 */
export function saveFriends(userId, festKey, friends) {
  if (!userId || !festKey) return Promise.resolve()
  return withSync(
    () => _rawSaveFriends(userId, festKey, friends),
    { type: 'friends', args: [userId, festKey, friends] }
  )
}
