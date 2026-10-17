import { storeConfig } from "@/lib/store-config"
import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { readHeroWeekParam } from "@/features/weekly-heroes/read-hero-week-param.server"
import { requireAdmin } from "@/features/admin/require-admin.server"
import { getWeeklyHeroStore } from "@/features/weekly-heroes/get-weekly-hero-store.server"
import { WeeklyHeroPoster } from "@/features/weekly-heroes/weekly-hero-poster"

export const dynamic = "force-dynamic"
export const metadata: Metadata = { title: "Private weekly hero preview", robots: { index: false, follow: false } }
export default async function HeroPreviewPage({ params }: { params: Promise<{ week: string }> }) {
  await requireAdmin()
  if (!storeConfig.features.designOfTheWeek) notFound()
  const week = await readHeroWeekParam(params)
  const result = await Promise.resolve()
    .then(async () => ({ hero: await getWeeklyHeroStore().read(week) }))
    .catch(() => null)
  const hero = result?.hero
  return (
    <main id="main-content" tabIndex={-1}>
      <div className="border-b bg-background px-6 py-3 text-center text-sm">
        Private preview · Resize to check desktop and mobile. Product links open admin previews.{" "}
        <Link
          className="inline-flex min-h-11 items-center underline"
          href={`/admin/products/heroes/${encodeURIComponent(week)}`}
        >
          Return to editor
        </Link>
      </div>
      {hero ? (
        <WeeklyHeroPoster hero={hero} privatePreview />
      ) : (
        <p role="alert" className="page-width py-10">
          {result
            ? "This saved hero cannot be previewed. Return to the editor to replace or withdraw it."
            : "Weekly hero storage is unavailable. Apply the weekly hero migration and configure private image storage before saving."}
        </p>
      )}
    </main>
  )
}
