import Image from "next/image"

import { storeConfig } from "@/lib/store-config"

export function BrandLogo({
  name = storeConfig.name,
  logo = storeConfig.logo,
}: {
  name?: string
  logo?: typeof storeConfig.logo
}) {
  return (
    <span className="brand-logo" aria-hidden="true">
      <Image
        src={logo.src}
        alt=""
        width={logo.width}
        height={logo.height}
        style={{ width: Math.min(logo.width, 240, (80 * logo.width) / logo.height), height: "auto" }}
      />
      {logo.showName && <span>{name}</span>}
    </span>
  )
}
