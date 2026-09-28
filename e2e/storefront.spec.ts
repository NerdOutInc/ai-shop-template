import AxeBuilder from "@axe-core/playwright"
import { expect, test } from "@playwright/test"

import { beginKeyboardNavigation } from "../test/begin-keyboard-navigation"
import { merchantFeedPassword } from "./merchant-feed-password"
import { catalogProducts } from "./catalog-products"
import { designOfTheWeekDrop } from "./design-of-the-week-drop"
import { stubDropArtwork } from "./stub-drop-artwork"

const dropTitles = designOfTheWeekDrop.productIndexes.map((index) => catalogProducts[index]!.title)

test.use({ baseURL: `http://127.0.0.1:${Number(process.env.PLAYWRIGHT_FIXTURE_PORT ?? 3200)}` })

test.beforeEach(async ({ page }) => {
  await stubDropArtwork(page)
  await page.route("https://e2e.test/**", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 700"><rect width="600" height="700" fill="#e9ece9"/><path d="M180 130 75 210 130 320 190 295V570H410V295L470 320 525 210 420 130 360 170H240Z" fill="${route.request().url().includes("clay-shirt") ? "#bc735c" : "#17262d"}"/><text x="300" y="345" text-anchor="middle" fill="#eff3f0" font-size="25">GOOD HANGS</text></svg>`,
    })
  )
})

test("shows only the garment paragraph and fabric list under The garment while keeping the size guide separate", async ({
  page,
}) => {
  await page.goto("/shop")
  await page.getByRole("article", { name: "Fixture Good Hangs" }).getByRole("link").click()
  const summary = page.getByText("The garment", { exact: true })
  await summary.focus()
  await expect(summary).toBeFocused()
  await page.keyboard.press("Enter")
  const description = page.locator("details").filter({ has: summary })
  await expect(
    description.locator("p").filter({ hasText: "Printed on the Next Level 6210 for sessions and rest days." })
  ).toBeVisible()
  await expect(description.locator("ul > li")).toHaveText([
    "60% cotton, 40% polyester",
    "Lightweight fabric",
    "Tear-away label",
  ])
  await expect(description.locator("ul")).toHaveCSS("list-style-type", "disc")
  // The design prose already opens the page, and care has its own section.
  await expect(description.locator("strong")).toHaveCount(0)
  await expect(description.getByText("A soft everyday tee for good company.")).toHaveCount(0)
  await expect(description.locator("ol")).toHaveCount(0)
  await expect(description.getByRole("table")).toHaveCount(0)
  await page.getByRole("button", { name: "Find your fit" }).click()
  await expect(page.getByText("Size guide", { exact: true })).toBeFocused()
  await expect(page.getByRole("columnheader", { name: "XL", exact: true })).toBeVisible()
  await expect(page.getByRole("cell", { name: "24", exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test("previews artwork on the pictured shirt color and offers it as the last gallery thumbnail", async ({
  page,
  isMobile,
  browserName,
}) => {
  await page.goto("/shop")
  const card = page.getByRole("article", { name: "Fixture Good Hangs" })
  const link = card.getByRole("link")
  const artwork = card.getByAltText("Fixture Good Hangs artwork")
  const mockup = card.getByAltText("Fixture Good Hangs", { exact: true })
  await expect(mockup).toBeVisible()
  await expect(artwork).not.toBeVisible()
  if (!isMobile) {
    await link.hover()
    await expect(artwork).toBeVisible()
    await expect(mockup).not.toBeVisible()
    await expect(artwork.locator("..")).toHaveCSS("background-color", "rgb(188, 115, 92)")
    await page.mouse.move(0, 0)
    await expect(mockup).toBeVisible()
    const tabKey = await beginKeyboardNavigation(page, browserName)
    for (let index = 0; index < 30 && !(await link.evaluate((element) => element === document.activeElement)); index++)
      await page.keyboard.press(tabKey)
    await expect(link).toBeFocused()
    await expect(artwork).toBeVisible()
    expect(await link.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe("none")
    await page.keyboard.press("Enter")
  } else {
    await link.tap()
  }
  await expect(page.getByRole("heading", { level: 1, name: "Fixture Good Hangs" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Clay", exact: true })).toHaveAttribute("aria-pressed", "true")
  await expect(page.locator('[data-slot="carousel-item"][aria-hidden="false"] .product-main-image')).toHaveAttribute(
    "src",
    "https://e2e.test/clay-shirt.png"
  )
  const thumbnails = page.locator(".product-thumbnails")
  const artworkButton = page.getByRole("button", { name: "View artwork of Fixture Good Hangs" })
  await expect(thumbnails.getByRole("button").last()).toHaveAccessibleName("View artwork of Fixture Good Hangs")
  await artworkButton.click()
  const detailArtwork = page.getByRole("img", { name: "Fixture Good Hangs artwork" })
  await expect(detailArtwork).toBeVisible()
  await expect(detailArtwork.locator("..")).toHaveCSS("background-color", "rgb(188, 115, 92)")
  await expect(detailArtwork).toHaveCSS("mix-blend-mode", "normal")
  await expect
    .poll(() => detailArtwork.evaluate((element) => (element as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0)
  await page.getByRole("button", { name: "Black", exact: true }).click()
  await expect(artworkButton).toHaveAttribute("aria-pressed", "true")
  await expect(detailArtwork).toBeVisible()
  await expect(detailArtwork.locator("..")).toHaveCSS("background-color", "rgb(23, 38, 45)")
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test("keeps published mockups and their Primary color when an older local artwork preview is disabled", async ({
  page,
  isMobile,
}) => {
  await page.goto("/shop")
  const card = page.getByRole("article", { name: "Fixture Wall Buddies" })
  const mockup = card.getByAltText("Fixture Wall Buddies", { exact: true })
  await expect(mockup).toHaveAttribute("src", "https://e2e.test/clay-shirt.png")
  await expect(card.getByAltText("Fixture Wall Buddies artwork")).toHaveCount(0)
  if (!isMobile) await card.getByRole("link").hover()
  await expect(mockup).toBeVisible()
  await card.getByRole("link").click()
  await expect(page.getByRole("heading", { level: 1, name: "Fixture Wall Buddies" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Clay", exact: true })).toHaveAttribute("aria-pressed", "true")
  await expect(page.locator('[data-slot="carousel-item"][aria-hidden="false"] .product-main-image')).toHaveAttribute(
    "src",
    "https://e2e.test/clay-shirt.png"
  )
  await expect(page.getByRole("button", { name: "View artwork of Fixture Wall Buddies" })).toHaveCount(0)
})

test("navigates product photos and artwork with keyboard focus, arrows, and thumbnails", async ({ page }) => {
  await page.goto("/shop")
  await page.getByRole("article", { name: "Fixture Good Hangs" }).getByRole("link").click()
  const gallery = page.getByRole("region", { name: "Fixture Good Hangs photos" })
  await expect(gallery.getByRole("button", { name: "Next slide" })).toBeEnabled()
  const firstPhoto = gallery.getByRole("button", { name: "View photo 1 of Fixture Good Hangs" })
  const secondPhoto = gallery.getByRole("button", { name: "View photo 2 of Fixture Good Hangs" })
  const artwork = gallery.getByRole("button", { name: "View artwork of Fixture Good Hangs" })
  await gallery.focus()
  await page.keyboard.press("ArrowRight")
  await expect(gallery).toBeFocused()
  expect(await gallery.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe("none")
  await expect(secondPhoto).toHaveAttribute("aria-pressed", "true")
  await expect(gallery.locator('[aria-hidden="false"] .product-main-image')).toHaveAttribute(
    "src",
    "https://e2e.test/clay-shirt-back.png"
  )
  await page.keyboard.press("ArrowRight")
  await expect(artwork).toHaveAttribute("aria-pressed", "true")
  await page.keyboard.press("ArrowRight")
  await expect(firstPhoto).toHaveAttribute("aria-pressed", "true")
  await page.keyboard.press("ArrowLeft")
  await expect(artwork).toHaveAttribute("aria-pressed", "true")
  await gallery.getByRole("button", { name: "Previous slide" }).click()
  await expect(secondPhoto).toHaveAttribute("aria-pressed", "true")
  await gallery.getByRole("button", { name: "Next slide" }).click()
  await expect(artwork).toHaveAttribute("aria-pressed", "true")
  await firstPhoto.focus()
  await page.keyboard.press("Enter")
  await expect(firstPhoto).toBeFocused()
  await expect(firstPhoto).toHaveAttribute("aria-pressed", "true")
  expect(await firstPhoto.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe("none")
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test("drags product photos with a mouse and keeps thumbnail selection in sync", async ({ page, isMobile }) => {
  test.skip(isMobile, "Mouse dragging is covered by the desktop browsers")
  await page.goto("/shop")
  await page.getByRole("article", { name: "Fixture Good Hangs" }).getByRole("link").click()
  const gallery = page.getByRole("region", { name: "Fixture Good Hangs photos" })
  await expect(gallery.getByRole("button", { name: "Next slide" })).toBeEnabled()
  const image = gallery.locator('[data-slot="carousel-item"][aria-hidden="false"]')
  const bounds = (await image.boundingBox())!
  await page.mouse.move(bounds.x + bounds.width * 0.8, bounds.y + bounds.height * 0.5)
  await page.mouse.down()
  await page.mouse.move(bounds.x + bounds.width * 0.2, bounds.y + bounds.height * 0.5, { steps: 12 })
  await page.mouse.up()
  await expect(gallery.getByRole("button", { name: "View photo 2 of Fixture Good Hangs" })).toHaveAttribute(
    "aria-pressed",
    "true"
  )
  await gallery.getByRole("button", { name: "View artwork of Fixture Good Hangs" }).click()
  await expect(gallery.getByRole("img", { name: "Fixture Good Hangs artwork" })).toBeVisible()
})

test("keeps the selected product photo when changing or reselecting a color", async ({ page }) => {
  await page.goto("/shop")
  await page.getByRole("article", { name: "Fixture Good Hangs" }).getByRole("link").click()
  const gallery = page.getByRole("region", { name: "Fixture Good Hangs photos" })
  const secondPhoto = gallery.getByRole("button", { name: "View photo 2 of Fixture Good Hangs" })
  const selectedImage = gallery.locator('[data-slot="carousel-item"][aria-hidden="false"] .product-main-image')
  await secondPhoto.focus()
  await page.keyboard.press("Enter")
  await expect(secondPhoto).toHaveAttribute("aria-pressed", "true")
  await expect(secondPhoto).toBeFocused()
  expect(await secondPhoto.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe("none")
  await expect(selectedImage).toHaveAttribute("src", "https://e2e.test/clay-shirt-back.png")

  const black = page.getByRole("button", { name: "Black", exact: true })
  await black.focus()
  await page.keyboard.press("Enter")
  await expect(black).toBeFocused()
  expect(await black.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe("none")
  await expect(secondPhoto).toHaveAttribute("aria-pressed", "true")
  await expect(selectedImage).toHaveAttribute("src", "https://e2e.test/shirt-back.png")
  await page.keyboard.press("Enter")
  await expect(secondPhoto).toHaveAttribute("aria-pressed", "true")
  await expect(selectedImage).toHaveAttribute("src", "https://e2e.test/shirt-back.png")

  await page.getByRole("button", { name: "Clay", exact: true }).click()
  await expect(secondPhoto).toHaveAttribute("aria-pressed", "true")
  await expect(selectedImage).toHaveAttribute("src", "https://e2e.test/clay-shirt-back.png")
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)

  await gallery.getByRole("button", { name: "View artwork of Fixture Good Hangs" }).click()
  await black.click()
  await page.getByRole("button", { name: "M", exact: true }).click()
  await page.getByRole("button", { name: "Add to cart", exact: true }).click()
  const confirmation = page.getByRole("dialog", { name: "Added to cart" })
  await expect(confirmation.locator("img")).toHaveAttribute("src", "https://e2e.test/shirt-back.png")
})

test("swipes the mobile gallery through photos and artwork while preserving vertical page scrolling", async ({
  page,
  isMobile,
  browserName,
}) => {
  test.skip(!isMobile || browserName !== "chromium", "Native touch sequences use Chromium's mobile input protocol")
  await page.goto("/shop")
  await page.getByRole("article", { name: "Fixture Good Hangs" }).getByRole("link").tap()
  const gallery = page.getByRole("region", { name: "Fixture Good Hangs photos" })
  await expect(gallery.getByRole("button", { name: "Next slide" })).toBeEnabled()
  const activeSlide = gallery.locator('[data-slot="carousel-item"][aria-hidden="false"]')
  const firstPhoto = gallery.getByRole("button", { name: "View photo 1 of Fixture Good Hangs" })
  const secondPhoto = gallery.getByRole("button", { name: "View photo 2 of Fixture Good Hangs" })
  const artwork = gallery.getByRole("button", { name: "View artwork of Fixture Good Hangs" })
  const touch = await page.context().newCDPSession(page)

  async function swipe(direction: "left" | "right" | "up", diagonal = false) {
    await activeSlide.scrollIntoViewIfNeeded()
    const bounds = (await activeSlide.boundingBox())!
    const sign = direction === "right" ? 1 : -1
    const startX = bounds.x + bounds.width * (direction === "right" ? 0.2 : 0.8)
    const startY = bounds.y + bounds.height * (direction === "up" ? 0.75 : 0.5)
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: startX, y: startY }],
    })
    for (let step = 1; step <= 10; step++) {
      await touch.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [
          {
            x: startX + (direction === "up" ? 0 : sign * bounds.width * 0.6 * (step / 10)),
            y: startY + (direction === "up" ? -bounds.height * 0.6 * (step / 10) : diagonal ? step * 2 : 0),
          },
        ],
      })
      // Real elapsed time lets the browser and carousel measure finger velocity.
      await page.waitForTimeout(20)
    }
    await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
  }

  async function expectSettled() {
    await expect
      .poll(async () => Math.abs((await activeSlide.boundingBox())!.x - (await gallery.boundingBox())!.x))
      .toBeLessThan(2)
  }

  async function shortGesture(distance: number, end: "touchEnd" | "touchCancel") {
    const bounds = (await activeSlide.boundingBox())!
    const x = bounds.x + bounds.width * 0.7
    const y = bounds.y + bounds.height * 0.5
    await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] })
    await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x - distance, y }] })
    // Pause the finger before release so this tests a short drag, not a high-velocity flick.
    await page.waitForTimeout(220)
    await touch.send("Input.dispatchTouchEvent", { type: end, touchPoints: [] })
  }

  await activeSlide.tap()
  await expect(firstPhoto).toHaveAttribute("aria-pressed", "true")
  await shortGesture(6, "touchEnd")
  await expectSettled()
  await expect(firstPhoto).toHaveAttribute("aria-pressed", "true")
  await shortGesture(24, "touchCancel")
  await expectSettled()
  await expect(firstPhoto).toHaveAttribute("aria-pressed", "true")
  await swipe("left", true)
  await expect(secondPhoto).toHaveAttribute("aria-pressed", "true")
  await expectSettled()
  await swipe("left")
  await expect(artwork).toHaveAttribute("aria-pressed", "true")
  await expectSettled()
  await swipe("left")
  await expect(firstPhoto).toHaveAttribute("aria-pressed", "true")
  await expectSettled()
  await swipe("right", true)
  await expect(artwork).toHaveAttribute("aria-pressed", "true")
  await expectSettled()
  await page.getByRole("button", { name: "Black", exact: true }).tap()
  await expect(artwork).toHaveAttribute("aria-pressed", "true")
  await expectSettled()
  await swipe("left")
  await expect(firstPhoto).toHaveAttribute("aria-pressed", "true")
  await expectSettled()
  await swipe("left")
  await expect(secondPhoto).toHaveAttribute("aria-pressed", "true")
  await expectSettled()
  await expect(gallery.locator('[aria-hidden="false"] .product-main-image')).toHaveAttribute(
    "src",
    "https://e2e.test/shirt-back.png"
  )
  await firstPhoto.tap()
  await expectSettled()
  await activeSlide.scrollIntoViewIfNeeded()
  const scrollBefore = await page.evaluate(() => scrollY)
  await swipe("up")
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(scrollBefore + 40)
  await expect(firstPhoto).toHaveAttribute("aria-pressed", "true")
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await touch.detach()
})

test("sorts Featured, Newest, and Most Popular using server-side Printify fixture data", async ({ page }) => {
  await page.goto("/shop")
  const cards = page.getByRole("article")
  // 24 selected products plus the withheld fixture whose reveal has already passed.
  await expect(cards).toHaveCount(25)
  const titles = () => cards.getByRole("heading", { level: 2 }).allTextContents()
  // This week's drop leads Featured, so the first card is one of its tees; e2e/design-of-the-week.spec.ts
  // owns that assertion. What is asserted here is that the ordering UNDERNEATH the drop is still the
  // fixture's own, and that Newest and Most Popular are not pinned at all.
  const withoutDrop = async () => (await titles()).filter((title) => !dropTitles.includes(title))
  await expect(cards.first()).toContainText(dropTitles[0]!)
  expect((await withoutDrop())[0]).toBe("Fixture Good Hangs")

  // Newest is when each tee entered the shop (e2e/prepare-catalog.ts). Fresh Beta was shown after
  // the drop began, so it leads. The drop and the tee the clock revealed an hour ago come next, in an
  // order that depends on how long ago this week began; the revealed tee has no stamp of its own, so
  // it is up there only because its reveal counts as its arrival. Everything older follows in arrival
  // order, which Printify's created_at would not give: it has Wall Buddies ahead of Good Hangs.
  await page.getByRole("combobox", { name: /Sort/ }).selectOption("newest")
  await expect(cards.first()).toContainText("Fixture Fresh Beta")
  const newest = await titles()
  expect(newest[0]).toBe("Fixture Fresh Beta")
  expect(newest.slice(1, 5).toSorted()).toEqual([...dropTitles, "Fixture Already Dropped"].toSorted())
  expect(newest.slice(5)).toEqual(
    catalogProducts
      .map((product) => product.title)
      .filter((title) => title !== "Fixture Fresh Beta" && !dropTitles.includes(title))
  )

  await page.getByRole("combobox", { name: /Sort/ }).selectOption("popular")
  // Most Popular makes a claim about what other people bought, so the drop never jumps it.
  await expect(cards.first()).toContainText("Fixture Wall Buddies")
  await page.getByRole("combobox", { name: /Sort/ }).selectOption("featured")
  expect((await withoutDrop())[0]).toBe("Fixture Good Hangs")
})

test("carries the card color into a shareable variant URL without adding option changes to browser history", async ({
  page,
}) => {
  await page.goto("/shop")
  const card = page.getByRole("article", { name: "Fixture Good Hangs" })
  const colors = card.getByRole("group", { name: "Available colors" }).getByRole("button")
  const link = card.getByRole("link")
  await expect(colors.nth(0)).toHaveAccessibleName("Clay")
  await expect(colors.nth(1)).toHaveAccessibleName("Black")
  await expect(colors.nth(0)).toHaveAttribute("aria-pressed", "true")
  const primaryUrl = new URL((await link.getAttribute("href"))!, page.url())
  const productPath = primaryUrl.pathname
  expect(primaryUrl.searchParams.get("color")).toBe("Clay")
  expect(primaryUrl.searchParams.has("size")).toBe(false)

  await card.getByRole("button", { name: "Black", exact: true }).click()
  await expect(colors.nth(0)).toHaveAccessibleName("Clay")
  await expect(colors.nth(1)).toHaveAccessibleName("Black")
  await expect(colors.nth(1)).toHaveAttribute("aria-pressed", "true")
  await link.click()
  await expect(page).toHaveURL(
    (url) => url.pathname === productPath && url.searchParams.get("color") === "Black" && !url.searchParams.has("size")
  )
  await expect(page.getByRole("button", { name: "Black", exact: true })).toHaveAttribute("aria-pressed", "true")
  const detailColors = page.locator(".product-colors").getByRole("button")
  await expect(detailColors.nth(0)).toHaveAccessibleName("Clay")
  await expect(detailColors.nth(1)).toHaveAccessibleName("Black")
  await expect(page.locator('[data-slot="carousel-item"][aria-hidden="false"] .product-main-image')).toHaveAttribute(
    "src",
    "https://e2e.test/shirt.png"
  )
  await expect(page.getByRole("button", { name: "Choose a size", exact: true })).toBeDisabled()
  const historyLength = await page.evaluate(() => history.length)

  await page.getByRole("button", { name: "M", exact: true }).click()
  await expect(page).toHaveURL(
    (url) => url.searchParams.get("color") === "Black" && url.searchParams.get("size") === "M"
  )
  expect(await page.evaluate(() => history.length)).toBe(historyLength)

  await page.getByRole("button", { name: "Clay", exact: true }).click()
  await expect(page).toHaveURL(
    (url) => url.searchParams.get("color") === "Clay" && url.searchParams.get("size") === "M"
  )
  await expect(page.getByRole("button", { name: "M", exact: true })).toHaveAttribute("aria-pressed", "true")
  await expect(detailColors.nth(0)).toHaveAccessibleName("Clay")
  await expect(detailColors.nth(1)).toHaveAccessibleName("Black")
  expect(await page.evaluate(() => history.length)).toBe(historyLength)

  await page.getByRole("button", { name: "XL", exact: true }).click()
  await expect(page).toHaveURL(
    (url) => url.searchParams.get("color") === "Clay" && url.searchParams.get("size") === "XL"
  )
  expect(await page.evaluate(() => history.length)).toBe(historyLength)
  await page.reload()
  await expect(page.getByRole("button", { name: "Clay", exact: true })).toHaveAttribute("aria-pressed", "true")
  await expect(page.getByRole("button", { name: "XL", exact: true })).toHaveAttribute("aria-pressed", "true")
  await expect(page.getByRole("button", { name: "Add to cart", exact: true })).toBeEnabled()
  expect(await page.evaluate(() => history.length)).toBe(historyLength)

  await page.goBack()
  await expect(page).toHaveURL((url) => url.pathname === "/shop" && url.search === "")
  await expect(page.getByRole("article")).toHaveCount(25)
  await page.goForward()
  await expect(page).toHaveURL(
    (url) =>
      url.pathname === productPath && url.searchParams.get("color") === "Clay" && url.searchParams.get("size") === "XL"
  )
  await expect(page.getByRole("button", { name: "Clay", exact: true })).toHaveAttribute("aria-pressed", "true")
  await expect(page.getByRole("button", { name: "XL", exact: true })).toHaveAttribute("aria-pressed", "true")
  expect(await page.evaluate(() => history.length)).toBe(historyLength)
})

test("restores a direct variant URL and removes an unsupported size while preserving other query values and the hash", async ({
  page,
}) => {
  await page.goto("/shop")
  const link = page.getByRole("article", { name: "Fixture Good Hangs" }).getByRole("link")
  const productPath = new URL((await link.getAttribute("href"))!, page.url()).pathname
  await page.goto(`${productPath}?color=Clay&size=XL&campaign=send%20it#product-options`)
  await expect(page.getByRole("button", { name: "Clay", exact: true })).toHaveAttribute("aria-pressed", "true")
  await expect(page.getByRole("button", { name: "XL", exact: true })).toHaveAttribute("aria-pressed", "true")
  await expect(page.getByRole("button", { name: "Add to cart", exact: true })).toBeEnabled()
  const historyLength = await page.evaluate(() => history.length)

  await page.getByRole("button", { name: "Black", exact: true }).click()
  await expect(page).toHaveURL(
    (url) =>
      url.searchParams.get("color") === "Black" &&
      !url.searchParams.has("size") &&
      url.searchParams.get("campaign") === "send it" &&
      url.hash === "#product-options"
  )
  await expect(page.getByRole("button", { name: "XL", exact: true })).toHaveAttribute("aria-pressed", "false")
  await expect(page.getByRole("button", { name: "XL", exact: true })).toBeDisabled()
  await expect(page.getByRole("button", { name: "Choose a size", exact: true })).toBeDisabled()
  expect(await page.evaluate(() => history.length)).toBe(historyLength)

  await page.getByRole("button", { name: "M", exact: true }).click()
  await expect(page).toHaveURL(
    (url) =>
      url.searchParams.get("color") === "Black" &&
      url.searchParams.get("size") === "M" &&
      url.searchParams.get("campaign") === "send it" &&
      url.hash === "#product-options"
  )
  expect(await page.evaluate(() => history.length)).toBe(historyLength)
  await page.reload()
  await expect(page.getByRole("button", { name: "Black", exact: true })).toHaveAttribute("aria-pressed", "true")
  await expect(page.getByRole("button", { name: "M", exact: true })).toHaveAttribute("aria-pressed", "true")
  await expect(page.getByRole("button", { name: "Add to cart", exact: true })).toBeEnabled()
})

test("falls back from unknown URL options and writes the chosen valid variant without losing unrelated URL state", async ({
  page,
}) => {
  await page.goto("/shop")
  const link = page.getByRole("article", { name: "Fixture Good Hangs" }).getByRole("link")
  const productPath = new URL((await link.getAttribute("href"))!, page.url()).pathname
  const historyLengthBeforeNavigation = await page.evaluate(() => history.length)
  await page.goto(`${productPath}?color=Not+a+color&size=Not+a+size&campaign=keep#product-options`)
  await expect(page).toHaveURL(
    (url) =>
      url.searchParams.get("color") === "Clay" &&
      !url.searchParams.has("size") &&
      url.searchParams.get("campaign") === "keep" &&
      url.hash === "#product-options"
  )
  await expect(page.getByRole("button", { name: "Clay", exact: true })).toHaveAttribute("aria-pressed", "true")
  await expect(page.locator(".size-options button[aria-pressed='true']")).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Choose a size", exact: true })).toBeDisabled()
  const historyLength = await page.evaluate(() => history.length)
  expect(historyLength).toBe(historyLengthBeforeNavigation + 1)

  await page.getByRole("button", { name: "M", exact: true }).click()
  await expect(page).toHaveURL(
    (url) =>
      url.searchParams.get("color") === "Clay" &&
      url.searchParams.get("size") === "M" &&
      url.searchParams.get("campaign") === "keep" &&
      url.hash === "#product-options"
  )
  await expect(page.getByRole("button", { name: "M", exact: true })).toHaveAttribute("aria-pressed", "true")
  await expect(page.getByRole("button", { name: "Add to cart", exact: true })).toBeEnabled()
  expect(await page.evaluate(() => history.length)).toBe(historyLength)
})

test("opens a product, selects available variants and fit details, and adds the matching item to the bag", async ({
  page,
  browserName,
}) => {
  await page.goto("/shop")
  await page
    .getByRole("link", { name: /Fixture Good Hangs/ })
    .first()
    .click()
  await expect(page.getByRole("heading", { level: 1, name: "Fixture Good Hangs" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Choose a size", exact: true })).toBeDisabled()
  await expect(page.getByRole("button", { name: "L", exact: true })).toBeDisabled()
  await page.getByRole("button", { name: "M", exact: true }).click()
  await page.getByRole("button", { name: "Clay", exact: true }).click()
  await page.getByRole("button", { name: "XL", exact: true }).click()
  await expect(page.getByText("$32.00", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Find your fit" }).click()
  await expect(page.getByRole("region", { name: "Size chart, scroll horizontally for more sizes" })).toBeVisible()
  await expect(page.getByRole("rowheader", { name: "Width, in" })).toBeVisible()
  await expect(page.getByText(/size tolerance/i)).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([])
  await page.getByRole("button", { name: "Add to cart", exact: true }).click()
  const confirmation = page.getByRole("dialog", { name: "Added to cart" })
  await expect(confirmation).toBeVisible()
  await expect(confirmation.getByText("Fixture Good Hangs", { exact: true })).toBeVisible()
  await expect(confirmation.getByText("Clay / XL", { exact: true })).toBeVisible()
  await expect(confirmation.getByText("Quantity: 1", { exact: true })).toBeVisible()
  await expect(confirmation.getByText("$32.00", { exact: true })).toBeVisible()
  const viewCart = confirmation.getByRole("link", { name: "View cart (1)", exact: true })
  await expect(viewCart).toBeInViewport()
  await expect(viewCart).toBeFocused()
  // Audit the final colors after the confirmation finishes fading in.
  await expect(confirmation).toHaveCSS("opacity", "1")
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  const confirmationAudit = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"])
  if (browserName === "webkit") {
    // VoiceOver needs these guards; Base UI recommends excluding them from axe.
    // https://github.com/mui/base-ui/issues/5237 — actual focus cycles are tested below.
    confirmationAudit.exclude("[data-base-ui-focus-guard]")
  }
  expect((await confirmationAudit.analyze()).violations).toEqual([])
  await viewCart.click()
  await expect(page.getByText("Clay / XL", { exact: true })).toBeVisible()
  await expect(page.getByText("$32.00 each", { exact: true })).toBeVisible()
  await expect(page.getByRole("heading", { name: "The good stuff (1)" })).toBeVisible()
})

test("keeps keyboard focus in the cart confirmation and restores it after every dismissal", async ({
  page,
  browserName,
}) => {
  await page.goto("/shop")
  await page.getByRole("article", { name: "Fixture Good Hangs" }).getByRole("link").click()
  await page.getByRole("button", { name: "M", exact: true }).click()
  const addButton = page.getByRole("button", { name: "Add to cart", exact: true })
  const confirmation = page.getByRole("dialog", { name: "Added to cart" })

  for (const [index, dismiss] of ["Escape", "Continue shopping", "Close cart confirmation"].entries()) {
    await addButton.focus()
    await page.keyboard.press("Enter")
    await expect(confirmation).toBeVisible()
    const viewCart = confirmation.getByRole("link", { name: `View cart (${index + 1})`, exact: true })
    await expect(viewCart).toBeFocused()
    await expect(viewCart).toBeInViewport()
    expect(await viewCart.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe("none")
    const continueShopping = confirmation.getByRole("button", { name: "Continue shopping", exact: true })
    const closeConfirmation = confirmation.getByRole("button", { name: "Close cart confirmation", exact: true })
    const tabKey = await beginKeyboardNavigation(page, browserName)
    await expect(continueShopping).toBeFocused()
    // Base UI redirects its focus guards on the next animation frame.
    for (const control of [closeConfirmation, viewCart, continueShopping]) {
      await page.keyboard.press(tabKey)
      await expect(control).toBeFocused()
    }
    const reverseTabKey = tabKey === "Alt+Tab" ? "Alt+Shift+Tab" : "Shift+Tab"
    for (const control of [viewCart, closeConfirmation, continueShopping]) {
      await page.keyboard.press(reverseTabKey)
      await expect(control).toBeFocused()
    }

    if (dismiss === "Escape") await page.keyboard.press("Escape")
    else await confirmation.getByRole("button", { name: dismiss, exact: true }).click()
    await expect(confirmation).toHaveCount(0)
    await expect(addButton).toBeFocused()
  }

  await page.getByRole("link", { name: "Cart, 3 items", exact: true }).click()
  await expect(page.getByRole("heading", { name: "The good stuff (3)" })).toBeVisible()
})

test("keeps a withheld product off the shop, out of the feeds, and unbuyable until it drops", async ({
  page,
  request,
}) => {
  const keptBack = "Fixture Kept Back"
  const dropsLater = "Fixture Drops Later"
  const dropped = "Fixture Already Dropped"

  await page.goto("/shop")
  // 24 selected products plus the one whose moment has passed; the other two are withheld.
  await expect(page.getByRole("article")).toHaveCount(25)
  for (const sort of ["featured", "newest", "popular"]) {
    await page.getByRole("combobox", { name: /Sort/ }).selectOption(sort)
    await expect(page.getByRole("article", { name: keptBack })).toHaveCount(0)
    await expect(page.getByRole("article", { name: dropsLater })).toHaveCount(0)
    await expect(page.getByRole("article", { name: dropped })).toHaveCount(1)
  }

  // A withheld product reads exactly like one that never existed, rather than confirming its id.
  for (const id of ["f1de0000000000000000ca01", "f1de0000000000000000ca02"]) {
    const response = await page.goto(`/shop/${id}`)
    expect(response?.status()).toBe(404)
  }
  expect((await page.goto("/shop/f1de0000000000000000ca03"))?.status()).toBe(200)

  // Leaving a withheld product in a merchant feed is the violation this gate exists to prevent.
  // All three carry a stock observation and a popularity count, so absence here is the gate working
  // rather than an incomplete fixture being dropped for some other reason.
  const credentials = { google: "google-merchant", meta: "meta-catalog" } as const
  for (const [destination, username] of Object.entries(credentials)) {
    const feed = await request.get(`/feeds/${destination}`, {
      headers: {
        authorization: `Basic ${Buffer.from(`${username}:${merchantFeedPassword}`, "utf8").toString("base64")}`,
      },
    })
    expect(feed.status()).toBe(200)
    const body = await feed.text()
    expect(body).not.toContain("f1de0000000000000000ca01")
    expect(body).not.toContain("f1de0000000000000000ca02")
    expect(body).toContain("f1de0000000000000000ca03")
  }
})
