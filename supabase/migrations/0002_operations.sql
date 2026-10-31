-- 0002: operational tables (menu, shifts, stock, orders, expenses, settings)

alter table public.locations add constraint locations_id_org_key unique (id, org_id);

create table public.menu_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  category text not null,
  price numeric not null check (price >= 0),
  unit text not null,
  available boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.shifts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  location_id uuid not null,
  opened_by uuid not null references public.profiles(id),
  closed_by uuid references public.profiles(id),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  unique (id, org_id),
  foreign key (location_id, org_id) references public.locations (id, org_id),
  check ((closed_at is null) = (closed_by is null))
);
create unique index shifts_one_open_per_location on public.shifts (location_id) where closed_at is null;

create table public.shift_assignments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  shift_id uuid not null,
  user_id uuid not null references public.profiles(id),
  joined_at timestamptz not null default now(),
  unique (shift_id, user_id),
  foreign key (shift_id, org_id) references public.shifts (id, org_id) on delete cascade
);

create table public.shift_stock (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  shift_id uuid not null,
  item_id uuid not null,
  item_name text not null,
  unit text not null,
  opening_qty integer not null default 0 check (opening_qty >= 0),
  added_qty integer not null default 0 check (added_qty >= 0),
  quantity integer not null default 0 check (quantity >= 0),
  created_at timestamptz not null default now(),
  unique (shift_id, item_id),
  foreign key (shift_id, org_id) references public.shifts (id, org_id) on delete cascade
);

create table public.shift_close (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  shift_id uuid not null,
  item_id uuid not null,
  opening_qty integer not null,
  sold_qty integer not null,
  actual_remaining integer not null check (actual_remaining >= 0),
  variance integer not null,
  created_at timestamptz not null default now(),
  unique (shift_id, item_id),
  foreign key (shift_id, org_id) references public.shifts (id, org_id) on delete cascade
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  shift_id uuid not null,
  staff_id uuid not null references public.profiles(id),
  items_json jsonb not null,
  subtotal numeric not null check (subtotal >= 0),
  total numeric not null check (total >= 0),
  payment_method text not null,
  cash_amount numeric not null default 0,
  transfer_amount numeric not null default 0,
  change_given numeric not null default 0,
  created_at timestamptz not null default now(),
  foreign key (shift_id, org_id) references public.shifts (id, org_id) on delete cascade
);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  shift_id uuid not null,
  staff_id uuid not null references public.profiles(id),
  description text not null,
  amount numeric not null check (amount >= 0),
  payment_method text not null default 'cash',
  created_at timestamptz not null default now(),
  foreign key (shift_id, org_id) references public.shifts (id, org_id) on delete cascade
);

create table public.settings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  key text not null,
  value text not null,
  updated_at timestamptz not null default now(),
  unique (org_id, key)
);

create index menu_items_org_idx on public.menu_items (org_id);
create index shifts_org_closed_idx on public.shifts (org_id, closed_at desc);
create index shift_assignments_shift_idx on public.shift_assignments (shift_id);
create index shift_stock_shift_idx on public.shift_stock (shift_id);
create index shift_close_shift_idx on public.shift_close (shift_id);
create index orders_shift_idx on public.orders (shift_id);
create index orders_org_created_idx on public.orders (org_id, created_at desc);
create index expenses_shift_idx on public.expenses (shift_id);
create index memberships_user_org_idx on public.memberships (user_id, org_id);

alter table public.menu_items enable row level security;
alter table public.shifts enable row level security;
alter table public.shift_assignments enable row level security;
alter table public.shift_stock enable row level security;
alter table public.shift_close enable row level security;
alter table public.orders enable row level security;
alter table public.expenses enable row level security;
alter table public.settings enable row level security;

-- true while a shift has not been closed
create function public.shift_is_open(p_shift uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.shifts s where s.id = p_shift and s.closed_at is null);
$$;
revoke all on function public.shift_is_open(uuid) from public, anon;
grant execute on function public.shift_is_open(uuid) to authenticated, service_role;

-- menu: everyone reads, owners edit
create policy "members view menu" on public.menu_items for select to authenticated using (public.is_org_member(org_id));
create policy "owners add menu items" on public.menu_items for insert to authenticated with check (public.is_org_owner(org_id));
create policy "owners edit menu items" on public.menu_items for update to authenticated using (public.is_org_owner(org_id)) with check (public.is_org_owner(org_id));
create policy "owners delete menu items" on public.menu_items for delete to authenticated using (public.is_org_owner(org_id));

-- shifts: anyone in the business can open one and close it; closed shifts are frozen
create policy "members view shifts" on public.shifts for select to authenticated using (public.is_org_member(org_id));
create policy "members open shifts" on public.shifts for insert to authenticated
  with check (public.is_org_member(org_id) and opened_by = (select auth.uid()) and closed_at is null);
create policy "members close open shifts" on public.shifts for update to authenticated
  using (public.is_org_member(org_id) and closed_at is null)
  with check (public.is_org_member(org_id) and closed_by = (select auth.uid()) and closed_at is not null);

create policy "members view shift staff" on public.shift_assignments for select to authenticated using (public.is_org_member(org_id));
create policy "members join open shifts" on public.shift_assignments for insert to authenticated
  with check (public.is_org_member(org_id) and user_id = (select auth.uid()) and public.shift_is_open(shift_id));

create policy "members view shift stock" on public.shift_stock for select to authenticated using (public.is_org_member(org_id));
create policy "members add stock rows" on public.shift_stock for insert to authenticated
  with check (public.is_org_member(org_id) and public.shift_is_open(shift_id));
create policy "members update stock while open" on public.shift_stock for update to authenticated
  using (public.is_org_member(org_id) and public.shift_is_open(shift_id))
  with check (public.is_org_member(org_id) and public.shift_is_open(shift_id));

create policy "members view close counts" on public.shift_close for select to authenticated using (public.is_org_member(org_id));
create policy "members save close counts" on public.shift_close for insert to authenticated
  with check (public.is_org_member(org_id) and public.shift_is_open(shift_id));

create policy "members view orders" on public.orders for select to authenticated using (public.is_org_member(org_id));
create policy "members take orders" on public.orders for insert to authenticated
  with check (public.is_org_member(org_id) and staff_id = (select auth.uid()) and public.shift_is_open(shift_id));

create policy "members view expenses" on public.expenses for select to authenticated using (public.is_org_member(org_id));
create policy "members add expenses" on public.expenses for insert to authenticated
  with check (public.is_org_member(org_id) and staff_id = (select auth.uid()) and public.shift_is_open(shift_id));
create policy "members delete expenses while open" on public.expenses for delete to authenticated
  using (public.is_org_member(org_id) and public.shift_is_open(shift_id));

create policy "members view settings" on public.settings for select to authenticated using (public.is_org_member(org_id));
create policy "owners add settings" on public.settings for insert to authenticated with check (public.is_org_owner(org_id));
create policy "owners edit settings" on public.settings for update to authenticated
  using (public.is_org_owner(org_id)) with check (public.is_org_owner(org_id));

-- stock functions (run with the caller's permissions, so the rules above apply)
create function public.increment_stock(p_stock_id uuid, p_quantity integer)
returns setof public.shift_stock
language sql security invoker set search_path = ''
as $$
  update public.shift_stock
     set quantity = quantity + p_quantity, added_qty = added_qty + p_quantity
   where id = p_stock_id and p_quantity > 0
  returning *;
$$;

create function public.decrement_stock(p_stock_id uuid, p_quantity integer)
returns setof public.shift_stock
language sql security invoker set search_path = ''
as $$
  update public.shift_stock
     set quantity = quantity - p_quantity
   where id = p_stock_id and p_quantity > 0 and quantity >= p_quantity
  returning *;
$$;

revoke all on function public.increment_stock(uuid, integer), public.decrement_stock(uuid, integer) from public, anon;
grant execute on function public.increment_stock(uuid, integer), public.decrement_stock(uuid, integer) to authenticated, service_role;

-- table permissions
grant select, delete on public.menu_items to authenticated;
grant insert (org_id, name, category, price, unit, available) on public.menu_items to authenticated;
grant update (name, category, price, unit, available) on public.menu_items to authenticated;

grant select on public.shifts to authenticated;
grant insert (org_id, location_id, opened_by) on public.shifts to authenticated;
grant update (closed_at, closed_by) on public.shifts to authenticated;

grant select on public.shift_assignments to authenticated;
grant insert (org_id, shift_id, user_id) on public.shift_assignments to authenticated;

grant select on public.shift_stock to authenticated;
grant insert (org_id, shift_id, item_id, item_name, unit, opening_qty, added_qty, quantity) on public.shift_stock to authenticated;
grant update (added_qty, quantity) on public.shift_stock to authenticated;

grant select on public.shift_close to authenticated;
grant insert (org_id, shift_id, item_id, opening_qty, sold_qty, actual_remaining, variance) on public.shift_close to authenticated;

grant select on public.orders to authenticated;
grant insert (id, org_id, shift_id, staff_id, items_json, subtotal, total, payment_method, cash_amount, transfer_amount, change_given) on public.orders to authenticated;

grant select, delete on public.expenses to authenticated;
grant insert (org_id, shift_id, staff_id, description, amount, payment_method) on public.expenses to authenticated;

grant select on public.settings to authenticated;
grant insert (org_id, key, value) on public.settings to authenticated;
grant update (value, updated_at) on public.settings to authenticated;

grant all on public.menu_items, public.shifts, public.shift_assignments, public.shift_stock,
  public.shift_close, public.orders, public.expenses, public.settings to service_role;

-- live updates for the stock board
alter publication supabase_realtime add table public.shift_stock;
