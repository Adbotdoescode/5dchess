// Lazily created Supabase client for online play.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let client: SupabaseClient | null = null

/** Create a standalone client (no auth session; we only use RPC + Realtime). */
export function createSupabaseClient(url: string, key: string): SupabaseClient {
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}

/** Shared app client built from VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY. */
export function getSupabase(): SupabaseClient {
  if (client) return client
  const env = import.meta.env as Record<string, string | undefined>
  const url = env.VITE_SUPABASE_URL
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY
  if (!url || !key) {
    throw new Error(
      'Online play is not configured: set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY ' +
        '(e.g. in .env.local, or in the Vercel project settings) and restart the dev server.',
    )
  }
  client = createSupabaseClient(url, key)
  return client
}
