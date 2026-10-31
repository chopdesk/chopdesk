-- 0003: onboarding and invites

create table public.invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  token text not null unique,
  role text not null default 'staff' check (role = 'staff'),
  created_by uuid not null references public.profiles(id),
  expires_at timestamptz not null default (now() + interval '7 days'),
  used_by uuid references public.profiles(id),
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index invites_org_idx on public.invites (org_id);

alter table public.invites enable row level security;

create policy "owners view invites" on public.invites
  for select to authenticated using (public.is_org_owner(org_id));
create policy "owners delete invites" on public.invites
  for delete to authenticated using (public.is_org_owner(org_id));

grant select, delete on public.invites to authenticated;
grant all on public.invites to service_role;

-- a new owner creates their business
create function public.create_organization(p_name text, p_slug text default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_org uuid;
  v_slug text;
begin
  if v_user is null then
    raise exception 'You must be signed in';
  end if;
  if length(trim(coalesce(p_name, ''))) < 2 then
    raise exception 'Business name is too short';
  end if;

  v_slug := lower(regexp_replace(coalesce(nullif(trim(p_slug), ''), p_name), '[^a-zA-Z0-9]+', '-', 'g'));
  v_slug := trim(both '-' from left(trim(both '-' from v_slug), 30));
  if length(v_slug) < 3 then
    v_slug := 'business';
  end if;
  if exists (select 1 from public.organizations where slug = v_slug) then
    v_slug := v_slug || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
  end if;

  insert into public.organizations (name, slug) values (trim(p_name), v_slug) returning id into v_org;
  insert into public.locations (org_id, name, is_default) values (v_org, 'Main', true);
  insert into public.memberships (org_id, user_id, role) values (v_org, v_user, 'owner');
  insert into public.settings (org_id, key, value) values
    (v_org, 'stock_threshold_high', '30'),
    (v_org, 'stock_threshold_low', '10');

  return v_org;
end;
$$;

-- an owner creates a single-use invite link token
create function public.create_invite(p_org uuid)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  if not public.is_org_owner(p_org) then
    raise exception 'Only the owner can invite staff';
  end if;
  insert into public.invites (org_id, token, created_by)
  values (p_org, v_token, (select auth.uid()));
  return v_token;
end;
$$;

-- a signed-in person uses an invite token to join
create function public.accept_invite(p_token text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_inv public.invites%rowtype;
begin
  if v_user is null then
    raise exception 'You must be signed in';
  end if;

  select * into v_inv from public.invites where token = p_token for update;
  if not found or v_inv.used_at is not null or v_inv.expires_at < now() then
    raise exception 'This invite link is invalid or has expired';
  end if;

  insert into public.memberships (org_id, user_id, role)
  values (v_inv.org_id, v_user, 'staff')
  on conflict (org_id, user_id) do update
    set status = 'active', role = 'staff'
    where public.memberships.status = 'removed';

  update public.invites set used_by = v_user, used_at = now() where id = v_inv.id;
  return v_inv.org_id;
end;
$$;

-- shows only the business name for a valid invite, so the join page can greet the person
create function public.get_invite_info(p_token text)
returns text
language sql stable security definer set search_path = ''
as $$
  select o.name
  from public.invites i
  join public.organizations o on o.id = i.org_id
  where i.token = p_token and i.used_at is null and i.expires_at > now();
$$;

-- a business must always keep at least one active owner
create function public.protect_last_owner()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if old.role = 'owner' and old.status = 'active'
     and (new.role <> 'owner' or new.status <> 'active') then
    if not exists (
      select 1 from public.memberships m
      where m.org_id = old.org_id and m.role = 'owner' and m.status = 'active' and m.id <> old.id
    ) then
      raise exception 'A business must keep at least one active owner';
    end if;
  end if;
  return new;
end;
$$;

create trigger memberships_keep_an_owner
  before update on public.memberships
  for each row execute function public.protect_last_owner();

revoke all on function public.create_organization(text, text) from public, anon;
revoke all on function public.create_invite(uuid) from public, anon;
revoke all on function public.accept_invite(text) from public, anon;
revoke all on function public.get_invite_info(text) from public;
revoke all on function public.protect_last_owner() from public, anon, authenticated;

grant execute on function public.create_organization(text, text) to authenticated, service_role;
grant execute on function public.create_invite(uuid) to authenticated, service_role;
grant execute on function public.accept_invite(text) to authenticated, service_role;
grant execute on function public.get_invite_info(text) to anon, authenticated, service_role;
