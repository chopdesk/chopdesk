-- 0007: close_shift
--
-- Closes a shift in one transaction, and refuses unless every item that was
-- involved in the shift (opening_qty > 0 or added_qty > 0) has a counted number.
-- The variance is worked out here, not in the browser.
--
-- Safe to run before the new close page is live: the old page does not call it.
-- Direct closing is locked in a later migration (0008), after the new page ships.
--
-- p_counts looks like: [{ "item_id": "...", "counted": 12 }, ...]

create function public.close_shift(p_shift_id uuid, p_counts jsonb)
returns public.shifts
language plpgsql security definer set search_path = ''
as $$
declare
  v_user    uuid := (select auth.uid());
  v_shift   public.shifts;
  v_missing text[];
begin
  if v_user is null then
    raise exception 'You must be signed in';
  end if;

  -- lock the shift row so two people cannot close it at the same moment
  select * into v_shift from public.shifts where id = p_shift_id for update;
  if not found or not public.is_org_member(v_shift.org_id) then
    raise exception 'Shift not found';
  end if;
  if v_shift.closed_at is not null then
    raise exception 'This shift was already closed';
  end if;

  if jsonb_typeof(p_counts) is distinct from 'array' then
    raise exception 'The stock count is missing';
  end if;

  -- every entry needs an item and a whole number of 0 or more
  if exists (
    select 1 from jsonb_array_elements(p_counts) e
    where coalesce(e->>'item_id', '') = ''
       or coalesce(e->>'counted', '') !~ '^[0-9]+$'
  ) then
    raise exception 'Every count must be a whole number, 0 or more';
  end if;

  if (select count(*) from jsonb_array_elements(p_counts))
     <> (select count(distinct e->>'item_id') from jsonb_array_elements(p_counts) e) then
    raise exception 'An item was counted twice';
  end if;

  -- freeze the stock rows while we compare, so a sale cannot slip in between
  perform 1 from public.shift_stock where shift_id = p_shift_id order by item_id for update;

  -- every involved item must have a count (0 is a count, blank is not)
  select array_agg(ss.item_name order by ss.item_name) into v_missing
  from public.shift_stock ss
  where ss.shift_id = p_shift_id
    and (ss.opening_qty > 0 or ss.added_qty > 0)
    and not exists (
      select 1 from jsonb_array_elements(p_counts) e
      where (e->>'item_id')::uuid = ss.item_id
    );

  if v_missing is not null then
    raise exception 'Count every item before closing. Missing: %', array_to_string(v_missing, ', ');
  end if;

  -- clear anything left behind by an earlier half-finished close, then record the counts
  delete from public.shift_close where shift_id = p_shift_id;

  insert into public.shift_close (org_id, shift_id, item_id, opening_qty, sold_qty, actual_remaining, variance)
  select ss.org_id,
         ss.shift_id,
         ss.item_id,
         ss.opening_qty,
         ss.opening_qty + ss.added_qty - ss.quantity,
         c.counted,
         c.counted - ss.quantity
  from public.shift_stock ss
  join (
    select (e->>'item_id')::uuid as item_id, (e->>'counted')::integer as counted
    from jsonb_array_elements(p_counts) e
  ) c on c.item_id = ss.item_id
  where ss.shift_id = p_shift_id
    and (ss.opening_qty > 0 or ss.added_qty > 0);

  update public.shifts
     set closed_at = now(), closed_by = v_user
   where id = p_shift_id
  returning * into v_shift;

  return v_shift;
end;
$$;

revoke all on function public.close_shift(uuid, jsonb) from public, anon;
grant execute on function public.close_shift(uuid, jsonb) to authenticated, service_role;
