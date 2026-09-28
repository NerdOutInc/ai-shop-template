import Link from "next/link"

import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/cn"

const sections = [
  { key: "lineup", href: "/admin/products", label: "Shop lineup" },
  { key: "categories", href: "/admin/products/categories", label: "Categories" },
  { key: "garments", href: "/admin/products/garments", label: "Garment models" },
] as const

type ProductsSection = (typeof sections)[number]["key"]

/**
 * The three Products pages, as siblings. Each page says which one it is rather than this reading
 * the pathname: that keeps it a Server Component, and there is deliberately no products/layout.tsx
 * to put a client pathname hook in, because every admin page owns its own <main> and its own
 * requireAdmin() call. The store header already marks "Products" current for all three.
 */
export function ProductsSectionNav({ current }: { current: ProductsSection }) {
  return (
    <nav aria-label="Products sections" className="flex flex-wrap gap-2">
      {sections.map((section) => (
        <Link
          key={section.key}
          href={section.href}
          aria-current={section.key === current ? "page" : undefined}
          className={cn(buttonVariants({ variant: section.key === current ? "default" : "outline" }), "min-h-11")}
        >
          {section.label}
        </Link>
      ))}
    </nav>
  )
}
