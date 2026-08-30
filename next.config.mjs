/** @type {import('next').NextConfig} */
const isDev = process.env.NODE_ENV === 'development'
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // SAMEORIGIN required because app/page.tsx loads /static/index.html via same-origin iframe.
  // DENY would break the POS UI in production.
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      // 'unsafe-eval' required only in development for React/Turbopack (reconstructing callstacks).
      // In production React never uses eval(), so we omit it for stronger security.
      `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''} https://cdn.jsdelivr.net https://unpkg.com https://cdnjs.cloudflare.com`,
      "style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com",
      "font-src 'self' https://cdnjs.cloudflare.com",
      "img-src 'self' data: blob:",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
      "media-src 'self' blob:",
      "worker-src 'self' blob:",
      "object-src 'none'",
      // Same-origin iframe (static/index.html) must be allowed; 'none' would break the app.
      "frame-ancestors 'self'",
      "frame-src 'self'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
  },
]

const nextConfig = {
  // Allow LAN access in dev (prevents HMR blocked -> full reload loop)
  // HMR from 192.168.1.x is considered cross-origin by default and triggers
  // "Blocked cross-origin request" + fallback full-page refresh every few seconds.
  allowedDevOrigins: [
    '192.168.1.8',
    '192.168.1.4',
    '192.168.1.5',
    '192.168.1.6',
    '192.168.1.7',
    '192.168.1.9',
    '192.168.1.10',
    '192.168.1.11',
    '192.168.1.12',
    'localhost',
    '127.0.0.1',
    '192.168.1.*',
    '192.168.0.*',
  ],
  typescript: {
    ignoreBuildErrors: false,
  },
  images: { unoptimized: true },
  poweredByHeader: false,
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }]
  },
}

export default nextConfig
