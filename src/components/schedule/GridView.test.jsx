// @vitest-environment jsdom
import React from 'react'
import '@testing-library/jest-dom'
import { render, screen, within } from '@testing-library/react'
import GridView from './GridView'

const slot = (artist, stage, start, end) => ({ artist, stage, start, end })
const baseProps = {
  dayLineup: [],
  stages: ['Main Stage', 'Second Stage'],
  myArtists: [],
}

describe('GridView accessible timetable', () => {
  test('labels the timetable, time axis, and actual stage columns without synthetic stages', () => {
    render(<GridView {...baseProps} dayLineup={[
      slot('Radiohead', 'Main Stage', '21:00', '22:30'),
    ]} />)

    expect(screen.getByRole('region', { name: 'Timetable grid' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Time', level: 3 })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Main Stage', level: 3 })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Second Stage', level: 3 })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Main Stage slots' })).toBeInTheDocument()
    expect(screen.getByText('14:00')).toBeInTheDocument()
    expect(screen.getByText('00:00')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Third Stage' })).not.toBeInTheDocument()
  })

  test('announces stage, exact slot times and pick status while still showing non-picks', () => {
    render(<GridView {...baseProps} myArtists={['rAdIoHeAd']} dayLineup={[
      slot('Radiohead', 'Main Stage', '21:00', '22:30'),
      slot('Bicep', 'Main Stage', '22:30', '23:30'),
    ]} />)

    const stage = screen.getByRole('group', { name: 'Main Stage slots' })
    const pick = within(stage).getByRole('group', {
      name: 'Radiohead, Main Stage, 21:00 to 22:30, your pick',
    })
    const nonPick = within(stage).getByRole('group', {
      name: 'Bicep, Main Stage, 22:30 to 23:30, not in your picks',
    })
    expect(within(pick).getByText('Radiohead')).toBeInTheDocument()
    expect(within(nonPick).getByText('Bicep')).toBeInTheDocument()
    expect(pick).toHaveStyle({ top: '589px', height: '124px' })
    expect(nonPick).toHaveStyle({ top: '715px', height: '82px' })
  })

  test('does not claim that an empty stage has no scheduled acts when the current view may be filtered', () => {
    render(<GridView {...baseProps} dayLineup={[
      slot('Radiohead', 'Main Stage', '21:00', '22:30'),
    ]} />)

    expect(within(screen.getByRole('group', { name: 'Second Stage slots' }))
      .getByText('No timed acts shown on this stage in the current view.')).toBeInTheDocument()
    expect(screen.queryByText('No acts shown for this day in the current view.')).not.toBeInTheDocument()
  })

  test('explains an entirely empty visible day without inventing stages, times or picks', () => {
    render(<GridView {...baseProps} />)

    expect(screen.getByText('No acts shown for this day in the current view.')).toBeInTheDocument()
    expect(screen.queryByText('No timed acts shown on this stage in the current view.')).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: /your pick/ })).not.toBeInTheDocument()
  })

  test('shows a truthful fallback when stage information is unavailable', () => {
    render(<GridView {...baseProps} stages={[]} dayLineup={[
      slot('Unplaced Act', null, '20:00', '21:00'),
    ]} />)

    expect(screen.getByText('No stages are available for this grid.')).toBeInTheDocument()
    expect(screen.getByText(/Unplaced Act/)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Main Stage' })).not.toBeInTheDocument()
  })

  test('does not invent a time coordinate for an act without a published time', () => {
    render(<GridView {...baseProps} dayLineup={[
      slot('Unknown Time', 'Main Stage', null, null),
    ]} />)

    expect(screen.getByText(/Unknown Time/)).toBeInTheDocument()
    expect(screen.getByText(/Not positioned on the grid/)).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: /Unknown Time.*to/ })).not.toBeInTheDocument()
  })

  test('positions a real overnight slot after midnight using the existing grid coordinates', () => {
    render(<GridView {...baseProps} dayLineup={[
      slot('Night Act', 'Second Stage', '00:00', '01:00'),
    ]} />)

    const overnight = screen.getByRole('group', {
      name: 'Night Act, Second Stage, 00:00 to 01:00, not in your picks',
    })
    expect(overnight).toHaveStyle({ top: '841px', height: '82px' })
    expect(within(overnight).getByText('00:00–01:00')).toBeInTheDocument()
  })
})
