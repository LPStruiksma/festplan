// Fails the build when any emitted JavaScript chunk is over the size limit.
//
// Run after `vite build` (the `build` npm script does this). The limit
// matches Vite's own chunkSizeWarningLimit (500 kB, decimal), so the
// warning Vite prints and this check agree.
//
//   node scripts/check-bundle-size.mjs [distDir] [limitBytes]

import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const DEFAULT_LIMIT_BYTES = 500_000

/** Sizes of every .js file under `<distDir>/assets`, largest first. */
export function listChunks(distDir) {
  const assets = join(distDir, 'assets')
  return readdirSync(assets)
    .filter((name) => name.endsWith('.js'))
    .map((name) => ({ name, bytes: statSync(join(assets, name)).size }))
    .sort((a, b) => b.bytes - a.bytes)
}

/** Returns { ok, chunks, oversized } for the build in `distDir`. */
export function checkBundleSize(distDir, limitBytes = DEFAULT_LIMIT_BYTES) {
  const chunks = listChunks(distDir)
  const oversized = chunks.filter((c) => c.bytes > limitBytes)
  return { ok: chunks.length > 0 && oversized.length === 0, chunks, oversized }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const distDir = process.argv[2] ?? 'dist'
  const limit = Number(process.argv[3] ?? DEFAULT_LIMIT_BYTES)
  const { ok, chunks, oversized } = checkBundleSize(distDir, limit)
  for (const c of chunks) console.log(`${(c.bytes / 1000).toFixed(2).padStart(10)} kB  ${c.name}`)
  if (chunks.length === 0) console.error(`No JavaScript chunks found in ${distDir}/assets`)
  for (const c of oversized) {
    console.error(`Chunk ${c.name} is ${(c.bytes / 1000).toFixed(2)} kB, over the ${limit / 1000} kB limit`)
  }
  process.exit(ok ? 0 : 1)
}
