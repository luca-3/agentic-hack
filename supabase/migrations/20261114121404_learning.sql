-- Suggestions from exploration and continuous learning (D-25). Server writes (secret key), dashboard admins review.
create table public.lotse_suggestions (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.orgs (id) on delete cascade,
  app_id uuid references public.apps (id) on delete cascade,
  source text not null check (source in ('explore', 'learn')),
  kind text not null check (kind in ('feature', 'design', 'stale_feature', 'agent_error', 'knowledge_gap')),
  title text not null,
  detail text not null default '',
  payload jsonb not null default '{}'::jsonb,
  fingerprint text not null,                   -- dedupe key per org, e.g. 'feature:/kunde.html:Zahlungsdaten'
  occurrences int not null default 1,
  persons int not null default 0,              -- distinct pseudonymous subjects behind it (learn); 0 for explore
  status text not null default 'open' check (status in ('open', 'accepted', 'dismissed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, fingerprint)
);
create index lotse_suggestions_org_idx on public.lotse_suggestions (org_id, status);

alter table public.lotse_suggestions enable row level security;

-- Admins only. Knowledge gaps come from employees' questions → visible only for groups of at least 5 persons.
create policy "admins read suggestions" on public.lotse_suggestions for select to authenticated
  using (public.is_org_admin(org_id) and (kind <> 'knowledge_gap' or persons >= 5));
create policy "admins update suggestion status" on public.lotse_suggestions for update to authenticated
  using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id));

-- Insights are recomputed by the server's learn run: allow replacing them per org/app (server uses the secret key).
create unique index insights_unique_idx on public.insights (org_id, app_id, feature, coalesce(role, ''), metric, period);
