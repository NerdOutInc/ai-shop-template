import { cn } from "@/lib/cn"

/**
 * The corner tag for a tee that entered the shop in the last two weeks (isNewProduct), wherever the
 * tee appears: shop cards, the product page gallery and the admin lineup. The image container sets
 * `position: relative`; the tag pins itself to its top-right corner and paints over any artwork
 * overlay. pointer-events-none lets a touch or swipe that starts on the tag fall through to whatever
 * is under it, so it never swallows a card's tap or preview gesture, or a gallery swipe: on the
 * product page the tag sits on the frame, outside the carousel it covers.
 *
 * `compact` is for the admin lineup's 56-64px thumbnail, where the shop size would cover the shirt.
 */
export function NewProductBadge({ size = "default" }: { size?: "default" | "compact" }) {
  return (
    <span
      className={cn(
        "font-condensed pointer-events-none absolute z-10 rounded-sm bg-primary font-bold tracking-wider text-primary-foreground uppercase",
        size === "compact" ? "top-0.5 right-0.5 px-1 text-[10px] leading-4" : "top-2 right-2 px-2 py-1 text-xs"
      )}
    >
      New
    </span>
  )
}
