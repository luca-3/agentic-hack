-- How many OTHER orgs a member of my org belongs to (D-37). The server's admin data delete
-- (DELETE /api/lotse/me?userId=) wipes a person's Valo data across all orgs, so the dashboard only
-- offers it when the person is in no other org. RLS hides other orgs' memberships, hence security definer.
-- Returns null unless the caller is admin of `org` and `member` is in `org` — leaks nothing beyond a count.
create or replace function public.member_other_org_count(org uuid, member uuid)
returns integer language sql stable security definer set search_path = ''
as $$
  select case
    when public.is_org_admin(org)
     and exists (select 1 from public.org_members m where m.org_id = org and m.user_id = member)
    then (select count(*)::integer from public.org_members m where m.user_id = member and m.org_id <> org)
  end
$$;

revoke execute on function public.member_other_org_count(uuid, uuid) from public, anon;
grant execute on function public.member_other_org_count(uuid, uuid) to authenticated;
