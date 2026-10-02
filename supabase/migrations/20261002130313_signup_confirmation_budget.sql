-- A bounded rolling-hour budget without addresses, IPs or foreign keys. Erasing a subscriber
-- cannot replenish the send budget. Application queue transactions lock this single row.
create table commerce.drop_signup_confirmation_budget (
  singleton boolean primary key default true check (singleton),
  queued_at timestamptz[] not null default '{}',
  blocked_at timestamptz
);
insert into commerce.drop_signup_confirmation_budget default values;
alter table commerce.drop_signup_confirmation_budget enable row level security;
revoke all on commerce.drop_signup_confirmation_budget from public, anon, authenticated;
grant select, update on commerce.drop_signup_confirmation_budget to store_app_runtime;
create policy store_runtime_select on commerce.drop_signup_confirmation_budget
  for select to store_app_runtime using (true);
create policy store_runtime_update on commerce.drop_signup_confirmation_budget
  for update to store_app_runtime using (true) with check (true);
-- Rollback: disable confirmation sending, drain workers and deploy the prior application before
-- dropping this table. The prior confirmation schema and historical consent remain untouched.
