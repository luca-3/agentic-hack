-- Agent memory + knowledge gaps (D-28, owner: Server). Written only by apps/server via the secret key.
-- Agent memory = what Lotse learned from many people's usage over weeks/months. It is kept apart from the curated
-- knowledge base (public.documents, written by org admins) and always reaches the model labeled as <agent_memory>.
-- Privacy (D-12): topics/contents are neutral (no personal data, never the original question); a memory only becomes
-- active with evidence from >= 5 distinct pseudonymous persons and no negative feedback, or when an admin approves it.

create table public.agent_memory (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.orgs (id) on delete cascade,
  app_id uuid references public.apps (id) on delete cascade,          -- null = applies to every app of the org
  kind text not null check (kind in ('pitfall', 'path_hint', 'faq', 'role_hint', 'gap_resolution')),
  topic text not null check (char_length(topic) between 1 and 120),  -- neutral label, e.g. 'IBAN ändern'
  topic_key text generated always as (lower(btrim(topic))) stored,
  feature text not null default '',                                   -- app_features.name it refers to ('' = none)
  content text not null check (char_length(content) between 1 and 400),
  source text not null check (source in ('agent', 'learn_loop', 'admin')),
  evidence_count int not null default 0,                              -- observations (repeats of one person included)
  persons int not null default 0,                                     -- distinct pseudonymous subjects with support
  negatives int not null default 0,                                   -- distinct subjects with negative feedback (👎)
  confidence real not null default 0 check (confidence between 0 and 1),
  status text not null default 'proposed' check (status in ('proposed', 'active', 'rejected', 'expired')),
  embedding extensions.vector(768),                                   -- set on activation, for semantic retrieval
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),                    -- last supporting evidence (drives expiry)
  activated_at timestamptz,
  reviewed_by uuid references auth.users (id) on delete set null,
  constraint agent_memory_key unique nulls not distinct (org_id, app_id, kind, topic_key, feature)
);
create index agent_memory_read_idx on public.agent_memory (org_id, status, app_id);

-- One row per (memory, person, polarity): makes "distinct persons" exact and repeat evidence idempotent.
-- subject_hash = sha256 of the runtime subject key ("u:<user id>" / "s:<session id>"), never the raw id.
create table public.agent_memory_evidence (
  memory_id bigint not null references public.agent_memory (id) on delete cascade,
  subject_hash text not null,
  polarity text not null check (polarity in ('support', 'negative')),
  created_at timestamptz not null default now(),
  primary key (memory_id, subject_hash, polarity)
);

-- Questions Lotse could not answer, as a neutral topic only (never the question text).
create table public.knowledge_gaps (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.orgs (id) on delete cascade,
  app_id uuid references public.apps (id) on delete cascade,
  topic text not null check (char_length(topic) between 1 and 120),
  topic_key text generated always as (lower(btrim(topic))) stored,
  count int not null default 0,
  persons int not null default 0,
  status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  memory_id bigint references public.agent_memory (id) on delete set null, -- gap_resolution memory once answered
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  constraint knowledge_gaps_key unique nulls not distinct (org_id, app_id, topic_key)
);
create index knowledge_gaps_org_idx on public.knowledge_gaps (org_id, status, persons desc);

create table public.knowledge_gap_subjects (
  gap_id bigint not null references public.knowledge_gaps (id) on delete cascade,
  subject_hash text not null,
  primary key (gap_id, subject_hash)
);

-- Service role only: RLS on, no policies for anon/authenticated. The dashboard reads via GET /api/lotse/memory.
alter table public.agent_memory enable row level security;
alter table public.agent_memory_evidence enable row level security;
alter table public.knowledge_gaps enable row level security;
alter table public.knowledge_gap_subjects enable row level security;

-- Records evidence for a memory and applies the promotion rules in one statement batch (no read-modify-write races).
-- proposed → active: persons >= min_persons and no negatives (never for rejected).
-- active → proposed: >= 2 negatives (admin-written memories stay active until an admin changes them).
create or replace function public.record_agent_memory_evidence(
  memory bigint,
  subjects text[],
  polarity text default 'support',
  min_persons int default 5
)
returns public.agent_memory
language plpgsql
set search_path = ''
as $$
#variable_conflict use_variable
declare
  m public.agent_memory;
begin
  insert into public.agent_memory_evidence (memory_id, subject_hash, polarity)
  select memory, s, polarity from unnest(subjects) as s where s is not null and s <> ''
  on conflict do nothing;

  update public.agent_memory a
  set evidence_count = a.evidence_count + (case when polarity = 'support' then coalesce(cardinality(subjects), 0) else 0 end),
      persons = (select count(*) from public.agent_memory_evidence e where e.memory_id = a.id and e.polarity = 'support'),
      negatives = (select count(*) from public.agent_memory_evidence e where e.memory_id = a.id and e.polarity = 'negative'),
      last_seen_at = case when polarity = 'support' then now() else a.last_seen_at end,
      updated_at = now()
  where a.id = memory
  returning * into m;
  if m.id is null then
    return null;
  end if;

  update public.agent_memory a
  set status = case
        when a.status = 'proposed' and a.persons >= min_persons and a.negatives = 0 then 'active'
        when a.status = 'active' and a.source <> 'admin' and a.negatives >= 2 then 'proposed'
        else a.status
      end,
      activated_at = case
        when a.status = 'proposed' and a.persons >= min_persons and a.negatives = 0 then now()
        else a.activated_at
      end,
      confidence = case
        when a.source = 'admin' then 1
        else round((a.persons::numeric / (a.persons + 2 + 3 * a.negatives)), 2)
      end
  where a.id = memory
  returning * into m;
  return m;
end;
$$;

-- Insert-or-touch a memory by (org, app, kind, topic, feature), then record supporting evidence.
-- Status: admin → active; an expired memory with fresh evidence → proposed again; rejected stays rejected.
create or replace function public.propose_agent_memory(
  org uuid,
  app uuid,
  kind text,
  topic text,
  content text,
  feature text default '',
  source text default 'agent',
  subjects text[] default '{}',
  min_persons int default 5
)
returns public.agent_memory
language plpgsql
set search_path = ''
as $$
#variable_conflict use_variable
declare
  m public.agent_memory;
begin
  insert into public.agent_memory as a (org_id, app_id, kind, topic, content, feature, source, status, activated_at, confidence)
  values (
    org, app, kind, btrim(topic), btrim(content), coalesce(feature, ''), source,
    case when source = 'admin' then 'active' else 'proposed' end,
    case when source = 'admin' then now() end,
    case when source = 'admin' then 1 else 0 end
  )
  on conflict on constraint agent_memory_key do update
  set content = case when excluded.source = 'admin' or a.status in ('proposed', 'expired') then excluded.content else a.content end,
      source = case when excluded.source = 'admin' then 'admin' else a.source end,
      status = case
        when excluded.source = 'admin' then 'active'
        when a.status = 'expired' then 'proposed'
        else a.status
      end,
      activated_at = case when excluded.source = 'admin' and a.status <> 'active' then now() else a.activated_at end,
      confidence = case when excluded.source = 'admin' then 1 else a.confidence end,
      last_seen_at = now(),
      updated_at = now()
  returning * into m;

  if coalesce(cardinality(subjects), 0) > 0 then
    m := public.record_agent_memory_evidence(m.id, subjects, 'support', min_persons);
  end if;
  return m;
end;
$$;

-- Insert-or-increment a knowledge gap and count distinct persons.
create or replace function public.record_knowledge_gap(org uuid, app uuid, topic text, subject text)
returns public.knowledge_gaps
language plpgsql
set search_path = ''
as $$
#variable_conflict use_variable
declare
  g public.knowledge_gaps;
begin
  insert into public.knowledge_gaps as k (org_id, app_id, topic, count)
  values (org, app, btrim(topic), 1)
  on conflict on constraint knowledge_gaps_key do update
  set count = k.count + 1, last_seen = now()
  returning * into g;

  if subject is not null and subject <> '' then
    insert into public.knowledge_gap_subjects (gap_id, subject_hash) values (g.id, subject) on conflict do nothing;
  end if;
  update public.knowledge_gaps k
  set persons = (select count(*) from public.knowledge_gap_subjects s where s.gap_id = k.id)
  where k.id = g.id
  returning * into g;
  return g;
end;
$$;

-- Semantic retrieval over ACTIVE memories of one org (app = null → org-wide + every app; app = id → that app + org-wide).
create or replace function public.match_agent_memory(
  query_embedding extensions.vector(768),
  org uuid,
  app uuid default null,
  match_count int default 3,
  min_similarity float default 0.55
)
returns table (id bigint, kind text, topic text, feature text, content text, persons int, similarity float)
language sql stable
set search_path = ''
as $$
  select m.id, m.kind, m.topic, m.feature, m.content, m.persons,
         1 - (m.embedding operator(extensions.<=>) query_embedding) as similarity
  from public.agent_memory m
  where m.org_id = org
    and m.status = 'active'
    and m.embedding is not null
    and (app is null or m.app_id is null or m.app_id = app)
    and 1 - (m.embedding operator(extensions.<=>) query_embedding) >= min_similarity
  order by m.embedding operator(extensions.<=>) query_embedding
  limit match_count;
$$;

-- Server-only functions: PostgREST exposes public functions to anon/authenticated by default.
revoke execute on function public.record_agent_memory_evidence(bigint, text[], text, int) from public, anon, authenticated;
revoke execute on function public.propose_agent_memory(uuid, uuid, text, text, text, text, text, text[], int) from public, anon, authenticated;
revoke execute on function public.record_knowledge_gap(uuid, uuid, text, text) from public, anon, authenticated;
revoke execute on function public.match_agent_memory(extensions.vector, uuid, uuid, int, float) from public, anon, authenticated;
grant execute on function public.record_agent_memory_evidence(bigint, text[], text, int) to service_role;
grant execute on function public.propose_agent_memory(uuid, uuid, text, text, text, text, text, text[], int) to service_role;
grant execute on function public.record_knowledge_gap(uuid, uuid, text, text) to service_role;
grant execute on function public.match_agent_memory(extensions.vector, uuid, uuid, int, float) to service_role;
