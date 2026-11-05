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
