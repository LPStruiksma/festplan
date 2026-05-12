import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// ── Supabase URL patterns for runtime caching ─────────────────────────────────
//
// These are matched against the full request URL at runtime inside the service
// worker, so they need to match the deployed origin-relative paths.
//
// Edge function calls  → networkFirst  (fresh data when online, cache fallback)
// Supabase REST reads  → staleWhileRevalidate  (instant render, background sync)
// Everything else      → networkOnly  (auth, realtime, maps, etc.)

const EDGE_FN_PATTERN = /\/functions\/v1\//

// Tables we want to cache for offline-friendly reads
const REST_TABLES = [
  'user_artists',
  'user_schedules',
  'artist_ratings',
  'timetable_slots',
  'festival_meta',
]
const REST_PATTERN = new RegExp(`/rest/v1/(${REST_TABLES.join('|')})`)

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),

    VitePWA({
      // ── Service worker strategy ──────────────────────────────────────────
      // generateSW: Workbox generates the SW from the config below.
      // autoUpdate: the SW installs and activates silently in the background;
      //   no "New content available — reload" prompt needed.
      registerType: 'autoUpdate',
      injectRegister: 'auto',

      // ── Web App Manifest ─────────────────────────────────────────────────
      // Point to the hand-crafted manifest rather than letting VitePWA
      // generate one, so we keep full control over the icon entries.
      manifest: false,        // disable auto-generated manifest
      includeManifestIcons: false,

      workbox: {
        // ── Pre-cache: static assets bundled by Vite ──────────────────────
        globPatterns: ['**/*.{js,css,html,ico,svg,png,woff2}'],

        // ── Runtime caching ───────────────────────────────────────────────
        runtimeCaching: [
          // 1. Edge function calls — networkFirst so we always try to get
          //    fresh data (timetable, discovery) but fall back to cache when
          //    the festival WiFi is patchy.
          {
            urlPattern: EDGE_FN_PATTERN,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'edge-functions',
              networkTimeoutSeconds: 8,
              expiration: {
                maxEntries: 40,
                maxAgeSeconds: 60 * 60 * 24,     // 24 h
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },

          // 2. Supabase REST reads for the tables we use — staleWhileRevalidate
          //    so the schedule renders instantly from cache while syncing in bg.
          {
            urlPattern: REST_PATTERN,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'supabase-rest',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60 * 24 * 3,  // 3 days
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },

          // 3. Everything else (auth, realtime WS upgrades, Spotify, Google
          //    Fonts, external images) — networkOnly, no caching.
          //    This is the implicit Workbox fallback, but we make it explicit.
          {
            urlPattern: /^https?:\/\/.*/,
            handler: 'NetworkOnly',
            options: { cacheName: 'network-only' },
          },
        ],

        // Don't pre-cache source maps — saves bandwidth.
        globIgnores: ['**/*.map'],

        // Bump this when the SW logic changes and you want forced refresh.
        // VitePWA increments it automatically on each build when content changes.
        // dontCacheBustURLsMatching is left at default (hash-based filenames).
      },

      // ── Dev options ──────────────────────────────────────────────────────
      // Enable the SW in the dev server so you can test offline behaviour
      // with `vite dev` + Chrome DevTools > Application > Service Workers.
      devOptions: {
        enabled: false,   // flip to true to test SW locally; keep off normally
        type: 'module',
      },
    }),
  ],

  test: {
    globals:     true,
    environment: 'node',
    coverage: {
      include: ['src/lib/**', 'src/components/**'],
    },
  },
})
