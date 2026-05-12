// supabase/functions/admin-write/index.ts
//
// Admin-only edge function for mutating festival_meta and timetable_slots.
// Uses the service role key so it can bypass RLS on tables that are
// intentionally read-only for regular users.
//
// All actions are gated on the caller's JWT email matching ADMIN_EMAIL.
//
// Actions (passed as { action, ...params } in the request body):
//
//   update_meta  { festivalKey, updates }
//     Upserts a festival_meta row.  festival_key is immutable after creation.
//
//   upsert_slot  { slot }
//     slot = { id?, festival_key, artist, stage, day_index, start_time, end_time }
//     If id is present, updates that row.  Otherwise inserts a new row.
//
//   delete_slot  { id }
//     Deletes a timetable_slots row by primary key.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, jsonResponse } from '../_shared/cors.ts'

// ── Auth helpers ─────────────────────────────────────────────────────────────

const ADMIN_EMAIL = Deno.env.get('ADMIN_EMAIL') || ''

function getServiceClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )
}

function getAnonClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!
  )
}

async function requireAdmin(req: Request): Promise<string | null> {
  if (!ADMIN_EMAIL) return 'ADMIN_EMAIL not configured'

  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
  if (!jwt) return 'Unauthorized'

  const { data: { user }, error } = await getAnonClient().auth.getUser(jwt)
  if (error || !user) return 'Unauthorized'
  if (user.email !== ADMIN_EMAIL) return 'Forbidden — admin only'

  return null // no error = access granted
}

// ── Action handlers ──────────────────────────────────────────────────────────

async function handleUpdateMeta(
  sb: ReturnType<typeof getServiceClient>,
  params: Record<string, unknown>
) {
  const { festivalKey, updates } = params as {
    festivalKey: string
    updates: Record<string, unknown>
  }

  if (!festivalKey) return jsonResponse({ error: 'festivalKey required' }, 400)
  if (!updates || typeof updates !== 'object') {
    return jsonResponse({ error: 'updates object required' }, 400)
  }

  // Prevent festival_key from being changed once set
  const safeUpdates = { ...updates }
  delete safeUpdates.festival_key
  delete safeUpdates.created_at

  safeUpdates.updated_at = new Date().toISOString()

  const { data, error } = await sb
    .from('festival_meta')
    .upsert(
      { festival_key: festivalKey, ...safeUpdates },
      { onConflict: 'festival_key' }
    )
    .select()
    .single()

  if (error) return jsonResponse({ error: error.message }, 500)
  return jsonResponse({ ok: true, festival: data })
}

async function handleUpsertSlot(
  sb: ReturnType<typeof getServiceClient>,
  params: Record<string, unknown>
) {
  const { slot } = params as { slot: Record<string, unknown> }
  if (!slot || typeof slot !== 'object') {
    return jsonResponse({ error: 'slot object required' }, 400)
  }

  const { id, festival_key, artist, stage, day_index, start_time, end_time } =
    slot as {
      id?: number
      festival_key: string
      artist: string
      stage?: string | null
      day_index: number
      start_time?: string | null
      end_time?: string | null
    }

  if (!festival_key || !artist || day_index == null) {
    return jsonResponse({ error: 'festival_key, artist, and day_index are required' }, 400)
  }

  let data, error

  if (id != null) {
    // Update existing row
    ;({ data, error } = await sb
      .from('timetable_slots')
      .update({ artist, stage: stage ?? null, day_index, start_time: start_time ?? null, end_time: end_time ?? null })
      .eq('id', id)
      .select()
      .single())
  } else {
    // Insert new row
    ;({ data, error } = await sb
      .from('timetable_slots')
      .insert({ festival_key, artist, stage: stage ?? null, day_index, start_time: start_time ?? null, end_time: end_time ?? null })
      .select()
      .single())
  }

  if (error) return jsonResponse({ error: error.message }, 500)
  return jsonResponse({ ok: true, slot: data })
}

async function handleDeleteSlot(
  sb: ReturnType<typeof getServiceClient>,
  params: Record<string, unknown>
) {
  const { id } = params as { id: number }
  if (!id) return jsonResponse({ error: 'id required' }, 400)

  const { error } = await sb.from('timetable_slots').delete().eq('id', id)
  if (error) return jsonResponse({ error: error.message }, 500)
  return jsonResponse({ ok: true })
}

// ── Main handler ─────────────────────────────────────────────────────────────

serve(async (req) => {
  const corsRes = handleCors(req)
  if (corsRes) return corsRes

  const authErr = await requireAdmin(req)
  if (authErr) {
    const status = authErr === 'Forbidden — admin only' ? 403 : 401
    return jsonResponse({ error: authErr }, status)
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Request body must be valid JSON' }, 400)
  }

  const { action, ...params } = body
  const sb = getServiceClient()

  switch (action) {
    case 'update_meta':  return handleUpdateMeta(sb, params)
    case 'upsert_slot':  return handleUpsertSlot(sb, params)
    case 'delete_slot':  return handleDeleteSlot(sb, params)
    default:
      return jsonResponse({ error: `Unknown action: ${action}` }, 400)
  }
})
