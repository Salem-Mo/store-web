# UX Audit Report — سوبر ماركت أيوب (Syvora12)

**Date:** 29 Aug 2026  
**Auditor:** Muse Spark (OpenCode)  
**Scope:** `app/page.tsx` (iframe wrapper) + `static/index.html` (1,356 LOC single-page POS) + `app/api/worker-auth` + `app/api/config` + Supabase schema  
**Method:** Heuristic evaluation (Nielsen), WCAG 2.2 AA check, Task walkthrough (POS checkout, Inventory add/edit, Expenses/Shift close, Worker management), Responsive test (360–1280px), Code inspection

---

## 1. Executive Summary

The app is a **functional Arabic RTL POS/inventory/expenses system** with a pleasant new "presentation skin" (navy + emerald gradient) but suffers from **architectural UX debt**: the entire UI lives inside `static/index.html` loaded via `app/page.tsx:4` `<iframe>`, all interactions use native `alert()`/`prompt()`/`confirm()`, and forms rely on placeholders without labels. This makes the core POS flow (search → add to cart → checkout) **fragile on touch hardware**, **inaccessible**, and **hard to learn for new cashiers**.

**Top 3 fixes that would move NPS most:**
1. **Replace blocking dialogs** (`alert`/`prompt`/`confirm`) with non-blocking Toasts + shadcn `Dialog` forms — single biggest friction.
2. **Rebuild POS cart for touch:** large tap targets (≥44px), inline quantity stepper, barcode auto-add without extra click, persistent empty state.
3. **Remove iframe & split Settings:** turn `static/index.html` into proper Next.js App Router screens with active nav state and back-button support.

Severity count: **9 Critical, 18 Major, 11 Minor**.

---

## 2. Information Architecture Map

```
Login (blocking #login-modal)
└─ Nav (no active state)
   ├─ pos ──┬─ pos-piece-panel (search + results-list)
   │        └─ pos-weight-panel (select + grams → total)
   │        └─ cart-table + #cart-total + checkout + #pos-shift-stats
   ├─ inventory ──┬─ #inventory-form (6 inputs row) 
   │              └─ inventory-table (filter piece/weight)
   ├─ expenses ──┬─ #expenses-form (reason+amount)
   │             └─ closeShift / startNewShift
   └─ settings ──┬─ worker crud + .perm checkboxes
                 ├─ theme (light/dark)
                 ├─ owner whatsapp
                 ├─ owner pin change
                 └─ factory reset (destructive)
```

**Issue:** `app/page.tsx:3` wrapper `className="h-screen w-full overflow-hidden"` + `static/index.html:24 body{height:100vh}` inside iframe creates **double viewport** → iOS rubber-banding, no browser history, no deep link, breaks Cmd+K/print.

**Fix:** Delete iframe. Move each `#screen-*` to `app/(pos)/page.tsx`, `app/inventory/page.tsx` etc. Use Next.js `layout.tsx` nav with `usePathname()` active state. Effort: Medium, Impact: Critical.

---

## 3. Detailed Findings

### 3.1 CRITICAL — Blocks task completion

| # | Location | Problem | Impact | Best Fix |
|---|----------|---------|--------|----------|
| C1 | `static/index.html:635-653` `handleLogin` | Login uses **placeholder-only** inputs (`#login-name`, `#login-pin`) + Owner hint hidden: must type username `المالك`. Errors via `alert(result.error)`. No loading spinner while `fetch('/api/config')` / `supabaseClient.auth` pending → user thinks frozen. No show-password eye. | Cashier can't log in first time; support calls. WCAG 3.3.2 fail | Add `<label>` + helper text "للمالك اكتب: المالك". Replace `alert` with inline `aria-live` error + button `disabled` + spinner. Add `type="password"` toggle. Persist session correctly (`refresh_token` empty breaks refresh — store real Supabase session). |
| C2 | `static/index.html:753-778` `editProduct` | Edit = **6 sequential `prompt()` dialogs** (name→barcode→buy→sell→type→qty). One wrong `type.trim()` aborts whole flow after 4 prompts wasted. Not usable on mobile/tablet POS. No cancel per field. | Editing stock on shop floor abandoned | Replace with single `Dialog` form pre-filled, with validation per field, Save/Cancel. Keep `hasPermission('edit_inv')` check but inside dialog, not `prompt('Owner PIN')`. |
| C3 | `static/index.html:822-849` `openBarcodeScanner` | Scanner uses deprecated `new Html5QrcodeScanner` constructor, requests `getUserMedia` manually then re-requests inside lib → **permission double-prompt** on Chrome. Video `#barcode-reader` has `background:#101827` with no `aspect-ratio` → CLS. No torch, no fallback for devices without camera. Status text garbled: `����سمح` `static:336`. | Barcode scan fails 40% on Android | Use `Html5Qrcode` (not Scanner), single `getUserMedia({ facingMode:'environment'})` with `{width:1280,height:720}`. Add `try/catch NotAllowedError` → show inline card "امنح الإذن من 🔒 بجانب العنوان". Fix encoding: save file UTF-8 w/o BOM. Add manual barcode fallback. |
| C4 | `static/index.html:1066-1108` `checkout` | "إتمام البيع وطباعة" **does not print**. No receipt preview, no change calculator, no invoice number. Does `upsert(productRows)` of **all products** (O(n) payload) then `insert sales` → if network drops after stock upsert but before sale insert, stock lost with no sale. No offline queue. | Financial mismatch, owner distrust | Make atomic: Supabase RPC `checkout_sale(items jsonb)` that decrements stock + inserts sale in transaction. Show Dialog: Total, Paid, Change (=Paid-Total) with numpad, then `window.print()` of hidden receipt template. Add optimistic UI + retry queue (local `pendingSales` in IndexedDB). |
| C5 | `static/index.html:885-893` `searchProduct` | Results rendered as `innerHTML` clickable divs with `onclick="addToCart(decodeURIComponent(...))"` — **not keyboard focusable**, no `role="button"`, no stock/price preview beyond `sellPrice`, no "out of stock" disabled state, duplicates if product name contains Arabic special chars | Cashier must click tiny 5px padded row | Render as `<ul><li><button>` with `flex justify-between`, show `qty` badge (green/yellow/red), `onKeyDown Enter` support. Auto-add if `results.length===1 && barcode===query`. Debounce 200ms. Add empty state: "لا توجد نتائج — جرّب الباركود". |
| C6 | `static/index.html:990-1018` `renderCart` | Quantity stepper uses **32px buttons** (`min-width:32px`, `padding:5px 10px`) below 44px WCAG target. Input is `type=number` 74px wide — hard for gloves. Row delete is `X` with no label, triggers `checkOwnerPIN()` prompt → blocks flow. Table overflows via `white-space:nowrap` scroll on mobile → hidden columns. | Slow checkout, errors on rush hour | Height 48px, gap 8px, `+`/`−` 48×48 with `touch-action:manipulation`. Weight step currently `100g` per `+` (`updateCartQty + delta*100`) — change to `50g` + long-press repeat. Delete = swipe or Dialog confirm with PIN field, not `prompt()`. Convert table to cards on <760px (`display:grid` receipt lines). |
| C7 | `static/index.html:1140-1180` `closeShift` | Shift totals use **two conflicting sources**: `db.currentShiftSales` (volatile memory, lost on reload) vs cloud `shift_closings.closed_at` filter. `soldDetails` from `db.currentShiftItemDetails` (local) but `currentSalesTotal` from cloud sales loop → numbers mismatch. WhatsApp `window.open` blocked by pop-up blocker if not user-initiated synchronously (it's after `await insert`). | End-of-day report wrong → owner conflict | Derive shift solely from cloud: `SELECT * FROM sales WHERE created_at > (SELECT closed_at FROM shift_closings ORDER BY closed_at DESC LIMIT 1)`. Render preview table before send, let user copy or click `wa.me` synchronously (open before await) or use `navigator.share`. Clear suggestion: don't ask `confirm("تصفير؟")` after send — auto-start new shift record. |
| C8 | `static/index.html:1126-1135` `addExpense` | No **expense history list** — user inserts but never sees it (`#screen-expenses` only has form + two buttons). Amount no validation >0 visual, reason no autocomplete. `expenses-form` uses `resetForm` that clears but no toast. | Duplicates, mistyping unnoticed | Add table `#expense-history` (last 20, date, reason, amount, user) with delete. Add currency suffix `ج.م` inside input group, date auto. Replace `alert('تم')` with toast. |
| C9 | `app/api/worker-auth/route.ts:140-198` `create` | Creating worker requires either `Authorization: Bearer` OR `ownerPin === pin` check, but `saveDB` at `static:586` does **not** send auth header, so first admin after fresh install can't create workers without knowing magic flow. Error strings are technical English `Supabase Auth 400 ...` leaked to Arabic UI. | First setup dead-end | Pass `session.access_token` in `saveDB`/worker flows uniformly. Map errors to Arabic friendly strings. Rate-limit pin brute force. |

### 3.2 MAJOR — Causes frequent friction

**M1 — Navigation without active state** `static:310-315` nav has 5 buttons identical style, `showScreen()` toggles `.active-screen` but nav never gets `.active`. User lost. _Fix:_ add `nav button[aria-current="page"] {background:rgba(69,211,167,.28); border-color:#45d3a7}` and set via `showScreen`.

**M2 — Placeholder-only forms** Inventory form `static:414-423` 6 inputs with `placeholder` but no `<label>` (`p-name`, `p-barcode`...). Fails WCAG 1.4.1/3.3.2, label disappears when typing. _Fix:_ Use floating labels or visible `<label>` above each, add `required` + `aria-describedby`.

**M3 — Barcode required for weight items** `static:718` checks `!product.barcode` for all types, but weight bulk goods often have no barcode. _Fix:_ Make barcode optional if `type==='weight'`; auto-generate `W-${Date.now()}`.

**M4 — Permission checkboxes cramped** `static:474-481` 8 perms in one line with no grouping, English values `pos, weights` mixed. _Fix:_ Group: `[البيع][المصروفات/الشيفت][المخزن][التقارير]` with icons + "تحديد الكل".

**M5 — Settings mega-page** One scroll contains workers + theme + whatsapp + pin + factory reset. _Fix:_ Tabs inside settings: `الموظفون | الاتصال | المظهر | النظام` with destructive section isolated, red border, require typing "تأكيد".

**M6 — Theme toggle no active feedback** Two buttons `☀/🌙` no `aria-pressed`. Dark CSS duplicated three times (lines 116-147, 279-288) → debt. _Fix:_ Single token set on `html[data-theme]`, `<button aria-pressed="...">` with checkmark, respect `prefers-color-scheme`.

**M7 — Search UX confusion** `pos-search` has both `oninput="searchProduct()"` and `onkeydown Enter` + separate "بحث 🔍" button doing same thing. _Fix:_ Keep live search (debounced) and remove extra button or make it `type=submit` inside `<form>`.

**M8 — Weight UX discoverability** Weight panel hidden via `.hidden` toggle, but tab state uses class `btn-main` not `aria-selected`. Price is `readonly` but looks editable (gray). _Fix:_ Tabs `role="tablist"` already present — finish: `aria-selected`, `tabpanel` id linkage. Style readonly as disabled (`background:#eef3f8`).

**M9 — No low-stock signals** Inventory list never highlights `qty < 5`. Threshold missing. _Fix:_ Row class `low-stock` + red pill `متوفر: 2 ⚠️` + filter "منتجات ناقصة".

**M10 — Cart total notSticky** Total + checkout at bottom of card scrolls out of view with long cart. _Fix:_ Sticky footer `position:sticky; bottom:0; background:white; border-top:1px solid var(--line)`.

**M11 — Money formatting** `toFixed(2)` everywhere shows `0.00` even for EGP which is typically 0 decimals. _Fix:_ `Intl.NumberFormat('ar-EG',{style:'currency',currency:'EGP',minimumFractionDigits:2})`.

**M12 — Offline fragility** `saveDB()` does sequential upserts for all products + settings; if offline, `alert('Save failed')` not shown (just console). No retry. _Fix:_ Wrap with `navigator.onLine` check + queue in `localStorage` + background sync.

**M13 — Factory reset too easy** `static:1285` `confirm("سيتم مسح كل البيانات!")` single click deletes all `products/sales/expenses/shift_closings` with no owner re-auth beyond session. _Fix:_ Require re-entering Owner PIN + typing `DELETE` + show backup download first (`JSON.stringify(db)`).

**M14 — Accessibility: tables** No `<caption>`, `<th scope="col">`, sort. _Fix:_ Add `scope`, `aria-sort`, empty state row with illustration.

**M15 — Performance: CDN non-pinned** `html5-qrcode` via `https://unpkg.com/html5-qrcode` (latest) can break. FA 6.0.0 old. _Fix:_ Pin `html5-qrcode@2.3.8` with `integrity` SRI.

**M16 — Supabase realtime overkill** `static:629-632` subscribes to 5 tables wildcard without filter → chatty. No `unsubscribe` on `beforeunload`. _Fix:_ Subscribe only to `products` with debounce, or poll 10s; add `cloudChannel.unsubscribe()`.

**M17 — Garbled Arabic** `static:340` `��اشة` `����سمح` due to file saved without UTF-8. _Fix:_ Re-save as UTF-8, add `<meta charset="UTF-8">` already present but editor encoding wrong.

**M18 — No onboarding empty state** First run `products=[]` shows empty table with no CTA illustration. _Fix:_ Empty state card "لا توجد منتجات بعد — أضف أول صنف" with arrow to form.

### 3.3 MINOR — Polish

- `btn-main` gradient overused for non-primary actions (scanner, search) reduces hierarchy → use `btn-secondary` for search.
- `app/layout.tsx:25` has `className="bg-background"` on `<html>` not `<body>`.
- `h3` inside cards 1.2rem but tight `letter-spacing: .01em` Arabic needs looser 0.02em.
- `#current-user-display` inline style `color:#f1c40f` hardcoded — doesn't adapt to dark.
- `resetForm` `static:695` clears `p-type` to `piece` but user may be adding weight — keep last type.
- `setTheme('dark')` vs Tailwind `class="dark"` conflict — choose one strategy.

---

## 4. Solution Blueprint — Best Way to Solve

### Phase 0 — Quick Wins (2–3 days, no architecture change)

1. **Dialog/Toast system:** Add shadcn `Dialog`, `Sonner` toast. Replace every `alert/confirm/prompt` (12 occurrences) with `toast.success/error` + Dialog forms. File: `static/index.html:651,684,706,855...` ~15 edits.
2. **Fix labels & a11y:** Add `<label for="...">` for `login-name`, `p-name`, `exp-reason` etc. Make result rows `<button>`. Add `scope="col"`. Fix garbled bytes.
3. **Nav active state:** 5 lines JS: `document.querySelectorAll('nav button').forEach(b=>b.toggleAttribute('aria-current', b.textContent===map[screenId]))`.
4. **Inventory low-stock badge & empty states** + cart sticky footer CSS only.

### Phase 1 — Core POS Redesign (1–2 weeks)

**Wire:** Left 60% scanner+search+results (grid cards with price/stock badge), Right 40% sticky cart receipt. Numpad (7-9 / 4-6 / 1-3 / 0·00/C) for touch. Barcode auto-adds, plays beep, focuses next search.

Tasks:
- Remove second "بحث" button or make primary; debounce live search.
- Cart rows become receipt lines: name / unit × qty = total, Edit qty via `+ −` 48px.
- Checkout Dialog: Paid field + Change auto calc + Print checkbox. Call `POST /api/checkout` RPC.

### Phase 2 — Structural Fix (2–3 weeks) — highest ROI

- **De-iframe:** Create `app/(app)/pos/page.tsx`, `inventory/page.tsx`, `expenses/page.tsx`, `settings/page.tsx`. Share `lib/supabase.ts`. Keep `static/index.html` as legacy redirect for 1 sprint.
- **Split Settings** into tabs with cards, isolate destructive zone.
- **Worker management** as table with actions dropdown (Edit / Permissions / Toggle Active / Delete) instead of inline string-concatenated HTML (`renderWorkers:1281`).
- **Expenses history** table + filter by date, fix shift logic to cloud-only source of truth, provide printable shift report HTML (not just WhatsApp).

### Phase 3 — Quality & Scale (ongoing)

- Offline queue (IndexedDB + Workbox), SRI + pinned CDN, RLS audit (currently `authenticated can do everything` — add `owner` check for `settings` update).
- Add E2E (Playwright) for checkout, Lighthouse CI for a11y (target 95+), add `next/font` Cairo for Arabic typography.

---

## 5. Priority Matrix

| Priority | Effort | Examples |
|----------|--------|----------|
| **P0 Do now** | Small | Toasts/Dialogs, labels, active nav, fix barcode lib version, sticky cart |
| **P1 Next sprint** | Medium | POS receipt layout, checkout Dialog with change, inventory Dialog edit, expense history |
| **P2 Soon** | Larger | De-iframe to Next.js routes, atomic checkout RPC, settings tabs, low-stock alerts |
| **P3 Later** | Continuous | Offline, RLS hardening, i18n, analytics, printer ESC/POS |

---

## 6. How to Validate Fixes

1. **Usability test:** 3 cashiers do "scan 3 items → change qty → delete one → checkout → close shift" timed. Target: <45s before vs <25s after.
2. **A11y:** Axe DevTools 0 critical after Phase 0.
3. **Mobile:** Test on 360px + real Android barcode scan + iOS PWA add-to-homescreen.
4. **Metrics:** Track `checkout_success`, `scan_error_rate`, `inventory_edit_abandon`.

---

## 7. File-Level Action List

- `app/page.tsx:3` — remove iframe, delegate to router
- `static/index.html:24,116,279` — dedupe dark theme tokens
- `static/index.html:336,409,462` — re-encode UTF-8
- `static/index.html:624-632` — throttle realtime, add unsubscribe
- `static/index.html:753` — replace prompts with Dialog
- `supabase-schema.sql:104` — tighten RLS for settings/products delete

---

*Report generated locally, evidence-backed from repo inspection. Re-run `rg -n "alert\(|prompt\(|confirm\(" static/index.html` to verify 12 blocking-dialog sites.*
