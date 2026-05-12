/**
 * useIsMobile
 *
 * Returns true when the viewport width is below the mobile breakpoint (640 px).
 * Reactive: re-renders when the window is resized across the breakpoint.
 *
 * Uses a ResizeObserver on document.documentElement for precision; falls back to
 * the window resize event in environments where ResizeObserver is unavailable.
 */

import { useState, useEffect } from 'react'

const MOBILE_BREAKPOINT = 640   // px — matches Tailwind's `sm:` breakpoint

function getIsMobile() {
  return typeof window !== 'undefined' && window.innerWidth < MOBILE_BREAKPOINT
}

export function useIsMobile() {
  const [isMobile, setIsMobile] = useState(getIsMobile)

  useEffect(() => {
    const update = () => {
      const next = window.innerWidth < MOBILE_BREAKPOINT
      setIsMobile(prev => prev === next ? prev : next)
    }

    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(update)
      ro.observe(document.documentElement)
      return () => ro.disconnect()
    }

    // Fallback
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  return isMobile
}
