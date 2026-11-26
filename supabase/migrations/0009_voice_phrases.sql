-- 0009: voice phrases
-- Each business teaches the voice assistant how its own menu sounds when spoken
-- (accents, local food names, how the phone's speech recognition mishears them).
-- Phrases belong to one business only and never affect another.

create table public.voice_phrases (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  item_id uuid not null references public.menu_items(id) on delete cascade,
  phrase text not null check (phrase ~ '^[a-z]+( [a-z]+)*$' and char_length(phrase) between 2 and 60),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (org_id, phrase)
);

create index voice_phrases_org_idx on public.voice_phrases (org_id);
create index voice_phrases_item_idx on public.voice_phrases (item_id);

alter table public.voice_phrases enable row level security;

create policy "members view voice phrases" on public.voice_phrases
  for select to authenticated using (public.is_org_member(org_id));

create policy "owners delete voice phrases" on public.voice_phrases
  for delete to authenticated using (public.is_org_owner(org_id));

-- Staff and owners teach phrases through this function only, so the business is always
-- taken from the menu item itself and can never be faked from the app.
create function public.teach_voice_phrase(p_item_id uuid, p_phrase text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_org uuid;
  v_phrase text := lower(btrim(regexp_replace(coalesce(p_phrase, ''), '\s+', ' ', 'g')));
  v_id uuid;
begin
  select org_id into v_org from public.menu_items where id = p_item_id;
  if v_org is null or not public.is_org_member(v_org) then
    raise exception 'Menu item not found';
  end if;

  if v_phrase !~ '^[a-z]+( [a-z]+)*$' or char_length(v_phrase) not between 2 and 60 then
    raise exception 'A voice phrase must be 2 to 60 letters, with no numbers';
  end if;

  if (select count(*) from public.voice_phrases where org_id = v_org) >= 500
     and not exists (select 1 from public.voice_phrases where org_id = v_org and phrase = v_phrase) then
    raise exception 'This business has reached the limit of 500 voice phrases';
  end if;

  insert into public.voice_phrases (org_id, item_id, phrase, created_by)
  values (v_org, p_item_id, v_phrase, (select auth.uid()))
  on conflict (org_id, phrase) do update
    set item_id = excluded.item_id, created_by = excluded.created_by
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.teach_voice_phrase(uuid, text) from public, anon;
grant execute on function public.teach_voice_phrase(uuid, text) to authenticated, service_role;

-- read and delete only; adding and changing go through teach_voice_phrase
grant select, delete on public.voice_phrases to authenticated;
