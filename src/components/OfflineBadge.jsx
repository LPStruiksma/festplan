import React from 'react'
import { T } from '../lib/ui'
import { useOnline, getLastSynced, usePendingCount } from '../lib/sync-state'

/**
 * Small notice on the schedule page when FestPlan is working from what it
 * saved earlier: the device is offline, or the server couldn't be reached
 * and the timetable came from the local copy.
 *
 * Props:
 *   fromCache — the timetable on screen is the saved copy (optional)
 *   online    — override the browser's online state (tests)
 *   now       — override the clock used to decide "today" (tests)
 */
const pad = n => String(n).padStart(2, '0')
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// "14:32" for today, "Sat 14:32" for another day, on the device's clock.
function formatSynced(at, now = Date.now()) {
  const d = new Date(at)
  const n = new Date(now)
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  return d.toDateString() === n.toDateString() ? hm : `${DAYS[d.getDay()]} ${hm}`
}

export default function OfflineBadge({ fromCache = false, online: onlineOverride, now }) {
  const browserOnline = useOnline()
  const pending = usePendingCount()
  const online = onlineOverride ?? browserOnline
  if (online && !fromCache) return null

  const synced = getLastSynced()
  const title = online ? "Couldn't reach FestPlan" : 'Offline'

  return (
    <div role="status" aria-label="Offline status" style={{
      display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '4px 10px',
      background: 'var(--fp-s2)',
      border: '1px solid var(--fp-border)',
      borderRadius: 'var(--fp-radius-md)',
      padding: '8px 14px',
      marginBottom: 14,
      fontFamily: T.body, fontSize: 12, lineHeight: 1.5,
      color: 'var(--fp-text-dim)',
    }}>
      <strong style={{ color: 'var(--fp-text)' }}>
        {title}{synced ? `, last synced ${formatSynced(synced, now)}` : ''}
      </strong>
      <span>
        {pending
          ? `${pending} change${pending === 1 ? '' : 's'} will sync when you're back online.`
          : "Your saved schedule still works. Changes you make will sync when you're back online."}
      </span>
    </div>
  )
}
