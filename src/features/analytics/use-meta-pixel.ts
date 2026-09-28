"use client"

import { useSyncExternalStore } from "react"

import { metaPixel } from "./meta-pixel"

export function useMetaPixel() {
  return useSyncExternalStore(metaPixel.subscribe, metaPixel.getSnapshot, metaPixel.getServerSnapshot)
}
