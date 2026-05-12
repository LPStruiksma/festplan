-- Migration 0007: make timetable_slots.start_time and end_time nullable
--
-- This allows the ingest-festival-timetable edge function to store
-- lineup-only data (artists without stage/time assignments) so that
-- SchedulePage can render a "lineup-only" view for festivals ingested
-- from Ticketmaster before the full timetable is published.

ALTER TABLE timetable_slots ALTER COLUMN start_time DROP NOT NULL;
ALTER TABLE timetable_slots ALTER COLUMN end_time   DROP NOT NULL;
