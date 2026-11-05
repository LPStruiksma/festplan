#!/usr/bin/env node
/**
 * Seed one festival edition into Supabase.
 *
 * A verified date-only edition (empty stages AND lineup) upserts festival_meta
 * only. Full lineups retain the existing timetable delete + batch-insert replace.
 * All validation runs before the first database operation.
 *
 * CLI (operator-controlled; do not run against production without approval):
 *   node --env-file=.env scripts/seed-festival.mjs <path-to-json>
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REQUIRED = ['id', 'name', 'location', 'days', 'stages', 'lineup']
const SLOT_FIELDS = ['artist', 'day', 'start', 'end']
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const LOCAL_TIME = /^([01]\d|2[0-3]):[0-5]\d$/
const BATCH_SIZE = 200

function nonemptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function validIsoDate(value) {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

/**
 * Validate everything before a service-role client is created or any DB write.
 * A full lineup can still omit dates for legacy seed compatibility. A date-only
 * edition must supply both real, ordered ISO calendar dates.
 */
export function validateFestival(festival) {
  if (!festival || typeof festival !== 'object' || Array.isArray(festival)) {
    throw new Error('Festival JSON must be an object')
  }

  const missing = REQUIRED.filter(field => !Object.hasOwn(festival, field))
  if (missing.length) {
    throw new Error(`JSON is missing required field(s): ${missing.join(', ')}`)
  }

  for (const field of ['id', 'name', 'location']) {
    if (!nonemptyString(festival[field])) {
      throw new Error(`"${field}" must be a non-empty string`)
    }
  }

  if (!Array.isArray(festival.days) ||
      festival.days.length === 0 ||
      !festival.days.every(nonemptyString)) {
    throw new Error('"days" must be a non-empty array of calendar-day labels')
  }

  if (!Array.isArray(festival.stages) ||
      !festival.stages.every(nonemptyString)) {
    throw new Error('"stages" must be an array of non-empty stage names')
  }

  if (!Array.isArray(festival.lineup)) {
    throw new Error('"lineup" must be an array')
  }

  const metadataOnly = festival.stages.length === 0 && festival.lineup.length === 0
  if (!metadataOnly &&
      (festival.stages.length === 0 || festival.lineup.length === 0)) {
    throw new Error('Use both empty stages and lineup for metadata-only, or both non-empty for a timetable')
  }

  if (metadataOnly &&
      (festival.startDate == null || festival.endDate == null)) {
    throw new Error('Metadata-only editions require startDate and endDate')
  }

  for (const field of ['startDate', 'endDate']) {
    if (festival[field] != null && !validIsoDate(festival[field])) {
      throw new Error(`"${field}" must be a real YYYY-MM-DD date`)
    }
  }

  if (festival.startDate != null &&
      festival.endDate != null &&
      festival.startDate > festival.endDate) {
    throw new Error('startDate must not be later than endDate')
  }

  // Validate full-lineup slots as a whole before deleting any existing rows.
  festival.lineup.forEach((slot, i) => {
    if (!slot || typeof slot !== 'object' || Array.isArray(slot)) {
      throw new Error(`lineup[${i}] must be an object`)
    }

    const missingFields = SLOT_FIELDS.filter(field => !Object.hasOwn(slot, field))
    if (missingFields.length) {
      throw new Error(`lineup[${i}] is missing: ${missingFields.join(', ')}`)
    }

    if (!nonemptyString(slot.artist) ||
        !Number.isInteger(slot.day) ||
        slot.day < 0 ||
        slot.day >= festival.days.length ||
        !LOCAL_TIME.test(slot.start) ||
        !LOCAL_TIME.test(slot.end) ||
        (slot.stage != null && !nonemptyString(slot.stage))) {
      throw new Error(`lineup[${i}] has invalid artist, day, stage or HH:mm time`)
    }
  })

  return festival
}

/**
 * Injected Supabase-compatible client lets tests assert the exact sequence of
 * writes with no credentials or network access.
 */
export async function seedFestival(input, supabase, {
  log = console.log,
  write = chunk => process.stdout.write(chunk),
} = {}) {
  const festival = validateFestival(input)
  const festKey = festival.id
  const metadataOnly = festival.lineup.length === 0

  log(`\n🎪  Seeding: ${festival.name}`)
  log(`    festival_key : ${festKey}`)
  log(`    days         : ${festival.days.length} (${festival.days.join(', ')})`)
  log(`    stages       : ${festival.stages.length}`)
  log(`    lineup slots : ${festival.lineup.length}\n`)

  const metaRow = {
    festival_key: festKey,
    name: festival.name,
    location: festival.location,
    emoji: festival.emoji ?? '🎵',
    accent_color: festival.accentColor ?? null,
    days: festival.days,
    stages: festival.stages,
    start_date: festival.startDate ?? null,
    end_date: festival.endDate ?? null,
    updated_at: new Date().toISOString(),
  }

  const { error: metaErr } = await supabase
    .from('festival_meta')
    .upsert(metaRow, { onConflict: 'festival_key' })

  if (metaErr) throw new Error(`festival_meta upsert failed: ${metaErr.message}`)
  log('✅  festival_meta  — upserted 1 row')

  if (metadataOnly) {
    // Never delete, insert, or even query timetable_slots in this mode.
    log('✅  timetable_slots — untouched (metadata-only edition)')
    return { mode: 'metadata-only', inserted: 0 }
  }

  // Full-lineup mode keeps the existing replace behaviour. Delete scoped to
  // this edition first; insert valid slots in batches of 200.
  const { error: delErr } = await supabase
    .from('timetable_slots')
    .delete()
    .eq('festival_key', festKey)

  if (delErr) throw new Error(`timetable_slots delete failed: ${delErr.message}`)

  const rows = festival.lineup.map(slot => ({
    festival_key: festKey,
    artist: slot.artist,
    stage: slot.stage ?? null,
    day_index: slot.day,
    start_time: slot.start,
    end_time: slot.end,
  }))

  let inserted = 0
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)
    const { error: insErr } = await supabase.from('timetable_slots').insert(batch)
    if (insErr) {
      throw new Error(`timetable_slots insert (batch ${Math.floor(i / BATCH_SIZE) + 1}) failed: ${insErr.message}`)
    }
    inserted += batch.length
    write(`\r    Inserting… ${inserted} / ${rows.length} slots`)
  }

  log(`\n✅  timetable_slots — replaced with ${inserted} rows`)
  log(`\n🎉  Done — "${festival.name}" is live in Supabase.\n`)
  return { mode: 'full-lineup', inserted }
}

async function runCli() {
  const jsonPath = process.argv[2]
  if (!jsonPath) {
    throw new Error('No JSON file specified. Usage: node --env-file=.env scripts/seed-festival.mjs <path-to-json>')
  }

  const festival = JSON.parse(readFileSync(resolve(jsonPath), 'utf8'))
  validateFestival(festival)

  const url = process.env.SUPABASE_URL?.replace(/\/$/, '')
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in the operator environment')
  }

  // Dynamic import keeps pure validation and mock-client tests independent
  // from service-role credentials and any network connection.
  const { createClient } = await import('@supabase/supabase-js')
  const supabase = createClient(url, key, { auth: { persistSession: false } })
  await seedFestival(festival, supabase)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runCli().catch(err => {
    console.error(`\n❌  ${err.message}\n`)
    process.exitCode = 1
  })
}
