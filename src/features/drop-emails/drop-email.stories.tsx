import type { Meta, StoryObj } from "@storybook/nextjs-vite"
import { render } from "react-email"
import { expect, waitFor } from "storybook/test"

import { storeConfig } from "@/lib/store-config"

import { DropEmail } from "./drop-email"
import type { DropEmailProduct } from "./drop-email-product"
import { formatDropEmailSubject } from "./format-drop-email-subject"

// Real sends carry the shop's public mockups; a story has to work offline.
const sampleImage = (color: string, label: string) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="536" height="536"><rect width="536" height="536" fill="#eff3f0"/><path d="M181 121 107 175 154 248 188 228V416H348V228L382 248 429 175 355 121 308 141H228Z" fill="${color}"/><text x="268" y="480" text-anchor="middle" font-family="sans-serif" font-size="18" fill="#17262d">Illustrative test image: ${label}</text></svg>`)}`
const linesTee: DropEmailProduct = {
  id: "0a1b2c3d4e5f60718293a4b5",
  title: "Abstract Lines - Premium T-Shirt",
  image: { src: sampleImage("#222222", "tee"), alt: "Abstract Lines printed on a tee" },
  price: { min: 3000, max: 3400 },
}
const linesCrop: DropEmailProduct = {
  id: "5b4a3c2d1e0f98877665a4b3",
  title: "Abstract Lines - Festival Crop Top",
  image: { src: sampleImage("#bc735c", "crop top"), alt: "Abstract Lines printed on a crop top" },
  price: { min: 3200, max: 3200 },
}

/**
 * The email exactly as a mail app receives it: rendered to HTML and shown in a frame of its own, so
 * none of the site's styles can leak in and flatter it.
 */
const meta = {
  title: "Emails/Drop email",
  component: DropEmail,
  parameters: { layout: "padded" },
  args: {
    products: [linesTee, linesCrop],
    designNames: ["Abstract Lines"],
    siteUrl: "https://store.example",
    unsubscribeUrl: "https://store.example/unsubscribe/00000000-0000-4000-8000-000000000000",
    postalAddress: "PO Box 123, Austin, TX 78701",
    campaign: "dotw-2026-10-05",
  },
  loaders: [async ({ args }) => ({ html: await render(<DropEmail {...args} />) })],
  render: (args, { loaded }) => (
    <figure className="flex flex-col gap-3">
      <figcaption className="text-sm">
        <strong>Subject:</strong> {formatDropEmailSubject(args.designNames)}
      </figcaption>
      <iframe
        title="Drop email"
        srcDoc={loaded.html}
        className="h-[1500px] w-[640px] max-w-full rounded-lg border bg-white"
      />
    </figure>
  ),
} satisfies Meta<typeof DropEmail>

export default meta
type Story = StoryObj<typeof meta>

const frameDocument = async (canvasElement: HTMLElement) => {
  const frame = canvasElement.querySelector("iframe")!
  await waitFor(() => expect(frame.contentDocument?.body.textContent).toContain("This week’s picks."))
  return frame.contentDocument!
}

/** One design on two garments: named once in the subject, listed as two products. */
export const OneDesignTwoGarments: Story = {
  play: async ({ canvas, canvasElement }) => {
    await expect(canvas.getByText("New this week: Abstract Lines")).toBeVisible()
    const text = (await frameDocument(canvasElement)).body.textContent
    await expect(text).toContain(storeConfig.name)
    await expect(text).toContain("Abstract Lines - Festival Crop Top")
    await expect(text).toContain("From $30.00")
    await expect(text).toContain("Unsubscribe")
    await expect(text).toContain("PO Box 123")
  },
}

export const SeveralDesigns: Story = {
  args: {
    products: [
      linesTee,
      { ...linesTee, id: "fern", title: "Fern Study - Premium T-Shirt" },
      { ...linesCrop, id: "garden", title: "Night Garden - Festival Crop Top" },
    ],
    designNames: ["Abstract Lines", "Fern Study", "Night Garden"],
  },
  play: async ({ canvas, canvasElement }) => {
    await expect(canvas.getByText("New this week: Abstract Lines, Fern Study and 1 more")).toBeVisible()
    await expect((await frameDocument(canvasElement)).body.textContent).toContain(
      "Abstract Lines, Fern Study, and Night Garden are in the shop now."
    )
  },
}

/** A product with no usable photo still gets its name, price and button, and no broken image. */
export const WithoutAPhoto: Story = {
  args: { products: [{ ...linesTee, image: null }] },
  play: async ({ canvasElement }) => {
    await expect((await frameDocument(canvasElement)).querySelectorAll("img")).toHaveLength(0)
  },
}
