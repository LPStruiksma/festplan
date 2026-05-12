-- ─────────────────────────────────────────────────────────────────────────────
-- 0004_group_sync.sql
--
-- Enables real-time group sync between users who are connected via the invite
-- flow.  Two schema additions and four new RLS SELECT policies.
--
-- Schema additions:
--   group_invites.accepted_by  — records which user accepted each invite so we
--                                know who belongs to which group pair.
--   friends.source_user_id     — nullable FK to profiles; set when a friend
--                                entry was created via an accepted invite rather
--                                than manually typed.  Lets SchedulePage derive
--                                the list of real user IDs to subscribe to.
--
-- New RLS policies (bidirectional — both sides of an invite can read each
-- other's data):
--   artist_ratings             — readable if the row's user is your group partner
--   schedule_resolutions       — same
--
-- "Group partner" means: you accepted their invite, OR they accepted yours.
-- This is scoped to a specific festival_key in both cases.
--
-- Why bidirectional?
--   Without symmetry, only the joiner can read the inviter's data (because only
--   the inviter has a group_invites row).  By recording accepted_by we can also
--   let the inviter read the joiner's data.
-- ─────────────────────────────────────────────────────────────────────────────


-- ── 1. group_invites.accepted_by ─────────────────────────────────────────────
--
-- Set by JoinPage → acceptInvite() when someone uses the link.
-- NULL = not yet accepted or invite was created for a public share.

ALTER TABLE public.group_invites
  ADD COLUMN IF NOT EXISTS accepted_by UUID
    REFERENCES public.profiles (id)
    ON DELETE SET NULL;

COMMENT ON COLUMN public.group_invites.accepted_by IS
  'User who accepted this invite; NULL until accepted. Set by acceptInvite().';

CREATE INDEX IF NOT EXISTS idx_group_invites_accepted_by
  ON public.group_invites (accepted_by);


-- ── 2. friends.source_user_id ────────────────────────────────────────────────
--
-- Populated by acceptInvite() with the inviter's user ID so SchedulePage can
-- build the list of real user IDs to subscribe to in useGroupSync.
-- NULL for friends added manually via the "Add Friend" form.

ALTER TABLE public.friends
  ADD COLUMN IF NOT EXISTS source_user_id UUID
    REFERENCES public.profiles (id)
    ON DELETE SET NULL;

COMMENT ON COLUMN public.friends.source_user_id IS
  'auth.uid() of the real user this friend entry represents; NULL for manually added friends.';


-- ── 3. Bidirectional cross-read RLS on artist_ratings ────────────────────────
--
-- Allows a user to read another user's ratings when they are group partners
-- (connected via the invite flow for the same festival).
--
-- Two branches:
--   A. Row's user is the inviter → readable if auth.uid() accepted their invite
--   B. Row's user accepted YOUR invite → readable if you are the inviter
--
-- The existing "owner can read" policy already covers user_id = auth.uid().
-- These new permissive policies are OR'd with that existing policy.

CREATE POLICY "artist_ratings: readable by group partner (inviter side)"
  ON public.artist_ratings FOR SELECT
  USING (
    -- auth.uid() accepted an invite from this row's user
    EXISTS (
      SELECT 1
      FROM   public.group_invites gi
      WHERE  gi.inviter_user_id = artist_ratings.user_id
        AND  gi.accepted_by     = auth.uid()
        AND  gi.festival_key    = artist_ratings.festival_key
    )
  );

CREATE POLICY "artist_ratings: readable by group partner (joiner side)"
  ON public.artist_ratings FOR SELECT
  USING (
    -- auth.uid() created an invite that this row's user accepted
    EXISTS (
      SELECT 1
      FROM   public.group_invites gi
      WHERE  gi.inviter_user_id = auth.uid()
        AND  gi.accepted_by     = artist_ratings.user_id
        AND  gi.festival_key    = artist_ratings.festival_key
    )
  );


-- ── 4. Bidirectional cross-read RLS on schedule_resolutions ──────────────────

CREATE POLICY "schedule_resolutions: readable by group partner (inviter side)"
  ON public.schedule_resolutions FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM   public.group_invites gi
      WHERE  gi.inviter_user_id = schedule_resolutions.user_id
        AND  gi.accepted_by     = auth.uid()
        AND  gi.festival_key    = schedule_resolutions.festival_key
    )
  );

CREATE POLICY "schedule_resolutions: readable by group partner (joiner side)"
  ON public.schedule_resolutions FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM   public.group_invites gi
      WHERE  gi.inviter_user_id = auth.uid()
        AND  gi.accepted_by     = schedule_resolutions.user_id
        AND  gi.festival_key    = schedule_resolutions.festival_key
    )
  );
