import { T } from '../../lib/ui'

/**
 * Two-button toggle: List vs Grid view.
 *
 * Props:
 *   viewMode    — 'list' | 'grid'
 *   onViewChange — (mode) => void
 */
export default function ViewToggle({ viewMode, onViewChange }) {
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
