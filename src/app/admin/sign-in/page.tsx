import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { env } from "@/lib/env"
import { adminSignInDestination } from "@/features/admin/admin-sign-in-destination"
import { AdminSignInForm } from "@/features/admin/admin-sign-in-form"
import { getAdminActor } from "@/features/admin/get-admin-actor.server"
import { getAdminAuthConfig } from "@/features/admin/get-admin-auth-config.server"

export const dynamic = "force-dynamic"
export const metadata = { title: "Admin sign-in", robots: { index: false, follow: false } }

export default async function AdminSignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const destination = adminSignInDestination((await searchParams).returnTo)
  if (!env.ADMIN_LIBRARY_ENABLED) notFound()
  if (await getAdminActor()) redirect(destination)
  const configured = getAdminAuthConfig() && env.DATABASE_URL
  return (
    <main id="main-content" className="mx-auto w-full max-w-lg space-y-6 px-5 py-14">
      <div className="space-y-2">
        <p className="font-label text-sm tracking-widest uppercase">Store studio</p>
        <h1 className="font-display text-3xl">Sign in to your design library</h1>
        <p>Passkeys for the quick route. Email codes for the backup hold.</p>
      </div>
      {configured ? (
        <AdminSignInForm returnTo={destination} />
      ) : (
        <p role="status">
          Admin sign-in is not configured yet. Ask the deployment owner to finish authentication setup.
        </p>
      )}
      <p className="text-sm">
        <Link href="/admin/setup" className="underline underline-offset-4">
          Owner setup or recovery
        </Link>
      </p>
    </main>
  )
}
