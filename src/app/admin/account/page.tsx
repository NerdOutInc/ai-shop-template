import Link from "next/link"
import { AdminAccountControls } from "@/features/admin/admin-account-controls"
import { requireAdmin } from "@/features/admin/require-admin.server"

export const dynamic = "force-dynamic"
export const metadata = { title: "Admin account", robots: { index: false, follow: false } }

export default async function AdminAccountPage() {
  await requireAdmin()
  return (
    <main id="main-content" className="mx-auto w-full max-w-xl space-y-8 px-5 py-14">
      <div className="space-y-2">
        <p className="font-label text-sm tracking-widest uppercase">Store studio</p>
        <h1 className="font-display text-3xl">Your account</h1>
      </div>
      <AdminAccountControls />
      <Link href="/admin/agents" className="inline-block underline underline-offset-4">
        Manage agent access
      </Link>
      <Link href="/admin/concepts" className="inline-block underline underline-offset-4">
        Back to the design library
      </Link>
    </main>
  )
}
