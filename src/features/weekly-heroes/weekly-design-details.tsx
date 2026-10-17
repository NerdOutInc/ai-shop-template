import Link from "next/link"

import { JsonLdScript } from "@/components/json-ld-script"
import { listCadenceSlots } from "@/features/publishing/list-cadence-slots"
import { formatStoreMoment } from "@/lib/format-store-moment"
import type { WeeklyHeroProduct } from "./read-weekly-hero-products.server"

export function WeeklyDesignDetails({
  title,
  liveAt,
  products,
  siteUrl,
}: {
  title?: string
  liveAt: string
  products: WeeklyHeroProduct[]
  siteUrl: URL
}) {
  const name = title ? `Design of the week: ${title}` : "This week’s featured products"
  const week = formatStoreMoment(liveAt, { month: "long", day: "numeric", year: "numeric" })
  const end = listCadenceSlots({ from: new Date(liveAt), count: 1 })[0]!.toISOString()
  return (
    <div className="border-b bg-background px-6 py-4 text-center text-foreground">
      <section className="sr-only" aria-label={name}>
        <h2>{name}</h2>
        <p>
          Week of <time dateTime={liveAt}>{week}</time>. A new design every week.
        </p>
        {/* The hero and shop provide visible keyboard destinations; these duplicate links serve screen readers and HTML readers. */}
        <ul aria-label="This week’s products and photos">
          {products.map((product) => (
            <li key={product.id}>
              <Link href={product.href} tabIndex={-1}>
                {product.title}
                {product.color ? ` — ${product.color}` : ""}
              </Link>
              {product.image && (
                <a href={product.image.src} tabIndex={-1}>
                  View {product.image.alt} photo
                </a>
              )}
            </li>
          ))}
        </ul>
      </section>
      <Link href="/shop" className="button">
        Shop all designs
      </Link>
      <JsonLdScript
        data={{
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          "@id": new URL("/#weekly-design", siteUrl).href,
          url: new URL("/#design-of-the-week", siteUrl).href,
          name,
          description: `${name}. Week of ${week}. A new design every week.`,
          temporalCoverage: `${liveAt}/${end}`,
          relatedLink: new URL("/shop", siteUrl).href,
          mainEntity: {
            "@type": "ItemList",
            name,
            numberOfItems: products.length,
            itemListElement: products.map((product, index) => ({
              "@type": "ListItem",
              position: index + 1,
              item: {
                "@type": "ProductGroup",
                "@id": new URL(`/shop/${encodeURIComponent(product.id)}#product`, siteUrl).href,
                name: product.title,
                url: new URL(product.href, siteUrl).href,
                ...(product.color ? { color: product.color } : {}),
                ...(product.image ? { image: product.image.src } : {}),
              },
            })),
          },
        }}
      />
    </div>
  )
}
