import type { NextConfig } from "next"

type RemotePattern = NonNullable<NonNullable<NextConfig["images"]>["remotePatterns"]>[number]

/**
 * The image optimizer's allowlist. Kept beside canOptimizeProductImage so the two cannot drift:
 * every Blob path that function accepts must be content-addressed and served without a query.
 */
export function productImageRemotePatterns(blobHost: string | undefined): RemotePattern[] {
  return [
    ...["/published-mockups/v1/**", "/published-product-photos/v1/**", "/published-artwork/v1/**"].flatMap(
      (pathname) =>
        blobHost ? [{ protocol: "https" as const, hostname: blobHost, port: "", pathname, search: "" }] : []
    ),
    {
      protocol: "https",
      hostname: "images-api.printify.com",
      port: "",
      pathname: "/mockup/**",
      // Camera labels vary by garment view; preserve the provider's query string.
    },
  ]
}
