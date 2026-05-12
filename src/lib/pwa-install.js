// src/lib/pwa-install.js
//
// usePwaInstallPrompt() — captures the browser's beforeinstallprompt event
// and exposes a promptInstall() function that triggers the native install
// dialog.
//
// Usage:
//   const { canInstall, promptInstall, isInstalled } = usePwaInstallPrompt()
//
//   canInstall   — true when the browser has an install prompt ready
//                  (Chrome/Edge on Android + desktop; not Safari)
//   promptInstall() — shows the native A2HS / install dialog; resolves with
//                  { outcome: 'accepted' | 'dismissed' }
//   isInstalled  — true when running in standalone (already installed) mode

import { useState, useEffect, useRef } from 'react'

export function usePwaInstallPrompt() {
  const [canInstall,  setCanInstall]  = useState(false)
  const [isInstalled, setIsInstalled] = useState(false)
  const deferredRef = useRef(null)   // holds the BeforeInstallPromptEvent

  useEffect(() => {
    // Detect standalone / TWA mode — already installed.
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true   // iOS Safari

    setIsInstalled(standalone)
    if (standalone) return

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
