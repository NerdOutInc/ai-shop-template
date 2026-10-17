import type { GoogleMerchantCopy } from "./google-merchant-copy-schema"

export type GoogleCopyEditorState = {
  expectedRevision: string
  blocked: string | null
  content: string
  origin: "generated" | "human" | null
  originLocked: boolean
  metadata: Pick<GoogleMerchantCopy, "pattern" | "materials">
  variants: { id: number; label: string; selected: boolean; selectable: boolean; reason: string | null }[]
  issues: { code: string; variantId?: number }[]
  savedCopy: GoogleMerchantCopy | null
}

export type GoogleCopyPreview = {
  expectedRevision: string
  copy: GoogleMerchantCopy
  digest: string
  descriptions: {
    id: number
    label: string
    content: string
    origin: "generated" | "human" | "fallback"
    previousContent: string
    effect: "added" | "removed" | "retained" | "fallback"
    pattern?: string
    material?: string
  }[]
}
