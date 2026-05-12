# scripts/

Utility scripts for the Festplan backend.

---

## seed-festival.mjs

Seeds one festival's metadata and timetable into Supabase.
Idempotent — safe to re-run; existing slots are replaced on each run.

### Prerequisites

**1. Apply the festival tables migration**

The script writes to `festival_meta` and `timetable_slots`. If you haven't applied migration `0002_festival_tables.sql` yet, do it now:

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

**Example — seed the Glastonbury placeholder:**

```bash
node --env-file=.env scripts/seed-festival.mjs scripts/festivals/glastonbury-2026.json
```

Expected output:

```
🎪  Seeding: Glastonbury 2026
    festival_key : glastonbury-2026
    days         : 4 (Thu Jun 25, Fri Jun 26, Sat Jun 27, Sun Jun 28)
    stages       : 5
    lineup slots : 37

✅  festival_meta  — upserted 1 row
    Inserting… 37 / 37 slots
✅  timetable_slots — replaced with 37 rows

🎉  Done — "Glastonbury 2026" is live in Supabase.
```

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

### Adding a new festival

1. Create a new JSON file in `scripts/festivals/`, e.g. `primavera-2026.json`
2. Follow the JSON format above
3. Run the seed script pointing at your new file

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
| `lineup[].artist`| `timetable_slots`  | `artist`        |
| `lineup[].stage` | `timetable_slots`  | `stage`         |
| `lineup[].day`   | `timetable_slots`  | `day_index`     |
| `lineup[].start` | `timetable_slots`  | `start_time`    |
| `lineup[].end`   | `timetable_slots`  | `end_time`      |

---

## festivals/

Sample and placeholder JSON files ready to seed.

| File                          | Notes                                                                   |
| ----------------------------- | ----------------------------------------------------------------------- |
| `glastonbury-2026.json`       | **Placeholder** — Glastonbury 2026 is a fallow year (no festival). Uses confirmed 2025 artists. Replace with real data when the 2027 lineup is announced. |
