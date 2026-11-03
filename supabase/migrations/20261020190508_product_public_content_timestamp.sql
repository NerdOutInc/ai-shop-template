-- Public content dates must not follow operational/private edits such as merchant copy or scheduling.
-- Existing rows deliberately stay unknown: updated_at cannot reconstruct their last public change.
-- Readers may still use the most recent shop arrival as a known publication date.
alter table commerce.printify_products add column content_updated_at timestamptz;

comment on column commerce.printify_products.content_updated_at is
  'Last publication, public image/artwork replacement or gallery activation. Private merchant-copy, draft and schedule writes do not advance it. Null means unknown before this migration.';

-- Existing table grants and RLS cover this column. No new role, grant or policy is needed.
