#!/usr/bin/env node
/**
 * scripts/seed-festival.mjs
 *
 * Seed one festival's metadata and timetable slots into Supabase.
 * Idempotent: safe to run multiple times — festival_meta is upserted and
 * timetable_slots are fully replaced (delete + insert) on each run.
 *
 * Usage
 * ──────
 *   node --env-file=.env scripts/seed-festival.mjs <path-to-json>
 *
 * Example
 * ───────
 *   node --env-file=.env scripts/seed-festival.mjs scripts/festivals/glastonbury-2025.json
 *
 * Required env vars (.env)
 * ────────────────────────
 *   SUPABASE_URL              – your Supabase project URL (no trailing slash)
 *   SUPABASE_SERVICE_ROLE_KEY – service role key (bypasses Row Level Security)
 *
 * JSON input shape  (same as a single entry in src/lib/festivals.js)
 * ──────────────────
 *   {
 *     "id":        "glastonbury-2025",
 *     "name":      "Glastonbury 2025",
 *     "location":  "Pilton, Somerset, UK",
 *     "emoji":     "🎸",
 *     "accentColor": "#82d96e",          // optional
 *     "days":    ["Thu Jun 26", "Fri Jun 27", "Sat Jun 28", "Sun Jun 29"],
 *     "stages":  ["Pyramid Stage", "Other Stage", "West Holts", "Park Stage"],
 *     "lineup":  [
 *       { "artist": "Olivia Rodrigo", "stage": "Pyramid Stage",
 *         "day": 3, "start": "21:30", "end": "23:00" },
 *       ...
 *     ]
 *   }
 *
 * Pre-requisites
 * ──────────────
 *   Run supabase/migrations/0002_festival_tables.sql in your Supabase
 *   SQL Editor before seeding for the first time.
 */

import { readFileSync } from 'node:fs'
import { resolve }      from 'node:path'
import { createClient } from '@supabase/supabase-js'

// ── 1. Validate environment ───────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL?.replace(/\/$/, '')  // strip trailing /
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('\n❌  Missing env vars.')
  console.error('    Add the following to your .env file:')
  console.error('      SUPABASE_URL=https://<project-ref>.supabase.co')
  console.error('      SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>\n')
  process.exit(1)
}

// ── 2. Load & validate JSON ───────────────────────────────────────────────────

const jsonPath = process.argv[2]
if (!jsonPath) {
  console.error('\n❌  No JSON file specified.')
  console.error('    Usage: node --env-file=.env scripts/seed-festival.mjs <path-to-json>\n')
  process.exit(1)
}

let festival
try {
  festival = JSON.parse(readFileSync(resolve(jsonPath), 'utf8'))
} catch (err) {
  console.error(`\n❌  Could not read JSON at "${jsonPath}": ${err.message}\n`)
  process.exit(1)
}

// Check required top-level fields
const REQUIRED = ['id', 'name', 'location', 'days', 'stages', 'lineup']
const missing  = REQUIRED.filter(k => !(k in festival))
if (missing.length) {
  console.error(`\n❌  JSON is missing required field(s): ${missing.join(', ')}\n`)
  process.exit(1)
}

if (!Array.isArray(festival.lineup) || festival.lineup.length === 0) {
  console.error('\n❌  "lineup" must be a non-empty array\n')
  process.exit(1)
}

// Validate lineup entries
const SLOT_FIELDS = ['artist', 'day', 'start', 'end']
const badSlots = festival.lineup
  .map((s, i) => ({ i, missing: SLOT_FIELDS.filter(f => !(f in s)) }))
  .filter(x => x.missing.length > 0)

if (badSlots.length > 0) {
  for (const { i, missing: m } of badSlots.slice(0, 3)) {
    console.error(`❌  lineup[${i}] is missing: ${m.join(', ')}`)
  }
  if (badSlots.length > 3) console.error(`    … and ${badSlots.length - 3} more`)
  process.exit(1)
}

// ── 3. Initialise Supabase (service role — bypasses RLS) ─────────────────────

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
})

// ── 4. Seed ───────────────────────────────────────────────────────────────────

const festKey = festival.id

console.log(`\n🎪  Seeding: ${festival.name}`)
console.log(`    festival_key : ${festKey}`)
console.log(`    days         : ${festival.days.length} (${festival.days.join(', ')})`)
console.log(`    stages       : ${festival.stages.length}`)
console.log(`    lineup slots : ${festival.lineup.length}\n`)

// ── 4a. Upsert festival_meta ─────────────────────────────────────────────────

const metaRow = {
  festival_key:  festKey,
  name:          festival.name,
  location:      festival.location,
  emoji:         festival.emoji        ?? '🎵',
  accent_color:  festival.accentColor  ?? null,
  days:          festival.days,
  stages:        festival.stages,
  updated_at:    new Date().toISOString(),
}

const { error: metaErr } = await supabase
  .from('festival_meta')
  .upsert(metaRow, { onConflict: 'festival_key' })

if (metaErr) {
  console.error('❌  festival_meta upsert failed:', metaErr.message)
  process.exit(1)
}

console.log('✅  festival_meta  — upserted 1 row')

// ── 4b. Replace timetable_slots (delete-then-insert for clean bulk replace) ───
//
// Upsert-on-conflict would require a composite unique key across
// (festival_key, artist, day_index, start_time) which is cumbersome and still
// doesn't handle removed slots cleanly. Delete + re-insert is idempotent and
// keeps the table tidy on every run.

const { error: delErr } = await supabase
  .from('timetable_slots')
  .delete()
  .eq('festival_key', festKey)

if (delErr) {
  console.error('❌  timetable_slots delete failed:', delErr.message)
  process.exit(1)
}

const rows = festival.lineup.map(s => ({
  festival_key: festKey,
  artist:       s.artist,
  stage:        s.stage     ?? null,
  day_index:    s.day,
  start_time:   s.start,
  end_time:     s.end,
}))

// Insert in batches of 200 to stay well within Supabase's payload limits.
const BATCH_SIZE = 200
let inserted = 0

for (let i = 0; i < rows.length; i += BATCH_SIZE) {
  const batch = rows.slice(i, i + BATCH_SIZE)
  const { error: insErr } = await supabase.from('timetable_slots').insert(batch)
  if (insErr) {
    console.error(`\n❌  timetable_slots insert (batch ${Math.floor(i / BATCH_SIZE) + 1}) failed:`, insErr.message)
    process.exit(1)
  }
  inserted += batch.length
  process.stdout.write(`\r    Inserting… ${inserted} / ${rows.length} slots`)
}

console.log(`\n✅  timetable_slots — replaced with ${inserted} rows`)
console.log(`\n🎉  Done — "${festival.name}" is live in Supabase.\n`)
