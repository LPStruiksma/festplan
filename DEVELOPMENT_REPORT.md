# Festplan — Development Report
**Session dates:** May 2026  
**Written for:** Opus handoff — context for next-phase planning

---

## What Festplan is

Festplan is a personal festival planning app. You log in with Spotify, the app reads your top artists and liked tracks, matches them against festival lineups, and lets you build a personal schedule across stages and days. Friends can join via invite link and see each other's picks in real time.

**Stack:** React 19 + Vite 8, React Router 7, Supabase JS v2 (auth + database + realtime + edge functions). No TypeScript on the frontend; edge functions are Deno/TypeScript.

**Key env vars:** `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (frontend); `TICKETMASTER_API_KEY` (edge function); `SUPABASE_SERVICE_ROLE_KEY` (seed scripts only).

---

## What Was Built

### Phase 1 — Database Schema (Task 1)

Designed and wrote `supabase/migrations/0001_user_state.sql` with six tables:

- **profiles** — 1:1 with `auth.users`, created automatically on first login via `ensureProfile()`.
- **user_artists** — the artist list each user planned with (one row per artist per user), tied to `festival_key`.
- **user_schedules** — one row per user per festival, storing the chosen `festival_key`.
- **schedule_resolutions** — which artist a user picked when two slots conflicted (keyed by `festival_key + conflict_key`).
- **artist_ratings** — star ratings per artist per user per festival.
- **friends** — friend display names + their artist lists, stored as a JSON array per user per festival.

Also wrote `supabase/SCHEMA.md` with a Mermaid ER diagram documenting all relationships. All tables have RLS enabled; policies allow each user to read and write only their own rows.

---

### Phase 2 — localStorage → Supabase Migration (Tasks 2–4)

**`src/lib/profile.js`** — three helpers:
- `ensureProfile(session)` — upserts a row in `profiles` on login.
- `loadArtists(userId, festivalKey)` — fetches user's artist list from `user_artists`.
- `saveArtists(userId, festivalKey, artists)` — writes the full list back (delete-then-insert, idempotent).

**`src/App.jsx`** — `ensureProfile()` now called once in the session-ready effect, before any page renders.

**`src/pages/SetupPage.jsx`** — replaced all `localStorage.getItem/setItem('festplan_artists', ...)` calls with `loadArtists`/`saveArtists`. `localStorage` is kept as a write-through fallback so the page still works while Supabase is loading.

**`src/lib/schedule-store.js`** — new module with:
- `loadSchedule(userId, festivalKey)` — loads resolutions and ratings from Supabase.
- `saveResolution(userId, festivalKey, conflictKey, winner)` — debounced 500ms upsert.
- `saveRating(userId, festivalKey, artist, rating)` — debounced 500ms upsert.
- `loadFriends(userId, festivalKey)` — fetches the friends JSONB column.
- `saveFriends(userId, festivalKey, friends)` — debounced 500ms upsert.

**`src/pages/SchedulePage.jsx`** — `useState` for `resolved`, `ratings`, and `friends` replaced with hooks that hydrate from Supabase on mount and write through on change.

---

### Phase 3 — Lineup-Only Mode (Task 5)

When a live-discovered Ticketmaster festival has `hasTimetable: false`, the old SchedulePage crashed because `fest` was null. Fixed in three places:

- **`src/lib/festivals.js`** — `toMins()` guarded against `null`/`undefined` (returns 0). This was a runtime crash source since lineup-only slots have `start: null, end: null`.
- **`src/lib/api.js`** — `fetchTimetable()` updated to return a valid lineup-only shape (`hasTimetable: false`, empty `days`, empty `stages`, lineup entries with all times null) instead of returning null.
- **`src/pages/SetupPage.jsx`** — `goToSchedule()` saves festival metadata including `hasTimetable` flag; added a "Browse Lineup" button for live festivals without a timetable.
- **`src/pages/SchedulePage.jsx`** — `isLineupOnly` flag derived from `fest.hasTimetable`. When true: renders matched artists as a plain list, shows a "Timetable coming soon" banner, disables the grid/conflict resolution/calendar export. Ratings and friends tab still fully work.

---

### Phase 4 — Festival Database Tables + Seed Script (Task 6)

**`supabase/migrations/0002_festival_tables.sql`** — three new tables:
- `festival_meta` — canonical festival info (id, name, location, emoji, days, stages, lineup as JSONB).
- `timetable_slots` — individual artist slots (festival_id, artist, stage, day_index, start_time, end_time).
- `artist_events_cache` — cache table for Ticketmaster event lookups to reduce API calls.

**`scripts/seed-festival.mjs`** — Node script that reads a JSON file matching the `FESTIVALS` shape from `festivals.js` and upserts it into `festival_meta` + `timetable_slots` via the service role key. Fully idempotent. Usage:

```bash
node --env-file=.env scripts/seed-festival.mjs scripts/festivals/glastonbury-2026.json
```

**`scripts/festivals/glastonbury-2026.json`** — Glastonbury 2026 seed file with 5 stages, 3 days, ~40 lineup slots using plausible real artists.

**`scripts/README.md`** — documents the seed workflow.

---

### Phase 5 — Invite Link Flow (Task 7)

Lets Lukas share a link so a friend can join the same festival group.

**`supabase/migrations/0003_group_invites.sql`** — `group_invites` table: `slug` (UUID, the link token), `inviter_user_id`, `festival_key`, `created_at`, `expires_at` (default `now() + 7 days`).

**`src/lib/invites.js`** — two helpers:
- `createInvite(userId, festivalKey)` — inserts a row, returns the full URL to copy.
- `resolveInvite(slug)` — looks up a valid (non-expired) invite and returns its festival key and inviter.

**`src/pages/JoinPage.jsx`** — new route at `/join/:slug`. Checks the invite, then either starts the OAuth flow (if logged out) or lands the user on the correct SchedulePage. After OAuth the user is redirected back with the slug preserved.

**`src/App.jsx`** — `/join/:slug` route added.

**`src/pages/AuthCallback.jsx`** — reads any `festplan_pending_invite` from localStorage post-OAuth and navigates to the right schedule on arrival.

**`src/pages/SchedulePage.jsx`** — "Invite a Friend" button in the Group tab that calls `createInvite()` and copies the URL to clipboard.

---

### Phase 6 — Realtime Group Sync (Task 8)

**`supabase/migrations/0004_group_sync.sql`** — enables Supabase Realtime publication on `artist_ratings` and `schedule_resolutions`.

**`src/lib/realtime.js`** — `useGroupSync(groupUserIds, festivalKey, onUpdate)` hook. Subscribes to `postgres_changes` on both tables filtered to the given user IDs and festival key. Calls `onUpdate` with a normalized payload so the caller can merge the incoming state.

**`src/pages/SchedulePage.jsx`** — wired `useGroupSync` so that when a group member rates an artist or resolves a conflict, the local state updates live without a reload.

---

### Phase 7 — Glastonbury 2026 Entry (Task 9)

`src/lib/festivals.js` had a `FEST_COLORS['glastonbury']` entry but no corresponding `FESTIVALS['glastonbury']` object, so discovery silently skipped it. Added the full Glastonbury 2026 entry: 5 stages (Pyramid, Other, West Holts, Park, John Peel), 3 days (Fri–Sun), ~40 lineup slots with plausible artists drawn from the real 2025 lineup (since 2026 wasn't announced yet).

---

### Phase 8 — iCal Calendar Export (Task 10)

Added a "Calendar" button to the SchedulePage header that downloads a `.ics` file with one VEVENT per artist in the user's final schedule.

Key implementation details:
- Pure JS string generation — no library dependency. The iCal format is simple enough that a helper function handles it cleanly.
- **Year extraction:** Festival day strings are like `"Fri Jun 27"` — no year. Year is extracted from `fest.name` via `/\d{4}/` regex, falling back to `new Date().getFullYear()`.
- **Post-midnight handling:** Slots where hour < 6 are treated as belonging to the next calendar day (same convention as `toMins()` in `festivals.js`). A slot starting at `"00:30"` on "Fri Jun 27" will have `DTSTART` of June 28.
- **Floating time** (no timezone suffix) — correct for festival schedules where the absolute timezone is implied by location.
- SUMMARY is `"Artist @ Stage"`, LOCATION is the festival name.
- Download filename: `<festival-id>-schedule.ics`.
- Button is hidden in lineup-only mode (no times to export).

---

### Phase 9 — Spotify Playlist Builder (Task 11)

Added a "Playlist" button on SchedulePage that creates a private Spotify playlist named `"<Festival Name> — My Picks"` containing one top track per artist in the user's final schedule, ordered by set time.

Key implementation details:
- Uses `session.provider_token` (the Spotify OAuth token stored by Supabase immediately after login).
- **Two rounds of parallel fetches:** All artist searches run concurrently via `Promise.all()`, then all top-track lookups run concurrently. This keeps it fast for 30+ artists.
- **API flow:** `GET /me` → parallel `GET /search?type=artist` → parallel `GET /artists/{id}/top-tracks` → `POST /users/{id}/playlists` → `POST /playlists/{id}/tracks`.
- Toast UI at the bottom of the screen shows success with a clickable "Open in Spotify" link, or error messages.
- `playlist-modify-private` scope added to LoginPage.jsx OAuth scopes (it wasn't there before).

---

### Phase 10 — SchedulePage Refactor (Task 12)

`SchedulePage.jsx` had grown to ~1,446 lines. Refactored into a thin orchestrator (572 lines) and eight components under `src/components/schedule/`:

| Component | Responsibility |
|---|---|
| `HeaderBar.jsx` | Festival name, back button, export/playlist/calendar buttons, toast rendering |
| `ConflictBanner.jsx` | Displays conflicts and lets user pick a winner; returns null when no conflicts |
| `DaySelector.jsx` | Day pills with per-day match count badges |
| `ViewToggle.jsx` | Grid / List toggle buttons |
| `ListView.jsx` | Scrollable list of artists per day, with ratings, conflict highlighting, group dots |
| `GridView.jsx` | Stage×time grid with positioned artist cards |
| `MyScheduleTab.jsx` | Composes DaySelector + ViewToggle + ListView/GridView for the "My Schedule" tab |
| `GroupTab.jsx` | Friend list, invite button, add-friend form, group overview |

**`src/lib/ui.js`** — new shared utility file with:
- `pillBtn(active, col)` — the style object for pill buttons, previously an inline closure in SchedulePage. Now takes the accent color explicitly (no closure capture).
- `T` — font family constants referencing the CSS variables.

No behaviour changes — pure structural refactor.

---

### Phase 11 — Vitest + Unit Tests (Task 13)

**`vite.config.js`** — added `test` block: `globals: true` (no import needed for `describe`/`test`/`expect`/`vi`), `environment: 'node'` (component tests can opt into jsdom per-file), coverage includes `src/lib/**` and `src/components/**`.

**`package.json`** — added `"test": "vitest run"` and `"test:watch": "vitest"` scripts. Added `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom` to devDependencies.

**`src/lib/festivals.test.js`** — 26 tests across three describe blocks:
- `norm`: lowercasing, whitespace trimming, idempotence, internal punctuation.
- `toMins`: null/undefined guard, standard times, post-midnight boundary (hours 0–5 map to 24–29, hour 6 is the cutover), cross-midnight ordering guarantees.
- `overlaps`: non-overlap, back-to-back (touching boundary is not an overlap), different-day, partial overlap, containment, identical slots, post-midnight pairs, null-time slots.

**`src/lib/api.test.js`** — 11 tests for `fallbackDiscover`:
- Result shape (correct fields, correct types).
- `hasTimetable` always true for hardcoded festivals.
- Empty/unknown artists give matchCount 0 everywhere.
- Sort order guaranteed descending by matchCount.
- First result always has the maximum matchCount (robust test — doesn't assume which festival wins).
- Case-insensitive matching.
- `matchedArtists` includes/excludes correctly.
- `totalKnownArtists` equals unique artist count in the lineup.

The test file uses `vi.mock('./supabase', ...)` to prevent `createClient(undefined, undefined)` from throwing when env vars are absent in the test environment. This mock is hoisted by Vitest's transformer so it runs before imports.

**Result:** 37/37 tests pass.

---

## Limitations and Caveats

### Spotify `provider_token` not persisted

This is the biggest UX rough edge introduced in Phase 9. Supabase only makes `provider_token` available immediately after the OAuth flow completes. After a hard page reload, the token is gone. The playlist button will show an error telling the user their Spotify session expired. **Workaround for now:** log out and reconnect. **Proper fix:** store the provider token in `localStorage` or in the database on login (requires handling refresh tokens, which adds scope complexity).

### iCal year extraction is fragile

The year is extracted from `fest.name` via `/\d{4}/` regex. This works for all five hardcoded festivals because their names include the year. But live-discovered festivals from Ticketmaster will likely have names like `"Glastonbury Festival"` with no year — the export will silently fall back to the current year, which could be wrong for events in January of the following year. Fix: store explicit start/end dates on the festival object (the Ticketmaster API does return them).

### Realtime subscriptions have no cleanup guard

`useGroupSync` returns an unsubscribe function but doesn't guard against rapid mount/unmount. If a user navigates away and back quickly, there could be duplicate subscriptions until the old one expires. Low risk in practice but worth addressing before scaling to larger groups.

### No test coverage for the UI layer

The test setup is in place and `@testing-library/react` + `jsdom` are installed. But there are no component tests yet. `SchedulePage` (even after refactoring) has complex state logic — conflict resolution in particular — that would benefit from integration tests. The `src/lib` layer is well covered; the `src/components/schedule/` and `src/pages/` layers are not.

### The seed script is manual

`scripts/seed-festival.mjs` works but requires manually authoring a JSON file in the `festivals.js` shape. There's no automated pipeline from Ticketmaster → `festival_meta` + `timetable_slots`. Until that exists, the database version of a festival and the hardcoded version can drift.

### Two-folder sync is fragile

Throughout this project, edits went to the `Web-Development--festplan-main` folder and had to be manually `cp`'d to `Desktop--festplan-main` where the dev server runs. This is error-prone — it's easy to forget a file and spend time debugging a stale copy. The two-folder setup should be collapsed into one.

### No offline or error recovery for writes

All Supabase writes are fire-and-forget with debounce. If a write fails (network drop, RLS violation, session expiry), the user sees no indication and the state is silently not persisted. For a next phase, adding optimistic UI with rollback or at least a "sync failed" indicator would significantly improve reliability.

### Vite build not verifiable in the sandbox

The sandbox environment is missing the native Rolldown binary (`@rolldown/binding-linux-x64-gnu`), so `npm run build` fails there. All verification was done via `npm run dev` (which works) and grep-based import/export audits. Build verification happens on Lukas's machine.

---

## State of the Codebase

### What exists and works

- Full Spotify OAuth login flow via Supabase.
- Artist discovery from Spotify (top artists, liked songs, optional playlist).
- Festival discovery: 5 hardcoded festivals with full timetables, plus live Ticketmaster results via edge function (match counts only, no timetables for live results yet).
- Schedule builder: grid view and list view, day selector, stage filtering, conflict resolution.
- Lineup-only mode for festivals without published timetables.
- Friends/group: add friends by pasting artist lists, see their picks overlaid on your grid, realtime sync.
- Invite links: generate a link, friend opens it, logs in, lands on the right festival.
- Ratings: star-rate artists, persisted to Supabase.
- iCal export: downloads a valid `.ics` with the user's schedule.
- Spotify playlist export: creates a private playlist with one top track per artist.
- Unit test suite: 37 tests covering the core logic layer.

### What doesn't exist yet

- Timetable data for live-discovered (Ticketmaster) festivals — those show match counts only.
- Automated Ticketmaster → database pipeline for timetable slots.
- Component-level tests.
- Mobile layout (the grid view is fixed-width, unusable on phone).
- Error recovery for failed Supabase writes.
- Refresh token handling for the Spotify playlist feature.
- Any admin interface for managing festival data.

---

## Suggested Next Phase Focus Areas

These are roughly ordered by impact-to-effort ratio:

**1. Close the Ticketmaster timetable gap.** This is the core product gap. The discovery edge function (`supabase/functions/discover-festivals/index.ts`) returns match counts for any Ticketmaster festival, but there's no pipeline that writes timetable slots into `festival_meta`/`timetable_slots`. Building that pipeline — even if it's semi-automated or requires a manual trigger — would unlock the full schedule builder for any festival Ticketmaster knows about.

**2. Fix the Spotify provider_token problem.** The playlist feature is only usable immediately after login. Storing the token (and ideally a refresh token) in the database or localStorage at login time would make it reliably available. This would also enable background Spotify reads without requiring the user to be mid-session.

**3. Mobile layout.** The grid view is the biggest piece of work here — it's a CSS grid with fixed pixel widths. A mobile-optimized list-only view with day/stage filters would cover the main use case. The refactored component structure makes this easier to approach since `GridView` and `ListView` are now separate.

**4. Add explicit festival dates to the data model.** Right now, `startDate` and `endDate` are null on hardcoded festivals and present but unused on live-discovered ones. Storing these properly would fix the iCal year-extraction hack and enable "upcoming festivals" sorting and filtering.

**5. Component tests for the schedule logic.** Conflict resolution and friend group logic are complex enough that regressions are plausible. Adding vitest + testing-library tests for `MyScheduleTab` and the conflict resolution flow (which is pure state logic) would catch breakage early.

**6. Consolidate to one folder.** The double-folder sync pattern (`Web-Development` → `Desktop`) should be eliminated. Pick one location, update any dev workflow docs, and stop copying files.

---

## File Map (current state)

```
src/
  App.jsx                        Router + session bootstrap + ensureProfile
  pages/
    LoginPage.jsx                Spotify OAuth, all required scopes
    AuthCallback.jsx             Post-OAuth landing, handles pending invites
    SetupPage.jsx                Festival picker + artist editor (~713 lines)
    SchedulePage.jsx             Thin orchestrator, now 572 lines
    JoinPage.jsx                 Invite link landing page
  components/schedule/
    HeaderBar.jsx
    ConflictBanner.jsx
    DaySelector.jsx
    ViewToggle.jsx
    ListView.jsx
    GridView.jsx
    MyScheduleTab.jsx
    GroupTab.jsx
  lib/
    supabase.js                  Supabase client init
    festivals.js                 5 hardcoded festivals, norm/toMins/overlaps utils
    api.js                       discoverFestivals, fetchTimetable, fallbackDiscover (exported)
    profile.js                   ensureProfile, loadArtists, saveArtists
    schedule-store.js            loadSchedule, saveResolution, saveRating, loadFriends, saveFriends
    spotify.js                   Top artists, liked songs, playlists fetchers
    invites.js                   createInvite, resolveInvite
    realtime.js                  useGroupSync hook
    ui.js                        pillBtn, T (font constants)
    festivals.test.js            26 tests (norm, toMins, overlaps)
    api.test.js                  11 tests (fallbackDiscover)
  styles/
    design.css                   CSS variables — Festival Noir theme
supabase/
  migrations/
    0001_user_state.sql          profiles, user_artists, user_schedules, resolutions, ratings, friends
    0002_festival_tables.sql     festival_meta, timetable_slots, artist_events_cache
    0003_group_invites.sql       group_invites
    0004_group_sync.sql          realtime publication on ratings + resolutions
  functions/
    discover-festivals/index.ts  Ticketmaster-backed discovery edge function
    _shared/cors.ts
  SCHEMA.md                      Mermaid ER diagram
scripts/
  seed-festival.mjs              Upserts a festival JSON into Supabase
  festivals/glastonbury-2026.json
  README.md
vite.config.js                   Includes Vitest config
package.json                     Includes test + test:watch scripts
```

---

---

# Phase 2 Additions — May 2026

*This section covers the second batch of sessions. It is written for Opus as a clean handoff to plan Phase 3.*

---

## What was built in Phase 2

### A. Spotify token persistence

**Files:** `supabase/migrations/0005_spotify_tokens.sql`, `src/lib/spotify-auth.js`, `src/pages/AuthCallback.jsx`, `src/lib/spotify.js`

Added a `spotify_access_token` + `spotify_refresh_token` column to `profiles` (migration 0005). `AuthCallback.jsx` now persists the token to the database on every successful OAuth callback. `src/lib/spotify-auth.js` exports `getValidSpotifyToken(userId)` — tries the in-memory session first, then falls back to the database row. This fixes the main Phase 1 limitation where the Spotify playlist button broke after any page refresh.

**Remaining caveat:** The Spotify access token has a 1-hour TTL. There is still no refresh-token flow. If more than an hour passes since login, `getValidSpotifyToken` will return a stale token and the playlist call will 401. A proper fix requires calling Spotify's `/api/token` endpoint with the refresh token — that should be done server-side (edge function) to avoid exposing the client secret.

---

### B. Offline-safe write queue (sync state)

**Files:** `src/lib/sync-state.js`, `src/components/schedule/HeaderBar.jsx`, `src/App.jsx`

All Supabase writes (ratings, resolutions, friends) now go through a write queue backed by `localStorage['festplan_pending_writes']`. If a write fails, it stays in the queue and is replayed on the next successful auth event. A sync status pill in the header shows `● Synced` / `⟳ Saving…` / `! Sync error — tap to retry`. This closes the fire-and-forget limitation from Phase 1.

---

### C. Festival date handling + iCal fix

**Files:** `supabase/migrations/0006_festival_dates.sql`, `src/lib/dates.js`, `src/lib/festivals.js`, `scripts/seed-festival.mjs`, `scripts/festivals/glastonbury-2026.json`

Migration 0006 adds nullable `start_date` and `end_date` (type `date`) to `festival_meta`. `src/lib/dates.js` exports `getDayDate(festival, dayIndex)` which constructs a proper `Date` object from the festival's `startDate` and the day offset — replacing the fragile year-extraction regex in the iCal export. All six hardcoded festivals in `festivals.js` now have `startDate` and `endDate` set. The Glastonbury 2026 seed JSON was updated to match.

---

### D. Mobile adaptation

**Files:** `src/lib/use-is-mobile.js`, `src/components/schedule/ViewToggle.jsx`, `src/components/schedule/DaySelector.jsx`, `src/components/schedule/MyScheduleTab.jsx`, `src/components/schedule/HeaderBar.jsx`, `src/components/schedule/GroupTab.jsx`

`useIsMobile()` hook — returns true when `window.innerWidth <= 768`, reactive to resize. Used in six components:
- `ViewToggle` hides itself on mobile (grid is unusable on small screens; mobile always shows list).
- `DaySelector` collapses to scroll-snap pills.
- `MyScheduleTab` forces list view and reduces padding on mobile.
- `HeaderBar` hides the "Now Viewing" overline and tightens button sizes; buttons get `minHeight: 44px` for tap targets.
- `GroupTab` collapses the invite section on mobile.

---

### E. Component tests (33 passing)

**Files:** `src/components/schedule/ConflictBanner.test.jsx`, `src/components/schedule/MyScheduleTab.test.jsx`

Also required adding `import React from 'react'` to all eight components in `src/components/schedule/`. Root cause: `@vitejs/plugin-react` v6 uses an oxc-based JSX transform that doesn't apply the automatic JSX runtime to imported files in Vitest's jsdom environment. Explicit React imports are the correct fix.

**Key test-writing lessons for this codebase:**
- When an artist name appears in both a `<strong>` description and a button label, use `getAllByText(name).length > 0` not `getByText`.
- Click tests should use `getByRole('button', { name: /ArtistName/ })` to target the button specifically.
- The heading `{n} Scheduling Conflict{n > 1 ? 's' : ''}` renders as sibling text nodes — test for plural absence + singular presence rather than a combined regex.

---

### F. Ticketmaster → Supabase ingest pipeline

**Files:** `supabase/migrations/0007_nullable_slot_times.sql`, `supabase/functions/ingest-festival-timetable/index.ts`, `src/pages/AdminIngest.jsx`, `src/lib/api.js`, `supabase/functions/discover-festivals/index.ts`

Migration 0007 makes `timetable_slots.start_time` and `end_time` nullable. The new `ingest-festival-timetable` edge function takes `{ eventId }`, fetches the TM event, and upserts a `festival_meta` row + one `timetable_slots` row per attraction with `start_time = NULL`, `end_time = NULL`. The frontend renders these as "lineup-only" festivals. `discover-festivals` was updated so `hasTimetable` is only true when at least one slot has a non-null `start_time`.

**Known bug — UNIQUE constraint missing:** The upsert uses `onConflict: 'festival_key,artist,day_index'` but migration 0002 never created a UNIQUE index on those columns. Run this in the Supabase SQL editor before using the ingest tool in production:
```sql
ALTER TABLE timetable_slots
  ADD CONSTRAINT timetable_slots_festival_artist_day_uniq
  UNIQUE (festival_key, artist, day_index);
```

---

### G. useGroupSync race condition fix

**File:** `src/lib/realtime.js`

Two guards added:
1. `channelsRef` — channel handles stored in a ref so the next effect run can tear them down before building new subscriptions. Closes the rapid mount/unmount overlap window.
2. `isMounted` flag — prevents `onUpdate` from being called after the component unmounts.

---

### H. Admin festival editor

**Files:** `supabase/functions/admin-write/index.ts`, `src/lib/admin-api.js`, `src/pages/AdminFestivals.jsx`, `src/pages/AdminFestivalEdit.jsx`, `src/App.jsx`

Full CRUD editor for `festival_meta` and `timetable_slots`, gated on `session.user.email === VITE_ADMIN_EMAIL`.

- `/admin/festivals` — lists all festivals from `festival_meta` as accent-coloured cards.
- `/admin/festivals/:id` — metadata form (name, location, emoji, accent colour, dates, days[], stages[]) + inline-editable slots table. Changes auto-save on field blur. Slots have artist, stage (dropdown if stages defined), day_index, start_time, end_time. Add/delete per row.
- All writes go through `admin-write` edge function (service role) — no new RLS policies needed.

**Important limitation:** The six hardcoded festivals in `src/lib/festivals.js` are invisible here. `SchedulePage` checks `FESTIVALS[festId]` first and returns early, so even if a matching festival exists in `festival_meta`, it will never be used. Editing Glastonbury via the admin UI has no effect on what the app shows. This is the most important architectural issue to fix in Phase 3 (see below).

---

### I. PWA

**Files:** `vite.config.js`, `public/manifest.json`, `public/icon-192.png`, `public/icon-512.png`, `src/lib/pwa-install.js`, `src/App.jsx`, `index.html`

`vite-plugin-pwa` with `registerType: 'autoUpdate'` (silent background updates). Runtime caching:
- `/functions/v1/*` → NetworkFirst (8s timeout, 24h cache)
- `/rest/v1/(user_artists|user_schedules|artist_ratings|timetable_slots|festival_meta)` → StaleWhileRevalidate (3-day cache)
- Everything else → NetworkOnly

`usePwaInstallPrompt()` hook captures `beforeinstallprompt` and exposes `promptInstall()`. A dismissible pill banner renders at the bottom of the screen for Chromium users who haven't installed yet; dismissed state persists for 30 days in `localStorage`. Safari users see nothing (that platform doesn't support `beforeinstallprompt`).

Icon generation caveat: the favicon SVG uses `color(display-p3 ...)` which ImageMagick 6 can't parse. Icons were generated by stripping P3 declarations first, so they render in sRGB fallback colours. Visually nearly identical; not pixel-perfect P3.

---

## Actions still outstanding (for Lukas to run)

~~1. Fix git staging area~~ — done  
~~2. Install vite-plugin-pwa~~ — done (see note below)  
~~3. Deploy admin-write edge function~~ — done  

4. **Fix the UNIQUE constraint (Supabase SQL editor):**
   ```sql
   ALTER TABLE timetable_slots
     ADD CONSTRAINT timetable_slots_festival_artist_day_uniq
     UNIQUE (festival_key, artist, day_index);
   ```

5. **Verify `.env.local`** contains `VITE_ADMIN_EMAIL=lukas.struiksma@cbre.com`.

6. **Verify Supabase secrets** contain both `ADMIN_EMAIL=lukas.struiksma@cbre.com` and `TICKETMASTER_API_KEY=...`.

### Post-session fix — vite-plugin-pwa version

At the end of Phase 2, `package.json` was found corrupt (truncated to `"vite-plugin-pwa": "^1.3.` mid-entry), causing the Vercel build to fail with `ERR_MODULE_NOT_FOUND: Cannot find package 'vite-plugin-pwa'`. Two issues were fixed:

1. `package.json` was rewritten with valid JSON.
2. The version was corrected to `"^1.0.0"` — the `0.21.x` branch only declares Vite 3–6 peer support; `1.x` is compatible with Vite 8. `npm install --legacy-peer-deps` was run to regenerate `package-lock.json`, and the fix was committed and pushed (`bf35857`). Vercel redeployment should now succeed.

---

## Architecture notes for Phase 3

### The hardcoded/Supabase split is the most important thing to fix

There are two parallel data sources that the app treats as entirely separate:

**`src/lib/festivals.js`** — 6 festivals as JavaScript objects. Always takes priority in `SchedulePage` and `SetupPage`. Full timetable data: stages, times, days. Not editable via the admin UI. The code path is: `if (FESTIVALS[festId]) return FESTIVALS[festId]` — it returns immediately before checking Supabase.

**`festival_meta` + `timetable_slots`** — festivals in Supabase. Full CRUD via admin editor. Only reached if the festival key is NOT in `FESTIVALS`.

Consequences:
- Admin edits to a hardcoded festival key are silently ignored.
- A Ticketmaster-ingested Glastonbury entry would never appear in the schedule.
- The two data sources can drift indefinitely with no warning.

**Recommended fix:** Run the seed script to push the 6 hardcoded festivals into Supabase (they'll get proper `festival_meta` + `timetable_slots` rows). Then update `SchedulePage` and `SetupPage` to always go through `fetchTimetable()` / `discoverFestivals()` and remove the `FESTIVALS[festId]` early-return. Keep `festivals.js` as a dev-only fallback when the network is unavailable. This is one change that unblocks everything else.

### Spotify refresh token flow

The access token expires in 1 hour. The current `getValidSpotifyToken()` in `spotify-auth.js` falls back to the stored database token but never refreshes it. The proper fix is a new edge function (e.g. `refresh-spotify-token`) that:
1. Reads the stored `spotify_refresh_token` from `profiles`
2. POSTs to `https://accounts.spotify.com/api/token` with `grant_type=refresh_token`
3. Stores the new `access_token` (and possibly new `refresh_token`) back to `profiles`
4. Returns the fresh token to the caller

This needs to be server-side because the Spotify client secret must not be exposed in client JS.

### Day-index assignment for multi-day ingest

The current `ingest-festival-timetable` function always writes `day_index = 0`. For a multi-day festival with separate TM event IDs per day, the right approach is to ingest each day separately and derive the day_index from the event's `dates.start.localDate` relative to the festival's `start_date`. A `dayIndex` override parameter in the request body would make this straightforward.

### PWA cache invalidation after admin writes

The `staleWhileRevalidate` strategy caches Supabase REST responses for up to 3 days. After an admin edit, users may see stale data until their cache expires. For timetables this is acceptable. If it becomes a problem, the `admin-write` function could return a cache-busting signal (version timestamp) that triggers a manual SW cache clear on the client.

### The git index.lock problem

The Cowork sandbox mounts the user's Windows filesystem and sometimes attempts git operations that fail midway, leaving a 0-byte `.git/index.lock` that neither the sandbox nor Windows can clean up reliably. The permanent fix is to not run git commands from the sandbox at all — treat Claude's work as file edits only, and keep all `git add` / `git commit` / `git push` on the Windows machine. Claude can tell you which files to stage after each session.

---

## Current file map (post Phase 2)

```
src/
  App.jsx                         Router + session + InstallBanner
  pages/
    LoginPage.jsx
    AuthCallback.jsx               Persists Spotify token on callback
    SetupPage.jsx
    SchedulePage.jsx
    JoinPage.jsx
    AdminIngest.jsx                /admin/ingest — Ticketmaster event ID → Supabase
    AdminFestivals.jsx             /admin/festivals — list all festival_meta rows
    AdminFestivalEdit.jsx          /admin/festivals/:id — metadata + slots editor
  components/schedule/
    HeaderBar.jsx                  Sync pill, mobile-adapted
    ConflictBanner.jsx
    DaySelector.jsx                Mobile scroll-snap
    ViewToggle.jsx                 Hidden on mobile
    ListView.jsx
    GridView.jsx
    MyScheduleTab.jsx
    GroupTab.jsx                   Mobile-adapted
    ConflictBanner.test.jsx        12 tests
    MyScheduleTab.test.jsx         21 tests
  lib/
    supabase.js
    festivals.js                   6 hardcoded festivals (see split note above)
    api.js                         discoverFestivals, fetchTimetable — handles lineup-only
    profile.js
    schedule-store.js              Write queue via sync-state
    spotify.js
    spotify-auth.js                getValidSpotifyToken with DB fallback
    invites.js
    realtime.js                    useGroupSync, race-condition hardened
    sync-state.js                  SyncProvider, write queue, drain on boot
    dates.js                       getDayDate — proper date construction from startDate
    admin-api.js                   listFestivals, getFestivalWithSlots, updateFestivalMeta, upsertSlot, deleteSlot
    pwa-install.js                 usePwaInstallPrompt
    ui.js                          pillBtn, T
    use-is-mobile.js               useIsMobile hook
    festivals.test.js              26 tests
    api.test.js                    11 tests
  styles/
    design.css
supabase/
  migrations/
    0001_user_state.sql
    0002_festival_tables.sql
    0003_group_invites.sql
    0004_group_sync.sql
    0005_spotify_tokens.sql
    0006_festival_dates.sql        start_date, end_date on festival_meta
    0007_nullable_slot_times.sql   start_time, end_time nullable on timetable_slots
  functions/
    discover-festivals/index.ts    hasTimetable only true for slots with non-null start_time
    ingest-festival-timetable/index.ts  NEW — TM event → festival_meta + lineup slots
    admin-write/index.ts           NEW — update_meta, upsert_slot, delete_slot
    _shared/cors.ts
public/
  favicon.svg
  icon-192.png                     NEW — generated from favicon.svg (sRGB fallback colours)
  icon-512.png                     NEW
  manifest.json                    NEW
vite.config.js                     + vite-plugin-pwa v1.x (Vite 8 compatible)
index.html                         + manifest link, apple-touch-icon, apple PWA meta tags
```

---

# Phase 4 — Feature Extensions & Test Coverage
**Session date:** May 2026  
**Model:** Claude Sonnet 4.6  
**Operator note:** Lukas is on Windows (PowerShell). Always give Windows-compatible CLI instructions.

---

## Overview of Phase 4

Six discrete tasks were completed in this session:

1. Multi-day Ticketmaster ingest
2. AdminFestivalEdit UI restructure (tabs, stage columns, bulk paste)
3. Festival comparison view
4. PWA stale-cache fix
5. Component tests for ListView and GroupTab
6. Festival recommendation feature (related-artist discovery)

---

## Task 1 — Multi-day Ticketmaster Ingest

### What changed

**`supabase/functions/ingest-festival-timetable/index.ts`** was rewritten to accept two request shapes:

- **Single-day (existing):** `{ eventId: string, festivalSlug?: string }` — behaviour unchanged.
- **Multi-day (new):** `{ eventIds: string[], festivalSlug?: string }` — fetches each event in parallel, unions the stage names, and assigns each slot to the correct `day_index` relative to the festival's `start_date`.

The key addition is `daysBetween(eventDate, startDate)` which converts a Ticketmaster event date to a zero-based day index:

```typescript
function daysBetween(eventDate: string, startDate: string): number {
  const evMs    = new Date(eventDate + 'T12:00:00Z').getTime()
  const startMs = new Date(startDate + 'T12:00:00Z').getTime()
  return Math.round((evMs - startMs) / (1000 * 60 * 60 * 24))
}
```

A shared `persistFestival()` helper was extracted to deduplicate the DB write logic that both paths use.

**`src/pages/AdminIngest.jsx`** was updated with:
- A `ModeToggle` component (pill toggle: Single-day / Multi-day)
- A textarea accepting multiple event IDs (one per line) in multi-day mode
- An optional slug override field
- The submit logic branches on mode and sends the appropriate body shape

### Caveats

- The `start_date` for the festival must already exist in `festival_meta` for `daysBetween` to work correctly. If it is null (e.g. the first time ingesting a festival), all slots land on `day_index = 0`. Best practice: ingest single-day first to create the record, confirm `start_date` is set, then re-ingest multi-day.
- Each eventId is a single day's Ticketmaster event. One ticket bundle covering all days (e.g. "Glastonbury Weekend Ticket") does not map to a single event usefully — you need the per-day event IDs.
- Ticketmaster's free tier is 5 req/s. The multi-day path runs fetches in parallel; for festivals with >5 days this could briefly breach rate limits. In practice most festivals are 3–5 days so this is not a problem, but it's worth keeping in mind if adding very long events.

---

## Task 2 — AdminFestivalEdit UI Restructure

### What changed

**`src/pages/AdminFestivalEdit.jsx`** was completely rewritten. The flat table of slots still exists but is now one tab among several:

**Tab bar structure:**
- **Metadata tab** — the existing `MetaForm` component (name, location, emoji, accent colour, days array, stages array, dates) — unchanged.
- **Day N tabs** (one per entry in `meta.stages × meta.days`) — per-stage column grid view.
- **≡ All Slots tab** — the original flat table as a bird's-eye view.

**Day tab view (`DayView` + `StageColumn`):**
- Each stage gets its own column derived from `meta.stages`.
- Slots in that column are shown as cards with time inputs.
- A "No Stage" column appears automatically if any slots exist without a stage assignment.
- Each column has a **Bulk Paste** button that opens a modal. The modal accepts CSV lines in the format `Artist,HH:MM,HH:MM` (name, start, end), shows a live preview of parsed rows, and commits them all at once.
- End-time fields auto-suggest `start_time + 60 minutes` when focused empty, to reduce repetitive data entry.

### Time helpers added

```js
function addSixtyMin(timeStr)   // "21:00" → "22:00", handles midnight rollover
function parseBulkLine(line)    // "Artist,21:00,22:00" → {artist, start_time, end_time}
function getDayTabs(meta)       // returns [{value:0, label:"Fri Jun 27"}, ...]
```

### Caveats

- `getDayTabs` derives labels from `meta.days` (the string array, e.g. `["Fri Jun 27", "Sat Jun 28"]`). If `meta.days` is empty, only the "All Slots" tab is shown — there are no day tabs. Solution: always populate `days` when ingesting a festival.
- The stage columns derive from `meta.stages`. If a slot's `stage` field doesn't match any entry in `meta.stages` exactly (case-sensitive), it falls into "No Stage". Advice: make sure ingest writes stage names that match the `stages[]` array in `festival_meta`.
- Bulk paste currently writes slots with `day_index` taken from whichever day tab is open. Make sure you're on the right day tab before pasting.

---

## Task 3 — Festival Comparison View

### What changed

Three pieces:

**`src/pages/SetupPage.jsx`** — in Find mode, each discovery card got a compare checkbox (top-right, 20×20px, styled with the festival's accent colour when checked). A sticky button appears at the bottom of the screen when ≥2 festivals are checked, showing "Compare (N) 🎵🎵". Max 4 festivals. Clicking it navigates to `/compare?ids=a,b,c,d`.

**`src/pages/ComparePage.jsx`** — new page at `/compare`. Reads `?ids=` from the URL, fetches timetable/lineup for each festival in parallel via `fetchTimetable()`, then:
- Renders a **pure-SVG bar chart** comparing match counts (responsive via `viewBox` + `width="100%"`).
- Renders an **artist × festival table** with sticky first column. Each cell shows `Stage · HH:MM` for matched slots, coloured with the festival's accent, or a muted `—` for no match.
- Footer row shows bold total match counts per festival.
- All columns use the festival's full accent colour as background with black text.

**`src/App.jsx`** — added the `/compare` route (session-guarded, same pattern as other routes).

### `computeMatches` function (key logic)

```js
function computeMatches(lineup, myArtists) {
  // Returns { matchedSlots: Map<normName, slot[]>, matchCount: number }
  // Uses norm() for fuzzy artist name comparison
}
```

### Caveats

- The compare page fetches full timetable data for up to 4 festivals simultaneously. For lineup-only festivals (no stage/time data), cells show just `✓` rather than `Stage · HH:MM`.
- The sticky first-column approach (`position: sticky; left: 0; z-index: 1`) works in all modern browsers but can look odd if a festival name is very long. No overflow protection on festival column headers currently.
- There's no "back to setup" button on the compare page — users rely on the browser back button. Worth adding a ← back nav in a future pass.

---

## Task 4 — PWA Stale-Cache Fix

### Problem

All Supabase REST calls were grouped under a single `StaleWhileRevalidate` Workbox rule with a 3-day cache. This meant that after an admin edited a timetable (`timetable_slots`) or festival metadata (`festival_meta`), users could see up to 3 days of stale data before the cache expired — even when they had connectivity.

### What changed

**`vite.config.js`** — the single REST cache rule was split into two:

```js
// Festival tables — NetworkFirst (admin edits must be visible immediately)
const FESTIVAL_REST_PATTERN = new RegExp(`/rest/v1/(festival_meta|timetable_slots)`)
// → handler: 'NetworkFirst', networkTimeoutSeconds: 3, maxAgeSeconds: 7 days

// User tables — StaleWhileRevalidate (safe: only mutated by this device)
const USER_REST_PATTERN = new RegExp(`/rest/v1/(user_artists|user_schedules|artist_ratings)`)
// → handler: 'StaleWhileRevalidate', maxAgeSeconds: 3 days
```

**Why this split makes sense:**
- Festival data (`festival_meta`, `timetable_slots`) is written by an admin, not the viewing user. The user's device has no way to know a write happened, so serving from cache is always wrong when online.
- User data (`user_artists`, `user_schedules`, `artist_ratings`) is only ever mutated by the device currently viewing the app. Serving the cached version instantly and revalidating in the background is safe and fast.

### Caveats

- `NetworkFirst` with `networkTimeoutSeconds: 3` means: on slow festival WiFi, the app will wait up to 3 seconds before falling back to the cache. This is a deliberate trade-off — festival networks are often slow but the data is worth waiting for.
- Workbox evaluates `runtimeCaching` rules **in order**. The festival pattern must appear before the user pattern, which must appear before the catch-all `NetworkOnly` rule. The ordering in `vite.config.js` is now: edge functions → festival tables → user tables → everything else.
- The SW doesn't get hot-swapped in the browser without a full page reload + SW update cycle. Users won't benefit from this fix until their SW updates (triggered by a Vite rebuild deploying a changed SW file).

---

## Task 5 — Component Tests for ListView and GroupTab

### What changed

Two new test files added to `src/components/schedule/`:

**`ListView.test.jsx`** — 12 tests:
- Renders nothing (empty flex wrapper) when `dayLineup` is `[]`
- Renders one row per slot; artist names visible
- Renders `start` / `end` times when timetable data present
- `"Your Pick"` badge present for matched artist, absent for unmatched and empty `myArtists`
- Clicking star 1 calls `onRate(artist, 1)`; clicking star 5 calls `onRate(artist, 5)`
- Star widget absent when `onRate` is `null` (group-view mode)
- `"ALL GOING"` label present when all `groupPeople` share the artist
- `"ALL GOING"` absent when only some do, or when `groupPeople.length === 1`

**`GroupTab.test.jsx`** — 13 tests:
- Empty-state CTA `"Add a friend to see your group picks"` present with no friends, gone once a friend is added
- `"+ Add Friend"` button visible at `friends.length < 3`, hidden at exactly 3
- Clicking `"+ Add Friend"` calls `setAddingFriend(true)`
- Add form (name + artists inputs) visible/hidden based on `addingFriend` prop
- Clicking Add calls `onAddFriend('Alice', ['Radiohead', 'Bicep'])` with comma-split parsing
- Clicking Cancel calls `setAddingFriend(false)`
- Clicking `×` on a friend row calls `onRemoveFriend(0)` with the correct index
- Invite button calls `onInvite`
- `inviteStatus='copied'` renders `"✓ Link Copied!"`
- `"All Going"` section header present when all participants share an artist; absent when they don't

### Mock strategy

Both files follow the pattern established in `ConflictBanner.test.jsx`:

```js
// @vitest-environment jsdom pragma at the top
vi.mock('../../lib/use-is-mobile', () => ({ useIsMobile: () => false }))
vi.mock('../../lib/festivals', () => ({
  norm:          (s) => (s || '').toLowerCase().trim(),
  toMins:        (t) => { /* parse HH:MM */ },
  FRIEND_COLORS: ['#ff6b6b', '#4ecdc4', '#45b7d1'],
}))
vi.mock('../../lib/ui', () => ({
  T:       { body: 'sans-serif', display: 'serif' },
  pillBtn: () => ({}),
}))
```

`useIsMobile` must be mocked as `() => false` — if it returns `true`, the participants list collapses on mount and `×` delete buttons are hidden, causing test failures.

### Caveat — sandbox vs Windows

The tests **cannot be run from inside the Cowork sandbox** because `node_modules` were installed on Windows and contain Windows-native rollup binaries. Always run tests on your local machine:

```
cd C:\Users\YourName\Desktop\festplan-main
npx vitest run src/components/schedule/ListView.test.jsx src/components/schedule/GroupTab.test.jsx
```

---

## Task 6 — Festival Recommendation Feature ("You might also like")

### What changed

Three files added/modified:

**`supabase/functions/recommend-festivals/index.ts`** — new edge function. Flow:
1. Requires `x-spotify-token` header (the caller's stored Spotify access token).
2. Accepts `{ artists: string[] }` — must have ≥5 entries.
3. Takes the first 10 artists, searches Spotify for each artist's ID via `/search?q={name}&type=artist&limit=1`.
4. Fetches the top 5 related artists for each via `/artists/{id}/related-artists`, in parallel.
5. Builds an **expanded set**: related artists not already in the user's list.
6. Queries Supabase `festival_meta` + `timetable_slots` for all seeded festivals.
7. For each festival, computes `originalMatchCount` (user's own artists) and `expandedMatchCount` (original + related).
8. Filters to festivals where `matchDifference = expandedMatchCount - originalMatchCount > 0`.
9. Sorts by `matchDifference` descending (most net-new related matches first).
10. Returns up to 10 results with both counts and the matched related artist names.

**`supabase/functions/_shared/cors.ts`** — `x-spotify-token` added to `Access-Control-Allow-Headers`. Without this, the browser's CORS preflight OPTIONS request rejects the custom header before the function is ever called.

**`src/lib/api.js`** — new `recommendFestivals(artists, spotifyToken)` export. Calls the edge function with the token as a header. Returns `[]` silently on any error.

**`src/pages/SetupPage.jsx`** — in Find mode, below the ranked list:
- New state: `recommendations[]`, `recommending` boolean.
- New `runRecommendations(artists)` callback: calls `getValidSpotifyToken(session.user.id)` first, then `recommendFestivals()`.
- The existing `useEffect` now also calls `runRecommendations` when `myArtists.length >= 5`.
- UI: a `"You might also like"` section header (teal `#22d3ee` colour) with a `RELATED ARTISTS` badge. Up to 3 cards, each showing name, location, date range, related-artist chips, and an `"Explore Festival →"` button. While loading, 3 skeleton placeholder divs pulse. Section is hidden entirely if the user has <5 artists.

### Design decisions

**Why use the client's Spotify token rather than a stored server-side token?**  
Edge functions run under the Supabase service role and don't have a user's OAuth token available natively. Fetching it from `profiles` would require an extra Supabase query inside the edge function, and there's a timing risk: the stored token might be expired by the time the function uses it. Passing it from the client (via `getValidSpotifyToken`, which auto-refreshes) ensures the function always gets a fresh token. The downside is that if the function needs to retry Spotify calls internally (e.g. on rate-limit), it only has the one token lifetime — acceptable for this use case.

**Why filter to only seeded (Supabase) festivals?**  
The related-artist match runs against `timetable_slots`. Ticketmaster-discovered festivals don't have slots in that table yet, so they can't be scored for related matches. This means the recommendation section is only useful once festivals are seeded. See the Phase 4 caveats section for the full picture.

**Why `≥5 artists` as the threshold?**  
Fewer than 5 artists produces low-confidence related-artist signals — if you only have 2 input artists, the "related" set is essentially random from Spotify's perspective. The 5-artist floor gives the Spotify graph enough breadth to return meaningful suggestions.

### Caveats

- **Spotify rate limits:** The function fires up to 10 search calls + 10 related-artists calls in parallel (20 total). Spotify's user-token rate limit is generous (~180 req/30s), so 20 parallel calls is well within bounds. Still, if Spotify is slow, the `/recommend-festivals` call can take 3–5 seconds.
- **Zero results when no festivals are seeded:** If `festival_meta` is empty or `timetable_slots` has no entries, the function returns `[]`. The UI handles this correctly (the section doesn't appear). But if you're testing locally and see no recommendations, check that festivals are seeded.
- **Overlap with main discover results:** There is no deduplication between the main "Ranked for You" list and the "You might also like" list. A festival could appear in both if a user's direct matches are low (appearing ranked low in the main list) while the related-artist matches are high (surfacing in recommendations). This is intentional — the recommendation section answers a different question ("what should I consider?") than the ranked list ("how do your artists actually stack up?"). If it becomes confusing in practice, a simple dedup by `f.id` would fix it.
- **Requires deploying `_shared/cors.ts` changes:** Since cors.ts is shared, updating it requires redeploying ALL functions that import it, not just `recommend-festivals`. See the deploy instructions below.

---

## Outstanding Deployment Steps

These tasks were completed in code but have not yet been deployed. They must be run on your Windows machine.

### From this session (Phase 4)

```
cd C:\Users\YourName\Desktop\festplan-main

:: Deploy the new recommendation function
npx supabase functions deploy recommend-festivals

:: Redeploy functions affected by the cors.ts change
npx supabase functions deploy discover-festivals
npx supabase functions deploy ingest-festival-timetable
npx supabase functions deploy admin-write

:: Build and deploy the frontend
npx vercel --prod
```

### From a previous session (may still be pending)

The `refresh-spotify-token` edge function and its secrets were written in a prior session. If they have not been deployed yet:

```
npx supabase functions deploy refresh-spotify-token
npx supabase secrets set SPOTIFY_CLIENT_ID=your_spotify_client_id
npx supabase secrets set SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
```

To check whether they're already deployed, run `npx supabase functions list` and look for `refresh-spotify-token` in the output.

---

## Current File Map (post Phase 4)

```
src/
  App.jsx                         + /compare route
  pages/
    LoginPage.jsx
    AuthCallback.jsx
    SetupPage.jsx                 + compare checkboxes, sticky Compare btn,
                                    "You might also like" section, runRecommendations
    SchedulePage.jsx
    ComparePage.jsx               NEW — SVG bar chart + artist×festival table
    JoinPage.jsx
    AdminIngest.jsx               + Multi-day toggle, textarea for event IDs
    AdminFestivals.jsx
    AdminFestivalEdit.jsx         REWRITTEN — tab bar (Metadata|Day N|All Slots),
                                    stage columns, bulk paste modal, end-time auto-suggest
  components/schedule/
    HeaderBar.jsx
    ConflictBanner.jsx
    ConflictBanner.test.jsx
    DaySelector.jsx
    ViewToggle.jsx
    ListView.jsx
    ListView.test.jsx             NEW — 12 tests
    GridView.jsx
    MyScheduleTab.jsx
    MyScheduleTab.test.jsx
    GroupTab.jsx
    GroupTab.test.jsx             NEW — 13 tests
  lib/
    api.js                        + recommendFestivals()
    spotify-auth.js               getValidSpotifyToken (used by SetupPage for recommendations)
    [all other lib files unchanged]
supabase/
  functions/
    recommend-festivals/          NEW
      index.ts
    ingest-festival-timetable/    UPDATED — multi-day support
      index.ts
    discover-festivals/           unchanged (cors.ts bump only)
    admin-write/                  unchanged (cors.ts bump only)
    refresh-spotify-token/        unchanged (from prior session)
    _shared/cors.ts               + x-spotify-token in Allow-Headers
vite.config.js                    UPDATED — festival vs user cache strategy split
DEVELOPMENT_REPORT.md             this file
```

---

## Architectural Observations for Opus / Next Phase Planning

### What's working well

- **The Supabase-only data path is clean.** Since Phase 3 removed the hardcoded `FESTIVALS` object from `api.js`, there is now a single authoritative data source. `fetchTimetable()`, `fallbackDiscover()`, and `fetchAllFestivals()` all go through Supabase. Admin edits are visible immediately to users.
- **The component split of SchedulePage is paying off.** Adding tests for `ListView` and `GroupTab` was straightforward because the components are pure-functional (no Supabase imports). This pattern should be continued for new components.
- **Edge function architecture is consistent.** All functions use `_shared/cors.ts`, `handleCors()` + `jsonResponse()`, and the Supabase service-role client pattern. Adding new functions is copy-paste from existing ones.

### What's fragile or missing

**1. Ticketmaster → full timetable is still a manual gap.**  
`ingest-festival-timetable` can now pull multi-day events from Ticketmaster into `timetable_slots`. But `discover-festivals` still only returns a match count and a name — it doesn't automatically trigger an ingest. The admin must manually go to `/admin/ingest`, type in the event IDs, and kick off the ingest. This is the biggest friction point: Ticketmaster discovers 20 festivals, but unless someone manually ingests each one, users see "LINEUP ONLY" forever.  
**Recommended:** A queue-based auto-ingest: when `discover-festivals` finds a festival not in `festival_meta`, it could write it to a `pending_ingests` table. A background job (scheduled edge function or a webhook) could then process that queue automatically.

**2. Spotify token refresh is deployed but untested end-to-end.**  
`refresh-spotify-token` was written and deployed in a prior session but the deploy instructions may not have been run (see outstanding steps above). If they weren't, `getValidSpotifyToken` will silently return a stale token to all Spotify API calls — including the new `recommend-festivals` function. This should be verified before any Spotify-dependent feature is considered stable.

**3. Mobile layout is broken for GridView.**  
`GridView.jsx` uses fixed pixel widths for the time column and stage headers. On a phone screen (375–430px), the grid overflows horizontally and the time labels overlap. `ListView` renders fine on mobile. A simple fix would be to force-switch to `ListView` on mobile breakpoints (the `useIsMobile` hook is already in place), but the grid has no responsive layout at all.

**4. No error boundary or loading state on ComparePage.**  
If `fetchTimetable` fails for one of the compared festivals (network error, invalid ID in the URL), the page throws silently and shows a partial table. A `try/catch` per festival with a "failed to load" placeholder cell would make this more robust.

**5. iCal year derivation is a regex hack.**  
`dates.js` extracts the year from the festival name string. Festivals now have `start_date` in `festival_meta` — the iCal export should use `getDayDate(festival, dayIndex)` which already reads `start_date` correctly. The regex approach can be removed once iCal is updated.

**6. PWA update UX.**  
The service worker is set to `autoUpdate`, which means users get a new SW version in the background. However there is no "content updated — reload for latest" notification. If a user keeps a tab open for a long time, they can see a mix of old and new JS while the SW transitions. Adding a simple reload prompt via the `useRegisterSW` hook from `vite-plugin-pwa` would close this gap.

**7. Recommendation section only works for seeded festivals.**  
The "You might also like" feature matches related artists against `timetable_slots`. Ticketmaster-discovered festivals (in the main ranked list) are not in that table. If Lukas's setup has only the 5 seeded festivals, recommendations will only ever return from that set of 5. This is expected but worth noting: the feature gets dramatically more useful the more festivals are seeded.

### Suggested next-phase priorities (for Opus to refine)

- **P0:** Verify `refresh-spotify-token` is deployed and working (all Spotify features depend on it).
- **P0:** Mobile layout fix — at minimum, suppress GridView on small screens.
- **P1:** Auto-ingest queue — when `discover-festivals` returns a festival not in `festival_meta`, offer a one-click ingest flow rather than manual admin entry.
- **P1:** iCal `start_date` fix — trivial change, removes a known regression path.
- **P2:** ComparePage error handling + back-navigation.
- **P2:** PWA reload prompt.
- **P3:** GroupTab realtime — friend additions/removals don't propagate in real time to other devices in the same group session. The Supabase Realtime subscription in `realtime.js` covers `user_schedules` and `artist_ratings` but not `friends`.
- **P3:** Recommendation cold-start — if the user's Spotify token is expired when `runRecommendations` fires, the function logs a warning and returns `[]` silently. It would be better to retry once after `getValidSpotifyToken` refreshes the token automatically.
