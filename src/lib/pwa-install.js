// src/lib/pwa-install.js
//
// Two hooks:
//
// usePwaInstallPrompt() — captures the browser's beforeinstallprompt event
// and exposes a promptInstall() function that triggers the native install
// dialog.
//
//   canInstall   — true when the browser has an install prompt ready
//                  (Chrome/Edge on Android + desktop; not Safari)
//   promptInstall() — shows the native A2HS / install dialog; resolves with
//                  { outcome: 'accepted' | 'dismissed' }
//   isInstalled  — true when running in standalone (already installed) mode
//
// usePwaUpdate() — detects when a new service worker has installed and the
// page needs a reload to pick it up (JS/SW version mismatch on long-lived tabs).
//
//   needRefresh  — true when a new SW is waiting and the page is stale
//   reload()     — calls updateServiceWorker(true): skipWaiting + page reload

import { useState, useEffect, useRef } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'

// ── usePwaUpdate ──────────────────────────────────────────────────────────────

/**
 * Returns { needRefresh, reload }.
 *
 * needRefresh is true when vite-plugin-pwa reports a new service worker has
 * installed and taken control, meaning the current JS bundle may be stale.
 * reload() calls updateServiceWorker(true) which triggers skipWaiting()
 * followed by a full page reload to pick up the new assets.
 */
export function usePwaUpdate() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW()

  return {
    needRefresh: !!needRefresh,
    reload: () => updateServiceWorker(true),
  }
}

// Standalone / TWA mode means the app is already installed.
function isStandalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true   // iOS Safari
  )
}

export function usePwaInstallPrompt() {
  const [canInstall,  setCanInstall]  = useState(false)
  const [isInstalled, setIsInstalled] = useState(isStandalone)
  const deferredRef = useRef(null)   // holds the BeforeInstallPromptEvent

  useEffect(() => {
    if (isStandalone()) return

    const handler = (e) => {
      // Prevent Chrome's default mini-infobar so we can show our own UI.
      e.preventDefault()
      deferredRef.current = e
      setCanInstall(true)
    }

    const installedHandler = () => setIsInstalled(true)

    window.addEventListener('beforeinstallprompt', handler)
    window.addEventListener('appinstalled', installedHandler)

    return () => {
      window.removeEventListener('beforeinstallprompt', handler)
      window.removeEventListener('appinstalled', installedHandler)
    }
  }, [])

  /**
   * Trigger the native install prompt.
   * @returns {Promise<{ outcome: 'accepted' | 'dismissed' } | null>}
   *   null if no prompt is available.
   */
  async function promptInstall() {
    const prompt = deferredRef.current
    if (!prompt) return null

    prompt.prompt()
    const { outcome } = await prompt.userChoice

    // The prompt can only be used once — clear the ref.
    deferredRef.current = null
    setCanInstall(false)

    return { outcome }
  }

  return { canInstall, promptInstall, isInstalled }
}
