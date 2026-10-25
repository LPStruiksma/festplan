-- Migration 0011: limit invite reads to the friend who accepted the invite
--
-- 0003 opened two cross-user reads while any non-expired invite exists:
--   "profiles: readable via active invite"      (whole rows, Spotify tokens included)
--   "user_artists: readable via active invite"  (that festival's artist list)
-- Neither checked who was reading, and "group_invites: public select" let
-- anyone with the public anon key list every invite, slugs included. So any
-- active inviter's festival list and profile were readable by anyone.
--
-- 0011 ties those reads to the invite's accepted_by, the way 0004 already
-- does for artist_ratings and schedule_resolutions:
--   • group_invites is readable only by its inviter and its acceptor;
--   • get_invite(slug) looks up one non-expired invite by its slug for a
--     signed-in user (the slug stays the secret, but invites can no longer
--     be listed). An invite someone else accepted is not returned;
--   • accept_invite(slug) records auth.uid() as accepted_by. Invites are one
--     friend per link: it succeeds only while accepted_by is empty or already
--     the caller. There was no UPDATE policy on group_invites, so the app's
--     direct update of accepted_by never saved; this function replaces it;
--   • get_invite also returns the inviter's display name, so no other user
--     needs to read profiles at all: profiles rows hold the Spotify access
--     and refresh tokens (0005), and RLS can't hide columns. Profiles go
--     back to owner-only;
--   • that festival's user_artists rows are readable by the user who
--     accepted, and by nobody else.
--
-- The app must call the two functions (src/lib/invites.js); deploy the app
-- change together with this migration.
--
-- Idempotent: re-running replaces the same functions and policies.
-- Numbered 0011 because 0010 is taken by the schedule_resolutions pair-order
-- migration.

-- ── group_invites: no more listing ──────────────────────────────────────────

DROP POLICY IF EXISTS "group_invites: public select"               ON public.group_invites;
DROP POLICY IF EXISTS "group_invites: inviter or acceptor can read" ON public.group_invites;

CREATE POLICY "group_invites: inviter or acceptor can read"
  ON public.group_invites FOR SELECT
  USING (inviter_user_id = auth.uid() OR accepted_by = auth.uid());

-- ── get_invite(slug) ────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.get_invite(uuid);

CREATE FUNCTION public.get_invite(p_slug uuid)
RETURNS TABLE (slug uuid, festival_key text, inviter_user_id uuid, expires_at timestamptz,
               inviter_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT gi.slug, gi.festival_key, gi.inviter_user_id, gi.expires_at, p.display_name
  FROM   public.group_invites gi
  LEFT JOIN public.profiles p ON p.id = gi.inviter_user_id
  WHERE  auth.uid() IS NOT NULL
    AND  gi.slug       = p_slug
    AND  gi.expires_at > now()
    AND  (gi.accepted_by IS NULL
          OR gi.accepted_by     = auth.uid()
          OR gi.inviter_user_id = auth.uid())
$$;

COMMENT ON FUNCTION public.get_invite(uuid) IS
  'Look up one non-expired invite by slug for the signed-in user, with the inviter''s display name only; hides invites another user accepted.';

-- ── accept_invite(slug) ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.accept_invite(p_slug uuid)
RETURNS text
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE public.group_invites gi
  SET    accepted_by = auth.uid()
  WHERE  auth.uid() IS NOT NULL
    AND  gi.slug             = p_slug
    AND  gi.expires_at       > now()
    AND  gi.inviter_user_id <> auth.uid()
    AND  (gi.accepted_by IS NULL OR gi.accepted_by = auth.uid())
  RETURNING gi.festival_key
$$;

COMMENT ON FUNCTION public.accept_invite(uuid) IS
  'Record the signed-in user as the acceptor of a non-expired invite. Returns its festival_key, or NULL when the invite is missing, expired, the caller''s own, or accepted by someone else.';

REVOKE ALL ON FUNCTION public.get_invite(uuid)    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.accept_invite(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_invite(uuid)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_invite(uuid) TO authenticated;

-- ── profiles: owner-only again (rows carry Spotify tokens) ──────────────────

DROP POLICY IF EXISTS "profiles: readable via active invite"   ON public.profiles;
DROP POLICY IF EXISTS "profiles: readable by invite acceptor"  ON public.profiles;

-- ── user_artists: that festival's list, for the friend who accepted ─────────

DROP POLICY IF EXISTS "user_artists: readable via active invite"  ON public.user_artists;
DROP POLICY IF EXISTS "user_artists: readable by invite acceptor" ON public.user_artists;

CREATE POLICY "user_artists: readable by invite acceptor"
  ON public.user_artists FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM   public.group_invites gi
      WHERE  gi.inviter_user_id = user_artists.user_id
        AND  gi.accepted_by     = auth.uid()
        AND  gi.festival_key    = user_artists.festival_key
    )
  );
