# Syvora12 — سوبر ماركت أيوب - للنظم الذكية

Next.js 16.3 POS + Inventory + Expenses/Shift system with Supabase backend. Main UI is `static/index.html` (1,950 LOC) served inside `app/page.tsx:4` via same-origin `<iframe src="/static/index.html">`. All server mutations go through Next.js API routes using `SUPABASE_SERVICE_ROLE_KEY` (`lib/supabase-server.ts:23`).

---

## Table of Contents

1. [Tech Stack](#tech-stack)
2. [Prerequisites](#prerequisites)
3. [Environment Variables](#environment-variables)
4. [Supabase Setup (Database)](#supabase-setup-database)
5. [Local Development](#local-development)
6. [Production Build (Local Verification)](#production-build-local-verification)
7. [Deployment — Vercel (Recommended)](#deployment--vercel-recommended)
8. [Deployment — Self-Hosted Node / VPS](#deployment--self-hosted-node--vps)
9. [Deployment — Docker (Optional)](#deployment--docker-optional)
10. [Post-Deploy Verification Checklist](#post-deploy-verification-checklist)
11. [Troubleshooting](#troubleshooting)
12. [Security Notes](#security-notes)
13. [Project Structure](#project-structure)

---

## Tech Stack

| Layer | Detail |
|---|---|
| Framework | Next.js `16.3.0` (`package.json:18`), React 19, App Router |
| Styling | Tailwind CSS 4.3 (`@tailwindcss/postcss`), `app/globals.css` |
| Backend | Next.js API Routes (`app/api/*`, `runtime: 'nodejs'`) |
| DB / Auth | Supabase Postgres + `supabase-js@2.112` — RLS, RPC `checkout_sale()` |
| Hosting | Vercel (first-class, `@vercel/analytics:1.6` in `app/layout.tsx:33`), or any Node host |
| Package managers | `pnpm` (preferred — `pnpm-lock.yaml` + `pnpm-workspace.yaml`) or `npm` (`package-lock.json`) |

Build scripts auto-copy POS shell before compile (`package.json:6-7`):

```json
"dev":   "node -e \"try{require('fs').cpSync('static','public/static',{recursive:true,force:true})}catch(e){}\" && next dev --hostname 0.0.0.0 --port 3000",
"build": "node -e \"try{require('fs').cpSync('static','public/static',{recursive:true,force:true})}catch(e){}\" && next build",
"start": "next start --hostname 0.0.0.0 --port 3000"
```

> Do **not** commit `static` separately to `public` — the build does it for you. `next.config.mjs:58` has `images.unoptimized: true` (required for static export / Vercel without image optimization).

---

## Prerequisites

- **Node.js** `>= 18.17` (tested on `v24.19.0`). Check with `node -v`.
- **pnpm** `>= 9` (or `npm >= 10`). This repo has both lockfiles — use one consistently.
- **Supabase project** (free tier is enough). You need: Project URL, `anon`/`publishable` key, and `service_role` secret JWT.
- **Git** + a **Vercel** account (for recommended deploy) or a VPS with Node.

---

## Environment Variables

All env is documented in `.env.example:1-9` and consumed in `lib/supabase-server.ts:23` and `app/api/config/route.ts:6`.

| Variable | Required | Where | Description |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Client + Server | `https://<ref>.supabase.co` — from Supabase Dashboard > Project Settings > API > Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes\* | Client | Publishable/anon key (`sb_publishable_...` or legacy `eyJ...` with `role: anon`). Either this **or** `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` works — `lib/supabase-server.ts:34` checks both. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Yes\* | Client | New-style alternative name for the anon key. Set one of the two. |
| `SUPABASE_SERVICE_ROLE_KEY` | **Yes** | **Server only** | `service_role` secret JWT (`role: service_role`). From Dashboard > Project Settings > API > **service_role (secret)**. **Never** expose to browser. `lib/supabase-server.ts:13` validates it — using anon/publishable here returns `503 role anon instead of service_role`. |

\* At least one anon/publishable key + the URL must be set or `/api/config` returns `{ configured: false }` and `GET /api/products` returns `503` (`app/api/products/route.ts:55`).

**Local file:** `.env.local` (git-ignored by `.gitignore:10`). Vercel: set in Dashboard > Project > Settings > Environment Variables (see deploy section).

Verify your `service_role` JWT before deploying (payload must contain `"role":"service_role"`):

```bash
# PowerShell — decode JWT payload
$key="eyJhbGci..."; [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String(($key.Split('.')[1].Replace('-','+').Replace('_','/').PadRight((($key.Split('.')[1].Length+3)/4)*4,'='))))
# or https://jwt.io — paste key, check payload.role == "service_role"
```

---

## Supabase Setup (Database)

Apply schema **once** per project. All statements are idempotent (`IF NOT EXISTS` + `DO` blocks).

### 1. Create Supabase project

Dashboard > New Project > pick region closest to users (e.g. `eu-central-1` for Egypt) > wait for provision.

### 2. Run the main schema

Supabase Dashboard > SQL Editor > New Query > paste **entire** `supabase-schema.sql:1-204` > Run.

This creates:
- Tables: `users`, `profiles`, `products`, `sales`, `expenses`, `shift_closings`, `settings`, `audit_log` (`supabase-schema.sql:6-92`)
- RLS enabled + least-privilege policies via `is_admin()` `SECURITY DEFINER` helper (fixes infinite recursion — `supabase-schema.sql:105`)
- `single_admin_idx` + case-insensitive username uniqueness (`supabase-schema.sql:25-28`)
- Atomic checkout RPC `checkout_sale()` (`supabase-schema.sql:184`)
- `touch_updated_at()` triggers (`supabase-schema.sql:165`)

### 3. If you applied an older schema and see `infinite recursion detected in policy for relation "users"`

Run `supabase-fix-recursion.sql` in SQL Editor — it drops all policies, recreates `is_admin()`, and re-applies correct policies.

### 4. Confirm

```sql
select tablename from pg_tables where schemaname='public';
select proname from pg_proc where proname in ('is_admin','checkout_sale');
select policyname, tablename from pg_policies where schemaname='public';
```

You should see 8 tables, both functions, and ~14 policies.

### 5. Auth settings (recommended)

Dashboard > Authentication > Configuration:
- Enable Email provider if you use `users` via `auth.users` FK.
- Disable email confirmations for PIN-based flow if needed.
- Keep RLS **enabled** — `SUPABASE_SETUP.md:5` warns to review policies before production.

---

## Local Development

```bash
# 1. Clone & install
git clone <your-repo> syvora12
cd syvora12

# pnpm (recommended)
pnpm install
# or npm
npm install

# 2. Env
copy .env.example .env.local   # PowerShell
# cp .env.example .env.local   # bash/macOS
# Edit .env.local — set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY

# 3. Apply Supabase schema (see section above) if not done

# 4. Run dev server (auto-copies static -> public/static)
pnpm dev
# or npm run dev
# Open http://localhost:3000 — the iframe loads /static/index.html

# 5. Lint (optional)
pnpm lint
# or npm run lint
```

- Dev server binds `0.0.0.0:3000` (`package.json:6`) so LAN devices can test (allowed origins in `next.config.mjs:40-54`).
- Security headers + CSP are injected via `next.config.mjs:3-33` (note `X-Frame-Options: SAMEORIGIN` is required for the iframe — `next.config.mjs:7`).
- Rate limiting for `/api/worker-auth` is in-memory (`proxy.ts:25`) — replace with Redis for multi-instance prod if needed.

---

## Production Build (Local Verification)

Always verify before pushing to Vercel — `next.config.mjs:55` has `typescript.ignoreBuildErrors: false`, so type errors **fail the build**.

```bash
pnpm build
# or npm run build

# This runs: cpSync static->public/static && next build
# Expect: ✓ Compiled successfully, no type errors

# Smoke-test the production bundle locally
pnpm start
# or npm start
# Open http://localhost:3000 and test: login → POS add product → checkout → expenses → shift close

# Quick API health check (in another terminal)
curl http://localhost:3000/api/config
# -> { "ok": true, "configured": true, "supabaseUrl": "https://...", "supabaseKey": "sb_publishable_..." }

# If configured: false, your .env.local is missing or not loaded — restart the server after editing env
```

If `GET /api/products` returns `503` with `SUPABASE_SERVICE_ROLE_KEY غير مضبوط`, your service_role key is missing/invalid — see Troubleshooting.

---

## Deployment — Vercel (Recommended)

This project is optimized for Vercel (Next.js, `proxy.ts`/`middleware`, `@vercel/analytics`).

### A. Via Vercel Dashboard (no CLI)

1. Push repo to GitHub / GitLab / Bitbucket.
2. **Vercel** > Add New Project > Import Git Repository > select `syvora12` > Framework Preset: **Next.js** (auto-detected).
3. **Build settings** — leave defaults:
   - Build Command: `npm run build` (or `pnpm build` if Vercel detects pnpm via `pnpm-lock.yaml`)
   - Output Directory: `.next` (default)
   - Install Command: `pnpm install` / `npm install` (auto)
   - Node Version: `22.x` or `24.x` (Project Settings > General > Node.js Version — match `node -v` locally)
4. **Environment Variables** (Project > Settings > Environment Variables) — add **all three** and check **Production + Preview + Development**:
   | Key | Value | Notes |
   |---|---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://<ref>.supabase.co` | Public — safe for browser |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `sb_publishable_...` (or `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`) | Public — safe for browser |
   | `SUPABASE_SERVICE_ROLE_KEY` | `eyJ...` (JWT `role: service_role`) | **Secret** — server only. Do NOT prefix with `NEXT_PUBLIC_` |
   > Tip: copy values directly from `.env.local` / `.env.example:5-9`. After adding vars, **Redeploy** (Deployments > ⋯ > Redeploy) — env is baked at build time for `NEXT_PUBLIC_*`.

5. Deploy > wait for `✓ Build Completed` > visit `https://<project>.vercel.app`.
6. Verify via [Post-Deploy Checklist](#post-deploy-verification-checklist).

### B. Via Vercel CLI

```bash
npm i -g vercel
vercel login

# From project root
vercel              # link project (first time: pick scope, link to existing or create new)
vercel env add NEXT_PUBLIC_SUPABASE_URL production
# paste https://<ref>.supabase.co, repeat for each var:
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY production
vercel env add SUPABASE_SERVICE_ROLE_KEY production
# Also add for preview if you use PR deploys:
vercel env add NEXT_PUBLIC_SUPABASE_URL preview
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY preview
vercel env add SUPABASE_SERVICE_ROLE_KEY preview

vercel --prod       # build + deploy
vercel logs <deployment-url>  # stream logs if needed
```

### C. Subsequent deploys

- **Git push to `main`**: Vercel auto-deploys on push (if linked). No extra step.
- **Manual**: `vercel --prod` or Dashboard > Deployments > Redeploy.
- **Env change**: after editing env vars in Dashboard, you **must Redeploy** — a restart alone is not enough (`NEXT_PUBLIC_*` is inlined at build).

---

## Deployment — Self-Hosted Node / VPS

Works on any Ubuntu/Debian VPS, Railway, Render, Fly.io, etc.

```bash
# On server
git clone <repo> /opt/syvora12 && cd /opt/syvora12
node -v   # need >= 18.17
corepack enable && corepack prepare pnpm@latest --activate  # if using pnpm
pnpm install --frozen-lockfile   # or npm ci

# Env — create from template (do NOT commit)
cp .env.example .env.local
nano .env.local   # set the 3 vars (see table above)
# Or for production host that reads .env (not .env.local), also create:
cp .env.local .env

# Build & start
pnpm build        # cp static->public/static + next build
pnpm start        # listens 0.0.0.0:3000 (package.json:8)
# or with process manager:
pm2 start npm --name syvora12 -- start
pm2 save && pm2 startup
```

**Reverse proxy (Nginx) example:**

```nginx
server {
  listen 80;
  server_name pos.example.com;
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
# then: certbot --nginx -d pos.example.com
```

**Systemd alternative** (`/etc/systemd/system/syvora12.service`):

```ini
[Unit]
Description=Syvora12 Next.js
After=network.target

[Service]
WorkingDirectory=/opt/syvora12
ExecStart=/usr/bin/pnpm start
Restart=always
Environment=NODE_ENV=production
EnvironmentFile=/opt/syvora12/.env.local

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload && systemctl enable --now syvora12
journalctl -u syvora12 -f
```

> Self-hosted rate limit (`proxy.ts:6` in-memory `Map`) is per-instance. For multiple replicas, replace with Upstash Redis.

---

## Deployment — Docker (Optional)

No `Dockerfile` is shipped — use this minimal one if you need container deploys. Create `Dockerfile` at repo root:

```dockerfile
FROM node:22-alpine AS base
WORKDIR /app
COPY pnpm-lock.yaml package.json pnpm-workspace.yaml ./
RUN corepack enable && corepack prepare pnpm@latest --activate && pnpm install --frozen-lockfile
COPY . .
RUN pnpm build
EXPOSE 3000
CMD ["pnpm","start"]
```

```bash
docker build -t syvora12 .
docker run -p 3000:3000 --env-file .env.local syvora12
# Compose: add env_file: .env.local and restart: unless-stopped
```

Deploy the image to any container host (Fly.io, Railway, Render Docker, Coolify).

---

## Post-Deploy Verification Checklist

Run **immediately** after each deploy:

- [ ] `GET https://<host>/api/config` returns `{ configured: true }` — if `false`, env vars not set / not redeployed.
- [ ] `GET https://<host>/api/products` returns `{ products: [...] }` (200), not `503`.
- [ ] Open `https://<host>/` — iframe loads, no blank screen, no CSP console errors. Camera permission prompt appears for barcode scan (iframe `allow="camera"` — `app/page.tsx:10`).
- [ ] Login with worker PIN → POS: scan/search product → change qty → checkout → sale appears, stock decremented (via `checkout_sale()` RPC — `app/api/checkout/route.ts:37`).
- [ ] Inventory CRUD (admin perm `add_inv`/`edit_inv` — `app/api/products/route.ts:25,38`) → creates/updates without `الباركود موجود مسبقاً` unless duplicate.
- [ ] Expenses + Shift Close → report + WhatsApp `wa.me` link works.
- [ ] Check Vercel Logs (or `pm2 logs`) for `Supabase server credentials not configured` — indicates missing env.
- [ ] Security headers present: `curl -I https://<host>/ | grep -i "content-security-policy\|x-frame-options"` — should show CSP from `next.config.mjs:13` and `SAMEORIGIN`.
- [ ] Analytics: in production, `<Analytics />` loads (`app/layout.tsx:33` — only when `NODE_ENV=production`).

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `503 role anon instead of service_role` or `SUPABASE_SERVICE_ROLE_KEY ... anon` | `SUPABASE_SERVICE_ROLE_KEY` is set to anon/publishable key (`lib/supabase-server.ts:17`) | Dashboard > Project Settings > API > copy **service_role (secret)** — it decodes to `"role":"service_role"`. Set it as `SUPABASE_SERVICE_ROLE_KEY` (server-only), redeploy/restart. |
| `GET /api/products 503 إعداد الخادم غير مكتمل` | Missing env or build used stale env | Check `.env.local` locally / Vercel env vars. After fixing, **rebuild** (`pnpm build` locally, Redeploy on Vercel). `NEXT_PUBLIC_*` is build-time only. |
| `infinite recursion detected in policy for relation "users"` | Old RLS policies before `is_admin()` fix | Run `supabase-fix-recursion.sql` in SQL Editor (see DB setup step 3). |
| `الباركود موجود مسبقاً` on new product | `products.barcode` unique constraint (`supabase-schema.sql:42`) | Use a different barcode (4–64 chars). |
| `الكمية غير كافية` / stock not decreasing | Checkout does server-side validation (`app/api/checkout/route.ts:29`) + atomic `checkout_sale()` | Pull latest `products` — stock may have been consumed by concurrent sale. Retry. |
| Iframe blank in production | CSP or `X-Frame-Options: DENY` | This repo sets `SAMEORIGIN` (`next.config.mjs:7`) — if you added `DENY` in a proxy/CDN, revert to `SAMEORIGIN`. Iframe **must** be same-origin to load `/static/index.html`. |
| Camera/Barcode scan not working | Iframe not allowed camera | Check `app/page.tsx:10` has `allow="camera; ..."` and `sandbox` includes `allow-same-origin allow-scripts`. Also check browser permission. |
| `Blocked cross-origin request` loop in dev | HMR from LAN IP | Already handled by `allowedDevOrigins` in `next.config.mjs:40`. Add your IP if needed. |
| `Too many requests` on login | `proxy.ts:44` rate limit (20/min/IP for `POST /api/worker-auth`) | Wait 60s or raise limit in `proxy.ts:44` if behind shared NAT. |
| Build fails: `Type errors` | `next.config.mjs:56` `ignoreBuildErrors: false` | Run `pnpm build` locally, fix TS errors before deploy. |

Logs: Vercel Dashboard > Deployments > View Logs. Self-hosted: `pm2 logs` / `journalctl -u syvora12 -f`. Supabase: Dashboard > Logs > Postgres.

---

## Security Notes

- **Never commit** `.env.local` / `.env` — `.gitignore:10` ignores `.env*.local` and `.env.*` (only `!.env.example` is tracked).
- `SUPABASE_SERVICE_ROLE_KEY` bypasses RLS — only set in **server** env (Vercel server env, VPS `.env.local`). Never prefix with `NEXT_PUBLIC_`, never ship to browser — `SUPABASE_SETUP.md:3` explicitly warns this.
- RLS is **enabled on all 7 tables** (`supabase-schema.sql:95-102`) + `is_admin()` is `SECURITY DEFINER` to avoid recursion — do not disable.
- Direct `INSERT` on `sales`/`expenses`/`shift_closings` from `authenticated` is blocked (`*_no_direct_write` policies with `WITH CHECK (false)`) — writes must go via `checkout_sale()` RPC or server API with service_role.
- Headers: CSP, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`, `HSTS` all set in `next.config.mjs:3-33`. The CSP allows `cdn.jsdelivr.net`, `unpkg.com`, `cdnjs.cloudflare.com` for the POS shell — tighten if you remove those CDNs.
- Rotate `service_role` key via Supabase Dashboard > API > Reset if leaked — update **both** local `.env.local` and Vercel env, then redeploy.

---

## Project Structure

```
syvora12/
├── app/
│   ├── layout.tsx           # Root layout + Vercel Analytics (prod only)
│   ├── page.tsx             # Iframe wrapper -> /static/index.html
│   ├── globals.css
│   └── api/
│       ├── checkout/route.ts   # Atomic checkout via checkout_sale() RPC
│       ├── products/route.ts   # Inventory CRUD (admin perms add_inv/edit_inv)
│       ├── expenses/route.ts
│       ├── shift/route.ts
│       ├── workers/route.ts
│       ├── worker-auth/route.ts
│       ├── settings/route.ts
│       └── config/route.ts     # Public env check (safe key only)
├── static/index.html        # Main POS UI (copied to public/static on build)
├── lib/
│   ├── supabase-server.ts   # getAdminClient() + requireAuth() + hasPerm()
│   └── crypto.ts            # scrypt PIN hashing
├── proxy.ts                 # Rate limit + no-store for /api/* (also exported as middleware)
├── next.config.mjs          # Security headers, CSP, allowedDevOrigins
├── supabase-schema.sql      # Full idempotent schema + RLS + RPC
├── supabase-fix-recursion.sql # Hotfix for old recursion policies
├── SUPABASE_SETUP.md        # Minimal Supabase env guide
├── .env.example             # Env template (public URL + anon + service_role)
└── package.json             # dev/build/start scripts with static copy
```

Further roadmap and feature planning: see `FEATURES_ROADMAP.md`.

---

## Deploy Quick Reference

```bash
# Local one-time
cp .env.example .env.local && nano .env.local   # set 3 vars
pnpm install && pnpm build && pnpm start        # verify

# Vercel (Dashboard): import repo -> set 3 env vars (Prod+Preview) -> Deploy -> Redeploy after env change
# Vercel (CLI): vercel --prod
# Supabase: SQL Editor -> paste supabase-schema.sql -> Run
curl https://<host>/api/config   # -> { configured: true } means deploy is healthy
```
