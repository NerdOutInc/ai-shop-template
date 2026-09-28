import Image from "next/image"

import { canOptimizeProductImage } from "./can-optimize-product-image"

type ProductArtworkImageProps = {
  src: string
  alt: string
  backgroundColor: string
  className?: string
  sizes?: string
  priority?: boolean
  /** The drop hero is taller than a card's square, so it needs its own intrinsic size. */
  width?: number
  height?: number
}

export function ProductArtworkImage({
  src,
  alt,
  backgroundColor,
  className = "",
  sizes,
  priority = false,
  width = 1000,
  height = 1000,
}: ProductArtworkImageProps) {
  return (
    <div className={`product-artwork-image ${className}`} style={{ backgroundColor }}>
      <Image
        src={src}
        unoptimized={!src.startsWith("/") && !canOptimizeProductImage(src)}
        alt={alt}
        width={width}
        height={height}
        sizes={sizes}
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : undefined}
      />
    </div>
  )
}
