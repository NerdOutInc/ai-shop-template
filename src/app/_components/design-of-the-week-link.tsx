"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useRef } from "react"

function focusWeeklySection() {
  const section = document.getElementById("design-of-the-week")
  if (!section) return
  // Only make the region focusable for an intentional navigation, not a direct fragment load.
  section.tabIndex = -1
  section.focus({ preventScroll: true })
}

export function DesignOfTheWeekLink() {
  const href = "/#design-of-the-week"
  const pathname = usePathname()
  const previousPathname = useRef(pathname)

  useEffect(() => {
    const changedRoute = previousPathname.current !== pathname
    previousPathname.current = pathname
    // A full load already handles the fragment. Hydration must not interrupt someone typing.
    if (changedRoute && pathname === "/" && window.location.hash === "#design-of-the-week") {
      focusWeeklySection()
    }
  }, [pathname])

  return (
    <Link
      href={href}
      className="inline-flex min-h-11 items-center"
      onNavigate={() => {
        // Same-page fragment navigation scrolls without changing the route or moving focus.
        focusWeeklySection()
      }}
    >
      Design of the week
    </Link>
  )
}
