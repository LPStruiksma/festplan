// Keeps docs/freshness.md in step with the seeded festival data (festplan#29).
// Every scripts/festivals/*.json file must have a row that names its file and
// its end date, so a stale edition is visible in the "Next expiry" table.
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

  const files = readdirSync(festivalsDir).filter(f => f.endsWith('.json'))

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
    for (const path of ['/search', '/artists/{id}/related-artists', '/artists/{id}/top-tracks',
      '/me/top/artists', '/me/tracks', '/me/playlists', '/playlists/{id}/tracks',
      '/users/{user_id}/playlists', '/me', 'accounts.spotify.com/api/token']) {
      expect(doc, path).toContain(`\`${path}\``)
    }
  })
})
