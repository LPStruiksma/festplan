import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { getAllUserArtists } from '../lib/spotify'
import { FEST_COLORS, norm } from '../lib/festivals'
import { discoverFestivals, mergeFestivals, fetchAllFestivals, artistCache, recommendFestivals, ensureFestivalIngested } from '../lib/api'
import { getValidSpotifyToken } from '../lib/spotify-auth'
import { supabase } from '../lib/supabase'
import { loadArtistsFromCache, loadArtists, saveArtistsRemote } from '../lib/profile'

/* ═══════════════════════════════════════════════════════════════════════════
   SETUP PAGE — Festival Noir
   Two-mode setup: Plan (pick a festival) or Find (discover your best match)
   ═══════════════════════════════════════════════════════════════════════════ */

const T = {
  display: "var(--fp-font-display)",
  body: "var(--fp-font-body)",
}

export default function SetupPage({ session }) {
  const navigate = useNavigate()

  // Seed from localStorage cache so the chip list paints instantly on return
  // visits, before any network response arrives.
  const [myArtists, setMyArtists] = useState(loadArtistsFromCache)
  const [fetching, setFetching] = useState(true)
  const [fetchError, setFetchError] = useState(null)
  const [festId, setFestId] = useState(null)
  const [artistInput, setArtistInput] = useState('')
  const [showHints, setShowHints] = useState(false)
  const [setupMode, setSetupMode] = useState('plan')
  const [discoveredFestivals, setDiscoveredFestivals] = useState([])
  const [discovering, setDiscovering] = useState(false)
  const [discoverySource, setDiscoverySource] = useState(null)
  // All festivals for the Plan mode picker — loaded from Supabase on mount
  const [planFestivals, setPlanFestivals] = useState([])

  // Festival comparison — up to 4 IDs selected in Find mode
  const [compareIds, setCompareIds] = useState(new Set())

  // Related-artist recommendations — "You might also like"
  const [recommendations, setRecommendations]   = useState([])
  const [recommending,    setRecommending]       = useState(false)

  // ID of the festival currently being ingested into Supabase, or null.
  const [ingestingId, setIngestingId] = useState(null)

  const toggleCompare = (id) => {
    setCompareIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) { next.delete(id); return next }
      if (next.size >= 4) return prev   // max 4
      next.add(id)
      return next
    })
  }

  // 'idle' | 'writing' | 'synced'
  const [syncStatus, setSyncStatus] = useState('idle')
  // True once the initial load (Spotify + Supabase) has resolved.
  // Used to prevent the auto-save effect from firing during first paint.
  const [artistsLoaded, setArtistsLoaded] = useState(false)

  useEffect(() => {
    async function load() {
      const userId = session?.user?.id

      // Run Spotify fetch and Supabase load concurrently.
      // getAllUserArtists resolves a valid token from the database automatically —
      // no need to pass session.provider_token (which is gone after a refresh).
      const [spotifyResult, supabaseResult] = await Promise.allSettled([
        userId
          ? getAllUserArtists(userId)
          : Promise.reject(new Error('Please sign in to load your Spotify artists.')),
        loadArtists(userId),
      ])

      const spotifyArtists = spotifyResult.status === 'fulfilled' ? spotifyResult.value : []
      // null = fetch failed; [] = fetch succeeded but no saved list yet
      const saved = supabaseResult.status === 'fulfilled' ? supabaseResult.value : null

      if (saved && saved.length > 0) {
        // Returning user — restore their curated Supabase list.
        setMyArtists(saved)
        setSyncStatus('synced')
      } else {
        // First visit or Supabase unreachable — seed from Spotify.
        setMyArtists(spotifyArtists)
      }

      if (spotifyResult.status === 'rejected') {
        setFetchError(spotifyResult.reason?.message || 'Spotify session expired. Please sign in again.')
      }

      setArtistsLoaded(true)
      setFetching(false)
    }
    load()
  }, [session])

  // Load all seeded festivals for the Plan mode picker on first mount
  useEffect(() => {
    fetchAllFestivals().then(setPlanFestivals)
  }, [])

  // Keep localStorage in sync immediately whenever myArtists changes (after
  // initial load). This ensures SchedulePage always sees the latest list on
  // navigation, even if the user clicks "Build My Schedule" before the
  // debounced Supabase write below has fired.
  useEffect(() => {
    if (!artistsLoaded) return
    localStorage.setItem('festplan_artists', JSON.stringify(myArtists))
  }, [myArtists, artistsLoaded])

  // Debounced Supabase write — coalesces rapid add/remove actions into a
  // single network request. Shows amber pill while pending, green on success.
  useEffect(() => {
    if (!artistsLoaded) return
    const userId = session?.user?.id
    if (!userId) return

    setSyncStatus('writing')
    const timer = setTimeout(async () => {
      await saveArtistsRemote(userId, myArtists)
      setSyncStatus('synced')
    }, 800)

    return () => clearTimeout(timer)
  }, [myArtists, artistsLoaded, session])

  const runDiscovery = useCallback(async (artists) => {
    if (!artists.length) return
    setDiscovering(true)
    try {
      const { source, festivals } = await discoverFestivals(artists)
      setDiscoverySource(source)
      setDiscoveredFestivals(source === 'live' ? await mergeFestivals(festivals, artists) : festivals)
    } catch (e) {
      console.error('Discovery failed:', e)
    } finally {
      setDiscovering(false)
    }
  }, [])

  // Fetch related-artist recommendations — only when the user has ≥5 artists.
  // We get their stored Spotify token first so the edge function can call the
  // Spotify related-artists API on the server without exposing the secret.
  const runRecommendations = useCallback(async (artists) => {
    if (artists.length < 5) return
    setRecommending(true)
    try {
      const token = await getValidSpotifyToken(session?.user?.id)
      const recs  = await recommendFestivals(artists, token)
      setRecommendations(recs.slice(0, 3))
    } catch (e) {
      // Silently degrade — recommendations are non-critical
      console.warn('Recommendations failed:', e)
      setRecommendations([])
    } finally {
      setRecommending(false)
    }
  }, [session])

  useEffect(() => {
    if (setupMode === 'find' && myArtists.length && !fetching) {
      runDiscovery(myArtists)
    }
    if (setupMode === 'find' && myArtists.length >= 5 && !fetching) {
      runRecommendations(myArtists)
    }
  }, [setupMode, myArtists, fetching, runDiscovery, runRecommendations])

  const hints = artistInput.length >= 2
    ? artistCache.filter(a =>
        norm(a).includes(norm(artistInput)) &&
        !myArtists.some(m => norm(m) === norm(a))
      ).slice(0, 5)
    : []

  const addArtist = (name) => {
    const t = name.trim()
    if (t && !myArtists.some(m => norm(m) === norm(t))) {
      setMyArtists(p => [...p, t])
    }
    setArtistInput('')
    setShowHints(false)
  }

  const goToSchedule = async (fid) => {
    const id = fid || festId
    if (!myArtists.length || !id || ingestingId) return
    // localStorage already kept current by the immediate effect above;
    // festival key persistence is handled in a separate migration.
    localStorage.setItem('festplan_festival', id)
    // Save festival metadata for any live-discovered festival so SchedulePage
    // can fall back to it (lineup-only shape) if Supabase is unreachable.
    const liveData = discoveredFestivals.find(f => f.id === id)
    if (liveData) {
      localStorage.setItem('festplan_festival_meta', JSON.stringify(liveData))
    }
    // For live-discovered festivals not already seeded in Supabase, trigger a
    // background ingest so SchedulePage gets a real lineup instead of
    // lineup-only mode.  If ingest fails (non-admin, network error, etc.) we
    // navigate anyway — lineup-only mode handles the degraded state gracefully.
    const isLiveOnly = liveData && !planFestivals.some(p => p.id === id)
    if (isLiveOnly && liveData.tmEventIds?.length) {
      setIngestingId(id)
      await ensureFestivalIngested(id, liveData.tmEventIds)
      setIngestingId(null)
    }
    navigate('/schedule')
  }

  const handleSignOut = async () => {
    await supabase.auth.signOut()
  }

  const getColor = (fid) => FEST_COLORS[fid] || discoveredFestivals.find(f => f.id === fid)?.accentColor || '#c8f400'

  /* ── Style helpers ────────────────────────────────────────────────────── */
  const pill = (active, color) => ({
    padding: '9px 20px',
    borderRadius: 6,
    border: 'none',
    cursor: 'pointer',
    fontFamily: T.body,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: 2,
    textTransform: 'uppercase',
    background: active ? (color || 'var(--fp-accent)') : 'transparent',
    color: active ? '#000' : 'var(--fp-text-dim)',
    transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
  })

  const sectionLabel = (color) => ({
    fontFamily: T.body,
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: 4,
    textTransform: 'uppercase',
    color: color || 'var(--fp-accent)',
    marginBottom: 16,
  })

  return (
    <div style={{ minHeight: '100vh', background: 'var(--fp-bg)', color: 'var(--fp-text)' }}>

      {/* ── HEADER ─────────────────────────────────────────────────────── */}
      <header style={{
        borderBottom: '1px solid var(--fp-border)',
        padding: '14px 24px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        animation: 'fp-slideDown 0.5s cubic-bezier(0.16, 1, 0.3, 1) both',
        background: 'var(--fp-s1)',
      }}>
        <span style={{
          fontFamily: T.display,
          fontSize: 14,
          fontWeight: 800,
          letterSpacing: 4,
          textTransform: 'uppercase',
          color: 'var(--fp-text)',
        }}>FestPlan</span>
        <span style={{
          width: 5, height: 5, borderRadius: '50%',
          background: 'var(--fp-accent)',
          display: 'inline-block',
          boxShadow: '0 0 8px var(--fp-accent-dim)',
        }} />
        <button onClick={handleSignOut} style={{
          marginLeft: 'auto',
          background: 'transparent',
          color: 'var(--fp-text-mute)',
          border: '1px solid var(--fp-border)',
          borderRadius: 'var(--fp-radius-sm)',
          padding: '6px 14px',
          fontSize: 10,
          fontWeight: 700,
          cursor: 'pointer',
          letterSpacing: 2,
          textTransform: 'uppercase',
          transition: 'all 0.2s ease',
        }}>
          Sign Out
        </button>
      </header>

      <div style={{ maxWidth: 720, margin: '0 auto', padding: '36px 20px 64px' }}>

        {/* ── MODE TOGGLE ──────────────────────────────────────────────── */}
        <div className="fp-animate-in fp-stagger-1" style={{
          display: 'flex',
          background: 'var(--fp-s2)',
          borderRadius: 8,
          padding: 3,
          border: '1px solid var(--fp-border)',
          width: 'fit-content',
          marginBottom: 40,
        }}>
          {[['plan', 'Plan a Festival'], ['find', 'Find My Festival']].map(([m, l]) => (
            <button key={m} onClick={() => setSetupMode(m)} style={pill(setupMode === m)}>
              {m === 'plan' ? '⊕ ' : '◎ '}{l}
            </button>
          ))}
        </div>

        {/* ── HERO HEADING ─────────────────────────────────────────────── */}
        {setupMode === 'plan' ? (
          <h1 className="fp-animate-in fp-stagger-2" style={{
            fontFamily: T.display,
            margin: '0 0 40px',
            fontWeight: 800,
            fontSize: 'clamp(30px, 5.5vw, 52px)',
            lineHeight: 0.95,
            letterSpacing: '-1.5px',
            textTransform: 'uppercase',
          }}>
            Know Your<br />Festival<br />
            <span style={{ color: 'var(--fp-accent)' }}>Inside Out.</span>
          </h1>
        ) : (
          <div className="fp-animate-in fp-stagger-2" style={{ marginBottom: 36 }}>
            <h1 style={{
              fontFamily: T.display,
              margin: '0 0 10px',
              fontWeight: 800,
              fontSize: 'clamp(26px, 5vw, 46px)',
              lineHeight: 0.95,
              letterSpacing: '-1.5px',
              textTransform: 'uppercase',
            }}>
              Which Festival<br />
              <span style={{ color: 'var(--fp-accent)' }}>Is Yours?</span>
            </h1>
            <p style={{ fontSize: 14, color: 'var(--fp-text-dim)', margin: 0, fontWeight: 400 }}>
              We search upcoming festivals to find your artist matches.
            </p>
          </div>
        )}

        {/* ── ARTISTS PANEL ────────────────────────────────────────────── */}
        <div className="fp-animate-in fp-stagger-3" style={{
          background: 'var(--fp-card)',
          border: '1px solid var(--fp-border)',
          borderRadius: 'var(--fp-radius-lg)',
          padding: 24,
          marginBottom: 20,
          position: 'relative',
          overflow: 'hidden',
        }}>
          {/* Accent top edge */}
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, height: 2,
            background: 'var(--fp-accent)',
            opacity: 0.8,
          }} />

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div style={sectionLabel()}>
              {setupMode === 'plan' ? '① ' : ''}Your Spotify Artists
            </div>

            {/* Status indicators — only one shows at a time */}
            {fetching ? (
              <span style={{
                fontSize: 11, color: 'var(--fp-text-dim)', letterSpacing: 1,
                animation: 'fp-pulse 1.5s ease infinite',
              }}>
                Syncing from Spotify...
              </span>
            ) : syncStatus === 'writing' ? (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                fontSize: 9, fontWeight: 700, letterSpacing: 1.5,
                textTransform: 'uppercase',
                padding: '3px 9px', borderRadius: 20,
                background: '#f59e0b18', color: '#f59e0b',
                border: '1px solid #f59e0b40',
                animation: 'fp-pulse 1.2s ease infinite',
              }}>
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#f59e0b', flexShrink: 0 }} />
                Saving
              </span>
            ) : syncStatus === 'synced' ? (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                fontSize: 9, fontWeight: 700, letterSpacing: 1.5,
                textTransform: 'uppercase',
                padding: '3px 9px', borderRadius: 20,
                background: '#4ade8018', color: '#4ade80',
                border: '1px solid #4ade8040',
                animation: 'fp-fadeIn 0.3s ease both',
              }}>
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#4ade80', flexShrink: 0 }} />
                Synced
              </span>
            ) : null}
          </div>

          {fetchError ? (
            <div style={{ color: 'var(--fp-warn)', fontSize: 13, lineHeight: 1.6 }}>
              {fetchError}
              <br />
              <button onClick={handleSignOut} style={{
                marginTop: 12,
                background: 'transparent',
                color: 'var(--fp-warn)',
                border: '1px solid var(--fp-warn)',
                borderRadius: 'var(--fp-radius-sm)',
                padding: '7px 14px',
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
              }}>
                Sign in again
              </button>
            </div>
          ) : (
            <>
              <div style={{ position: 'relative' }}>
                <input
                  value={artistInput}
                  onChange={e => { setArtistInput(e.target.value); setShowHints(true) }}
                  onKeyDown={e => e.key === 'Enter' && artistInput.trim() && addArtist(artistInput)}
                  onFocus={() => setShowHints(true)}
                  onBlur={() => setTimeout(() => setShowHints(false), 150)}
                  placeholder={fetching ? 'Loading your Spotify artists...' : 'Add an artist manually...'}
                  disabled={fetching}
                  style={{
                    width: '100%',
                    padding: '12px 16px',
                    borderRadius: 'var(--fp-radius-md)',
                    border: '1px solid var(--fp-border2)',
                    fontSize: 14,
                    fontWeight: 400,
                    outline: 'none',
                    boxSizing: 'border-box',
                    fontFamily: T.body,
                    background: 'var(--fp-s2)',
                    color: 'var(--fp-text)',
                    caretColor: 'var(--fp-accent)',
                    opacity: fetching ? 0.4 : 1,
                    transition: 'border-color 0.2s ease',
                  }}
                  onFocusCapture={e => e.target.style.borderColor = 'var(--fp-accent)'}
                  onBlurCapture={e => e.target.style.borderColor = 'var(--fp-border2)'}
                />
                {showHints && hints.length > 0 && (
                  <div style={{
                    position: 'absolute', top: '100%', left: 0, right: 0,
                    background: 'var(--fp-s2)',
                    border: '1px solid var(--fp-border2)',
                    borderRadius: 'var(--fp-radius-md)',
                    zIndex: 20,
                    marginTop: 6,
                    overflow: 'hidden',
                    boxShadow: 'var(--fp-shadow-lift)',
                    animation: 'fp-scaleIn 0.15s ease both',
                  }}>
                    {hints.map(h => (
                      <div key={h} onMouseDown={() => addArtist(h)}
                        style={{
                          padding: '11px 16px',
                          cursor: 'pointer',
                          fontSize: 14,
                          color: 'var(--fp-text)',
                          borderBottom: '1px solid var(--fp-border)',
                          transition: 'background 0.1s ease',
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = 'var(--fp-s3)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                        {h}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {myArtists.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 16 }}>
                  {myArtists.map((a, i) => (
                    <div key={a} style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '5px 11px',
                      borderRadius: 'var(--fp-radius-sm)',
                      border: '1px solid var(--fp-accent-dim)',
                      color: 'var(--fp-accent)',
                      fontSize: 12,
                      fontWeight: 600,
                      background: 'var(--fp-accent-bg)',
                      animation: `fp-scaleIn 0.2s ease ${Math.min(i * 0.02, 0.5)}s both`,
                    }}>
                      {a}
                      <span
                        onClick={() => setMyArtists(p => p.filter(x => x !== a))}
                        style={{ cursor: 'pointer', opacity: 0.4, fontSize: 16, lineHeight: 1, transition: 'opacity 0.15s' }}
                        onMouseEnter={e => e.currentTarget.style.opacity = 1}
                        onMouseLeave={e => e.currentTarget.style.opacity = 0.4}
                      >×</span>
                    </div>
                  ))}
                </div>
              )}

              {!fetching && myArtists.length === 0 && (
                <p style={{ fontSize: 12, color: 'var(--fp-text-mute)', marginTop: 14, marginBottom: 0 }}>
                  No artists found. Try adding some manually above.
                </p>
              )}
            </>
          )}
        </div>

        {/* ═══ PLAN MODE ═══════════════════════════════════════════════════ */}
        {setupMode === 'plan' && (
          <>
            <div className="fp-animate-in fp-stagger-4" style={{
              background: 'var(--fp-card)',
              border: '1px solid var(--fp-border)',
              borderRadius: 'var(--fp-radius-lg)',
              padding: 24,
              marginBottom: 28,
              position: 'relative',
              overflow: 'hidden',
            }}>
              <div style={{
                position: 'absolute', top: 0, left: 0, right: 0, height: 2,
                background: 'var(--fp-border2)',
              }} />

              <div style={sectionLabel()}>② Choose Your Festival</div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
                {planFestivals.map(f => {
                  const fac = f.accentColor || FEST_COLORS[f.id]
                  const sel = festId === f.id
                  return (
                    <div key={f.id}
                      onClick={() => setFestId(f.id === festId ? null : f.id)}
                      style={{
                        padding: 16,
                        borderRadius: 'var(--fp-radius-md)',
                        cursor: 'pointer',
                        border: `1px solid ${sel ? fac : 'var(--fp-border)'}`,
                        background: sel ? `${fac}12` : 'var(--fp-s2)',
                        transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
                        position: 'relative',
                        overflow: 'hidden',
                      }}
                      onMouseEnter={e => {
                        if (!sel) e.currentTarget.style.borderColor = 'var(--fp-border2)'
                        e.currentTarget.style.transform = 'translateY(-2px)'
                      }}
                      onMouseLeave={e => {
                        if (!sel) e.currentTarget.style.borderColor = 'var(--fp-border)'
                        e.currentTarget.style.transform = 'translateY(0)'
                      }}
                    >
                      {sel && <div style={{
                        position: 'absolute', top: 0, left: 0, right: 0, height: 2,
                        background: fac,
                      }} />}
                      <div style={{ fontSize: 28, marginBottom: 8 }}>{f.emoji}</div>
                      <div style={{
                        fontFamily: T.display,
                        fontSize: 12,
                        fontWeight: 700,
                        color: sel ? fac : 'var(--fp-text)',
                        textTransform: 'uppercase',
                        lineHeight: 1.2,
                        marginBottom: 4,
                      }}>{f.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--fp-text-dim)', marginBottom: 3 }}>{f.location}</div>
                      <div style={{ fontSize: 10, color: sel ? fac : 'var(--fp-text-mute)', fontWeight: 500 }}>
                        {f.days[0].split(' ')[1]} – {f.days[f.days.length - 1]}
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Live-discovered festivals not already in the plan grid (plan mode) */}
              {discoveredFestivals.filter(f => !planFestivals.some(p => p.id === f.id) && f.matchCount > 0).length > 0 && (
                <>
                  <div style={{
                    ...sectionLabel('var(--fp-text-dim)'),
                    marginTop: 24, marginBottom: 14,
                    display: 'flex', alignItems: 'center', gap: 10,
                  }}>
                    <span>More from your artists</span>
                    <span style={{
                      fontSize: 8, padding: '3px 7px', borderRadius: 3,
                      background: '#22d3ee18', color: '#22d3ee',
                      fontWeight: 700, letterSpacing: 1,
                    }}>LIVE</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
                    {discoveredFestivals
                      .filter(f => !planFestivals.some(p => p.id === f.id) && f.matchCount > 0)
                      .slice(0, 8)
                      .map(f => {
                        const fac = f.accentColor || '#22d3ee'
                        const sel = festId === f.id
                        return (
                          <div key={f.id}
                            onClick={() => setFestId(f.id === festId ? null : f.id)}
                            style={{
                              padding: 16,
                              borderRadius: 'var(--fp-radius-md)',
                              cursor: 'pointer',
                              border: `1px solid ${sel ? fac : 'var(--fp-border)'}`,
                              background: sel ? `${fac}12` : 'var(--fp-s2)',
                              transition: 'all 0.2s ease',
                              position: 'relative',
                              overflow: 'hidden',
                            }}
                            onMouseEnter={e => {
                              if (!sel) e.currentTarget.style.borderColor = 'var(--fp-border2)'
                              e.currentTarget.style.transform = 'translateY(-2px)'
                            }}
                            onMouseLeave={e => {
                              if (!sel) e.currentTarget.style.borderColor = 'var(--fp-border)'
                              e.currentTarget.style.transform = 'translateY(0)'
                            }}
                          >
                            {sel && <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: fac }} />}
                            <div style={{ fontSize: 28, marginBottom: 8 }}>{f.emoji || '🎵'}</div>
                            <div style={{
                              fontFamily: T.display, fontSize: 12, fontWeight: 700,
                              color: sel ? fac : 'var(--fp-text)',
                              textTransform: 'uppercase', lineHeight: 1.2, marginBottom: 4,
                            }}>{f.name}</div>
                            <div style={{ fontSize: 11, color: 'var(--fp-text-dim)', marginBottom: 3 }}>{f.location}</div>
                            <div style={{ fontSize: 10, color: fac, fontWeight: 600 }}>
                              {f.matchCount} match{f.matchCount !== 1 ? 'es' : ''}
                            </div>
                            {!f.hasTimetable && (
                              <div style={{ fontSize: 8, color: 'var(--fp-text-mute)', marginTop: 6, letterSpacing: 1, textTransform: 'uppercase' }}>
                                Timetable coming soon
                              </div>
                            )}
                          </div>
                        )
                      })}
                  </div>
                </>
              )}
            </div>

            {/* CTA button */}
            <div className="fp-animate-in fp-stagger-5" style={{ textAlign: 'center' }}>
              {ingestingId ? (
                <div style={{
                  display: 'inline-flex', alignItems: 'center', gap: 10,
                  background: 'var(--fp-s3)',
                  borderRadius: 'var(--fp-radius-md)',
                  padding: '15px 44px',
                  fontSize: 13, fontWeight: 800, letterSpacing: 3,
                  textTransform: 'uppercase',
                  color: 'var(--fp-text-dim)',
                }}>
                  <div style={{
                    width: 14, height: 14, flexShrink: 0,
                    border: '2px solid var(--fp-text-dim)', borderTopColor: 'transparent',
                    borderRadius: '50%', animation: 'fp-spin 0.8s linear infinite',
                  }} />
                  Importing schedule...
                </div>
              ) : (
                <button
                  onClick={() => goToSchedule()}
                  disabled={!myArtists.length || !festId}
                  style={{
                    background: myArtists.length && festId ? 'var(--fp-accent)' : 'var(--fp-s3)',
                    color: myArtists.length && festId ? '#000' : 'var(--fp-text-mute)',
                    border: 'none',
                    borderRadius: 'var(--fp-radius-md)',
                    padding: '15px 44px',
                    fontFamily: T.body,
                    fontSize: 13,
                    fontWeight: 800,
                    cursor: myArtists.length && festId ? 'pointer' : 'not-allowed',
                    letterSpacing: 3,
                    textTransform: 'uppercase',
                    transition: 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
                    boxShadow: myArtists.length && festId ? '0 0 30px -8px var(--fp-accent-dim)' : 'none',
                  }}
                >
                  {discoveredFestivals.find(f => f.id === festId)?.hasTimetable === false
                    ? 'Browse Lineup →'
                    : 'Build My Schedule →'}
                </button>
              )}
              {(!festId || !myArtists.length) && (
                <p style={{ fontSize: 11, color: 'var(--fp-text-mute)', marginTop: 12 }}>
                  {!myArtists.length ? '↑ Add at least one artist' : '↑ Select a festival'} to continue
                </p>
              )}
            </div>
          </>
        )}

        {/* ═══ FIND MODE ═══════════════════════════════════════════════════ */}
        {setupMode === 'find' && myArtists.length > 0 && (
          <div className="fp-animate-in fp-stagger-4" style={{ marginTop: 4 }}>
            <div style={{
              ...sectionLabel(),
              display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18,
            }}>
              <span>Ranked for You — {myArtists.length} artists</span>
              {discovering && (
                <span style={{
                  fontSize: 10, color: 'var(--fp-text-dim)', fontWeight: 400, letterSpacing: 1,
                  animation: 'fp-pulse 1.5s ease infinite',
                }}>Searching...</span>
              )}
              {discoverySource === 'live' && !discovering && (
                <span style={{
                  fontSize: 8, padding: '3px 7px', borderRadius: 3,
                  background: '#22d3ee18', color: '#22d3ee',
                  fontWeight: 700, letterSpacing: 1,
                }}>LIVE</span>
              )}
            </div>

            {discoveredFestivals.map((f, idx) => {
              const fac = getColor(f.id) || f.accentColor || 'var(--fp-accent)'
              const count = f.matchCount
              const matches = f.matchedArtists || []
              const pct = myArtists.length ? Math.round(count / myArtists.length * 100) : 0

              const isCompared    = compareIds.has(f.id)
              const compareMaxed  = compareIds.size >= 4 && !isCompared

              return (
                <div key={f.id} style={{
                  background: 'var(--fp-card)',
                  border: `1px solid ${count > 0 ? fac + '40' : 'var(--fp-border)'}`,
                  borderRadius: 'var(--fp-radius-lg)',
                  padding: '18px 20px',
                  marginBottom: 12,
                  position: 'relative',
                  overflow: 'hidden',
                  animation: `fp-slideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1) ${idx * 0.06}s both`,
                }}>

                  {/* Compare checkbox — top-right */}
                  <button
                    onClick={e => { e.stopPropagation(); toggleCompare(f.id) }}
                    disabled={compareMaxed}
                    title={isCompared ? 'Remove from comparison' : compareMaxed ? 'Max 4 festivals' : 'Add to comparison'}
                    style={{
                      position:       'absolute',
                      top:            11,
                      right:          12,
                      width:          20,
                      height:         20,
                      borderRadius:   4,
                      border:         `1.5px solid ${isCompared ? fac : 'var(--fp-border2)'}`,
                      background:     isCompared ? fac : 'transparent',
                      cursor:         compareMaxed ? 'not-allowed' : 'pointer',
                      display:        'flex',
                      alignItems:     'center',
                      justifyContent: 'center',
                      fontSize:       11,
                      fontWeight:     900,
                      color:          isCompared ? '#000' : 'transparent',
                      opacity:        compareMaxed ? 0.25 : 1,
                      transition:     'all 0.15s',
                      zIndex:         2,
                      padding:        0,
                      lineHeight:     1,
                    }}
                    aria-pressed={isCompared}
                  >
                    ✓
                  </button>

                  {/* Left accent bar */}
                  <div style={{
                    position: 'absolute', top: 0, left: 0, bottom: 0, width: 3,
                    background: count > 0 ? fac : 'var(--fp-border)',
                    borderRadius: '3px 0 0 3px',
                  }} />

                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, paddingLeft: 6 }}>
                    <div style={{ fontSize: 32, flexShrink: 0, lineHeight: 1 }}>{f.emoji || '🎵'}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div style={{
                            fontFamily: T.display,
                            fontSize: 14,
                            fontWeight: 700,
                            color: count > 0 ? fac : 'var(--fp-text-dim)',
                            textTransform: 'uppercase',
                          }}>{f.name}</div>
                          {!f.hasTimetable && count > 0 && (
                            <span style={{
                              fontSize: 8, padding: '2px 6px', borderRadius: 3,
                              border: '1px solid var(--fp-border2)',
                              color: 'var(--fp-text-mute)', fontWeight: 600,
                            }}>LINEUP ONLY</span>
                          )}
                        </div>
                        <div style={{ flexShrink: 0, textAlign: 'right' }}>
                          <span style={{
                            fontFamily: T.display,
                            fontSize: 22,
                            fontWeight: 800,
                            color: count > 0 ? fac : 'var(--fp-text-mute)',
                          }}>{count}</span>
                          <span style={{ fontSize: 11, color: 'var(--fp-text-dim)', fontWeight: 400, marginLeft: 4 }}>
                            match{count !== 1 ? 'es' : ''}
                          </span>
                        </div>
                      </div>

                      {/* Progress bar */}
                      <div style={{
                        height: 3,
                        background: 'var(--fp-s3)',
                        borderRadius: 2,
                        marginBottom: 10,
                        overflow: 'hidden',
                      }}>
                        <div style={{
                          height: '100%',
                          width: `${pct}%`,
                          background: fac,
                          borderRadius: 2,
                          transition: 'width 0.6s cubic-bezier(0.16, 1, 0.3, 1)',
                        }} />
                      </div>

                      <div style={{ fontSize: 11, color: 'var(--fp-text-mute)', marginBottom: 10 }}>
                        {f.location}
                        {f.days?.length ? ` · ${f.days[0]} – ${f.days[f.days.length - 1]}` : ''}
                        {f.totalKnownArtists ? ` · ${f.totalKnownArtists} artists announced` : ''}
                      </div>

                      {matches.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                          {matches.slice(0, 6).map(a => (
                            <span key={a} style={{
                              fontSize: 10, padding: '3px 8px', borderRadius: 3,
                              border: `1px solid ${fac}40`, color: fac, fontWeight: 600,
                              background: `${fac}08`,
                            }}>{a}</span>
                          ))}
                          {matches.length > 6 && (
                            <span style={{ fontSize: 10, color: 'var(--fp-text-dim)', alignSelf: 'center' }}>
                              +{matches.length - 6} more
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {count > 0 && (
                    ingestingId === f.id ? (
                      <div style={{
                        display: 'inline-flex', alignItems: 'center', gap: 8,
                        padding: '9px 18px',
                        fontSize: 10, fontWeight: 700, letterSpacing: 2.5,
                        textTransform: 'uppercase',
                        color: fac, marginTop: 2, marginLeft: 52,
                      }}>
                        <div style={{
                          width: 10, height: 10, flexShrink: 0,
                          border: `1.5px solid ${fac}`, borderTopColor: 'transparent',
                          borderRadius: '50%', animation: 'fp-spin 0.8s linear infinite',
                        }} />
                        Importing schedule...
                      </div>
                    ) : (
                      <button onClick={() => goToSchedule(f.id)} style={{
                        background: f.hasTimetable ? fac : 'transparent',
                        color: f.hasTimetable ? '#000' : fac,
                        border: f.hasTimetable ? 'none' : `1px solid ${fac}60`,
                        borderRadius: 'var(--fp-radius-sm)',
                        padding: '9px 18px',
                        fontFamily: T.body,
                        fontSize: 10,
                        fontWeight: 800,
                        cursor: 'pointer',
                        letterSpacing: 2.5,
                        textTransform: 'uppercase',
                        marginTop: 2,
                        marginLeft: 52,
                        transition: 'all 0.2s ease',
                      }}>
                        {f.hasTimetable ? 'Plan This Festival →' : 'Browse Lineup →'}
                      </button>
                    )
                  )}
                </div>
              )
            })}

            {/* ── "You might also like" — related-artist recommendations ─── */}
            {myArtists.length >= 5 && (recommendations.length > 0 || recommending) && (
              <div style={{ marginTop: 32 }}>
                <div style={{
                  ...sectionLabel('#22d3ee'),
                  display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16,
                }}>
                  <span>You might also like</span>
                  <span style={{
                    fontSize: 8, padding: '3px 7px', borderRadius: 3,
                    background: '#22d3ee18', color: '#22d3ee',
                    fontWeight: 700, letterSpacing: 1,
                  }}>RELATED ARTISTS</span>
                  {recommending && (
                    <span style={{
                      fontSize: 10, color: 'var(--fp-text-dim)', fontWeight: 400,
                      letterSpacing: 1, animation: 'fp-pulse 1.5s ease infinite',
                    }}>Finding...</span>
                  )}
                </div>

                {recommending && recommendations.length === 0 ? (
                  // Skeleton placeholder while loading
                  [0, 1, 2].map(i => (
                    <div key={i} style={{
                      height: 88,
                      background: 'var(--fp-s2)',
                      borderRadius: 'var(--fp-radius-lg)',
                      marginBottom: 12,
                      opacity: 0.4,
                      animation: 'fp-pulse 1.5s ease infinite',
                    }} />
                  ))
                ) : recommendations.map((f, idx) => {
                  const fac = '#22d3ee'
                  return (
                    <div key={f.id} style={{
                      background:    'var(--fp-card)',
                      border:        `1px solid ${fac}35`,
                      borderRadius:  'var(--fp-radius-lg)',
                      padding:       '16px 20px',
                      marginBottom:  12,
                      position:      'relative',
                      overflow:      'hidden',
                      animation:     `fp-slideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1) ${idx * 0.08}s both`,
                    }}>
                      {/* Left accent bar */}
                      <div style={{
                        position: 'absolute', top: 0, left: 0, bottom: 0, width: 3,
                        background: fac, borderRadius: '3px 0 0 3px', opacity: 0.7,
                      }} />

                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, paddingLeft: 6 }}>
                        <div style={{ fontSize: 28, flexShrink: 0, lineHeight: 1 }}>{f.emoji}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                            <div style={{
                              fontFamily: T.display, fontSize: 13, fontWeight: 700,
                              color: fac, textTransform: 'uppercase',
                            }}>{f.name}</div>
                            {/* Match counts */}
                            <div style={{ flexShrink: 0, textAlign: 'right', fontSize: 10, color: 'var(--fp-text-dim)', lineHeight: 1.4 }}>
                              <span style={{ color: fac, fontWeight: 700 }}>{f.originalMatchCount}</span> direct
                              <span style={{ margin: '0 4px', opacity: 0.4 }}>·</span>
                              <span style={{ color: fac, fontWeight: 700 }}>{f.matchDifference}</span> via related
                            </div>
                          </div>

                          <div style={{ fontSize: 11, color: 'var(--fp-text-mute)', marginBottom: 8 }}>
                            {f.location}
                            {f.days?.length ? ` · ${f.days[0]} – ${f.days[f.days.length - 1]}` : ''}
                          </div>

                          {/* Related artist chips */}
                          {f.relatedMatchedArtists?.length > 0 && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 10 }}>
                              {f.relatedMatchedArtists.slice(0, 5).map(a => (
                                <span key={a} style={{
                                  fontSize: 10, padding: '3px 8px', borderRadius: 3,
                                  border: `1px solid ${fac}40`, color: fac,
                                  fontWeight: 600, background: `${fac}08`,
                                }}>{a}</span>
                              ))}
                              {f.relatedMatchedArtists.length > 5 && (
                                <span style={{ fontSize: 10, color: 'var(--fp-text-dim)', alignSelf: 'center' }}>
                                  +{f.relatedMatchedArtists.length - 5} more
                                </span>
                              )}
                            </div>
                          )}

                          <button onClick={() => goToSchedule(f.id)} style={{
                            background:    'transparent',
                            color:         fac,
                            border:        `1px solid ${fac}50`,
                            borderRadius:  'var(--fp-radius-sm)',
                            padding:       '7px 16px',
                            fontFamily:    T.body,
                            fontSize:      10,
                            fontWeight:    800,
                            cursor:        'pointer',
                            letterSpacing: 2,
                            textTransform: 'uppercase',
                            transition:    'all 0.2s ease',
                          }}>
                            Explore Festival →
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {discovering && discoveredFestivals.length === 0 && (
              <div style={{
                textAlign: 'center', padding: '48px 20px', color: 'var(--fp-text-dim)',
              }}>
                <div style={{
                  width: 24, height: 24, border: '2px solid var(--fp-accent)',
                  borderTopColor: 'transparent', borderRadius: '50%',
                  animation: 'fp-spin 0.8s linear infinite',
                  margin: '0 auto 16px',
                }} />
                <div style={{ fontSize: 12, letterSpacing: 2, textTransform: 'uppercase', marginBottom: 6 }}>
                  Searching festivals worldwide
                </div>
                <div style={{ fontSize: 11, color: 'var(--fp-text-mute)' }}>
                  Checking {myArtists.length} artists against upcoming lineups
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Sticky Compare button (appears when ≥2 checked) ──────────────── */}
        {setupMode === 'find' && compareIds.size >= 2 && (
          <div style={{
            position:  'fixed',
            bottom:    28,
            left:      '50%',
            transform: 'translateX(-50%)',
            zIndex:    9998,
            animation: 'fp-slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1) both',
            pointerEvents: 'none',
          }}>
            <button
              onClick={() => navigate(`/compare?ids=${[...compareIds].join(',')}`)}
              style={{
                background:    '#c8f400',
                color:         '#000',
                border:        'none',
                borderRadius:  999,
                padding:       '12px 26px',
                fontFamily:    T.body,
                fontSize:      12,
                fontWeight:    800,
                letterSpacing: 2,
                textTransform: 'uppercase',
                cursor:        'pointer',
                display:       'flex',
                alignItems:    'center',
                gap:           10,
                boxShadow:     '0 6px 36px rgba(200,244,0,0.28), 0 2px 8px rgba(0,0,0,0.4)',
                whiteSpace:    'nowrap',
                pointerEvents: 'all',
              }}
            >
              Compare ({compareIds.size})
              <span style={{ opacity: 0.55, fontSize: 15, letterSpacing: 0 }}>
                {[...compareIds]
                  .map(id => discoveredFestivals.find(f => f.id === id)?.emoji || '🎵')
                  .join('')}
              </span>
            </button>
          </div>
        )}

        {setupMode === 'find' && !myArtists.length && !fetching && (
          <div className="fp-animate-in" style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--fp-text-mute)' }}>
            <div style={{ fontSize: 36, marginBottom: 12, opacity: 0.5 }}>↑</div>
            <div style={{ fontSize: 12, letterSpacing: 2, textTransform: 'uppercase' }}>
              Add your artists above to see rankings
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
