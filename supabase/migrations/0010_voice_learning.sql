-- 0010: voice learning
-- 1) voice_utterances: a log of what staff said (text only, never audio) and what the app understood.
--    This lets us replay old sentences against any new change and see if accuracy went up or down.
-- 2) voice_learning: how often a phrase was confirmed or corrected for a menu item.
--    It is shared-ready: every row also stores item_key (the menu name with only letters),
--    so later, learning from many businesses can be combined by item name. Nothing is shared yet.
-- Both tables are written only through the functions below, so the business always comes
-- from the login and the menu item, and can never be faked from the app.

create table public.voice_utterances (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  source text not null check (source in ('test', 'orders', 'shift', 'close')),
  heard text not null check (char_length(heard) between 1 and 300),
  alternatives text[] not null default '{}',
  understood jsonb not null default '[]'::jsonb,
  final jsonb,
  created_at timestamptz not null default now()
);

create index voice_utterances_org_idx on public.voice_utterances (org_id, created_at desc);

alter table public.voice_utterances enable row level security;

create policy "owners view voice utterances" on public.voice_utterances
  for select to authenticated using (public.is_org_owner(org_id));

create table public.voice_learning (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  item_id uuid not null references public.menu_items(id) on delete cascade,
  phrase text not null check (phrase ~ '^[a-z]+( [a-z]+)*$' and char_length(phrase) between 2 and 60),
  item_key text not null,
  confirmed integer not null default 0 check (confirmed >= 0),
  corrected integer not null default 0 check (corrected >= 0),
  last_seen timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (org_id, item_id, phrase)
);

create index voice_learning_org_idx on public.voice_learning (org_id);
create index voice_learning_key_idx on public.voice_learning (item_key);

alter table public.voice_learning enable row level security;

create policy "members view voice learning" on public.voice_learning
  for select to authenticated using (public.is_org_member(org_id));

create policy "owners delete voice learning" on public.voice_learning
  for delete to authenticated using (public.is_org_owner(org_id));

-- Save one spoken sentence. Returns its id (or null if there was nothing to save).
create function public.log_voice_utterance(
  p_org uuid,
  p_source text,
  p_heard text,
  p_alternatives text[],
  p_understood jsonb
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_heard text := left(btrim(coalesce(p_heard, '')), 300);
  v_alts text[];
  v_id uuid;
begin
  if (select auth.uid()) is null or not public.is_org_member(p_org) then
    raise exception 'Not allowed';
  end if;
  if p_source not in ('test', 'orders', 'shift', 'close') then
    raise exception 'Unknown voice source';
  end if;
  if v_heard = '' then
    return null;
  end if;

  select coalesce(array_agg(left(btrim(a), 300)), '{}')
    into v_alts
    from (select a from unnest(coalesce(p_alternatives, '{}')) with ordinality as t(a, n)
          where btrim(a) <> '' order by n limit 5) s;

  insert into public.voice_utterances (org_id, user_id, source, heard, alternatives, understood)
  values (p_org, (select auth.uid()), p_source, v_heard, v_alts,
          case when jsonb_typeof(p_understood) = 'array' then p_understood else '[]'::jsonb end)
  returning id into v_id;

  return v_id;
end;
$$;

-- Record what staff finally ended up with for a sentence (used to learn from corrections).
create function public.finish_voice_utterance(p_id uuid, p_final jsonb)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update public.voice_utterances
     set final = case when jsonb_typeof(p_final) = 'array' then p_final else '[]'::jsonb end
   where id = p_id and user_id = (select auth.uid());
end;
$$;

-- Add one piece of evidence: this phrase was 'confirmed' (left alone) or 'corrected' (staff changed it to this item).
create function public.record_voice_feedback(p_item_id uuid, p_phrase text, p_kind text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_org uuid;
  v_name text;
  v_phrase text := lower(btrim(regexp_replace(coalesce(p_phrase, ''), '\s+', ' ', 'g')));
begin
  if p_kind not in ('confirmed', 'corrected') then
    raise exception 'Unknown feedback kind';
  end if;

  select org_id, name into v_org, v_name from public.menu_items where id = p_item_id;
  if v_org is null or not public.is_org_member(v_org) then
    raise exception 'Menu item not found';
  end if;

  if v_phrase !~ '^[a-z]+( [a-z]+)*$' or char_length(v_phrase) not between 2 and 60 then
    return; -- not something we can learn from (numbers or odd characters); skip quietly
  end if;

  if (select count(*) from public.voice_learning where org_id = v_org) >= 2000
     and not exists (select 1 from public.voice_learning where org_id = v_org and item_id = p_item_id and phrase = v_phrase) then
    return;
  end if;

  insert into public.voice_learning (org_id, item_id, phrase, item_key, confirmed, corrected)
  values (v_org, p_item_id, v_phrase,
          lower(regexp_replace(v_name, '[^a-zA-Z]+', '', 'g')),
          case when p_kind = 'confirmed' then 1 else 0 end,
          case when p_kind = 'corrected' then 1 else 0 end)
  on conflict (org_id, item_id, phrase) do update
    set confirmed = public.voice_learning.confirmed + excluded.confirmed,
        corrected = public.voice_learning.corrected + excluded.corrected,
        last_seen = now();
end;
$$;

revoke all on function public.log_voice_utterance(uuid, text, text, text[], jsonb) from public, anon;
revoke all on function public.finish_voice_utterance(uuid, jsonb) from public, anon;
revoke all on function public.record_voice_feedback(uuid, text, text) from public, anon;
grant execute on function public.log_voice_utterance(uuid, text, text, text[], jsonb) to authenticated, service_role;
grant execute on function public.finish_voice_utterance(uuid, jsonb) to authenticated, service_role;
grant execute on function public.record_voice_feedback(uuid, text, text) to authenticated, service_role;

grant select on public.voice_utterances to authenticated;
grant select, delete on public.voice_learning to authenticated;
grant all on public.voice_utterances, public.voice_learning to service_role;
