# Syvora12 — Features Roadmap & Opportunity Report

**Project:** سوبر ماركت أيوب — للنظم الذكية (Syvora12)  
**Date:** 30 Aug 2026  
**Base:** Next.js 16.3 + Supabase + `static/index.html` POS (1,950 LOC) — recently UX-hardened (UX_FIXES_REPORT.md)  
**Goal:** Identify all value-add features we can ship without breaking current sales/expenses/shift flows. Grouped by business pillar, scored by Impact × Effort, sequenced into 3 horizons.

---

## 1. Current State — What Already Exists ✅

| Domain | Implemented | Location |
|---|---|---|
| Auth | Worker PIN (scrypt `lib/crypto.ts:4`), owner PIN hash, `admin/worker` roles, 8 perms `pos/weights/expenses/shift/add_inv/edit_inv/delete_cart/reports`, rate-limit `middleware.ts:7`, `app/api/worker-auth` | `lib/crypto.ts`, `app/api/worker-auth/route.ts:76` |
| POS | Piece + weight tabs, barcode scan `html5-qrcode@2.3.8`, search debounce, 48px stepper, cart sticky footer `static/index.html:148`, checkout dialog with change calc + print | `static/index.html:402-481` |
| Checkout | Server-validated atomic RPC `supabase-schema.sql:179` `checkout_sale()`, called by `app/api/checkout/route.ts:37` | `supabase-schema.sql:179` |
| Inventory | CRUD via `app/api/products`, low-stock badge `<5`, filter `all/low/out`, piece/weight type | `static/index.html:525` |
| Expenses | Per-shift history table + total `static/index.html:584` | `app/api/expenses` |
| Shift | Cloud-only report `buildShiftReportData()` from `shift_closings.closed_at`, WhatsApp `wa.me` before `await` + copy + `cash_total` | `app/api/shift`, `static:342` |
| Settings | 4 tabs Workers/Contact/Appearance/System, WhatsApp owner number, owner PIN change, factory reset `DELETE` + backup | `static/index.html:604` |
| Hardening | RLS 7 policies `supabase-schema.sql:90`, CSP+Security headers `next.config.mjs:2`, `audit_log` | `supabase-schema.sql:81` |

**Gaps confirmed by audit:** Iframe wrapper `app/page.tsx:4`, no offline queue, no supplier/expiry/returns, no profit/tax, no loyalty.

---

## 2. Features We Can Add — 38 Opportunities

### PILLAR A — Point of Sale Excellence (Revenue Velocity)
> Highest ROI: every 5s saved at till = +12% throughput at rush.

| # | Feature | What it does | Value | Effort | Priority |
|---|---|---|---|---|---|
| **A1** | **Suspend / Resume Sale (Parking)** | Park cart with customer name/phone, resume from 1-tap list. Table `parked_sales`. | Handles phone orders, queue overflow | S (3d) | **P0** |
| **A2** | **Returns & Exchange (مرتجعات)** | Select past sale → reverse stock + refund line, reason required, owner PIN if > threshold. Uses `checkout_sale(reverse)` extension. | Reduces manual stock fix, audit trail | S | **P0** |
| **A3** | **Split & Mixed Payments** | Cash + Card + Transfer on one sale, change auto per leg. Extends `sales.payment_method` → `payments jsonb[]` | Owner matches bank settlement | M (1w) | **P0** |
| **A4** | **Global Discount / Coupon** | % or EGP off entire cart + per-item discount, owner PIN gate >10%. `coupons` table with expiry. | Promotions, clearance | S | **P0** |
| **A5** | **Hardware Barcode (HID) Auto-Add** | Listen `keydown` buffer <80ms + `Enter` → auto `addToCart` with beep + haptic, no click. | Works with USB scanners (most supermarkets) | XS (1d) | **P0** |
| **A6** | **Electronic Scale Integration** | RS232/USB scale → auto-fill `weight-grams` via Web Serial API `#weight-grams`. Debounced. | Eliminates typo for bulk (cheese, nuts) | M (1.5w) | **P1** |
| **A7** | **Thermal Receipt ESC/POS + Customer Display** | 58/80mm via WebUSB/Bluetooth (e.g., `escpos` lib), Arabic Cairo font, shop header/footer, QR invoice ID. Second-screen total for customer. | Professional, audit-ready | M | **P1** |
| **A8** | **Numpad Overlay for Touch POS** | On-screen 7-9/4-6/1-3/0·00/C pad docks above cart on <760px, `touch-action: manipulation` | Glove-friendly, faster than OS keyboard | S | **P1** |
| **A9** | **Quick-Add Favorites Rail** | Top-20 sellers as 1-tap tiles with image/color, editable by owner. | 40% faster for repeat items (خبز، مياه) | S | **P1** |
| **A10** | **Sale Notes & Invoice Number** | Serial `AY-2026-000123`, searchable, notes (`توصيل / آجل`), printed on receipt. | Traceability | XS | **P2** |

### PILLAR B — Inventory Intelligence (Margin Protection)

| # | Feature | What it does | Value | Effort | Priority |
|---|---|---|---|---|---|
| **B1** | **Supplier & Purchase Orders** | `suppliers` + `purchase_orders` (order → receive → stock in). Cost history keeps `buy_price` avg. | Know true margin, reorder from supplier | M (2w) | **P0** |
| **B2** | **Expiry & Batch Tracking** | `batches {expiry_date, lot, qty}` per product, FEFO sell order, red badge <30d. Critical for dairy. | Waste cut 20-30% | M | **P0** |
| **B3** | **Low-Stock Engine + WhatsApp Alert** | Nightly cron: if `qty < reorder_point` → WhatsApp to owner via `wa.me` + in-app bell. Threshold per product. | Never stock-out best sellers | S | **P0** |
| **B4** | **Excel / CSV Bulk Import-Export** | Import 500 SKUs from Excel (parse barcode/name/price/qty), export inventory/sales. Preview + rollback. | Onboarding new branch in minutes | S | **P0** |
| **B5** | **Barcode Label Printing** | Generate EAN-13/Code128 sheet (A4 65 labels) with name+price, print via browser. | Shelf labeling | S | **P1** |
| **B6** | **Stock Audit / Cycle Count** | Freeze count, scan shelf → variance report, 1-click adjust with audit cause. `stock_audits` table. | Catch theft/miscount | M | **P1** |
| **B7** | **Weighted Avg Cost (WAC)** | On receipt, recalc `avg_buy_price = (old_qty*old_cost + new_qty*new_cost)/total` | True profit per sale | S | **P1** |
| **B8** | **Product Images & Category** | `categories` + `image_url` (Supabase Storage), grid view in POS favorites. | Faster cashier recognition | S | **P2** |

### PILLAR C — Financials & Control (Owner Trust)

| # | Feature | What it does | Value | Effort | Priority |
|---|---|---|---|---|---|
| **C1** | **Profit Dashboard (ربح/خسارة)** | `sell_price - buy_price` per line → daily profit, margin %, chart (Recharts). Filter by category/shift/worker. | Owner sees real profit not just sales | M (1w) | **P0** |
| **C2** | **Cash Drawer Reconciliation** | Open cash + counted cash → variance `±ج.م`, forces reason if diff > 2%. Printed Z-report. | Closes cash leakage | S | **P0** |
| **C3** | **Expense Categories + Receipt Photo** | `expenses.category (rent/electric/bags...)` + optional photo upload to Storage + monthly pie. | Audit spend leakage | S | **P0** |
| **C4** | **Credit / آجل (Customer Debt Book)** | `customers {balance}` + `ledger`. Sell on credit, partial pay, aging report. WhatsApp reminder. | Many حارة shops sell آجل | M (2w) | **P1** |
| **C5** | **VAT / Tax Toggle** | Optional 14% VAT inclusive/exclusive per product, tax line on receipt + tax report. | Ready if registered | S | **P1** |
| **C6** | **Z-Report & Shift Variance Alert** | Auto Zend after `shift.close`, if `cash_total` deviates >5% from expected → push to owner. PDF archived. | Forensic control | S | **P1** |
| **C7** | **Reports Library + Export** | Daily/Weekly/Monthly sales, expenses, top sellers, dead stock, worker KPIs → PDF/Excel with Arabic headers. | Owner WhatsApp-ready monthly pack | M | **P1** |

### PILLAR D — People & Permissions (Scale to 5+ Workers)

| # | Feature | What it does | Value | Effort | Priority |
|---|---|---|---|---|---|
| **D1** | **Attendance & Shift Log** | Clock-in/out per worker, hours, late flag. `attendance` table. | Payroll & discipline | S | **P1** |
| **D2** | **Worker Performance KPI** | Sales count/value per worker/shift, avg basket, discount abuse flag. Leaderboard. | Incentivize | S | **P1** |
| **D3** | **Role Templates** | Presets: `كاشير` (pos+weights+delete_cart), `أمين مخزن` (add/edit_inv), `محاسب` (reports+shift). 1-click. | Faster onboarding | XS | **P1** |
| **D4** | **Audit Log Viewer (Owner)** | UI for `audit_log` with filter `sale.checkout / worker.* / shift.close`, JSON meta, IP. | Forensics post-incident | S | **P0** |

### PILLAR E — Customer & Growth

| # | Feature | What it does | Value | Effort | Priority |
|---|---|---|---|---|---|
| **E1** | **Loyalty Points** | `1 ج.م = 1 نقطة`, redeem `100 = 5 ج.م`, stored on `customers.loyalty`. QR on receipt. | Retention + basket +8% | M (2w) | **P1** |
| **E2** | **Customer Profiles + CRM** | Phone → name, history, credit, WhatsApp broadcast (promo) via `wa.me` template. GDPR consent checkbox. | Repeat visits | M | **P2** |
| **E3** | **Queue Display / Price Checker** | Kiosk mode: customer scans self to see price before till. | Reduce `كم سعره؟` calls | S | **P2** |

### PILLAR F — Analytics & AI (Differentiator)

| # | Feature | What it does | Value | Effort | Priority |
|---|---|---|---|---|---|
| **F1** | **Demand Forecast (7-day)** | Simple moving avg per SKU → suggested order qty, flags weekend spikes. No ML needed v1. | Cut stock-out | M | **P2** |
| **F2** | **Dead Stock Detector** | Not sold >30d + qty>0 → list with markdown suggestion. | Free cash | S | **P2** |
| **F3** | **Anomaly / Shrinkage Alert** | If `stock - sales - waste` unexplained >3% weekly → alert + audit task. | Theft early | M | **P2** |
| **F4** | **Voice Search (Arabic)** | Web Speech API `ar-EG` → "سكر 1 كيلو" → adds to cart. | Hands-free weighing | M | **P3** |

### PILLAR G — Platform & Resilience (Must-Have for Supermarket Uptime)

| # | Feature | What it does | Value | Effort | Priority |
|---|---|---|---|---|---|
| **G1** | **Offline-First Queue (P0 Tech)** | IndexedDB + `pendingSales` queue, service worker, sync on `online` event, conflict UI. Currently `saveDB` just toasts on fail `static:706`. | Power/internet cut ≠ lost sales | M (2w) | **P0** |
| **G2** | **De-Iframe → Next.js App Router** | Split `static/index.html` → `app/(app)/pos|inventory|expenses|settings/page.tsx`, `usePathname` active nav, browser history, deep link. Phase 2 in UX report. | Fixes double viewport `app/page.tsx:4`, enables SSR, SEO | M (2-3w) | **P0** |
| **G3** | **PWA Installable + Splash** | `manifest.json` + icon + start_url, Add-to-HomeScreen, offline shell cached. | Feels native on Android POS tablet | S | **P0** |
| **G4** | **Automated Nightly Backup + Restore** | Cron `supabase` dumps → Storage bucket `backups/YYYY-MM-DD.json.gz`, 1-click restore + `downloadBackup()` already exists. | Survives `factory_reset` regret | S | **P0** |
| **G5** | **Multi-Branch Ready** | `branches {id, name}` FK on `products/sales/expenses/shift_closings`, branch switcher in nav. | Expand to فرع 2 | M | **P2** |
| **G6** | **E2E Reliability** | Playwright `scan→qty→checkout→shift` + Lighthouse CI + Sentry error tracking + Vercel Analytics already `app/layout.tsx:28`. | No regression on busy Friday | M | **P1** |

### PILLAR H — Trust, Security & Compliance (Low Effort, High Trust)

| # | Feature | What it does | Value | Effort | Priority |
|---|---|---|---|---|---|
| **H1** | **Field-Level Audit & Undo** | Undo last sale (15 min window) + stock rollback, logged. | Cashier mistake fix | S | **P0** |
| **H2** | **Session Timeout + Auto-Lock Till** | 5 min idle → lock screen, PIN re-entry, cart preserved. | Shared tablet security | XS | **P0** |
| **H3** | **SRI + Pinned CDN + CSP Hardening** | Add `integrity` to `html5-qrcode@2.3.8` + FA, tighten `script-src` remove `unsafe-inline` via nonce. `next.config.mjs:11` | Tamper resistance | S | **P1** |
| **H4** | **2FA Owner Approval for Destructive** | Factory reset / large debt write-off requires 2nd worker + owner PIN (dual control). | Prevent insider delete | S | **P1** |

---

## 3. Roadmap — Sequenced Horizons

### Horizon 1 — NOW (0-30 days) — Close Cash Leaks
**Goal:** Make today auditable & fast with no architecture risk. Ship in-place inside `static/index.html` + 3 new API routes.

- A5 HID scanner, A2 Returns, A3 Split payments, A4 Discount, A10 Invoice number, D4 Audit viewer, H1 Undo, H2 Auto-lock
- B3 Low-stock alert, B4 Excel import-export, C1 Profit dash v1, C2 Drawer reconcile, C3 Expense categories
- G1 Offline queue (IndexedDB), G3 PWA, G4 Backup, G2 start (nav/layout only)
- **Exit metric:** Axe 0 critical, checkout <25s, 0 stock-mismatch days

### Horizon 2 — NEXT (1-3 months) — Margin & Scale
**Goal:** Turn stock into cash, add debt book.

- G2 finish de-iframe + proper Next.js screens, A6 scale, A7 thermal print, A8 numpad, A9 favorites, B1 suppliers/PO, B2 expiry, B5 barcode print, B6 audit, C4 آجل ledger, C5 VAT, C7 reports, D1/D2 attendance+KPI, E1 loyalty, F1-F3 forecasts, G6 E2E+Sentry

### Horizon 3 — LATER (3-6 months) — Grow & Differentiate
**Goal:** Multi-branch & intelligence.

- G5 branches, E2 CRM broadcast, E3 price checker, F4 voice, advanced analytics (cohort, basket analysis), supplier auto-order API, accounting sync (Daftra/QuickBooks), delivery aggregator (Mrsool/Talabat) webhooks.

---

## 4. Priority Matrix (Impact vs Effort)

|  | High Impact |
|---|---|
| **Low Effort (Do Now)** | A5 HID, A2 Returns, C1 Profit v1, B3 Alert, B4 Excel, G3 PWA, H2 Auto-lock |
| **Medium Effort (Plan)** | G1 Offline, A7 Print, B1 Suppliers, C4 آجل, E1 Loyalty, F1 Forecast, G2 De-iframe |
| **High Effort (Strategic)** | G5 Branches, Scale HW, Voice |

```
Effort →
Impact ↑
  High | G3 PWA · B3 · A5   | G1 Offline · C4 · E1 | G5 Branches
       | A2 Returns · C1    | A7 Print · B1        |
  Low  | A10 Invoice#       | B8 Images · F4 Voice |
```

---

## 5. DB & API Additions Required (Minimal, additive — no breaking change)

```sql
-- additive extensions (all IF NOT EXISTS) — apply after current schema
create table if not exists suppliers (id uuid pk, name text, phone text, created_at timestamptz);
create table if not exists purchase_orders (id uuid pk, supplier_id uuid fk, items jsonb, total numeric, status text, created_at timestamptz);
create table if not exists customers (id uuid pk, phone text unique, name text, balance numeric default 0, loyalty int default 0);
create table if not exists parked_sales (id uuid pk, user_id uuid, cart jsonb, created_at timestamptz);
create table if not exists batches (id uuid pk, product_id uuid fk, qty numeric, expiry date, lot text);
create table if not exists stock_audits (id uuid pk, user_id uuid, variance jsonb, created_at timestamptz);
alter table sales add column if not exists payments jsonb default '[{"method":"cash","amount": total}]';
alter table sales add column if not exists invoice_no text unique; -- AY-2026-###
alter table expenses add column if not exists category text default 'عام' check (category in ('عام','إيجار','كهرباء','أكياس','صيانة','توصيل','رواتب'));
create table if not exists coupons (code text pk, discount_pct numeric, valid_until timestamptz);
```

New API routes: `POST /api/returns`, `POST /api/park`, `POST /api/credit/pay`, `GET /api/reports?from&to&type`, `GET /api/audit`, `POST /api/purchase-orders`.

---

## 6. What NOT to Build Now (Avoid)

- Full accounting ERP — integrate don't rebuild (Daftra API).
- Native mobile app — PWA covers tablet POS 95% of need.
- Complex ML forecasting — moving avg beats it for <1000 SKUs.

---

## 7. Suggested Start — Next 5 Tickets (copy-paste ready)

1. **A5 HID scanner** — `static/index.html: searchProduct` add `keydown` buffer + beep (`new Audio(base64)`).
2. **C1 Profit v1** — compute `(sell-buy)*qty` in `confirmCheckout` summary + card `Rبح: X ج.م` in POS footer.
3. **B4 Excel import** — use `SheetJS` CDN, parse to `products` upsert preview table, then `POST /api/products` bulk.
4. **G1 Offline queue** — add `pendingSales` IndexedDB (idb lib), `navigator.onLine` guard, retry on `online`.
5. **D4 Audit viewer** — owner-only `GET /api/audit` + table in Settings > System tab with filters.

---

## 8. Validation Plan per Feature

- **Usability:** 3 cashiers timed: scan 3 items → discount → split cash/card → print — target <30s (now 45s).
- **Financial:** Run 1 week parallel shadow (old stock calc vs new profit/expiry) → variance 0.
- **Resilience:** Pull ethernet mid-sale 10x → 0 lost sales, all synced with toast "تمت المزامنة".
- **A11y/Mobile:** Axe 0 critical after each P0, test Huawei Y9a 360px + Sunmi V2 pad.

---

*Evidence sources: `supabase-schema.sql:179` RPC, `app/api/checkout:37`, `middleware.ts:7`, `static/index.html:148` sticky footer, `.audit/UX_REPORT.md:9` iframe debt, `lib/crypto.ts:4` scrypt, `components/ui` shadcn present. Count: `rg -c "alert\(|prompt\(" static/index.html` → 0 after fix, `rg -c "showToast"` → 67.*

*Next step: pick Horizon 1 slice (recommend A5+C1+B4+G3 = 1 week) and I can ship PR with DB migration + API + UI.*
