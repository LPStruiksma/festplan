import { describe, expect, it } from 'vitest'
import { seedFestival, validateFestival } from './seed-festival.mjs'

const silent = { log: () => {}, write: () => {} }

function dateOnly(overrides = {}) {
  return {
    id: 'glastonbury-2027',
    name: 'Glastonbury 2027',
    location: 'Worthy Farm, Somerset, UK',
    emoji: '🎸',
    startDate: '2027-06-23',
    endDate: '2027-06-27',
    days: ['Wed Jun 23', 'Thu Jun 24', 'Fri Jun 25', 'Sat Jun 26', 'Sun Jun 27'],
    stages: [],
    lineup: [],
    ...overrides,
  }
}

function fullLineup(overrides = {}) {
  return {
    ...dateOnly({
      stages: ['Main Stage'],
      lineup: [{
        artist: 'Example artist',
        stage: 'Main Stage',
        day: 1,
        start: '21:30',
        end: '23:00',
      }],
    }),
    ...overrides,
  }
}

// In-memory Supabase API double: no env vars, credentials, or network.
function fakeDatabase(initialSlots = []) {
  const metadata = new Map()
  const slots = [...initialSlots]
  const operations = []

  return {
    metadata,
    slots,
    operations,
    from(table) {
      if (table === 'festival_meta') {
        return {
          async upsert(row, opts) {
            operations.push({ table, action: 'upsert', row, opts })
            metadata.set(row.festival_key, { ...row })
            return { error: null }
          },
        }
      }

      if (table === 'timetable_slots') {
        return {
          delete() {
            return {
              async eq(column, value) {
                operations.push({ table, action: 'delete', column, value })
                const remaining = slots.filter(slot => slot[column] !== value)
                slots.splice(0, slots.length, ...remaining)
                return { error: null }
              },
            }
          },
          async insert(batch) {
            operations.push({ table, action: 'insert', batch })
            slots.push(...batch)
            return { error: null }
          },
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    },
  }
}

describe('seed-festival metadata-only imports', () => {
  it('upserts verified date-only editions without calling timetable_slots', async () => {
    const db = fakeDatabase()
    const result = await seedFestival(dateOnly(), db, silent)

    expect(result).toEqual({ mode: 'metadata-only', inserted: 0 })
    expect(db.operations.map(op => [op.table, op.action])).toEqual([
      ['festival_meta', 'upsert'],
    ])
    expect(db.metadata.get('glastonbury-2027')).toMatchObject({
      festival_key: 'glastonbury-2027',
      name: 'Glastonbury 2027',
      start_date: '2027-06-23',
      end_date: '2027-06-27',
      days: expect.any(Array),
      stages: [],
    })
  })

  it('does not delete or insert existing timetable slots on re-import', async () => {
    const existing = {
      festival_key: 'glastonbury-2027',
      artist: 'Already scheduled',
      stage: 'Main Stage',
      day_index: 0,
      start_time: '19:00',
      end_time: '20:00',
    }
    const other = { ...existing, festival_key: 'another-edition' }
    const db = fakeDatabase([existing, other])

    await seedFestival(dateOnly(), db, silent)
    await seedFestival(dateOnly(), db, silent)

    expect(db.metadata.size).toBe(1)
    expect(db.slots).toEqual([existing, other])
    expect(db.operations.map(op => op.action)).toEqual(['upsert', 'upsert'])
  })

  it.each([
    ['null input', null],
    ['missing identity', dateOnly({ id: '' })],
    ['missing name', dateOnly({ name: '  ' })],
    ['wrong location type', dateOnly({ location: 42 })],
    ['missing days', { ...dateOnly(), days: undefined }],
    ['empty calendar', dateOnly({ days: [] })],
    ['malformed calendar entry', dateOnly({ days: ['Wed Jun 23', ''] })],
    ['non-array calendar', dateOnly({ days: 'Wed Jun 23' })],
    ['non-array stages', dateOnly({ stages: null })],
    ['non-array lineup', dateOnly({ lineup: {} })],
    ['missing stages', (({ stages, ...item }) => item)(dateOnly())],
    ['missing lineup', (({ lineup, ...item }) => item)(dateOnly())],
    ['half-empty stages', dateOnly({ stages: ['Main Stage'] })],
    ['half-empty lineup', dateOnly({ lineup: [{ artist: 'A', day: 0, start: '12:00', end: '13:00' }] })],
    ['missing metadata-only start date', dateOnly({ startDate: undefined })],
    ['missing metadata-only end date', dateOnly({ endDate: undefined })],
    ['invalid start date', dateOnly({ startDate: '2027-02-30' })],
    ['invalid end date', dateOnly({ endDate: '2027-13-01' })],
    ['non-ISO date', dateOnly({ startDate: 'June 23, 2027' })],
    ['reversed date range', dateOnly({ startDate: '2027-06-28' })],
    ['bad full-lineup entry', fullLineup({ lineup: [{ artist: 'A', day: 0, start: '21:00' }] })],
    ['wrong full-lineup day', fullLineup({ lineup: [{ artist: 'A', day: 22, start: '21:00', end: '22:00' }] })],
    ['invalid stage list entry', fullLineup({ stages: [''] })],
    ['invalid full-lineup time', fullLineup({ lineup: [{ artist: 'A', day: 1, start: '25:00', end: '22:00' }] })],
  ])('rejects %s before writing any table', async (_name, input) => {
    const db = fakeDatabase()
    await expect(seedFestival(input, db, silent)).rejects.toThrow()
    expect(db.operations).toEqual([])
  })

  it('accepts full-lineup imports and retains delete + insert replacement semantics', async () => {
    const db = fakeDatabase([{
      festival_key: 'glastonbury-2027',
      artist: 'Stale artist',
    }])
    const result = await seedFestival(fullLineup(), db, silent)

    expect(result).toEqual({ mode: 'full-lineup', inserted: 1 })
    expect(db.operations.map(op => [op.table, op.action])).toEqual([
      ['festival_meta', 'upsert'],
      ['timetable_slots', 'delete'],
      ['timetable_slots', 'insert'],
    ])
    expect(db.operations[1]).toMatchObject({
      column: 'festival_key',
      value: 'glastonbury-2027',
    })
    expect(db.slots).toEqual([{
      festival_key: 'glastonbury-2027',
      artist: 'Example artist',
      stage: 'Main Stage',
      day_index: 1,
      start_time: '21:30',
      end_time: '23:00',
    }])
  })

  it('retains batch insertion for larger full lineups', async () => {
    const lineup = Array.from({ length: 201 }, (_, i) => ({
      artist: `Artist ${i}`,
      day: 0,
      start: '12:00',
      end: '13:00',
    }))
    const db = fakeDatabase()
    const result = await seedFestival(fullLineup({ lineup }), db, silent)

    expect(result.inserted).toBe(201)
    expect(db.operations.filter(op => op.action === 'insert').map(op => op.batch.length))
      .toEqual([200, 1])
  })

  it('can validate input without initializing a database client', () => {
    expect(validateFestival(dateOnly())).toMatchObject({ id: 'glastonbury-2027' })
    expect(() => validateFestival(dateOnly({ days: 'invalid' }))).toThrow()
  })
})

// ---------------------------------------------------------------------------
// U3 rehearsal (goal autodev#1623): fixture-only 2027 timetable lifecycle.
// Recorded synthetic fixtures in the public scripts/festivals/*.json format.
// The festival keys mirror a real edge case (the 2026 key "bestkeptsecret" is
// a prefix of "bestkeptsecret-2027") with obviously synthetic names and acts.
// ---------------------------------------------------------------------------

const REHEARSAL_METADATA = Object.freeze({
  id: 'synthfest-2027',
  name: 'Synthfest 2027',
  location: 'Testdorp, NL',
  emoji: '🌲',
  accentColor: '#4ade80',
  startDate: '2027-06-11',
  endDate: '2027-06-13',
  days: ['Fri Jun 11', 'Sat Jun 12', 'Sun Jun 13'],
  stages: [],
  lineup: [],
})

const REHEARSAL_TIMETABLE = Object.freeze({
  ...REHEARSAL_METADATA,
  stages: ['Synthetic Main', 'Synthetic Forest'],
  lineup: [
    { artist: 'Synthetic Act A', stage: 'Synthetic Main', day: 0, start: '21:30', end: '23:00' },
    { artist: 'Synthetic Act B', stage: 'Synthetic Forest', day: 0, start: '20:00', end: '21:00' },
    { artist: 'Synthetic Act C', stage: 'Synthetic Main', day: 1, start: '22:00', end: '23:30' },
    { artist: 'Synthetic Act D', day: 2, start: '18:15', end: '19:00' },
  ],
})

// Another edition whose key is a prefix of the 2027 key, plus an unrelated one.
const PREVIOUS_EDITION_SLOT = Object.freeze({
  festival_key: 'synthfest', artist: 'Synthetic 2026 Act', stage: 'Synthetic Main',
  day_index: 0, start_time: '21:30', end_time: '23:00',
})
const OTHER_FESTIVAL_SLOT = Object.freeze({
  festival_key: 'otherfest-2027', artist: 'Synthetic Other Act', stage: null,
  day_index: 1, start_time: '12:00', end_time: '13:00',
})

const EXPECTED_2027_ROWS = [
  { festival_key: 'synthfest-2027', artist: 'Synthetic Act A', stage: 'Synthetic Main', day_index: 0, start_time: '21:30', end_time: '23:00' },
  { festival_key: 'synthfest-2027', artist: 'Synthetic Act B', stage: 'Synthetic Forest', day_index: 0, start_time: '20:00', end_time: '21:00' },
  { festival_key: 'synthfest-2027', artist: 'Synthetic Act C', stage: 'Synthetic Main', day_index: 1, start_time: '22:00', end_time: '23:30' },
  { festival_key: 'synthfest-2027', artist: 'Synthetic Act D', stage: null, day_index: 2, start_time: '18:15', end_time: '19:00' },
]

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function rowsFor(db, key) {
  return db.slots.filter(slot => slot.festival_key === key)
}

function metaWithoutTimestamp(db, key) {
  const { updated_at, ...rest } = db.metadata.get(key)
  return rest
}

// Wraps fakeDatabase so a chosen operation fails, to rehearse partial failures.
function failingDatabase(initialSlots, { failOn, afterInserts = 0 }) {
  const db = fakeDatabase(initialSlots)
  let inserts = 0
  const from = db.from.bind(db)
  db.from = table => {
    const api = from(table)
    if (table === 'festival_meta' && failOn === 'upsert') {
      return { async upsert(row) { db.operations.push({ table, action: 'upsert-failed', row }); return { error: { message: 'synthetic upsert outage' } } } }
    }
    if (table === 'timetable_slots' && failOn === 'delete') {
      return { ...api, delete: () => ({ async eq(column, value) { db.operations.push({ table, action: 'delete-failed', column, value }); return { error: { message: 'synthetic delete outage' } } } }) }
    }
    if (table === 'timetable_slots' && failOn === 'insert') {
      return {
        ...api,
        async insert(batch) {
          if (inserts >= afterInserts) {
            db.operations.push({ table, action: 'insert-failed', batch })
            return { error: { message: 'synthetic insert outage' } }
          }
          inserts += 1
          return api.insert(batch)
        },
      }
    }
    return api
  }
  return db
}

describe('seed-festival 2027 timetable rehearsal (fixture-only)', () => {
  it('moves a metadata-only edition to a published timetable without touching other editions', async () => {
    const db = fakeDatabase([PREVIOUS_EDITION_SLOT, OTHER_FESTIVAL_SLOT])

    const first = await seedFestival(clone(REHEARSAL_METADATA), db, silent)
    expect(first).toEqual({ mode: 'metadata-only', inserted: 0 })
    expect(rowsFor(db, 'synthfest-2027')).toEqual([])
    expect(db.metadata.get('synthfest-2027')).toMatchObject({ stages: [], start_date: '2027-06-11', end_date: '2027-06-13' })

    const published = await seedFestival(clone(REHEARSAL_TIMETABLE), db, silent)
    expect(published).toEqual({ mode: 'full-lineup', inserted: 4 })
    expect(rowsFor(db, 'synthfest-2027')).toEqual(EXPECTED_2027_ROWS)
    expect(db.metadata.get('synthfest-2027')).toMatchObject({
      festival_key: 'synthfest-2027',
      stages: ['Synthetic Main', 'Synthetic Forest'],
      start_date: '2027-06-11',
      end_date: '2027-06-13',
    })

    // The delete is an exact festival_key match, so the prefix edition survives.
    expect(db.operations.filter(op => op.action === 'delete'))
      .toEqual([{ table: 'timetable_slots', action: 'delete', column: 'festival_key', value: 'synthfest-2027' }])
    expect(rowsFor(db, 'synthfest')).toEqual([PREVIOUS_EDITION_SLOT])
    expect(rowsFor(db, 'otherfest-2027')).toEqual([OTHER_FESTIVAL_SLOT])
    expect(db.operations.filter(op => op.action === 'upsert').map(op => op.row.festival_key))
      .toEqual(['synthfest-2027', 'synthfest-2027'])
    expect(db.operations.flatMap(op => op.batch ?? []).every(row => row.festival_key === 'synthfest-2027')).toBe(true)
  })

  it('reaches the same final rows when the identical full import is repeated', async () => {
    const db = fakeDatabase([PREVIOUS_EDITION_SLOT, OTHER_FESTIVAL_SLOT])
    await seedFestival(clone(REHEARSAL_TIMETABLE), db, silent)
    const afterFirst = { slots: clone(db.slots), meta: metaWithoutTimestamp(db, 'synthfest-2027') }

    for (let run = 0; run < 2; run += 1) {
      const result = await seedFestival(clone(REHEARSAL_TIMETABLE), db, silent)
      expect(result).toEqual({ mode: 'full-lineup', inserted: 4 })
    }

    expect(db.slots).toEqual(afterFirst.slots)
    expect(rowsFor(db, 'synthfest-2027')).toEqual(EXPECTED_2027_ROWS)
    expect(metaWithoutTimestamp(db, 'synthfest-2027')).toEqual(afterFirst.meta)
    expect(db.metadata.size).toBe(1)
    expect(db.slots).toHaveLength(6)
  })

  it('does not mutate the fixture it imports', async () => {
    const input = clone(REHEARSAL_TIMETABLE)
    const before = clone(input)
    await seedFestival(input, fakeDatabase(), silent)
    expect(input).toEqual(before)
  })

  it('keeps a published timetable when a metadata-only file is re-imported later', async () => {
    const db = fakeDatabase([OTHER_FESTIVAL_SLOT])
    await seedFestival(clone(REHEARSAL_TIMETABLE), db, silent)
    const count = db.operations.length

    await seedFestival(clone(REHEARSAL_METADATA), db, silent)
    expect(db.operations.slice(count).map(op => [op.table, op.action])).toEqual([['festival_meta', 'upsert']])
    expect(rowsFor(db, 'synthfest-2027')).toEqual(EXPECTED_2027_ROWS)
    // Known behaviour: festival_meta.stages follows the latest file (now empty);
    // slots are left for the operator, never deleted by a metadata-only import.
    expect(db.metadata.get('synthfest-2027').stages).toEqual([])
  })

  it('rejects an invalid timetable before any write, keeping the published rows', async () => {
    const db = fakeDatabase([PREVIOUS_EDITION_SLOT])
    await seedFestival(clone(REHEARSAL_TIMETABLE), db, silent)
    const snapshot = { slots: clone(db.slots), ops: db.operations.length }

    const broken = clone(REHEARSAL_TIMETABLE)
    broken.lineup[3] = { artist: 'Synthetic Act D', day: 3, start: '18:15', end: '19:00' }
    await expect(seedFestival(broken, db, silent)).rejects.toThrow('lineup[3] has invalid artist, day, stage or HH:mm time')
    expect(db.operations).toHaveLength(snapshot.ops)
    expect(db.slots).toEqual(snapshot.slots)
  })

  it('stops before touching slots when the festival_meta upsert fails', async () => {
    const db = failingDatabase([PREVIOUS_EDITION_SLOT], { failOn: 'upsert' })
    await expect(seedFestival(clone(REHEARSAL_TIMETABLE), db, silent))
      .rejects.toThrow('festival_meta upsert failed: synthetic upsert outage')
    expect(db.operations.map(op => op.action)).toEqual(['upsert-failed'])
    expect(db.slots).toEqual([PREVIOUS_EDITION_SLOT])
  })

  it('reports a failed delete and inserts nothing, keeping existing rows', async () => {
    const existing = { ...EXPECTED_2027_ROWS[0], artist: 'Synthetic Stale Act' }
    const db = failingDatabase([existing, PREVIOUS_EDITION_SLOT], { failOn: 'delete' })
    await expect(seedFestival(clone(REHEARSAL_TIMETABLE), db, silent))
      .rejects.toThrow('timetable_slots delete failed: synthetic delete outage')
    expect(db.operations.map(op => op.action)).toEqual(['upsert', 'delete-failed'])
    expect(db.slots).toEqual([existing, PREVIOUS_EDITION_SLOT])
  })

  it('documents that a mid-insert failure leaves a partial edition, and that re-running recovers it', async () => {
    const lineup = Array.from({ length: 450 }, (_, i) => ({
      artist: `Synthetic Act ${String(i).padStart(3, '0')}`,
      stage: 'Synthetic Main',
      day: i % 3,
      start: '12:00',
      end: '13:00',
    }))
    const big = { ...clone(REHEARSAL_TIMETABLE), lineup }
    const db = failingDatabase([PREVIOUS_EDITION_SLOT, OTHER_FESTIVAL_SLOT], { failOn: 'insert', afterInserts: 1 })

    await expect(seedFestival(big, db, silent))
      .rejects.toThrow('timetable_slots insert (batch 2) failed: synthetic insert outage')
    // Not atomic: the old rows are gone and only the first batch landed.
    expect(rowsFor(db, 'synthfest-2027')).toHaveLength(200)
    // Other editions are never affected by the failure.
    expect(rowsFor(db, 'synthfest')).toEqual([PREVIOUS_EDITION_SLOT])
    expect(rowsFor(db, 'otherfest-2027')).toEqual([OTHER_FESTIVAL_SLOT])

    // Recovery is a plain re-run of the same file against a healthy database.
    const healthy = fakeDatabase(clone(db.slots))
    const result = await seedFestival(big, healthy, silent)
    expect(result).toEqual({ mode: 'full-lineup', inserted: 450 })
    const clean = fakeDatabase([PREVIOUS_EDITION_SLOT, OTHER_FESTIVAL_SLOT])
    await seedFestival(big, clean, silent)
    expect(healthy.slots).toEqual(clean.slots)
  })
})
