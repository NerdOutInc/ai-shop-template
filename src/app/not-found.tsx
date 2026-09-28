import Link from "next/link"

import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/cn"

export default function NotFound() {
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="mx-auto flex min-h-svh max-w-3xl flex-col justify-center px-6 py-16"
    >
      <p className="text-sm text-muted-foreground">404 — Page not found</p>
      <h1 className="mt-5 text-5xl leading-tight font-black tracking-tight text-balance sm:text-6xl">
        This page has wandered off.
      </h1>
      <p className="mt-6 text-lg text-muted-foreground">
        The page you’re looking for isn’t here. Let’s get you back to the shop.
      </p>
      {/* Base UI Button applies a button role; keep home navigation a semantic link. */}
      <Link href="/" className={cn(buttonVariants(), "mt-8 min-h-11 self-start px-6")}>
        Back to home
      </Link>
    </main>
  )
}
