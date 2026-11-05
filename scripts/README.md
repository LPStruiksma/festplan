# scripts/

Utility scripts for the Festplan backend.

---

## seed-festival.mjs

Seeds one festival edition into Supabase in two modes:
- **Date-only** (`stages: []`, `lineup: []` and verified `startDate`/`endDate`): upserts **festival_meta only**. Existing `timetable_slots` are never deleted or inserted, even on re-import.
- **Full lineup** (both arrays non-empty): upserts metadata, then **replaces** only that edition's timetable via delete and batched insert (existing behaviour).

Both modes are idempotent by festival key. A failed full-lineup insert after deletion is not transactional; the operator must plan recovery.

### Prerequisites

**1. Verify schema (owner/operator task)**

The script depends on `festival_meta` and `timetable_slots`. If migration `0002_festival_tables.sql` has not been applied, only an authorized operator may apply it:

1. Open your Supabase project → **SQL Editor**
2. Paste the contents of `supabase/migrations/0002_festival_tables.sql`
3. Click **Run**

> You only need to do this once per project.

**2. Add credentials to `.env`**

Create (or update) `.env` in the project root:

```
SUPABASE_URL=https://<your-project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
```

Find both values in your Supabase dashboard under **Project Settings → API**.
Use the **service role** key (not the anon key) — the script needs to bypass Row Level Security.

> `.env` is git-ignored. Never commit it.

**3. Node version**

The `--env-file` flag requires **Node 20.6 or later**. Check with `node --version`.

---

### Running the script

```bash
node --env-file=.env scripts/seed-festival.mjs <path-to-json>
```

**Example for an authorized test/staging project (never production without owner approval):**

```bash
node --env-file=.env scripts/seed-festival.mjs scripts/festivals/glastonbury-2027.json
```

Metadata-only output reports that `festival_meta` was upserted and
`timetable_slots` was **untouched**. A full-lineup run reports the number
of replaced timetable slots.

---

### JSON format

The JSON file must match the shape used in `src/lib/festivals.js`:

```jsonc
{
  "id":       "glastonbury-2025",       // URL-slug, used as festival_key in DB
  "name":     "Glastonbury 2025",
  "location": "Pilton, Somerset, UK",
  "emoji":    "🎸",
  "accentColor": "#82d96e",             // optional; null = default green
  "days":   ["Thu Jun 26", "Fri Jun 27", "Sat Jun 28", "Sun Jun 29"],
  "stages": ["Pyramid Stage", "Other Stage", "West Holts"],
  "lineup": [
    {
      "artist": "Olivia Rodrigo",
      "stage":  "Pyramid Stage",
      "day":    3,          // 0-based index into "days" array above
      "start":  "21:30",   // 24-hour local time
      "end":    "23:00"
    }
  ]
}
```

---

### 2027 date-only edition files

Each 2027 JSON records organiser-confirmed dates with optional top-level provenance:

```json
{ "source": { "url": "https://official-organiser.example/2027", "checkedOn": "2026-11-05" } }
```

The `source` object documents the official announcement and check date; it is not stored in Supabase. Every edition uses a distinct `id` so older editions are not overwritten. Coachella's two weekends are separate files because there is a week between them.

**Date-only files are metadata-import ready**, provided they have verified real, ordered `YYYY-MM-DD` dates and non-empty calendar-day labels. Both `stages` and `lineup` must be empty arrays together: malformed, missing or wrong-type arrays and half-empty records are rejected **before any write**. Required identity, name and location must be non-blank strings. For full-lineup mode the script also checks each artist, day index and `HH:mm` time before writing. Never copy old acts, stages, days, or set times into a new edition. Announced artist lists without verified set details do not become timetable slots.

**Owner-only production step:** Lukas/the authorized production operator reviews confirmed source data, target project, backups/recovery and any necessary schema apply, then separately authorizes/runs production seeding. AutoDev agents must not execute production seeding, run `deploy.sh`, use production credentials or apply production DB changes. Merging this PR does **not** approve a production import. The CI tests mock the DB client and require no service-role secrets or network.

---

### Adding a new festival

1. Create a new JSON file in `scripts/festivals/`, e.g. `primavera-2026.json`
2. Follow the JSON format above
3. Validate the JSON and, only for an authorized test/staging project, run the seed script pointing at your new file. Production import remains the separate owner step above

The new festival will appear in the Edge Function's `festival_meta` lookup immediately. Once you also populate `timetable_slots` (via the seed script with a full lineup), `hasTimetable` will return `true` for that festival and SchedulePage will switch from lineup-only mode to the full grid/list view.

---

### How it maps to Supabase tables

| JSON field       | Table              | Column          |
| ---------------- | ------------------ | --------------- |
| `id`             | `festival_meta`    | `festival_key`  |
| `name`           | `festival_meta`    | `name`          |
| `location`       | `festival_meta`    | `location`      |
| `emoji`          | `festival_meta`    | `emoji`         |
| `accentColor`    | `festival_meta`    | `accent_color`  |
| `days`           | `festival_meta`    | `days`          |
| `stages`         | `festival_meta`    | `stages`        |
| `startDate` / `endDate` | `festival_meta` | `start_date` / `end_date` |
| `lineup[].artist`| `timetable_slots`  | `artist`        |
| `lineup[].stage` | `timetable_slots`  | `stage`         |
| `lineup[].day`   | `timetable_slots`  | `day_index`     |
| `lineup[].start` | `timetable_slots`  | `start_time`    |
| `lineup[].end`   | `timetable_slots`  | `end_time`      |

---

## festivals/

Sample, date-only and placeholder JSON files; do not treat placeholders as verified imports.

| File                          | Notes                                                                   |
| ----------------------------- | ----------------------------------------------------------------------- |
| `glastonbury-2026.json`       | **Placeholder** — Glastonbury 2026 is a fallow year (no festival). Uses confirmed 2025 artists. Replace with real data when the 2027 lineup is announced. |
