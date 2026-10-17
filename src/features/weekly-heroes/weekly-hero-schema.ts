import { z } from "zod"

const rect = z
  .object({
    x: z.number().min(0).max(98),
    y: z.number().min(0).max(98),
    width: z.number().min(2).max(100),
    height: z.number().min(2).max(100),
  })
  .strict()
  .refine((r) => r.x + r.width <= 100 && r.y + r.height <= 100, "Keep the link area inside the image.")
const link = z
  .object({
    productId: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),
    label: z.string().trim().min(1).max(120),
    color: z.string().trim().max(100),
    desktop: rect.refine(
      (r) => r.x >= 25 && r.x + r.width <= 75,
      "Keep desktop links inside the central half of the panorama."
    ),
    mobile: rect,
  })
  .strict()

export const weeklyHeroSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    alt: z.string().trim().min(10).max(600),
    offer: z.string().trim().max(120),
    desktopAssetId: z.uuid().transform((id) => id.toLowerCase()),
    mobileAssetId: z.uuid().transform((id) => id.toLowerCase()),
    links: z.array(link).min(1).max(6),
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.links.map((link) => link.productId)).size !== value.links.length)
      context.addIssue({ code: "custom", message: "Choose different products for each destination." })
    for (const kind of ["desktop", "mobile"] as const) {
      for (let i = 0; i < value.links.length; i++)
        for (let j = i + 1; j < value.links.length; j++) {
          const a = value.links[i]![kind],
            b = value.links[j]![kind]
          if (a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y)
            context.addIssue({ code: "custom", message: `The ${kind} product links must not overlap.` })
        }
    }
  })
export type WeeklyHeroManifest = z.infer<typeof weeklyHeroSchema>
export type HeroRect = z.infer<typeof rect>
export type HeroAsset = { id: string; kind: "desktop" | "mobile"; width: number; height: number }
export type WeeklyHero = {
  liveAt: string
  version: string
  scheduled: boolean
  manifest: WeeklyHeroManifest
  desktop: HeroAsset
  mobile: HeroAsset
}

export type WeeklyHeroDraft = { version: string; scheduled: boolean; hero: WeeklyHero | null }
