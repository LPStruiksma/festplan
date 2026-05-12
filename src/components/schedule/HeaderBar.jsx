import { T, pillBtn } from '../../lib/ui'

/**
 * Sticky top bar: back button, festival name, and action buttons.
 *
 * Props:
 *   fa               — festival accent colour
 *   fest             — festival object ({ emoji, name })
 *   isLineupOnly     — hides export / calendar / spotify buttons when true
 *   toast            — current toast state (null | { type, ... })
 *   onBack           — () => void
 *   onExportCalendar — () => void
 *   onExportPoster   — () => void
 *   onBuildPlaylist  — () => void
 *   hasSpotifyToken  — boolean — controls Spotify playlist button visibility
 */
export default function HeaderBar({
  fa, fest, isLineupOnly, toast,
  onBack, onExportCalendar, onExportPoster, onBuildPlaylist, hasSpotifyToken,
}) {
  return (
    <header style={{
      background: 'var(--fp-s1)',
      borderBottom: `2px solid ${fa}`,
      padding: '12px 18px',
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      flexWrap: 'wrap',
      animation: 'fp-slideDown 0.4s cubic-bezier(0.16, 1, 0.3, 1) both',
    }}>
      {/* Back */}
      <button onClick={onBack} style={{
        ...pillBtn(false),
        padding: '7px 12px',
        display: 'flex', alignItems: 'center', gap: 6,
      }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M19 12H5M12 19l-7-7 7-7"/>
        </svg>
        Back
      </button>

      {/* Festival name */}
      <div style={{ flex: 1, minWidth: 100 }}>
        <div style={{
          fontFamily: T.body,
          fontSize: 8, fontWeight: 700, letterSpacing: 3.5,
          color: 'var(--fp-text-mute)', textTransform: 'uppercase',
        }}>Now Viewing</div>
        <div style={{
          fontFamily: T.display,
          fontSize: 16, fontWeight: 800,
          color: fa, textTransform: 'uppercase',
          letterSpacing: 0.5, lineHeight: 1.1,
        }}>{fest.emoji} {fest.name}</div>
      </div>

      {/* Spotify playlist — only when provider_token is available */}
      {!isLineupOnly && hasSpotifyToken && (
        <button
          onClick={onBuildPlaylist}
          disabled={toast?.type === 'loading'}
          title="Build Spotify Playlist"
          style={{
            ...pillBtn(false),
            padding: '7px 12px',
            display: 'flex', alignItems: 'center', gap: 6,
            opacity: toast?.type === 'loading' ? 0.5 : 1,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.516 17.317a.75.75 0 01-1.032.25c-2.824-1.726-6.38-2.116-10.567-1.16a.75.75 0 01-.334-1.463c4.58-1.047 8.51-.597 11.683 1.34a.75.75 0 01.25 1.033zm1.472-3.276a.937.937 0 01-1.288.308c-3.23-1.986-8.153-2.562-11.977-1.402a.937.937 0 01-.545-1.791c4.363-1.325 9.786-.683 13.502 1.597a.937.937 0 01.308 1.288zm.126-3.41C15.37 8.39 9.278 8.19 5.748 9.27a1.125 1.125 0 01-.655-2.153c4.065-1.236 10.822-1 15.05 1.63a1.125 1.125 0 01-1.03 2.004z"/>
          </svg>
          {toast?.type === 'loading' ? 'Building…' : 'Playlist'}
        </button>
      )}

      {/* Calendar + poster export — hidden for lineup-only festivals */}
      {!isLineupOnly && (
        <>
          <button onClick={onExportCalendar} style={{
            ...pillBtn(false),
            padding: '7px 12px',
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
              <line x1="16" y1="2" x2="16" y2="6"/>
              <line x1="8" y1="2" x2="8" y2="6"/>
              <line x1="3" y1="10" x2="21" y2="10"/>
            </svg>
            Calendar
          </button>
          <button onClick={onExportPoster} style={{
            ...pillBtn(false),
            padding: '7px 12px',
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>
            </svg>
            Export
          </button>
        </>
      )}
    </header>
  )
}
