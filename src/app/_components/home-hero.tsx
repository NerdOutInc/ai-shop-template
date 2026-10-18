import { connection } from "next/server"
import { getWeeklyHeroStore } from "@/features/weekly-heroes/get-weekly-hero-store.server"
import { WeeklyHeroPoster } from "@/features/weekly-heroes/weekly-hero-poster"
import { WeeklyDesignDetails } from "@/features/weekly-heroes/weekly-design-details"
import { readWeeklyHeroProducts } from "@/features/weekly-heroes/read-weekly-hero-products.server"
import { getSiteUrl } from "@/lib/get-site-url"
import { HomeIntro } from "./home-intro"

export async function HomeHero() {
  await connection()
  const hero = await Promise.resolve()
    .then(() => getWeeklyHeroStore().current())
    .catch(() => {
      console.warn("Weekly hero unavailable", { reason: "storage" })
      return null
    })
  if (!hero) return <HomeIntro />
  const products = await readWeeklyHeroProducts(hero.manifest.links)
  return (
    <>
      <WeeklyHeroPoster hero={hero} />
      <WeeklyDesignDetails
        title={hero.manifest.title}
        liveAt={hero.liveAt}
        products={products}
        siteUrl={getSiteUrl()}
      />
    </>
  )
}
