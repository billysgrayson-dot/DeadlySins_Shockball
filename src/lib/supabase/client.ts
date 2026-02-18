import { createClient } from '@supabase/supabase-js'

// ============================================================
// Browser client — uses anon key, safe to expose
// ============================================================
export function createBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('Missing Supabase browser env vars')
  return createClient(url, key)
}

// ============================================================
// Server client — uses service role key, NEVER expose to browser
// ============================================================
export function createServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase server env vars')
  return createClient(url, key, {
    auth: { persistSession: false },
  })
}
