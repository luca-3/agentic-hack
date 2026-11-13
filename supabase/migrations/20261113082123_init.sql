-- Example table to verify the setup end-to-end. Replace or extend for the hackathon.
create table public.notes (
  id bigint generated always as identity primary key,
  title text not null,
  user_id uuid references auth.users (id) on delete cascade default auth.uid(),
  created_at timestamptz not null default now()
);

alter table public.notes enable row level security;

-- Anyone (incl. anon) can read; only signed-in users can write their own rows.
create policy "notes are readable by everyone"
  on public.notes for select
  to anon, authenticated
  using (true);

create policy "users can insert their own notes"
  on public.notes for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "users can update their own notes"
  on public.notes for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "users can delete their own notes"
  on public.notes for delete
  to authenticated
  using ((select auth.uid()) = user_id);
