import { useEffect, useRef } from 'react'
import { supabase } from './supabase'

// ─────────────────────────────────────────────────────────────────────────────
// realtime.js
//
// useGroupSync — subscribe to Supabase Realtime postgres_changes for a set of
// user IDs' artist_ratings and schedule_resolutions rows, scoped to one
// festival.
//
// Call this hook in SchedulePage (or any component) to receive live updates
// when any member of the group changes their ratings or conflict resolutions.
//
// Cross-user reads are gated by the RLS policies added in migration 0004:
//   • Your own rows always come through (owner policy).
//   • A group partner's rows come through when you are connected via the
//     invite flow (accepted_by / inviter_user_id pairing).
//   • Manually-added friends have no source_user_id and are NOT subscribed to
//     (they are not real Supabase users).
//
// One Supabase Realtime channel is created per user ID.  Each channel:
//   • Listens to INSERT / UPDATE / DELETE on artist_ratings
//   • Listens to INSERT / UPDATE / DELETE on schedule_resolutions
//   Server-side filter: user_id=eq.<userId> — reduces traffic.
//   Client-side filter: festival_key match — guards against bleed from other
//   festivals (the Realtime filter only supports a single equality clause).
//
// All channels are removed on unmount.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} RealtimeUpdate
 * @property {'artist_ratings'|'schedule_resolutions'} table  Which table changed
 * @property {string}  eventType   'INSERT' | 'UPDATE' | 'DELETE'
 * @property {string}  userId      Whose row changed
 * @property {Object}  payload     Raw Supabase Realtime payload ({ new, old, … })
 */

/**
 * useGroupSync
 *
 * @param {string[]}  groupUserIds  User IDs to subscribe to.  Always include
 *                                  the current user's own ID for multi-device
 *                                  sync.  Pass [] to skip all subscriptions.
 * @param {string}    festivalKey   Only events for this festival are forwarded
 *                                  to the callback.
 * @param {function(RealtimeUpdate): void} onUpdate  Called for every matching
 *                                  event.  Stable via ref — safe to pass an
 *                                  inline function; no re-subscription needed
 *                                  when the callback identity changes.
 */
export function useGroupSync(groupUserIds, festivalKey, onUpdate) {
  // Keep a ref to the latest callback so the subscription closure never goes
  // stale without requiring a channel teardown + rebuild.
  const cbRef = useRef(onUpdate)
  cbRef.current = onUpdate

  // Serialise the array so useEffect can compare it by value across renders.
  const userIdsKey = JSON.stringify(
    [...(groupUserIds ?? [])].sort()  // sort → stable key regardless of order
  )

  useEffect(() => {
    if (!festivalKey || !groupUserIds?.length) return

    const channels = []

    for (const userId of groupUserIds) {
      // Unique channel name per (festival, user) so teardowns are precise.
      const channelName = `group-sync:${festivalKey}:${userId}`

      const ch = supabase
        .channel(channelName)

        // ── artist_ratings ──────────────────────────────────────────────────
        .on(
          'postgres_changes',
          {
            event:  '*',          // INSERT | UPDATE | DELETE
            schema: 'public',
            table:  'artist_ratings',
            filter: `user_id=eq.${userId}`,   // server-side narrow
          },
          payload => {
            // Client-side festival guard (Realtime only allows one filter).
            const row = payload.new ?? payload.old ?? {}
            if (row.festival_key && row.festival_key !== festivalKey) return

            cbRef.current({
              table:     'artist_ratings',
              eventType: payload.eventType,
              userId,
              payload,
            })
          },
        )

        // ── schedule_resolutions ────────────────────────────────────────────
        .on(
          'postgres_changes',
          {
            event:  '*',
            schema: 'public',
            table:  'schedule_resolutions',
            filter: `user_id=eq.${userId}`,
          },
          payload => {
            const row = payload.new ?? payload.old ?? {}
            if (row.festival_key && row.festival_key !== festivalKey) return

            cbRef.current({
              table:     'schedule_resolutions',
              eventType: payload.eventType,
              userId,
              payload,
            })
          },
        )

        .subscribe((status, err) => {
          if (err) {
            console.warn(`[festplan] realtime ${channelName}:`, err.message ?? err)
          }
        })

      channels.push(ch)
    }

    // Cleanup — runs when groupUserIds / festivalKey changes or on unmount.
    return () => {
      channels.forEach(ch => supabase.removeChannel(ch))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [festivalKey, userIdsKey])
}
