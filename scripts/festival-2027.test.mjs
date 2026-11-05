// Officially announced 2027 dates must remain consistent with staged seeds.
// The production seeder currently rejects lineup: []; these are provenance-backed
// date-only edition files, not fabricated timetable slots.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, 'festivals')
const dates = {
  'bestkeptsecret-2027.json': ['2027-06-11', '2027-06-13'],
  'coachella-2027.json': ['2027-04-09', '2027-04-11'],
  'coachella-weekend2-2027.json': ['2027-04-16', '2027-04-18'],
  'glastonbury-2027.json': ['2027-06-23', '2027-06-27'],
  'lowlands-2027.json': ['2027-08-20', '2027-08-22'],
  'primavera-2027.json': ['2027-06-02', '2027-06-06'],
}
const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function dayLabels(startDate, endDate) {
  const date = new Date(startDate + 'T00:00:00Z')
  const last = new Date(endDate + 'T00:00:00Z')
  const labels = []
  for (; date <= last; date.setUTCDate(date.getUTCDate() + 1)) {
    labels.push(`${weekdays[date.getUTCDay()]} ${months[date.getUTCMonth()]} ${date.getUTCDate()}`)
  }
  return labels
}

describe('2027 organiser-date seed files', () => {
  const ids = []
  for (const [filename, [startDate, endDate]] of Object.entries(dates)) {
    const data = JSON.parse(readFileSync(join(root, filename), 'utf8'))
    ids.push(data.id)
    it(`${filename} has confirmed dates and attributable source`, () => {
      expect(data.startDate).toBe(startDate)
      expect(data.endDate).toBe(endDate)
      expect(data.days).toEqual(dayLabels(startDate, endDate))
      expect(data.source.checkedOn).toBe('2026-11-05')
      expect(new URL(data.source.url).protocol).toBe('https:')
      expect(Array.isArray(data.stages)).toBe(true)
      expect(Array.isArray(data.lineup)).toBe(true)
      for (const slot of data.lineup) {
        for (const field of ['artist', 'day', 'start', 'end']) expect(slot).toHaveProperty(field)
      }
    })
  }
  it('keeps edition keys distinct (including both Coachella weekends)', () => {
    expect(new Set(ids).size).toBe(ids.length)
  })
})
