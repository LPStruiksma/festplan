import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],

  test: {
    // Use global describe / test / expect / vi without explicit imports.
    globals: true,

    // Pure-logic tests need no DOM.
    // Component tests that require a browser environment should add
    //   // @vitest-environment jsdom
    // at the very top of the test file instead.
    environment: 'node',

    // Collect coverage from src/lib and src/components only.
    coverage: {
      include: ['src/lib/**', 'src/components/**'],
    },
  },
})
