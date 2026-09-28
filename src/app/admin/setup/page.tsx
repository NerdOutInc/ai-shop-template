import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { env } from "@/lib/env"
import { AdminSignInForm } from "@/features/admin/admin-sign-in-form"
import { AdminStore } from "@/features/admin/admin-store.server"
import { getAdminAuthConfig } from "@/features/admin/get-admin-auth-config.server"
import { getAdminDatabase } from "@/features/admin/get-admin-database.server"
import { logAdminLibraryFailure } from "@/features/admin/log-admin-library-failure.server"

export const dynamic = "force-dynamic"
export const metadata = { title: "Owner setup", robots: { index: false, follow: false } }

export default async function AdminSetupPage() {
  if (!env.ADMIN_LIBRARY_ENABLED) notFound()
  let state: "available" | "recovery" | "unconfigured" = "unconfigured"
  if (getAdminAuthConfig() && env.DATABASE_URL) {
    try {
      const status = await new AdminStore(getAdminDatabase()).setupStatus()
      if (status === "claimed") redirect("/admin/sign-in")
      state = status
    } catch (error) {
      // Preserve framework redirects while leaving configuration failures closed.
      if (typeof error === "object" && error !== null && "digest" in error) throw error
      logAdminLibraryFailure("ADMIN_SETUP_STATUS_UNAVAILABLE", error)
    }
  }
  const ready = state === "available" && env.ADMIN_OWNER_EMAIL && env.ADMIN_SETUP_SECRET && env.SUPABASE_SECRET_KEY
  return (
    <main id="main-content" className="mx-auto w-full max-w-lg space-y-6 px-5 py-14">
      <h1 className="font-display text-3xl">
        {state === "recovery" ? "Restore owner access" : "Set up your store studio"}
      </h1>
      {ready ? (
        <>
          <p>
            Verify the configured owner email and one-time setup key to claim this store. Once claimed, this setup
            closes.
          </p>
          <AdminSignInForm setup />
        </>
      ) : state === "recovery" ? (
        <p>
          Owner setup has already been used. A Supabase project owner can restore an existing administrator by enabling
          their membership in the Table Editor. If the account is lost, recover or invite the intended account and
          assign membership there. This page cannot reopen ownership.
        </p>
      ) : (
        <p role="status">
          The deployment owner needs to finish the authentication settings, owner setup key, and database migration
          before setup is available.
        </p>
      )}
      <Link href="/admin/sign-in" className="inline-block underline underline-offset-4">
        Back to sign-in
      </Link>
    </main>
  )
}
