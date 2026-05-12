// Shared CORS headers for Supabase Edge Functions.
// Import in any function with: import { corsHeaders, withCors } from '../_shared/cors.ts'

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-spotify-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// Wrap a JSON response with CORS headers
export function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// Handle preflight
export function handleCors(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }
  return null
}
