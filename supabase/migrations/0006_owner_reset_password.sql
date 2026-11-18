-- 0006: owner resets a staff member's password
--
-- There is no email sender yet, so a staff member who forgets their password
-- asks the owner. Only the owner of the business can do this, only for staff
-- (never another owner, never themselves), and only for people who belong to
-- no other business. All of the person's sessions are ended.

create function public.owner_reset_staff_password(
  p_org          uuid,
  p_user         uuid,
  p_new_password text
)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'You must be signed in';
  end if;

  if not public.is_org_owner(p_org) then
    raise exception 'Only the owner can reset a password';
  end if;

  if p_user = (select auth.uid()) then
    raise exception 'You cannot reset your own password here';
  end if;

  if p_new_password is null or length(p_new_password) < 8 then
    raise exception 'The new password must be at least 8 characters';
  end if;

  if not exists (
    select 1 from public.memberships m
    where m.org_id = p_org and m.user_id = p_user
      and m.role = 'staff' and m.status = 'active'
  ) then
    raise exception 'That person is not a staff member of this business';
  end if;

  if exists (
    select 1 from public.memberships m
    where m.user_id = p_user and m.org_id <> p_org and m.status = 'active'
  ) then
    raise exception 'This person also belongs to another business, so their password cannot be reset from here';
  end if;

  update auth.users
     set encrypted_password = extensions.crypt(p_new_password, extensions.gen_salt('bf')),
         updated_at = now()
   where id = p_user;

  delete from auth.sessions where user_id = p_user;
end;
$$;

revoke all on function public.owner_reset_staff_password(uuid, uuid, text) from public, anon;
grant execute on function public.owner_reset_staff_password(uuid, uuid, text) to authenticated, service_role;
