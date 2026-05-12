import { T, pillBtn } from '../../lib/ui'
import { FRIEND_COLORS, norm, toMins } from '../../lib/festivals'

/**
 * "Group" tab — participants panel + per-day group slot list.
 *
 * Props:
 *   fa              — festival accent colour
 *   fest            — festival object
 *   isLineupOnly    — boolean
 *   friends         — [{ name, artists, source_user_id }]
 *   myArtists       — user's artist list
 *   day             — selected day index
 *   setDay          — (index) => void
 *   allParticipants — [{ name, artists, color }] incl. "Me"
 *   addingFriend    — boolean — whether the add-friend form is open
 *   setAddingFriend — (bool) => void
 *   newFName        — string
 *   setNewFName     — (s) => void
 *   newFArtists     — string (comma-separated)
 *   setNewFArtists  — (s) => void
 *   onAddFriend     — (name, artists[]) => void
 *   onRemoveFriend  — (index) => void
 *   onInvite        — () => void (async)
 *   inviteStatus    — 'idle'|'loading'|'copied'|'error'
 */
export default function GroupTab({
  fa, fest, isLineupOnly,
  friends, myArtists,
  day, setDay, allParticipants,
  addingFriend, setAddingFriend,
  newFName, setNewFName,
  newFArtists, setNewFArtists,
  onAddFriend, onRemoveFriend,
  onInvite, inviteStatus,
}) {
  return (
    <div className="fp-animate-in fp-stagger-2">

      {/* ── Participants card ─────────────────────────────────────────── */}
      <div style={{
        background: 'var(--fp-card)',
        border: '1px solid var(--fp-border)',
        borderRadius: 'var(--fp-radius-lg)',
        padding: 20,
        marginBottom: 20,
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* Accent top line */}
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 2,
          background: fa, opacity: 0.5,
        }} />

        {/* Card header */}
        <div style={{
          fontFamily: T.body,
          fontSize: 9, fontWeight: 800, letterSpacing: 4,
          color: fa, textTransform: 'uppercase',
          marginBottom: 16,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          flexWrap: 'wrap', gap: 8,
        }}>
          <span>Participants</span>
          <div style={{ display: 'flex', gap: 6 }}>
            {friends.length < 3 && !addingFriend && (
              <button onClick={() => setAddingFriend(true)} style={{
                ...pillBtn(false),
                padding: '5px 11px', fontSize: 9,
              }}>+ Add Friend</button>
            )}
            <button
              onClick={onInvite}
              disabled={inviteStatus === 'loading'}
              style={{
                ...pillBtn(inviteStatus === 'copied', fa),
                padding: '5px 11px', fontSize: 9,
                opacity: inviteStatus === 'loading' ? 0.6 : 1,
                cursor: inviteStatus === 'loading' ? 'default' : 'pointer',
              }}
            >
              {inviteStatus === 'loading' ? '…'
                : inviteStatus === 'copied' ? '✓ Link Copied!'
                : inviteStatus === 'error'  ? '✕ Try Again'
                : '◎ Invite Friend'}
            </button>
          </div>
        </div>

        {/* Me row */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '10px 0',
          borderBottom: '1px solid var(--fp-border)',
        }}>
          <span style={{
            width: 10, height: 10, borderRadius: '50%',
            background: fa, display: 'inline-block', flexShrink: 0,
            boxShadow: `0 0 8px ${fa}40`,
          }} />
          <span style={{ fontFamily: T.body, fontWeight: 700, fontSize: 13, color: 'var(--fp-text)', flex: 1 }}>Me</span>
          <span style={{ fontSize: 11, color: 'var(--fp-text-dim)' }}>{myArtists.length} artists</span>
        </div>

        {/* Friend rows */}
        {friends.map((f, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '10px 0',
            borderBottom: '1px solid var(--fp-border)',
          }}>
            <span style={{
              width: 10, height: 10, borderRadius: '50%',
              background: FRIEND_COLORS[i % FRIEND_COLORS.length],
              display: 'inline-block', flexShrink: 0,
              boxShadow: `0 0 8px ${FRIEND_COLORS[i % FRIEND_COLORS.length]}40`,
            }} />
            <span style={{ fontFamily: T.body, fontWeight: 700, fontSize: 13, color: 'var(--fp-text)', flex: 1 }}>
              {f.name}
            </span>
            <span style={{ fontSize: 11, color: 'var(--fp-text-dim)', marginRight: 8 }}>{f.artists.length} artists</span>
            <span
              onClick={() => onRemoveFriend(i)}
              style={{
                cursor: 'pointer', color: 'var(--fp-text-mute)', fontSize: 18, lineHeight: 1,
                transition: 'color 0.15s ease',
              }}
              onMouseEnter={e => e.currentTarget.style.color = 'var(--fp-warn)'}
              onMouseLeave={e => e.currentTarget.style.color = 'var(--fp-text-mute)'}
            >×</span>
          </div>
        ))}

        {/* Add friend form */}
        {addingFriend && (
          <div style={{
            marginTop: 16, padding: 16,
            background: 'var(--fp-s2)',
            borderRadius: 'var(--fp-radius-md)',
            border: '1px solid var(--fp-border2)',
            animation: 'fp-scaleIn 0.2s ease both',
          }}>
            <div style={{
              fontFamily: T.body,
              fontSize: 9, fontWeight: 800, letterSpacing: 3,
              color: 'var(--fp-text-dim)', textTransform: 'uppercase', marginBottom: 12,
            }}>Add a Friend</div>
            <input
              value={newFName}
              onChange={e => setNewFName(e.target.value)}
              placeholder="Friend's name"
              style={{
                width: '100%', padding: '10px 14px',
                borderRadius: 'var(--fp-radius-sm)',
                border: '1px solid var(--fp-border2)',
                fontSize: 13, fontWeight: 400,
                background: 'var(--fp-s1)', color: 'var(--fp-text)',
                outline: 'none', boxSizing: 'border-box',
                fontFamily: T.body, marginBottom: 8,
                caretColor: fa,
              }}
            />
            <input
              value={newFArtists}
              onChange={e => setNewFArtists(e.target.value)}
              placeholder="Artists, comma-separated — e.g. Tame Impala, Clairo"
              style={{
                width: '100%', padding: '10px 14px',
                borderRadius: 'var(--fp-radius-sm)',
                border: '1px solid var(--fp-border2)',
                fontSize: 13, fontWeight: 400,
                background: 'var(--fp-s1)', color: 'var(--fp-text)',
                outline: 'none', boxSizing: 'border-box',
                fontFamily: T.body, marginBottom: 12,
                caretColor: fa,
              }}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => {
                  const arts = newFArtists.split(',').map(a => a.trim()).filter(Boolean)
                  if (newFName.trim() && arts.length) {
                    onAddFriend(newFName.trim(), arts)
                    setNewFName('')
                    setNewFArtists('')
                    setAddingFriend(false)
                  }
                }}
                style={{ ...pillBtn(true, fa), padding: '9px 18px' }}
              >Add</button>
              <button
                onClick={() => { setAddingFriend(false); setNewFName(''); setNewFArtists('') }}
                style={{ ...pillBtn(false), padding: '9px 18px' }}
              >Cancel</button>
            </div>
          </div>
        )}
      </div>

      {/* Day selector — only for full-timetable festivals */}
      {!isLineupOnly && fest.days.length > 0 && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 18, flexWrap: 'wrap' }}>
          {fest.days.map((d, i) => (
            <button key={i} onClick={() => setDay(i)} style={pillBtn(day === i, fa)}>{d}</button>
          ))}
        </div>
      )}

      {/* ── Group slot list ───────────────────────────────────────────── */}
      {friends.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: '44px 20px', color: 'var(--fp-text-mute)',
          animation: 'fp-fadeIn 0.4s ease both',
        }}>
          <div style={{ fontSize: 32, marginBottom: 12, opacity: 0.4 }}>◎</div>
          <div style={{
            fontFamily: T.body,
            fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', marginBottom: 8,
          }}>Add a friend to see your group picks</div>
          <div style={{ fontSize: 12, color: 'var(--fp-text-mute)' }}>
            See who wants to see the same artists and spot your shared must-sees.
          </div>
        </div>
      ) : (() => {
        // Lineup-only: match across all artists (no day axis).
        // Full timetable: filter to selected day then sort by start time.
        const groupSlots = isLineupOnly
          ? fest.lineup
              .map(slot => ({ ...slot, going: allParticipants.filter(p => p.artists.some(a => norm(a) === norm(slot.artist))) }))
              .filter(s => s.going.length > 0)
              .sort((a, b) => a.artist.localeCompare(b.artist))
          : fest.lineup
              .filter(s => s.day === day)
              .map(slot => ({ ...slot, going: allParticipants.filter(p => p.artists.some(a => norm(a) === norm(slot.artist))) }))
              .filter(s => s.going.length > 0)
              .sort((a, b) => toMins(a.start) - toMins(b.start))

        const allGoingSlots  = groupSlots.filter(s => s.going.length === allParticipants.length)
        const someGoingSlots = groupSlots.filter(s => s.going.length < allParticipants.length)

        const renderSlot = (slot, i) => (
          <div key={i} style={{
            display: 'flex',
            borderRadius: 'var(--fp-radius-md)',
            border: `1px solid ${slot.going.length === allParticipants.length ? '#fff' : slot.going[0]?.color || 'var(--fp-border)'}`,
            overflow: 'hidden',
            marginBottom: 6,
            background: 'var(--fp-card)',
            animation: `fp-slideUp 0.3s ease ${i * 0.04}s both`,
            transition: 'transform 0.15s ease',
          }}
            onMouseEnter={e => e.currentTarget.style.transform = 'translateX(3px)'}
            onMouseLeave={e => e.currentTarget.style.transform = 'translateX(0)'}
          >
            {slot.start != null ? (
              <div style={{
                background: slot.going.length === allParticipants.length ? '#fff' : slot.going[0]?.color || 'var(--fp-s2)',
                color: '#000',
                padding: '10px 12px',
                minWidth: 78,
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>
                <div style={{ fontFamily: T.body, fontSize: 13, fontWeight: 800, lineHeight: 1 }}>{slot.start}</div>
                <div style={{ fontSize: 7, opacity: 0.5, textTransform: 'uppercase', letterSpacing: 1, margin: '2px 0' }}>to</div>
                <div style={{ fontFamily: T.body, fontSize: 10, fontWeight: 700 }}>{slot.end}</div>
              </div>
            ) : (
              <div style={{
                background: slot.going.length === allParticipants.length ? '#fff' : slot.going[0]?.color || 'var(--fp-s2)',
                width: 4, minWidth: 4, flexShrink: 0,
              }} />
            )}
            <div style={{ padding: '10px 14px', flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: T.display, fontSize: 14, fontWeight: 700, color: 'var(--fp-text)' }}>{slot.artist}</div>
              <div style={{
                fontFamily: T.body, fontSize: 10, color: 'var(--fp-text-mute)',
                textTransform: 'uppercase', letterSpacing: 1.5, marginTop: 2, marginBottom: 6,
              }}>{slot.stage || 'Lineup'}</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {slot.going.map(p => (
                  <span key={p.name} style={{
                    fontSize: 10, padding: '2px 8px', borderRadius: 3,
                    border: `1px solid ${p.color}50`,
                    color: p.color, fontWeight: 700,
                    background: `${p.color}08`,
                  }}>{p.name}</span>
                ))}
              </div>
            </div>
          </div>
        )

        return (
          <>
            {allGoingSlots.length > 0 && (
              <>
                <div style={{
                  fontFamily: T.body,
                  fontSize: 9, fontWeight: 800, letterSpacing: 4,
                  color: '#fff', textTransform: 'uppercase', marginBottom: 12,
                  display: 'flex', alignItems: 'center', gap: 8,
                }}>
                  All Going — {allGoingSlots.length} act{allGoingSlots.length !== 1 ? 's' : ''}
                </div>
                {allGoingSlots.map(renderSlot)}
                {someGoingSlots.length > 0 && (
                  <div style={{
                    fontFamily: T.body,
                    fontSize: 9, fontWeight: 800, letterSpacing: 4,
                    color: 'var(--fp-text-dim)', textTransform: 'uppercase',
                    margin: '20px 0 12px',
                  }}>Others Going</div>
                )}
              </>
            )}
            {allGoingSlots.length === 0 && someGoingSlots.length > 0 && (
              <div style={{
                fontFamily: T.body,
                fontSize: 9, fontWeight: 800, letterSpacing: 4,
                color: 'var(--fp-text-dim)', textTransform: 'uppercase', marginBottom: 12,
              }}>Group Picks</div>
            )}
            {someGoingSlots.map(renderSlot)}
            {groupSlots.length === 0 && (
              <div style={{
                textAlign: 'center', padding: '36px',
                color: 'var(--fp-text-mute)', fontSize: 12,
              }}>No group picks on this day.</div>
            )}
          </>
        )
      })()}
    </div>
  )
}
