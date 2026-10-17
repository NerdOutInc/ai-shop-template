import Image from "next/image"
import Link from "next/link"

import { canOptimizeProductImage } from "@/features/catalog/can-optimize-product-image"
import { NewProductBadge } from "@/features/catalog/new-product-badge"
import { GarmentSetupNotice } from "@/features/garment-catalog/garment-setup-notice"

import type { FeaturedOrderProduct } from "./featured-order-product"

export function FeaturedProductContent({
  product,
  hidden,
  note,
  interactive = true,
  isNew = false,
}: {
  product: FeaturedOrderProduct
  hidden?: boolean
  note?: string
  interactive?: boolean
  /** From isProductNewOnTheWall, worked out by whoever holds the lineup's clock. */
  isNew?: boolean
}) {
  return (
    <>
      <div className="relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted sm:size-16">
        {product.image && (
          <Image
            src={product.image.src}
            alt=""
            width={128}
            height={128}
            sizes="64px"
            unoptimized={!canOptimizeProductImage(product.image.src)}
            className="h-full w-full object-contain mix-blend-multiply"
          />
        )}
        {isNew && <NewProductBadge size="compact" />}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="font-condensed text-lg leading-tight font-semibold break-words">{product.title}</p>
        {note && <p className="text-sm text-muted-foreground">{note}</p>}
        {interactive && product.garmentSetup && (
          <GarmentSetupNotice
            blueprintId={product.garmentSetup.blueprintId}
            label={product.garmentSetup.label}
            productTitle={product.title}
          />
        )}
        {interactive && !hidden && (
          <Link
            href={`/admin/products/${encodeURIComponent(product.id)}#google-copy`}
            className="inline-flex min-h-11 w-fit items-center text-sm underline underline-offset-4"
          >
            Google copy<span className="sr-only">: {product.title}</span>
          </Link>
        )}
        {interactive && (
          <Link
            href={`${hidden ? "/admin/products" : "/shop"}/${encodeURIComponent(product.id)}`}
            className="inline-flex min-h-11 w-fit items-center text-sm underline underline-offset-4"
          >
            {hidden ? "Preview product" : "View in shop"}
            <span className="sr-only">: {product.title}</span>
          </Link>
        )}
      </div>
    </>
  )
}
