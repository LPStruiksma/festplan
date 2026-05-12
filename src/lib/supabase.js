import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    'Supabase environment variables not found. ' +
    'Make sure you have a .env.local file with VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY set.'
  )
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)