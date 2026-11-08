import { createClient } from '@supabase/supabase-js'
import { makeTrackingFetch } from './cache-source'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    'Supabase environment variables not found. ' +
    'Make sure you have a .env.local file with VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY set.'
  )
}

// The tracking fetch notes which reads the service worker served from its
// cache (see cache-source.js), so stale data is never written back.
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: { fetch: makeTrackingFetch() },
})