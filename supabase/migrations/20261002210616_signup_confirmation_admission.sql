-- Drain both email workers with sending disabled before this migration, then deploy the new writer.
-- Preserve the existing rolling budget and runtime grants; unknown historical identities stay null.
alter table commerce.drop_signup_confirmation_budget rename column queued_at to accepted_at;
alter table commerce.drop_signup_confirmation_budget
  add column subject_hashes text[] not null default '{}';

update commerce.drop_signup_confirmation_budget
set accepted_at = array(
  select stamp from unnest(accepted_at) stamp where stamp > now() - interval '1 hour'
);
update commerce.drop_signup_confirmation_budget
set subject_hashes = array_fill(null::text, array[cardinality(accepted_at)]);

-- A store with confirmation receipts but no budget row must not receive a fresh hour of capacity.
insert into commerce.drop_signup_confirmation_budget(singleton, accepted_at, subject_hashes)
select true, coalesce(array_agg(created_at order by created_at), '{}'::timestamptz[]),
  coalesce(array_agg(null::text order by created_at), '{}'::text[])
from commerce.drop_signup_confirmations where created_at > now() - interval '1 hour'
having count(*) > 0
on conflict (singleton) do nothing;

alter table commerce.drop_signup_confirmation_budget
  add constraint signup_admission_capacity check (cardinality(accepted_at) <= 1000),
  add constraint signup_admission_pairs check (cardinality(accepted_at) = cardinality(subject_hashes));
