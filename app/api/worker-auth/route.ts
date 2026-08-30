import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { hashPin, verifyPin, isStrongPin } from '@/lib/crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

// In-memory rate limiter (per-instance; use Redis/Upstash for multi-instance)
const attempts = new Map<string, { count: number; reset: number }>()
const MAX_ATTEMPTS = 5
const WINDOW_MS = 15 * 60 * 1000
const BLOCK_MS = 60 * 60 * 1000

function rateKey(req: Request) {
  return (req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown').slice(0, 64)
}
function isRateLimited(key: string): boolean {
  const now = Date.now()
  const rec = attempts.get(key)
  if (!rec) return false
  if (now > rec.reset) { attempts.delete(key); return false }
  return rec.count >= MAX_ATTEMPTS && now < rec.reset
}
function recordAttempt(key: string, success: boolean) {
  const now = Date.now()
  if (success) { attempts.delete(key); return }
  const rec = attempts.get(key)
  if (!rec || now > rec.reset) attempts.set(key, { count: 1, reset: now + WINDOW_MS })
  else {
    rec.count += 1
    if (rec.count >= MAX_ATTEMPTS) rec.reset = now + BLOCK_MS
  }
}

function decodeJwtRole(token: string): string | null {
  try {
    const payload = token.split('.')[1]
    if (!payload) return null
    const json = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
    return (JSON.parse(json).role as string) || null
  } catch { return null }
}

function isPlaceholderServiceRole(): string | null {
  if (!serviceRoleKey) return 'SUPABASE_SERVICE_ROLE_KEY غير مضبوط'
  if (serviceRoleKey === 'your_service_role_key_here') return 'SUPABASE_SERVICE_ROLE_KEY لا يزال القيمة الافتراضية'
  if (serviceRoleKey.length < 30) return 'SUPABASE_SERVICE_ROLE_KEY قصير جداً'
  if (serviceRoleKey.startsWith('sb_publishable_')) return 'SUPABASE_SERVICE_ROLE_KEY يستخدم مفتاح النشر (publishable) بدلاً من service_role'
  const role = decodeJwtRole(serviceRoleKey)
  if (role === 'anon') return 'SUPABASE_SERVICE_ROLE_KEY الحالي هو مفتاح anon وليس service_role'
  if (role && role !== 'service_role') return `SUPABASE_SERVICE_ROLE_KEY role غير متوقع: ${role}`
  return null
}
function adminClient() {
  const reason = isPlaceholderServiceRole()
  if (!supabaseUrl || !serviceRoleKey || reason) throw new Error(reason ? `Supabase server credentials are not configured — ${reason}. انسخ المفتاح السري service_role من Supabase Dashboard > Project Settings > API > service_role إلى .env.local ثم أعد تشغيل npm run dev` : 'Supabase server credentials are not configured')
  return createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })
}

function authPassword(pin: string) { return `${pin.trim()}-ayoub-auth-v2` }

function authEmail(username: string) {
  const normalized = username.trim().toLocaleLowerCase()
  let hash = 2166136261
  for (const ch of normalized) { hash ^= ch.codePointAt(0) || 0; hash = Math.imul(hash, 16777619) }
  const slug = normalized.replace(/[^a-z0-9._-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'worker'
  return `${slug.slice(0, 40)}-${(hash >>> 0).toString(36)}@workers.ayoub.internal`
}

function normalizeUsername(u: string) {
  return u.trim()
}

// Timeout helper — fail fast instead of hanging until Vercel 10s kill (user sees "timeout")
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer)
  }) as Promise<T>
}

async function isUsernameTaken(admin: ReturnType<typeof adminClient>, username: string, excludeId?: string): Promise<boolean> {
  const needle = username.trim().toLocaleLowerCase()
  // fetch usernames (small table, <~1k) and compare case-insensitively to avoid ilike pattern pitfalls
  const { data, error } = await withTimeout(
    admin.from('users').select('id, username').limit(1000) as unknown as Promise<{ data: unknown; error: unknown }>,
    4000,
    'isUsernameTaken'
  )
  if (error || !data) return false
  return (data as { id: string; username: string }[]).some(
    (r) => String(r.username).trim().toLocaleLowerCase() === needle && r.id !== excludeId
  )
}

const ALLOWED_PERMS = new Set(['pos','weights','expenses','shift','add_inv','edit_inv','delete_cart','reports','all'])

function sanitizePermissions(perms: unknown): string[] {
  if (!Array.isArray(perms)) return []
  return [...new Set(perms.filter((p): p is string => typeof p === 'string' && ALLOWED_PERMS.has(p) && p.length < 32))].slice(0, 12)
}

async function requireAdmin(request: Request) {
  if (!supabaseUrl || !publishableKey) return { error: 'الإعداد غير مكتمل', status: 500 as const }
  const auth = request.headers.get('authorization')
  if (!auth?.toLowerCase().startsWith('bearer ')) return { error: 'تسجيل دخول المالك مطلوب', status: 401 as const }
  const token = auth.slice(7).trim()
  if (!token) return { error: 'تسجيل دخول المالك مطلوب', status: 401 as const }
  const client = createClient(supabaseUrl, publishableKey, { auth: { autoRefreshToken: false, persistSession: false } })
  const { data, error } = await client.auth.getUser(token)
  if (error || !data.user) return { error: 'جلسة الدخول غير صالحة', status: 401 as const }
  const admin = adminClient()
  const { data: profile } = await admin.from('users').select('id, role').eq('id', data.user.id).maybeSingle()
  if (profile?.role !== 'admin') return { error: 'ليس لديك صلاحية لإدارة العمال', status: 403 as const }
  return { admin, user: data.user }
}

// Fallback: allow owner PIN as admin when no valid Bearer token but PIN is correct
// Used for bootstrap when no admin account exists yet or owner logs in via PIN-only flow
async function requireAdminOrOwnerPin(request: Request, body: Record<string, unknown>) {
  const adminResult = await requireAdmin(request)
  if (!('error' in adminResult)) return adminResult
  // Try owner PIN fallback
  const ownerPin = String((body.ownerPin as string) || (body.password as string) || '').trim()
  // Also support body.oldPin for update flows
  const pinToVerify = String((body.ownerPin as string) || '').trim() || ownerPin
  if (!pinToVerify) return adminResult
  try {
    const admin = adminClient()
    const ok = await verifyOwnerPin(admin, pinToVerify)
    if (ok) {
      // Return admin client with synthetic owner user
      return { admin, user: { id: 'owner-pin-bootstrap', email: 'owner@local' } as never, isOwnerPin: true as const }
    }
  } catch {}
  return adminResult
}

async function verifyOwnerPin(admin: ReturnType<typeof adminClient>, pin: string): Promise<boolean> {
  const { data } = await admin.from('settings').select('value').eq('key', 'owner_pin').maybeSingle()
  // Genesis: if no row yet, default PIN is "0000" — create it on first successful use
  if (!data) {
    if (pin === '0000' || pin === '1234' || pin === '00000') {
      const hash = hashPin(pin)
      await admin.from('settings').upsert({ key: 'owner_pin', value: { hash } })
      return true
    }
    return false
  }
  const val = (data?.value ?? {}) as { hash?: string; pin?: string }
  if (val.hash) return verifyPin(pin, val.hash)
  // legacy plaintext migration: if stored plaintext matches, hash and upgrade inline (do not return plaintext)
  if (val.pin && val.pin === pin) {
    const hash = hashPin(pin)
    await admin.from('settings').upsert({ key: 'owner_pin', value: { hash } })
    return true
  }
  // Fallback: if stored value is empty object, treat as genesis
  if (!val.hash && !val.pin && (pin === '0000' || pin === '1234')) {
    const hash = hashPin(pin)
    await admin.from('settings').upsert({ key: 'owner_pin', value: { hash } })
    return true
  }
  return false
}

export async function GET(request: Request) {
  const placeholderReason = isPlaceholderServiceRole()
  if (placeholderReason) {
    return NextResponse.json({ error: `إعداد الخادم غير مكتمل: ${placeholderReason}` }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
  }
  try {
    const admin = adminClient()
    const [{ count: total, error: e1 }, { count: adminCount, error: e2 }] = await withTimeout(
      Promise.all([
        admin.from('users').select('id', { count: 'exact', head: true }),
        admin.from('users').select('id', { count: 'exact', head: true }).eq('role', 'admin'),
      ]) as unknown as Promise<[{ count: number | null; error: unknown }, { count: number | null; error: unknown }]>,
      4000,
      'GET counts'
    )
    if (e1) throw e1
    if (e2) throw e2
    const t = total ?? 0
    const a = adminCount ?? 0
    const canSignup = a === 0
    return NextResponse.json({ canSignup, hasAccounts: !canSignup, count: t, adminCount: a, allowed: canSignup }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[worker-auth][GET] error', msg)
    if (msg.includes('timeout')) {
      return NextResponse.json({ error: 'انتهت مهلة الاتصال بقاعدة البيانات — حاول مرة أخرى' }, { status: 504, headers: { 'Cache-Control': 'no-store' } })
    }
    return NextResponse.json({ error: 'تعذر التحقق من حالة الحسابات' }, { status: 500, headers: { 'Cache-Control': 'no-store' } })
  }
}

export async function POST(request: Request) {
  // Early config check before rate-limit so placeholder gives actionable 503 instead of 429
  const placeholderReason = isPlaceholderServiceRole()
  if (placeholderReason) {
    const url = new URL(request.url)
    const bodyText = await request.clone().text().catch(()=> '')
    let actionHint = ''
    try { const j = JSON.parse(bodyText); actionHint = String(j.action||'') } catch {}
    if (['signup','create','update','delete','owner-login','login'].includes(actionHint) || url.searchParams.get('check')==='1') {
      console.error('[worker-auth] SUPABASE_SERVICE_ROLE_KEY placeholder — refusing', actionHint, placeholderReason)
      return NextResponse.json({ error: `إعداد الخادم غير مكتمل: ${placeholderReason}. انسخ المفتاح الحقيقي من Supabase Dashboard > Project Settings > API > service_role وضعه في .env.local ثم أعد تشغيل npm run dev.` }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
    }
  }
  const ipKey = rateKey(request)
  if (isRateLimited(ipKey)) {
    return NextResponse.json({ error: 'محاولات كثيرة — حاول بعد ساعة' }, { status: 429, headers: { 'Retry-After': '3600' } })
  }
  try {
    let body: Record<string, unknown>
    try { body = await request.json() } catch { return NextResponse.json({ error: 'طلب غير صالح' }, { status: 400 }) }

    const username = String((body.username as string) || '').trim().slice(0, 64)
    const password = String((body.password as string) || '').trim().slice(0, 64)
    const actionRaw = String((body.action as string) || 'login')
    const action = (['create','update','delete','owner-login','login','signup'] as const).includes(actionRaw as never) ? actionRaw as 'create'|'update'|'delete'|'owner-login'|'login'|'signup' : 'login'

    // Generic validation - do not leak which field is missing for login
    if (action === 'login' || action === 'create' || action === 'signup') {
      if (!username || !password) { recordAttempt(ipKey,false); return NextResponse.json({ error: 'اسم المستخدم وكلمة المرور مطلوبان' }, { status: 400 }) }
      if (password.length < 4 || password.length > 64) { recordAttempt(ipKey,false); return NextResponse.json({ error: 'بيانات الدخول غير صالحة' }, { status: 401 }) }
    }

    // Owner login — hashed verification only
    if (action === 'owner-login') {
      const ownerPin = String((body.ownerPin as string) || password).trim()
      if (!ownerPin) { recordAttempt(ipKey,false); return NextResponse.json({ error: 'رمز المالك مطلوب' }, { status: 400 }) }
      const admin = adminClient()
      const ok = await verifyOwnerPin(admin, ownerPin)
      if (!ok) { recordAttempt(ipKey,false); return NextResponse.json({ error: 'بيانات الدخول غير صحيحة' }, { status: 401 }) }
      recordAttempt(ipKey,true)
      return NextResponse.json({ ok: true, user: { username: 'المالك', display_name: 'المالك', name: 'المالك', role: 'admin', permissions: ['all'] } }, { headers: { 'Cache-Control': 'no-store' } })
    }

    // Public self-registration — SINGLE ADMIN ONLY
    // Allowed only when there are zero accounts in DB. First account becomes admin ('all' perms).
    // After that, admin must create workers via authenticated /api/worker-auth {action:'create'}.
    // Note: no reserved names — "المالك" is treated as a normal username and must be unique like any other.
    if (action === 'signup') {
      if (!isStrongPin(password)) return NextResponse.json({ error: 'الرمز ضعيف — استخدم 6 أحرف على الأقل وتجنب 000000/123456' }, { status: 400 })
      if (username.length < 2) { recordAttempt(ipKey,false); return NextResponse.json({ error: 'اسم المستخدم قصير جداً' }, { status: 400 }) }
      const admin = adminClient()
      // Parallelize username uniqueness + admin existence checks (saves ~400ms vs sequential)
      const [taken, countResult] = await Promise.all([
        withTimeout(isUsernameTaken(admin, username), 4000, 'signup username check'),
        withTimeout(
          Promise.all([
            admin.from('users').select('id', { count: 'exact', head: true }),
            admin.from('users').select('id', { count: 'exact', head: true }).eq('role', 'admin'),
          ]) as unknown as Promise<[{ count: number | null; error: unknown }, { count: number | null; error: unknown }]>,
          4000,
          'signup count check'
        ),
      ])
      if (taken) { recordAttempt(ipKey,false); return NextResponse.json({ error: 'اسم المستخدم موجود بالفعل — اختر اسماً آخر' }, { status: 409 }) }
      const adminCount = (countResult[1] as { count: number | null })?.count ?? 0
      const e1 = (countResult[0] as { error: unknown })?.error as Error | null
      const e2 = (countResult[1] as { error: unknown })?.error as Error | null
      if (e1) { console.error('[worker-auth] signup count e1', e1); return NextResponse.json({ error: 'تعذر التحقق من حالة الحسابات' }, { status: 500 }) }
      if (e2) { console.error('[worker-auth] signup count e2', e2); return NextResponse.json({ error: 'تعذر التحقق من حالة الحسابات' }, { status: 500 }) }
      if ((adminCount ?? 0) > 0) {
        recordAttempt(ipKey,false)
        return NextResponse.json({ error: 'تم إنشاء حساب المسؤول بالفعل — لا يمكن إنشاء حساب جديد إلا عبر المسؤول من الإعدادات > الموظفون' }, { status: 403 })
      }
      const finalPerms: string[] = ['all']
      const email = authEmail(username)
      // Optimized: try create directly, skip listUsers on happy path (saves ~350ms). Only list on duplicate/orphan.
      let authUser: { id: string } | null = null
      let createdNew = false
      let createError: Error | null = null
      try {
        const { data: created, error } = await withTimeout(
          admin.auth.admin.createUser({ email, password: authPassword(password), email_confirm: true }) as unknown as Promise<{ data: { user: { id: string } | null }; error: { message: string } | null }>,
          7000,
          'signup createUser'
        )
        if (error) throw new Error(error.message)
        if (!created?.user) throw new Error('no user')
        authUser = created.user; createdNew = true
      } catch (err) {
        const msg = (err instanceof Error ? err.message : String(err)).toLowerCase()
        if (msg.includes('already') || msg.includes('exists') || msg.includes('duplicate')) {
          // Possible orphan auth user without profile — try to recover
          try {
            const { data: existingUsers } = await withTimeout(
              admin.auth.admin.listUsers({ page: 1, perPage: 1000 }) as unknown as Promise<{ data: { users: { id: string; email?: string }[] } }>,
              5000,
              'signup listUsers recovery'
            )
            const existing = (existingUsers as { users: { id: string; email?: string }[] }).users.find(u => u.email?.toLowerCase() === email.toLowerCase())
            if (!existing) {
              recordAttempt(ipKey,false)
              return NextResponse.json({ error: 'هذا الحساب موجود بالفعل' }, { status: 400 })
            }
            const { data: linked } = await withTimeout(
              admin.from('users').select('id').eq('id', existing.id).maybeSingle() as unknown as Promise<{ data: unknown }>,
              3000,
              'signup linked check'
            )
            if (linked) { recordAttempt(ipKey,false); return NextResponse.json({ error: 'هذا الاسم مستخدم بالفعل. جرّب اسماً آخر.' }, { status: 409 }) }
            const { error: updErr } = await withTimeout(
              admin.auth.admin.updateUserById(existing.id, { password: authPassword(password) }) as unknown as Promise<{ error: unknown }>,
              5000,
              'signup updateUser'
            )
            if (updErr) { recordAttempt(ipKey,false); return NextResponse.json({ error: 'تعذر تحديث الحساب الموجود' }, { status: 400 }) }
            authUser = existing
          } catch (recoveryErr) {
            const rmsg = recoveryErr instanceof Error ? recoveryErr.message : String(recoveryErr)
            if (rmsg.includes('timeout')) {
              return NextResponse.json({ error: 'انتهت مهلة الاتصال — حاول مرة أخرى' }, { status: 504 })
            }
            throw recoveryErr
          }
        } else if (msg.includes('timeout')) {
          return NextResponse.json({ error: 'انتهت مهلة إنشاء الحساب — تحقق من الاتصال وحاول مرة أخرى' }, { status: 504 })
        } else {
          console.error('[worker-auth] signup createUser error', msg)
          recordAttempt(ipKey,false)
          return NextResponse.json({ error: 'تعذر إنشاء الحساب' }, { status: 400 })
        }
      }
      if (!authUser) { recordAttempt(ipKey,false); return NextResponse.json({ error: 'تعذر إنشاء الحساب' }, { status: 400 }) }
      const profile = { id: authUser.id, username, display_name: username, role: 'admin', permissions: finalPerms, pin_hash: hashPin(password), active: true }
      const { error: insErr } = await withTimeout(
        admin.from('users').insert(profile as never) as unknown as Promise<{ error: { message: string } | null }>,
        4000,
        'signup insert profile'
      ) as { error: { message: string } | null }
      if (insErr) {
        if (createdNew) await admin.auth.admin.deleteUser(authUser.id).catch(()=>{})
        recordAttempt(ipKey,false)
        // Duplicate due to race: unique index on username or single_admin
        if (String(insErr.message).includes('duplicate') || String(insErr.message).includes('unique') || String(insErr.message).includes('single_admin')) {
          return NextResponse.json({ error: 'تم إنشاء حساب المسؤول بالفعل — لا يمكن الإنشاء مرة أخرى' }, { status: 409 })
        }
        return NextResponse.json({ error: 'تعذر حفظ بيانات الحساب' }, { status: 400 })
      }
      // Fire audit log without blocking response too long (but await with timeout)
      withTimeout(admin.from('audit_log').insert({ action: 'admin.signup', target: authUser.id, meta: { username } }) as unknown as Promise<unknown>, 2000, 'audit').catch(()=>{})
      if (!supabaseUrl || !publishableKey) throw new Error('Supabase client credentials are not configured')
      const client = createClient(supabaseUrl, publishableKey, { auth: { autoRefreshToken: false, persistSession: false } })
      try {
        const { data: authData, error: loginError } = await withTimeout(
          client.auth.signInWithPassword({ email, password: authPassword(password) }) as unknown as Promise<{ data: { session: { access_token: string; refresh_token: string } | null }; error: unknown }>,
          5000,
          'signup auto-login'
        )
        if (loginError || !authData.session) {
          recordAttempt(ipKey,true)
          return NextResponse.json({ ok: true, user: { id: profile.id, username, display_name: username, role: 'admin', permissions: finalPerms }, autoLogin: false }, { headers: { 'Cache-Control': 'no-store' } })
        }
        recordAttempt(ipKey,true)
        return NextResponse.json({ ok: true, user: { id: profile.id, username, display_name: username, role: 'admin', permissions: finalPerms }, access_token: authData.session.access_token, refresh_token: authData.session.refresh_token, autoLogin: true }, { headers: { 'Cache-Control': 'no-store' } })
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e)
        if (m.includes('timeout')) {
          recordAttempt(ipKey,true)
          return NextResponse.json({ ok: true, user: { id: profile.id, username, display_name: username, role: 'admin', permissions: finalPerms }, autoLogin: false, warning: 'انتهت مهلة تسجيل الدخول التلقائي — سجل دخولك يدوياً' }, { headers: { 'Cache-Control': 'no-store' } })
        }
        throw e
      }
    }

    if (action === 'delete') {
      const id = String((body.id as string) || '').trim()
      if (!id) return NextResponse.json({ error: 'معرّف الموظف غير مكتمل' }, { status: 400 })
      const auth = await requireAdminOrOwnerPin(request, body)
      if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
      if (id === auth.user.id) return NextResponse.json({ error: 'لا يمكن حذف حساب المالك' }, { status: 400 })
      const admin = auth.admin
      const actorId = (auth as { user: { id: string } }).user.id === 'owner-pin-bootstrap' ? null : (auth as { user: { id: string } }).user.id
      const { data: updated } = await admin.from('users').update({ active: false }).eq('id', id).eq('role','worker').select('id').maybeSingle()
      if (!updated) return NextResponse.json({ error: 'الموظف غير موجود أو تم تعطيله مسبقًا' }, { status: 404 })
      await admin.auth.admin.updateUserById(id, { ban_duration: '876000h' })
      await admin.from('audit_log').insert({ actor_id: actorId, action: 'worker.delete', target: id })
      return NextResponse.json({ ok: true, deletedId: id }, { headers: { 'Cache-Control': 'no-store' } })
    }

    if (action === 'update') {
      const auth = await requireAdminOrOwnerPin(request, body)
      if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
      const id = String((body.id as string) || '').trim()
      if (!id || !username) return NextResponse.json({ error: 'بيانات الموظف غير مكتملة' }, { status: 400 })
      if (username.length < 2) return NextResponse.json({ error: 'اسم المستخدم قصير جداً' }, { status: 400 })
      if (password && !isStrongPin(password)) return NextResponse.json({ error: 'الرمز ضعيف — استخدم 6 أحرف على الأقل وتجنب 000000/123456' }, { status: 400 })
      const admin = auth.admin
      // unique username (case-insensitive) excluding self
      if (await isUsernameTaken(admin, username, id)) return NextResponse.json({ error: 'اسم المستخدم موجود بالفعل — اختر اسماً آخر' }, { status: 409 })
      const perms = sanitizePermissions(body.permissions)
      const update: Record<string, unknown> = { username, display_name: username, permissions: perms }
      if (typeof body.active === 'boolean') update.active = body.active as boolean
      if (password) update.pin_hash = hashPin(password)
      const { error } = await admin.from('users').update(update).eq('id', id)
      if (error) return NextResponse.json({ error: 'تعذر تحديث الموظف' }, { status: 400 })
      if (password) {
        const { error: authErr } = await admin.auth.admin.updateUserById(id, { password: authPassword(password) })
        if (authErr) return NextResponse.json({ error: 'تعذر تحديث اعتماد الموظف' }, { status: 400 })
      }
      const actorId = (auth as { user: { id: string } }).user.id === 'owner-pin-bootstrap' ? null : (auth as { user: { id: string } }).user.id
      await admin.from('audit_log').insert({ actor_id: actorId, action: 'worker.update', target: id, meta: { username, perms } })
      return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
    }

    if (action === 'create') {
      if (!isStrongPin(password)) return NextResponse.json({ error: 'الرمز ضعيف — استخدم 6 أحرف على الأقل وتجنب 000000/123456' }, { status: 400 })
      if (username.length < 2) return NextResponse.json({ error: 'اسم المستخدم قصير جداً' }, { status: 400 })
      const auth = await requireAdminOrOwnerPin(request, body)
      if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
      const admin = auth.admin
      if (await withTimeout(isUsernameTaken(admin, username), 4000, 'create username check')) return NextResponse.json({ error: 'اسم المستخدم موجود بالفعل — اختر اسماً آخر' }, { status: 409 })
      const perms = sanitizePermissions(body.permissions)
      const email = authEmail(username)
      let authUser: { id: string } | null = null
      let createdNew = false
      try {
        const { data: created, error } = await withTimeout(
          admin.auth.admin.createUser({ email, password: authPassword(password), email_confirm: true }) as unknown as Promise<{ data: { user: { id: string } | null }; error: { message: string } | null }>,
          7000,
          'create createUser'
        )
        if (error) throw new Error(error.message)
        if (!created?.user) throw new Error('no user')
        authUser = created.user; createdNew = true
      } catch (err) {
        const msg = (err instanceof Error ? err.message : String(err)).toLowerCase()
        if (msg.includes('already') || msg.includes('exists') || msg.includes('duplicate')) {
          // Try orphan recovery via list
          try {
            const { data: existingUsers } = await withTimeout(
              admin.auth.admin.listUsers({ page: 1, perPage: 1000 }) as unknown as Promise<{ data: { users: { id: string; email?: string }[] } }>,
              5000,
              'create listUsers recovery'
            )
            const existing = (existingUsers as { users: { id: string; email?: string }[] }).users.find(u => u.email?.toLowerCase() === email.toLowerCase())
            if (!existing) return NextResponse.json({ error: 'هذا الموظف موجود بالفعل' }, { status: 400 })
            const { data: linked } = await withTimeout(
              admin.from('users').select('id').eq('id', existing.id).maybeSingle() as unknown as Promise<{ data: unknown }>,
              3000,
              'create linked check'
            )
            if (linked) return NextResponse.json({ error: 'هذا الموظف موجود بالفعل. استخدم اسمًا مختلفًا.' }, { status: 409 })
            const { error: updErr } = await withTimeout(
              admin.auth.admin.updateUserById(existing.id, { password: authPassword(password) }) as unknown as Promise<{ error: unknown }>,
              5000,
              'create updateUser'
            )
            if (updErr) return NextResponse.json({ error: 'تعذر تحديث حساب الموظف الموجود' }, { status: 400 })
            authUser = existing
          } catch (recoveryErr) {
            const rmsg = recoveryErr instanceof Error ? recoveryErr.message : String(recoveryErr)
            if (rmsg.includes('timeout')) return NextResponse.json({ error: 'انتهت مهلة الاتصال — حاول مرة أخرى' }, { status: 504 })
            throw recoveryErr
          }
        } else if (msg.includes('timeout')) {
          return NextResponse.json({ error: 'انتهت مهلة إنشاء حساب الموظف — حاول مرة أخرى' }, { status: 504 })
        } else {
          return NextResponse.json({ error: 'تعذر إنشاء حساب الموظف' }, { status: 400 })
        }
      }
      if (!authUser) return NextResponse.json({ error: 'تعذر إنشاء حساب الموظف' }, { status: 400 })
      const profile = { id: authUser.id, username, display_name: username, role: 'worker', permissions: perms, pin_hash: hashPin(password), active: body.active !== false }
      const { error: insErr } = await withTimeout(
        admin.from('users').insert(profile as never) as unknown as Promise<{ error: { message: string } | null }>,
        4000,
        'create insert profile'
      ) as { error: { message: string } | null }
      if (insErr) {
        if (createdNew) await admin.auth.admin.deleteUser(authUser.id).catch(()=>{})
        const detail = String(insErr.message).includes('duplicate') || String(insErr.message).includes('unique') ? 'هذا الموظف موجود بالفعل (قاعدة البيانات)' : `تعذر حفظ بيانات الموظف: ${insErr.message}`
        return NextResponse.json({ error: detail }, { status: 400 })
      }
      const actorId = (auth as { user: { id: string } }).user.id === 'owner-pin-bootstrap' ? null : (auth as { user: { id: string } }).user.id
      withTimeout(admin.from('audit_log').insert({ actor_id: actorId, action: 'worker.create', target: authUser.id, meta: { username } }) as unknown as Promise<unknown>, 2000, 'audit create').catch(()=>{})
      return NextResponse.json({ ok: true, user: { id: profile.id, username, display_name: username, role: 'worker', permissions: perms } }, { headers: { 'Cache-Control': 'no-store' } })
    }

    // login — with timeout to avoid hanging (common cause of "timeout" reports)
    if (!supabaseUrl || !publishableKey) throw new Error('Supabase client credentials are not configured')
    const client = createClient(supabaseUrl, publishableKey, { auth: { autoRefreshToken: false, persistSession: false } })
    let authData: { user: { id: string } | null; session: { access_token: string; refresh_token: string } | null } | null = null
    let loginError: unknown = null
    try {
      const res = await withTimeout(
        client.auth.signInWithPassword({ email: authEmail(username), password: authPassword(password) }) as unknown as Promise<{ data: { user: { id: string } | null; session: { access_token: string; refresh_token: string } | null }; error: unknown }>,
        6000,
        'login signIn'
      )
      authData = res.data
      loginError = res.error
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err)
      if (m.includes('timeout')) {
        recordAttempt(ipKey,false)
        return NextResponse.json({ error: 'انتهت مهلة تسجيل الدخول — تحقق من الاتصال وحاول مرة أخرى' }, { status: 504 })
      }
      throw err
    }
    if (loginError || !authData?.user) { recordAttempt(ipKey,false); return NextResponse.json({ error: 'بيانات الدخول غير صحيحة' }, { status: 401 }) }
    const admin = adminClient()
    let user: { id: string; username: string; display_name: string; role: string; permissions: string[]; active: boolean } | null = null
    try {
      const { data } = await withTimeout(
        admin.from('users').select('id, username, display_name, role, permissions, active').eq('id', authData.user.id).maybeSingle() as unknown as Promise<{ data: unknown }>,
        4000,
        'login fetch profile'
      )
      user = data as typeof user
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err)
      if (m.includes('timeout')) {
        recordAttempt(ipKey,false)
        return NextResponse.json({ error: 'انتهت مهلة جلب بيانات المستخدم — حاول مرة أخرى' }, { status: 504 })
      }
      throw err
    }
    if (!user) { recordAttempt(ipKey,false); return NextResponse.json({ error: 'بيانات الدخول غير صحيحة' }, { status: 401 }) }
    if ((user as { active: boolean }).active === false) { recordAttempt(ipKey,false); return NextResponse.json({ error: 'هذا الموظف غير نشط' }, { status: 403 }) }
    recordAttempt(ipKey,true)
    return NextResponse.json({ ok: true, user, access_token: authData.session?.access_token || null, refresh_token: authData.session?.refresh_token || null }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[worker-auth] error', msg)
    if (msg.includes('SUPABASE_SERVICE_ROLE_KEY') || msg.includes('Supabase server credentials')) {
      return NextResponse.json({ error: 'إعداد الخادم غير مكتمل: SUPABASE_SERVICE_ROLE_KEY غير مضبوط. انسخه من Supabase Dashboard > Project Settings > API > service_role إلى .env.local ثم أعد تشغيل npm run dev.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
    }
    if (msg.includes('timeout')) {
      return NextResponse.json({ error: 'انتهت مهلة الاتصال — الشبكة بطيئة أو Supabase لا يرد. حاول مرة أخرى.' }, { status: 504, headers: { 'Cache-Control': 'no-store' } })
    }
    return NextResponse.json({ error: 'خطأ غير متوقع' }, { status: 500, headers: { 'Cache-Control': 'no-store' } })
  }
}
