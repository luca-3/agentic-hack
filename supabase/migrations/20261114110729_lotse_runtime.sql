-- Lotse runtime tables (owner: Server). Written only by apps/server via the secret key (admin client).
-- Plain-text org/app ids on purpose: no FKs to dashboard-owned tables, so ingest never fails on unknown apps.

-- One row per LLM call (ask / decide): cost + latency tracking, usage limits, abuse analysis.
create table public.agent_usage (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  route text not null,                 -- 'ask' | 'decide'
  tier text,                           -- 'point' | 'guide' | 'reason' (ask only)
  model text not null,
  input_tokens int,
  output_tokens int,
  total_tokens int,
  latency_ms int not null,
  status text not null,                -- 'ok' | 'timeout' | 'error' | ...
  session_id text,                     -- pseudonymous x-lotse-session
  user_id uuid,                        -- Supabase auth user, null in dev/anonymous mode
  org_id text,
  app_id text,
  error text
);
create index agent_usage_created_idx on public.agent_usage (created_at desc);
create index agent_usage_session_idx on public.agent_usage (session_id, created_at desc);

-- Privacy-filtered semantic events from the extension (no input values).
create table public.lotse_events (
  id bigint generated always as identity primary key,
  received_at timestamptz not null default now(),
  ts timestamptz not null,             -- client time of the event
  type text not null,                  -- click | route | search | error | idle | focus | rage_click
  route text not null,
  element_role text,
  element_label text,
  detail text,
  session_id text,
  user_id uuid,
  org_id text,
  app_id text
);
create index lotse_events_app_ts_idx on public.lotse_events (app_id, ts desc);
create index lotse_events_session_idx on public.lotse_events (session_id, ts desc);

-- Service role only: RLS on, no policies for anon/authenticated.
alter table public.agent_usage enable row level security;
alter table public.lotse_events enable row level security;
