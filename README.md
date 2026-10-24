# FestPlan

A personal festival planner, built as a progressive web app. Log in with Spotify, see which of your top artists play at a festival, and build a day-by-day schedule.

Features:

- Spotify login; your top artists are matched against festival lineups.
- Per-day schedule with list and grid views (grid on desktop only) and clash resolution.
- Artist ratings, iCal export and a Spotify playlist builder.
- Friend groups through invite links (`/join/:slug`). Group members' ratings and clash resolutions update live on the schedule, and your friends list syncs across your own devices (see [Realtime](#realtime)).
- Festival comparison (`/compare`) and festival recommendations.
- Admin pages for editing festivals and ingesting timetables from Ticketmaster (`/admin/...`, shown only to the admin email).

## Stack

- Frontend: React 19, Vite 8, React Router 7, plain JavaScript/JSX, `vite-plugin-pwa`.
- Tests: Vitest with Testing Library and jsdom. Supabase is mocked, so tests need no network or credentials.
- Backend: Supabase (Postgres with row-level security, auth, realtime), SQL migrations in `supabase/migrations/`, Deno edge functions in `supabase/functions/`. The schema is described in `supabase/SCHEMA.md`.
- Hosting: Vercel, as a single-page app (`vercel.json` rewrites every path to `index.html`).

## Setup

You need Node 20.19 or later on the 20.x line, or 22.12 or later (Vite 8 requires `^20.19.0 || >=22.12.0`), and npm. CI uses Node 24.

```sh
npm ci
```

To run the app against a backend you need a Supabase project. Put the frontend settings in `.env.local` (git-ignored):

| Name | Used for |
| --- | --- |
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon (public) key |
| `VITE_ADMIN_EMAIL` | the account that sees the admin pages |

The edge functions read these Supabase secrets:

| Name | Used by |
| --- | --- |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | the functions' Supabase clients |
| `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` | `refresh-spotify-token` |
| `TICKETMASTER_API_KEY` | `discover-festivals`, `ingest-festival-timetable` |
| `ADMIN_EMAIL` | `admin-write`, `ingest-festival-timetable` |

Spotify login goes through Supabase Auth's Spotify provider, so the Spotify app and its redirect URL are configured in the Spotify and Supabase dashboards, not in this repository.

Never commit `.env`, `.env.local` or any key.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | start the Vite dev server |
| `npm test` | run the test suite once (`vitest run`) |
| `npm run test:watch` | run the tests in watch mode |
| `npm run build` | build the production bundle into `dist/`, then fail if any JavaScript chunk is over 500 kB (`scripts/check-bundle-size.mjs`) |
| `npm run preview` | serve the built bundle locally |
| `npm run lint` | run ESLint |

The check that runs on every pull request (`tenant-baseline`, in `.github/workflows/autodev-tenant2-shadow.yml`) is `npm ci --ignore-scripts`, then `npm test && npm run build`. It also runs `npm run lint` without failing on it, and validates the AutoDev declaration in `.autodev/project.json`.

## Realtime

Live updates use Supabase Realtime `postgres_changes` subscriptions in `src/lib/realtime.js`, used by the schedule page:

- `useGroupSync` listens to `artist_ratings` and `schedule_resolutions` for you and each group member who joined through an invite link (one channel per user, filtered to the current festival). Friends you added by hand are not real users and are not subscribed to.
- `useFriendsSync` listens to your own `friends` rows and reloads the list when they change on another device.

A table only sends these events when it is in the Supabase project's `supabase_realtime` publication. No migration in `supabase/migrations/` adds any table to it, so that is set up in the Supabase project itself. Without it the subscriptions stay silent and changes show up the next time the page loads.

## Festival data

`scripts/seed-festival.mjs` loads one festival's lineup and timetable from a JSON file in `scripts/festivals/` into Supabase; `scripts/cleanup-junk-festivals.mjs` finds festival rows created by accidental Ticketmaster ingestion and deletes them after asking for confirmation. Both run with `node --env-file=.env scripts/<name>.mjs` and need `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `.env`. `scripts/README.md` describes the seed script and its JSON format.

## Deploying

Deploying is done by hand and is not part of this repository's automation: migrations are applied to the Supabase project, edge functions are deployed with the Supabase CLI (`npx supabase functions deploy <name>`), and the frontend is deployed to Vercel. `DEVELOPMENT_REPORT.md` has the history of the app and the manual steps used so far.
