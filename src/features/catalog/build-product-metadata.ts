import type { Metadata } from "next"

import { displayColorText } from "@/lib/display-color-text"
import { storeConfig } from "@/lib/store-config"

import type { CatalogProduct } from "./catalog-product"
import { displayProductTitle } from "./display-product-title"
import { getProductIntroduction } from "./get-product-introduction"
import { getProductGarmentLabels } from "./get-product-garment-labels"

const descriptionLimit = 170
const sentenceSegmenter = new Intl.Segmenter("en", { granularity: "sentence" })

function fitIntroduction(text: string, limit: number) {
  if (text.length <= limit) return text
  let sentences = ""
  for (const { segment } of sentenceSegmenter.segment(text)) {
    const next = `${sentences}${segment}`
    if (next.trim().length > limit) break
    sentences = next
  }
  if (sentences.trim()) return sentences.trim()
  const clipped = Array.from(text)
    .slice(0, limit - 1)
    .join("")
  const lastSpace = clipped.lastIndexOf(" ")
  return `${(lastSpace > 0 ? clipped.slice(0, lastSpace) : clipped).replace(/[,:;—–-]+$/, "").trimEnd()}…`
}

export function buildProductMetadata(product: CatalogProduct): Metadata {
  const displayTitle = displayProductTitle(product.title)
  const garment = getProductGarmentLabels(product)
  const garmentContext = garment.description
  const title = garment.titlePattern.test(displayTitle) ? displayTitle : `${displayTitle} – ${garment.titleLabel}`
  const socialTitle = `${title} | ${storeConfig.name}`
  const introduction = fitIntroduction(getProductIntroduction(product), descriptionLimit - garmentContext.length - 1)
  const description = `${introduction} ${garmentContext}`
  const images = product.image
    ? [
        {
          url: product.image.src,
          alt: displayColorText(
            product.image.alt,
            product.colors.map(({ name }) => name)
          ),
        },
      ]
    : [{ url: "/opengraph-image", alt: storeConfig.description }]

  return {
    title,
    description,
    openGraph: {
      title: socialTitle,
      description,
      images,
      siteName: storeConfig.name,
      type: "website",
      locale: storeConfig.locale.replace("-", "_"),
    },
    twitter: { card: "summary_large_image", title: socialTitle, description, images },
  }
}
