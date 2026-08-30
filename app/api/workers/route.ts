import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/supabase-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const auth = await requireAuth(request)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  // Admin or anyone with 'all' can list workers; workers themselves can see own?
  // Restrict to admin for full list — least privilege
  if (auth.profile?.role !== 'admin' && !auth.profile?.permissions?.includes('all')) {
    // Allow self-read for non-admin? just return empty or own row
    // But spec: mobile manage workers requires admin — so 403
    return NextResponse.json({ error: 'ليس لديك صلاحية عرض الموظفين' }, { status: 403 })
  }

  const { data, error } = await auth.admin
    .from('users')
    .select('id, username, display_name, role, permissions, active, created_at')
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[workers] fetch error', error.message)
    return NextResponse.json({ error: 'تعذر تحميل الموظفين' }, { status: 500 })
  }

  // Split admin vs workers for easier client
  const workers = (data as unknown as Array<{
    id: string
    username: string
    display_name: string
    role: string
    permissions: string[]
    active: boolean
    created_at: string
  }>) || []

  return NextResponse.json({ workers, count: workers.length }, { headers: { 'Cache-Control': 'no-store' } })
}
