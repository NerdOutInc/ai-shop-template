import { productionFingerprintVersion } from "@/lib/printify/production-fingerprint-version"

// Correlated to the publication row so one statement sees the source, selection and upgrade evidence.
export const galleryDisplaySql = `
  (select active_manifest from commerce.product_galleries g
    where g.shop_id=printify_products.shop_id and g.product_id=printify_products.product_id) as gallery_active,
  (select coalesce(jsonb_object_agg(r.revision::text,r.snapshot),'{}'::jsonb)
    from commerce.printify_product_revisions r
    where r.shop_id=printify_products.shop_id and r.product_id=printify_products.product_id
      and r.revision::text in (
        select c->'reviewedBinding'->>'sourceRevision'
        from commerce.product_galleries g,
        lateral jsonb_array_elements(case when jsonb_typeof(g.active_manifest->'colors')='array' then g.active_manifest->'colors' else '[]'::jsonb end) c
        where g.shop_id=printify_products.shop_id and g.product_id=printify_products.product_id
          and c->'reviewedBinding'->>'version' <> 'gallery-v1/${productionFingerprintVersion}'
      )) as gallery_history`
