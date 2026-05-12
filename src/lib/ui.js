// ─────────────────────────────────────────────────────────────────────────────
// ui.js — Shared style helpers for Festival Noir components
// ─────────────────────────────────────────────────────────────────────────────

/** CSS variable font aliases used throughout the app. */
export const T = {
  display: 'var(--fp-font-display)',
  body:    'var(--fp-font-body)',
}

/**
 * Returns an inline style object for a pill-shaped button.
 *
 * @param {boolean} active  Whether the button is in the active/selected state.
 * @param {string}  [col]   Accent colour to use when active.  Falls back to
 *                          the app's default green (#c8f400) if omitted.
 * @returns {React.CSSProperties}
 */
export const pillBtn = (active, col) => ({
  padding: '7px 16px',
  borderRadius: 'var(--fp-radius-sm)',
  border: `1px solid ${active ? col || '#c8f400' : 'var(--fp-border)'}`,
  background: active ? (col || '#c8f400') : 'transparent',
  color: active ? '#000' : 'var(--fp-text-dim)',
  cursor: 'pointer',
  fontFamily: T.body,
  fontSize: 10,
  fontWeight: 800,
  letterSpacing: 2,
  textTransform: 'uppercase',
  transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
})
