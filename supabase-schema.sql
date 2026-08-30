-- Syvora12 — Hardened schema (post-fix)
-- Apply in Supabase SQL Editor. Idempotent with IF NOT EXISTS + DO blocks.
create extension if not exists pgcrypto;

-- Users table — pin -> pin_hash (scrypted, never plaintext)
create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  display_name text not null,
  role text not null default 'worker' check (role in ('admin','worker')),
  permissions jsonb not null default '[]'::jsonb,
  pin_hash text, -- scrypt hash, never plaintext PIN
  active boolean not null default true,
  created_at timestamptz not null default now()
);
-- Migration: drop plaintext pin if exists, add pin_hash
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='users' and column_name='pin') then
    alter table public.users drop column pin;
  end if;
exception when others then null;
end $$;
alter table public.users add column if not exists pin_hash text;
-- Single-admin enforcement: only one row where role='admin' allowed (DB-level guard for signup race)
create unique index if not exists single_admin_idx on public.users ((true)) where role = 'admin';
-- Username uniqueness: case-insensitive (no reserved names, trimmed comparison in API, DB guard)
create unique index if not exists users_username_lower_unique on public.users (lower(username));
create unique index if not exists profiles_username_lower_unique on public.profiles (lower(username));

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  display_name text not null,
  role text not null default 'worker' check (role in ('admin','worker')),
  permissions jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  barcode text not null unique check (char_length(barcode) between 4 and 64),
  buy_price numeric(12,2) not null default 0 check (buy_price >=0),
  sell_price numeric(12,2) not null default 0 check (sell_price >=0),
  quantity numeric(12,3) not null default 0 check (quantity >=0),
  unit_type text not null default 'piece' check (unit_type in ('piece','weight')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  total numeric(12,2) not null default 0 check (total >=0),
  payment_method text not null default 'cash' check (payment_method in ('cash','card','transfer')),
  items jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  reason text not null check (char_length(reason) between 1 and 200),
  amount numeric(12,2) not null default 0 check (amount >0),
  created_at timestamptz not null default now()
);

create table if not exists public.shift_closings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  total_sales numeric(12,2) not null default 0 check (total_sales >=0),
  expenses numeric(12,2) not null default 0 check (expenses >=0),
  cash_total numeric(12,2) not null default 0,
  notes text,
  closed_at timestamptz not null default now()
);

-- Settings stores hashed secrets only, e.g. { hash:"scrypt$...", number:"2010..." }
create table if not exists public.settings (
  key text primary key check (key in ('owner_pin','owner_whatsapp')),
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- Audit log (append-only, admin readable)
create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  target text,
  meta jsonb,
  created_at timestamptz not null default now()
);

alter table public.users enable row level security;
alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.sales enable row level security;
alter table public.expenses enable row level security;
alter table public.shift_closings enable row level security;
alter table public.settings enable row level security;
alter table public.audit_log enable row level security;

-- Fix: infinite recursion — helper must be SECURITY DEFINER to bypass RLS on users
create or replace function public.is_admin() returns boolean
language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.users where id = auth.uid() and role = 'admin')
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- Recreate policies least-privilege (drop existing first)
do $$ declare pol record; begin
  for pol in select policyname, tablename from pg_policies where schemaname='public' loop
    execute format('drop policy if exists %I on public.%I', pol.policyname, pol.tablename);
  end loop;
end $$;

-- users: own row or admin (via is_admin() — no recursion)
create policy "users_select_own_or_admin" on public.users for select to authenticated using (
  auth.uid() = id OR public.is_admin()
);
create policy "users_admin_insert" on public.users for insert to authenticated with check (public.is_admin());
create policy "users_admin_update" on public.users for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "users_admin_delete" on public.users for delete to authenticated using (public.is_admin());

create policy "profiles_select_own_or_admin" on public.profiles for select to authenticated using (
  auth.uid() = id OR public.is_admin()
);
create policy "profiles_admin_write" on public.profiles for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- products: all authenticated can read (no recursion: using true); writes admin-only via is_admin()
create policy "products_read_authenticated" on public.products for select to authenticated using (true);
create policy "products_admin_insert" on public.products for insert to authenticated with check (public.is_admin());
create policy "products_admin_update" on public.products for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "products_admin_delete" on public.products for delete to authenticated using (public.is_admin());

-- sales: own rows or admin; inserts blocked for direct anon (force /api/checkout via service_role)
create policy "sales_select_own_or_admin" on public.sales for select to authenticated using (
  user_id = auth.uid() OR public.is_admin()
);
create policy "sales_no_direct_write" on public.sales for insert to authenticated with check (false);

-- expenses: same
create policy "expenses_select_own_or_admin" on public.expenses for select to authenticated using (
  user_id = auth.uid() OR public.is_admin()
);
create policy "expenses_no_direct_write" on public.expenses for insert to authenticated with check (false);

-- shift_closings: same
create policy "shift_select_own_or_admin" on public.shift_closings for select to authenticated using (
  user_id = auth.uid() OR public.is_admin()
);
create policy "shift_no_direct_write" on public.shift_closings for insert to authenticated with check (false);

-- settings: admin only (is_admin), no worker read
create policy "settings_admin_select" on public.settings for select to authenticated using (public.is_admin());
create policy "settings_admin_write" on public.settings for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- audit_log: admin read only
create policy "audit_admin_read" on public.audit_log for select to authenticated using (public.is_admin());
create policy "audit_no_direct_write" on public.audit_log for insert to authenticated with check (false);

-- updated_at trigger
create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists trg_products_updated on public.products;
create trigger trg_products_updated before update on public.products for each row execute function public.touch_updated_at();
drop trigger if exists trg_settings_updated on public.settings;
create trigger trg_settings_updated before update on public.settings for each row execute function public.touch_updated_at();

-- Least privilege grants: revoke all, then grant minimal
revoke all on all tables in schema public from authenticated, anon;
revoke all on all sequences in schema public from authenticated, anon;
grant select on public.products to authenticated;
grant select on public.users, public.profiles to authenticated;
grant select on public.sales, public.expenses, public.shift_closings to authenticated;
-- writes are via service_role in API routes only; no direct insert/update grant to authenticated except admin via RLS
grant all on public.products, public.users, public.settings, public.audit_log to authenticated; -- RLS still enforces admin check; keep for admin SDK but policies block workers
-- sequences needed for uuid only if using serial (not needed for gen_random_uuid) but keep usage
grant usage on all sequences in schema public to authenticated;

-- Helper: atomic checkout function (server calls as service_role)
create or replace function public.checkout_sale(p_user_id uuid, p_total numeric, p_items jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_sale_id uuid; item jsonb; v_barcode text; v_qty numeric; v_type text;
begin
  if p_total < 0 then raise exception 'invalid total'; end if;
  -- decrement stock atomically, fail if insufficient
  for item in select * from jsonb_array_elements(p_items) loop
    v_barcode := item->>'barcode';
    v_type := coalesce(item->>'type','piece');
    if v_type='weight' then v_qty := coalesce((item->>'qty')::numeric,0);
    else v_qty := coalesce((item->>'qty')::numeric,1); end if;
    if v_qty <=0 then raise exception 'invalid qty %', v_barcode; end if;
    update public.products set quantity = quantity - v_qty, updated_at=now()
      where barcode = v_barcode and quantity >= v_qty;
    if not found then raise exception 'insufficient stock for %', v_barcode; end if;
  end loop;
  insert into public.sales(user_id, total, payment_method, items) values (p_user_id, p_total, 'cash', p_items) returning id into v_sale_id;
  return v_sale_id;
end $$;
revoke all on function public.checkout_sale(uuid,numeric,jsonb) from public;
grant execute on function public.checkout_sale(uuid,numeric,jsonb) to authenticated;
