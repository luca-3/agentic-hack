-- Helpful offers per feature (D-22): share of proactive offers rated 👍 / 👎 / declined, per app and intent.
-- Aggregates only, groups with ≥ 5 distinct people (D-12); never per person, never the per-person threshold.
-- lotse_offers.app_id is text (host or dashboard apps.id) → mapped to apps via id or domains, like the runtime does.
create or replace function public.offer_helpfulness(org uuid)
returns table (app_id uuid, intent text, persons int, offers int, up int, down int, declined int)
language sql stable security definer set search_path = ''
as $$
  select a.id, o.intent,
         count(distinct o.subject_id)::int,
         count(*)::int,
         count(*) filter (where f.feedback = 'up')::int,
         count(*) filter (where f.feedback = 'down')::int,
         count(*) filter (where f.feedback = 'declined')::int
  from public.lotse_offers o
  join public.apps a
    on a.org_id = org
   and (a.id::text = lower(o.app_id)
        or lower(o.app_id) = any (a.domains)
        or 'http://' || lower(o.app_id) = any (a.domains)
        or 'https://' || lower(o.app_id) = any (a.domains))
  left join public.lotse_offer_feedback f on f.offer_id = o.offer_id
  where public.is_org_admin(org)
    and o.intent is not null and btrim(o.intent) <> ''
    and o.created_at >= now() - interval '30 days'
  group by a.id, o.intent
  having count(distinct o.subject_id) >= 5
$$;

revoke all on function public.offer_helpfulness(uuid) from public, anon;
grant execute on function public.offer_helpfulness(uuid) to authenticated;
