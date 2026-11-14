-- Display address of a member (auth.users is not readable for the dashboard).
alter table public.org_members add column email text;
