#!/usr/bin/env node
/**
 * scripts/cleanup-junk-festivals.mjs
 *
 * Find and remove junk festival_meta rows that were created by accidental
 * Ticketmaster ingestion: tour stops, date-prefixed slugs, and other
 * non-festival events that slipped through the discovery filter.
 *
 * What counts as "junk":
 *   • start_date is NULL (ingest produced no usable date from Ticketmaster)
 *   • festival_key starts with a digit — date-prefixed slug
 *     e.g. "2-july-5-july-rock-werchter"
 *   • festival_key contains the word "tour"
 *     e.g. "muse-the-wow-signal-tour"
 *
 * Usage
 * ──────
 *   node --env-file=.env scripts/cleanup-junk-festivals.mjs
 *
 * Required env vars (.env)
 * ────────────────────────
 *   SUPABASE_URL              – your Supabase project URL (no trailing slash)
 *   SUPABASE_SERVICE_ROLE_KEY – service role key (bypasses Row Level Security)
 *
 * The script prints every flagged festival and asks for confirmation before
 * deleting anything.  Deletion order:
 *   1. artist_ratings  (per-festival ratings)
 *   2. user_schedules  (no FK cascade to festival_meta — must be explicit)
 *   3. timetable_slots (FK cascade would cover this, but we're explicit)
 *   4. festival_meta   (the root row)
 */

import { createClient }  from '@supabase/supabase-js'
import { createInterface } from 'node:readline'

// ── 1. Validate environment ───────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL?.replace(/\/$/, '')
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('\n❌  Missing env vars.')
  console.error('    Add the following to your .env file:')
  console.error('      SUPABASE_URL=https://<project-ref>.supabase.co')
  console.error('      SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>\n')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
})

// ── 2. Junk detection ─────────────────────────────────────────────────────────

/**
 * Returns a human-readable reason string if the row looks like junk,
 * or null if it looks like a legitimate seeded festival.
 */
function junkReason(festivalKey, startDate) {
  if (!startDate) {
    return 'no start_date — ingest produced no usable date from Ticketmaster'
  }
  if (/^\d/.test(festivalKey)) {
    return 'date-prefixed slug (starts with a digit)'
  }
  if (/\btour\b/i.test(festivalKey)) {
    return 'contains "tour" — likely a tour stop, not a festival'
  }
  return null
}

// ── 3. Fetch all festival_meta rows ──────────────────────────────────────────

console.log('\n🔍  Fetching festival_meta...')

const { data: allFestivals, error: fetchError } = await supabase
  .from('festival_meta')
  .select('festival_key, name, start_date, end_date')
  .order('festival_key')

if (fetchError) {
  console.error('❌  Could not fetch festival_meta:', fetchError.message)
  process.exit(1)
}

console.log(`    Found ${allFestivals.length} total festival(s) in the database.`)

// ── 4. Flag junk entries ──────────────────────────────────────────────────────

const junk = allFestivals
  .map(f => ({ ...f, reason: junkReason(f.festival_key, f.start_date) }))
  .filter(f => f.reason !== null)

if (junk.length === 0) {
  console.log('\n✅  No junk festivals found — nothing to clean up.\n')
  process.exit(0)
}

console.log(`\n⚠️   Found ${junk.length} likely-junk festival(s):\n`)

for (const f of junk) {
  console.log(`  • ${f.festival_key}`)
  console.log(`      Name      : ${f.name}`)
  console.log(`      Start date: ${f.start_date ?? '(null)'}`)
  console.log(`      Reason    : ${f.reason}`)
  console.log()
}

// ── 5. Confirm ────────────────────────────────────────────────────────────────

const rl = createInterface({ input: process.stdin, output: process.stdout })
const answer = await new Promise(resolve =>
  rl.question('Delete all of the above? Type y to confirm, anything else to abort: ', resolve)
)
rl.close()

if (answer.trim().toLowerCase() !== 'y') {
  console.log('\n⚠️   Aborted — nothing was deleted.\n')
  process.exit(0)
}

// ── 6. Delete ─────────────────────────────────────────────────────────────────

const keys = junk.map(f => f.festival_key)
console.log(`\n🗑️   Deleting ${keys.length} festival(s)...`)

// 6a. artist_ratings
const { error: ratingsErr } = await supabase
  .from('artist_ratings')
  .delete()
  .in('festival_key', keys)

if (ratingsErr) {
  console.warn('⚠️   artist_ratings delete warning:', ratingsErr.message)
} else {
  console.log('✅  artist_ratings  — done')
}

// 6b. user_schedules (no FK cascade from festival_meta — must be explicit)
const { error: schedErr } = await supabase
  .from('user_schedules')
  .delete()
  .in('festival_key', keys)

if (schedErr) {
  console.warn('⚠️   user_schedules delete warning:', schedErr.message)
} else {
  console.log('✅  user_schedules  — done')
}

// 6c. timetable_slots (FK cascade would cover this, but being explicit)
const { error: slotsErr } = await supabase
  .from('timetable_slots')
  .delete()
  .in('festival_key', keys)

if (slotsErr) {
  console.warn('⚠️   timetable_slots delete warning:', slotsErr.message)
} else {
  console.log('✅  timetable_slots — done')
}

// 6d. festival_meta (last — other tables reference it)
const { error: metaErr } = await supabase
  .from('festival_meta')
  .delete()
  .in('festival_key', keys)

if (metaErr) {
  console.error('\n❌  festival_meta delete failed:', metaErr.message)
  console.error('    You may need to delete child rows manually first.')
  process.exit(1)
}

console.log('✅  festival_meta   — done')

// ── 7. Summary ────────────────────────────────────────────────────────────────

console.log(`\n🎉  Removed ${keys.length} junk festival(s):`)
for (const k of keys) console.log(`    • ${k}`)
console.log()
