import { createClient } from '@supabase/supabase-js'

function decodeJwtRole(token: string): string | null {
  try {
    const payload = token.split('.')[1]
    if (!payload) return null
    const json = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
    const data = JSON.parse(json)
    return typeof data.role === 'string' ? data.role : null
  } catch { return null }
}

function validateServiceRoleKey(key: string): string | null {
  if (!key || key === 'your_service_role_key_here' || key.length < 30) return 'SUPABASE_SERVICE_ROLE_KEY غير مضبوط — انسخه من Supabase Dashboard > Project Settings > API > service_role'
  const role = decodeJwtRole(key)
  // anon keys start with sb_publishable_ prefix or have role anon
  if (key.startsWith('sb_publishable_')) return 'SUPABASE_SERVICE_ROLE_KEY يستخدم مفتاح النشر (publishable) بدلاً من service_role — انسخ المفتاح السري service_role من Dashboard > Project Settings > API'
  if (role === 'anon') return 'SUPABASE_SERVICE_ROLE_KEY الحالي هو مفتاح anon وليس service_role — انسخ المفتاح السري service_role (role=service_role) من Supabase Dashboard > Project Settings > API > service_role'
  if (role && role !== 'service_role') return `SUPABASE_SERVICE_ROLE_KEY role غير متوقع: ${role} — يجب أن يكون service_role`
  return null
}

export function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Supabase server credentials not configured — set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local')
  const validationError = validateServiceRoleKey(key)
  if (validationError) throw new Error(validationError)
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

export async function requireAuth(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) return { error: 'Config missing', status: 500 as const }
  const auth = request.headers.get('authorization')
  if (!auth?.toLowerCase().startsWith('bearer ')) return { error: 'Unauthorized', status: 401 as const }
  const token = auth.slice(7).trim()
  const client = createClient(url, anon, { auth: { autoRefreshToken: false, persistSession: false } })
  const { data, error } = await client.auth.getUser(token)
  if (error || !data.user) return { error: 'Invalid session', status: 401 as const }
  const admin = getAdminClient()
  const { data: profile } = await admin.from('users').select('id, role, permissions').eq('id', data.user.id).maybeSingle()
  return { user: data.user, profile, admin }
}

export function hasPerm(profile: { role?: string; permissions?: string[] } | null, perm: string) {
  if (!profile) return false
  if (profile.role === 'admin') return true
  const perms = (profile.permissions as string[]) || []
  return perms.includes('all') || perms.includes(perm)
}
