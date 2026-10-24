import React, { Component } from 'react'

/**
 * Catches a route that fails to render, most often a lazy page chunk that
 * cannot be fetched (patchy festival wifi, or a deploy replaced the hashed
 * file this tab still points at). Shows a reload prompt instead of a blank
 * app. Changing `resetKey` (the route path) clears the error.
 */
export default class RouteErrorBoundary extends Component {
  state = { error: null, resetKey: this.props.resetKey }

  static getDerivedStateFromError(error) {
    return { error }
  }

  static getDerivedStateFromProps(props, state) {
    if (props.resetKey !== state.resetKey) return { error: null, resetKey: props.resetKey }
    return null
  }

  componentDidCatch(error) {
    console.error('Route failed to load:', error)
  }

  reload = () => {
    if (this.props.onReload) this.props.onReload()
    else window.location.reload()
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div role="alert" style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        gap: 16,
        padding: 24,
        textAlign: 'center',
        fontFamily: "var(--fp-font-body, 'Outfit', sans-serif)",
        color: 'var(--fp-text, #eee)',
      }}>
        <div style={{ fontSize: 15 }}>Couldn&apos;t load this page. Check your connection and try again.</div>
        <button
          type="button"
          onClick={this.reload}
          style={{
            background: 'var(--fp-accent, #c8f400)',
            color: '#000',
            border: 'none',
            borderRadius: 6,
            padding: '10px 20px',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Reload
        </button>
      </div>
    )
  }
}
