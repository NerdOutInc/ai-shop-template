import "../../../test/configured-store"
import { act, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { StrictMode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { storeConfig } from "@/lib/store-config"

import { trackStoreEvent } from "@/features/analytics/track-store-event"

import { CartContext } from "./cart-context"
import { CartProvider } from "./cart-provider"
import { MetaCartReview } from "./meta-cart-review"
import { useCart } from "./use-cart"

vi.mock("@/features/analytics/track-store-event", () => ({ trackStoreEvent: vi.fn() }))
const key = "a".repeat(32)
const storageKey = "your-store-cart-v1"
const item = {
  productId: "aaaaaaaaaaaaaaaaaaaaaaaa",
  variantId: 1001,
  title: "Sample first design – Black / M",
  variantTitle: "Black / M",
  unitAmount: 2800,
  quantity: 2,
}
function review() {
  return render(
    <StrictMode>
      <CartProvider>
        <MetaCartReview items={[item]} importKey={key} />
      </CartProvider>
    </StrictMode>
  )
}

function StaleAlreadyAddedReview() {
  const cart = useCart()
  return (
    <CartContext value={{ ...cart, importedCarts: [], importCart: async () => "already-added" }}>
      <MetaCartReview items={[item]} importKey={key} />
    </CartContext>
  )
}

beforeEach(() => {
  window.localStorage.clear()
})

describe("Meta cart review", () => {
  it("shows free shipping for a confirmed zero-rate multi-item selection", () => {
    storeConfig.commerce.firstItemShippingCents = 0
    storeConfig.commerce.additionalItemShippingCents = 0
    review()
    expect(screen.getByText("Free", { selector: "dd" })).toBeVisible()
    expect(screen.getAllByText("$56.00", { selector: "dd" })).toHaveLength(2)
  })

  it("requires an explicit action, preserves existing items and shows the current combined checkout total", async () => {
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({
        version: 1,
        entries: [
          {
            ...item,
            title: "Sample first design",
            variantId: 1003,
            variantTitle: "Clay / M",
            quantity: 1,
            entryId: "existing",
          },
        ],
        checkouts: {},
      })
    )
    const user = userEvent.setup()
    const first = review()
    expect(screen.getByRole("heading", { name: item.title })).toBeVisible()
    expect(screen.getByText(/You already have 1 shirt/)).toBeVisible()
    expect(screen.queryByRole("button", { name: "Checkout" })).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Add selection to cart" }))
    expect(await screen.findByRole("heading", { name: "The good stuff (3)" })).toBeVisible()
    expect(screen.getByRole("heading", { name: item.title })).toBeVisible()
    expect(screen.getByRole("button", { name: `Increase quantity of ${item.title}` })).toBeVisible()
    expect(screen.getByRole("status")).toHaveFocus()
    expect(screen.getByText("$93.75", { exact: true })).toBeVisible()
    expect(screen.getByText("Clay / M")).toBeVisible()
    expect(trackStoreEvent).toHaveBeenCalledExactlyOnceWith({ name: "add_to_cart", productId: item.productId })
    first.unmount()
    review()
    expect(await screen.findByRole("heading", { name: "The good stuff (3)" })).toBeVisible()
    expect(screen.getByRole("heading", { name: item.title })).toBeVisible()
    expect(screen.getByRole("status")).not.toHaveFocus()
    expect(screen.queryByRole("button", { name: "Add selection to cart" })).not.toBeInTheDocument()
    expect(trackStoreEvent).toHaveBeenCalledTimes(1)
  })

  it("reports a limit failure without dropping the existing cart or adding part of the selection", async () => {
    const stored = { version: 1, entries: [{ ...item, quantity: 9, entryId: "existing" }], checkouts: {} }
    window.localStorage.setItem(storageKey, JSON.stringify(stored))
    const user = userEvent.setup()
    review()
    await user.click(screen.getByRole("button", { name: "Add selection to cart" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("Nothing was added")
    expect(JSON.parse(window.localStorage.getItem(storageKey)!)).toEqual(stored)
    expect(trackStoreEvent).not.toHaveBeenCalled()
  })

  it("allows a deliberate new addition after removing the imported selection", async () => {
    const user = userEvent.setup()
    review()
    await user.click(screen.getByRole("button", { name: "Add selection to cart" }))
    await user.click(await screen.findByRole("button", { name: /Remove Sample first design/ }))
    await user.click(await screen.findByRole("button", { name: "Add selection to cart" }))
    expect(await screen.findByRole("heading", { name: "The good stuff (2)" })).toBeVisible()
  })

  it("warns when storage is blocked and prevents duplicate additions while this tab stays open", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("Blocked")
    })
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("Blocked")
    })
    const user = userEvent.setup()
    review()
    await user.click(screen.getByRole("button", { name: "Add selection to cart" }))
    expect(await screen.findByRole("heading", { name: "The good stuff (2)" })).toBeVisible()
    expect(screen.getByText(/Your browser isn’t saving your cart/)).toBeVisible()
    expect(screen.queryByRole("button", { name: "Add selection to cart" })).not.toBeInTheDocument()
  })

  it("recognizes an import from another tab and updates the review without duplicating it", async () => {
    review()
    act(() => {
      window.localStorage.setItem(
        storageKey,
        JSON.stringify({
          version: 1,
          entries: [{ ...item, entryId: `${key}:12345678-1234-1234-1234-123456789abc` }],
          checkouts: {},
        })
      )
      window.dispatchEvent(new StorageEvent("storage", { key: storageKey }))
    })
    expect(await screen.findByRole("heading", { name: "The good stuff (2)" })).toBeVisible()
    expect(screen.getByRole("status")).not.toHaveFocus()
    expect(screen.queryByRole("button", { name: "Add selection to cart" })).not.toBeInTheDocument()
  })

  it("announces an import discovered in storage during the customer's action without adding it again", async () => {
    const user = userEvent.setup()
    review()
    const stored = {
      version: 1,
      entries: [{ ...item, entryId: `${key}:12345678-1234-1234-1234-123456789abc` }],
      checkouts: {},
    }
    window.localStorage.setItem(storageKey, JSON.stringify(stored))
    await user.click(screen.getByRole("button", { name: "Add selection to cart" }))
    expect(await screen.findByRole("heading", { name: "The good stuff (2)" })).toBeVisible()
    expect(screen.getByRole("status")).toHaveTextContent("already in your cart")
    expect(screen.getByRole("status")).toHaveFocus()
    expect(JSON.parse(window.localStorage.getItem(storageKey)!)).toEqual(stored)
    expect(trackStoreEvent).not.toHaveBeenCalled()
  })

  it("gives explicit already-added feedback even if the cart view has not caught up", async () => {
    const user = userEvent.setup()
    render(
      <CartProvider>
        <StaleAlreadyAddedReview />
      </CartProvider>
    )
    await user.click(screen.getByRole("button", { name: "Add selection to cart" }))
    expect(await screen.findByRole("status")).toHaveTextContent("View your existing cart to review it")
    expect(screen.getByRole("status")).toHaveFocus()
    expect(trackStoreEvent).not.toHaveBeenCalled()
  })

  it.each([false, true])(
    "does not reuse completed feedback or steal focus after passive removal and reimport (already added: %s)",
    async (alreadyAdded) => {
      const user = userEvent.setup()
      render(
        <>
          <button type="button">Keep focus here</button>
          <CartProvider>
            <MetaCartReview items={[item]} importKey={key} />
          </CartProvider>
        </>
      )
      const stored = {
        version: 1,
        entries: [{ ...item, entryId: `${key}:12345678-1234-1234-1234-123456789abc` }],
        checkouts: {},
      }
      if (alreadyAdded) window.localStorage.setItem(storageKey, JSON.stringify(stored))
      await user.click(screen.getByRole("button", { name: "Add selection to cart" }))
      expect(await screen.findByRole("status")).toHaveFocus()
      const otherControl = screen.getByRole("button", { name: "Keep focus here" })
      await user.click(otherControl)
      act(() => {
        window.localStorage.removeItem(storageKey)
        window.dispatchEvent(new StorageEvent("storage", { key: storageKey }))
      })
      expect(screen.getByRole("button", { name: "Add selection to cart" })).toBeVisible()
      expect(screen.queryByRole("status")).not.toBeInTheDocument()
      expect(otherControl).toHaveFocus()
      act(() => {
        window.localStorage.setItem(storageKey, JSON.stringify(stored))
        window.dispatchEvent(new StorageEvent("storage", { key: storageKey }))
      })
      expect(await screen.findByRole("heading", { name: "The good stuff (2)" })).toBeVisible()
      expect(otherControl).toHaveFocus()
    }
  )
})

it("does not present placeholder shipping or a total before the store opens", () => {
  storeConfig.commerce.shippingConfirmed = false
  review()
  expect(screen.getByRole("status")).toHaveTextContent("confirming shipping and policies")
  expect(screen.queryByText("US shipping for this selection")).not.toBeInTheDocument()
  expect(screen.queryByText("Total before tax")).not.toBeInTheDocument()
  expect(screen.getByText("Selection subtotal")).toBeVisible()
})
