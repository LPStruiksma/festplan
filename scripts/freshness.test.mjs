// Keeps docs/freshness.md in step with importable festival editions (festplan#29).
// Each seed file needs a row with its end date. Separately validated
// *-announced.json snapshots are untimed facts, not seeder input or editions.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
const festivalsDir = join(root, 'scripts', 'festivals')

function readInventory() {
  return readFileSync(join(root, 'docs', 'freshness.md'), 'utf8')
}

describe('docs/freshness.md', () => {
  it('has a Next expiry table', () => {
    expect(readInventory()).toMatch(/^## Next expiry$/m)
  })

  const files = readdirSync(festivalsDir)
    .filter(f => f.endsWith('.json') && !f.endsWith('-announced.json'))

  it('finds the seeded festival files', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  for (const file of files) {
    it(`lists ${file} with its end date`, () => {
      const { endDate } = JSON.parse(readFileSync(join(festivalsDir, file), 'utf8'))
      const row = readInventory().split('\n').find(line => line.includes(`\`${file}\``))
      expect(row, `no row names \`${file}\``).toBeDefined()
      expect(row).toContain(endDate)
    })
  }

  it('lists every Spotify Web API path the code calls', () => {
    const doc = readInventory()
    for (const path of ['/search', '/artists/{id}/related-artists',
      '/me/top/artists', '/me/tracks', '/me/playlists', '/playlists/{id}/items',
      'accounts.spotify.com/api/token']) {
      expect(doc, path).toContain(`\`${path}\``)
    }
  })
})
