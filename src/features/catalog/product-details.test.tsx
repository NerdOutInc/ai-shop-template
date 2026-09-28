import { storeConfig } from "@/lib/store-config"
import { act, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { StrictMode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { CatalogProduct } from "./catalog-product"
import { ProductDetails } from "./product-details"
import { readProductDescription } from "./read-product-description"

const { addItem, cart, trackStoreEvent, metaTrack, pixel } = vi.hoisted(() => ({
  addItem: vi.fn(),
  cart: { count: 0, persistenceWarning: false },
  trackStoreEvent: vi.fn(),
  metaTrack: vi.fn(),
  pixel: { ready: true },
}))
vi.mock("@/features/analytics/track-store-event", () => ({ trackStoreEvent }))
vi.mock("@/features/analytics/meta-pixel", () => ({ metaPixel: { track: metaTrack } }))
vi.mock("@/features/analytics/use-meta-pixel", () => ({ useMetaPixel: () => pixel }))
vi.mock("@/features/cart/use-cart", () => ({ useCart: () => ({ addItem, ...cart }) }))
// jsdom has no layout or native touch input; browser journeys exercise the real Embla engine.
vi.mock("embla-carousel-react", async () => {
  const { useCallback, useRef, useState } = await import("react")
  return {
    default: function useEmblaCarousel({ startIndex = 0 }: { startIndex?: number }) {
      const viewport = useRef<HTMLElement | null>(null)
      const [api] = useState(() => {
        let selected = startIndex
        const listeners = new Map<string, Set<(api: object) => void>>()
        const count = () => viewport.current?.querySelectorAll('[data-slot="carousel-item"]').length ?? 1
        const scrollTo = (index: number) => {
          const next = (index + count()) % count()
          if (selected === next) return
          selected = next
          listeners.get("select")?.forEach((listener) => listener(api))
        }
        return {
          selectedScrollSnap: () => selected,
          canScrollPrev: () => count() > 1,
          canScrollNext: () => count() > 1,
          scrollTo,
          scrollPrev: () => scrollTo(selected - 1),
          scrollNext: () => scrollTo(selected + 1),
          on: (event: string, listener: (api: object) => void) => {
            if (!listeners.has(event)) listeners.set(event, new Set())
            listeners.get(event)!.add(listener)
          },
          off: (event: string, listener: (api: object) => void) => listeners.get(event)?.delete(listener),
        }
      })
      const ref = useCallback((node: HTMLElement | null) => {
        viewport.current = node
      }, [])
      return [ref, api]
    },
  }
})
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

const product: CatalogProduct = {
  id: "111111000000000000000002",
  title: "Small Wins — Fixture Store | Next Level 6210",
  garment: {
    manufacturer: "Next Level",
    model: "6210",
    categorySlug: "t-shirts",
    categoryName: "T-shirts",
    categorySortPosition: 1,
    gender: "unisex" as const,
  },
  description: "Soft fabric.\nGood company.",
  addedToShopAt: "2026-09-01T12:00:00.000Z",
  salesCount: 2,
  image: { src: "https://images.printify.com/black-front.jpg", alt: "Black shirt front" },
  images: [
    { src: "https://images.printify.com/black-front.jpg", alt: "Black shirt front", variantIds: [1, 2] },
    { src: "https://images.printify.com/black-back.jpg", alt: "Black shirt back", variantIds: [1, 2] },
    { src: "https://images.printify.com/grey-front.jpg", alt: "Heather Grey shirt front", variantIds: [3] },
  ],
  price: { currency: "USD", min: 2500, max: 2800 },
  options: [],
  variants: [
    {
      id: 2,
      title: "Black / 2XL",
      price: 2800,
      currency: "USD",
      available: true,
      color: "Black",
      size: "2XL",
      options: [],
    },
    {
      id: 1,
      title: "Black / S",
      price: 2500,
      currency: "USD",
      available: true,
      color: "Black",
      size: "S",
      options: [],
    },
    {
      id: 4,
      title: "Black / M",
      price: 2500,
      currency: "USD",
      available: false,
      color: "Black",
      size: "M",
      options: [],
    },
    {
      id: 3,
      title: "Heather Grey / M",
      price: 2700,
      currency: "USD",
      available: true,
      color: "Heather Grey",
      size: "M",
      options: [],
    },
  ],
  colors: [
    { name: "Black", hex: "#222222" },
    { name: "Heather Grey", hex: "#aaaaaa" },
  ],
  sizeGuide: { sizes: ["S", "M", "2XL"], measurements: [{ label: "Width, in", values: ["19.00", "20.50", "26.00"] }] },
  availability: "available",
}
const artwork = { src: "/images/small-wins-artwork.png", alt: "Small Wins artwork", backgroundColor: "#222222" }

it("keeps an available variant purchasable when an unavailable variant shares its displayed options", async () => {
  window.history.replaceState(null, "", `/shop/${product.id}?color=Black&size=M`)
  render(
    <ProductDetails
      product={{
        ...product,
        variants: [...product.variants, { ...product.variants[2]!, id: 5, price: 3100, available: true }],
      }}
    />
  )
  expect(screen.getByText("$31.00", { exact: true })).toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: "Add to cart" }))
  expect(addItem).toHaveBeenCalledWith(expect.objectContaining({ variantId: 5, unitAmount: 3100 }))
})

it("shows the selected sold-out variant price without permitting a cart addition", async () => {
  window.history.replaceState(null, "", `/shop/${product.id}?color=Black&size=M`)
  render(
    <ProductDetails
      product={{
        ...product,
        variants: product.variants.map((variant) => (variant.id === 4 ? { ...variant, price: 3100 } : variant)),
      }}
    />
  )
  expect(screen.getByText("$31.00", { exact: true })).toBeInTheDocument()
  expect(screen.queryByText("From", { exact: true })).not.toBeInTheDocument()
  expect(screen.getByRole("button", { name: "This option is unavailable" })).toBeDisabled()
  expect(addItem).not.toHaveBeenCalled()
})

beforeEach(() => {
  addItem.mockReset()
  trackStoreEvent.mockReset().mockReturnValue(true)
  metaTrack.mockReset().mockReturnValue(true)
  pixel.ready = true
  cart.count = 0
  cart.persistenceWarning = false
  addItem.mockImplementation(() => {
    cart.count += 1
    return true
  })
  window.history.replaceState(null, "", `/shop/${product.id}`)
  const replaceState = window.history.replaceState.bind(window.history)
  // Model Next's search-parameter notification around jsdom's real URL/history implementation.
  vi.spyOn(window.history, "replaceState").mockImplementation((...args) => {
    replaceState(...args)
    window.dispatchEvent(new PopStateEvent("popstate"))
  })
})

describe("ProductDetails", () => {
  it.each([
    {
      manufacturer: "Next Level",
      model: "6210",
      categorySlug: "t-shirts",
      categoryName: "T-shirts",
      categorySortPosition: 1,
      gender: "unisex" as const,
      label: "Unisex tee",
    },
    {
      manufacturer: "Next Level",
      model: "5080",
      categorySlug: "crop-tops",
      categoryName: "Crop tops",
      categorySortPosition: 3,
      gender: "female" as const,
      label: "Women's crop top",
    },
    {
      manufacturer: "Independent",
      model: "SS4500",
      categorySlug: "sweatshirts",
      categoryName: "Sweatshirts",
      categorySortPosition: 2,
      gender: "unisex" as const,
      label: "Unisex sweatshirt",
    },
    {
      manufacturer: "Test Maker",
      model: "42",
      categorySlug: "custom-layers",
      categoryName: "Custom layers",
      categorySortPosition: 5,
      gender: null,
      label: "Custom layers",
    },
    {
      manufacturer: "Test Maker",
      model: "H100",
      categorySlug: "hoodies",
      categoryName: "Hoodies",
      categorySortPosition: 5,
      gender: "unisex" as const,
      label: "Unisex Hoodies",
    },
    {
      manufacturer: "Test Maker",
      model: "L200",
      categorySlug: "sweatshirts",
      categoryName: "Warm layers",
      categorySortPosition: 2,
      gender: "female" as const,
      label: "Women's Warm layers",
    },
  ])("uses the configured $model garment rather than guessing from the product title", (garment) => {
    render(<ProductDetails product={{ ...product, title: "A design with no garment in its name", garment }} />)
    expect(screen.getByText(`${garment.manufacturer} ${garment.model}`, { exact: true })).toBeVisible()
    expect(screen.getByText(garment.label, { exact: true })).toBeVisible()
    if (garment.model !== "6210") expect(screen.queryByText("Next Level 6210", { exact: true })).not.toBeInTheDocument()
  })

  it("does not claim a model or fit when garment metadata is missing", () => {
    render(<ProductDetails product={{ ...product, garment: null }} />)
    expect(screen.getByRole("heading", { name: "Small Wins" })).toBeVisible()
    expect(screen.queryByText("Next Level 6210", { exact: true })).not.toBeInTheDocument()
    expect(screen.queryByText("Unisex tee", { exact: true })).not.toBeInTheDocument()
  })

  it("keeps admin previews interactive without analytics or cart mutations", async () => {
    const user = userEvent.setup()
    window.history.replaceState(null, "", `/admin/products/${product.id}`)
    const view = render(
      <StrictMode>
        <ProductDetails product={product} preview />
      </StrictMode>
    )
    await user.click(screen.getByRole("button", { name: "View photo 2 of Small Wins" }))
    expect(screen.getByRole("img", { name: "Black shirt back" })).toBeVisible()
    await user.click(screen.getByRole("button", { name: "Heather Grey" }))
    await user.click(screen.getByRole("button", { name: "M" }))
    expect(screen.getByText("$27.00")).toBeVisible()
    expect(screen.getByRole("img", { name: "Heather Grey shirt front" })).toBeVisible()
    const addButton = screen.getByRole("button", { name: "Add to cart" })
    expect(addButton).toBeDisabled()
    expect(addButton).toHaveAccessibleDescription("Purchasing is disabled in admin preview.")
    await user.click(addButton)
    await user.click(screen.getByRole("button", { name: "Find your fit" }))
    expect(screen.getByText("Size guide")).toHaveFocus()
    expect(screen.getByRole("cell", { name: "20.50" })).toBeVisible()
    view.rerender(
      <StrictMode>
        <ProductDetails product={{ ...product }} preview />
      </StrictMode>
    )
    expect(addItem).not.toHaveBeenCalled()
    expect(trackStoreEvent).not.toHaveBeenCalled()
    expect(metaTrack).not.toHaveBeenCalled()
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(window.location.pathname).toBe(`/admin/products/${product.id}`)
  })

  it("continues to track public views and cart additions with Meta ready", async () => {
    const user = userEvent.setup()
    render(<ProductDetails product={product} />)
    expect(metaTrack).toHaveBeenCalledExactlyOnceWith({ name: "ViewContent", productId: product.id })
    await user.click(screen.getByRole("button", { name: "S" }))
    await user.click(screen.getByRole("button", { name: "Add to cart" }))
    expect(metaTrack).toHaveBeenLastCalledWith({
      name: "AddToCart",
      items: [expect.objectContaining({ productId: product.id, variantId: 1 })],
    })
    expect(addItem).toHaveBeenCalledOnce()
  })

  it("tracks one view through StrictMode, rerenders, and variant selection", async () => {
    const user = userEvent.setup()
    const view = render(
      <StrictMode>
        <ProductDetails product={product} />
      </StrictMode>
    )
    expect(trackStoreEvent).toHaveBeenCalledExactlyOnceWith({ name: "product_viewed", productId: product.id })
    view.rerender(
      <StrictMode>
        <ProductDetails product={{ ...product }} />
      </StrictMode>
    )
    await user.click(screen.getByRole("button", { name: "S" }))
    await user.click(screen.getByRole("button", { name: "Heather Grey" }))
    await user.click(screen.getByRole("button", { name: "M" }))
    expect(trackStoreEvent).toHaveBeenCalledOnce()
  })

  it("tracks a different product and a later visit after unmount", () => {
    const view = render(<ProductDetails product={product} />)
    const nextProduct = { ...product, id: "bbbbbbbbbbbbbbbbbbbbbbbb" }
    view.rerender(<ProductDetails product={nextProduct} />)
    expect(trackStoreEvent).toHaveBeenNthCalledWith(2, { name: "product_viewed", productId: nextProduct.id })
    view.unmount()
    render(<ProductDetails product={product} />)
    expect(trackStoreEvent).toHaveBeenNthCalledWith(3, { name: "product_viewed", productId: product.id })
    expect(trackStoreEvent).toHaveBeenCalledTimes(3)
  })

  it("keeps product selection and cart confirmation working when tracking is unavailable", async () => {
    trackStoreEvent.mockReturnValue(false)
    const user = userEvent.setup()
    render(
      <StrictMode>
        <ProductDetails product={product} />
      </StrictMode>
    )
    await user.click(screen.getByRole("button", { name: "S" }))
    await user.click(screen.getByRole("button", { name: "Add to cart" }))
    expect(await screen.findByRole("dialog", { name: "Added to cart" })).toBeVisible()
    expect(addItem).toHaveBeenCalledOnce()
    expect(trackStoreEvent.mock.calls).toEqual([
      [{ name: "product_viewed", productId: product.id }],
      [{ name: "add_to_cart", productId: product.id }],
    ])
  })

  it("restores the exact linked color, size, price, and mockup", () => {
    window.history.replaceState(null, "", `?color=Heather+Grey&size=M`)
    render(<ProductDetails product={product} />)
    expect(screen.getByRole("button", { name: "Heather Grey" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByRole("button", { name: "M" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByRole("img", { name: "Heather Grey shirt front" })).toBeInTheDocument()
    expect(screen.getByText("$27.00")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Add to cart" })).toBeEnabled()
  })

  it("replaces color and size in the URL, preserves unrelated parameters and hash, and clears incompatible sizes", async () => {
    const user = userEvent.setup()
    window.history.replaceState(null, "", `?campaign=crag#fit`)
    const historyLength = window.history.length
    render(<ProductDetails product={product} />)
    await user.click(screen.getByRole("button", { name: "S" }))
    expect(new URLSearchParams(window.location.search).get("size")).toBe("S")
    await user.click(screen.getByRole("button", { name: "Heather Grey" }))
    expect(new URLSearchParams(window.location.search).has("size")).toBe(false)
    await user.click(screen.getByRole("button", { name: "M" }))
    expect(new URLSearchParams(window.location.search)).toEqual(
      new URLSearchParams({ campaign: "crag", color: "Heather Grey", size: "M" })
    )
    expect(window.location.hash).toBe("#fit")
    expect(window.history.length).toBe(historyLength)
    expect(window.history.replaceState).toHaveBeenLastCalledWith(
      null,
      "",
      `/shop/${product.id}?campaign=crag&color=Heather+Grey&size=M#fit`
    )
  })

  it("canonicalizes missing or invalid selections to the Primary color without inventing a size", async () => {
    window.history.replaceState(null, "", `?color=Invisible&size=Enormous&campaign=crag`)
    render(<ProductDetails product={{ ...product, defaultColor: "Heather Grey" }} />)
    await waitFor(() => {
      expect(window.location.search).toBe("?color=Heather+Grey&campaign=crag")
    })
    expect(screen.getByRole("button", { name: "Heather Grey" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByRole("button", { name: "Choose a size" })).toBeDisabled()
  })

  it("keeps a recognized sold-out size visible with purchasing disabled", () => {
    window.history.replaceState(null, "", "?color=Black&size=M")
    render(<ProductDetails product={product} />)
    expect(screen.getByRole("button", { name: "M" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByRole("button", { name: "This option is unavailable" })).toBeDisabled()
  })

  it("drops a size that does not exist for the linked color", async () => {
    window.history.replaceState(null, "", "?color=Heather+Grey&size=2XL")
    render(<ProductDetails product={product} />)
    await waitFor(() => expect(window.location.search).toBe("?color=Heather+Grey"))
    expect(screen.getByRole("button", { name: "Choose a size" })).toBeDisabled()
  })

  it("follows restored URL selections without overwriting them from stale local state", async () => {
    render(<ProductDetails product={product} />)
    await act(async () => {
      window.history.replaceState(null, "", "?color=Heather+Grey&size=M")
    })
    expect(screen.getByRole("button", { name: "Heather Grey" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByRole("button", { name: "M" })).toHaveAttribute("aria-pressed", "true")
    expect(window.location.search).toBe("?color=Heather+Grey&size=M")
  })

  it("keeps the Primary color first even when a different linked color is selected", async () => {
    const user = userEvent.setup()
    window.history.replaceState(null, "", "?color=Black")
    render(<ProductDetails product={{ ...product, defaultColor: "Heather Grey" }} />)
    const colors = screen.getByRole("group", { name: "Color Black" })
    expect(
      within(colors)
        .getAllByRole("button")
        .map((button) => button.getAttribute("aria-label"))
    ).toEqual(["Heather Grey", "Black"])
    await user.click(screen.getByRole("button", { name: "Heather Grey" }))
    expect(within(colors).getAllByRole("button")[0]).toHaveAttribute("aria-label", "Heather Grey")
  })

  it("requires a size, sorts sizes naturally, excludes out-of-stock combinations, and adds the exact selected variant and price", async () => {
    const user = userEvent.setup()
    render(<ProductDetails product={product} />)
    expect(screen.getByRole("button", { name: "Choose a size" })).toBeDisabled()
    const options = screen.getByRole("group", { name: "Size" })
    expect(
      within(options)
        .getAllByRole("button")
        .slice(0, 3)
        .map((button) => button.textContent)
    ).toEqual(["S", "M", "2XL"])
    expect(screen.getByRole("button", { name: "M" })).toBeDisabled()
    await user.click(screen.getByRole("button", { name: "2XL" }))
    expect(screen.getByText("$28.00")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Add to cart" }))
    expect(addItem).toHaveBeenCalledExactlyOnceWith({
      productId: product.id,
      variantId: 2,
      title: "Small Wins",
      variantTitle: "Black / 2XL",
      image: product.images[0]!.src,
      unitAmount: 2800,
      quantity: 1,
    })
    const confirmation = within(await screen.findByRole("dialog", { name: "Added to cart" }))
    expect(confirmation.getByText("Small Wins", { exact: true })).toBeInTheDocument()
    expect(confirmation.getByText("Black / 2XL", { exact: true })).toBeInTheDocument()
    expect(confirmation.getByText("Quantity: 1", { exact: true })).toBeInTheDocument()
    expect(confirmation.getByText("$28.00", { exact: true })).toBeInTheDocument()
    expect(confirmation.getByAltText("")).toHaveAttribute("src", product.images[0]!.src)
    expect(confirmation.getByRole("link", { name: "View cart (1)" })).toHaveAttribute("href", "/cart")
  })

  it("reopens with the newly added variant and keeps the cart count current", async () => {
    const user = userEvent.setup()
    const { rerender } = render(<ProductDetails product={product} />)
    await user.click(screen.getByRole("button", { name: "S" }))
    await user.click(screen.getByRole("button", { name: "Add to cart" }))
    const firstConfirmation = within(await screen.findByRole("dialog", { name: "Added to cart" }))
    expect(firstConfirmation.getByText("Black / S", { exact: true })).toBeInTheDocument()
    expect(firstConfirmation.getByRole("link", { name: "View cart (1)" })).toBeInTheDocument()
    await user.click(firstConfirmation.getByRole("button", { name: "Continue shopping" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    expect(screen.getByRole("button", { name: "Add to cart" })).toBeEnabled()
    expect(screen.queryByText("Small Wins added to your cart.")).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Heather Grey" }))
    await user.click(screen.getByRole("button", { name: "M" }))
    await user.click(screen.getByRole("button", { name: "Add to cart" }))
    const secondConfirmation = within(await screen.findByRole("dialog", { name: "Added to cart" }))
    expect(secondConfirmation.getByText("Heather Grey / M", { exact: true })).toBeInTheDocument()
    expect(secondConfirmation.queryByText("Black / S", { exact: true })).not.toBeInTheDocument()
    expect(secondConfirmation.getByText("$27.00", { exact: true })).toBeInTheDocument()
    expect(secondConfirmation.getByAltText("")).toHaveAttribute("src", product.images[2]!.src)
    expect(secondConfirmation.getByRole("link", { name: "View cart (2)" })).toBeInTheDocument()
    expect(addItem).toHaveBeenCalledTimes(2)
    expect(trackStoreEvent.mock.calls).toEqual([
      [{ name: "product_viewed", productId: product.id }],
      [{ name: "add_to_cart", productId: product.id }],
      [{ name: "add_to_cart", productId: product.id }],
    ])

    cart.count = 7
    rerender(<ProductDetails product={product} />)
    expect(secondConfirmation.getByRole("link", { name: "View cart (7)" })).toBeInTheDocument()
  })

  it("starts on the Primary mockup color even when it is not the first available variant", () => {
    render(<ProductDetails product={{ ...product, defaultColor: "Heather Grey", image: product.images[2]! }} />)
    expect(screen.getByRole("button", { name: "Heather Grey" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByRole("img", { name: "Heather Grey shirt front" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "M" })).toBeEnabled()
  })

  it("updates the initial color and photo together when a new published Primary arrives", () => {
    const { rerender } = render(<ProductDetails product={{ ...product, defaultColor: "Black" }} />)
    expect(screen.getByRole("button", { name: "Black" })).toHaveAttribute("aria-pressed", "true")
    rerender(<ProductDetails product={{ ...product, defaultColor: "Heather Grey", image: product.images[2]! }} />)
    expect(screen.getByRole("button", { name: "Heather Grey" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByRole("img", { name: "Heather Grey shirt front" })).toBeInTheDocument()
  })

  it("keeps the sold-out Primary color pictured and selected until the shopper chooses another color", async () => {
    const user = userEvent.setup()
    render(
      <ProductDetails
        product={{
          ...product,
          defaultColor: "Heather Grey",
          image: product.images[2]!,
          variants: product.variants.map((variant) => ({
            ...variant,
            available: variant.color === "Black" && variant.available,
          })),
        }}
      />
    )
    expect(screen.getByRole("button", { name: "Heather Grey" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByRole("button", { name: "Heather Grey" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "This color is unavailable" })).toBeDisabled()
    expect(screen.getByRole("img", { name: "Heather Grey shirt front" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "S" })).toBeDisabled()
    await user.click(screen.getByRole("button", { name: "Black" }))
    expect(screen.getByRole("img", { name: "Black shirt front" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "S" })).toBeEnabled()
  })

  it("switches to matching-color images and clears an unavailable size on color change", async () => {
    const user = userEvent.setup()
    render(<ProductDetails product={product} />)
    await user.click(screen.getByRole("button", { name: "View photo 2 of Small Wins" }))
    expect(screen.getByRole("img", { name: "Black shirt back" })).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "S" }))
    await user.click(screen.getByRole("button", { name: "Heather Grey" }))
    expect(screen.getByRole("img", { name: "Heather Grey shirt front" })).toBeInTheDocument()
    expect(screen.queryByRole("img", { name: "Black shirt back" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Choose a size" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "S" })).toBeDisabled()
    await user.click(screen.getByRole("button", { name: "M" }))
    expect(screen.getByText("$27.00")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Add to cart" }))
    expect(addItem).toHaveBeenCalledWith(
      expect.objectContaining({ variantId: 3, variantTitle: "Heather Grey / M", unitAmount: 2700 })
    )
  })

  it("never substitutes a different garment color when a matching mockup is missing", async () => {
    const user = userEvent.setup()
    render(<ProductDetails product={{ ...product, images: product.images.slice(0, 2) }} />)
    await user.click(screen.getByRole("button", { name: "Heather Grey" }))
    expect(screen.getByText("No photo for this color yet")).toBeInTheDocument()
    expect(screen.queryByRole("img")).not.toBeInTheDocument()
  })

  it.each([false, true])(
    "matches camera views across reordered colors and cart photos (artwork: %s)",
    async (viewArtwork) => {
      const user = userEvent.setup()
      const greyBack = {
        src: "https://images.printify.com/grey-back.jpg",
        alt: "Heather Grey shirt back",
        variantIds: [3],
        viewKey: "back",
      }
      render(
        <ProductDetails
          product={{
            ...product,
            artwork,
            images: [
              { ...product.images[0]!, viewKey: "front" },
              { ...product.images[1]!, viewKey: "back" },
              greyBack,
              { ...product.images[2]!, viewKey: "front" },
            ],
          }}
        />
      )
      await user.click(screen.getByRole("button", { name: "View photo 2 of Small Wins" }))
      if (viewArtwork) await user.click(screen.getByRole("button", { name: "View artwork of Small Wins" }))
      await user.click(screen.getByRole("button", { name: "Heather Grey" }))
      expect(
        screen.getByRole("button", { name: viewArtwork ? "View artwork of Small Wins" : "View photo 1 of Small Wins" })
      ).toHaveAttribute("aria-pressed", "true")
      expect(screen.getByRole("img", { name: viewArtwork ? "Small Wins artwork" : greyBack.alt })).toBeInTheDocument()
      await user.click(screen.getByRole("button", { name: "M" }))
      await user.click(screen.getByRole("button", { name: "Add to cart" }))
      expect(addItem).toHaveBeenCalledWith(expect.objectContaining({ image: greyBack.src, variantId: 3 }))
      await user.click(screen.getByRole("button", { name: "Continue shopping" }))
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
      await user.click(screen.getByRole("button", { name: "Black" }))
      expect(
        screen.getByRole("button", { name: viewArtwork ? "View artwork of Small Wins" : "View photo 2 of Small Wins" })
      ).toHaveAttribute("aria-pressed", "true")
    }
  )

  it("preserves the photo position when provider images lack camera metadata, including URL color changes", async () => {
    const user = userEvent.setup()
    const greyBack = {
      src: "https://images.printify.com/grey-back.jpg",
      alt: "Heather Grey shirt back",
      variantIds: [3],
    }
    render(<ProductDetails product={{ ...product, images: [...product.images, greyBack] }} />)
    await user.click(screen.getByRole("button", { name: "View photo 2 of Small Wins" }))
    act(() => window.history.replaceState(null, "", "?color=Heather+Grey&size=M"))
    expect(screen.getByRole("button", { name: "View photo 2 of Small Wins" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByRole("img", { name: greyBack.alt })).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Add to cart" }))
    expect(addItem).toHaveBeenCalledWith(expect.objectContaining({ image: greyBack.src }))
  })

  it("matches the initial view when another color puts that camera after its first photo", async () => {
    const user = userEvent.setup()
    render(
      <ProductDetails
        product={{
          ...product,
          images: [
            { ...product.images[0]!, viewKey: "front" },
            { ...product.images[1]!, viewKey: "back" },
            {
              src: "https://images.printify.com/grey-back.jpg",
              alt: "Heather Grey shirt back",
              variantIds: [3],
              viewKey: "back",
            },
            { ...product.images[2]!, viewKey: "front" },
          ],
        }}
      />
    )
    await user.click(screen.getByRole("button", { name: "Heather Grey" }))
    expect(screen.getByRole("button", { name: "View photo 2 of Small Wins" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByRole("img", { name: "Heather Grey shirt front" })).toBeInTheDocument()
  })

  it("falls back to a new-color photo when the selected camera view is missing instead of choosing artwork", async () => {
    const user = userEvent.setup()
    render(
      <ProductDetails
        product={{
          ...product,
          artwork,
          images: product.images.map((image, index) => ({ ...image, viewKey: index === 1 ? "back" : "front" })),
        }}
      />
    )
    await user.click(screen.getByRole("button", { name: "View photo 2 of Small Wins" }))
    await user.click(screen.getByRole("button", { name: "Heather Grey" }))
    expect(screen.getByRole("button", { name: "View photo 1 of Small Wins" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByRole("img", { name: "Heather Grey shirt front" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "View artwork of Small Wins" })).toHaveAttribute("aria-pressed", "false")
    // An explicit click on the fallback replaces the unavailable view preference, even without scrolling.
    await user.click(screen.getByRole("button", { name: "View photo 1 of Small Wins" }))
    await user.click(screen.getByRole("button", { name: "Black" }))
    expect(screen.getByRole("button", { name: "View photo 1 of Small Wins" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByRole("img", { name: "Black shirt front" })).toBeInTheDocument()
  })

  it("resets the view for a different product", async () => {
    const user = userEvent.setup()
    const { rerender } = render(<ProductDetails product={product} />)
    await user.click(screen.getByRole("button", { name: "View photo 2 of Small Wins" }))
    rerender(<ProductDetails product={{ ...product, id: "different-product" }} />)
    expect(screen.getByRole("button", { name: "View photo 1 of Small Wins" })).toHaveAttribute("aria-pressed", "true")
  })

  it("keeps keyboard and arrow navigation synchronized with the selected thumbnail", async () => {
    const user = userEvent.setup()
    render(<ProductDetails product={{ ...product, artwork }} />)
    const gallery = screen.getByRole("region", { name: "Small Wins photos" })
    gallery.focus()
    await user.keyboard("{ArrowRight}")
    expect(screen.getByRole("button", { name: "View photo 2 of Small Wins" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByRole("img", { name: "Black shirt back" })).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Next slide" }))
    expect(screen.getByRole("button", { name: "View artwork of Small Wins" })).toHaveAttribute("aria-pressed", "true")
    await user.click(screen.getByRole("button", { name: "Previous slide" }))
    expect(screen.getByRole("button", { name: "View photo 2 of Small Wins" })).toHaveAttribute("aria-pressed", "true")
    await user.click(screen.getByRole("button", { name: "Heather Grey" }))
    expect(screen.getByRole("button", { name: "View photo 1 of Small Wins" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByRole("img", { name: "Heather Grey shirt front" })).toBeInTheDocument()
  })

  it.each([false, true])(
    "keeps the gallery and cart photo when reselecting the active color (artwork: %s)",
    async (viewArtwork) => {
      const user = userEvent.setup()
      render(<ProductDetails product={{ ...product, artwork }} />)
      await user.click(screen.getByRole("button", { name: "View photo 2 of Small Wins" }))
      if (viewArtwork) await user.click(screen.getByRole("button", { name: "View artwork of Small Wins" }))
      await user.click(screen.getByRole("button", { name: "Black" }))
      expect(
        screen.getByRole("button", { name: viewArtwork ? "View artwork of Small Wins" : "View photo 2 of Small Wins" })
      ).toHaveAttribute("aria-pressed", "true")
      expect(
        screen.getByRole("img", { name: viewArtwork ? "Small Wins artwork" : "Black shirt back" })
      ).toBeInTheDocument()
      await user.click(screen.getByRole("button", { name: "S" }))
      await user.click(screen.getByRole("button", { name: "Add to cart" }))
      expect(addItem).toHaveBeenCalledWith(expect.objectContaining({ image: product.images[1]!.src }))
    }
  )

  it("pins one New badge to the gallery frame so it stays put while the shopper moves between slides", async () => {
    const user = userEvent.setup()
    const { rerender } = render(<ProductDetails product={{ ...product, artwork }} isNew />)
    const gallery = screen.getByRole("region", { name: "Small Wins photos" })
    expect(screen.getAllByText("New")).toHaveLength(1)
    const badge = screen.getByText("New")
    expect(gallery).toContainElement(badge)
    // On a slide, it would be hidden along with the first photo as soon as the shopper moved on.
    expect(badge.closest('[aria-roledescription="slide"]')).toBeNull()

    await user.click(screen.getByRole("button", { name: "Next slide" }))
    expect(screen.getByRole("button", { name: "View photo 2 of Small Wins" })).toHaveAttribute("aria-pressed", "true")
    await user.click(screen.getByRole("button", { name: "View artwork of Small Wins" }))
    expect(screen.getAllByText("New")).toHaveLength(1)
    expect(screen.getByText("New")).toBeVisible()
    expect(screen.getByText("New").closest('[aria-hidden="true"]')).toBeNull()

    // getCatalogProduct decides what is new; the details never judge the date themselves.
    rerender(<ProductDetails product={{ ...product, artwork, addedToShopAt: new Date().toISOString() }} />)
    expect(screen.queryByText("New")).not.toBeInTheDocument()
  })

  it("appends artwork after the garment photos and retains the garment photo when adding to cart", async () => {
    const user = userEvent.setup()
    render(<ProductDetails product={{ ...product, artwork }} />)
    const photos = screen.getByRole("region", { name: "Small Wins photos" })
    const thumbnails = within(photos).getAllByRole("button", { name: /^View (?:photo|artwork)/ })
    expect(thumbnails.map((button) => button.getAttribute("aria-label"))).toEqual([
      "View photo 1 of Small Wins",
      "View photo 2 of Small Wins",
      "View artwork of Small Wins",
    ])
    await user.click(thumbnails[1]!)
    await user.tab()
    expect(thumbnails[2]).toHaveFocus()
    await user.keyboard("{Enter}")
    expect(screen.getByRole("img", { name: "Small Wins artwork" }).parentElement).toHaveStyle({
      backgroundColor: "#222222",
    })
    expect(thumbnails[2]).toHaveAttribute("aria-pressed", "true")
    expect(thumbnails[1]).toHaveAttribute("aria-pressed", "false")
    await user.click(screen.getByRole("button", { name: "S" }))
    await user.click(screen.getByRole("button", { name: "Add to cart" }))
    expect(addItem).toHaveBeenCalledWith(expect.objectContaining({ image: product.images[1]!.src }))
    await user.click(screen.getByRole("button", { name: "Continue shopping" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    await user.click(thumbnails[0]!)
    expect(screen.getByRole("img", { name: "Black shirt front" })).toBeInTheDocument()
    expect(screen.queryByRole("img", { name: "Small Wins artwork" })).not.toBeInTheDocument()
  })

  it("keeps artwork selected with its new color even when the number of garment photos changes", async () => {
    const user = userEvent.setup()
    render(<ProductDetails product={{ ...product, artwork }} />)
    await user.click(screen.getByRole("button", { name: "View artwork of Small Wins" }))
    await user.click(screen.getByRole("button", { name: "Heather Grey" }))
    const artworkButton = screen.getByRole("button", { name: "View artwork of Small Wins" })
    expect(artworkButton).toHaveAttribute("aria-pressed", "true")
    expect(artworkButton.firstElementChild).toHaveStyle({ backgroundColor: "#aaaaaa" })
    expect(screen.getByRole("img", { name: "Small Wins artwork" }).parentElement).toHaveStyle({
      backgroundColor: "#aaaaaa",
    })
    expect(screen.getByText("Image 2 of 2")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Black" }))
    expect(screen.getByRole("button", { name: "View artwork of Small Wins" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByText("Image 3 of 3")).toBeInTheDocument()
  })

  it.each([null, "unknown", "#abcdef80"])(
    "does not guess an artwork background when the selected color hex is %s",
    (hex) => {
      render(
        <ProductDetails product={{ ...product, artwork, colors: product.colors.map((color) => ({ ...color, hex })) }} />
      )
      expect(screen.queryByRole("button", { name: "View artwork of Small Wins" })).not.toBeInTheDocument()
      expect(screen.getByRole("img", { name: "Black shirt front" })).toBeInTheDocument()
    }
  )

  it("offers the artwork even when the selected color has no garment photo", async () => {
    const user = userEvent.setup()
    render(<ProductDetails product={{ ...product, artwork, images: [] }} />)
    expect(screen.getByText("No photo for this color yet")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "View artwork of Small Wins" }))
    expect(screen.getByRole("img", { name: "Small Wins artwork" })).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "S" }))
    await user.click(screen.getByRole("button", { name: "Add to cart" }))
    expect(addItem).toHaveBeenCalledWith(expect.objectContaining({ image: undefined }))
  })

  it("opens and focuses the size guide from Find your fit and exposes measurement headers", async () => {
    const user = userEvent.setup()
    render(<ProductDetails product={product} />)
    const summary = screen.getByText("Size guide")
    expect(summary.closest("details")).not.toHaveAttribute("open")
    await user.click(screen.getByRole("button", { name: "Find your fit" }))
    expect(summary.closest("details")).toHaveAttribute("open")
    expect(summary).toHaveFocus()
    expect(screen.getByRole("columnheader", { name: "M" })).toBeInTheDocument()
    expect(screen.getByRole("rowheader", { name: "Width, in" })).toBeInTheDocument()
    expect(screen.getByRole("cell", { name: "20.50" })).toBeInTheDocument()
  })

  it("shows only the garment paragraph and fabric bullets under The garment", async () => {
    const user = userEvent.setup()
    const parsed = readProductDescription(
      '<p>A hermit crab has moved into a chalk bucket.</p><p><strong>The tee</strong></p><p>Printed on the Next Level 6210.</p><ul><li><p>60% cotton, 40% polyester</p></li><li><p>Tear-away label</p></li></ul><p><strong>Care</strong></p><p>Skip the bleach and dry cleaning.</p><table id="size-guide"><tr><th></th><th>M</th></tr><tr><td>Width, in</td><td>20.50</td></tr></table>'
    )
    const { container } = render(<ProductDetails product={{ ...product, ...parsed }} />)
    expect(container.querySelector(".product-story")).toHaveTextContent(
      /^A hermit crab has moved into a chalk bucket\.$/
    )
    expect(screen.queryByText("The garment & the details")).not.toBeInTheDocument()
    const summary = screen.getByText("The garment", { selector: "summary" })
    await user.click(summary)
    const section = within(summary.closest("details")!)
    expect(section.getByText("Printed on the Next Level 6210.")).toBeVisible()
    expect(section.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "60% cotton, 40% polyester",
      "Tear-away label",
    ])
    for (const repeated of ["The tee", "A hermit crab has moved into a chalk bucket.", "Care"])
      expect(section.queryByText(repeated)).not.toBeInTheDocument()
    expect(screen.queryByText("Skip the bleach and dry cleaning.")).not.toBeInTheDocument()
    expect(screen.getByText("Shipping & care")).toBeInTheDocument()
  })

  it("leaves The garment out when a description has no garment section", () => {
    const parsed = readProductDescription("<p>A hermit crab has moved into a chalk bucket.</p>")
    render(<ProductDetails product={{ ...product, ...parsed }} />)
    expect(screen.queryByText("The garment", { selector: "summary" })).not.toBeInTheDocument()
    expect(screen.getAllByText("A hermit crab has moved into a chalk bucket.")).toHaveLength(1)
    expect(screen.getByText("Size guide")).toBeInTheDocument()
  })

  it("renders every marked-chart column, including repeated sizes and blank measurements", async () => {
    const user = userEvent.setup()
    const parsed = readProductDescription(
      '<table id="size-guide"><tr><th></th><th>S</th><th>S</th></tr><tr><td>Width, in</td><td>19.00</td><td>&nbsp;</td></tr></table><p>Good company.</p>'
    )
    const { container } = render(<ProductDetails product={{ ...product, ...parsed }} />)
    expect(container.querySelector(".product-story")).toHaveTextContent(/^Good company\.$/)
    await user.click(screen.getByRole("button", { name: "Find your fit" }))
    const table = within(screen.getByRole("table"))
    expect(table.getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["Measurement", "S", "S"])
    expect(table.getAllByRole("cell").map((cell) => cell.textContent)).toEqual(["19.00", ""])
  })

  it("reports a full cart without claiming an item was added", async () => {
    const user = userEvent.setup()
    addItem.mockReturnValue(false)
    render(<ProductDetails product={product} />)
    await user.click(screen.getByRole("button", { name: "S" }))
    await user.click(screen.getByRole("button", { name: "Add to cart" }))
    expect(screen.getByRole("status")).toHaveTextContent("Your cart is full for this item.")
    expect(screen.getByRole("link", { name: "View cart" })).toHaveAttribute("href", "/cart")
    expect(screen.queryByRole("dialog", { name: "Added to cart" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Add to cart" })).toBeEnabled()
    expect(trackStoreEvent).toHaveBeenCalledExactlyOnceWith({ name: "product_viewed", productId: product.id })
  })

  it("does not reuse a successful confirmation when a later addition fails", async () => {
    const user = userEvent.setup()
    render(<ProductDetails product={product} />)
    await user.click(screen.getByRole("button", { name: "S" }))
    await user.click(screen.getByRole("button", { name: "Add to cart" }))
    await user.click(screen.getByRole("button", { name: "Continue shopping" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    addItem.mockReturnValue(false)
    await user.click(screen.getByRole("button", { name: "Add to cart" }))
    expect(screen.getByRole("status")).toHaveTextContent("Your cart is full for this item.")
    expect(screen.queryByRole("dialog", { name: "Added to cart" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Add to cart" })).toBeEnabled()
    expect(trackStoreEvent.mock.calls).toEqual([
      [{ name: "product_viewed", productId: product.id }],
      [{ name: "add_to_cart", productId: product.id }],
    ])
  })

  it.each(["Size tolerance, in", "Size tolerance, cm", "SIZE TOLERANCE, IN"])(
    "omits %s from the size guide while retaining garment measurements",
    async (label) => {
      const user = userEvent.setup()
      render(
        <ProductDetails
          product={{
            ...product,
            sizeGuide: {
              sizes: ["S", "M", "2XL"],
              measurements: [
                { label: "Width, in", values: ["19.00", "20.50", "26.00"] },
                { label, values: ["1.00", "1.00", "1.00"] },
                { label: "Length, in", values: ["27.00", "28.00", "32.00"] },
              ],
            },
          }}
        />
      )
      await user.click(screen.getByRole("button", { name: "Find your fit" }))
      expect(screen.queryByText(/size\s+tolerance/i)).not.toBeInTheDocument()
      expect(screen.getByRole("rowheader", { name: "Width, in" })).toBeInTheDocument()
      expect(screen.getByRole("rowheader", { name: "Length, in" })).toBeInTheDocument()
      expect(screen.getByRole("cell", { name: "20.50" })).toBeInTheDocument()
    }
  )

  it("does not offer purchase or a price when every variant is unavailable", () => {
    render(
      <ProductDetails
        product={{
          ...product,
          availability: "unavailable",
          price: null,
          variants: product.variants.map((variant) => ({ ...variant, available: false })),
        }}
      />
    )
    expect(screen.getByRole("button", { name: "Currently unavailable" })).toBeDisabled()
    expect(screen.queryByText(/^\$\d/)).not.toBeInTheDocument()
    expect(addItem).not.toHaveBeenCalled()
  })
})

it("does not advertise placeholder zero shipping or draft delivery estimates", () => {
  const original = storeConfig.commerce.shippingConfirmed
  storeConfig.commerce.shippingConfirmed = false
  try {
    render(<ProductDetails product={product} />)
    expect(screen.getByText(/Shipping rates and delivery estimates are being confirmed/)).toBeInTheDocument()
    expect(screen.queryByText(/\$0\.00 for the first shirt/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Estimated delivery, including printing/)).not.toBeInTheDocument()
  } finally {
    storeConfig.commerce.shippingConfirmed = original
  }
})
