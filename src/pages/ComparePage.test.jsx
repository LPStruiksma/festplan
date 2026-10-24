// @vitest-environment jsdom
import React from 'react'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

vi.mock('../lib/api', () => ({ fetchTimetable: vi.fn() }))

import { fetchTimetable } from '../lib/api'
import ComparePage from './ComparePage'

function festival(id, name, lineup) {
  return { festival: { id, name, emoji: '🎵', accentColor: '#123456', lineup } }
}

function renderCompare(ids) {
  return render(
    <MemoryRouter initialEntries={[`/compare?ids=${ids}`]}>
      <Routes>
        <Route path="/compare" element={<ComparePage />} />
        <Route path="/setup" element={<div>setup page</div>} />
      </Routes>
    </MemoryRouter>
  )
}

beforeEach(() => {
  fetchTimetable.mockReset()
  localStorage.setItem('festplan_artists', JSON.stringify(['Daft Punk']))
})

describe('ComparePage per-festival failure placeholder', () => {
  it('shows a placeholder for a festival whose fetch rejects and still renders the others', async () => {
    fetchTimetable.mockImplementation(id => id === 'bad'
      ? Promise.reject(new Error('network down'))
      : Promise.resolve(festival('good', 'Good Fest', [{ artist: 'Daft Punk', stage: 'Main', start: '21:00' }])))

    renderCompare('good,bad')

    expect(await screen.findByText("Couldn't load this festival")).toBeInTheDocument()
    expect(screen.getAllByText('Good Fest').length).toBeGreaterThan(0)
    expect(screen.getByText('Main · 21:00')).toBeInTheDocument()
  })

  it('shows a placeholder for a festival whose data cannot be processed instead of hanging on loading', async () => {
    fetchTimetable.mockImplementation(id => id === 'bad'
      ? Promise.resolve(festival('bad', 'Bad Fest', [{ artist: null, stage: 'X' }]))
      : Promise.resolve(festival('good', 'Good Fest', [{ artist: 'Daft Punk', stage: 'Main', start: '21:00' }])))

    renderCompare('good,bad')

    expect(await screen.findByText("Couldn't load this festival")).toBeInTheDocument()
    expect(screen.getAllByText('Good Fest').length).toBeGreaterThan(0)
    expect(screen.queryByText(/Loading 2 festivals/)).not.toBeInTheDocument()
  })

  it('shows the page-level error only when every festival fails', async () => {
    fetchTimetable.mockImplementation(() => Promise.resolve(null))

    renderCompare('a,b')

    expect(await screen.findByText('None of the selected festivals could be loaded.')).toBeInTheDocument()
  })
})
