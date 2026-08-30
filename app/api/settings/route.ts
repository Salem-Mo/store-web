import { NextResponse } from 'next/server'
import { requireAuth, getAdminClient } from '@/lib/supabase-server'
import { hashPin, verifyPin } from '@/lib/crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function isValidWhatsapp(num: string) {
  const digits = num.replace(/\D/g, '')
  return digits.length >= 10 && digits.length <= 15
}

async function verifyOwnerPinForSettings(admin: ReturnType<typeof getAdminClient>, pin: string): Promise<boolean> {
  const { data } = await admin.from('settings').select('value').eq('key', 'owner_pin').maybeSingle()
  if (!data) return pin === '0000'
  const val = (data?.value ?? {}) as { hash?: string; pin?: string }
  if (val.hash) return verifyPin(pin, val.hash)
  if (val.pin && val.pin === pin) return true
  if (!val.hash && !val.pin && pin === '0000') return true
  return false
}

export async function GET(request: Request) {
  const auth = await requireAuth(request)
  if ('error' in auth) {
    const url = new URL(request.url)
    const pin = url.searchParams.get('ownerPin') || url.searchParams.get('pin') || ''
    if (pin) {
      try {
        const admin = getAdminClient()
        if (await verifyOwnerPinForSettings(admin, pin)) {
          const { data } = await admin.from('settings').select('key, value').in('key', ['owner_pin', 'owner_whatsapp'])
          const map: Record<string, unknown> = {}
          for (const row of (data as { key: string; value: unknown }[] | null) || []) map[row.key] = row.value
          return NextResponse.json({ settings: map }, { headers: { 'Cache-Control': 'no-store' } })
        }
      } catch {}
    }
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  if (auth.profile?.role !== 'admin') return NextResponse.json({ error: 'ليس لديك صلاحية' }, { status: 403 })
  const { data, error } = await auth.admin.from('settings').select('key, value').in('key', ['owner_pin', 'owner_whatsapp'])
  if (error) return NextResponse.json({ error: 'تعذر تحميل الإعدادات' }, { status: 500 })
  const map: Record<string, unknown> = {}
  for (const row of (data as { key: string; value: unknown }[] | null) || []) map[row.key] = row.value
  return NextResponse.json({ settings: map }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: Request) {
  let body: Record<string, unknown>
  try { body = await request.json() } catch { return NextResponse.json({ error: 'طلب غير صالح' }, { status: 400 }) }

  const originalAuth = await requireAuth(request)
  let effectiveAdmin: ReturnType<typeof getAdminClient> | null = null
  let effectiveUserId: string | null = null
  let isOwnerPinFallback = false

  if ('error' in originalAuth) {
    const pin = String((body.ownerPin as string) || (body.oldPin as string) || '').trim()
    if (pin) {
      try {
        const admin = getAdminClient()
        if (await verifyOwnerPinForSettings(admin, pin)) {
          isOwnerPinFallback = true
          effectiveAdmin = admin
          effectiveUserId = null
        }
      } catch {}
    }
    if (!isOwnerPinFallback) return NextResponse.json({ error: (originalAuth as { error: string }).error }, { status: (originalAuth as { status: number }).status })
  } else {
    if (originalAuth.profile?.role !== 'admin') return NextResponse.json({ error: 'ليس لديك صلاحية' }, { status: 403 })
    effectiveAdmin = originalAuth.admin
    effectiveUserId = originalAuth.user.id
  }

  const admin = effectiveAdmin!
  const key = String(body.key || '').trim()
  if (key === 'owner_pin') {
    const oldPin = String(body.oldPin || '').trim()
    const newPin = String(body.newPin || body.value || '').trim()
    if (!newPin || newPin.length < 4) return NextResponse.json({ error: 'الرمز الجديد يجب أن يكون 4 أحرف على الأقل' }, { status: 400 })
    if (newPin.length > 64) return NextResponse.json({ error: 'الرمز طويل جداً' }, { status: 400 })

    const { data: existing } = await admin.from('settings').select('value').eq('key', 'owner_pin').maybeSingle()
    const val = (existing?.value ?? {}) as { hash?: string; pin?: string }
    if (val.hash) {
      if (!oldPin || !verifyPin(oldPin, val.hash)) return NextResponse.json({ error: 'الرمز القديم غير صحيح' }, { status: 401 })
    } else if (val.pin) {
      if (val.pin !== oldPin) return NextResponse.json({ error: 'الرمز القديم غير صحيح' }, { status: 401 })
    } else {
      // No existing pin — bootstrap allowed without oldPin check (genesis)
      if (!existing && oldPin && oldPin !== '0000' && oldPin !== newPin) {
        // If oldPin provided but not matching genesis, still allow if isOwnerPinFallback already verified
        // No-op: fallback already verified
      }
    }

    const hash = hashPin(newPin)
    const { error } = await admin.from('settings').upsert({ key: 'owner_pin', value: { hash } })
    if (error) return NextResponse.json({ error: 'تعذر حفظ الرمز' }, { status: 500 })
    await admin.from('audit_log').insert({ actor_id: effectiveUserId, action: 'settings.owner_pin_change' })
    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
  }

  if (key === 'owner_whatsapp') {
    const numberRaw = String(body.number || body.value || '').trim()
    const digits = numberRaw.replace(/\D/g, '')
    if (!isValidWhatsapp(digits)) return NextResponse.json({ error: 'رقم غير صحيح — يجب 10-15 رقماً' }, { status: 400 })
    const { error } = await admin.from('settings').upsert({ key: 'owner_whatsapp', value: { number: digits } })
    if (error) return NextResponse.json({ error: 'تعذر حفظ الرقم' }, { status: 500 })
    await admin.from('audit_log').insert({ actor_id: effectiveUserId, action: 'settings.whatsapp_change', meta: { number: digits } })
    return NextResponse.json({ ok: true, number: digits }, { headers: { 'Cache-Control': 'no-store' } })
  }

  return NextResponse.json({ error: 'مفتاح غير معروف' }, { status: 400 })
}
