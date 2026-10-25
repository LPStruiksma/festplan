import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkBundleSize } from './check-bundle-size.mjs'

function fakeDist(files) {
  const dir = mkdtempSync(join(tmpdir(), 'fp-dist-'))
  mkdirSync(join(dir, 'assets'))
  for (const [name, bytes] of Object.entries(files)) {
    writeFileSync(join(dir, 'assets', name), 'x'.repeat(bytes))
  }
  return dir
}

describe('checkBundleSize', () => {
  let dir
  afterEach(() => dir && rmSync(dir, { recursive: true, force: true }))

  it('passes when every JS chunk is at or under the limit', () => {
    dir = fakeDist({ 'index-a.js': 1000, 'Admin-b.js': 400, 'index-c.css': 5000 })
    const r = checkBundleSize(dir, 1000)
    expect(r.ok).toBe(true)
    expect(r.chunks.map((c) => c.name)).toEqual(['index-a.js', 'Admin-b.js'])
  })

  it('fails and names the chunk that is over the limit', () => {
    dir = fakeDist({ 'index-a.js': 1001, 'Admin-b.js': 400 })
    const r = checkBundleSize(dir, 1000)
    expect(r.ok).toBe(false)
    expect(r.oversized).toEqual([{ name: 'index-a.js', bytes: 1001 }])
  })

  it('fails when the build emitted no JS chunks', () => {
    dir = fakeDist({ 'index-c.css': 10 })
    expect(checkBundleSize(dir, 1000).ok).toBe(false)
  })
})
