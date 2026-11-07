// @vitest-environment jsdom
import React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'

vi.mock('react-router-dom', () => ({ useNavigate: vi.fn() }))
vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
      onAuthStateChange: vi.fn(),
      signInWithOAuth: vi.fn(),
    },
    from: vi.fn(),
  },
}))

import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import AuthCallback from './AuthCallback'

const freshSession = {
  user: { id: 'synthetic-user' },
  provider_token: 'synthetic-provider-access',
  provider_refresh_token: 'synthetic-provider-refresh',
}
const staleSession = { user: { id: 'synthetic-user' } }

let onAuth
let unsubscribe
let upsert
let navigate

beforeEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
  window.history.replaceState({}, '', '/auth/callback?code=synthetic-code')
  localStorage.clear()
  navigate = vi.fn()
  unsubscribe = vi.fn()
  upsert = vi.fn().mockResolvedValue({ error: null })
  useNavigate.mockReturnValue(navigate)
  supabase.from.mockReturnValue({ upsert })
  supabase.auth.getSession.mockResolvedValue({ data: { session: null }, error: null })
  supabase.auth.onAuthStateChange.mockImplementation(callback => {
    onAuth = callback
    return { data: { subscription: { unsubscribe } } }
  })
  supabase.auth.signInWithOAuth.mockResolvedValue({
    data: { url: 'https://example.invalid/spotify' },
    error: null,
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('AuthCallback OAuth recovery', () => {
  it('shows a recoverable Spotify rejection instead of accepting an old session', async () => {
    window.history.replaceState({}, '', '/auth/callback?error=access_denied&error_description=synthetic')
    supabase.auth.getSession.mockResolvedValue({ data: { session: staleSession }, error: null })
    render(<AuthCallback />)

    expect(await screen.findByRole('alert')).toHaveTextContent(/Spotify sign-in failed/i)
    expect(screen.getByRole('button', { name: /Try Again/i })).toBeEnabled()
    expect(supabase.auth.getSession).not.toHaveBeenCalled()
    expect(supabase.auth.onAuthStateChange).not.toHaveBeenCalled()
    expect(upsert).not.toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('recognizes an OAuth error in the URL fragment as well', async () => {
    window.history.replaceState({}, '', '/auth/callback#error=access_denied')
    render(<AuthCallback />)
    expect(await screen.findByRole('alert')).toHaveTextContent(/Spotify sign-in failed/i)
    expect(navigate).not.toHaveBeenCalled()
  })

  it('recovers from a rejected getSession promise without navigating or losing the pending invite', async () => {
    localStorage.setItem('festplan_pending_invite', 'synthetic-slug')
    supabase.auth.getSession.mockRejectedValueOnce(new Error('synthetic offline failure'))
    render(<AuthCallback />)

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not check your Spotify session/i)
    expect(localStorage.getItem('festplan_pending_invite')).toBe('synthetic-slug')
    expect(navigate).not.toHaveBeenCalled()
    expect(upsert).not.toHaveBeenCalled()
  })

  it('also handles a Supabase getSession error response', async () => {
    supabase.auth.getSession.mockResolvedValue({
      data: { session: staleSession },
      error: new Error('synthetic auth failure'),
    })
    render(<AuthCallback />)
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not check your Spotify session/i)
    expect(navigate).not.toHaveBeenCalled()
  })

  it('times out as an error when the code yields only a stale tokenless session and no SIGNED_IN event', async () => {
    vi.useFakeTimers()
    supabase.auth.getSession.mockResolvedValue({ data: { session: staleSession }, error: null })
    render(<AuthCallback />)
    await act(async () => {})
    act(() => vi.advanceTimersByTime(15_000))

    expect(screen.getByRole('alert')).toHaveTextContent(/could not confirm a fresh Spotify sign-in/i)
    expect(screen.getByRole('button', { name: /Try Again/i })).toBeEnabled()
    expect(upsert).not.toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()

    await act(async () => onAuth('SIGNED_IN', freshSession))
    act(() => vi.runOnlyPendingTimers())
    expect(navigate).not.toHaveBeenCalled()
    expect(upsert).not.toHaveBeenCalled()
  })

  it('persists fresh SIGNED_IN tokens and redirects to the pending join exactly once', async () => {
    localStorage.setItem('festplan_pending_invite', 'synthetic-slug')
    supabase.auth.getSession.mockResolvedValue({ data: { session: staleSession }, error: null })
    render(<AuthCallback />)

    await act(async () => {
      onAuth('SIGNED_IN', freshSession)
      onAuth('SIGNED_IN', freshSession)
    })
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/join/synthetic-slug', { replace: true }))
    expect(navigate).toHaveBeenCalledTimes(1)
    expect(supabase.from).toHaveBeenCalledWith('profiles')
    expect(upsert).toHaveBeenCalledTimes(1)
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      id: freshSession.user.id,
      spotify_access_token: freshSession.provider_token,
      spotify_refresh_token: freshSession.provider_refresh_token,
      spotify_token_expires_at: expect.any(String),
    }), { onConflict: 'id' })
    expect(localStorage.getItem('festplan_pending_invite')).toBe('synthetic-slug')
  })

  it('accepts a token-bearing getSession when SIGNED_IN fired before mount', async () => {
    supabase.auth.getSession.mockResolvedValue({ data: { session: freshSession }, error: null })
    render(<AuthCallback />)

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/setup', { replace: true }))
    expect(upsert).toHaveBeenCalledTimes(1)
    await act(async () => onAuth('SIGNED_IN', freshSession))
    expect(upsert).toHaveBeenCalledTimes(1)
    expect(navigate).toHaveBeenCalledTimes(1)
  })

  it('does not claim success when Spotify token persistence fails, and retry keeps the invite', async () => {
    localStorage.setItem('festplan_pending_invite', 'synthetic-slug')
    upsert.mockResolvedValueOnce({ error: new Error('synthetic DB error') })
    render(<AuthCallback />)
    await act(async () => onAuth('SIGNED_IN', freshSession))

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not save your Spotify connection/i)
    expect(navigate).not.toHaveBeenCalled()
    expect(localStorage.getItem('festplan_pending_invite')).toBe('synthetic-slug')
    fireEvent.click(screen.getByRole('button', { name: /Try Again/i }))
    await waitFor(() => expect(supabase.auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'spotify',
      options: {
        redirectTo: window.location.origin + '/auth/callback',
        scopes: 'user-library-read user-top-read',
      },
    }))
    expect(localStorage.getItem('festplan_pending_invite')).toBe('synthetic-slug')
    expect(navigate).not.toHaveBeenCalled()
  })

  it('preserves the existing regular sign-in scopes on retry without an invite', async () => {
    window.history.replaceState({}, '', '/auth/callback?error=access_denied')
    render(<AuthCallback />)
    fireEvent.click(await screen.findByRole('button', { name: /Try Again/i }))
    await waitFor(() => expect(supabase.auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'spotify',
      options: {
        redirectTo: window.location.origin + '/auth/callback',
        scopes: 'user-library-read playlist-read-private user-top-read playlist-modify-private',
      },
    }))
    expect(navigate).not.toHaveBeenCalled()
  })

  it('shows a recoverable retry error if starting Spotify again fails', async () => {
    window.history.replaceState({}, '', '/auth/callback?error=access_denied')
    supabase.auth.signInWithOAuth.mockRejectedValueOnce(new Error('synthetic offline failure'))
    render(<AuthCallback />)
    fireEvent.click(await screen.findByRole('button', { name: /Try Again/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not restart Spotify sign-in/i)
    expect(screen.getByRole('button', { name: /Try Again/i })).toBeEnabled()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('unsubscribes and cancels pending work on unmount', async () => {
    vi.useFakeTimers()
    supabase.auth.getSession.mockResolvedValue({ data: { session: staleSession }, error: null })
    const view = render(<AuthCallback />)
    await act(async () => {})
    view.unmount()
    expect(unsubscribe).toHaveBeenCalledTimes(1)

    act(() => vi.advanceTimersByTime(16_000))
    await act(async () => onAuth('SIGNED_IN', freshSession))
    act(() => vi.runOnlyPendingTimers())
    expect(upsert).not.toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('does not navigate after unmount while persistence is pending', async () => {
    let completeWrite
    upsert.mockImplementationOnce(() => new Promise(resolve => { completeWrite = resolve }))
    const view = render(<AuthCallback />)
    await act(async () => onAuth('SIGNED_IN', freshSession))
    await waitFor(() => expect(upsert).toHaveBeenCalledTimes(1))
    view.unmount()
    await act(async () => completeWrite({ error: null }))
    expect(navigate).not.toHaveBeenCalled()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })
})
