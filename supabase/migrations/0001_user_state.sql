-- =============================================================================
-- Migration : 0001_user_state
-- Purpose   : Move all user state from localStorage to Supabase.
--             Creates the six core tables, RLS policies scoped to the owning
--             user, a trigger that auto-creates a profile on Spotify sign-up,
--             and indexes to support the frontend access patterns.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0.  Extensions (idempotent; Supabase enables these by default on every
--     project, but we declare them here for completeness / local dev parity)
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()


-- =============================================================================
-- 1.  TABLE: profiles
--     One row per authenticated user.  Populated automatically by the trigger
--     below; the frontend can update display_name / avatar_url after login.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.profiles (
    id              UUID        PRIMARY KEY
                                REFERENCES auth.users (id) ON DELETE CASCADE,
    display_name    TEXT,
    avatar_url      TEXT,
    spotify_id      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.profiles                IS 'One profile per auth user; created automatically on first sign-in.';
COMMENT ON COLUMN public.profiles.spotify_id     IS 'Spotify user ID taken from the OAuth identity at sign-up time.';

-- Keep updated_at current automatically
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_profiles_updated_at
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- =============================================================================
-- 2.  TABLE: user_artists
--     The ordered list of artists a user is planning with for a given session.
--     Maps to the `myArtists` state array in SetupPage / SchedulePage.
--     festival_key can be NULL to represent the user's global artist list
--     (i.e. before they have committed to a specific festival).
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.user_artists (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID        NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
    festival_key    TEXT,                            -- NULL = "pre-festival" list
    artist_name     TEXT        NOT NULL CHECK (char_length(trim(artist_name)) > 0),
    position        INTEGER     NOT NULL DEFAULT 0,  -- preserves display order
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (user_id, festival_key, artist_name)
);

COMMENT ON TABLE  public.user_artists               IS 'Ordered artist list the user brought to a festival; mirrors myArtists[] state.';
COMMENT ON COLUMN public.user_artists.festival_key  IS 'Matches FESTIVALS key (e.g. "lowlands"). NULL = global list, not yet tied to a festival.';
COMMENT ON COLUMN public.user_artists.position      IS 'Zero-based insertion order; use ORDER BY position ASC when reading.';

CREATE INDEX IF NOT EXISTS idx_user_artists_user_festival
    ON public.user_artists (user_id, festival_key);


-- =============================================================================
-- 3.  TABLE: user_schedules
--     One row per (user, festival): records which festival a user has chosen
--     so the app can restore the selection on next visit.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.user_schedules (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID        NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
    festival_key    TEXT        NOT NULL CHECK (char_length(trim(festival_key)) > 0),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (user_id, festival_key)
);

COMMENT ON TABLE  public.user_schedules              IS 'Tracks which festival(s) a user has an active plan for.';
COMMENT ON COLUMN public.user_schedules.festival_key IS 'Matches hardcoded FESTIVALS key or a Ticketmaster-discovered festival identifier.';

CREATE TRIGGER trg_user_schedules_updated_at
    BEFORE UPDATE ON public.user_schedules
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_user_schedules_user
    ON public.user_schedules (user_id);


-- =============================================================================
-- 4.  TABLE: schedule_resolutions
--     Records the user's choice when two of their artists overlap on the
--     timetable.  The frontend key is:
--         [artist_a, artist_b].sort().join('|||')
--     We store the two artists as separate columns (artist_a < artist_b
--     alphabetically), matching that sort, so the pair is always canonical.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.schedule_resolutions (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID        NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
    festival_key    TEXT        NOT NULL CHECK (char_length(trim(festival_key)) > 0),
    -- The two conflicting artists, always stored alphabetically (mirrors JS sort)
    artist_a        TEXT        NOT NULL CHECK (char_length(trim(artist_a)) > 0),
    artist_b        TEXT        NOT NULL CHECK (char_length(trim(artist_b)) > 0),
    -- The artist the user chose to attend
    chosen_artist   TEXT        NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (user_id, festival_key, artist_a, artist_b),

    -- Enforce canonical ordering (mirrors the JS .sort() on the key)
    CONSTRAINT chk_artist_order   CHECK (artist_a < artist_b),
    -- chosen_artist must be one of the two sides
    CONSTRAINT chk_valid_choice   CHECK (chosen_artist = artist_a OR chosen_artist = artist_b)
);

COMMENT ON TABLE  public.schedule_resolutions                IS 'Records which artist the user chose when two overlap. Mirrors resolved{} state.';
COMMENT ON COLUMN public.schedule_resolutions.artist_a       IS 'Alphabetically first artist (JS: [a,b].sort()[0]).';
COMMENT ON COLUMN public.schedule_resolutions.artist_b       IS 'Alphabetically second artist (JS: [a,b].sort()[1]).';
COMMENT ON COLUMN public.schedule_resolutions.chosen_artist  IS 'The artist the user will attend; must equal artist_a or artist_b.';

CREATE TRIGGER trg_schedule_resolutions_updated_at
    BEFORE UPDATE ON public.schedule_resolutions
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_schedule_resolutions_user_festival
    ON public.schedule_resolutions (user_id, festival_key);


-- =============================================================================
-- 5.  TABLE: artist_ratings
--     Star ratings (1–5) per artist per festival.  Mirrors the ratings{}
--     object in SchedulePage: { [artistName]: starCount }.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.artist_ratings (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID        NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
    festival_key    TEXT        NOT NULL CHECK (char_length(trim(festival_key)) > 0),
    artist_name     TEXT        NOT NULL CHECK (char_length(trim(artist_name)) > 0),
    rating          SMALLINT    NOT NULL CHECK (rating BETWEEN 1 AND 5),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (user_id, festival_key, artist_name)
);

COMMENT ON TABLE  public.artist_ratings              IS '1–5 star ratings per artist per festival. Mirrors ratings{} state in SchedulePage.';
COMMENT ON COLUMN public.artist_ratings.festival_key IS 'Festival context for the rating (same artist at different festivals can have different ratings).';
COMMENT ON COLUMN public.artist_ratings.rating       IS 'Integer 1–5; matches the five-star UI in ListView.';

CREATE TRIGGER trg_artist_ratings_updated_at
    BEFORE UPDATE ON public.artist_ratings
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_artist_ratings_user_festival
    ON public.artist_ratings (user_id, festival_key);


-- =============================================================================
-- 6.  TABLE: friends
--     Manually-added friends in the group/tab view.  Each friend has a display
--     name and an array of artist names (entered comma-separated in the UI).
--     Up to 3 friends per user per festival (enforced in the frontend; we add
--     no DB cap so a future lift-to-4 doesn't need a migration).
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.friends (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID        NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
    festival_key    TEXT        NOT NULL CHECK (char_length(trim(festival_key)) > 0),
    name            TEXT        NOT NULL CHECK (char_length(trim(name)) > 0),
    artists         TEXT[]      NOT NULL DEFAULT '{}',
    position        INTEGER     NOT NULL DEFAULT 0,  -- preserves insertion order
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.friends               IS 'Friends manually added to the group schedule view. Mirrors friends[] state in SchedulePage.';
COMMENT ON COLUMN public.friends.artists       IS 'Array of artist name strings as typed by the user (comma-split in UI).';
COMMENT ON COLUMN public.friends.position      IS 'Zero-based insertion order (up to 3 friends per the frontend cap).';

CREATE TRIGGER trg_friends_updated_at
    BEFORE UPDATE ON public.friends
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_friends_user_festival
    ON public.friends (user_id, festival_key);


-- =============================================================================
-- 7.  ROW LEVEL SECURITY
--     Every table is scoped to the owning user via auth.uid().
--     All policies follow the same pattern: SELECT / INSERT / UPDATE / DELETE
--     are each limited to rows where user_id = auth.uid().
-- =============================================================================

-- ── 7a. profiles ─────────────────────────────────────────────────────────────
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles: owner can read own row"
    ON public.profiles FOR SELECT
    USING (id = auth.uid());

CREATE POLICY "profiles: owner can update own row"
    ON public.profiles FOR UPDATE
    USING (id = auth.uid())
    WITH CHECK (id = auth.uid());

-- INSERT is handled exclusively by the trigger; no direct INSERT policy
-- needed for normal app usage (service_role bypasses RLS for the trigger).


-- ── 7b. user_artists ─────────────────────────────────────────────────────────
ALTER TABLE public.user_artists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_artists: owner can read"
    ON public.user_artists FOR SELECT
    USING (user_id = auth.uid());

CREATE POLICY "user_artists: owner can insert"
    ON public.user_artists FOR INSERT
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "user_artists: owner can update"
    ON public.user_artists FOR UPDATE
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "user_artists: owner can delete"
    ON public.user_artists FOR DELETE
    USING (user_id = auth.uid());


-- ── 7c. user_schedules ───────────────────────────────────────────────────────
ALTER TABLE public.user_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_schedules: owner can read"
    ON public.user_schedules FOR SELECT
    USING (user_id = auth.uid());

CREATE POLICY "user_schedules: owner can insert"
    ON public.user_schedules FOR INSERT
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "user_schedules: owner can update"
    ON public.user_schedules FOR UPDATE
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "user_schedules: owner can delete"
    ON public.user_schedules FOR DELETE
    USING (user_id = auth.uid());


-- ── 7d. schedule_resolutions ─────────────────────────────────────────────────
ALTER TABLE public.schedule_resolutions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "schedule_resolutions: owner can read"
    ON public.schedule_resolutions FOR SELECT
    USING (user_id = auth.uid());

CREATE POLICY "schedule_resolutions: owner can insert"
    ON public.schedule_resolutions FOR INSERT
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "schedule_resolutions: owner can update"
    ON public.schedule_resolutions FOR UPDATE
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "schedule_resolutions: owner can delete"
    ON public.schedule_resolutions FOR DELETE
    USING (user_id = auth.uid());


-- ── 7e. artist_ratings ───────────────────────────────────────────────────────
ALTER TABLE public.artist_ratings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "artist_ratings: owner can read"
    ON public.artist_ratings FOR SELECT
    USING (user_id = auth.uid());

CREATE POLICY "artist_ratings: owner can insert"
    ON public.artist_ratings FOR INSERT
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "artist_ratings: owner can update"
    ON public.artist_ratings FOR UPDATE
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "artist_ratings: owner can delete"
    ON public.artist_ratings FOR DELETE
    USING (user_id = auth.uid());


-- ── 7f. friends ──────────────────────────────────────────────────────────────
ALTER TABLE public.friends ENABLE ROW LEVEL SECURITY;

CREATE POLICY "friends: owner can read"
    ON public.friends FOR SELECT
    USING (user_id = auth.uid());

CREATE POLICY "friends: owner can insert"
    ON public.friends FOR INSERT
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "friends: owner can update"
    ON public.friends FOR UPDATE
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "friends: owner can delete"
    ON public.friends FOR DELETE
    USING (user_id = auth.uid());


-- =============================================================================
-- 8.  TRIGGER: auto-create profile on auth.users INSERT
--     Fires when Supabase Auth completes the Spotify OAuth flow and inserts a
--     new row into auth.users.  Extracts display_name, avatar_url, and
--     spotify_id from the raw_user_meta_data JSON blob that Supabase populates
--     from the Spotify identity provider.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO public.profiles (id, display_name, avatar_url, spotify_id)
    VALUES (
        NEW.id,
        -- Spotify sends full_name or name in user_metadata
        COALESCE(
            NEW.raw_user_meta_data ->> 'full_name',
            NEW.raw_user_meta_data ->> 'name'
        ),
        -- Spotify sends avatar_url or picture
        COALESCE(
            NEW.raw_user_meta_data ->> 'avatar_url',
            NEW.raw_user_meta_data ->> 'picture'
        ),
        -- Spotify sends provider_id as their user ID (e.g. "spotify:abc123")
        -- or sub for OAuth2; normalise by stripping any "spotify:" prefix
        regexp_replace(
            COALESCE(
                NEW.raw_user_meta_data ->> 'provider_id',
                NEW.raw_user_meta_data ->> 'sub',
                ''
            ),
            '^spotify:', ''
        )
    )
    ON CONFLICT (id) DO NOTHING;   -- idempotent: re-sign-in won't error
    RETURN NEW;
END;
$$;

-- Attach to auth.users (runs as postgres / service_role, bypasses RLS)
CREATE OR REPLACE TRIGGER trg_on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
