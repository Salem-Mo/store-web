import { NextResponse } from 'next/server'
import { requireAuth, hasPerm, getAdminClient } from '@/lib/supabase-server'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  const auth = await requireAuth(request)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'طلب غير صالح' }, { status: 400 })

  const name = String(body.name || '').trim().slice(0,120)
  const barcode = String(body.barcode || '').trim().slice(0,64)
  const buyPrice = Number(body.buyPrice ?? body.buy_price)
  const sellPrice = Number(body.sellPrice ?? body.sell_price)
  const qty = Number(body.qty ?? body.quantity)
  const type = body.type === 'weight' ? 'weight' : 'piece'
  const id = String((body.id as string) || '').trim()

  if (!name || !barcode || !Number.isFinite(qty) || qty < 0) return NextResponse.json({ error: 'بيانات المنتج غير مكتملة' }, { status: 400 })
  if (!Number.isFinite(sellPrice) || sellPrice < 0 || !Number.isFinite(buyPrice) || buyPrice < 0) return NextResponse.json({ error: 'السعر غير صالح' }, { status: 400 })

  // Create path
  if (!id) {
    if (!hasPerm(auth.profile as never, 'add_inv')) return NextResponse.json({ error: 'لا تملك صلاحية الإضافة' }, { status: 403 })
    const { data, error } = await auth.admin.from('products').insert({
      name, barcode, buy_price: buyPrice, sell_price: sellPrice, quantity: qty, unit_type: type,
    } as never).select('id').maybeSingle()
    if (error) {
      const msg = error.message.includes('duplicate') || error.message.includes('unique') ? 'الباركود موجود مسبقاً' : 'تعذر إضافة المنتج'
      return NextResponse.json({ error: msg }, { status: 400 })
    }
    await auth.admin.from('audit_log').insert({ actor_id: auth.user.id, action: 'product.create', target: barcode })
    return NextResponse.json({ ok: true, id: (data as { id: string })?.id }, { headers: { 'Cache-Control': 'no-store' } })
  }

  // Update path
  if (!hasPerm(auth.profile as never, 'edit_inv')) return NextResponse.json({ error: 'لا تملك صلاحية التعديل' }, { status: 403 })
  const { error } = await auth.admin.from('products').update({
    name, barcode, buy_price: buyPrice, sell_price: sellPrice, quantity: qty, unit_type: type,
  } as never).eq('id', id)
  if (error) return NextResponse.json({ error: 'تعذر تحديث المنتج' }, { status: 400 })
  await auth.admin.from('audit_log').insert({ actor_id: auth.user.id, action: 'product.update', target: id })
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function GET(request: Request) {
  // Public catalog for POS pre-login / owner (no JWT) — products are not sensitive.
  try {
    const client = getAdminClient()
    const { data, error } = await client.from('products').select('*').order('name')
    if (error) {
      console.error('[products] supabase error', error.message)
      // If service_role is invalid/placeholder, return empty with 503 instruction
      if (error.message?.toLowerCase().includes('invalid') || error.code === '401') {
        return NextResponse.json({ error: 'إعداد الخادم غير مكتمل: SUPABASE_SERVICE_ROLE_KEY غير مضبوط. ضعه في .env.local', products: [] }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
      }
      return NextResponse.json({ error: 'تعذر تحميل المنتجات', products: [] }, { status: 500 })
    }
    return NextResponse.json({ products: data || [] }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[products] config error', msg)
    if (msg.includes('SUPABASE_SERVICE_ROLE_KEY') || msg.includes('service_role')) {
      return NextResponse.json({ error: 'إعداد الخادم غير مكتمل: SUPABASE_SERVICE_ROLE_KEY غير مضبوط. انسخه من Supabase Dashboard > Project Settings > API > service_role إلى .env.local ثم أعد تشغيل npm run dev.', products: [] }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
    }
    return NextResponse.json({ error: 'Config missing', products: [] }, { status: 500 })
  }
}
