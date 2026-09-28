-- One permanent payment identity per store database. Brand copy remains editable.
create table commerce.store_identity (
  singleton boolean primary key default true check (singleton),
  identity text not null check (length(identity) between 1 and 80 and identity ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

alter table commerce.store_identity enable row level security;
revoke all on commerce.store_identity from public, anon, authenticated, service_role;
grant select, insert on commerce.store_identity to store_app_runtime;
create policy store_runtime_select on commerce.store_identity
  for select to store_app_runtime using (true);
create policy store_runtime_insert on commerce.store_identity
  for insert to store_app_runtime with check (true);
