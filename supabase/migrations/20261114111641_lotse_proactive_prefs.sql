-- Adaptive proactivity (D-22, owner: Server). Per pseudonymous subject (user id "u:<uuid>" or session "s:<id>").
-- Written only by apps/server via the secret key.

create table public.lotse_user_prefs (
  subject_id text primary key,
  proactive_threshold real not null default 0.8,
  updated_at timestamptz not null default now()
);

create table public.lotse_offers (
  offer_id text primary key,
  subject_id text not null,
  app_id text,
  intent text,
  confidence real not null,
  threshold real not null,
  created_at timestamptz not null default now()
);
create index lotse_offers_subject_idx on public.lotse_offers (subject_id, created_at desc);

create table public.lotse_offer_feedback (
  offer_id text primary key references public.lotse_offers (offer_id) on delete cascade,
  subject_id text not null,
  feedback text not null check (feedback in ('up', 'down', 'declined')),
  threshold_before real not null,
  threshold_after real not null,
  created_at timestamptz not null default now()
);

-- Service role only: RLS on, no policies for anon/authenticated.
alter table public.lotse_user_prefs enable row level security;
alter table public.lotse_offers enable row level security;
alter table public.lotse_offer_feedback enable row level security;
