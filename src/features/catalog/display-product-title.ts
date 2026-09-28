import { storeConfig } from "@/lib/store-config"

export function displayProductTitle(title: string) {
  const name = storeConfig.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return title.replace(new RegExp(`\\s+[—–-]\\s+${name}(?:\\s*\\|.*)?$`, "i"), "")
}
