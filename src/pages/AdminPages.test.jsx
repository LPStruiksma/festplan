// @vitest-environment jsdom
import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
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
}))

vi.mock('../lib/supabase', () => ({
  supabase: { auth: { getSession: vi.fn() } },
}))

import { listFestivals, getFestivalWithSlots } from '../lib/admin-api'
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
