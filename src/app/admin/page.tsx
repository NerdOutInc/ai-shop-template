import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"

import { env } from "@/lib/env"

export const metadata: Metadata = { robots: { index: false, follow: false } }
export const dynamic = "force-dynamic"

export default function AdminPage() {
  if (!env.ADMIN_LIBRARY_ENABLED) notFound()
  redirect("/admin/concepts")
}
