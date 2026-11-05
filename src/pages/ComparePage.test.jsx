// @vitest-environment jsdom
import React from 'react'
import { fireEvent, render, screen, within, waitFor } from '@testing-library/react'
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

describe('ComparePage saved artist coverage filter', () => {
  const tableBody = () => within(screen.getByRole('table').querySelector('tbody'))

  it('defaults to All and shows only shared or exclusive artists while preserving totals', async () => {
    localStorage.setItem('festplan_artists', JSON.stringify(['Daft Punk', 'Justice', 'Phoenix', 'Air', 'Absent']))
    const lineups = {
      a: ['Daft Punk', 'Justice', 'Phoenix'],
      b: ['Daft Punk', 'Air'],
      c: ['Daft Punk', 'Justice'],
    }
    fetchTimetable.mockImplementation(id =>
      Promise.resolve(festival(id, `Festival ${id}`, lineups[id].map(artist => ({ artist, stage: 'Main' })))))

    renderCompare('a,b,c')
    expect(await screen.findByText('Phoenix')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'All' })).toBeChecked()
    expect(tableBody().getByText('Daft Punk')).toBeInTheDocument()
    expect(tableBody().getByText('Justice')).toBeInTheDocument()
    expect(tableBody().getByText('Air')).toBeInTheDocument()
    expect(screen.getByText('4 matched artists shown')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('radio', { name: 'Shared' }))
    expect(tableBody().getByText('Daft Punk')).toBeInTheDocument()
    expect(tableBody().getByText('Justice')).toBeInTheDocument()
    expect(tableBody().queryByText('Phoenix')).not.toBeInTheDocument()
    expect(tableBody().queryByText('Air')).not.toBeInTheDocument()
    expect(screen.getByText('2 matched artists shown')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('radio', { name: 'Exclusive' }))
    expect(tableBody().getByText('Phoenix')).toBeInTheDocument()
    expect(tableBody().getByText('Air')).toBeInTheDocument()
    expect(tableBody().queryByText('Daft Punk')).not.toBeInTheDocument()
    expect(tableBody().queryByText('Justice')).not.toBeInTheDocument()
    expect(screen.getByText('2 matched artists shown')).toBeInTheDocument()

    // These totals count each festival's matches, not the currently visible rows.
    expect(within(screen.getByRole('table').querySelector('tfoot')).getByText('3')).toBeInTheDocument()
    expect(within(screen.getByRole('table').querySelector('tfoot')).getAllByText('2')).toHaveLength(2)
    expect(screen.getByLabelText('Match count bar chart')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('radio', { name: 'All' }))
    expect(tableBody().getByText('Daft Punk')).toBeInTheDocument()
    expect(tableBody().getByText('Phoenix')).toBeInTheDocument()
    expect(screen.getByText('4 matched artists shown')).toBeInTheDocument()
  })

  it('explains an empty filter result and retains the comparison table and its totals', async () => {
    fetchTimetable.mockImplementation(id =>
      Promise.resolve(festival(id, `Festival ${id}`, [{ artist: 'Daft Punk', stage: 'Main' }])))

    renderCompare('a,b')
    expect(await screen.findByText('Daft Punk')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: 'Exclusive' }))

    expect(screen.getByText('No saved artists match the Exclusive filter.')).toBeInTheDocument()
    expect(screen.getByText('0 matched artists shown')).toBeInTheDocument()
    expect(within(screen.getByRole('table').querySelector('tfoot')).getAllByText('1')).toHaveLength(2)
    expect(screen.getByRole('radio', { name: 'Exclusive' })).toBeChecked()
  })

  it('does not count failed festival columns as matches, and keeps retry available', async () => {
    localStorage.setItem('festplan_artists', JSON.stringify(['Daft Punk', 'Justice']))
    fetchTimetable.mockImplementation(id => {
      if (id === 'bad') return Promise.reject(new Error('network down'))
      const artists = id === 'a' ? ['Daft Punk', 'Justice'] : ['Justice']
      return Promise.resolve(festival(id, `Festival ${id}`, artists.map(artist => ({ artist, stage: 'Main' }))))
    })

    renderCompare('a,b,bad')
    expect(await screen.findByText("Couldn't load this festival")).toBeInTheDocument()

    fireEvent.click(screen.getByRole('radio', { name: 'Shared' }))
    expect(tableBody().getByText('Justice')).toBeInTheDocument()
    expect(tableBody().queryByText('Daft Punk')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('radio', { name: 'Exclusive' }))
    expect(tableBody().getByText('Daft Punk')).toBeInTheDocument()
    expect(tableBody().queryByText('Justice')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry?' })).toBeEnabled()
    expect(screen.getByText("Couldn't load this festival")).toBeInTheDocument()
  })

  it('preserves the no-matches message when loaded festivals have no saved artists', async () => {
    fetchTimetable.mockImplementation(id =>
      Promise.resolve(festival(id, `Festival ${id}`, [{ artist: 'Someone Else', stage: 'Main' }])))

    renderCompare('a,b')
    expect(await screen.findByText('None of your saved artists appear in these festivals.')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'All' })).toBeChecked()
    expect(screen.getByText('0 matched artists shown')).toBeInTheDocument()
  })

  it('recomputes Shared and Exclusive after a failed column is retried successfully', async () => {
    let attempts = 0
    fetchTimetable.mockImplementation(id => {
      if (id === 'bad' && ++attempts === 1) return Promise.reject(new Error('offline'))
      return Promise.resolve(festival(id, `Festival ${id}`, [{ artist: 'Daft Punk', stage: 'Main' }]))
    })

    renderCompare('a,bad')
    expect(await screen.findByText("Couldn't load this festival")).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: 'Shared' }))
    expect(screen.getByText('No saved artists match the Shared filter.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Retry?' }))
    await waitFor(() => expect(tableBody().getByText('Daft Punk')).toBeInTheDocument())
    expect(screen.queryByText("Couldn't load this festival")).not.toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Shared' })).toBeChecked()
  })
})
