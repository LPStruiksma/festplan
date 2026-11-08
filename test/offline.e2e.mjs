// Offline proof for the festival ground (festplan#80).
//
// Builds the real app against a local fake Supabase, serves it with
// `vite preview` (service worker included), and drives Chromium:
//   1. load the schedule online, let the service worker take control
//   2. go offline, delete the device copy of the timetable, reload
//      → app shell and timetable come from the service worker's caches;
//        schedule, Now & next and the "Offline, last synced" badge render
//   3. still offline: expire the access token and wipe the service worker's
//      runtime data caches, reload
//      → still signed in; schedule and Now & next from the device copy
//
// Not part of `npm test` (needs Chromium). Run: npm run test:e2e:offline
// Optional: E2E_SHOTS=<dir> saves a screenshot per step.

import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import assert from 'node:assert/strict'

const require = createRequire(import.meta.url)
let chromium
try { ({ chromium } = require('playwright')) } catch {
  ({ chromium } = require(require.resolve('playwright', { paths: [process.env.NODE_PATH || '/opt/node-tools/node_modules'] })))
}

const API_PORT = 54329
const APP_PORT = 4179
const API = `http://127.0.0.1:${API_PORT}`
const APP = `http://localhost:${APP_PORT}`
const OUT_DIR = 'dist-e2e'
const SHOTS = process.env.E2E_SHOTS || ''
const FEST = 'synthetic-field-fest'
const STORAGE_KEY = 'sb-127-auth-token'  // supabase-js: sb-<first host label>-auth-token
const USER = { id: '00000000-0000-4000-8000-000000000001', email: 'synthetic@example.test', aud: 'authenticated', role: 'authenticated', user_metadata: {} }

// Friday 26 June 2026, 14:20 in Amsterdam: Opener is on, Headliner is next.
const NOW = new Date('2026-06-26T14:20:00+02:00')

// ── Fake Supabase ────────────────────────────────────────────────────────────
const META = {
  festival_key: FEST, name: 'Synthetic Field Fest', location: 'Test Grounds', emoji: '🎪',
  accent_color: '#c8f400', start_date: '2026-06-26', end_date: '2026-06-27',
  days: ['Fri Jun 26', 'Sat Jun 27'], stages: ['Alpha', 'Main'],
}
const SLOTS = [
  { artist: 'Synthetic Opener', stage: 'Alpha', day_index: 0, start_time: '14:00', end_time: '15:00' },
  { artist: 'Synthetic Headliner', stage: 'Main', day_index: 0, start_time: '21:00', end_time: '22:30' },
  { artist: 'Someone Else', stage: 'Main', day_index: 1, start_time: '18:00', end_time: '19:00' },
]
// artist_ratings and user_artists are stateful, so the test can change them
// between reads; user_artists can be slowed down past the SW timeout (3 s).
let ratings = []
let artists = ['Synthetic Opener', 'Synthetic Headliner']
let artistsDelayMs = 0
const artistWrites = []
const hits = []
const api = createServer((req, res) => {
  const url = new URL(req.url, API)
  hits.push(`${req.method} ${url.pathname}`)
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] || '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS')
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range')
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end() }
  const json = (body, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)) }
  const wantsObject = String(req.headers.accept || '').includes('vnd.pgrst.object')
  if (url.pathname === '/rest/v1/festival_meta') return json(wantsObject ? META : [META])
  if (url.pathname === '/rest/v1/timetable_slots') return json(SLOTS)
  if (url.pathname === '/rest/v1/artist_ratings' && req.method === 'GET') return json(ratings)
  if (url.pathname === '/rest/v1/user_artists') {
    if (req.method === 'GET') {
      const rows = artists.map(artist_name => ({ artist_name }))
      return void setTimeout(() => json(rows), artistsDelayMs)
    }
    artistWrites.push(req.method)
    if (req.method === 'DELETE') artists = []
    let body = ''
    req.on('data', c => { body += c })
    req.on('end', () => {
      if (req.method === 'POST' && body) artists = artists.concat(JSON.parse(body).map(r => r.artist_name))
      json([], req.method === 'POST' ? 201 : 200)
    })
    return
  }
  if (url.pathname.startsWith('/rest/v1/')) return json(wantsObject ? null : [], req.method === 'GET' ? 200 : 201)
  if (url.pathname === '/auth/v1/user') return json(USER)
  if (url.pathname === '/auth/v1/token') return json(session(3600))
  if (url.pathname.startsWith('/functions/v1/')) return json({})
  json({ message: 'not found' }, 404)
})

function session(expiresIn) {
  const exp = Math.floor(Date.now() / 1000) + expiresIn
  return { access_token: 'synthetic-access', refresh_token: 'synthetic-refresh', token_type: 'bearer', expires_in: expiresIn, expires_at: exp, user: USER }
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function run(cmd, args, env = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: 'inherit', env: { ...process.env, ...env } })
    p.on('exit', code => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(' ')} exited ${code}`))))
  })
}

async function waitForHttp(url, ms = 20000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    try { if ((await fetch(url)).ok) return } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 200))
  }
  throw new Error(`timed out waiting for ${url}`)
}

async function shot(page, name) {
  if (!SHOTS) return
  mkdirSync(SHOTS, { recursive: true })
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true })
}

async function expectSchedule(page, step) {
  const panel = page.getByRole('region', { name: 'Now and next' })
  try {
    await panel.waitFor({ timeout: 15000 })
  } catch (err) {
    console.log(`[${step}] page at ${page.url()} shows: ${(await page.locator('body').innerText()).slice(0, 400)}`)
    await shot(page, `fail-${step.replace(/\W+/g, '-')}`)
    throw err
  }
  const text = await panel.innerText()
  console.log(`[${step}] Now & next: ${text.replace(/\s+/g, ' ')}`)
  assert.match(text, /Synthetic Opener/, `${step}: Opener should be playing now`)
  assert.match(text, /40 min left/, `${step}: minutes left`)
  assert.match(text, /Synthetic Headliner/, `${step}: Headliner should be next`)
  await page.getByText('Synthetic Field Fest').first().waitFor({ timeout: 5000 })
}

// ── Run ──────────────────────────────────────────────────────────────────────
let preview
let browser
let failed = false
try {
  await new Promise(r => api.listen(API_PORT, '127.0.0.1', r))
  rmSync(OUT_DIR, { recursive: true, force: true })
  await run('npx', ['vite', 'build', '--outDir', OUT_DIR, '--logLevel', 'warn'], {
    VITE_SUPABASE_URL: API, VITE_SUPABASE_ANON_KEY: 'synthetic-anon-key',
  })
  preview = spawn('npx', ['vite', 'preview', '--outDir', OUT_DIR, '--port', String(APP_PORT), '--strictPort', '--host', 'localhost'], { stdio: 'ignore' })
  await waitForHttp(APP)

  browser = await chromium.launch()
  const context = await browser.newContext({ timezoneId: 'Europe/Amsterdam', locale: 'en-GB', viewport: { width: 390, height: 844 } })
  const page = await context.newPage()
  page.on('console', m => { if (m.type() === 'error') console.log(`  [browser error] ${m.text()}`) })
  await page.clock.setFixedTime(NOW)
  await context.addInitScript(([key, sess, fest]) => {
    if (localStorage.getItem('festplan_festival')) return  // seed once; reloads keep state
    localStorage.setItem('festplan_festival', fest)
    localStorage.setItem('festplan_artists', JSON.stringify(['Synthetic Opener', 'Synthetic Headliner']))
    localStorage.setItem(key, JSON.stringify(sess))
  }, [STORAGE_KEY, session(10 * 365 * 24 * 3600), FEST])

  // 1. Online
  await page.goto(`${APP}/schedule`)
  await expectSchedule(page, 'online')
  assert.equal(await page.getByRole('status', { name: 'Offline status' }).count(), 0, 'no badge while online')
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.reload()  // now controlled by the service worker, so data responses get cached
  await expectSchedule(page, 'online, service worker in control')
  assert.ok(await page.evaluate(() => !!navigator.serviceWorker.controller), 'service worker controls the page')
  await shot(page, '1-online')

  const runtimeCaches = await page.evaluate(async () => {
    const out = {}
    for (const name of await caches.keys()) {
      if (!name.startsWith('workbox-precache')) out[name] = (await (await caches.open(name)).keys()).length
    }
    return out
  })
  console.log(`[online] service-worker runtime caches: ${JSON.stringify(runtimeCaches)}`)
  assert.ok(runtimeCaches['supabase-festival'] >= 2, 'festival_meta and timetable_slots responses are cached')

  // Online reads of user data must be live, never a cached copy: a stale
  // artist list would be written back by the Setup page.
  const readRatings = () => page.evaluate(async api => {
    const r = await fetch(`${api}/rest/v1/artist_ratings?select=artist_name,rating`, { headers: { apikey: 'synthetic-anon-key' } })
    return r.json()
  }, API)
  assert.deepEqual(await readRatings(), [], 'first online read')
  await new Promise(r => setTimeout(r, 1000))  // let the service worker store it
  ratings = [{ artist_name: 'Synthetic Opener', rating: 5 }]
  assert.deepEqual(await readRatings(), ratings, 'online read after a server change is fresh, not the cached copy')
  console.log('[online] user-table read after a server change is fresh')

  // Slow network (festplan#82): Setup must never write a cache-served
  // artist list back over newer server data.
  // (The chips are hidden here because the fake backend has no Spotify
  // token, so read the list Setup keeps in localStorage.)
  const shownArtists = () => page.evaluate(() => JSON.parse(localStorage.getItem('festplan_artists') || '[]'))
  const settle = ms => new Promise(r => setTimeout(r, ms))
  await page.goto(`${APP}/setup`)
  await page.getByText('Your Spotify artists', { exact: false }).first().waitFor({ timeout: 15000 })
  await settle(2500)
  assert.deepEqual(artistWrites, [], 'loading Setup writes nothing back')
  artists = [...artists, 'Added Elsewhere']   // another device adds an artist
  artistsDelayMs = 5000                        // slower than the SW's 3 s timeout
  // Give this device a list that differs from the cached copy, so the test
  // can tell whether Setup recognised the cached answer (it must keep this).
  await page.evaluate(() => localStorage.setItem('festplan_artists',
    JSON.stringify(['Synthetic Opener', 'Synthetic Headliner', 'Device Copy'])))
  await page.reload()
  await settle(8000)  // past the SW timeout, the save debounce and the late response
  assert.deepEqual(artistWrites, [], 'a cache-served list is not written back')
  assert.deepEqual(artists, ['Synthetic Opener', 'Synthetic Headliner', 'Added Elsewhere'], 'server list intact')
  assert.deepEqual(await shownArtists(), ['Synthetic Opener', 'Synthetic Headliner', 'Device Copy'],
    'Setup recognised the cache-served answer and kept this device\'s list')
  console.log('[slow network] Setup served a cached list and wrote nothing back; server list intact')
  artistsDelayMs = 0
  await page.reload()
  await settle(2500)
  assert.ok((await shownArtists()).includes('Added Elsewhere'), "a fresh read shows the other device's artist")
  assert.deepEqual(artistWrites, [], 'still nothing written')
  console.log('[online] fresh Setup read shows the artist added elsewhere')
  await page.goto(`${APP}/schedule`)
  await expectSchedule(page, 'online, back on the schedule')

  // 2. Offline, timetable only in the service worker's cache
  await context.setOffline(true)
  await page.evaluate(fest => localStorage.removeItem(`festplan_timetable_${fest}`), FEST)
  await page.reload()
  await expectSchedule(page, 'offline, service-worker cache')
  assert.deepEqual(await readRatings(), [{ artist_name: 'Synthetic Opener', rating: 5 }], 'offline read falls back to the cached copy')
  const cacheMark = await page.evaluate(async api => {
    const r = await fetch(`${api}/rest/v1/artist_ratings?select=artist_name,rating`, { headers: { apikey: 'synthetic-anon-key' } })
    return r.headers.get('x-festplan-from-cache')
  }, API)
  assert.equal(cacheMark, '1', 'the app can see that a response came from the service-worker cache')
  const badge = await page.getByRole('status', { name: 'Offline status' }).innerText()
  console.log(`[offline] badge: ${badge.replace(/\s+/g, ' ')}`)
  assert.match(badge, /Offline, last synced 14:20/)
  await shot(page, '2-offline-sw-cache')

  // 3. Offline, expired access token, runtime caches gone (e.g. evicted)
  await page.evaluate(key => {
    const s = JSON.parse(localStorage.getItem(key))
    s.expires_at = Math.floor(Date.now() / 1000) - 3600
    localStorage.setItem(key, JSON.stringify(s))
  }, STORAGE_KEY)
  const dropped = await page.evaluate(async () => {
    const names = (await caches.keys()).filter(n => !n.startsWith('workbox-precache'))
    await Promise.all(names.map(n => caches.delete(n)))
    return names
  })
  console.log(`[offline] dropped runtime caches: ${dropped.join(', ')}`)
  await page.reload()
  await expectSchedule(page, 'offline, expired token, device copy')
  assert.ok(page.url().endsWith('/schedule'), `stayed on the schedule (not sent to login): ${page.url()}`)
  assert.match(await page.getByRole('status', { name: 'Offline status' }).innerText(), /Offline, last synced 14:20/)
  await shot(page, '3-offline-device-copy')

  console.log(`PASS offline e2e (${hits.length} fake-API requests while online)`)
} catch (err) {
  failed = true
  console.error('FAIL offline e2e:', err)
} finally {
  await browser?.close()
  preview?.kill()
  api.close()
  rmSync(OUT_DIR, { recursive: true, force: true })
}
process.exit(failed ? 1 : 0)
