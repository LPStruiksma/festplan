// src/lib/admin-api.js
//
// Frontend abstraction for admin CRUD operations on festival_meta and
// timetable_slots.
//
// Reads go directly to Supabase (tables are publicly SELECTable).
// Writes are routed through the admin-write edge function, which uses the
// service role key on the server and re-checks the caller is the admin.

import { supabase } from './supabase'

const EDGE_FN_BASE = import.meta.env.VITE_SUPABASE_URL + '/functions/v1'

// ── Auth helper ──────────────────────────────────────────────────────────────

async function getAuthHeaders() {
  const { data: { session } } = await supabase.auth.getSession()
  return {
    'Content-Type':  'application/json',
    'Authorization': `Bearer ${session?.access_token || ''}`,
    'apikey':        import.meta.env.VITE_SUPABASE_ANON_KEY,
  }
}

async function adminWrite(action, params) {
  const headers = await getAuthHeaders()
  const res = await fetch(`${EDGE_FN_BASE}/admin-write`, {
    method:  'POST',
    headers,
    body:    JSON.stringify({ action, ...params }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}

// ── READ operations (direct Supabase — public SELECT) ────────────────────────

/**
 * Fetch all festivals from festival_meta, ordered by name.
 * @returns {Promise<Array>} Array of festival_meta rows
 */
export async function listFestivals() {
  const { data, error } = await supabase
    .from('festival_meta')
    .select('festival_key, name, location, emoji, accent_color, days, stages, start_date, end_date, updated_at')
    .order('name')

  if (error) throw new Error(error.message)
  return data || []
}

/**
 * Fetch a single festival's metadata + all its timetable slots.
 * @param {string} festivalKey
 * @returns {Promise<{ meta: Object, slots: Array }>}
 */
export async function getFestivalWithSlots(festivalKey) {
  const [metaRes, slotsRes] = await Promise.all([
    supabase
      .from('festival_meta')
      .select('*')
      .eq('festival_key', festivalKey)
      .single(),
    supabase
      .from('timetable_slots')
      .select('*')
      .eq('festival_key', festivalKey)
      .order('day_index')
      .order('start_time', { nullsFirst: true }),
  ])

  if (metaRes.error) throw new Error(metaRes.error.message)

  return {
    meta:  metaRes.data,
    slots: slotsRes.data || [],
  }
}

// ── WRITE operations (routed through admin-write edge function) ───────────────

/**
 * Create or update a festival_meta row.
 * festival_key is used as the upsert key and cannot be changed after creation.
 *
 * @param {string} festivalKey
 * @param {Object} updates  Fields to set: name, location, emoji, accent_color,
 *                          days (string[]), stages (string[]), start_date, end_date
 * @returns {Promise<Object>} Updated festival row
 */
export async function updateFestivalMeta(festivalKey, updates) {
  const { festival } = await adminWrite('update_meta', { festivalKey, updates })
  return festival
}

/**
 * Insert a new slot or update an existing one.
 *
 * @param {Object} slot
 *   slot.id           — omit (or null) for a new row; include to update
 *   slot.festival_key — required
 *   slot.artist       — required
 *   slot.stage        — optional
 *   slot.day_index    — required (0-based)
 *   slot.start_time   — "HH:MM" or null
 *   slot.end_time     — "HH:MM" or null
 * @returns {Promise<Object>} Saved slot row (includes id)
 */
export async function upsertSlot(slot) {
  const { slot: saved } = await adminWrite('upsert_slot', { slot })
  return saved
}

/**
 * Delete a timetable_slots row by id.
 * @param {number} id  Primary key of the row to delete
 */
export async function deleteSlot(id) {
  await adminWrite('delete_slot', { id })
}
