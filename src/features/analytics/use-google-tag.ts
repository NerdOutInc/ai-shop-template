"use client"

import { useSyncExternalStore } from "react"

import { googleTag } from "./google-tag"

export function useGoogleTag() {
  return useSyncExternalStore(googleTag.subscribe, googleTag.getSnapshot, googleTag.getServerSnapshot)
}
