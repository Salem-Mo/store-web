-- Enable pgcrypto for uuid generation
create extension if not exists pgcrypto;

-- Users table (profiles)
create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  display_name text not null,
  role text not null default 'worker',
  permissions jsonb not null default '[]'::jsonb,
  pin text, -- Added for PIN-based login support
  created_at timestamptz not null default now()
);

-- Profiles table (redundant but used in route.ts)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  display_name text not null,
  role text not null default 'worker',
  permissions jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

-- Products table
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  barcode text not null unique,
  buy_price numeric(12,2) not null default 0,
  sell_price numeric(12,2) not null default 0,
  quantity numeric(12,3) not null default 0,
  unit_type text not null default 'piece',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Sales table
create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  total numeric(12,2) not null default 0,
  payment_method text not null default 'cash',
  items jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

-- Expenses table (Newly added)
create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  reason text not null,
  amount numeric(12,2) not null default 0,
  created_at timestamptz not null default now()
);

-- Shift closings table
create table if not exists public.shift_closings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  total_sales numeric(12,2) not null default 0,
  expenses numeric(12,2) not null default 0,
  cash_total numeric(12,2) not null default 0,
  notes text,
  closed_at timestamptz not null default now()
);

-- Settings table (Newly added for owner settings)
create table if not exists public.settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- Enable RLS
alter table public.users enable row level security;
alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.sales enable row level security;
alter table public.expenses enable row level security;
alter table public.shift_closings enable row level security;
alter table public.settings enable row level security;

-- RLS Policies
-- Users/Profiles: Authenticated users can read all profiles
create policy "Authenticated users can read profiles" on public.users for select to authenticated using (true);
create policy "Authenticated users can read profiles_alt" on public.profiles for select to authenticated using (true);

-- Products: Authenticated users can do everything (POS needs to update quantity)
create policy "Authenticated users can manage products" on public.products for all to authenticated using (true) with check (true);

-- Sales: Authenticated users can insert sales and read all sales
create policy "Authenticated users can manage sales" on public.sales for all to authenticated using (true) with check (true);

-- Expenses: Authenticated users can manage expenses
create policy "Authenticated users can manage expenses" on public.expenses for all to authenticated using (true) with check (true);

-- Shift Closings: Authenticated users can manage shift closings
create policy "Authenticated users can manage shift closings" on public.shift_closings for all to authenticated using (true) with check (true);

-- Settings: Authenticated users can read settings, only admins (owners) can update
create policy "Authenticated users can read settings" on public.settings for select to authenticated using (true);
create policy "Admins can manage settings" on public.settings for all to authenticated using (
  exists (select 1 from public.users where id = auth.uid() and role = 'admin')
) with check (
  exists (select 1 from public.users where id = auth.uid() and role = 'admin')
);

-- Grant permissions
grant all on all tables in schema public to authenticated;
grant all on all sequences in schema public to authenticated;
