// Offline contract for the organiser's published untimed BKS 2027 lineup.
// This validates a sidecar only; it never calls the importer or a database.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { validateFestival } from '../seed-festival.mjs'

const seed = JSON.parse(readFileSync(new URL('./bestkeptsecret-2027.json', import.meta.url), 'utf8'))
const announced = JSON.parse(readFileSync(new URL('./bestkeptsecret-2027-announced.json', import.meta.url), 'utf8'))
const dates = [
  ['2027-06-11', 'Fri Jun 11', 5],
  ['2027-06-12', 'Sat Jun 12', 6],
  ['2027-06-13', 'Sun Jun 13', 0],
]
const allowedDates = new Set(dates.map(([date]) => date))

function clone(value) {
  return structuredClone(value)
}

// Pure fixture contract: reject unknown/ambiguous dates, unannounced placeholders,
// duplicate artist/day pairs and any timetable, stage, artwork or prose payload.
function validateAnnounced(data, dateOnlySeed) {
  assert.ok(data && typeof data === 'object' && !Array.isArray(data))
  assert.deepEqual(Object.keys(data).sort(), ['artists', 'festivalId', 'source'])
  assert.equal(data.festivalId, dateOnlySeed.id)
  assert.deepEqual(Object.keys(data.source ?? {}).sort(), ['checkedOn', 'dailyLineupsUrl', 'url'])
  assert.equal(data.source.url, 'https://www.bestkeptsecret.nl/program/list')
  assert.equal(
    data.source.dailyLineupsUrl,
    'https://www.bestkeptsecret.nl/news/daily-line-ups-and-new-acts-revealed-day-tickets-on-sale-24-november',
  )
  assert.equal(data.source.checkedOn, '2026-11-21')

  assert.equal(dateOnlySeed.startDate, dates[0][0])
  assert.equal(dateOnlySeed.endDate, dates.at(-1)[0])
  assert.deepEqual(dateOnlySeed.days, dates.map(([, label]) => label))
  assert.deepEqual(dateOnlySeed.stages, [])
  assert.deepEqual(dateOnlySeed.lineup, [])
  validateFestival(dateOnlySeed)

  for (const [date, , weekday] of dates) {
    assert.equal(new Date(`${date}T00:00:00Z`).getUTCDay(), weekday)
  }
  assert.ok(Array.isArray(data.artists) && data.artists.length > 0)
  const pairs = new Set()
  for (const entry of data.artists) {
    assert.ok(entry && typeof entry === 'object' && !Array.isArray(entry))
    assert.deepEqual(Object.keys(entry).sort(), ['day', 'name'])
    assert.ok(typeof entry.name === 'string' && entry.name.length > 0)
    assert.equal(entry.name.trim(), entry.name)
    assert.ok(!/many more to come/i.test(entry.name))
    assert.ok(allowedDates.has(entry.day), `Ambiguous or unverified day for ${entry.name}`)
    const pair = `${entry.name.normalize('NFKC').toLowerCase()}\0${entry.day}`
    assert.ok(!pairs.has(pair), `Duplicate artist/day: ${entry.name}, ${entry.day}`)
    pairs.add(pair)
  }
  return true
}

describe('Best Kept Secret 2027 official untimed artist/day sidecar', () => {
  it('keeps the existing metadata-only seed valid and the separately sourced day assignments complete', () => {
    expect(validateAnnounced(announced, seed)).toBe(true)
    expect(announced.artists).toHaveLength(64)
    expect(new Set(announced.artists.map(artist => artist.day))).toEqual(allowedDates)
  })

  it.each([
    ['JUNGLE', '2027-06-11'],
    ['Fontaines D.C.', '2027-06-12'],
    ['Phoebe Bridgers', '2027-06-13'],
    ['@', '2027-06-13'],
    ['After', '2027-06-12'],
  ])('records organiser-confirmed %s on %s', (name, day) => {
    expect(announced.artists).toContainEqual({ name, day })
  })

  it.each([
    ['empty artist name', fixture => { fixture.artists[0].name = '  ' }],
    ['non-string artist', fixture => { fixture.artists[0].name = null }],
    ['unknown day', fixture => { fixture.artists[0].day = '2027-06-14' }],
    ['unassigned day', fixture => { delete fixture.artists[0].day }],
    ['ambiguous weekday', fixture => { fixture.artists[0].day = 'Friday' }],
    ['placeholder', fixture => { fixture.artists[0].name = 'Many more to come' }],
    ['repeated artist/day pair', fixture => { fixture.artists.push(clone(fixture.artists[0])) }],
    ['case-insensitive duplicate', fixture => {
      fixture.artists.push({ ...fixture.artists[0], name: fixture.artists[0].name.toUpperCase() })
    }],
    ['stage', fixture => { fixture.artists[0].stage = 'Stage A' }],
    ['start time', fixture => { fixture.artists[0].start = '19:00' }],
    ['end time', fixture => { fixture.artists[0].end = '20:00' }],
    ['artwork', fixture => { fixture.artists[0].image = 'a.jpg' }],
    ['description', fixture => { fixture.artists[0].description = 'unneeded prose' }],
    ['missing source', fixture => { delete fixture.source }],
    ['missing source date', fixture => { delete fixture.source.checkedOn }],
    ['incorrect source', fixture => { fixture.source.url = 'https://example.org/' }],
    ['inconsistent festival identity', fixture => { fixture.festivalId = 'other-festival' }],
  ])('rejects %s before any importer could use the fixture', (_label, edit) => {
    const invalid = clone(announced)
    edit(invalid)
    expect(() => validateAnnounced(invalid, seed)).toThrow()
  })

  it('rejects a seed that has been given invented stages or slots', () => {
    const invalidSeed = clone(seed)
    invalidSeed.stages = ['Imaginary Stage']
    expect(() => validateAnnounced(announced, invalidSeed)).toThrow()
  })
})
