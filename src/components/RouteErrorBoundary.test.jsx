// @vitest-environment jsdom
import React, { lazy, Suspense } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import RouteErrorBoundary from './RouteErrorBoundary'

describe('RouteErrorBoundary', () => {
  let errorSpy
  beforeEach(() => { errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {}) })
  afterEach(() => errorSpy.mockRestore())

  it('shows a reload message when a lazy route chunk fails to load', async () => {
    const Broken = lazy(() => Promise.reject(new TypeError('Failed to fetch dynamically imported module')))
    const reload = vi.fn()
    render(
      <RouteErrorBoundary onReload={reload}>
        <Suspense fallback={<p>loading</p>}>
          <Broken />
        </Suspense>
      </RouteErrorBoundary>
    )
    expect(await screen.findByText(/couldn.t load this page/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /reload/i }))
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('renders its children when nothing fails', () => {
    render(<RouteErrorBoundary><p>page</p></RouteErrorBoundary>)
    expect(screen.getByText('page')).toBeInTheDocument()
  })
})
