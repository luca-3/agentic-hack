-- Used by copy-local-data.sh (runs in the LOCAL Supabase DB). Prints one INSERT per table, one per line:
--   insert into <table> (<cols>) overriding system value select <cols> from json_populate_recordset(null::<table>, '<rows as jsonb, one line>') on conflict do nothing;
-- then setval lines for identity columns. Generated columns are left out; embeddings travel as text.
--
-- Copied: demo logins (*@demo.test), org + members, apps, and the non-CORPUS app features, knowledge (incl.
-- embeddings), insights and notes.
-- NOT copied (user: no CORPUS feature info outside the local DB): anything of app CORPUS (…a1 / dev.fuller.de /
-- localhost:3100), trainings about CORPUS features, and all runtime logs and learned data (events, usage,
-- suggestions, memory, gaps, offers, prefs) — those are local test traffic on CORPUS.
\set corpus 00000000-0000-0000-0000-0000000000a1

with t(ord, tbl, filter) as (values
  (1, 'auth.users', $$email like '%@demo.test'$$),
  (2, 'auth.identities', $$user_id in (select id from auth.users where email like '%@demo.test')$$),
  (3, 'public.orgs', 'true'),
  (4, 'public.org_members', $$user_id in (select id from auth.users where email like '%@demo.test')$$),
  (5, 'public.apps', 'true'),
  (6, 'public.app_features', format('app_id <> %L', :'corpus')),
  (7, 'public.knowledge_sources', format($$coalesce(app_id::text, '') <> %L and title not ilike '%%corpus%%'$$, :'corpus')),
  (8, 'public.documents', format($$coalesce(app_id::text, '') <> %L
       and source_id in (select id from public.knowledge_sources where title not ilike '%%corpus%%')$$, :'corpus')),
  (9, 'public.training_catalog', format($$coalesce(app_id::text, '') <> %L and title not ilike '%%corpus%%'
       and not topics && coalesce((select array_agg(name) from public.app_features where app_id = %L), '{}')$$, :'corpus', :'corpus')),
  (10, 'public.insights', format('app_id <> %L', :'corpus')),
  (11, 'public.notes', 'true')
)
select format(
  'select format(%L, jsonb_agg(r)) from (select * from %s where %s) r having count(*) > 0',
  format('insert into %s (%s) overriding system value select %s from json_populate_recordset(null::%s, %%L) on conflict do nothing;',
         tbl, cols, cols, tbl),
  tbl, filter)
from t
cross join lateral (
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) as cols
  from information_schema.columns
  where table_schema || '.' || table_name = t.tbl and is_generated = 'NEVER'
) c
order by ord
\gexec

-- Identity sequences: continue after the copied ids.
select format('select setval(pg_get_serial_sequence(%L, %L), coalesce((select max(%I) from %s), 0) + 1, false);',
              table_schema || '.' || table_name, column_name, column_name, table_schema || '.' || table_name)
from information_schema.columns
where table_schema = 'public' and is_identity = 'YES'
  and table_name in ('app_features', 'documents', 'training_catalog', 'insights', 'notes')
order by table_name;
