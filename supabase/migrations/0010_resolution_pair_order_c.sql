-- Migration 0010: order schedule_resolutions pairs the way the app does
--
-- The app keys a clash as [a, b].sort().join('|||') and saves the two halves
-- as artist_a / artist_b. JS .sort() compares UTF-16 code units, so uppercase
-- sorts before lowercase ('Bicep' < 'aphex twin'). chk_artist_order from 0001
-- compared with the database's default collation instead. Under a linguistic
-- collation such as en_US that order differs, the upsert fails the CHECK, and
-- the pick is queued and retried forever without ever saving.
--
-- COLLATE "C" compares bytes, which for UTF-8 is code point order. That equals
-- JS code-unit order for every name made of characters below U+10000 (Latin,
-- accents, CJK, ...). It can differ only when one name has an emoji or other
-- supplementary character where the other has a character in U+E000-U+FFFF.
--
-- Idempotent: re-running drops and re-adds the same rule. If any saved row
-- would break the new rule, it stops without changing anything (it never
-- rewrites or deletes rows), so a person decides what to do with them.

DO $$
DECLARE
  bad_rows bigint;
BEGIN
  SELECT count(*) INTO bad_rows
  FROM public.schedule_resolutions
  WHERE NOT (artist_a COLLATE "C" < artist_b COLLATE "C");

  IF bad_rows > 0 THEN
    RAISE EXCEPTION 'schedule_resolutions has % row(s) whose artist_a/artist_b are not in byte order; resolve them before applying 0010', bad_rows;
  END IF;

  ALTER TABLE public.schedule_resolutions
    DROP CONSTRAINT IF EXISTS chk_artist_order;
  ALTER TABLE public.schedule_resolutions
    ADD CONSTRAINT chk_artist_order CHECK (artist_a COLLATE "C" < artist_b COLLATE "C");
END $$;

COMMENT ON COLUMN public.schedule_resolutions.artist_a IS 'First artist in byte order, COLLATE "C" (JS: [a,b].sort()[0]).';
COMMENT ON COLUMN public.schedule_resolutions.artist_b IS 'Second artist in byte order, COLLATE "C" (JS: [a,b].sort()[1]).';
