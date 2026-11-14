-- An org always keeps at least one admin (D-36). RLS "admins manage members" lets any admin
-- demote or remove anyone, so the last-admin rule has to live in the database, not only in the dashboard.
--
-- Cascades: FK "on delete cascade" runs as an RI trigger AFTER the parent row is deleted, and its
-- DELETE on org_members uses a new command id, so a query here no longer sees the deleted parent.
-- So "parent row missing" reliably means "cascade from deleting the org or the auth user" → allow.
-- (Verified locally: deleting an org or the sole admin's auth user cascades without error.)
-- Deleting the last admin's auth user therefore leaves the org admin-less; that is account deletion
-- and must not be blocked.
--
-- Concurrency: two admins demoting each other at once would each still see the other as admin.
-- A per-org transaction advisory lock serialises the checks; under READ COMMITTED each plpgsql
-- statement takes a fresh snapshot after the lock, so the second check sees the first commit.
-- ponytail: assumes READ COMMITTED (Supabase default); under REPEATABLE READ the stale snapshot
-- could still let both through — add SELECT ... FOR UPDATE on the admin rows if that ever matters.

create or replace function public.guard_last_org_admin()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if not old.is_admin
     or (tg_op = 'UPDATE' and new.is_admin and new.org_id = old.org_id) then
    return coalesce(new, old);
  end if;

  if not exists (select 1 from public.orgs o where o.id = old.org_id)
     or not exists (select 1 from auth.users u where u.id = old.user_id) then
    return coalesce(new, old);  -- cascade from deleting the org or the user
  end if;

  perform pg_advisory_xact_lock(hashtext('org_admins:' || old.org_id::text));

  if not exists (
    select 1 from public.org_members m
    where m.org_id = old.org_id and m.is_admin and m.user_id <> old.user_id
  ) then
    raise exception 'An organization needs at least one admin (last admin).' using errcode = 'P0001';
  end if;

  return coalesce(new, old);
end $$;

create trigger org_members_last_admin_guard
  before update or delete on public.org_members
  for each row execute function public.guard_last_org_admin();
