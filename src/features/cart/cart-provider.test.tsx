import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { CartProvider } from "./cart-provider"
import { useCart } from "./use-cart"

function Bag() {
  const cart = useCart()
  return (
    <>
      <p>Count: {cart.count}</p>
      <p>{cart.persistenceWarning ? "Cannot save" : "Saved"}</p>
      <button
        onClick={() =>
          cart.addItem({
            productId: "aaaaaaaaaaaaaaaaaaaaaaaa",
            variantId: 1,
            title: "Sample first design",
            variantTitle: "M",
            unitAmount: 2800,
            quantity: 1,
          })
        }
      >
        Add shirt
      </button>
    </>
  )
}

describe("CartProvider", () => {
  beforeEach(() => window.localStorage.clear())

  it("persists the bag across remounts and synchronizes changes from another tab", async () => {
    const user = userEvent.setup()
    const first = render(
      <CartProvider>
        <Bag />
      </CartProvider>
    )
    await user.click(screen.getByRole("button", { name: "Add shirt" }))
    expect(screen.getByText("Count: 1")).toBeVisible()
    first.unmount()
    render(
      <CartProvider>
        <Bag />
      </CartProvider>
    )
    expect(await screen.findByText("Count: 1")).toBeVisible()
    const { act } = await import("@testing-library/react")
    act(() => {
      window.localStorage.removeItem("your-store-cart-v1")
      window.dispatchEvent(new StorageEvent("storage", { key: "your-store-cart-v1" }))
    })
    expect(screen.getByText("Count: 0")).toBeVisible()
  })

  it("keeps shopping functional if browser storage is blocked", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("Blocked")
    })
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("Blocked")
    })
    const user = userEvent.setup()
    render(
      <CartProvider>
        <Bag />
      </CartProvider>
    )
    await user.click(screen.getByRole("button", { name: "Add shirt" }))
    expect(screen.getByText("Count: 1")).toBeVisible()
    expect(screen.getByText("Cannot save")).toBeVisible()
  })
})
