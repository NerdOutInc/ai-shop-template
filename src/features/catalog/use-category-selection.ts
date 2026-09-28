"use client"

import { useSearchParams } from "next/navigation"

export function useCategorySelection(availableSlugs: string[]) {
  const searchParams = useSearchParams()
  const categories = [...new Set(searchParams.getAll("category"))].filter((slug) => availableSlugs.includes(slug))

  function setCategories(nextCategories: string[]) {
    const url = new URL(window.location.href)
    url.searchParams.delete("category")
    for (const slug of new Set(nextCategories)) {
      if (availableSlugs.includes(slug)) url.searchParams.append("category", slug)
    }
    if (url.searchParams.toString() !== searchParams.toString()) {
      // Next preserves its history state and updates useSearchParams without adding a navigation entry.
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`)
    }
  }

  return { categories, setCategories }
}
