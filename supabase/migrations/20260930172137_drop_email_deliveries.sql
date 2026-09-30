-- The drop list's outbox: one email per weekly drop, and one delivery row for each subscriber it was
-- addressed to. The worker is src/features/drop-emails/process-drop-emails.server.ts.
--
-- Additive only: an app without drop emails never reads these tables, so this can be applied before
-- the matching deploy. Creating the foreign key briefly locks commerce.drop_subscribers against writes.
--
-- FROZEN ONCE PER DROP. The first run on a drop's day renders the email and keeps it here, sender
-- included. Every send and every retry reads this row, so a retry hands Resend the same body under the
-- same Idempotency-Key: a price edit or a deploy between two attempts cannot turn a retry into a second,
-- different email. Only the subscriber's own unsubscribe link is filled in at send time.
--
-- Keyed by the drop's live_at alone, with no shop_id, like commerce.drop_subscribers in
-- 20260928000354_storefront_baseline.sql: one store owns this database. There is no foreign key to
-- commerce.product_week_schedule either, because a week is many rows there, one per product.
create table commerce.drop_emails (
  live_at timestamptz primary key check (isfinite(live_at)),
  from_address text not null check (from_address <> '' and length(from_address) <= 320),
  reply_to text not null check (reply_to <> '' and length(reply_to) <= 254),
  subject text not null check (subject <> '' and length(subject) <= 200),
  html text not null check (html <> ''),
  text_body text not null check (text_body <> ''),
  -- What the email announced, for the admin history. The words themselves are in html and text_body.
  product_ids text[] not null check (cardinality(product_ids) between 1 and 100),
  frozen_at timestamptz not null default now()
);

-- One row per subscriber per drop, written in the same statement that freezes the email, so the
-- recipient list is decided once: whoever had signed up before the drop went live and had not
-- unsubscribed by the time it was frozen.
--
-- status:
--   queued        listed, never attempted.
--   unconfirmed   handed to Resend without a confirmed answer, or about to be: it is written BEFORE the
--                 request so a crash mid-send leaves a trace. Retried with the same key until 23 hours
--                 after attempt_started_at, inside Resend's 24-hour deduplication, then expired. The
--                 same rule as commerce.order_shipping_alerts.
--   sent          Resend accepted it. That is not proof it reached an inbox; provider_email_id is
--                 what to look up in Resend when someone says it never arrived.
--   rejected      Resend refused this message, for example an address it will not deliver to.
--   expired       its chance passed: the week ended first, or an unconfirmed attempt aged out.
--   unsubscribed  they left before it went out.
create table commerce.drop_email_deliveries (
  drop_live_at timestamptz not null references commerce.drop_emails(live_at),
  -- Cascade, because an erasure request is honored by deleting the subscriber row by hand, and
  -- erasing someone includes the record of which emails we sent them.
  subscriber_id uuid not null references commerce.drop_subscribers(id) on delete cascade,
  status text not null default 'queued'
    check (status in ('queued', 'unconfirmed', 'sent', 'rejected', 'expired', 'unsubscribed')),
  attempt_started_at timestamptz,
  sent_at timestamptz,
  provider_email_id text check (provider_email_id <> '' and length(provider_email_id) <= 128),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (drop_live_at, subscriber_id),
  constraint drop_email_delivery_shape check (
    (status = 'sent') = (sent_at is not null and provider_email_id is not null)
    and (status <> 'queued' or attempt_started_at is null)
    and (status <> 'unconfirmed' or attempt_started_at is not null)
  )
);
-- The cascade above looks rows up by subscriber, which the primary key cannot serve.
create index drop_email_deliveries_subscriber_idx on commerce.drop_email_deliveries(subscriber_id);

comment on table commerce.drop_emails is
  'One email per weekly drop, rendered and frozen on the drop''s day. Retries resend this exact row, so a retry can never become a different email.';
comment on table commerce.drop_email_deliveries is
  'Which subscribers a drop email was addressed to, and what happened to each send. Holds no address: the subscriber row does.';

-- store_app_runtime is nobypassrls, so every granted verb needs its own policy or reads return zero
-- rows with no error. drop_emails is insert-once, so it gets no update; nothing in the application
-- deletes from either table.
alter table commerce.drop_emails enable row level security;
alter table commerce.drop_email_deliveries enable row level security;
revoke all on commerce.drop_emails, commerce.drop_email_deliveries from public, anon, authenticated, service_role;
grant select, insert on commerce.drop_emails to store_app_runtime;
grant select, insert, update on commerce.drop_email_deliveries to store_app_runtime;
create policy store_runtime_select on commerce.drop_emails for select to store_app_runtime using (true);
create policy store_runtime_insert on commerce.drop_emails for insert to store_app_runtime with check (true);
create policy store_runtime_select on commerce.drop_email_deliveries for select to store_app_runtime using (true);
create policy store_runtime_insert on commerce.drop_email_deliveries
  for insert to store_app_runtime with check (true);
create policy store_runtime_update on commerce.drop_email_deliveries
  for update to store_app_runtime using (true) with check (true);
