import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Minimal rate-limit for auth endpoints (per-IP, instance-local)
// For production with multiple instances, replace with Upstash Redis.
const hits = new Map<string, { n: number; exp: number }>()

// Periodic cleanup to prevent unbounded memory growth (every 5 min)
let lastCleanup = Date.now()
function cleanup(now: number) {
  if (now - lastCleanup < 300_000) return
  lastCleanup = now
  for (const [k, v] of hits) if (now > v.exp) hits.delete(k)
  // Hard cap: keep at most 5k entries
  if (hits.size > 5000) {
    const toDelete = hits.size - 5000
    let i = 0
    for (const k of hits.keys()) {
      if (i++ >= toDelete) break
      hits.delete(k)
    }
  }
}

function limited(ip: string, key: string, max: number, windowMs: number): boolean {
  const k = `${ip}:${key}`
  const now = Date.now()
  cleanup(now)
  const rec = hits.get(k)
  if (!rec || now > rec.exp) {
    hits.set(k, { n: 1, exp: now + windowMs })
    return false
  }
  rec.n += 1
  return rec.n > max
}

export default function proxy(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  const url = req.nextUrl

  // Rate-limit auth brute-force (login + signup)
  if (url.pathname === '/api/worker-auth' && req.method === 'POST') {
    if (limited(ip, 'worker-auth', 20, 60_000)) {
      return NextResponse.json(
        { error: 'Too many requests' },
        { status: 429, headers: { 'Retry-After': '60' } }
      )
    }
  }
  // Security headers are set in next.config.mjs; add no-store for APIs
  const res = NextResponse.next()
  if (url.pathname.startsWith('/api/')) {
    res.headers.set('Cache-Control', 'no-store, max-age=0')
  }
  return res
}

// Keep named export for backwards-compat (middleware.ts re-exports)
export { proxy as middleware }

export const config = {
  matcher: ['/api/:path*'],
}
