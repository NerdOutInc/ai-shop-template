import { within } from "@testing-library/react"
import { renderToStaticMarkup } from "react-dom/server"
import { ImageConfigContext } from "next/dist/shared/lib/image-config-context.shared-runtime"
import { imageConfigDefault } from "next/dist/shared/lib/image-config"
import { describe, expect, it } from "vitest"

import { ProductImageGallery } from "./product-image-gallery"

describe("ProductImageGallery image delivery", () => {
  it("server-renders an eager main mockup and smaller lazy thumbnails with original view URLs", () => {
    const sources = [
      "https://images-api.printify.com/mockup/product/variant/camera/shirt.jpg?camera_label=front",
      "https://images-api.printify.com/mockup/product/variant/camera/shirt.jpg?camera_label=person-1-front",
    ]
    const container = document.createElement("div")
    container.innerHTML = renderToStaticMarkup(
      <ImageConfigContext.Provider
        value={{
          ...imageConfigDefault,
          remotePatterns: [
            { protocol: "https", hostname: "images-api.printify.com", port: "", pathname: "/mockup/**" },
          ],
        }}
      >
        <ProductImageGallery
          title="Graphic shirt"
          images={sources.map((src, index) => ({ src, alt: `View ${index + 1}`, variantIds: [1] }))}
          artwork={null}
          placeholder="No photo"
          onSlideSelect={() => {}}
        />
      </ImageConfigContext.Provider>
    )
    const photos = [...container.querySelectorAll(".product-main-image")]
    const thumbnails = [...container.querySelectorAll(".product-thumbnail img")]
    expect(photos).toHaveLength(2)
    expect(thumbnails).toHaveLength(2)
    for (const [index, photo] of photos.entries()) {
      const url = new URL(photo.getAttribute("src") ?? "", "https://example.com")
      const thumbnailUrl = new URL(thumbnails[index]!.getAttribute("src") ?? "", "https://example.com")
      expect(url.pathname).toBe("/_next/image")
      expect(url.searchParams.get("url")).toBe(sources[index])
      expect(thumbnailUrl.searchParams.get("url")).toBe(sources[index])
      expect(thumbnails[index]).toHaveAttribute("sizes", "(max-width: 640px) 56px, 74px")
      expect(thumbnails[index]).toHaveAttribute("loading", "lazy")
    }
    expect(photos[0]).toHaveAttribute("loading", "eager")
    expect(photos[0]).toHaveAttribute("fetchpriority", "high")
    expect(photos[1]).toHaveAttribute("loading", "lazy")
    expect(photos[1]).not.toHaveAttribute("fetchpriority")
  })

  it("retains direct delivery for fixture SVGs and alternate provider URLs", () => {
    const sources = ["data:image/svg+xml,%3Csvg%3E%3C/svg%3E", "https://images.printify.com/shirt.jpg"]
    const container = document.createElement("div")
    container.innerHTML = renderToStaticMarkup(
      <ProductImageGallery
        title="Graphic shirt"
        images={sources.map((src) => ({ src, alt: "Mockup", variantIds: [1] }))}
        artwork={null}
        placeholder="No photo"
        onSlideSelect={() => {}}
      />
    )
    expect([...container.querySelectorAll(".product-main-image")].map((image) => image.getAttribute("src"))).toEqual(
      sources
    )
  })
})

describe("ProductImageGallery photo origin", () => {
  it("marks store photographs on slides and thumbnails so they skip mockup blending", () => {
    const container = document.createElement("div")
    container.innerHTML = renderToStaticMarkup(
      <ProductImageGallery
        title="Graphic shirt"
        images={[
          { src: "/mockup.png", alt: "Provider mockup" },
          { src: "/photo.jpg", alt: "Store photo", origin: "store" },
        ]}
        artwork={null}
        placeholder="No photo"
        onSlideSelect={() => {}}
      />
    )
    const origins = (selector: string) =>
      [...container.querySelectorAll(selector)].map((image) => image.getAttribute("data-photo-origin"))
    expect(origins(".product-main-image")).toEqual([null, "store"])
    expect(origins(".product-thumbnail img")).toEqual([null, "store"])
  })
})

describe("ProductImageGallery New badge", () => {
  function renderGallery(isNew?: boolean) {
    const container = document.createElement("div")
    container.innerHTML = renderToStaticMarkup(
      <ProductImageGallery
        title="Graphic shirt"
        images={["/front.jpg", "/back.jpg"].map((src) => ({ src, alt: "Mockup", variantIds: [1] }))}
        artwork={{ src: "/artwork.webp", alt: "Artwork", backgroundColor: "#222222" }}
        placeholder="No photo"
        isNew={isNew}
        onSlideSelect={() => {}}
      />
    )
    return container
  }

  it("server-renders one badge on the frame, outside every slide, for a new product", () => {
    const badges = within(renderGallery(true)).getAllByText("New")
    expect(badges).toHaveLength(1)
    expect(badges[0]!.closest('[aria-roledescription="carousel"]')).not.toBeNull()
    expect(badges[0]!.closest('[aria-roledescription="slide"]')).toBeNull()
  })

  it("renders no badge otherwise", () => {
    expect(within(renderGallery()).queryByText("New")).not.toBeInTheDocument()
    expect(within(renderGallery(false)).queryByText("New")).not.toBeInTheDocument()
  })
})
