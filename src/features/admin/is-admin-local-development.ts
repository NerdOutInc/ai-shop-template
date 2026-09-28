import { env } from "@/lib/env"

export function isAdminLocalDevelopment(): boolean {
  if (!env.NEXT_PUBLIC_SITE_URL) return process.env.NODE_ENV === "development"
  const site = new URL(env.NEXT_PUBLIC_SITE_URL)
  return site.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(site.hostname)
}
