-- Dashboard tables (owner: Dashboard). Server owns sessions/events/hints.
-- Orgs with members and roles, apps with their feature lists, training catalog, aggregated insights.

create table public.orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table public.org_members (
  org_id uuid not null references public.orgs (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null,                          -- job role used to filter features, e.g. 'Büro', 'Monteur'
  is_admin boolean not null default false,     -- may manage the org in the dashboard
  primary key (org_id, user_id)
);

create table public.apps (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  name text not null,
  domains text[] not null default '{}',        -- e.g. {'localhost:3000'}; the extension only runs there
  created_at timestamptz not null default now()
);

create table public.app_features (
  id bigint generated always as identity primary key,
  app_id uuid not null references public.apps (id) on delete cascade,
  name text not null,                          -- "Schlüssel finden"
  route text not null,                         -- "/keys"
  click_path text not null,                    -- "Seitenleiste → Schlüssel → Suchfeld oben"
  description text,
  required_role text                           -- null = everyone
);
create index app_features_app_idx on public.app_features (app_id);

create table public.training_catalog (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.orgs (id) on delete cascade,
  title text not null,
  topics text[] not null default '{}',         -- feature names this training covers
  url text
);

-- Aggregates only, never per person. Rows with fewer than 5 persons stay invisible (policy below).
create table public.insights (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.orgs (id) on delete cascade,
  app_id uuid not null references public.apps (id) on delete cascade,
  feature text not null,
  role text,                                   -- null = all roles
  metric text not null check (metric in (
    'stuck_rate',                -- share of sessions on this feature that hit a stuck rule
    'still_stuck_after_hint',    -- share of hinted persons stuck again at the same spot → app problem
    'abandoned_flow',            -- share of started flows not finished
    'question_count'             -- how often people asked about this feature
  )),
  value numeric not null,                      -- rates 0..1, counts as numbers
  persons int not null check (persons >= 0),   -- distinct pseudonyms behind the value
  period date not null default current_date,
  created_at timestamptz not null default now()
);
create index insights_org_idx on public.insights (org_id, app_id);

-- Membership helpers. security definer so policies on org_members don't recurse.
create or replace function public.is_org_member(org uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.org_members m where m.org_id = org and m.user_id = auth.uid()) $$;

create or replace function public.is_org_admin(org uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.org_members m where m.org_id = org and m.user_id = auth.uid() and m.is_admin) $$;

alter table public.orgs enable row level security;
alter table public.org_members enable row level security;
alter table public.apps enable row level security;
alter table public.app_features enable row level security;
alter table public.training_catalog enable row level security;
alter table public.insights enable row level security;

-- orgs
create policy "members read their org" on public.orgs for select to authenticated using (public.is_org_member(id));
create policy "admins update their org" on public.orgs for update to authenticated using (public.is_org_admin(id)) with check (public.is_org_admin(id));

-- org_members: members see who is in the org, admins manage
create policy "members read members" on public.org_members for select to authenticated using (public.is_org_member(org_id));
create policy "admins manage members" on public.org_members for all to authenticated using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id));

-- apps
create policy "members read apps" on public.apps for select to authenticated using (public.is_org_member(org_id));
create policy "admins manage apps" on public.apps for all to authenticated using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id));

-- app_features (via app → org)
create policy "members read features" on public.app_features for select to authenticated
  using (exists (select 1 from public.apps a where a.id = app_id and public.is_org_member(a.org_id)));
create policy "admins manage features" on public.app_features for all to authenticated
  using (exists (select 1 from public.apps a where a.id = app_id and public.is_org_admin(a.org_id)))
  with check (exists (select 1 from public.apps a where a.id = app_id and public.is_org_admin(a.org_id)));

-- training_catalog
create policy "members read trainings" on public.training_catalog for select to authenticated using (public.is_org_member(org_id));
create policy "admins manage trainings" on public.training_catalog for all to authenticated using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id));

-- insights: admins only, and only groups of at least 5 persons. Writes come from the server (secret key).
create policy "admins read aggregated insights" on public.insights for select to authenticated
  using (public.is_org_admin(org_id) and persons >= 5);
