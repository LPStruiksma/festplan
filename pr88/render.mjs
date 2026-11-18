// Synthetic render proof for festplan#88 (Lineup not announced yet).
// Run from a festplan checkout at the PR head:  node <this file> <out-dir>
// Builds the real app against a local fake Supabase (synthetic data only) and
// captures phone-sized screenshots of the Schedule page states.
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const require = createRequire(join(process.cwd(), 'package.json'))
let chromium
try { ({ chromium } = require('playwright')) } catch { ({ chromium } = require('/opt/node-tools/node_modules/playwright')) }

const OUT = resolve(process.argv[2] || 'render-out')
const API_PORT = 54339, APP_PORT = 4189
const API = `http://127.0.0.1:${API_PORT}`, APP = `http://localhost:${APP_PORT}`
const FEST = 'synthfest-2027'
const STORAGE_KEY = 'sb-127-auth-token'
const USER = { id: '00000000-0000-4000-8000-000000000001', email: 'synthetic@example.test', aud: 'authenticated', role: 'authenticated', user_metadata: {} }
const NOW = new Date('2026-11-18T21:00:00+01:00')
const BASE_META = { festival_key: FEST, name: 'Synthfest 2027', location: 'Testdorp, NL', emoji: '🌲',
  accent_color: '#4ade80', start_date: '2027-06-11', end_date: '2027-06-13',
  days: ['Fri Jun 11', 'Sat Jun 12', 'Sun Jun 13'], stages: [] }
const TIMED = [
  { artist: 'Synthetic Act A', stage: 'Synthetic Main', day_index: 0, start_time: '21:30', end_time: '23:00' },
  { artist: 'Synthetic Act B', stage: 'Synthetic Forest', day_index: 0, start_time: '20:00', end_time: '21:00' },
]
const state = { meta: BASE_META, slots: [], fail: false, delayMs: 0, saved: null }

function session(expiresIn) {
  const exp = Math.floor(Date.now() / 1000) + expiresIn
  return { access_token: 'synthetic-access', refresh_token: 'synthetic-refresh', token_type: 'bearer', expires_in: expiresIn, expires_at: exp, user: USER }
}
const api = createServer((req, res) => {
  const url = new URL(req.url, API)
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] || '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS')
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end() }
  const json = (body, status = 200) => setTimeout(() => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)) }, state.delayMs)
  const wantsObject = String(req.headers.accept || '').includes('vnd.pgrst.object')
  if (state.fail && url.pathname.startsWith('/rest/v1/festival')) return json({ message: 'synthetic outage' }, 500)
  if (state.fail && url.pathname.startsWith('/rest/v1/timetable')) return json({ message: 'synthetic outage' }, 500)
  if (url.pathname === '/rest/v1/festival_meta') return json(wantsObject ? state.meta : (state.meta ? [state.meta] : []))
  if (url.pathname === '/rest/v1/timetable_slots') return json(state.slots)
  if (url.pathname === '/rest/v1/user_artists') return json([{ artist_name: 'Synthetic Saved Artist' }])
  if (url.pathname.startsWith('/rest/v1/')) return json(wantsObject ? null : [])
  if (url.pathname === '/auth/v1/user') return json(USER)
  if (url.pathname === '/auth/v1/token') return json(session(3600))
  if (url.pathname.startsWith('/functions/v1/')) return json({})
  json({ message: 'not found' }, 404)
})
function run(cmd, args, env = {}) {
  return new Promise((ok, bad) => { const p = spawn(cmd, args, { stdio: 'inherit', env: { ...process.env, ...env } }); p.on('exit', c => (c === 0 ? ok() : bad(new Error(cmd + ' exited ' + c)))) })
}
async function waitForHttp(url) {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(url)).ok) return } catch { /* not yet */ } await new Promise(r => setTimeout(r, 200)) }
  throw new Error('timeout ' + url)
}

const results = []
// Discovery metadata as SetupPage saves it (verified dates included); used when
// festival_meta has no row, which is the only path to an announced lineup with
// no timetable (fetchTimetable switches to timetable mode for any slot).
const SAVED = { id: FEST, name: 'Synthfest 2027', location: 'Testdorp, NL', emoji: '🌲', accentColor: '#4ade80',
  startDate: '2027-06-11', endDate: '2027-06-13' }
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null
async function capture(browser, name, opts = {}) {
  if (ONLY && !ONLY.test(name)) return
  return captureNow(browser, name, opts)
}
async function captureNow(browser, name, { width = 360, height = 780, scheme = 'dark', setup, before, after } = {}) {
  Object.assign(state, { meta: BASE_META, slots: [], fail: false, delayMs: 0, saved: null }, setup || {})
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    colorScheme: scheme, locale: 'en-GB', timezoneId: 'Europe/Amsterdam', serviceWorkers: 'block' })
  const page = await context.newPage()
  await page.clock.setFixedTime(NOW)
  await context.addInitScript(([key, sess, fest, saved]) => {
    localStorage.setItem('festplan_festival', fest)
    localStorage.setItem('festplan_artists', JSON.stringify(['Synthetic Saved Artist']))
    localStorage.setItem(key, JSON.stringify(sess))
    // Saved discovery metadata (SetupPage) for the lineup-only fallback states.
    if (saved) localStorage.setItem('festplan_festival_meta', JSON.stringify(saved))
  }, [STORAGE_KEY, session(3600 * 24 * 365), FEST, state.saved])
  if (before) await before(page, context)
  await page.goto(`${APP}/schedule`)
  if (after) await after(page, context)
  else await page.getByText(/Lineup not announced yet|Timetable Coming Soon|My Schedule/i).first().waitFor({ timeout: 15000 })
  await page.waitForTimeout(700)
  mkdirSync(OUT, { recursive: true })
  await page.screenshot({ path: join(OUT, `${name}.png`) })
  const card = page.getByRole('region', { name: /Lineup not announced yet/i })
  const box = (await card.count()) ? await card.boundingBox() : null
  const back = page.getByRole('button', { name: /back/i }).first()
  const backBox = (await back.count()) ? await back.boundingBox() : null
  const overflowX = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  const text = (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 600)
  results.push({ name, viewport: `${width}x${height} CSS @3x = ${width * 3}x${height * 3}`, scheme, card: box, back: backBox, horizontalOverflowPx: overflowX,
    cardInFirstScreen: box ? box.y + box.height <= height : null,
    claimsActs: /Timetable Coming Soon|listed below|My picks only/i.test(text),
    showsOfficialDates: /Jun|2027-06/.test(text), text })
  await context.close()
}

let preview, browser
try {
  await new Promise(r => api.listen(API_PORT, '127.0.0.1', r))
  rmSync('dist-render', { recursive: true, force: true })
  await run('npx', ['vite', 'build', '--outDir', 'dist-render', '--logLevel', 'warn'], { VITE_SUPABASE_URL: API, VITE_SUPABASE_ANON_KEY: 'synthetic-anon-key' })
  preview = spawn('npx', ['vite', 'preview', '--outDir', 'dist-render', '--port', String(APP_PORT), '--strictPort', '--host', 'localhost'], { stdio: 'ignore' })
  await waitForHttp(APP)
  browser = await chromium.launch()
  await capture(browser, '01-zero-lineup-360x780-dark')
  await capture(browser, '02-zero-lineup-390x844-dark', { width: 390, height: 844 })
  await capture(browser, '03-zero-lineup-360x780-prefers-light', { scheme: 'light' })
  await capture(browser, '04-zero-lineup-long-name-360', { setup: { meta: { ...BASE_META,
    name: 'Synthetic Extraordinarily Long Festival Name Weekend Edition 2027', location: 'A very long synthetic place name that has to wrap on a phone, NL' } } })
  await capture(browser, '05-zero-lineup-text-200pct-360', { before: async (_p, ctx) => ctx.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.zoom = '2' }) }) })
  await capture(browser, '06-zero-lineup-keyboard-focus-360', { after: async page => {
    await page.getByText(/Lineup not announced yet/i).waitFor({ timeout: 15000 })
    await page.keyboard.press('Tab')
    results.push({ name: '06-focused-element', focused: await page.evaluate(() => `${document.activeElement.tagName} ${document.activeElement.getAttribute('aria-label') || document.activeElement.textContent.trim().slice(0, 40)}`) })
  } })
  await capture(browser, '07-full-timetable-contrast-360', { setup: { slots: TIMED, meta: { ...BASE_META, stages: ['Synthetic Main', 'Synthetic Forest'] } } })
  await capture(browser, '08-loading-360', { setup: { delayMs: 20000 }, after: async page => { await page.getByText(/Loading festival/i).waitFor({ timeout: 8000 }) } })
  await capture(browser, '09-error-360', { setup: { fail: true }, after: async page => { await page.getByRole('button', { name: /retry/i }).waitFor({ timeout: 15000 }) } })
  await capture(browser, '10-offline-snapshot-360', {
    before: async (page, ctx) => {
      await page.goto(`${APP}/schedule`)
      await page.getByText(/Lineup not announced yet/i).waitFor({ timeout: 15000 })
      await page.waitForTimeout(500)
      // No service worker here, so keep the app shell reachable and cut only the
      // backend; report the browser as offline so the app uses its saved copy.
      await ctx.route(`${API}/**`, route => route.abort('internetdisconnected'))
      await ctx.addInitScript(() => {
        Object.defineProperty(Navigator.prototype, 'onLine', { get: () => false })
      })
    },
    after: async page => { await page.getByText(/Lineup not announced yet/i).waitFor({ timeout: 15000 }) },
  })
  // Announced lineup, no verified set times (saved-metadata fallback).
  const fallback = matched => ({ meta: null, saved: { ...SAVED, matchedArtists: matched } })
  await capture(browser, '11-announced-untimed-pick-360x780-dark', { setup: fallback(['Synthetic Saved Artist', 'Synthetic Other Act']) })
  await capture(browser, '12-announced-untimed-pick-390x844-dark', { width: 390, height: 844, setup: fallback(['Synthetic Saved Artist', 'Synthetic Other Act']) })
  await capture(browser, '13-announced-untimed-picks-only-filter-390', { width: 390, height: 844, setup: fallback(['Synthetic Saved Artist', 'Synthetic Other Act']),
    after: async page => {
      await page.getByText(/Timetable Coming Soon/i).waitFor({ timeout: 15000 })
      await page.getByRole('button', { name: /My picks only/i }).click()
    } })
  await capture(browser, '14-announced-untimed-zero-matching-picks-390', { width: 390, height: 844, setup: fallback(['Synthetic Other Act']) })
  await capture(browser, '15-scheduled-no-picks-390', { width: 390, height: 844,
    setup: { slots: TIMED, meta: { ...BASE_META, stages: ['Synthetic Main', 'Synthetic Forest'] } } })
  await capture(browser, '16-zero-lineup-via-saved-metadata-390', { width: 390, height: 844, setup: fallback([]) })
  writeFileSync(join(OUT, 'summary.json'), JSON.stringify(results, null, 2))
  console.log(JSON.stringify(results.map(r => ({ name: r.name, card: !!r.card, inFirst: r.cardInFirstScreen, overflow: r.horizontalOverflowPx, claimsActs: r.claimsActs, focused: r.focused })), null, 1))
} finally {
  await browser?.close()
  preview?.kill()
  api.close()
  rmSync('dist-render', { recursive: true, force: true })
}
