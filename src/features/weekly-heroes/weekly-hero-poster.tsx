import { getImageProps } from "next/image"
import Link from "next/link"
import type { CSSProperties } from "react"

import { displayColorName } from "@/lib/display-color-name"

import { getWeeklyHeroLayout } from "./get-weekly-hero-layout"
import type { WeeklyHero } from "./weekly-hero-schema"
import styles from "./weekly-hero-poster.module.css"

/** Uploads are complete compositions; link rectangles are measured against each full source. */
export function WeeklyHeroPoster({ hero, privatePreview = false }: { hero: WeeklyHero; privatePreview?: boolean }) {
  const image = (asset: WeeklyHero["desktop"]) =>
    getImageProps({
      src: `${privatePreview ? "/api/admin/weekly-heroes/assets" : "/api/weekly-hero"}/${asset.id}`,
      width: asset.width,
      height: asset.height,
      alt: hero.manifest.alt,
      loading: "eager",
      fetchPriority: "high",
      // Serve the Retina original through eligibility checks, including after withdrawal.
      unoptimized: true,
    }).props
  const layout = getWeeklyHeroLayout()
  const desktop = image(hero.desktop)
  const mobile = image(hero.mobile)
  return (
    <section id="weekly-hero" className={styles.hero} aria-labelledby="weekly-hero-heading">
      <div className="sr-only">
        <h1 id="weekly-hero-heading">Design of the week: {hero.manifest.title}</h1>
        <p>A new design every week</p>
        <p>{hero.manifest.offer}</p>
      </div>
      <div className={styles.frame} style={layout}>
        <picture>
          <source
            media="(max-width: 700px)"
            srcSet={mobile.srcSet ?? mobile.src}
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
            aria-label={`${link.label} — ${hero.manifest.title}${link.color ? ` in ${displayColorName(link.color)}` : ""}`}
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
              {link.color ? ` in ${displayColorName(link.color)}` : ""}
            </span>
          </Link>
        ))}
      </div>
    </section>
  )
}
