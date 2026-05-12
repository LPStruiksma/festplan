import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// ── Supabase URL patterns for runtime caching ─────────────────────────────────
//
// These are matched against the full request URL at runtime inside the service
// worker, so they need to match the deployed origin-relative paths.
//
// Edge function calls  → NetworkFirst  (fresh data when online, cache fallback)
// Festival tables      → NetworkFirst  (admin edits must be visible immediately;
//                         fall back to cache only when genuinely offline)
// User-owned tables    → StaleWhileRevalidate  (instant render, background sync;
//                         safe because changes come from this device only)
// Everything else      → NetworkOnly  (auth, realtime, maps, etc.)

const EDGE_FN_PATTERN = /\/functions\/v1\//

// Admin-edited content: must be fresh from the network when reachable.
const FESTIVAL_TABLES = ['festival_meta', 'timetable_slots']
const FESTIVAL_REST_PATTERN = new RegExp(`/rest/v1/(${FESTIVAL_TABLES.join('|')})`)

// User-owned tables: safe to serve from cache while revalidating in bg.
const USER_TABLES = ['user_artists', 'user_schedules', 'artist_ratings']
const USER_REST_PATTERN = new RegExp(`/rest/v1/(${USER_TABLES.join('|')})`)

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

          // 2a. Festival tables (festival_meta, timetable_slots) — NetworkFirst.
          //     An admin edit must be visible to users immediately; we only fall
          //     back to the cache when the device is genuinely offline.
          //     3-second network timeout keeps the schedule snappy on slow
          //     festival WiFi before dropping to the cached version.
          {
            urlPattern: FESTIVAL_REST_PATTERN,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'supabase-festival',
              networkTimeoutSeconds: 3,
              expiration: {
                maxEntries: 60,
                maxAgeSeconds: 60 * 60 * 24 * 7,  // 7 days (offline fallback only)
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },

          // 2b. User-owned tables (user_artists, user_schedules, artist_ratings)
          //     — StaleWhileRevalidate: safe to show the cached version instantly
          //     because mutations on these tables always originate from this device.
          {
            urlPattern: USER_REST_PATTERN,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'supabase-user',
              expiration: {
                maxEntries: 60,
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
