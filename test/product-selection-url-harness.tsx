import { SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime"
import { useLayoutEffect, useState, type ReactNode } from "react"

type ProductSelectionUrlHarnessProps = {
  children?: ReactNode
  initialSelection?: { color?: string; size?: string; categories?: string[] }
}

function otherQuery(search: URLSearchParams) {
  const query = new URLSearchParams(search)
  query.delete("color")
  query.delete("size")
  query.delete("category")
  return query.toString()
}

export function ProductSelectionUrlHarness({ children, initialSelection }: ProductSelectionUrlHarnessProps) {
  const [searchParams, setSearchParams] = useState(() => {
    const query = new URLSearchParams(window.location.search)
    query.delete("color")
    query.delete("size")
    query.delete("category")
    if (initialSelection?.color) query.set("color", initialSelection.color)
    if (initialSelection?.size) query.set("size", initialSelection.size)
    for (const category of initialSelection?.categories ?? []) query.append("category", category)
    return query
  })

  useLayoutEffect(() => {
    const originalReplaceState = window.history.replaceState
    // Storybook supplies a static search context. Mirror Next's context update without changing its iframe URL.
    window.history.replaceState = (data, unused, url) => {
      if (data !== null || !url) return originalReplaceState.call(window.history, data, unused, url)
      const current = new URL(window.location.href)
      const next = new URL(url, current)
      if (
        next.origin !== current.origin ||
        next.pathname !== current.pathname ||
        next.hash !== current.hash ||
        otherQuery(next.searchParams) !== otherQuery(current.searchParams)
      ) {
        return originalReplaceState.call(window.history, data, unused, url)
      }
      setSearchParams((previous) =>
        previous.toString() === next.searchParams.toString() ? previous : next.searchParams
      )
    }
    return () => {
      window.history.replaceState = originalReplaceState
    }
  }, [])

  return (
    <SearchParamsContext.Provider value={searchParams}>
      <div data-testid="product-selection-url" data-search={searchParams.toString()}>
        {children}
      </div>
    </SearchParamsContext.Provider>
  )
}
