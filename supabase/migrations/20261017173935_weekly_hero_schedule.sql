-- Additive upgrade after the template migration chain through 20261002221459.
-- Requires commerce + store_app_runtime. Apply once via migration history, before app rollout.
-- Prior app revisions ignore these tables; no product rows are rewritten. Retry only after
-- checking failed transaction/history state. Verification/rollback: docs/weekly-hero-admin.md.
-- Hero originals stay in private Blob storage. Only the active week's approved images
-- are served publicly by the application; scheduling never changes a Blob's access.
create table commerce.weekly_hero_assets (
  id uuid primary key,
  shop_id text not null,
  kind text not null check (kind in ('desktop','mobile')),
  pathname text not null unique,
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  content_type text not null check (content_type in ('image/png','image/jpeg','image/webp')),
  bytes integer not null check (bytes between 1 and 3145728),
  width integer not null check (width > 0),
  height integer not null check (height > 0),
  created_by uuid not null,
  created_at timestamptz not null default now()
);

create table commerce.weekly_heroes (
  shop_id text not null,
  live_at timestamptz not null check (isfinite(live_at)),
  version uuid not null,
  scheduled boolean not null default false,
  manifest jsonb not null check (jsonb_typeof(manifest) = 'object'),
  updated_by uuid not null,
  updated_at timestamptz not null default now(),
  primary key (shop_id, live_at)
);

alter table commerce.weekly_hero_assets enable row level security;
alter table commerce.weekly_heroes enable row level security;
revoke all on commerce.weekly_hero_assets, commerce.weekly_heroes from public;
do $$
declare browser_role text; relation text; verb text;
begin
  foreach browser_role in array array['anon','authenticated'] loop
    if exists(select 1 from pg_roles where rolname=browser_role) then
      execute format('revoke all on commerce.weekly_hero_assets, commerce.weekly_heroes from %I',browser_role);
    end if;
  end loop;
  if exists(select 1 from pg_roles where rolname='store_app_runtime') then
    grant select,insert on commerce.weekly_hero_assets to store_app_runtime;
    grant select,insert,update on commerce.weekly_heroes to store_app_runtime;
    foreach relation in array array['weekly_hero_assets','weekly_heroes'] loop
      foreach verb in array array['select','insert','update'] loop
        if relation='weekly_hero_assets' and verb='update' then continue; end if;
        execute format('create policy %I on commerce.%I for %s to store_app_runtime %s',
          'store_runtime_' || verb,relation,verb,
          case verb when 'insert' then 'with check (true)'
            when 'update' then 'using (true) with check (true)' else 'using (true)' end);
      end loop;
    end loop;
  end if;
end $$;
