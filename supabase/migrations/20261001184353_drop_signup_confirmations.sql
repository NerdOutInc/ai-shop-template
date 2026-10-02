-- Forward port: requires the existing subscriber and frozen drop-outbox migrations.
-- Existing rows keep legacy eligibility and stop evidence; fresh installs contain no subscribers.
-- Transactional/additive; run once via recorded migration history with both workers drained.
-- Old v1/v2 signup writes fail closed. Rollback keeps sends disabled and retains this schema.
-- Verify state counts, RLS grants, and pending/confirmed worker cutoffs before activation.
-- Historical consent retains its eligibility, never a fabricated confirmation timestamp.
alter table commerce.drop_subscribers add column subscription_state text;
update commerce.drop_subscribers set subscription_state = 'legacy';
alter table commerce.drop_subscribers alter column subscription_state set default 'pending';
alter table commerce.drop_subscribers alter column subscription_state set not null;
alter table commerce.drop_subscribers add constraint drop_subscriber_state_check
  check (subscription_state in ('legacy', 'pending', 'confirmed') and
         (subscription_state <> 'confirmed' or confirmed_at is not null));

-- One definition for signup duplicates, admin counts, snapshots and per-send claims. The optional
-- cutoff preserves historical legacy consent and starts confirmed eligibility at inbox proof.
create function commerce.is_drop_subscriber_eligible(subscriber commerce.drop_subscribers, cutoff timestamptz default null)
returns boolean language sql stable set search_path = '' as $$
  select coalesce(subscriber.unsubscribed_at is null
    and subscriber.subscription_state in ('legacy', 'confirmed')
    and (cutoff is null or case when subscriber.subscription_state = 'confirmed' then subscriber.confirmed_at
                               when subscriber.last_unsubscribed_at is null then subscriber.created_at
                               else subscriber.consented_at end < cutoff), false)
$$;
revoke all on function commerce.is_drop_subscriber_eligible(commerce.drop_subscribers, timestamptz) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'store_app_runtime') then
    grant execute on function commerce.is_drop_subscriber_eligible(commerce.drop_subscribers, timestamptz) to store_app_runtime;
  end if;
end $$;

-- Old deployed workers lack the new predicate. Skip their ineligible inserts AND claim updates,
-- returning no address from UPDATE ... RETURNING. Receipt writes after I/O must still be recorded.
create function commerce.guard_drop_delivery_eligibility() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status in ('queued', 'unconfirmed') and not exists (
    select 1 from commerce.drop_subscribers subscriber
     where subscriber.id = new.subscriber_id
       and commerce.is_drop_subscriber_eligible(subscriber, new.drop_live_at)
  ) then
    return null;
  end if;
  return new;
end $$;
revoke all on function commerce.guard_drop_delivery_eligibility() from public;
create trigger guard_drop_delivery_eligibility
  before insert or update of status, attempt_started_at, subscriber_id, drop_live_at on commerce.drop_email_deliveries
  for each row execute function commerce.guard_drop_delivery_eligibility();

create table commerce.drop_signup_confirmations (
  id uuid primary key default gen_random_uuid(),
  subscriber_id uuid not null references commerce.drop_subscribers(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  source text not null,
  consent_copy_version text not null,
  signup_ip inet,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours',
  used_at timestamptz,
  revoked_at timestamptz,
  status text not null default 'queued' check (status in ('queued', 'unconfirmed', 'sent', 'rejected', 'expired')),
  -- Only the private outbox holds the fragment token, and only until sending ends.
  message jsonb,
  attempt_started_at timestamptz,
  last_attempt_at timestamptz,
  next_attempt_at timestamptz not null default now(),
  attempts integer not null default 0,
  last_provider_outcome text check (last_provider_outcome in ('sent', 'rejected', 'not-sent', 'unconfirmed')),
  provider_email_id text,
  accepted_at timestamptz,
  check (expires_at > created_at)
);
create index drop_signup_confirmations_subscriber_created_idx
  on commerce.drop_signup_confirmations(subscriber_id, created_at desc);
create index drop_signup_confirmations_queue_idx
  on commerce.drop_signup_confirmations(next_attempt_at) where status in ('queued', 'unconfirmed');
alter table commerce.drop_signup_confirmations enable row level security;
revoke all on commerce.drop_signup_confirmations from public;
do $$
declare role_name text; verb text;
begin
  foreach role_name in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = role_name) then
      execute format('revoke all on commerce.drop_signup_confirmations from %I', role_name);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'store_app_runtime') then
    grant select, insert, update on commerce.drop_signup_confirmations to store_app_runtime;
    foreach verb in array array['select', 'insert', 'update'] loop
      execute format('create policy %I on commerce.drop_signup_confirmations for %s to store_app_runtime %s',
        'store_runtime_' || verb, verb,
        case verb when 'insert' then 'with check (true)' when 'update' then 'using (true) with check (true)' else 'using (true)' end);
    end loop;
  end if;
end $$;

-- Refuse direct unsubscribe reversals unless the confirmation transaction just consumed a request.
-- Old INSERT/upsert writers fail above; old unsubscribe UPDATEs still revoke links.
create function commerce.guard_drop_subscriber_confirmation() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.consent_copy_version in ('v1', 'v2') and new.subscription_state <> 'legacy' then
      raise exception 'Signup application upgrade required';
    end if;
    return new;
  end if;
  if old.unsubscribed_at is not null and new.unsubscribed_at is null and not (
    new.confirmed_at is distinct from old.confirmed_at and exists (
      select 1 from commerce.drop_signup_confirmations c
       where c.subscriber_id = old.id and c.used_at = new.confirmed_at and c.revoked_at is null
    )
  ) then
    raise exception 'Fresh subscriber confirmation required';
  end if;
  if new.unsubscribed_at is not null then
    update commerce.drop_signup_confirmations set revoked_at = now(), message = null
     where subscriber_id = old.id and used_at is null and revoked_at is null;
  end if;
  -- A rolling-back old form must not replace evidence from a confirmed request with v1 wording.
  if new.consent_copy_version in ('v1', 'v2') and old.consent_copy_version not in ('v1', 'v2') then
    new.source := old.source;
    new.consent_copy_version := old.consent_copy_version;
    new.consented_at := old.consented_at;
    new.signup_ip := old.signup_ip;
  end if;
  return new;
end $$;
revoke all on function commerce.guard_drop_subscriber_confirmation() from public;
create trigger guard_drop_subscriber_confirmation before insert or update on commerce.drop_subscribers
  for each row execute function commerce.guard_drop_subscriber_confirmation();
