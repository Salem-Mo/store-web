import { NextResponse } from 'next/server'
import { requireAuth, hasPerm } from '@/lib/supabase-server'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  const auth = await requireAuth(request)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  if (!hasPerm(auth.profile as never, 'pos')) return NextResponse.json({ error: 'لا تملك صلاحية البيع' }, { status: 403 })

  let body: { items?: unknown; total?: unknown }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'طلب غير صالح' }, { status: 400 }) }

  const items = Array.isArray(body.items) ? (body.items as Record<string, unknown>[]) : []
  if (!items.length || items.length > 100) return NextResponse.json({ error: 'السلة غير صالحة' }, { status: 400 })

  // Validate items server-side and compute total (do not trust client total)
  let serverTotal = 0
  const normalized: { barcode: string; qty: number; type: string; sellPrice: number; name: string }[] = []
  for (const it of items) {
    const barcode = String((it as Record<string, unknown>).barcode || '').trim().slice(0,64)
    const type = String((it as Record<string, unknown>).type || 'piece') === 'weight' ? 'weight' : 'piece'
    const qty = Number((it as Record<string, unknown>).qty)
    if (!barcode || !Number.isFinite(qty) || qty <= 0 || qty > 1_000_000) return NextResponse.json({ error: `كمية غير صالحة ${barcode}` }, { status: 400 })
    // Fetch authoritative price/qty from DB via admin
    const { data: product } = await auth.admin.from('products').select('barcode, sell_price, quantity, unit_type').eq('barcode', barcode).maybeSingle()
    if (!product) return NextResponse.json({ error: `الصنف غير موجود ${barcode}` }, { status: 400 })
    if (product.unit_type !== type) return NextResponse.json({ error: `نوع الصنف غير متطابق ${barcode}` }, { status: 400 })
    if (Number(product.quantity) < qty) return NextResponse.json({ error: `الكمية غير كافية ${barcode}` }, { status: 409 })
    const price = Number(product.sell_price)
    serverTotal += price * qty
    normalized.push({ barcode, qty, type, sellPrice: price, name: String((it as Record<string,unknown>).name || barcode).slice(0,120) })
  }
  serverTotal = Math.round(serverTotal * 100) / 100

  // Atomic checkout via DB function
  const { data, error } = await auth.admin.rpc('checkout_sale', {
    p_user_id: auth.user.id,
    p_total: serverTotal,
    p_items: normalized as never,
  })
  if (error) {
    const msg = error.message.includes('insufficient stock') ? 'الكمية غير كافية (تم بيعها لتواً)' : 'تعذر إتمام البيع'
    return NextResponse.json({ error: msg }, { status: 409 })
  }
  await auth.admin.from('audit_log').insert({ actor_id: auth.user.id, action: 'sale.checkout', target: String(data), meta: { total: serverTotal, count: normalized.length } })
  return NextResponse.json({ ok: true, sale_id: data, total: serverTotal }, { headers: { 'Cache-Control': 'no-store' } })
}
