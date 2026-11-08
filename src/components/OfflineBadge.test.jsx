// @vitest-environment jsdom
import React from 'react'
import { render, screen, act } from '@testing-library/react'
import '@testing-library/jest-dom'
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import OfflineBadge from './OfflineBadge'
import { markSynced, pushPendingWrite } from '../lib/sync-state'

const badge = () => screen.queryByRole('status', { name: 'Offline status' })
const local = (d, h, m) => new Date(2026, 5, d, h, m).getTime()  // device clock

beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('OfflineBadge', () => {
  it('stays hidden while online with live data', () => {
    render(<OfflineBadge online />)
    expect(badge()).toBeNull()
  })

  it('shows "Offline, last synced HH:MM" when offline', () => {
    markSynced(local(26, 14, 32))
    render(<OfflineBadge online={false} now={local(26, 18, 0)} />)
    expect(badge()).toHaveTextContent('Offline, last synced 14:32')
    expect(badge()).toHaveTextContent("Changes you make will sync when you're back online.")
  })

  it('names the day when the last sync was not today', () => {
    markSynced(local(26, 23, 5))  // Friday
    render(<OfflineBadge online={false} now={local(27, 9, 0)} />)
    expect(badge()).toHaveTextContent('Offline, last synced Fri 23:05')
  })

  it('counts writes waiting to sync', () => {
    pushPendingWrite({ type: 'rating', args: ['u', 'f', 'A', 3], seq: 1 })
    pushPendingWrite({ type: 'rating', args: ['u', 'f', 'B', 4], seq: 2 })
    render(<OfflineBadge online={false} />)
    expect(badge()).toHaveTextContent("2 changes will sync when you're back online.")
  })

  it('updates the count as soon as a write is queued', () => {
    render(<OfflineBadge online={false} />)
    expect(badge()).toHaveTextContent('Changes you make will sync')
    act(() => { pushPendingWrite({ type: 'rating', args: ['u', 'f', 'A', 3], seq: 1 }) })
    expect(badge()).toHaveTextContent("1 change will sync when you're back online.")
  })

  it('shows when the saved timetable is used although the browser is online', () => {
    render(<OfflineBadge online fromCache />)
    expect(badge()).toHaveTextContent("Couldn't reach FestPlan")
  })

  it('follows the browser going offline and back online', () => {
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    render(<OfflineBadge />)
    expect(badge()).toBeNull()
    onLine.mockReturnValue(false)
    act(() => { window.dispatchEvent(new Event('offline')) })
    expect(badge()).toHaveTextContent('Offline')
    onLine.mockReturnValue(true)
    act(() => { window.dispatchEvent(new Event('online')) })
    expect(badge()).toBeNull()
  })
})
