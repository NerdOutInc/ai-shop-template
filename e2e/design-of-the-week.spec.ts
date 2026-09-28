import AxeBuilder from "@axe-core/playwright"
import { expect, test } from "@playwright/test"

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

test("shows only the individually scheduled products, and four more without repeating itself", async ({ page }) => {
  await page.goto("/#design-of-the-week")
  const section = page.locator("#about + #design-of-the-week")
  await expect(section).toHaveCount(1)
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Your next favorite starts here.")
  await expect(section.getByRole("heading", { level: 2, name: "This week’s picks." })).toBeVisible()

  const drop = page.getByRole("list", { name: "Design of the Week products" })
  await expect(drop.getByRole("article")).toHaveCount(dropTitles.length)
  for (const title of dropTitles) await expect(drop.getByRole("article", { name: title })).toBeVisible()
  // Sharing an artwork revision with a chosen product does not enqueue a sibling.
  await expect(drop.getByRole("article", { name: catalogProducts[6]!.title })).toHaveCount(0)

  const more = page.getByRole("list", { name: "More like this" })
  await expect(more.getByRole("article")).toHaveCount(4)
  // Never one of the drop's own, and never a repeat.
  for (const title of dropTitles) await expect(more.getByRole("article", { name: title })).toHaveCount(0)
  const moreTitles = await more.getByRole("article").evaluateAll((nodes) => nodes.map((node) => node.textContent))
  expect(new Set(moreTitles).size).toBe(4)

  await expect(section.getByRole("link", { name: "Shop all tees" })).toBeVisible()
})

test("picks the same four every time, so the page can be cached and indexed", async ({ page }) => {
  const read = async () => {
    await page.goto("/#design-of-the-week")
    // Level 4: both grids sit under h3 subsections of the weekly h2 section.
    return page.getByRole("list", { name: "More like this" }).getByRole("heading", { level: 4 }).allTextContents()
  }
  const first = await read()
  expect(await read()).toEqual(first)
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
  const section = page.locator("#about + #design-of-the-week")
  await expect(section.getByRole("heading", { level: 2, name: "New designs are on their way." })).toBeVisible()
  await expect(section.getByRole("link", { name: "Shop all tees" })).toHaveAttribute("href", "/shop")
  await expect(section.getByLabel("Know when the next one drops")).toHaveCount(0)
  await expect(section.getByRole("list", { name: "Design of the Week products" })).toHaveCount(0)
})

test("offers the drop list honestly, and refuses a sign-up from another site", async ({
  page,
  request,
  browserName,
}) => {
  await page.goto("/#design-of-the-week")
  const section = page.locator("#design-of-the-week")
  const field = section.getByRole("textbox", { name: "Know when the next one drops" })
  await expect(field).toBeVisible()
  // The wording beside the field IS the consent, so it has to be on the page, not just in the schema.
  await expect(
    section.getByText("We'll email you when a new design drops. Nothing else, and you can stop any time.")
  ).toBeVisible()
  // The honeypot must not reach the accessibility tree, or it would be announced and fail an audit.
  await expect(page.getByRole("textbox", { name: "Company" })).toHaveCount(0)

  // This fixture is built with the production site URL, so a browser post from 127.0.0.1 is
  // genuinely cross-origin -- which is what makes it a good place to prove the guard bites.
  // The accepted path is proven in the admin suite, which builds with a local origin.
  const foreign = await request.post("/api/drop-signup", {
    headers: { origin: "https://foreign.example", "content-type": "application/json" },
    data: { email: "someone@example.com", source: "footer" },
  })
  expect(foreign.status()).toBe(403)

  await field.focus()
  const tabKey = await beginKeyboardNavigation(page, browserName)
  const submit = section.getByRole("button", { name: "Keep me posted" })
  await expect(submit).toBeFocused()
  expect(await submit.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe("none")
  await page.keyboard.press(tabKey === "Alt+Tab" ? "Alt+Shift+Tab" : "Shift+Tab")
  await expect(field).toBeFocused()
  expect(await field.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe("none")
  await field.fill("customer@example.com")
  await page.keyboard.press(tabKey)
  const submission = page.waitForRequest(
    (request) => request.url().endsWith("/api/drop-signup") && request.method() === "POST"
  )
  await page.keyboard.press("Enter")
  expect((await submission).postDataJSON()).toMatchObject({
    email: "customer@example.com",
    source: "design-of-the-week",
  })
  // Named, not just role="alert": Next renders its own route announcer with that role, so a bare
  // role match is ambiguous and the assertion has to say which message it expects.
  await expect(page.getByRole("alert").filter({ hasText: "Use the form on the site." })).toBeVisible()
})
