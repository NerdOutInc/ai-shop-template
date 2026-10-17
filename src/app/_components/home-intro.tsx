import Link from "next/link"
import { storeConfig } from "@/lib/store-config"

export function HomeIntro() {
  return (
    <section className="home-intro">
      <div className="page-width">
        <p className="home-tagline">{storeConfig.tagline}</p>
        <h1 className="font-display">{storeConfig.home.headline}</h1>
        <p className="home-description">{storeConfig.home.introduction}</p>
        <Link href="/shop" className="button mt-7">
          {storeConfig.home.shopLabel}
        </Link>
      </div>
    </section>
  )
}
