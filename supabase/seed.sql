-- Runs after migrations on `supabase start` (first run) and `supabase db reset`.
insert into public.notes (title, user_id) values
  ('Hello from local Supabase 👋', null),
  ('Edit supabase/seed.sql to change this data', null);
