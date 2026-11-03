# Freshness inventory

Every dated or outside thing FestPlan depends on, with its source, when it was last checked and when it may stop holding. Strategy reads the **Valid until** column and opens a unit before the earliest date passes. `scripts/freshness.test.mjs` keeps this file in step with the code: every `scripts/festivals/*.json` file needs a row with its end date, and every Spotify Web API path the code calls needs a row.

- Inventoried: 2026-11-03 at `main` 5c9eedc (festplan#29, autodev#646). Spotify rows updated 2026-11-03 at `main` 8fe4ab3 for festplan#31 units A (#36), B (#37), the C minimum (#38) and Lukas's Development Mode decision (#35).
- Not reachable from the build container on 2026-11-03: `developer.spotify.com`, so Spotify facts below were read through web-search summaries of the official pages and stay `verify` until someone opens them. Ticketmaster facts come from the code comments only.
- **Status**: `confirmed` (read on the source on the date given), `verify` (not checked on the source), `broken (likely)` (the source says it stopped; not tried against Lukas's app), `own` (this repo's choice).

## Next expiry

| Date | What happens | Unit |
| --- | --- | --- |
| **already passed** | Spotify Development Mode removed related artists (S2), so "You might also like" has no data; since #38 it says "Recommendations are unavailable right now" instead of vanishing. The playlist builder and playlist import moved to the allowed endpoints in #36 and #37 (rows S1, S6, S11, S12; S3, S7-S9 retired). | festplan#31 unit C |
| **already passed** | All five seeded editions ended (last: Lowlands, 2026-08-16). Seeding a fresh install shows only past festivals. Glastonbury 2026 is a placeholder (fallow year). | open a unit when the 2027 dates are announced |
| 2026-12-01 | Monthly recheck of Spotify Web API changes (S1, S2, S4-S6, S10-S12): the changelog moved in 2024-11, 2026-02, 2026-03 and 2026-07. | recurring |
| 2027-05-01 | Yearly recheck of Ticketmaster Discovery API (T1-T2) and the Supabase edge runtime imports (R1). | recurring |

## Festival editions

Seed files read by `scripts/seed-festival.mjs`. **Valid until** is the edition's end date; after it the edition is history, not a plan.

| # | File | Edition | Source | Status | Valid until |
| --- | --- | --- | --- | --- | --- |
| F1 | `coachella-2026.json` | Coachella, Indio CA, 2026-04-10 to 2026-04-12 | file, no source URL | verify | 2026-04-12 (passed) |
| F2 | `primavera-2026.json` | Primavera Sound, Barcelona, 2026-06-04 to 2026-06-07 | file, no source URL | verify | 2026-06-07 (passed) |
| F3 | `bestkeptsecret-2026.json` | Best Kept Secret, Hilvarenbeek, 2026-06-11 to 2026-06-13 | file, no source URL | verify | 2026-06-13 (passed) |
| F4 | `glastonbury-2026.json` | Glastonbury 2026, 2026-06-25 to 2026-06-28; the file's `_note` says 2026 is a fallow year and the lineup is 2025 placeholder data | file `_note` | own placeholder | 2026-06-28 (passed); replace when the 2027 lineup is out |
| F5 | `lowlands-2026.json` | Lowlands, Biddinghuizen, 2026-08-13 to 2026-08-16 | file, no source URL | verify | 2026-08-16 (passed) |

Festivals ingested at runtime from Ticketmaster (`festival_meta`, `timetable_slots`) live in the database, not here; their end dates are in `festival_meta`.

## Spotify Web API

App: Lukas's Spotify Client ID used by Supabase Auth (scopes in `src/pages/LoginPage.jsx`: `user-library-read playlist-read-private user-top-read playlist-modify-private`). The repo starts on 2026-05-12, so the Client ID was very likely registered after both cut-offs below, in Development Mode. Confirm in the Spotify Developer Dashboard (creation date, quota mode).

**Decision (Lukas, 2026-11-03 11:45Z, festplan#35): stay in Development Mode.** No Extended Quota application. Related Artists stays unavailable to FestPlan.

Background, from the official pages as summarised by search on 2026-11-03 (developer.spotify.com was still not reachable from the build container when these rows were updated, so the Spotify facts stay `verify`):
- 2024-11-27, blog "Introducing some changes to our Web API": Development Mode apps without a pending extension, and every app registered from that day, lose Related Artists, Recommendations, Audio Features/Analysis, featured/category playlists and preview URLs. Extended Quota apps keep them.
- 2026-02-06, blog "Update on Developer Access and Platform Security" and the "February 2026 Web API Dev Mode Changes" migration guide: new Development Mode Client IDs from 2026-02-11 need a Premium owner, allow at most 5 authorized users and get fewer endpoints; existing ones got the account limits on 2026-03-09 (endpoint changes for them reported postponed). Third-party reports list removed or renamed: artist top tracks, `POST /users/{user_id}/playlists` (now `POST /me/playlists`), `/playlists/{id}/tracks` (now `/playlists/{id}/items`, own or collaborative playlists only), search `limit` capped at 10.
- 2026-07 changelog: Development Mode quotas counted per developer account.

Endpoints the code calls at `main` 8fe4ab3:

| # | Endpoint | Used in | Status | Valid until |
| --- | --- | --- | --- | --- |
| S1 | `/search` (`type=artist`, `limit=1`; and since #36 `type=track`, `limit=1`) | `recommend-festivals` `searchArtistId`; `SchedulePage.jsx` `createSchedulePlaylist` (one track per artist, replaces S3) | verify: still offered; `limit=1` is under the reported cap of 10 | 2026-12-01 recheck |
| S2 | `/artists/{id}/related-artists` | `supabase/functions/recommend-festivals/index.ts` `getRelatedArtistNames` | broken (likely): restricted since 2024-11-27 for apps like this one, and stays so under the Development Mode decision. Errors become `[]`; since #38 `SetupPage.jsx` shows "Recommendations are unavailable right now". | passed; festplan#31 unit C replaces or removes it |
| S4 | `/me/top/artists` (`limit=50`, `medium_term`) | `src/lib/spotify.js` `getTopArtists` | verify: not in the reported removals; `limit=50` may meet a new cap | 2026-12-01 recheck |
| S5 | `/me/tracks` (`limit=50`) | `src/lib/spotify.js` `getLikedSongArtists` | verify, as S4 | 2026-12-01 recheck |
| S6 | `/me/playlists` (GET, `limit=50`) | `src/lib/spotify.js` `getPlaylists` (since #37 reads `items.total`, then the old `tracks.total`, then 0) | verify: endpoint kept, count field reported renamed; the code reads both names | 2026-12-01 recheck |
| S11 | `/playlists/{id}/items` (GET `limit=100`; POST) | GET: `src/lib/spotify.js` `getPlaylistArtists` (since #37, reads `item` then `track`; a 403 says the user can only import playlists they own or collaborate on). POST: `SchedulePage.jsx` `createSchedulePlaylist` (since #36) | verify: the reported replacement for `/playlists/{id}/tracks`; own or collaborative playlists only | 2026-12-01 recheck |
| S12 | `/me/playlists` (POST) | `SchedulePage.jsx` `createSchedulePlaylist` (since #36; replaces `POST /users/{user_id}/playlists`) | verify: the reported replacement form | 2026-12-01 recheck |
| S10 | `accounts.spotify.com/api/token` (refresh grant) | `supabase/functions/refresh-spotify-token/index.ts` | verify: not in the reported removals | 2026-12-01 recheck |

Retired: FestPlan no longer calls these (kept so the history of each row id stays readable).

| # | Endpoint | Retired by | Replaced with |
| --- | --- | --- | --- |
| S3 | `/artists/{id}/top-tracks` | #36 (c40c433) | S1 track search |
| S7 | `/playlists/{id}/tracks` (GET) | #37 (ce65c7f) | S11 GET |
| S8 | `/users/{user_id}/playlists` (POST) | #36 (c40c433) | S12 `POST /me/playlists` |
| S9 | `/playlists/{id}/tracks` (POST) | #36 (c40c433) | S11 POST |
| S10 (part) | `/me` | #36 (c40c433): the user id was only needed for the old playlist path | none |

Error text since #36: a 403 from the playlist builder says FestPlan's Spotify app is in Development Mode and only accounts the owner approved can build playlists (no more "check your Spotify region settings").

**Product limit (own, from the decision):** while the app stays in Development Mode, at most 5 Spotify-authorized users, each added by Lukas in the Spotify Developer Dashboard, and the app stops if the owner's Spotify Premium lapses. Revisit only if FestPlan needs more than 5 users; that would reopen festplan#35.

## Ticketmaster Discovery API

Key: `TICKETMASTER_API_KEY` (Supabase function secret). Base `app.ticketmaster.com/discovery/v2`.

| # | Endpoint | Used in | Status | Valid until |
| --- | --- | --- | --- | --- |
| T1 | `/events.json` (keyword search) | `supabase/functions/discover-festivals/index.ts` | verify: free tier 5,000 requests/day, 5/second per the code comment; batches of 4 with 250 ms gaps | 2027-05-01 recheck |
| T2 | `/events/{id}.json` | `supabase/functions/ingest-festival-timetable/index.ts` (admin only) | verify, as T1 | 2027-05-01 recheck |

## Caches and runtime

| # | What | Where | Status | Valid until |
| --- | --- | --- | --- | --- |
| C1 | Festival tables (`festival_meta`, `timetable_slots`): NetworkFirst, 3 s timeout, offline copy kept 7 days | `vite.config.js` `supabase-festival` | own | no expiry; a timetable change reaches online users at once, offline users after reconnect |
| C2 | Edge function responses (discovery, timetable): NetworkFirst, 8 s timeout, kept 24 h | `vite.config.js` `edge-functions` | own | no expiry |
| C3 | User tables: StaleWhileRevalidate, kept 3 days | `vite.config.js` `supabase-user` | own | no expiry |
| C4 | `discover-festivals` server cache, 24 h (`CACHE_TTL`) | `supabase/functions/discover-festivals/index.ts` | own | no expiry |
| R1 | Edge runtime imports `deno.land/std@0.168.0` and `esm.sh/@supabase/supabase-js@2` | all `supabase/functions/*/index.ts` | verify: old pinned std; works while Supabase's Deno runtime still serves it | 2027-05-01 recheck |

## How to keep it fresh

- A PR that adds a seed file, an outside endpoint or a cache rule adds its row here in the same PR, with the date it was read.
- A dependency with a fixed end date gets a unit at least two weeks before that date.
- Never guess an API fact; mark it `verify` and say where it came from.
