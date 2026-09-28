import { storeConfig } from "@/lib/store-config"

export function DropRemovalLink() {
  return (
    <a
      href={`mailto:${storeConfig.supportEmail}?subject=${encodeURIComponent("Remove me from design-drop emails")}`}
      className="underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      Email {storeConfig.supportEmail} to request removal
    </a>
  )
}
