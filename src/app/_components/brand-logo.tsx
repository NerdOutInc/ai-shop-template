import Image from "next/image"

import { storeConfig } from "@/lib/store-config"

export function BrandLogo() {
  return (
    <span className="brand-logo" aria-hidden="true">
      <Image src={storeConfig.logo.src} alt="" width={storeConfig.logo.width} height={storeConfig.logo.height} />
      <span>{storeConfig.name}</span>
    </span>
  )
}
