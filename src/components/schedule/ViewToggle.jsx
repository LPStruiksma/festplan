import { T } from '../../lib/ui'
import { useIsMobile } from '../../lib/use-is-mobile'

/**
 * Two-button toggle: List vs Grid view.
 *
 * Hidden on mobile — grid layout is not usable on small screens, so mobile
 * users always see the list view (enforced in MyScheduleTab).
 *
 * Props:
 *   viewMode    — 'list' | 'grid'
 *   onViewChange — (mode) => void
 */
export default function ViewToggle({ viewMode, onViewChange }) {
  const isMobile = useIsMobile()

  // On mobile the grid is hidden; no point showing the toggle.
  if (isMobile) return null

  return (
    <div style={{
      display: 'flex', gap: 3,
      background: 'var(--fp-s2)',
      borderRadius: 'var(--fp-radius-md)',
      padding: 3,
      border: '1px solid var(--fp-border)',
    }}>
      {['list', 'grid'].map(m => (
        <button key={m} onClick={() => onViewChange(m)} style={{
          padding: '7px 14px',
          borderRadius: 'var(--fp-radius-sm)',
          border: 'none',
          cursor: 'pointer',
          fontFamily: T.body,
          fontSize: 10,
          fontWeight: 800,
          letterSpacing: 1.5,
          textTransform: 'uppercase',
          background: viewMode === m ? 'var(--fp-s1)' : 'transparent',
          color: viewMode === m ? 'var(--fp-text)' : 'var(--fp-text-dim)',
          transition: 'all 0.15s ease',
        }}>
          {m === 'list' ? '≡ List' : '⊞ Grid'}
        </button>
      ))}
    </div>
  )
}
