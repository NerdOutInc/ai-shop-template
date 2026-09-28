import { fireEvent, render, screen } from "@testing-library/react"
import type { ComponentProps } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { CatalogProduct } from "./catalog-product"
import { ProductCard } from "./product-card"

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }))
vi.mock("next/link", () => ({
  default: ({ onClick, children, ...props }: ComponentProps<"a">) => (
    <a
      {...props}
      onClick={(event) => {
        onClick?.(event)
        if (!event.defaultPrevented) navigate(props.href)
        event.preventDefault()
      }}
    >
      {children}
    </a>
  ),
}))

const product: CatalogProduct = {
  id: "touch-preview",
  title: "Touch preview shirt",
  description: "A shirt for a touch of climbing.",
  addedToShopAt: null,
  salesCount: null,
  image: { src: "/shirt.jpg", alt: "Shirt mockup" },
  artwork: { src: "/artwork.webp", alt: "Shirt artwork", backgroundColor: "#222222" },
  images: [],
  price: { currency: "USD", min: 2500, max: 2500 },
  options: [],
  variants: [],
  colors: [],
  sizeGuide: null,
  availability: "available",
}

function pointerEvent(target: Element, type: string, overrides: PointerEventInit = {}) {
  const { pointerId = 1, pointerType = "touch", isPrimary = true, ...mouseOptions } = overrides
  // jsdom does not consistently expose PointerEvent; React reads these same native event fields.
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: 100,
    clientY: 100,
    button: 0,
    ...mouseOptions,
  })
  Object.assign(event, { pointerId, pointerType, isPrimary })
  fireEvent(target, event)
  return event
}

function touchClick(target: Element) {
  pointerEvent(target, "click", { detail: 1 })
}

function renderCard(overrides: Partial<CatalogProduct> = {}) {
  render(<ProductCard product={{ ...product, ...overrides }} />)
  return {
    link: screen.getByRole("link", { name: product.title }),
    mockup: screen.getByRole("img", { name: "Shirt mockup" }),
  }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe("ProductCardLink touch artwork preview", () => {
  it("shows artwork as soon as a finger touches the image and keeps a quick tap navigable", () => {
    const { link, mockup } = renderCard()

    pointerEvent(mockup, "pointerdown")
    expect(link).toHaveAttribute("data-touch-preview", "true")
    vi.advanceTimersByTime(100)
    pointerEvent(mockup, "pointermove", { clientX: 103, clientY: 104 })
    pointerEvent(mockup, "pointerup", { clientX: 103, clientY: 104 })
    touchClick(mockup)

    expect(navigate).toHaveBeenCalledExactlyOnceWith("/shop/touch-preview")
  })

  it("keeps a held preview open without navigating and lets the next deliberate tap open the product", () => {
    const { link, mockup } = renderCard()

    pointerEvent(mockup, "pointerdown")
    vi.advanceTimersByTime(600)
    pointerEvent(mockup, "pointerup")
    touchClick(mockup)

    expect(navigate).not.toHaveBeenCalled()
    expect(link).toHaveAttribute("data-touch-preview", "true")

    pointerEvent(mockup, "pointerdown")
    vi.advanceTimersByTime(80)
    pointerEvent(mockup, "pointerup")
    touchClick(mockup)

    expect(navigate).toHaveBeenCalledExactlyOnceWith("/shop/touch-preview")
  })

  it("cancels navigation after a finger moves away even when it returns before release", () => {
    const { link, mockup } = renderCard()

    pointerEvent(mockup, "pointerdown")
    pointerEvent(mockup, "pointermove", { clientY: 160 })
    pointerEvent(mockup, "pointermove", { clientY: 100 })
    pointerEvent(mockup, "pointerup")
    touchClick(mockup)

    expect(navigate).not.toHaveBeenCalled()
    expect(link).toHaveAttribute("data-touch-preview", "true")
  })

  it("cancels navigation when the page scrolls during a press without another pointer move", () => {
    const { link, mockup } = renderCard()

    pointerEvent(mockup, "pointerdown")
    fireEvent.scroll(document)
    pointerEvent(mockup, "pointerup")
    touchClick(mockup)

    expect(navigate).not.toHaveBeenCalled()
    expect(link).toHaveAttribute("data-touch-preview", "true")
  })

  it("does not navigate when a second finger joins the gesture outside the product", () => {
    const { link, mockup } = renderCard()

    pointerEvent(mockup, "pointerdown")
    pointerEvent(document.body, "pointerdown", { pointerId: 2, isPrimary: false })
    pointerEvent(document.body, "pointerup", { pointerId: 2, isPrimary: false })
    pointerEvent(mockup, "pointerup")
    touchClick(mockup)

    expect(navigate).not.toHaveBeenCalled()
    expect(link).toHaveAttribute("data-touch-preview", "true")
  })

  it("retains a canceled scroll preview, ignores later scrolling elsewhere, and closes on an outside tap", () => {
    render(
      <>
        <ProductCard product={product} />
        <button type="button">Continue browsing</button>
      </>
    )
    const link = screen.getByRole("link", { name: product.title })
    const mockup = screen.getByRole("img", { name: "Shirt mockup" })
    const outside = screen.getByRole("button", { name: "Continue browsing" })

    pointerEvent(mockup, "pointerdown")
    pointerEvent(mockup, "pointercancel")
    touchClick(mockup)
    expect(navigate).not.toHaveBeenCalled()

    pointerEvent(outside, "pointerdown", { pointerId: 2 })
    pointerEvent(outside, "pointermove", { pointerId: 2, clientY: 180 })
    pointerEvent(outside, "pointercancel", { pointerId: 2 })
    fireEvent.scroll(window)
    touchClick(outside)
    expect(link).toHaveAttribute("data-touch-preview", "true")

    pointerEvent(outside, "pointerdown", { pointerId: 3 })
    pointerEvent(outside, "pointerup", { pointerId: 3 })
    touchClick(outside)
    expect(link).not.toHaveAttribute("data-touch-preview", "true")
  })

  it("dismisses on a plain-text tap without a compatibility click, but keeps the preview after an outside drag", () => {
    render(
      <>
        <ProductCard product={product} />
        <p>Good company, questionable footwork.</p>
      </>
    )
    const link = screen.getByRole("link", { name: product.title })
    const mockup = screen.getByRole("img", { name: "Shirt mockup" })
    const outside = screen.getByText("Good company, questionable footwork.")

    pointerEvent(mockup, "pointerdown")
    pointerEvent(mockup, "pointercancel")

    pointerEvent(outside, "pointerdown", { pointerId: 2 })
    pointerEvent(outside, "pointermove", { pointerId: 2, clientY: 180 })
    pointerEvent(outside, "pointermove", { pointerId: 2, clientY: 100 })
    pointerEvent(outside, "pointerup", { pointerId: 2 })
    expect(link).toHaveAttribute("data-touch-preview", "true")

    pointerEvent(outside, "pointerdown", { pointerId: 3 })
    vi.advanceTimersByTime(80)
    pointerEvent(outside, "pointerup", { pointerId: 3 })
    expect(link).not.toHaveAttribute("data-touch-preview", "true")
    expect(navigate).not.toHaveBeenCalled()
  })

  it("removes the active preview when approved artwork is no longer available", () => {
    const { rerender } = render(<ProductCard product={product} />)
    const link = screen.getByRole("link", { name: product.title })
    const mockup = screen.getByRole("img", { name: "Shirt mockup" })

    pointerEvent(mockup, "pointerdown")
    pointerEvent(mockup, "pointercancel")
    expect(link).toHaveAttribute("data-touch-preview", "true")

    rerender(<ProductCard product={{ ...product, artwork: undefined }} />)

    expect(link).not.toHaveAttribute("data-touch-preview")
    expect(screen.queryByRole("img", { name: "Shirt artwork" })).not.toBeInTheDocument()
  })

  it("does not turn a touch on the title into an artwork hold", () => {
    const { link } = renderCard()
    const title = screen.getByRole("heading", { name: product.title })

    pointerEvent(title, "pointerdown")
    vi.advanceTimersByTime(600)
    pointerEvent(title, "pointerup")
    touchClick(title)

    expect(link).not.toHaveAttribute("data-touch-preview", "true")
    expect(navigate).toHaveBeenCalledExactlyOnceWith("/shop/touch-preview")
  })

  it("preserves keyboard and mouse navigation after a canceled touch gesture", () => {
    const { link, mockup } = renderCard()

    pointerEvent(mockup, "pointerdown")
    pointerEvent(mockup, "pointercancel")
    fireEvent.click(link, { detail: 0 })
    expect(navigate).toHaveBeenCalledTimes(1)

    pointerEvent(mockup, "pointerdown", { pointerType: "mouse" })
    pointerEvent(mockup, "pointerup", { pointerType: "mouse" })
    pointerEvent(mockup, "click", { pointerType: "mouse", detail: 1 })
    expect(navigate).toHaveBeenCalledTimes(2)
  })

  it("suppresses the artwork touch callout and preserves the desktop context menu", () => {
    const { mockup } = renderCard()

    pointerEvent(mockup, "pointerdown")
    expect(pointerEvent(mockup, "contextmenu")).toHaveProperty("defaultPrevented", true)
    pointerEvent(mockup, "pointercancel")

    pointerEvent(mockup, "pointerdown", { pointerType: "mouse", button: 2 })
    expect(pointerEvent(mockup, "contextmenu", { pointerType: "mouse", button: 2 })).toHaveProperty(
      "defaultPrevented",
      false
    )
  })

  it("leaves images without approved artwork as ordinary links", () => {
    const { link, mockup } = renderCard({ artwork: undefined })

    pointerEvent(mockup, "pointerdown")
    vi.advanceTimersByTime(600)
    expect(pointerEvent(mockup, "contextmenu")).toHaveProperty("defaultPrevented", false)
    pointerEvent(mockup, "pointerup")
    touchClick(mockup)

    expect(link).not.toHaveAttribute("data-touch-preview", "true")
    expect(navigate).toHaveBeenCalledExactlyOnceWith("/shop/touch-preview")
  })
})
