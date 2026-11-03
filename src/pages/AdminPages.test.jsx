// @vitest-environment jsdom
import React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../lib/admin-api', () => ({
  listFestivals:       vi.fn(() => Promise.resolve([])),
  getFestivalWithSlots: vi.fn(() => Promise.resolve({
    meta:  { festival_key: 'demo', name: 'Demo Fest', days: ['Fri'] },
    slots: [],
  })),
  updateFestivalMeta:  vi.fn(),
  upsertSlot:          vi.fn(),
  deleteSlot:          vi.fn(),
  discoverFestivalsLive:    vi.fn(() => Promise.resolve([])),
  ingestDiscoveredFestival: vi.fn(() => Promise.resolve({ ok: true })),
  notYetIngested:           vi.fn(() => []),
}))

vi.mock('../lib/profile', () => ({
  loadArtistsFromCache: vi.fn(() => ['Radiohead', 'Bicep']),
}))

vi.mock('../lib/supabase', () => ({
  supabase: { auth: { getSession: vi.fn() } },
}))

import {
  listFestivals, getFestivalWithSlots,
  discoverFestivalsLive, ingestDiscoveredFestival, notYetIngested,
} from '../lib/admin-api'
import AdminFestivals from './AdminFestivals'
import AdminFestivalEdit from './AdminFestivalEdit'
import AdminIngest from './AdminIngest'

const ADMIN = 'admin@example.test'
const adminSession = { user: { email: ADMIN } }
const otherSession = { user: { email: 'someone@example.test' } }

const pages = [
  { name: 'AdminFestivals',    Page: AdminFestivals,    path: '/admin/festivals',      url: '/admin/festivals',      api: listFestivals },
  { name: 'AdminFestivalEdit', Page: AdminFestivalEdit, path: '/admin/festivals/:id',  url: '/admin/festivals/demo', api: getFestivalWithSlots },
  { name: 'AdminIngest',       Page: AdminIngest,       path: '/admin/ingest',         url: '/admin/ingest',         api: null },
]

function ui(Page, path, url, session) {
  return (
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path={path} element={<Page session={session} />} />
      </Routes>
    </MemoryRouter>
  )
}

beforeEach(() => {
  vi.stubEnv('VITE_ADMIN_EMAIL', ADMIN)
  vi.clearAllMocks()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe.each(pages)('$name', ({ Page, path, url, api }) => {
  it('denies a missing session without loading admin data', () => {
    render(ui(Page, path, url, null))
    expect(screen.getByText('Access denied')).toBeInTheDocument()
    if (api) expect(api).not.toHaveBeenCalled()
  })

  it('denies a non-admin session without loading admin data', () => {
    render(ui(Page, path, url, otherSession))
    expect(screen.getByText('Access denied')).toBeInTheDocument()
    if (api) expect(api).not.toHaveBeenCalled()
  })

  it('renders for the admin', async () => {
    render(ui(Page, path, url, adminSession))
    expect(screen.queryByText('Access denied')).not.toBeInTheDocument()
    if (api) await waitFor(() => expect(api).toHaveBeenCalledTimes(1))
  })

  // The session arrives asynchronously, so the same mounted page first
  // renders signed out and then as the admin. Hooks after the auth gate
  // made React throw "Rendered more hooks than during the previous render".
  it('survives the session arriving after mount', async () => {
    const { rerender } = render(ui(Page, path, url, null))
    expect(screen.getByText('Access denied')).toBeInTheDocument()
    rerender(ui(Page, path, url, adminSession))
    expect(screen.queryByText('Access denied')).not.toBeInTheDocument()
    if (api) await waitFor(() => expect(api).toHaveBeenCalledTimes(1))
  })
})

// ── One-click ingest of discovered festivals (festplan#30) ───────────────────

describe('AdminFestivals discovered festivals', () => {
  const beta  = { id: 'beta-fest',  name: 'Beta Fest 2026',  location: 'Betatown', startDate: '2026-07-04', endDate: '2026-07-06', tmEventIds: ['B1', 'B2', 'B3'] }
  const gamma = { id: 'gamma-fest', name: 'Gamma Fest 2026', location: 'Gammaville', startDate: '2026-08-01', endDate: '2026-08-01', tmEventIds: ['G1'] }

  beforeEach(async () => {
    const real = await vi.importActual('../lib/admin-api')
    notYetIngested.mockImplementation(real.notYetIngested)
    listFestivals.mockResolvedValue([{ festival_key: 'alpha-fest', name: 'Alpha Fest', stages: [] }])
    discoverFestivalsLive.mockResolvedValue([
      { id: 'alpha-fest', name: 'Alpha Fest 2026', tmEventIds: ['A1'] },
      beta,
      gamma,
    ])
  })

  it('lists only discovered festivals not yet in festival_meta, using the saved artists', async () => {
    render(ui(AdminFestivals, '/admin/festivals', '/admin/festivals', adminSession))
    await waitFor(() => expect(listFestivals).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: /find festivals/i }))

    expect(await screen.findByText('Beta Fest 2026')).toBeInTheDocument()
    expect(screen.getByText('Gamma Fest 2026')).toBeInTheDocument()
    expect(screen.queryByText('Alpha Fest 2026')).not.toBeInTheDocument()
    expect(discoverFestivalsLive).toHaveBeenCalledWith(['Radiohead', 'Bicep'])
    expect(screen.getAllByRole('button', { name: /^ingest/i })).toHaveLength(2)
  })

  it('Ingest sends the festival it already knows and refreshes the list', async () => {
    render(ui(AdminFestivals, '/admin/festivals', '/admin/festivals', adminSession))
    await waitFor(() => expect(listFestivals).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: /find festivals/i }))
    await screen.findByText('Beta Fest 2026')

    listFestivals.mockResolvedValue([
      { festival_key: 'alpha-fest', name: 'Alpha Fest', stages: [] },
      { festival_key: 'beta-fest',  name: 'Beta Fest',  stages: [] },
    ])
    fireEvent.click(screen.getByRole('button', { name: 'Ingest Beta Fest 2026' }))

    await waitFor(() => expect(ingestDiscoveredFestival).toHaveBeenCalledWith(beta))
    await waitFor(() => expect(screen.queryByText('Beta Fest 2026')).not.toBeInTheDocument())
    expect(listFestivals).toHaveBeenCalledTimes(2)
    expect(screen.getByText('Gamma Fest 2026')).toBeInTheDocument()
  })

  it('shows the ingest error and keeps the festival listed', async () => {
    ingestDiscoveredFestival.mockRejectedValueOnce(new Error('Forbidden — admin only'))
    render(ui(AdminFestivals, '/admin/festivals', '/admin/festivals', adminSession))
    await waitFor(() => expect(listFestivals).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: /find festivals/i }))
    fireEvent.click(await screen.findByRole('button', { name: 'Ingest Gamma Fest 2026' }))

    expect(await screen.findByText(/Forbidden — admin only/)).toBeInTheDocument()
    expect(screen.getByText('Gamma Fest 2026')).toBeInTheDocument()
  })

  it('does not call Ticketmaster for a non-admin', () => {
    render(ui(AdminFestivals, '/admin/festivals', '/admin/festivals', otherSession))
    expect(discoverFestivalsLive).not.toHaveBeenCalled()
  })
})
