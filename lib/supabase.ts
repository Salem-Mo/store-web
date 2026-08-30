import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
export const SUPABASE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

let client: SupabaseClient | undefined

export function getSupabaseClient() {
  client ??= createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)
  return client
}

export const supabase = getSupabaseClient()
