-- Short-lived admission state: keys are keyed hashes, never raw addresses or request IDs.
create table commerce.checkout_capacity (
  bucket text primary key check (length(bucket) between 1 and 80),
  available_at timestamptz not null,
  expires_at timestamptz not null
);
create index checkout_capacity_expiry on commerce.checkout_capacity (expires_at);
alter table commerce.checkout_capacity enable row level security;
revoke all on commerce.checkout_capacity from public, anon, authenticated, service_role;
grant select, insert, update, delete on commerce.checkout_capacity to store_app_runtime;
create policy checkout_capacity_runtime on commerce.checkout_capacity
  for all to store_app_runtime using (true) with check (true);
