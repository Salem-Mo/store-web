import { NextResponse } from 'next/server'
import { requireAuth, hasPerm } from '@/lib/supabase-server'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function fmtEGP(n: number) { return `${Number(n || 0).toFixed(2)} ج.م` }

export async function GET(request: Request) {
  const auth = await requireAuth(request)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  if (!hasPerm(auth.profile as never, 'shift') && !hasPerm(auth.profile as never, 'expenses')) {
    return NextResponse.json({ error: 'لا تملك صلاحية عرض تقرير الشيفت' }, { status: 403 })
  }
  try {
    const { data: lastClosing } = await auth.admin.from('shift_closings').select('closed_at').order('closed_at', { ascending: false }).limit(1).maybeSingle()
    const since = (lastClosing as { closed_at?: string } | null)?.closed_at || '1970-01-01'
    const [salesRes, expensesRes, invoicesRes] = await Promise.all([
      auth.admin.from('sales').select('total').gte('created_at', since),
      auth.admin.from('expenses').select('amount').gte('created_at', since),
      auth.admin.from('sales').select('id', { count: 'exact', head: true }).gte('created_at', since),
    ])
    const totalSales = (salesRes.data as { total: number }[] | null)?.reduce((s, r) => s + Number(r.total), 0) || 0
    const totalExpenses = (expensesRes.data as { amount: number }[] | null)?.reduce((s, r) => s + Number(r.amount), 0) || 0
    const cash = Math.round((totalSales - totalExpenses) * 100) / 100
    const net = cash
    const invoices = (invoicesRes as { count?: number | null }).count ?? (salesRes.data?.length ?? 0)
    // Fetch owner whatsapp for wa text
    let ownerWhatsapp = ''
    try {
      const { data: wa } = await auth.admin.from('settings').select('value').eq('key', 'owner_whatsapp').maybeSingle()
      const v = (wa as { value?: { number?: string } } | null)?.value
      ownerWhatsapp = v?.number || ''
    } catch {}
    const text = `تقرير الشيفت — ${new Date().toLocaleString('ar-EG')}\n` +
      `إجمالي المبيعات: ${fmtEGP(totalSales)}\n` +
      `إجمالي المصروفات: ${fmtEGP(totalExpenses)}\n` +
      `الصافي (كاش): ${fmtEGP(cash)}\n` +
      `عدد الفواتير: ${invoices}`

    return NextResponse.json({
      totalSales,
      expenses: totalExpenses,
      cash,
      net,
      invoices,
      text,
      ownerWhatsapp,
      since,
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg || 'تعذر تحميل تقرير الشيفت' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const auth = await requireAuth(request)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  if (!hasPerm(auth.profile as never, 'shift')) return NextResponse.json({ error: 'لا تملك صلاحية تقفيل الشيفت' }, { status: 403 })
  const body = await request.json().catch(()=>({})) as { notes?: string }
  // Compute totals server-side from sales/expenses since last closing
  const { data: lastClosing } = await auth.admin.from('shift_closings').select('closed_at').order('closed_at', { ascending: false }).limit(1).maybeSingle()
  const since = (lastClosing as { closed_at?: string })?.closed_at || '1970-01-01'
  const { data: sales } = await auth.admin.from('sales').select('total').gte('created_at', since)
  const { data: expenses } = await auth.admin.from('expenses').select('amount').gte('created_at', since)
  const totalSales = (sales as { total: number }[] | null)?.reduce((s,r)=>s+Number(r.total),0) || 0
  const totalExpenses = (expenses as { amount: number }[] | null)?.reduce((s,r)=>s+Number(r.amount),0) || 0
  const cash = Math.round((totalSales - totalExpenses)*100)/100
  const { error } = await auth.admin.from('shift_closings').insert({
    user_id: auth.user.id, total_sales: totalSales, expenses: totalExpenses, cash_total: cash, notes: String(body.notes || '').slice(0,1000)
  } as never)
  if (error) return NextResponse.json({ error: 'تعذر حفظ إغلاق الشيفت' }, { status: 400 })
  await auth.admin.from('audit_log').insert({ actor_id: auth.user.id, action: 'shift.close', meta: { totalSales, totalExpenses } })
  return NextResponse.json({ ok: true, totalSales, totalExpenses, cash }, { headers: { 'Cache-Control': 'no-store' } })
}
