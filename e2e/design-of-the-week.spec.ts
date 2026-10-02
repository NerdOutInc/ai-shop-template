import AxeBuilder from "@axe-core/playwright"
import { expect, test } from "@playwright/test"

import { storeConfig } from "../test/store-config"
import { beginKeyboardNavigation } from "../test/begin-keyboard-navigation"
import { catalogProducts } from "./catalog-products"
import { designOfTheWeekDrop } from "./design-of-the-week-drop"

test.use({ baseURL: `http://127.0.0.1:${Number(process.env.PLAYWRIGHT_FIXTURE_PORT ?? 3200)}` })

const dropTitles = designOfTheWeekDrop.productIndexes.map((index) => catalogProducts[index]!.title)

test.beforeEach(async ({ page }) => {
  // Card artwork uses public Blob URLs, stubbed alongside the product mockups.
  await page.route("https://fixture.public.blob.vercel-storage.com/**", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 94 120"><rect width="94" height="120" fill="#17262d"/></svg>',
    })
  )
  await page.route("https://e2e.test/**", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="#bc735c"/></svg>',
    })
  )
})

test("shows only the individually scheduled products without recommendations", async ({ page }) => {
  await page.goto("/#design-of-the-week")
  const section = page.locator(".home-intro + #design-of-the-week")
  await expect(section).toHaveCount(1)
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(storeConfig.home.headline)
  await expect(section.getByRole("heading", { level: 2, name: "This week’s picks." })).toBeVisible()

  const drop = page.getByRole("list", { name: "Design of the Week products" })
  await expect(drop.getByRole("article")).toHaveCount(dropTitles.length)
  for (const title of dropTitles) await expect(drop.getByRole("article", { name: title })).toBeVisible()
  // Sharing an artwork revision with a chosen product does not enqueue a sibling.
  await expect(drop.getByRole("article", { name: catalogProducts[6]!.title })).toHaveCount(0)

  await expect(page.getByRole("list", { name: "More like this" })).toHaveCount(0)
  await expect(section.getByRole("article")).toHaveCount(dropTitles.length)

  await expect(section.getByRole("link", { name: storeConfig.home.shopLabel })).toHaveCount(0)
})

test("leads the shop under Featured only, and shares the New badge with every recent arrival", async ({ page }) => {
  await page.goto("/shop")
  const titles = page.getByRole("main").getByRole("heading", { level: 2 })

  await page.getByRole("combobox", { name: /Sort/ }).selectOption("featured")
  await expect(titles.first()).toHaveText(dropTitles[0]!)
  const leading = await titles.allTextContents()
  expect(leading.slice(0, dropTitles.length).toSorted()).toEqual([...dropTitles].toSorted())

  // Newest says when a tee reached the shop, so the drop is not pinned there. Newest Design was shown
  // after this week began (e2e/prepare-catalog.ts), and it is the newest tee on the wall.
  await page.getByRole("combobox", { name: /Sort/ }).selectOption("newest")
  await expect(titles.first()).toHaveText("Fixture Newest Design")

  // Most Popular is the one sort that claims something about what other people bought.
  await page.getByRole("combobox", { name: /Sort/ }).selectOption("popular")
  await expect(titles.first()).not.toHaveText(dropTitles[0]!)

  // New means it entered the shop in the last two weeks, drop or not: the drop's tees, the tee shown
  // after them, and the withheld one whose reveal passed an hour ago. Everything else arrived a
  // month ago, so the page-wide count proves no other card carries it.
  await page.getByRole("combobox", { name: /Sort/ }).selectOption("featured")
  const recent = [...dropTitles, "Fixture Newest Design", "Fixture Already Dropped"]
  for (const title of recent)
    await expect(page.getByRole("article", { name: title }).getByText("New", { exact: true })).toBeVisible()
  await expect(page.getByText("New", { exact: true })).toHaveCount(recent.length)
})

test("reaches the home section from both footer locations using the keyboard", async ({ page, browserName }) => {
  for (const path of ["/", "/shipping"]) {
    await page.goto(path)
    const link = page.getByRole("contentinfo").getByRole("link", { name: "Design of the week" })
    await expect(link).toHaveAttribute("href", "/#design-of-the-week")
    await link.focus()
    await page.keyboard.press("Enter")
    await expect(page).toHaveURL(/\/#design-of-the-week$/)
    const section = page.locator("#design-of-the-week")
    await expect(section).toBeInViewport()
    await expect(section).toBeFocused()
    // The section only holds focus so the next Tab starts inside it; the ring belongs to its controls.
    expect(await section.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe("none")
    const firstProduct = section.getByRole("list", { name: "Design of the Week products" }).getByRole("link").first()
    await expect(firstProduct).toBeVisible()
    await beginKeyboardNavigation(page, browserName)
    await expect(firstProduct).toBeFocused()
    expect(await firstProduct.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe("none")
  }
})

test("stays accessible and free of horizontal overflow on a narrow screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/#design-of-the-week")

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  const results = await new AxeBuilder({ page }).include("main").analyze()
  expect(results.violations).toEqual([])
})

test("keeps the unconfigured week honest without collecting email", async ({ page }) => {
  const offlinePort = Number(process.env.PLAYWRIGHT_PORT ?? 3100)
  await page.goto(`http://127.0.0.1:${offlinePort}/#design-of-the-week`)
  const section = page.locator(".home-intro + #design-of-the-week")
  await expect(section.getByRole("heading", { level: 2, name: "New designs are on their way." })).toBeVisible()
  await expect(section.getByRole("link", { name: storeConfig.home.shopLabel })).toHaveAttribute("href", "/shop")
  await expect(section.getByLabel("Know when the next one drops")).toHaveCount(0)
  await expect(section.getByRole("list", { name: "Design of the Week products" })).toHaveCount(0)
})

test("hides signup while confirmation sending is disabled and refuses a foreign origin", async ({ page, request }) => {
  await page.goto("/#design-of-the-week")
  const section = page.locator("#design-of-the-week")
  await expect(section.getByRole("textbox", { name: "Know when the next one drops" })).toHaveCount(0)
  await expect(section.getByRole("button", { name: "Keep me posted" })).toHaveCount(0)
  await expect(section.getByText(/We'll send a confirmation email first/)).toHaveCount(0)
  await expect(section.getByText("New design email signups are paused right now. Check back soon.")).toBeVisible()
  const foreign = await request.post("/api/drop-signup", {
    headers: { origin: "https://foreign.example", "content-type": "application/json" },
    data: { email: "someone@example.com", source: "footer" },
  })
  expect(foreign.status()).toBe(403)
})

test("keeps expired-link recovery honest while signup is paused", async ({ page }) => {
  await page.route("**/api/drop-confirm", (route) =>
    route.fulfill({ status: 410, contentType: "application/json", body: "{}" })
  )
  await page.goto(`/confirm-signup#${"a".repeat(64)}`)
  await page.getByRole("button", { name: "Confirm signup" }).click()
  await expect(page.getByRole("heading", { name: "This link has expired" })).toBeFocused()
  await expect(page.getByRole("status")).toContainText("New signups are paused right now")
  await expect(page.getByRole("link", { name: "Back to the shop", exact: true })).toHaveAttribute("href", "/shop")
})
