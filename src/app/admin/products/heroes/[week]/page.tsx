import { notFound } from "next/navigation"
import { storeConfig } from "@/lib/store-config"
import type { Metadata } from "next"
import Link from "next/link"
import { readHeroWeekParam } from "@/features/weekly-heroes/read-hero-week-param.server"
import { requireAdmin } from "@/features/admin/require-admin.server"
import { getWeeklyHeroStore } from "@/features/weekly-heroes/get-weekly-hero-store.server"
import { WeeklyHeroEditor } from "@/features/weekly-heroes/weekly-hero-editor"
import { formatStoreMoment } from "@/lib/format-store-moment"

export const dynamic = "force-dynamic"
export const metadata: Metadata = { title: "Weekly hero", robots: { index: false, follow: false } }
export default async function HeroEditorPage({ params }: { params: Promise<{ week: string }> }) {
  await requireAdmin()
  if (!storeConfig.features.designOfTheWeek) notFound()
  const week = await readHeroWeekParam(params)
  const result = await (async () => {
    try {
      const store = getWeeklyHeroStore()
      const [draft, products, now] = await Promise.all([store.readDraft(week), store.products(week), store.clock()])
      return { draft, products, now }
    } catch {
      return null
    }
  })()
  return (
    <main id="main-content" tabIndex={-1} className="page-width py-10 sm:py-14">
      <Link href="/admin/products" className="inline-flex min-h-11 items-center underline">
        ← Shop lineup
      </Link>
      <h1 className="display-heading mt-5">This week’s scene.</h1>
      <p className="mt-4 mb-8 text-muted-foreground">
        Week of {formatStoreMoment(week, { weekday: "long", month: "long", day: "numeric" })}. One release, two
        compositions.
      </p>
      {result ? (
        <WeeklyHeroEditor now={result.now} liveAt={week} initial={result.draft} products={result.products} />
      ) : (
        <p role="alert">
          Weekly hero storage is unavailable. Apply the weekly hero migration and configure private image storage before
          saving.
        </p>
      )}
    </main>
  )
}
