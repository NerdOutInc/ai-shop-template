import { act, renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { useCategorySelection } from "./use-category-selection"

vi.mock("next/navigation", async () => {
  const { useSyncExternalStore } = await import("react")
  return {
    useSearchParams: () =>
      new URLSearchParams(
        useSyncExternalStore(
          (notify) => {
            window.addEventListener("popstate", notify)
            return () => window.removeEventListener("popstate", notify)
          },
          () => window.location.search
        )
      ),
  }
})

const availableSlugs = ["t-shirts", "crop-tops"]

beforeEach(() => {
  window.history.replaceState(null, "", "/shop")
  const replaceState = window.history.replaceState.bind(window.history)
  // Model Next's search-parameter notification around jsdom's real URL/history implementation.
  vi.spyOn(window.history, "replaceState").mockImplementation((...args) => {
    replaceState(...args)
    window.dispatchEvent(new PopStateEvent("popstate"))
  })
})

describe("useCategorySelection", () => {
  it("restores each supported category from a direct URL and ignores duplicates or unknown values", () => {
    window.history.replaceState(
      null,
      "",
      "/shop?category=crop-tops&category=retired&category=t-shirts&category=crop-tops"
    )
    const { result } = renderHook(() => useCategorySelection(availableSlugs))

    expect(result.current.categories).toEqual(["crop-tops", "t-shirts"])
  })

  it.each(["/shop", "/shop?category=retired", "/shop?category="])("shows all categories for %s", (url) => {
    window.history.replaceState(null, "", url)
    const { result } = renderHook(() => useCategorySelection(availableSlugs))

    expect(result.current.categories).toEqual([])
  })

  it("updates shareable selections without adding history entries or dropping unrelated query values and the hash", () => {
    window.history.replaceState(null, "", "/shop?campaign=new%20season&source=email&source=friend#main-content")
    const historyLength = window.history.length
    const { result } = renderHook(() => useCategorySelection(availableSlugs))

    act(() => result.current.setCategories(["crop-tops", "t-shirts", "crop-tops", "retired"]))

    expect(result.current.categories).toEqual(["crop-tops", "t-shirts"])
    expect(new URLSearchParams(window.location.search).getAll("category")).toEqual(["crop-tops", "t-shirts"])
    expect(new URLSearchParams(window.location.search).get("campaign")).toBe("new season")
    expect(new URLSearchParams(window.location.search).getAll("source")).toEqual(["email", "friend"])
    expect(window.location.hash).toBe("#main-content")
    expect(window.history.length).toBe(historyLength)

    act(() => result.current.setCategories([]))

    expect(result.current.categories).toEqual([])
    expect(new URLSearchParams(window.location.search).has("category")).toBe(false)
    expect(new URLSearchParams(window.location.search).get("campaign")).toBe("new season")
    expect(new URLSearchParams(window.location.search).getAll("source")).toEqual(["email", "friend"])
    expect(window.location.hash).toBe("#main-content")
    expect(window.history.length).toBe(historyLength)
  })

  it("keeps a valid URL selection when the catalog offers only one category", () => {
    window.history.replaceState(null, "", "/shop?category=crop-tops")
    const { result } = renderHook(() => useCategorySelection(["crop-tops"]))

    expect(result.current.categories).toEqual(["crop-tops"])

    act(() => result.current.setCategories([]))

    expect(result.current.categories).toEqual([])
    expect(window.location.search).toBe("")
  })

  it("reevaluates selections when navigation or available categories change", () => {
    const { result, rerender } = renderHook(({ slugs }) => useCategorySelection(slugs), {
      initialProps: { slugs: availableSlugs },
    })
    act(() => {
      window.history.replaceState(null, "", "/shop?category=crop-tops")
    })
    expect(result.current.categories).toEqual(["crop-tops"])

    rerender({ slugs: ["t-shirts"] })
    expect(result.current.categories).toEqual([])

    rerender({ slugs: availableSlugs })
    expect(result.current.categories).toEqual(["crop-tops"])
  })
})
