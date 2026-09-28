import "server-only"

import { revalidatePath, revalidateTag } from "next/cache"

import { readPrivateAsset } from "@/features/design-library/read-private-asset.server"
import { resolvePublishedProductArtwork } from "@/features/design-products/resolve-published-product-artwork.server"
import { markDesignProductRemoved } from "@/features/design-products/mark-design-product-removed.server"
import { markDesignProductUnverified } from "@/features/design-products/mark-design-product-unverified.server"
import { markDesignProductPublished } from "@/features/design-products/mark-design-product-published.server"
import { env } from "@/lib/env"

import { getPublishingStore } from "./get-publishing-store.server"
import { hostPublishedArtwork } from "./host-published-artwork.server"
import { hostPublishedImages } from "./host-published-images.server"
import { PrintifyPublishingClient } from "./printify-publishing-client.server"
import { processPublishingJobs } from "./process-publishing-jobs.server"

export function getPublishingServices() {
  const blobHost = env.NEXT_PUBLIC_PRODUCT_IMAGE_BLOB_HOST
  if (
    !env.PRINTIFY_PUBLISHING_ENABLED ||
    !env.PRINTIFY_PUBLISHING_API_TOKEN ||
    !env.PRINTIFY_SHOP_ID ||
    !env.NEXT_PUBLIC_SITE_URL ||
    !blobHost
  )
    throw new Error("Publishing is not configured")
  const url = new URL(env.NEXT_PUBLIC_SITE_URL)
  if (
    url.username ||
    url.password ||
    (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)))
  )
    throw new Error("A canonical storefront URL is required")
  const store = getPublishingStore()
  const client = new PrintifyPublishingClient(env.PRINTIFY_PUBLISHING_API_TOKEN, env.PRINTIFY_SHOP_ID)
  return {
    store,
    processPending: (limit?: number) =>
      processPublishingJobs(
        {
          store,
          client,
          siteUrl: url.origin,
          hostImages: (input) => hostPublishedImages({ ...input, blobHost }),
          ...(env.ADMIN_LIBRARY_ENABLED
            ? {
                hostArtwork: (
                  input: Pick<
                    Parameters<typeof hostPublishedArtwork>[0],
                    "snapshot" | "source" | "expected" | "revisionKey" | "uploads" | "deadline"
                  >
                ) =>
                  hostPublishedArtwork({
                    ...input,
                    blobHost,
                    readApproved: (expected) =>
                      resolvePublishedProductArtwork({ ...expected, source: input.source, deadline: input.deadline }),
                    readAsset: readPrivateAsset,
                  }),
                markArtworkPublished: markDesignProductPublished,
                markArtworkRemoved: markDesignProductRemoved,
                markArtworkUnverified: markDesignProductUnverified,
              }
            : {}),
          invalidate: () => {
            revalidateTag("printify-published-catalog", { expire: 0 })
            revalidatePath("/", "layout")
          },
        },
        limit
      ),
  }
}
