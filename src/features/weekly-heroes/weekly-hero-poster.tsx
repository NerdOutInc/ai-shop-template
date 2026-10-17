import { getImageProps } from "next/image"
import Link from "next/link"
import type { CSSProperties } from "react"
import { getWeeklyHeroLayout } from "./get-weekly-hero-layout"
import type { WeeklyHero } from "./weekly-hero-schema"
import styles from "./weekly-hero-poster.module.css"

/** Uploads are complete compositions; link rectangles are measured against each full source. */
export function WeeklyHeroPoster({ hero, privatePreview = false }: { hero: WeeklyHero; privatePreview?: boolean }) {
  const image = (asset: WeeklyHero["desktop"], sizes: string) =>
    getImageProps({
      src: `${privatePreview ? "/api/admin/weekly-heroes/assets" : "/api/weekly-hero"}/${asset.id}`,
      width: asset.width,
      height: asset.height,
      sizes,
      alt: hero.manifest.alt,
      loading: "eager",
      fetchPriority: "high",
      unoptimized: true,
    }).props
  const layout = getWeeklyHeroLayout(2)
  const desktop = image(hero.desktop, layout.sizes)
  const mobile = image(hero.mobile, "100vw")
  return (
    <section id="design-of-the-week" className={styles.hero} aria-labelledby="weekly-hero-heading">
      <div className="sr-only">
        <h1 id="weekly-hero-heading">Design of the week: {hero.manifest.title}</h1>
        <p>A new design every week</p>
        <p>{hero.manifest.offer}</p>
      </div>
      <div className={styles.frame} style={layout.frameStyle}>
        <picture>
          <source
            media="(max-width: 700px)"
            srcSet={mobile.srcSet ?? mobile.src}
            sizes={mobile.sizes}
            width={mobile.width}
            height={mobile.height}
          />
          <img {...desktop} className={styles.scene} alt={hero.manifest.alt} />
        </picture>
        {hero.manifest.links.map((link) => (
          <Link
            key={link.productId}
            className={styles.link}
            href={`${privatePreview ? "/admin/products" : "/shop"}/${encodeURIComponent(link.productId)}${link.color ? `?color=${encodeURIComponent(link.color)}` : ""}`}
            aria-label={`${link.label} — ${hero.manifest.title}${link.color ? ` in ${link.color}` : ""}`}
            style={
              Object.fromEntries(
                ["desktop", "mobile"].flatMap((kind) =>
                  Object.entries(link[kind as "desktop" | "mobile"]).map(([key, value]) => [`--${kind}-${key}`, value])
                )
              ) as CSSProperties
            }
          >
            <span className="sr-only">
              {link.label} — {hero.manifest.title}
              {link.color ? ` in ${link.color}` : ""}
            </span>
          </Link>
        ))}
      </div>
    </section>
  )
}
