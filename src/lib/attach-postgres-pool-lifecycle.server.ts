import "server-only"

import { waitUntil } from "@vercel/functions"
import type { Pool } from "pg"

export function attachPostgresPoolLifecycle(pool: Pool) {
  const idleTimeout = pool.options.idleTimeoutMillis
  if (typeof idleTimeout !== "number" || !Number.isFinite(idleTimeout) || idleTimeout <= 0)
    throw new Error("Postgres pools require a positive idle timeout")
  pool.on("release", () => {
    if (!process.env.VERCEL_URL || !process.env.VERCEL_REGION) return
    // Each release owns its wait. Another pool or a request near its deadline must
    // not cancel or shorten the time this connection needs to become idle.
    waitUntil(new Promise<void>((resolve) => setTimeout(resolve, idleTimeout + 100).unref()))
  })
}
