-- Additive upgrade after the template migration chain through 20261017173935.
-- Requires commerce + store_app_runtime. Apply once via migration history, before app rollout.
-- Prior app revisions ignore these tables; no product rows are rewritten and nothing is backfilled.
-- Retry only after checking failed transaction/history state. Verification/rollback:
-- docs/product-gallery-workflow.md.
-- Provider publication snapshots stay canonical; only approved display selections live here.
-- Without a gallery row a product keeps showing its provider images.
create table commerce.product_gallery_assets (
  id uuid primary key,
  shop_id text not null,
  product_id text not null,
  pathname text not null unique,
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  content_type text not null check (content_type = 'image/jpeg'),
  bytes integer not null check (bytes between 1 and 3145728),
  width integer not null check (width between 1 and 2000),
  height integer not null check (height between 1 and 2000),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  unique (shop_id, product_id, id),
  foreign key (shop_id, product_id) references commerce.printify_products (shop_id, product_id)
);

create table commerce.product_galleries (
  shop_id text not null,
  product_id text not null,
  revision uuid not null,
  draft_manifest jsonb not null check (jsonb_typeof(draft_manifest) = 'object'),
  active_manifest jsonb check (active_manifest is null or jsonb_typeof(active_manifest) = 'object'),
  updated_by uuid not null,
  updated_at timestamptz not null default now(),
  primary key (shop_id, product_id),
  foreign key (shop_id, product_id) references commerce.printify_products (shop_id, product_id)
);

create table commerce.product_gallery_revisions (
  shop_id text not null,
  product_id text not null,
  revision uuid not null,
  action text not null check (action in ('save','activate','restore')),
  manifest jsonb not null check (jsonb_typeof(manifest) = 'object'),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  primary key (shop_id, product_id, revision),
  foreign key (shop_id, product_id) references commerce.printify_products (shop_id, product_id)
);

-- One public-copy receipt per asset and host lets an interrupted activation resume.
create table commerce.product_gallery_promotions (
  shop_id text not null,
  product_id text not null,
  asset_id uuid not null,
  host text not null,
  url text not null,
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  primary key (shop_id, product_id, asset_id, host),
  foreign key (shop_id, product_id, asset_id) references commerce.product_gallery_assets (shop_id, product_id, id)
);

alter table commerce.product_gallery_assets enable row level security;
alter table commerce.product_galleries enable row level security;
alter table commerce.product_gallery_revisions enable row level security;
alter table commerce.product_gallery_promotions enable row level security;
revoke all on commerce.product_gallery_assets, commerce.product_galleries, commerce.product_gallery_revisions,
  commerce.product_gallery_promotions from public;
do $$
declare browser_role text; relation text; verb text; predicate text;
begin
  foreach browser_role in array array['anon','authenticated'] loop
    if exists(select 1 from pg_roles where rolname=browser_role) then
      execute format('revoke all on commerce.product_gallery_assets, commerce.product_galleries, '
        'commerce.product_gallery_revisions, commerce.product_gallery_promotions from %I',browser_role);
    end if;
  end loop;
  if exists(select 1 from pg_roles where rolname='store_app_runtime') then
    -- Append-only history: only the per-product gallery row moves its revision forward.
    grant select,insert on commerce.product_gallery_assets, commerce.product_gallery_revisions,
      commerce.product_gallery_promotions to store_app_runtime;
    grant select,insert,update on commerce.product_galleries to store_app_runtime;
    foreach relation in array array['product_gallery_assets','product_galleries','product_gallery_revisions',
      'product_gallery_promotions'] loop
      predicate := format('exists (select 1 from commerce.printify_products p '
        'where p.shop_id=%I.shop_id and p.product_id=%I.product_id)',relation,relation);
      foreach verb in array array['select','insert','update'] loop
        if relation<>'product_galleries' and verb='update' then continue; end if;
        execute format('create policy %I on commerce.%I for %s to store_app_runtime %s',
          'store_runtime_' || verb,relation,verb,
          case verb when 'insert' then 'with check (' || predicate || ')'
            when 'update' then 'using (' || predicate || ') with check (' || predicate || ')'
            else 'using (' || predicate || ')' end);
      end loop;
    end loop;
  end if;
end $$;
