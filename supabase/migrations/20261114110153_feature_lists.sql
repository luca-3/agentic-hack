-- Align app_features with the feature-list format used by demo-crm/lotse-features.json and
-- FeatureSchema in @lotse/shared: clickPath and requiredRole are lists.
alter table public.app_features
  alter column click_path type text[] using string_to_array(click_path, ' → ');

alter table public.app_features rename column required_role to required_roles;
alter table public.app_features
  alter column required_roles type text[] using case when required_roles is null then null else array[required_roles] end;

comment on column public.app_features.click_path is 'UI labels in click order, e.g. {Kunden,<Kundenname>,Zahlungsdaten}';
comment on column public.app_features.required_roles is 'roles that may use the feature; null = everyone';
