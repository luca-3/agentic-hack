-- Vector store for RAG with Gemini embeddings (gemini-embedding-2, 768 dims).
create extension if not exists vector with schema extensions;

create table public.documents (
  id bigint generated always as identity primary key,
  content text not null,
  metadata jsonb not null default '{}'::jsonb,
  embedding extensions.vector(768) not null,
  created_at timestamptz not null default now()
);

create index documents_embedding_idx
  on public.documents using hnsw (embedding extensions.vector_cosine_ops);

alter table public.documents enable row level security;

create policy "documents are readable by everyone"
  on public.documents for select
  to anon, authenticated
  using (true);
-- Writes go through the server (secret key), see src/lib/ai/embeddings.ts.

-- Cosine-similarity search. Call via supabase.rpc('match_documents', {...}).
create or replace function public.match_documents(
  query_embedding extensions.vector(768),
  match_count int default 5,
  min_similarity float default 0.5
)
returns table (id bigint, content text, metadata jsonb, similarity float)
language sql stable
set search_path = ''
as $$
  select
    d.id,
    d.content,
    d.metadata,
    1 - (d.embedding operator(extensions.<=>) query_embedding) as similarity
  from public.documents d
  where 1 - (d.embedding operator(extensions.<=>) query_embedding) >= min_similarity
  order by d.embedding operator(extensions.<=>) query_embedding
  limit match_count;
$$;
