// @vitest-environment jsdom
import React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

vi.mock('../lib/supabase', () => ({
  supabase: { auth: { signInWithOAuth: vi.fn() } },
}))
vi.mock('../lib/invites', () => ({
  getInvite: vi.fn(),
  acceptInvite: vi.fn(),
}))
vi.mock('../lib/schedule-store', () => ({
  LS_FESTIVAL_KEY: 'festplan_festival',
  saveFestivalKey: vi.fn(),
}))

import { supabase } from '../lib/supabase'
import { getInvite, acceptInvite } from '../lib/invites'
import { saveFestivalKey } from '../lib/schedule-store'
import JoinPage from './JoinPage'

const INVITE = {
  slug: 'synthetic-slug',
  festival_key: 'synthetic-festival',
  inviter_user_id: 'synthetic-owner',
}
const SESSION = { user: { id: 'synthetic-joiner' } }

function renderJoin(session = SESSION, path = '/join/synthetic-slug') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/join/:slug" element={<JoinPage session={session} />} />
        <Route path="/schedule" element={<div>schedule destination</div>} />
        <Route path="/" element={<div>home destination</div>} />
        <Route path="/join" element={<JoinPage session={session} />} />
      </Routes>
    </MemoryRouter>
  )
}

beforeEach(() => {
  localStorage.clear()
  supabase.auth.signInWithOAuth.mockReset()
  getInvite.mockReset()
  acceptInvite.mockReset()
  saveFestivalKey.mockReset()
  supabase.auth.signInWithOAuth.mockResolvedValue({ data: { url: 'https://example.invalid/oauth' }, error: null })
  getInvite.mockResolvedValue(INVITE)
  acceptInvite.mockResolvedValue(INVITE.festival_key)
  saveFestivalKey.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('JoinPage synthetic invite recovery', () => {
  it('keeps the pending callback slug and existing Spotify scopes for signed-out visitors', async () => {
    renderJoin(null)
    await waitFor(() => expect(supabase.auth.signInWithOAuth).toHaveBeenCalledTimes(1))
    expect(supabase.auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'spotify',
      options: {
        redirectTo: window.location.origin + '/auth/callback',
        scopes: 'user-library-read user-top-read',
      },
    })
    expect(localStorage.getItem('festplan_pending_invite')).toBe(INVITE.slug)
    expect(screen.getByText(/Log in with Spotify first/)).toBeInTheDocument()
    expect(getInvite).not.toHaveBeenCalled()
  })

  it('shows recoverable error instead of a spinner when Spotify returns an OAuth error', async () => {
    supabase.auth.signInWithOAuth.mockResolvedValueOnce({ data: null, error: new Error('denied') })
    renderJoin(null)
    expect(await screen.findByRole('alert')).toHaveTextContent(/Spotify sign-in could not start/i)
    expect(screen.queryByText('One sec…')).not.toBeInTheDocument()
    expect(localStorage.getItem('festplan_pending_invite')).toBe(INVITE.slug)
    expect(screen.getByRole('button', { name: /Try Again/i })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: /Try Again/i }))
    await waitFor(() => expect(supabase.auth.signInWithOAuth).toHaveBeenCalledTimes(2))
    expect(screen.getByText(/Log in with Spotify first/)).toBeInTheDocument()
  })

  it('handles a rejected OAuth promise and offers home as an alternative', async () => {
    supabase.auth.signInWithOAuth.mockRejectedValueOnce(new Error('offline'))
    renderJoin(null)
    expect(await screen.findByRole('alert')).toHaveTextContent(/Spotify sign-in could not start/i)
    fireEvent.click(screen.getByRole('button', { name: /Go Home/i }))
    expect(screen.getByText('home destination')).toBeInTheDocument()
  })

  it('explains an expired or missing invite, with an actionable retry', async () => {
    getInvite.mockResolvedValueOnce(null)
    renderJoin()
    expect(await screen.findByRole('alert')).toHaveTextContent(/expired or doesn't exist/i)
    expect(screen.getByRole('button', { name: /Try Again/i })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: /Try Again/i }))
    await waitFor(() => expect(acceptInvite).toHaveBeenCalledWith(INVITE, SESSION))
    expect(await screen.findByText("You're in!")).toBeInTheDocument()
  })

  it('recovers from a failed invite lookup without accepting a missing invite', async () => {
    getInvite.mockRejectedValueOnce(new Error('network unavailable'))
    renderJoin()
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not check this invite/i)
    expect(acceptInvite).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /Try Again/i }))
    expect(await screen.findByText("You're in!")).toBeInTheDocument()
  })

  it('recovers when acceptInvite returns null and preserves the pending slug until success', async () => {
    localStorage.setItem('festplan_pending_invite', INVITE.slug)
    acceptInvite.mockResolvedValueOnce(null)
    renderJoin()
    expect(await screen.findByRole('alert')).toHaveTextContent(/went wrong while joining/i)
    expect(localStorage.getItem('festplan_pending_invite')).toBe(INVITE.slug)
    expect(saveFestivalKey).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /Try Again/i }))
    expect(await screen.findByText("You're in!")).toBeInTheDocument()
    expect(localStorage.getItem('festplan_pending_invite')).toBeNull()
  })

  it('renders recovery when accepting an invite rejects unexpectedly', async () => {
    acceptInvite.mockRejectedValueOnce(new Error('offline'))
    renderJoin()
    expect(await screen.findByRole('alert')).toHaveTextContent(/went wrong while joining/i)
    expect(screen.getByRole('button', { name: /Try Again/i })).toBeEnabled()
  })

  it('does not hang when festival-key persistence rejects; retry can finish', async () => {
    localStorage.setItem('festplan_pending_invite', INVITE.slug)
    saveFestivalKey.mockRejectedValueOnce(new Error('storage unavailable'))
    renderJoin()
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not finish opening this festival/i)
    expect(localStorage.getItem('festplan_pending_invite')).toBe(INVITE.slug)
    fireEvent.click(screen.getByRole('button', { name: /Try Again/i }))
    expect(await screen.findByText("You're in!")).toBeInTheDocument()
    expect(saveFestivalKey).toHaveBeenCalledWith(SESSION.user.id, INVITE.festival_key)
    expect(localStorage.getItem('festplan_festival')).toBe(INVITE.festival_key)
    expect(localStorage.getItem('festplan_pending_invite')).toBeNull()
  })

  it('completes a successful join and navigates to the schedule after the success state', async () => {
    localStorage.setItem('festplan_pending_invite', INVITE.slug)
    renderJoin()
    expect(await screen.findByText("You're in!")).toBeInTheDocument()
    expect(getInvite).toHaveBeenCalledWith(INVITE.slug)
    expect(acceptInvite).toHaveBeenCalledWith(INVITE, SESSION)
    expect(saveFestivalKey).toHaveBeenCalledWith(SESSION.user.id, INVITE.festival_key)
    expect(localStorage.getItem('festplan_festival')).toBe(INVITE.festival_key)
    expect(localStorage.getItem('festplan_pending_invite')).toBeNull()
    vi.useFakeTimers()
    await act(async () => { vi.advanceTimersByTime(1400) })
    expect(screen.getByText('schedule destination')).toBeInTheDocument()
  })

  it('opens the festival for its owner without creating a friends link', async () => {
    getInvite.mockResolvedValue({ ...INVITE, inviter_user_id: SESSION.user.id })
    renderJoin()
    expect(await screen.findByText('schedule destination')).toBeInTheDocument()
    expect(acceptInvite).not.toHaveBeenCalled()
    expect(saveFestivalKey).not.toHaveBeenCalled()
    expect(localStorage.getItem('festplan_festival')).toBe(INVITE.festival_key)
  })

  it('offers home when no invite slug is supplied', () => {
    renderJoin(SESSION, '/join')
    expect(screen.getByRole('alert')).toHaveTextContent(/No invite slug/i)
    expect(screen.queryByRole('button', { name: /Try Again/i })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Go Home/i }))
    expect(screen.getByText('home destination')).toBeInTheDocument()
  })
})
