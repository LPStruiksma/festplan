-- ─────────────────────────────────────────────────────────────────────────────
-- 0003_group_invites.sql
--
-- Adds the invite-link flow that lets a user share their festival plan
-- with a friend via a short, unguessable URL:
--
--   https://festplan.app/join/<slug>
--
-- Tables:
--   group_invites  — one row per invite link; slug is a UUID used as the
--                    URL token (128-bit random = practically unguessable).
--                    Expires after 7 days by default.
--
-- Cross-user reads via invite:
--   When a joiner accepts an invite they need to read the inviter's display
--   name (profiles) and artist list (user_artists) so the inviter can appear
--   in the joiner's Group tab.  Two new SELECT policies open those reads only
--   while a non-expired invite exists for the inviter — this is equivalent to
--   the inviter consenting to share by generating the link.
--
-- Access model:
--   • group_invites: public SELECT (slug is the secret), inviter INSERT + DELETE
--   • profiles, user_artists: existing owner policies unchanged; new "via invite"
--     policies add a read path for invite-linked data only.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── group_invites ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.group_invites (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Which festival this invite is for.
  -- Intentionally *not* a FK to festival_meta: hardcoded festivals
  -- (lowlands, coachella-2026, …) are not in that table.
  festival_key    TEXT        NOT NULL CHECK (char_length(trim(festival_key)) > 0),
  -- The user who created the invite.
  inviter_user_id UUID        NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  -- The unguessable URL token shared with the friend.
  slug            UUID        NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 7-day expiry; bump with an UPDATE if you want a longer window.
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT now() + interval '7 days'
);

COMMENT ON TABLE  public.group_invites                 IS 'One-time-use invite links for the group planning feature.';
COMMENT ON COLUMN public.group_invites.slug            IS 'UUID URL token — shared in https://festplan.app/join/<slug>. Unguessable.';
COMMENT ON COLUMN public.group_invites.festival_key    IS 'Festival the inviter was planning when they created the link.';
COMMENT ON COLUMN public.group_invites.expires_at      IS 'Invites expire after 7 days; JoinPage rejects expired slugs.';

-- Fast lookup by slug (the primary access pattern in JoinPage)
CREATE INDEX IF NOT EXISTS idx_group_invites_slug
  ON public.group_invites (slug);

-- Useful for listing/deleting a user's own invites
CREATE INDEX IF NOT EXISTS idx_group_invites_inviter
  ON public.group_invites (inviter_user_id);

ALTER TABLE public.group_invites ENABLE ROW LEVEL SECURITY;

-- Anyone can read invites — the slug acts as the secret.
-- Without the slug (a 128-bit random UUID) a row is practically unreachable.
CREATE POLICY "group_invites: public select"
  ON public.group_invites FOR SELECT
  USING (true);

-- Only the inviter can create their own invites.
CREATE POLICY "group_invites: inviter can insert"
  ON public.group_invites FOR INSERT
  WITH CHECK (inviter_user_id = auth.uid());

-- Only the inviter can remove their own invites.
CREATE POLICY "group_invites: inviter can delete"
  ON public.group_invites FOR DELETE
  USING (inviter_user_id = auth.uid());


-- ── Cross-user reads via invite ───────────────────────────────────────────────
--
-- When a joiner loads JoinPage they need to:
--   1. Read the inviter's display_name from profiles.
--   2. Read the inviter's artist list from user_artists (for that festival).
--
-- These two new permissive SELECT policies allow those reads while a valid
-- (non-expired) invite exists for the inviter.  Existing owner-scoped policies
-- are unchanged; Postgres ORs all permissive policies together.

-- profiles: readable via a non-expired invite
--
-- Condition: the row being tested (profiles.id) is the inviter_user_id of at
-- least one non-expired group_invites row.  No auth.uid() check — anyone who
-- can query Supabase with a valid slug can look up the inviter's name.
-- (They can't enumerate profiles without knowing a slug because the existing
-- owner policy only lets users read their own row; this policy adds an
-- invite-gated path.)
CREATE POLICY "profiles: readable via active invite"
  ON public.profiles FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM   public.group_invites gi
      WHERE  gi.inviter_user_id = profiles.id
        AND  gi.expires_at > now()
    )
  );

-- user_artists: readable via a non-expired invite scoped to the same festival
--
-- Condition: the row's (user_id, festival_key) pair matches a non-expired
-- invite.  This prevents reading an inviter's artists across *all* festivals —
-- only the festival they actively invited for is exposed.
CREATE POLICY "user_artists: readable via active invite"
  ON public.user_artists FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM   public.group_invites gi
      WHERE  gi.inviter_user_id = user_artists.user_id
        AND  gi.festival_key    = user_artists.festival_key
        AND  gi.expires_at      > now()
    )
  );
