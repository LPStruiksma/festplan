-- Migration 0009: UNIQUE (festival_key, artist, day_index) on timetable_slots
--
-- The ingest-festival-timetable edge function upserts timetable_slots with
-- onConflict: 'festival_key,artist,day_index'. Postgres rejects that
-- ON CONFLICT target (42P10) unless a unique constraint or index covers
-- exactly those columns, and no earlier migration created one.
-- DEVELOPMENT_REPORT.md listed it as a manual SQL-editor step instead.
--
-- Idempotent:
--   • skips when any non-partial unique index already covers exactly these
--     three columns (including the manual-step constraint, whatever its name);
--   • otherwise fails, without changing anything, when duplicate rows exist,
--     so a person decides which rows to keep (this migration deletes nothing).
--
-- Numbered 0009 because 0008 is reserved for the friends realtime migration.

DO $$
DECLARE
  dup_groups bigint;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_index i
    WHERE i.indrelid = 'public.timetable_slots'::regclass
      AND i.indisunique
      AND i.indpred IS NULL
      AND i.indexprs IS NULL
      AND (
        SELECT array_agg(a.attname::text ORDER BY a.attname)
        FROM unnest(i.indkey) AS k(attnum)
        JOIN pg_attribute a
          ON a.attrelid = i.indrelid AND a.attnum = k.attnum
      ) = ARRAY['artist', 'day_index', 'festival_key']
  ) THEN
    RAISE NOTICE 'timetable_slots already has a unique key on (festival_key, artist, day_index); skipping';
    RETURN;
  END IF;

  SELECT count(*) INTO dup_groups
  FROM (
    SELECT 1
    FROM public.timetable_slots
    GROUP BY festival_key, artist, day_index
    HAVING count(*) > 1
  ) d;

  IF dup_groups > 0 THEN
    RAISE EXCEPTION 'timetable_slots has % duplicate (festival_key, artist, day_index) groups; resolve them before applying 0009', dup_groups;
  END IF;

  ALTER TABLE public.timetable_slots
    ADD CONSTRAINT timetable_slots_festival_artist_day_uniq
    UNIQUE (festival_key, artist, day_index);
END $$;
