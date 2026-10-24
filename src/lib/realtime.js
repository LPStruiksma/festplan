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

  // Ref-tracked subscription handles.  Storing channels in a ref (rather than
  // only in the effect closure) lets us tear down an existing subscription set
  // at the very start of the next effect run, before the new set is created.
  // This closes the race window where rapid mount → unmount → mount could
  // leave two overlapping subscription sets alive simultaneously.
  const channelsRef = useRef([])

  // Serialise the array so useEffect can compare it by value across renders.
  const userIdsKey = JSON.stringify(
    [...(groupUserIds ?? [])].sort()  // sort → stable key regardless of order
  )

  useEffect(() => {
    // ── Tear down any channels that survived from a previous run ────────────
    // Normally React's cleanup function handles this, but under rapid
    // mount/unmount cycles the cleanup can fire after the new effect has
    // already started.  Removing here ensures we never have overlapping sets.
    channelsRef.current.forEach(ch => supabase.removeChannel(ch))
    channelsRef.current = []

    if (!festivalKey || !groupUserIds?.length) return

    // isMounted guards against calling onUpdate after the component has
    // unmounted — possible if a Realtime payload arrives during the brief
    // window between when React schedules cleanup and when the WebSocket
    // actually closes.
    let isMounted = true

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
            if (!isMounted) return
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
            if (!isMounted) return
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

      channelsRef.current.push(ch)
    }

    // Cleanup — runs when groupUserIds / festivalKey changes or on unmount.
    return () => {
      isMounted = false
      channelsRef.current.forEach(ch => supabase.removeChannel(ch))
      channelsRef.current = []
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [festivalKey, userIdsKey])
}

// ─────────────────────────────────────────────────────────────────────────────
// useFriendsSync — keep the friends list in sync across the user's devices.
//
// The friends table is owner-only under RLS, so this subscribes to the current
// user's own rows (filter user_id=eq.<userId>).  saveFriends() rewrites the
// whole set (DELETE then INSERT), so a single save arrives as a burst of
// events, and DELETE payloads carry only the primary key.  Rather than rebuild
// the list from the burst, each burst is coalesced into one authoritative
// reload through `load` (loadFriends), FRIENDS_RELOAD_DELAY ms after the last
// event.  While a local friends save is still pending, the reload waits so it
// cannot overwrite an edit that has not reached the server yet.
//
// Needs public.friends in the supabase_realtime publication; without it the
// channel stays silent and the list refreshes on the next mount, as before.
// ─────────────────────────────────────────────────────────────────────────────

export const FRIENDS_RELOAD_DELAY = 400

/**
 * useFriendsSync
 *
 * @param {string}  userId       The signed-in user.  Falsy → no subscription.
 * @param {string}  festivalKey  Festival whose friends list is shown.
 * @param {Object}  opts
 * @param {function(string, string): Promise<Object[]|null>} opts.load
 *        Fetches the friends list (loadFriends).  null means the fetch failed
 *        and is not applied.
 * @param {function(Object[]): void} opts.onFriends  Receives the reloaded list.
 * @param {function(): boolean} [opts.isLocalSavePending]  True while a local
 *        friends save is queued; the reload is retried later.
 *        Callbacks are read via ref, so inline functions are fine.
 */
export function useFriendsSync(userId, festivalKey, opts) {
  const optsRef = useRef(opts)
  useEffect(() => { optsRef.current = opts })

  useEffect(() => {
    if (!userId || !festivalKey) return

    let isMounted = true
    let timer = null

    const reload = () => {
      timer = null
      if (!isMounted) return
      const { load, isLocalSavePending } = optsRef.current
      if (isLocalSavePending?.()) {
        timer = setTimeout(reload, FRIENDS_RELOAD_DELAY)
        return
      }
      Promise.resolve(load(userId, festivalKey)).then(friends => {
        if (isMounted && friends !== null && friends !== undefined) {
          optsRef.current.onFriends(friends)
        }
      })
    }

    const channelName = `friends-sync:${festivalKey}:${userId}`
    const ch = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event:  '*',
          schema: 'public',
          table:  'friends',
          filter: `user_id=eq.${userId}`,
        },
        payload => {
          if (!isMounted) return
          // DELETE payloads hold only the id, so they always pass this guard.
          const row = payload.new ?? payload.old ?? {}
          if (row.festival_key && row.festival_key !== festivalKey) return
          clearTimeout(timer)
          timer = setTimeout(reload, FRIENDS_RELOAD_DELAY)
        },
      )
      .subscribe((status, err) => {
        if (err) {
          console.warn(`[festplan] realtime ${channelName}:`, err.message ?? err)
        }
      })

    return () => {
      isMounted = false
      clearTimeout(timer)
      supabase.removeChannel(ch)
    }
  }, [userId, festivalKey])
}
