import { z } from "zod"

export function adminSignInDestination(candidate: unknown): string {
  // Only the exact order links emitted by owner alerts can override the landing page.
  if (typeof candidate !== "string" || !candidate.startsWith("/admin/orders?order=")) return "/admin/concepts"
  const id = z.uuid().safeParse(candidate.slice("/admin/orders?order=".length))
  return id.success ? `/admin/orders?order=${id.data}` : "/admin/concepts"
}
