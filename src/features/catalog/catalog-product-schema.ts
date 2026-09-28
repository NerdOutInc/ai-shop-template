import { z } from "zod"

import { readPublicArtworkLocation } from "@/lib/read-public-artwork-location"

import { readProductImageViewKey } from "./read-product-image-view-key"

export const catalogProductSchema = z.object({
  id: z.string().min(1),
  shop_id: z.number().int().positive(),
  // Missing or malformed provider identity must never be interpreted as a known garment.
  blueprint_id: z.number().int().positive().max(2_147_483_647).nullable().optional().catch(null),
  title: z.string().trim().min(1),
  description: z.string().optional().default(""),
  // Set by readStorefrontProduct only. A raw Printify snapshot never has it, and Printify's own
  // created_at is deliberately not read: Newest means newest in the shop, not newest at Printify.
  storefront_added_to_shop_at: z.string().nullable().optional().catch(null),
  storefront_artwork_enabled: z.boolean().optional().default(false),
  // Invalid attached artwork hides only the preview. Private production sources never enter the catalog.
  storefront_artwork: z
    .object({
      src: z.string().refine((value) => readPublicArtworkLocation(value) !== null),
      revisionId: z.uuid(),
      productionFingerprint: z.string().regex(/^artwork-v1:[a-f0-9]{64}$/),
      width: z.number().int().positive().max(1200),
      height: z.number().int().positive().max(1200),
    })
    .nullable()
    .optional()
    .catch(null),
  variants: z.array(
    z.object({
      id: z.number().int(),
      price: z.number().int().nonnegative(),
      title: z.string().optional(),
      is_enabled: z.boolean().optional().default(false),
      is_available: z.boolean().optional().default(false),
      options: z.array(z.number().int()),
    })
  ),
  options: z.array(
    z.object({
      name: z.string().trim().min(1),
      type: z.string().optional(),
      values: z.array(
        z.object({ id: z.number().int(), title: z.string().trim().min(1), colors: z.array(z.string()).optional() })
      ),
    })
  ),
  images: z.array(
    z
      .object({
        src: z.string(),
        variant_ids: z.array(z.number().int()),
        is_default: z.boolean().optional().default(false),
        source_src: z.unknown().optional(),
        view_key: z.unknown().optional(),
      })
      .transform(({ source_src, view_key, ...image }) => {
        // Hosted mockups retain their camera identity without exposing private recovery URLs.
        const viewKey = readProductImageViewKey({ ...image, source_src, view_key })
        return { ...image, ...(viewKey ? { view_key: viewKey } : {}) }
      })
  ),
})
