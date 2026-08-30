import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

function adminClient() {
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase server credentials are not configured')
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

function authEmail(username: string) {
  return `${username.toLocaleLowerCase().replace(/[^a-z0-9._-]/g, '-') }@workers.ayoub.app`
}

async function requireAdmin(request: Request) {
  if (!supabaseUrl || !publishableKey) return { error: 'Supabase client credentials are not configured', status: 500 as const }

  const authorization = request.headers.get('authorization')
  if (!authorization?.toLowerCase().startsWith('bearer ')) {
    return { error: 'تسجيل دخول المالك مطلوب', status: 401 as const }
  }

  const token = authorization.slice(7).trim()
  if (!token) return { error: 'تسجيل دخول المالك مطلوب', status: 401 as const }

  const client = createClient(supabaseUrl, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data: userData, error: userError } = await client.auth.getUser(token)
  if (userError || !userData.user) return { error: 'جلسة الدخول غير صالحة', status: 401 as const }

  const admin = adminClient()
  const { data: profile, error: profileError } = await admin
    .from('users')
    .select('id, role')
    .eq('id', userData.user.id)
    .single()

  if (profileError || profile?.role !== 'admin') {
    return { error: 'ليس لديك صلاحية لإدارة العمال', status: 403 as const }
  }

  return { admin, user: userData.user }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const username = String(body.username || '').trim()
    const password = String(body.password || '').trim()
    const action = body.action === 'create' ? 'create' : 'login'

    if (!username || !password) {
      return NextResponse.json({ error: 'اسم المستخدم وكلمة المرور مطلوبان' }, { status: 400 })
    }

    if (action === 'create') {
      const auth = await requireAdmin(request)
      if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

      const { admin } = auth
      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email: authEmail(username),
        password,
        email_confirm: true,
      })
      if (createError) return NextResponse.json({ error: createError.message }, { status: 400 })

      const profile = {
        id: created.user.id,
        username,
        display_name: username,
        role: 'worker',
        permissions: body.permissions || [],
      }

      const { error: profileError } = await admin.from('profiles').insert(profile)
      if (profileError) {
        await admin.auth.admin.deleteUser(created.user.id)
        return NextResponse.json({ error: profileError.message }, { status: 400 })
      }

      const { error: userError } = await admin.from('users').insert(profile)
      if (userError) {
        await admin.from('profiles').delete().eq('id', created.user.id)
        await admin.auth.admin.deleteUser(created.user.id)
        return NextResponse.json({ error: userError.message }, { status: 400 })
      }

      return NextResponse.json({ ok: true, user: profile })
    }

    if (!supabaseUrl || !publishableKey) {
      throw new Error('Supabase client credentials are not configured')
    }

    const client = createClient(supabaseUrl, publishableKey)
    const { data: authData, error: loginError } = await client.auth.signInWithPassword({
      email: authEmail(username),
      password,
    })

    if (loginError || !authData.user) {
      return NextResponse.json({ error: loginError?.message || 'بيانات الدخول غير صحيحة' }, { status: 401 })
    }

    const admin = adminClient()
    const { data: user, error: userError } = await admin
      .from('users')
      .select('id, username, display_name, role, permissions')
      .eq('id', authData.user.id)
      .single()

    if (userError) return NextResponse.json({ error: userError.message }, { status: 500 })
    return NextResponse.json({ ok: true, user, access_token: authData.session?.access_token || null })
  } catch (error) {
    console.error('[v0] Worker auth error:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'خطأ غير متوقع' }, { status: 500 })
  }
}
