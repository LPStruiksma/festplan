import { supabase } from './supabase'
import { loadArtists, loadArtistsFromCache } from './profile'

// ─────────────────────────────────────────────────────────────────────────────
// invites.js
//
// Three thin helpers for the invite-link flow:
//
//   createInvite(userId, festivalKey) → slug string
//     Copies the inviter's artist list into festival-scoped user_artists
//     rows (the only rows invitees can read), then inserts a new
//     group_invites row and returns its UUID slug.
//     Caller is responsible for copying the URL to the clipboard.
//
//   getInvite(slug) → invite object | null
//     Looks up a non-expired invite by its slug (get_invite, migration 0011),
//     including the inviter's display name.
//     Returns null if not found, expired, or accepted by someone else.
//
//   acceptInvite(invite, session) → festivalKey string | null
//     Records the joiner as the invite's acceptor (accept_invite), then reads
//     the inviter's artist list and inserts a friends row
//     into *the joiner's* friends list so the inviter appears in the joiner's
//     Group tab immediately.
//     Returns the festival_key on success, null on error.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create an invite for the current user and return the slug.
 *
 * @param {string} userId       Supabase auth uid of the person sharing
 * @param {string} festivalKey  e.g. "lowlands" or "glastonbury-2026"
 * @returns {Promise<string>}   The UUID slug to embed in the share URL
 */
export async function createInvite(userId, festivalKey) {
  await shareArtistsForFestival(userId, festivalKey)

  const { data, error } = await supabase
    .from('group_invites')
    .insert({ inviter_user_id: userId, festival_key: festivalKey })
    .select('slug')
    .single()

  if (error) throw new Error(`createInvite: ${error.message}`)
  return data.slug   // UUID string
}

/**
 * Write the inviter's current artist list as user_artists rows scoped to
 * `festivalKey`. The app keeps its own list under festival_key IS NULL, but
 * the "user_artists: readable by invite acceptor" policy (migration 0011)
 * only exposes rows whose festival_key matches the invite, so without this copy
 * every invitee would receive an empty list. Only this festival's rows are
 * replaced; the global list is never touched.
 *
 * @param {string} userId
 * @param {string} festivalKey
 */
async function shareArtistsForFestival(userId, festivalKey) {
  const artists = (await loadArtists(userId)) ?? loadArtistsFromCache()

  // Dedupe case-insensitively (UNIQUE on user_id, festival_key, lower(artist_name)).
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
    .eq('festival_key', festivalKey)

  if (delErr) throw new Error(`createInvite: ${delErr.message}`)
  if (!unique.length) return

  const { error: insErr } = await supabase
    .from('user_artists')
    .insert(
      unique.map((artist_name, position) => ({
        user_id:      userId,
        festival_key: festivalKey,
        artist_name,
        position,
      }))
    )
  if (insErr) throw new Error(`createInvite: ${insErr.message}`)
}

/**
 * Fetch a non-expired invite by its URL slug.
 *
 * @param {string} slug  UUID from the URL — /join/<slug>
 * @returns {Promise<{ slug: string, festival_key: string, inviter_user_id: string, expires_at: string, inviter_name: string | null } | null>}
 */
export async function getInvite(slug) {
  if (!slug) return null

  // group_invites can't be listed (migration 0011); get_invite returns the
  // one row for this slug, or none if it is expired or someone else's.
  const { data, error } = await supabase.rpc('get_invite', { p_slug: slug })

  if (error) {
    console.warn('[festplan] getInvite:', error.message)
    return null
  }

  return data?.[0] ?? null   // null if not found / expired
}

/**
 * Accept an invite: create a friends entry in the joiner's list so the
 * inviter's picks show up immediately in the Group tab.
 *
 * Steps:
 *   0. Record the joiner as the invite's acceptor (accept_invite). The read
 *      below is only allowed for the user who accepted (migration 0011).
 *   1. Take the inviter's name from the invite (get_invite returns it;
 *      other users' profiles rows are not readable).
 *   2. Read the inviter's artists for the festival from user_artists.
 *   3. Check for a duplicate friends row (same inviter via source_user_id) —
 *      skip if already linked. Names can collide ('Your friend', first names).
 *   4. Insert a friends row: user_id = joiner, name = inviter, artists = theirs.
 *
 * @param {{ festival_key: string, inviter_user_id: string, inviter_name?: string | null }} invite
 * @param {{ user: { id: string } }} session  Supabase auth session of the joiner
 * @returns {Promise<string | null>}  festival_key on success, null on error
 */
export async function acceptInvite(invite, session) {
  const joinerId   = session.user.id
  const festKey    = invite.festival_key
  const inviterId  = invite.inviter_user_id

  // ── 0. Accept: also lets the inviter read the joiner's data (migration 0004)
  const { data: acceptedKey, error: accErr } = await supabase
    .rpc('accept_invite', { p_slug: invite.slug })

  if (accErr || !acceptedKey) {
    console.error('[festplan] acceptInvite:', accErr?.message ?? 'invite not accepted')
    return null
  }

  // ── 1. Inviter's display name ─────────────────────────────────────────────
  const inviterName = invite.inviter_name?.trim() || 'Your friend'

  // ── 2. Inviter's artists for this festival ────────────────────────────────
  const { data: artistRows } = await supabase
    .from('user_artists')
    .select('artist_name')
    .eq('user_id', inviterId)
    .eq('festival_key', festKey)
    .order('position', { ascending: true })

  const inviterArtists = (artistRows || []).map(r => r.artist_name)

  // ── 3. Duplicate check — don't add the same inviter twice ────────────────
  //       Match on the inviter's user id, not the name: unnamed inviters all
  //       share the 'Your friend' fallback, and real names can collide.
  const { data: existing } = await supabase
    .from('friends')
    .select('id')
    .eq('user_id', joinerId)
    .eq('festival_key', festKey)
    .eq('source_user_id', inviterId)

  if (existing && existing.length > 0) {
    // Already in the joiner's list — nothing to insert
    return festKey
  }

  // ── 4. Count existing friends to set position (preserves colour mapping) ─
  const { count } = await supabase
    .from('friends')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', joinerId)
    .eq('festival_key', festKey)

  const position = count ?? 0

  // ── 5. Insert the friend entry (with source_user_id for realtime sync) ───
  const { error: insErr } = await supabase
    .from('friends')
    .insert({
      user_id:        joinerId,
      festival_key:   festKey,
      name:           inviterName,
      artists:        inviterArtists,
      position,
      source_user_id: inviterId,  // links to the real user for useGroupSync
    })

  if (insErr) {
    console.error('[festplan] acceptInvite insert:', insErr.message)
    return null
  }

  return festKey
}
