-- ─────────────────────────────────────────────────────────────────────────────
-- 0002_festival_tables.sql
--
-- Backend tables used by the discover-festivals Edge Function:
--
--   festival_meta       — curated metadata for known festivals (seeded via
--                         scripts/seed-festival.mjs; overrides Ticketmaster data)
--   timetable_slots     — per-artist stage + time slots once the full schedule
--                         is published (also seeded via seed-festival.mjs)
--   artist_events_cache — short-lived Ticketmaster API response cache
--                         (TTL = 24 h, enforced in the Edge Function)
--
-- Access model:
--   • festival_meta and timetable_slots are publicly readable (no login required
--     so the schedule page can display data to all users).
--   • All writes go through the service role key (Edge Function, seed script).
--     The service role bypasses RLS automatically — no explicit write policy needed.
--   • artist_events_cache is internal to the Edge Function only; no public access.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── festival_meta ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.festival_meta (
  festival_key  TEXT        PRIMARY KEY,           -- URL-slug, e.g. "glastonbury-2025"
  name          TEXT        NOT NULL,              -- "Glastonbury 2025"
  location      TEXT        NOT NULL DEFAULT '',   -- "Pilton, Somerset, UK"
  emoji         TEXT        NOT NULL DEFAULT '🎵',
  accent_color  TEXT,                              -- hex, e.g. "#82d96e"; NULL = use default
  days          TEXT[]      NOT NULL DEFAULT '{}', -- ["Thu Jun 26", "Fri Jun 27", …]
  stages        TEXT[]      NOT NULL DEFAULT '{}', -- ["Pyramid Stage", "Other Stage", …]
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.festival_meta ENABLE ROW LEVEL SECURITY;

-- Public SELECT — anyone can read festival headers (no login required).
CREATE POLICY "festival_meta_select_all"
  ON public.festival_meta FOR SELECT
  USING (true);

-- ── timetable_slots ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.timetable_slots (
  id            BIGSERIAL   PRIMARY KEY,
  festival_key  TEXT        NOT NULL
                            REFERENCES public.festival_meta (festival_key)
                            ON DELETE CASCADE,
  artist        TEXT        NOT NULL,
  stage         TEXT,
  day_index     INTEGER     NOT NULL,  -- 0-based index into festival_meta.days
  start_time    TEXT        NOT NULL,  -- "HH:MM" 24-hour local time
  end_time      TEXT        NOT NULL,  -- "HH:MM" 24-hour local time
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS timetable_slots_festival_key_idx
  ON public.timetable_slots (festival_key);

CREATE INDEX IF NOT EXISTS timetable_slots_day_start_idx
  ON public.timetable_slots (festival_key, day_index, start_time);

ALTER TABLE public.timetable_slots ENABLE ROW LEVEL SECURITY;

-- Public SELECT — anyone can read timetable data.
CREATE POLICY "timetable_slots_select_all"
  ON public.timetable_slots FOR SELECT
  USING (true);

-- ── artist_events_cache ────────────────────────────────────────────────────────
-- Internal cache for Ticketmaster API responses. The Edge Function upserts here
-- after each live fetch so the same artist isn't re-queried within the TTL window.

CREATE TABLE IF NOT EXISTS public.artist_events_cache (
  artist_name  TEXT        PRIMARY KEY,  -- lowercased display name
  events       JSONB       NOT NULL DEFAULT '[]',
  fetched_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.artist_events_cache ENABLE ROW LEVEL SECURITY;

-- No public access — only the Edge Function (service role) reads/writes this.
