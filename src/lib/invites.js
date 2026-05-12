import { supabase } from './supabase'

// ─────────────────────────────────────────────────────────────────────────────
// invites.js
//
// Three thin helpers for the invite-link flow:
//
//   createInvite(userId, festivalKey) → slug string
//     Inserts a new group_invites row and returns its UUID slug.
//     Caller is responsible for copying the URL to the clipboard.
//
//   getInvite(slug) → invite object | null
//     Looks up a non-expired invite by its slug.
//     Returns null if not found or expired.
//
//   acceptInvite(invite, session) → festivalKey string | null
//     Reads the inviter's display_name and artist list then inserts
//     a friends row into *the joiner's* friends list so the inviter
//     appears in the joiner's Group tab immediately.
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
  const { data, error } = await supabase
    .from('group_invites')
    .insert({ inviter_user_id: userId, festival_key: festivalKey })
    .select('slug')
    .single()

  if (error) throw new Error(`createInvite: ${error.message}`)
  return data.slug   // UUID string
}

/**
 * Fetch a non-expired invite by its URL slug.
 *
 * @param {string} slug  UUID from the URL — /join/<slug>
 * @returns {Promise<{ slug: string, festival_key: string, inviter_user_id: string, expires_at: string } | null>}
 */
export async function getInvite(slug) {
  if (!slug) return null

  const { data, error } = await supabase
    .from('group_invites')
    .select('slug, festival_key, inviter_user_id, expires_at')
    .eq('slug', slug)
    .gt('expires_at', new Date().toISOString())  // expired rows → no result
    .maybeSingle()                               // null if missing; no throw

  if (error) {
    console.warn('[festplan] getInvite:', error.message)
    return null
  }

  return data   // null if not found / expired
}

/**
 * Accept an invite: create a friends entry in the joiner's list so the
 * inviter's picks show up immediately in the Group tab.
 *
 * Steps:
 *   1. Read the inviter's display_name from profiles (allowed by the
 *      "profiles: readable via active invite" RLS policy in migration 0003).
 *   2. Read the inviter's artists for the festival from user_artists (allowed
 *      by the "user_artists: readable via active invite" policy).
 *   3. Check for a duplicate friends row (name match) — skip if already linked.
 *   4. Insert a friends row: user_id = joiner, name = inviter, artists = theirs.
 *
 * @param {{ festival_key: string, inviter_user_id: string }} invite
 * @param {{ user: { id: string } }} session  Supabase auth session of the joiner
 * @returns {Promise<string | null>}  festival_key on success, null on error
 */
export async function acceptInvite(invite, session) {
  const joinerId   = session.user.id
  const festKey    = invite.festival_key
  const inviterId  = invite.inviter_user_id

  // ── 1. Inviter's display name ─────────────────────────────────────────────
  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name')
    .eq('id', inviterId)
    .maybeSingle()

  const inviterName = profile?.display_name?.trim() || 'Your friend'

  // ── 2. Inviter's artists for this festival ────────────────────────────────
  const { data: artistRows } = await supabase
    .from('user_artists')
    .select('artist_name')
    .eq('user_id', inviterId)
    .eq('festival_key', festKey)
    .order('position', { ascending: true })

  const inviterArtists = (artistRows || []).map(r => r.artist_name)

  // ── 3. Duplicate check — don't add the same inviter twice ────────────────
  const { data: existing } = await supabase
    .from('friends')
    .select('id')
    .eq('user_id', joinerId)
    .eq('festival_key', festKey)
    .eq('name', inviterName)

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

  // ── 6. Mark the invite as accepted so the inviter can read the joiner's data
  //       (enables the bidirectional RLS policies in migration 0004)
  await supabase
    .from('group_invites')
    .update({ accepted_by: joinerId })
    .eq('slug', invite.slug)
    // Non-fatal: if this fails the friend entry still works; realtime sync
    // for the inviter side will just be unavailable until the row is updated.

  return festKey
}
