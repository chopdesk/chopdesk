-- 0001: tenancy core

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  status text not null default 'active' check (status in ('active', 'suspended')),
  plan text not null default 'trial',
  brand_color text,
  logo_url text,
  created_at timestamptz not null default now()
);

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  first_name text not null default '',
  surname text not null default '',
  phone text,
  created_at timestamptz not null default now()
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'staff' check (role in ('owner', 'staff')),
  status text not null default 'active' check (status in ('active', 'removed')),
  created_at timestamptz not null default now(),
  unique (org_id, user_id)
);

create index locations_org_id_idx on public.locations (org_id);
create index memberships_user_id_idx on public.memberships (user_id);
create unique index locations_one_default_per_org on public.locations (org_id) where is_default;

alter table public.organizations enable row level security;
alter table public.locations enable row level security;
alter table public.profiles enable row level security;
alter table public.memberships enable row level security;

-- helper functions used by the access rules
create function public.is_org_member(p_org uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = p_org and m.user_id = (select auth.uid()) and m.status = 'active'
  );
$$;

create function public.is_org_owner(p_org uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = p_org and m.user_id = (select auth.uid())
      and m.status = 'active' and m.role = 'owner'
  );
$$;

create function public.shares_org_with(p_user uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.memberships mine
    join public.memberships theirs on theirs.org_id = mine.org_id
    where mine.user_id = (select auth.uid()) and mine.status = 'active'
      and theirs.user_id = p_user and theirs.status = 'active'
  );
$$;

revoke all on function public.is_org_member(uuid), public.is_org_owner(uuid), public.shares_org_with(uuid) from public, anon;
grant execute on function public.is_org_member(uuid), public.is_org_owner(uuid), public.shares_org_with(uuid) to authenticated, service_role;

-- access rules
create policy "members view their organizations" on public.organizations
  for select to authenticated using (public.is_org_member(id));
create policy "owners edit their organization" on public.organizations
  for update to authenticated using (public.is_org_owner(id)) with check (public.is_org_owner(id));

create policy "members view locations" on public.locations
  for select to authenticated using (public.is_org_member(org_id));
create policy "owners add locations" on public.locations
  for insert to authenticated with check (public.is_org_owner(org_id));
create policy "owners edit locations" on public.locations
  for update to authenticated using (public.is_org_owner(org_id)) with check (public.is_org_owner(org_id));
create policy "owners delete locations" on public.locations
  for delete to authenticated using (public.is_org_owner(org_id));

create policy "view own and teammate profiles" on public.profiles
  for select to authenticated using (id = (select auth.uid()) or public.shares_org_with(id));
create policy "edit own profile" on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "members view memberships" on public.memberships
  for select to authenticated using (public.is_org_member(org_id));
create policy "owners edit memberships" on public.memberships
  for update to authenticated using (public.is_org_owner(org_id)) with check (public.is_org_owner(org_id));

-- create a profile automatically whenever someone signs up
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, first_name, surname)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'first_name', ''),
    coalesce(new.raw_user_meta_data->>'surname', '')
  );
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- table permissions (column-level, so owners cannot touch plan or status)
grant select on public.organizations to authenticated;
grant update (name, brand_color, logo_url) on public.organizations to authenticated;

grant select, delete on public.locations to authenticated;
grant insert (org_id, name) on public.locations to authenticated;
grant update (name) on public.locations to authenticated;

grant select on public.profiles to authenticated;
grant update (first_name, surname, phone) on public.profiles to authenticated;

grant select on public.memberships to authenticated;
grant update (role, status) on public.memberships to authenticated;

grant all on public.organizations, public.locations, public.profiles, public.memberships to service_role;
