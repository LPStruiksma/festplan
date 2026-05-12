import { useState, useMemo, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { FESTIVALS, FEST_COLORS, FRIEND_COLORS, norm, toMins, overlaps } from '../lib/festivals'
import {
  loadSchedule, saveResolution, saveRating, saveFestivalKey,
  loadResolvedFromCache, loadRatingsFromCache,
  loadFriends, saveFriends, loadFriendsFromCache,
} from '../lib/schedule-store'
import { createInvite } from '../lib/invites'
import { useGroupSync } from '../lib/realtime'
import { T } from '../lib/ui'
import { getValidSpotifyToken } from '../lib/spotify-auth'

// ── Sub-components ────────────────────────────────────────────────────────────
import HeaderBar      from '../components/schedule/HeaderBar'
import ConflictBanner from '../components/schedule/ConflictBanner'
import MyScheduleTab  from '../components/schedule/MyScheduleTab'
import GroupTab       from '../components/schedule/GroupTab'

/* ═══════════════════════════════════════════════════════════════════════════
   SCHEDULE PAGE — Festival Noir
   Thin orchestrator: all state + derived data lives here;
   rendering is delegated to components/schedule/*.
   ═══════════════════════════════════════════════════════════════════════════ */

export default function SchedulePage({ session }) {
  const navigate = useNavigate()
  const userId = session?.user?.id

  // ── Stable derived festival data (memo-ised from localStorage) ────────────
  const myArtists = useMemo(() => {
    try { return JSON.parse(localStorage.getItem('festplan_artists') || '[]') } catch { return [] }
  }, [])
  const festId = useMemo(() => localStorage.getItem('festplan_festival'), [])
  const festMeta = useMemo(() => {
    try { return JSON.parse(localStorage.getItem('festplan_festival_meta') || 'null') } catch { return null }
  }, [])
  const fest = useMemo(() => {
    if (!festId) return null
    // Hardcoded festivals always take precedence — full timetable available.
    if (FESTIVALS[festId]) return FESTIVALS[festId]
    // Live-discovered festival: rebuild from saved discovery metadata.
    if (festMeta && festMeta.id === festId) {
      return {
        id: festMeta.id,
        name: festMeta.name,
        location: festMeta.location || '',
        emoji: festMeta.emoji || '🎵',
        days: [],
        stages: [],
        lineup: (festMeta.matchedArtists || []).map(artist => ({
          artist, stage: null, day: null, start: null, end: null,
        })),
        hasTimetable: false,
        accentColor: festMeta.accentColor || null,
      }
    }
    return null
  }, [festId, festMeta])

  // True when the festival has no published timetable.
  const isLineupOnly = fest ? fest.hasTimetable === false : false
  const fa = fest ? (FEST_COLORS[fest.id] || fest.accentColor || '#c8f400') : '#c8f400'

  useEffect(() => {
    if (!festId || !myArtists.length || !fest) navigate('/setup', { replace: true })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── UI state ──────────────────────────────────────────────────────────────
  const [day,          setDay]          = useState(0)
  const [viewMode,     setViewMode]     = useState('list')
  const [tab,          setTab]          = useState('mine')
  const [addingFriend, setAddingFriend] = useState(false)
  const [newFName,     setNewFName]     = useState('')
  const [newFArtists,  setNewFArtists]  = useState('')
  // 'idle' | 'loading' | 'copied' | 'error'
  const [inviteStatus, setInviteStatus] = useState('idle')
  // null | { type: 'loading'|'success'|'error', msg: string, url?: string }
  const [toast,        setToast]        = useState(null)
  const toastTimerRef = useRef(null)

  // ── Persisted state — lazy-init from localStorage cache ───────────────────
  const [resolved, setResolved] = useState(() => loadResolvedFromCache(festId))
  const [friends,  setFriends]  = useState(() => loadFriendsFromCache(festId))
  const [ratings,  setRatings]  = useState(() => loadRatingsFromCache(festId))

  // ── Realtime group sync ───────────────────────────────────────────────────
  const groupUserIds = useMemo(() => {
    const ids = new Set(userId ? [userId] : [])
    friends.forEach(f => { if (f.source_user_id) ids.add(f.source_user_id) })
    return [...ids]
  }, [userId, friends])

  useGroupSync(groupUserIds, festId, ({ table, userId: srcId, payload }) => {
    if (table === 'artist_ratings') {
      const row = payload.new
      if (!row) return
      if (srcId === userId) setRatings(prev => ({ ...prev, [row.artist_name]: row.rating }))
    }
    if (table === 'schedule_resolutions') {
      const row = payload.new
      if (!row || srcId !== userId) return
      const key = `${row.artist_a}|||${row.artist_b}`
      setResolved(prev => ({ ...prev, [key]: row.chosen_artist }))
    }
  })

  // ── Debounce timer maps ───────────────────────────────────────────────────
  const resolutionTimers = useRef({})
  const ratingTimers     = useRef({})
  const friendsTimer     = useRef(null)

  // ── Mount: persist festival choice; pull authoritative state from Supabase ─
  useEffect(() => {
    if (!userId || !festId) return
    saveFestivalKey(userId, festId)
    loadSchedule(userId, festId).then(({ resolved: r, ratings: rt }) => {
      if (r  !== null) setResolved(r)
      if (rt !== null) setRatings(rt)
    })
    loadFriends(userId, festId).then(f => {
      if (f !== null) setFriends(f)
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleResolve = (conflictKey, chosenArtist) => {
    setResolved(prev => {
      const next = { ...prev, [conflictKey]: chosenArtist }
      localStorage.setItem(`festplan_resolved_${festId}`, JSON.stringify(next))
      return next
    })
    clearTimeout(resolutionTimers.current[conflictKey])
    resolutionTimers.current[conflictKey] = setTimeout(
      () => saveResolution(userId, festId, conflictKey, chosenArtist), 500
    )
  }

  const handleRate = (artist, stars) => {
    setRatings(prev => {
      const next = { ...prev, [artist]: stars }
      localStorage.setItem(`festplan_ratings_${festId}`, JSON.stringify(next))
      return next
    })
    clearTimeout(ratingTimers.current[artist])
    ratingTimers.current[artist] = setTimeout(
      () => saveRating(userId, festId, artist, stars), 500
    )
  }

  const scheduleFriendsSave = (nextFriends) => {
    localStorage.setItem(`festplan_friends_${festId}`, JSON.stringify(nextFriends))
    clearTimeout(friendsTimer.current)
    friendsTimer.current = setTimeout(
      () => saveFriends(userId, festId, nextFriends), 500
    )
  }

  const handleAddFriend = (name, artists) => {
    const next = [...friends, { name, artists }]
    setFriends(next)
    scheduleFriendsSave(next)
  }

  const handleRemoveFriend = (i) => {
    const next = friends.filter((_, j) => j !== i)
    setFriends(next)
    scheduleFriendsSave(next)
  }

  const handleInvite = async () => {
    if (inviteStatus === 'loading') return
    setInviteStatus('loading')
    try {
      const slug = await createInvite(userId, festId)
      await navigator.clipboard.writeText(`https://festplan.app/join/${slug}`)
      setInviteStatus('copied')
      setTimeout(() => setInviteStatus('idle'), 3000)
    } catch (err) {
      console.error('[festplan] handleInvite:', err)
      setInviteStatus('error')
      setTimeout(() => setInviteStatus('idle'), 3000)
    }
  }

  // ── Toast helper ──────────────────────────────────────────────────────────
  const showToast = (type, msg, url) => {
    clearTimeout(toastTimerRef.current)
    setToast({ type, msg, url })
    if (type !== 'loading') {
      toastTimerRef.current = setTimeout(() => setToast(null), 6000)
    }
  }

  // ── Export: HTML poster ───────────────────────────────────────────────────
  const exportPoster = () => {
    const byDay = fest.days.map((d, di) => ({
      d, slots: finalSchedule.filter(s => s.day === di).sort((a, b) => toMins(a.start) - toMins(b.start))
    })).filter(x => x.slots.length > 0)

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>My ${fest.name} Schedule</title>
<style>@media print{body{margin:0}}body{font-family:'Outfit','Syne',system-ui,sans-serif;max-width:600px;margin:0 auto;padding:32px;background:#06060a;color:#eae6d8}h1{font-size:26px;font-weight:800;text-transform:uppercase;letter-spacing:-1px;color:${fa};margin:0 0 4px}p.sub{color:#555;font-size:13px;margin:0 0 28px}h2{font-size:9px;font-weight:800;letter-spacing:4px;text-transform:uppercase;color:${fa};margin:22px 0 8px;border-bottom:1px solid #1e1e28;padding-bottom:6px}.slot{display:flex;margin:4px 0;border:1px solid ${fa}30;border-radius:8px;overflow:hidden;background:${fa}08}.time{background:${fa};color:#000;padding:8px 10px;min-width:72px;text-align:center;font-size:12px;font-weight:800;display:flex;flex-direction:column;align-items:center;justify-content:center}.to{font-size:7px;opacity:.6;text-transform:uppercase;letter-spacing:1px;margin:1px 0}.info{padding:8px 12px}.name{font-weight:800;font-size:14px}.stage{font-size:10px;color:#555;text-transform:uppercase;letter-spacing:1px;margin-top:2px}.footer{margin-top:28px;font-size:10px;color:#2a2a2a;letter-spacing:3px;text-transform:uppercase;text-align:center}</style>
</head><body>
<h1>${fest.emoji} ${fest.name}</h1><p class="sub">${fest.location} · MY PICKS</p>
${byDay.map(({ d, slots }) => `<h2>${d}</h2>${slots.map(s => `<div class="slot"><div class="time">${s.start}<div class="to">to</div>${s.end}</div><div class="info"><div class="name">${s.artist}</div><div class="stage">${s.stage}</div>${ratings[s.artist] ? `<div style="color:${fa};font-size:11px">${'★'.repeat(ratings[s.artist])}</div>` : ''}</div></div>`).join('')}`).join('')}
<div class="footer">FESTPLAN.APP</div></body></html>`

    const blob = new Blob([html], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `${fest.id}-schedule.html`; a.click()
    URL.revokeObjectURL(url)
  }

  // ── Export: iCal ─────────────────────────────────────────────────────────
  const exportCalendar = () => {
    const year = parseInt(fest.name.match(/\d{4}/)?.[0] ?? new Date().getFullYear(), 10)
    const MONTHS = { Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12 }
    const pad2 = n => String(n).padStart(2, '0')

    const parseSlotDate = (dayStr, timeStr) => {
      const parts = dayStr.split(' ')
      const month = MONTHS[parts[1]]
      const dayNum = parseInt(parts[2], 10)
      const [hStr, mStr] = timeStr.split(':')
      const hour = parseInt(hStr, 10)
      const min  = parseInt(mStr, 10)
      const calDay = hour < 6 ? dayNum + 1 : dayNum
      return new Date(year, month - 1, calDay, hour, min, 0)
    }

    const toIcal = d =>
      `${d.getFullYear()}${pad2(d.getMonth()+1)}${pad2(d.getDate())}` +
      `T${pad2(d.getHours())}${pad2(d.getMinutes())}00`

    const dtstamp = toIcal(new Date()).replace(/T\d{6}$/, 'T000000Z')

    const vevents = finalSchedule
      .sort((a, b) => a.day - b.day || toMins(a.start) - toMins(b.start))
      .map((s, i) => {
        const dayStr = fest.days[s.day]
        return [
          'BEGIN:VEVENT',
          `DTSTART:${toIcal(parseSlotDate(dayStr, s.start))}`,
          `DTEND:${toIcal(parseSlotDate(dayStr, s.end))}`,
          `SUMMARY:${s.artist} @ ${s.stage}`,
          `LOCATION:${fest.name}`,
          `UID:${fest.id}-${i}-${s.artist.replace(/\s+/g,'-').toLowerCase()}@festplan.app`,
          `DTSTAMP:${dtstamp}`,
          'END:VEVENT',
        ].join('\r\n')
      })

    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Festplan//Festival Planner//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      `X-WR-CALNAME:${fest.name} — My Schedule`,
      ...vevents,
      'END:VCALENDAR',
    ].join('\r\n')

    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `${fest.id}-schedule.ics`; a.click()
    URL.revokeObjectURL(url)
  }

  // ── Spotify playlist builder ───────────────────────────────────────────────
  const buildSpotifyPlaylist = async () => {
    let token
    try {
      token = await getValidSpotifyToken(userId)
    } catch (err) {
      console.error('[festplan] buildSpotifyPlaylist — token error:', err)
      showToast('error', err.message || 'Spotify session expired — please sign out and reconnect.')
      return
    }

    const sp = (path, opts = {}) =>
      fetch(`https://api.spotify.com/v1${path}`, {
        ...opts,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...(opts.headers || {}),
        },
      }).then(r => r.ok ? r.json() : Promise.reject(new Error(`Spotify ${r.status}: ${path}`)))

    showToast('loading', `Building your ${fest.name} playlist…`)

    try {
      const me = await sp('/me')
      const spotifyUserId = me.id

      const orderedArtists = finalSchedule
        .slice()
        .sort((a, b) => a.day - b.day || toMins(a.start) - toMins(b.start))
        .map(s => s.artist)

      const seen = new Set()
      const uniqueArtists = orderedArtists.filter(a => {
        if (seen.has(a)) return false
        seen.add(a); return true
      })

      const artistResults = await Promise.all(
        uniqueArtists.map(name =>
          sp(`/search?q=${encodeURIComponent(name)}&type=artist&limit=1`)
            .then(r => r.artists?.items?.[0] ?? null)
            .catch(() => null)
        )
      )

      const topTrackUris = await Promise.all(
        artistResults.map(artist =>
          artist
            ? sp(`/artists/${artist.id}/top-tracks?market=from_token`)
                .then(r => r.tracks?.[0]?.uri ?? null)
                .catch(() => null)
            : Promise.resolve(null)
        )
      )

      const uris = topTrackUris.filter(Boolean)
      if (!uris.length) {
        showToast('error', "Couldn't find any tracks — check your Spotify region settings.")
        return
      }

      const playlist = await sp(`/users/${spotifyUserId}/playlists`, {
        method: 'POST',
        body: JSON.stringify({
          name: `${fest.name} — My Picks`,
          public: false,
          description: `My festival schedule built with Festplan · ${new Date().toLocaleDateString()}`,
        }),
      })

      await sp(`/playlists/${playlist.id}/tracks`, {
        method: 'POST',
        body: JSON.stringify({ uris }),
      })

      showToast('success', `Playlist created — ${uris.length} tracks added!`, playlist.external_urls?.spotify)
    } catch (err) {
      console.error('[festplan] buildSpotifyPlaylist:', err)
      showToast('error', 'Something went wrong. Check the console for details.')
    }
  }

  // ── Derived data (all useMemo must precede any conditional return) ─────────

  const matchedSlots = useMemo(() => {
    if (!fest) return []
    return fest.lineup.filter(s => myArtists.some(a => norm(a) === norm(s.artist)))
  }, [fest, myArtists])

  const conflicts = useMemo(() => {
    if (isLineupOnly) return []
    const res = []
    for (let i = 0; i < matchedSlots.length; i++)
      for (let j = i + 1; j < matchedSlots.length; j++)
        if (overlaps(matchedSlots[i], matchedSlots[j])) {
          const key = [matchedSlots[i].artist, matchedSlots[j].artist].sort().join('|||')
          if (!res.find(c => c.key === key)) res.push({ key, a: matchedSlots[i], b: matchedSlots[j] })
        }
    return res
  }, [isLineupOnly, matchedSlots])

  const finalSchedule = useMemo(() =>
    matchedSlots.filter(slot => {
      for (const c of conflicts)
        if ((c.a.artist === slot.artist || c.b.artist === slot.artist) && resolved[c.key])
          return resolved[c.key] === slot.artist
      return true
    })
  , [matchedSlots, conflicts, resolved])

  const unresolvedConflicts = conflicts.filter(c => !resolved[c.key])

  const allParticipants = useMemo(() => [
    { name: 'Me', artists: myArtists, color: fa },
    ...friends.map((f, i) => ({ ...f, color: FRIEND_COLORS[i % FRIEND_COLORS.length] }))
  ], [myArtists, friends, fa])

  const dayLineup = useMemo(() => {
    if (!fest) return []
    return isLineupOnly ? fest.lineup : fest.lineup.filter(s => s.day === day)
  }, [fest, isLineupOnly, day])

  const dayMatched = useMemo(() =>
    isLineupOnly ? finalSchedule : finalSchedule.filter(s => s.day === day)
  , [isLineupOnly, finalSchedule, day])

  if (!fest) return null

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: 'var(--fp-bg)', color: 'var(--fp-text)' }}>

      <HeaderBar
        fa={fa}
        fest={fest}
        isLineupOnly={isLineupOnly}
        toast={toast}
        onBack={() => navigate('/setup')}
        onExportCalendar={exportCalendar}
        onExportPoster={exportPoster}
        onBuildPlaylist={buildSpotifyPlaylist}
        hasSpotifyToken={!!userId}
      />

      <div style={{ maxWidth: 940, margin: '0 auto', padding: '20px 16px' }}>

        <ConflictBanner
          conflicts={unresolvedConflicts}
          fest={fest}
          fa={fa}
          onResolve={handleResolve}
        />

        {/* ── Tab bar ──────────────────────────────────────────────────── */}
        <div className="fp-animate-in fp-stagger-1" style={{
          display: 'flex',
          borderBottom: '1px solid var(--fp-border)',
          marginBottom: 22,
        }}>
          {[
            ['mine',  isLineupOnly ? `My Picks (${finalSchedule.length})` : `My Schedule (${finalSchedule.length})`],
            ['group', `Group (${allParticipants.length})`],
          ].map(([t, l]) => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: '12px 16px',
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              fontFamily: T.body,
              fontWeight: 800,
              fontSize: 10,
              letterSpacing: 2,
              textTransform: 'uppercase',
              color: tab === t ? fa : 'var(--fp-text-dim)',
              borderBottom: `2px solid ${tab === t ? fa : 'transparent'}`,
              marginBottom: -1,
              whiteSpace: 'nowrap',
              transition: 'all 0.2s ease',
            }}>
              {t === 'group' && '◎ '}{l}
            </button>
          ))}
        </div>

        {/* ── Tab content ──────────────────────────────────────────────── */}
        {tab === 'mine' && (
          <MyScheduleTab
            isLineupOnly={isLineupOnly}
            fa={fa}
            fest={fest}
            day={day}
            setDay={setDay}
            viewMode={viewMode}
            setViewMode={setViewMode}
            dayMatched={dayMatched}
            dayLineup={dayLineup}
            myArtists={myArtists}
            ratings={ratings}
            onRate={handleRate}
            friends={friends}
            allParticipants={allParticipants}
            finalSchedule={finalSchedule}
          />
        )}

        {tab === 'group' && (
          <GroupTab
            fa={fa}
            fest={fest}
            isLineupOnly={isLineupOnly}
            friends={friends}
            myArtists={myArtists}
            day={day}
            setDay={setDay}
            allParticipants={allParticipants}
            addingFriend={addingFriend}
            setAddingFriend={setAddingFriend}
            newFName={newFName}
            setNewFName={setNewFName}
            newFArtists={newFArtists}
            setNewFArtists={setNewFArtists}
            onAddFriend={handleAddFriend}
            onRemoveFriend={handleRemoveFriend}
            onInvite={handleInvite}
            inviteStatus={inviteStatus}
          />
        )}
      </div>

      {/* ── Toast ────────────────────────────────────────────────────────── */}
      {toast && (
        <div style={{
          position: 'fixed',
          bottom: 24, right: 24,
          zIndex: 9999, maxWidth: 340,
          background: toast.type === 'error'   ? '#2a0a0a'
                     : toast.type === 'success' ? '#0a1f0a'
                     : 'var(--fp-s2)',
          border: `1px solid ${
            toast.type === 'error'   ? '#ff4444'
            : toast.type === 'success' ? '#1DB954'
            : 'var(--fp-border)'
          }`,
          borderRadius: 'var(--fp-radius-lg)',
          padding: '14px 18px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
          animation: 'fp-fadeIn 0.25s ease both',
          display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {toast.type === 'loading' && (
              <div style={{
                width: 14, height: 14, borderRadius: '50%',
                border: '2px solid var(--fp-border)',
                borderTopColor: fa,
                animation: 'fp-spin 0.7s linear infinite',
                flexShrink: 0,
              }} />
            )}
            {toast.type === 'success' && (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1DB954" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            )}
            {toast.type === 'error' && (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ff4444" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
              </svg>
            )}
            <span style={{
              fontFamily: T.body, fontSize: 12, fontWeight: 700,
              color: toast.type === 'error' ? '#ff6666' : 'var(--fp-text)',
              letterSpacing: 0.3,
            }}>{toast.msg}</span>
            {toast.type !== 'loading' && (
              <button onClick={() => setToast(null)} style={{
                marginLeft: 'auto', background: 'none', border: 'none',
                color: 'var(--fp-text-mute)', cursor: 'pointer', padding: 2, lineHeight: 1,
              }}>✕</button>
            )}
          </div>
          {toast.url && (
            <a href={toast.url} target="_blank" rel="noopener noreferrer" style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              fontFamily: T.body, fontSize: 11, fontWeight: 800,
              letterSpacing: 1.5, textTransform: 'uppercase',
              color: '#1DB954', textDecoration: 'none',
              border: '1px solid #1DB95440',
              borderRadius: 'var(--fp-radius-sm)',
              padding: '5px 10px',
              alignSelf: 'flex-start',
            }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.516 17.317a.75.75 0 01-1.032.25c-2.824-1.726-6.38-2.116-10.567-1.16a.75.75 0 01-.334-1.463c4.58-1.047 8.51-.597 11.683 1.34a.75.75 0 01.25 1.033zm1.472-3.276a.937.937 0 01-1.288.308c-3.23-1.986-8.153-2.562-11.977-1.402a.937.937 0 01-.545-1.791c4.363-1.325 9.786-.683 13.502 1.597a.937.937 0 01.308 1.288zm.126-3.41C15.37 8.39 9.278 8.19 5.748 9.27a1.125 1.125 0 01-.655-2.153c4.065-1.236 10.822-1 15.05 1.63a1.125 1.125 0 01-1.03 2.004z"/>
              </svg>
              Open in Spotify
            </a>
          )}
        </div>
      )}
    </div>
  )
}
