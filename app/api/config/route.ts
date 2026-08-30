import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
  const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    ''
  const configured = Boolean(supabaseUrl && supabaseKey)
  // Legacy static/index.html expects { supabaseUrl, supabaseKey } — publishable key is safe to expose
  return NextResponse.json(
    { ok: configured, configured, supabaseUrl, supabaseKey },
    { headers: { 'Cache-Control': 'no-store, max-age=0', 'Pragma': 'no-cache' } }
  )
}
