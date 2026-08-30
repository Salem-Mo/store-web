-- Hotfix for "infinite recursion detected in policy for relation users"
-- Run this in Supabase SQL Editor if you already applied the old schema.
-- Single-admin guard: run once to enforce only one admin account
create unique index if not exists single_admin_idx on public.users ((true)) where role = 'admin';
-- Username uniqueness (case-insensitive, no reserved "المالك")
create unique index if not exists users_username_lower_unique on public.users (lower(username));
create unique index if not exists profiles_username_lower_unique on public.profiles (lower(username));
create or replace function public.is_admin() returns boolean
language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.users where id = auth.uid() and role = 'admin')
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

do $$ declare pol record; begin
  for pol in select policyname, tablename from pg_policies where schemaname='public' loop
    execute format('drop policy if exists %I on public.%I', pol.policyname, pol.tablename);
  end loop;
end $$;

create policy "users_select_own_or_admin" on public.users for select to authenticated using (auth.uid() = id OR public.is_admin());
create policy "users_admin_insert" on public.users for insert to authenticated with check (public.is_admin());
create policy "users_admin_update" on public.users for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "users_admin_delete" on public.users for delete to authenticated using (public.is_admin());

create policy "profiles_select_own_or_admin" on public.profiles for select to authenticated using (auth.uid() = id OR public.is_admin());
create policy "profiles_admin_write" on public.profiles for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "products_read_authenticated" on public.products for select to authenticated using (true);
create policy "products_admin_insert" on public.products for insert to authenticated with check (public.is_admin());
create policy "products_admin_update" on public.products for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "products_admin_delete" on public.products for delete to authenticated using (public.is_admin());

create policy "sales_select_own_or_admin" on public.sales for select to authenticated using (user_id = auth.uid() OR public.is_admin());
create policy "sales_no_direct_write" on public.sales for insert to authenticated with check (false);

create policy "expenses_select_own_or_admin" on public.expenses for select to authenticated using (user_id = auth.uid() OR public.is_admin());
create policy "expenses_no_direct_write" on public.expenses for insert to authenticated with check (false);

create policy "shift_select_own_or_admin" on public.shift_closings for select to authenticated using (user_id = auth.uid() OR public.is_admin());
create policy "shift_no_direct_write" on public.shift_closings for insert to authenticated with check (false);

create policy "settings_admin_select" on public.settings for select to authenticated using (public.is_admin());
create policy "settings_admin_write" on public.settings for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "audit_admin_read" on public.audit_log for select to authenticated using (public.is_admin());
create policy "audit_no_direct_write" on public.audit_log for insert to authenticated with check (false);
