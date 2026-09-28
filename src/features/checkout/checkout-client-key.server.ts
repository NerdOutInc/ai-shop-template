import "server-only"

import { createHmac } from "node:crypto"
import { isIP } from "node:net"

import { CheckoutError } from "./checkout-error"

export function checkoutClientKey(headers: Headers, secret: string | undefined, vercel: boolean) {
  if (!secret || secret.length < 32)
    throw new CheckoutError("NOT_CONFIGURED", "Checkout is unavailable while we finish connecting the shop.")

  // Only Vercel's deployment environment grants trust to its overwritten ingress header.
  // Other hosts share one conservative bucket until they have an explicit trusted adapter.
  let network = "shared"
  if (vercel) {
    const ip = headers.get("x-vercel-forwarded-for")
    if (!ip || ip.length > 45 || !isIP(ip))
      throw new CheckoutError("CLIENT_UNAVAILABLE", "Checkout could not open. Please try again shortly.")
    network = ip
    if (isIP(ip) === 6) {
      const canonical = new URL(`http://[${ip}]`).hostname.slice(1, -1)
      const [left, right] = canonical.split("::")
      const start = left ? left.split(":") : []
      const end = right ? right.split(":") : []
      const groups =
        right !== undefined ? [...start, ...Array<string>(8 - start.length - end.length).fill("0"), ...end] : start
      // Normalize IPv4-mapped addresses; otherwise group privacy-address rotation within a /64.
      network =
        groups.slice(0, 6).join(":") === "0:0:0:0:0:ffff"
          ? `${parseInt(groups[6]!, 16) >> 8}.${parseInt(groups[6]!, 16) & 255}.${parseInt(groups[7]!, 16) >> 8}.${parseInt(groups[7]!, 16) & 255}`
          : `${groups.slice(0, 4).join(":")}::/64`
    }
  }
  return createHmac("sha256", secret).update(network).digest("hex")
}
