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

// ── DISCOVERED FESTIVALS: one-click ingest (festplan#30) ─────────────────────
//
// discover-festivals already returns the Ticketmaster event IDs of every
// festival it finds (one per festival day).  The admin festivals page lists
// the ones not yet in festival_meta and ingests them with one click through
// ingest-festival-timetable, which re-checks that the caller is the admin.

async function callEdgeFunction(name, body) {
  const headers = await getAuthHeaders()
  const res = await fetch(`${EDGE_FN_BASE}/${name}`, {
    method:  'POST',
    headers,
    body:    JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}

/**
 * Live Ticketmaster discovery for an artist list.  Unlike discoverFestivals()
 * in api.js this never falls back to stored data: the admin needs the
 * festivals that are NOT stored yet, so an error is shown, not hidden.
 *
 * @param {string[]} artists
 * @returns {Promise<Array>} discovered festivals ({ id, name, tmEventIds, ... })
 */
export async function discoverFestivalsLive(artists) {
  const { festivals } = await callEdgeFunction('discover-festivals', { artists })
  return festivals || []
}

/**
 * Discovered festivals that are not in festival_meta yet and can be ingested
 * (they carry at least one Ticketmaster event ID).
 *
 * @param {Array} discovered  festivals from discoverFestivalsLive()
 * @param {Array} festivals   festival_meta rows from listFestivals()
 * @returns {Array}
 */
export function notYetIngested(discovered, festivals) {
  const stored = new Set((festivals || []).map(f => f.festival_key))
  return (discovered || []).filter(f =>
    !stored.has(f.id) && Array.isArray(f.tmEventIds) && f.tmEventIds.length > 0
  )
}

/**
 * Request body for ingest-festival-timetable.  Always the multi-day shape so
 * festivalSlug pins the stored key to the discovered id (the two functions
 * slugify names differently), and every known day is ingested at once.
 *
 * @param {{ id: string, tmEventIds: string[] }} festival
 * @returns {{ eventIds: string[], festivalSlug: string }}
 */
export function ingestRequestBody(festival) {
  return { eventIds: [...festival.tmEventIds], festivalSlug: festival.id }
}

/**
 * Ingest a discovered festival's timetable from Ticketmaster.
 * @param {{ id: string, tmEventIds: string[] }} festival
 * @returns {Promise<Object>} the function's response ({ ok, festivalKey, ... })
 */
export async function ingestDiscoveredFestival(festival) {
  if (!festival?.tmEventIds?.length) {
    throw new Error('This festival has no Ticketmaster event ID to ingest')
  }
  return callEdgeFunction('ingest-festival-timetable', ingestRequestBody(festival))
}
