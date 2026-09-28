import "server-only"

import { revalidatePath, revalidateTag } from "next/cache"

/**
 * Both revalidations, never just the tag.
 *
 * Scheduling a drop moves rows into the cached revealable set, and the sitemap and both merchant
 * feeds render outside that tag.
 */
export function refreshStorefront() {
  revalidateTag("printify-published-catalog", { expire: 0 })
  revalidatePath("/", "layout")
}
