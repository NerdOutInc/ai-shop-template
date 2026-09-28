export type DisplayImageSize = "small" | "medium" | "large"

/**
 * Longest-edge pixel budgets for browsing artwork, at roughly twice the widest card each
 * density renders so a high-density screen still gets exact pixels.
 *
 * Print masters are 4200x4800, and a gallery page holds up to 48 of them. Serving those
 * directly costs megabytes per card and decodes to about 77 MiB of RGBA each.
 */
export const DISPLAY_IMAGE_SIZES: Record<DisplayImageSize, number> = {
  small: 480,
  medium: 800,
  large: 1440,
}
