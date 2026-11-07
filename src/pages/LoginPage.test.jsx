// @vitest-environment jsdom
import React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'

vi.mock('../lib/supabase', () => ({
  supabase: { auth: { signInWithOAuth: vi.fn() } },
}))

import { supabase } from '../lib/supabase'
import LoginPage from './LoginPage'

const spotifyOptions = {
  provider: 'spotify',
  options: {
    scopes: 'user-library-read playlist-read-private user-top-read playlist-modify-private',
    redirectTo: window.location.origin + '/auth/callback',
  },
}

const button = () => screen.getByRole('button', { name: /Connect with Spotify|Connecting/i })

beforeEach(() => {
  supabase.auth.signInWithOAuth.mockReset()
  supabase.auth.signInWithOAuth.mockResolvedValue({
    data: { url: 'https://example.invalid/oauth' },
    error: null,
  })
})

describe('LoginPage Spotify initiation recovery', () => {
  it('recovers a rejected transport promise and permits a successful retry', async () => {
    supabase.auth.signInWithOAuth.mockRejectedValueOnce(new Error('synthetic network unavailable'))
    render(<LoginPage />)

    fireEvent.click(button())
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not start Spotify sign-in/i)
    expect(button()).toBeEnabled()
    expect(supabase.auth.signInWithOAuth).toHaveBeenCalledTimes(1)

    fireEvent.click(button())
    await waitFor(() => expect(supabase.auth.signInWithOAuth).toHaveBeenCalledTimes(2))
    expect(supabase.auth.signInWithOAuth).toHaveBeenNthCalledWith(1, spotifyOptions)
    expect(supabase.auth.signInWithOAuth).toHaveBeenNthCalledWith(2, spotifyOptions)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(button()).toBeDisabled() // Supabase owns the redirect after successful initiation.
  })

  it('recovers a synchronous OAuth initiation throw', async () => {
    supabase.auth.signInWithOAuth.mockImplementationOnce(() => {
      throw new Error('synthetic transport failure')
    })
    render(<LoginPage />)

    fireEvent.click(button())
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not start Spotify sign-in/i)
    expect(button()).toBeEnabled()
    expect(supabase.auth.signInWithOAuth).toHaveBeenCalledTimes(1)
  })

  it('keeps the existing returned-error behavior with a retryable button', async () => {
    supabase.auth.signInWithOAuth.mockResolvedValueOnce({
      data: null,
      error: new Error('synthetic provider declined'),
    })
    render(<LoginPage />)

    fireEvent.click(button())
    expect(await screen.findByRole('alert')).toHaveTextContent('synthetic provider declined')
    expect(button()).toBeEnabled()

    fireEvent.click(button())
    await waitFor(() => expect(supabase.auth.signInWithOAuth).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(button()).toBeDisabled()
  })

  it('disables additional submissions while initiation is pending', async () => {
    let complete
    supabase.auth.signInWithOAuth.mockImplementationOnce(() => new Promise(resolve => {
      complete = resolve
    }))
    render(<LoginPage />)

    fireEvent.click(button())
    expect(button()).toBeDisabled()
    fireEvent.click(button())
    expect(supabase.auth.signInWithOAuth).toHaveBeenCalledTimes(1)
    expect(supabase.auth.signInWithOAuth).toHaveBeenCalledWith(spotifyOptions)

    await act(async () => complete({ data: { url: 'https://example.invalid/oauth' }, error: null }))
    expect(button()).toBeDisabled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
