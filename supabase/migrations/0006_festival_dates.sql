-- Migration: Add start_date and end_date to festival_meta
-- These replace the fragile regex-year hack in the iCal generator.
-- Both columns are nullable so existing live-discovered rows stay valid.

ALTER TABLE festival_meta
  ADD COLUMN IF NOT EXISTS start_date date,
  ADD COLUMN IF NOT EXISTS end_date   date;

-- Index makes range queries (e.g. upcoming festivals) fast.
CREATE INDEX IF NOT EXISTS festival_meta_start_date_idx ON festival_meta (start_date);
