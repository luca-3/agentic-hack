-- Knowledge base per org (owner: Dashboard writes sources, Server embeds + searches).
-- Fixes public.documents being readable by everyone (anon included) and unscoped across orgs.

create table public.knowledge_sources (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  app_id uuid references public.apps (id) on delete cascade,   -- null = applies to all apps of the org
  title text not null,
  kind text not null default 'text' check (kind in ('text', 'markdown')),
  chars int not null default 0,
  chunks int not null default 0,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index knowledge_sources_org_idx on public.knowledge_sources (org_id);

alter table public.knowledge_sources enable row level security;
create policy "members read knowledge sources" on public.knowledge_sources for select to authenticated using (public.is_org_member(org_id));
create policy "admins manage knowledge sources" on public.knowledge_sources for all to authenticated
  using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id));

-- documents: scope every chunk to an org (and optionally app + source). Existing rows have no org → removed.
delete from public.documents;
alter table public.documents
  add column org_id uuid not null references public.orgs (id) on delete cascade,
  add column app_id uuid references public.apps (id) on delete cascade,
  add column source_id uuid references public.knowledge_sources (id) on delete cascade;
create index documents_org_idx on public.documents (org_id, app_id);

drop policy "documents are readable by everyone" on public.documents;
create policy "members read their org's documents" on public.documents for select to authenticated using (public.is_org_member(org_id));
-- Writes only via the server (secret key) after it checked the caller is an org admin.

-- Search scoped to one org; app = null searches org-wide knowledge plus every app's knowledge,
-- app = <id> searches that app's knowledge plus org-wide knowledge.
drop function public.match_documents(extensions.vector, int, float);
create or replace function public.match_documents(
  query_embedding extensions.vector(768),
  org uuid,
  app uuid default null,
  match_count int default 5,
  min_similarity float default 0.5
)
returns table (id bigint, content text, metadata jsonb, source_id uuid, similarity float)
language sql stable
set search_path = ''
as $$
  select
    d.id,
    d.content,
    d.metadata,
    d.source_id,
    1 - (d.embedding operator(extensions.<=>) query_embedding) as similarity
  from public.documents d
  where d.org_id = org
    and (app is null or d.app_id is null or d.app_id = app)
    and 1 - (d.embedding operator(extensions.<=>) query_embedding) >= min_similarity
  order by d.embedding operator(extensions.<=>) query_embedding
  limit match_count;
$$;
