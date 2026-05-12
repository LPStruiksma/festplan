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
