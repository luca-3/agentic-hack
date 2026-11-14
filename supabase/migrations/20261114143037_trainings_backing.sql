-- Trainings that come from employees' questions (owner: Dashboard), incl. bundles of related topics.
-- Backing = aggregates only (D-12, D-28): how many questions and how many distinct people asked, never who or what
-- exactly. The dashboard shows question-based trainings only when asked_by >= 5. Additive; RLS unchanged.
alter table public.training_catalog
  add column description text,                                        -- what it teaches and the stuck point behind it
  add column source text not null default 'manual' check (source in ('manual', 'questions')),
  add column app_id uuid references public.apps (id) on delete set null,
  add column roles text[] not null default '{}',                      -- job roles that need it most ('{}' = everyone)
  add column asked_count int check (asked_count >= 0),                -- questions behind it in the period
  add column asked_by int check (asked_by >= 0),                      -- distinct pseudonymous people who asked
  add column period_days int check (period_days > 0),                 -- backing window, e.g. 30
  add column bundle_of text[] not null default '{}';                  -- bundle: titles of the parts, in teaching order

comment on column public.training_catalog.asked_by is 'distinct people behind the backing; below 5 the training stays hidden';
comment on column public.training_catalog.bundle_of is 'non-empty = bundle; part titles may match single trainings in the catalog';
