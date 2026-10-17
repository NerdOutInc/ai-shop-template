import { act, render, screen, within } from "@testing-library/react"
import { use, type ReactNode } from "react"
import Link from "next/link"
import { beforeEach, expect, it, vi } from "vitest"
import { storeConfig } from "@/lib/store-config"
import HomePage from "./page"

const mocks = vi.hoisted(() => ({
  hero: null as Promise<ReactNode> | null,
  heroRead: vi.fn(),
  signup: null as ReactNode,
  sending: true,
}))
vi.mock("./_components/store-structured-data", () => ({ StoreStructuredData: () => null }))
vi.mock("./_components/home-hero", () => ({
  HomeHero: () => {
    mocks.heroRead()
    return use(mocks.hero!)
  },
}))
// Resolve this async server child before client rendering; keep its actual signup guard.
vi.mock("./_components/home-signup", () => ({ HomeSignup: () => mocks.signup }))
vi.mock("@/features/drop-signup/drop-signup-form", () => ({ DropSignupForm: () => <div>Drop signup</div> }))
vi.mock("@/features/drop-signup/read-signup-confirmation-setup.server", () => ({
  readSignupConfirmationSetup: () => ({ sending: mocks.sending }),
}))
vi.mock("next/server", () => ({ connection: vi.fn() }))
vi.mock("./_components/design-of-the-week", () => ({
  DesignOfTheWeek: () => (
    <div>
      Weekly selection
      <ul aria-label="Weekly products">
        {Array.from({ length: 8 }, (_, i) => (
          <li key={i}>
            <Link href={`/shop/product-${i}`}>Product {i}</Link>
          </li>
        ))}
      </ul>
    </div>
  ),
}))
async function prepareSignup() {
  const { HomeSignup } = await vi.importActual<typeof import("./_components/home-signup")>("./_components/home-signup")
  mocks.signup = await HomeSignup()
}
beforeEach(async () => {
  vi.clearAllMocks()
  mocks.sending = true
  mocks.hero = Promise.resolve(null)
  storeConfig.configured = true
  storeConfig.policies.published = true
  storeConfig.features.designOfTheWeek = false
  storeConfig.features.dropSignup = false
  await prepareSignup()
})
it("keeps the home page and shop link without optional features", async () => {
  render(<HomePage />)
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(storeConfig.home.headline)
  expect(screen.getByRole("link", { name: storeConfig.home.shopLabel })).toHaveAttribute("href", "/shop")
  expect(screen.queryByText("Weekly selection")).not.toBeInTheDocument()
  expect(screen.queryByText("Drop signup")).not.toBeInTheDocument()
  expect(mocks.heroRead).not.toHaveBeenCalled()
})
it("offers signup independently of the weekly feature", async () => {
  storeConfig.features.dropSignup = true
  render(<HomePage />)
  expect(screen.getByRole("region", { name: "New design updates" })).toHaveTextContent("Drop signup")
  expect(screen.queryByText("Weekly selection")).not.toBeInTheDocument()
})
it("mounts the weekly feature without a second signup form", async () => {
  storeConfig.features.designOfTheWeek = true
  storeConfig.features.dropSignup = true
  await act(async () => {
    render(<HomePage />)
  })
  expect(screen.getByRole("region", { name: "Design of the week" })).toHaveTextContent("Weekly selection")
  expect(screen.queryByRole("region", { name: "New design updates" })).not.toBeInTheDocument()
})
it("withholds independent signup before policy approval", async () => {
  storeConfig.features.dropSignup = true
  storeConfig.policies.published = false
  render(<HomePage />)
  expect(screen.queryByText("Drop signup")).not.toBeInTheDocument()
})
it("hides the signup invitation when confirmation sending is unavailable", async () => {
  mocks.sending = false
  storeConfig.features.dropSignup = true
  await prepareSignup()
  render(<HomePage />)
  expect(screen.queryByText("Drop signup")).not.toBeInTheDocument()
})
it("shows the intro and full lineup while the hero read waits, then keeps unpictured products", async () => {
  storeConfig.features.designOfTheWeek = true
  const waiting = Promise.withResolvers<ReactNode>()
  mocks.hero = waiting.promise
  await act(async () => {
    render(<HomePage />)
  })
  expect(screen.getByRole("heading", { name: storeConfig.home.headline })).toBeVisible()
  expect(within(screen.getByRole("list", { name: "Weekly products" })).getAllByRole("link")).toHaveLength(8)
  await act(async () => {
    waiting.resolve(
      <section id="weekly-hero">
        <h1>Featured scene</h1>
        <Link href="/shop/product-0">Pictured tee</Link>
      </section>
    )
  })
  expect(screen.getByRole("heading", { name: "Featured scene" })).toBeVisible()
  expect(screen.queryByRole("heading", { name: storeConfig.home.headline })).not.toBeInTheDocument()
  const products = within(screen.getByRole("list", { name: "Weekly products" })).getAllByRole("link")
  expect(products).toHaveLength(8)
  expect(products[7]).toHaveAttribute("href", "/shop/product-7")
  expect(document.querySelectorAll("#design-of-the-week")).toHaveLength(1)
})
