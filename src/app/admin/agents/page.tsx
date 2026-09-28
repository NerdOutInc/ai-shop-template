import Link from "next/link"
import { requireAdmin } from "@/features/admin/require-admin.server"
import { getAdminDatabase } from "@/features/admin/get-admin-database.server"
import { DesignAgentGrantStore } from "@/features/design-agent/design-agent-grant-store.server"
import { AgentGrantControls } from "@/features/design-agent/agent-grant-controls"
export const dynamic = "force-dynamic"
export const metadata = { title: "Agent access", robots: { index: false, follow: false } }
export default async function AgentAccessPage() {
  const actor = await requireAdmin()
  const grants = await new DesignAgentGrantStore(getAdminDatabase()).list(actor.userId)
  return (
    <main id="main-content" className="mx-auto w-full max-w-2xl space-y-6 px-5 py-12">
      <h1 className="font-display text-3xl">Agent access</h1>
      <p>
        Delegate design work with a short-lived credential. Keep the keys on a short leash; the sloths can still take
        their time.
      </p>
      <AgentGrantControls grants={grants} />
      <Link href="/admin/account" className="underline underline-offset-4">
        Back to your account
      </Link>
    </main>
  )
}
