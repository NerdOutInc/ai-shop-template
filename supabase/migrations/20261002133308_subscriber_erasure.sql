-- The trusted server verifies a current admin; browser roles still have no table access.
-- Cascades remove owned outbox rows without granting direct DELETE on the child tables.
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'store_app_runtime') then
    grant delete on commerce.drop_subscribers to store_app_runtime;
    create policy store_runtime_delete on commerce.drop_subscribers for delete to store_app_runtime using (true);
  end if;
end $$;

comment on table commerce.drop_subscribers is
  'Private drop-email consent and suppression records. Pending inbox confirmation, confirmed consent, or historical legacy consent. Admin erasure and expiry cleanup delete owned subscriber records; orders and shared drop templates are separate.';
comment on column commerce.drop_subscribers.unsubscribed_at is
  'Set on unsubscribe and retained on repeat stops. Fresh inbox confirmation may lift it, preserving last_unsubscribed_at. Admin erasure can delete the subscriber and its owned records.';
comment on column commerce.drop_subscribers.consent_copy_version is
  'Version of the wording retained in src/features/drop-signup/drop-consent-wording.ts; historical wording is preserved.';

-- Preconditions: inbox-confirmation and least-privilege runtime migrations must be applied first.
-- Compatibility: additive permission only; old applications retain existing behavior.
-- Rollback: revoke DELETE and drop store_runtime_delete before rolling back code.
-- Deleted personal records cannot be restored by rolling back this permission; use a reviewed backup policy.
