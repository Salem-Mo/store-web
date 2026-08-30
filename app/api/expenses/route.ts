import { NextResponse } from 'next/server'
import { requireAuth, hasPerm, getAdminClient } from '@/lib/supabase-server'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const auth = await requireAuth(request)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  if (!hasPerm(auth.profile as never, 'expenses') && !hasPerm(auth.profile as never, 'shift')) {
    return NextResponse.json({ error: 'لا تملك صلاحية المصروفات' }, { status: 403 })
  }
  try {
    // Expenses since last shift closing — matches shift report window
    const { data: lastClosing } = await auth.admin
      .from('shift_closings')
      .select('closed_at')
      .order('closed_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const since = (lastClosing as { closed_at?: string } | null)?.closed_at || '1970-01-01'
    const { data, error } = await auth.admin
      .from('expenses')
      .select('id, reason, amount, user_id, created_at')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(100)
    if (error) return NextResponse.json({ error: 'تعذر تحميل المصروفات', expenses: [] }, { status: 500 })
    return NextResponse.json({ expenses: data || [] }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes('SUPABASE_SERVICE_ROLE_KEY') || msg.includes('service_role')) {
      return NextResponse.json({ error: msg, expenses: [] }, { status: 503 })
    }
    return NextResponse.json({ error: 'خطأ غير متوقع', expenses: [] }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const auth = await requireAuth(request)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  if (!hasPerm(auth.profile as never, 'expenses')) return NextResponse.json({ error: 'لا تملك صلاحية المصروفات' }, { status: 403 })
  const body = await request.json().catch(()=>null) as { reason?: string; amount?: number } | null
  const reason = String(body?.reason || '').trim().slice(0,200)
  const amount = Number(body?.amount)
  if (!reason || !Number.isFinite(amount) || amount <=0) return NextResponse.json({ error: 'بيانات المصروف غير صالحة' }, { status: 400 })
  const { error } = await auth.admin.from('expenses').insert({ user_id: auth.user.id, reason, amount } as never)
  if (error) return NextResponse.json({ error: 'تعذر حفظ المصروف' }, { status: 400 })
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
}
