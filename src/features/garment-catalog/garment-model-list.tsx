"use client"

import { useEffect, useRef } from "react"

import { Badge } from "@/components/ui/badge"

import type { AdminGarment, ShopCategory } from "./garment-catalog"
import { garmentDisplayName } from "./garment-display-name"
import { GarmentModelForm } from "./garment-model-form"

type GarmentModelListProps = {
  categories: ShopCategory[]
  garments: AdminGarment[]
  /** Active products whose published snapshot names no readable blueprint. */
  productsWithoutBlueprint: number
}

/**
 * Every Printify blueprint the shop has set up or has published products on, split by the
 * database's own `complete` answer. Nothing here recomputes it: a save refreshes the page and the
 * two sections are regrouped from whatever the server then reports.
 *
 * Each card is `#garment-{blueprintId}` and focusable, because that is where a product row's
 * "Garment setup missing" link lands.
 */
export function GarmentModelList({ categories, garments, productsWithoutBlueprint }: GarmentModelListProps) {
  const savedId = useRef<number | null>(null)
  const needsSetup = garments.filter((garment) => !garment.complete)
  const ready = garments.filter((garment) => garment.complete)

  // The browser scrolls to a fragment but leaves focus at the top of the page, so a keyboard user
  // following a row's link would have to Tab through every other garment to reach this one.
  useEffect(() => {
    function focusLinkedGarment() {
      // Matched before it is used, so nothing from the address bar reaches a DOM lookup unchecked.
      const id = /^#(garment-[1-9]\d{0,8})$/.exec(window.location.hash)?.[1]
      if (id) document.getElementById(id)?.focus()
    }
    focusLinkedGarment()
    window.addEventListener("hashchange", focusLinkedGarment)
    return () => window.removeEventListener("hashchange", focusLinkedGarment)
  }, [])

  // A garment that becomes complete moves to the other list, which remounts its card and drops
  // focus to the top of the page. Follow it, unless the owner has already moved on. Landing on the
  // card also reads out its new state, which is how a screen reader learns the save made it ready.
  useEffect(() => {
    const id = savedId.current
    if (id === null) return
    savedId.current = null
    if (document.activeElement && document.activeElement !== document.body) return
    document.getElementById(`garment-${id}`)?.focus()
  }, [garments])

  function followSavedGarment(blueprintId: number) {
    savedId.current = blueprintId
  }

  return (
    <div className="flex flex-col gap-8">
      {productsWithoutBlueprint > 0 && (
        // The count is every such product, on the wall or off it, and only the hidden ones are
        // refused anything: one already in the shop stays there. So the sentence says "once hidden".
        <p className="rounded-lg border p-4 text-sm">
          {productsWithoutBlueprint === 1
            ? "1 published product names no Printify blueprint in its saved details, so no garment can be matched to it. Once hidden, it cannot be shown or scheduled."
            : `${productsWithoutBlueprint} published products name no Printify blueprint in their saved details, so no garment can be matched to them. Once hidden, they cannot be shown or scheduled.`}{" "}
          Publishing {productsWithoutBlueprint === 1 ? "it" : "them"} again from Printify refreshes those details.
        </p>
      )}
      <GarmentSection
        heading="Needs setup"
        headingId="garments-needs-setup-heading"
        label="Garments that need setup"
        garments={needsSetup}
        categories={categories}
        empty="Nothing is waiting on setup. Every garment your published products use is ready for the shop."
        onSaved={followSavedGarment}
      />
      <GarmentSection
        heading="Ready"
        headingId="garments-ready-heading"
        label="Ready garments"
        garments={ready}
        categories={categories}
        empty="No garment is ready yet. Finish one above and it moves down here."
        onSaved={followSavedGarment}
      />
    </div>
  )
}

function GarmentSection({
  heading,
  headingId,
  label,
  garments,
  categories,
  empty,
  onSaved,
}: {
  heading: string
  headingId: string
  label: string
  garments: AdminGarment[]
  categories: ShopCategory[]
  empty: string
  onSaved: (blueprintId: number) => void
}) {
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h2 id={headingId} className="font-condensed text-xl font-bold tracking-wide uppercase">
        {heading}
      </h2>
      {garments.length ? (
        <ul aria-label={label} className="flex flex-col gap-4">
          {garments.map((garment) => {
            const titleId = `garment-${garment.blueprintId}-title`
            return (
              <li
                key={garment.blueprintId}
                id={`garment-${garment.blueprintId}`}
                tabIndex={-1}
                aria-labelledby={titleId}
                className="flex scroll-mt-6 flex-col gap-4 rounded-lg border p-4 sm:p-6"
              >
                <div className="flex flex-col gap-1">
                  <div id={titleId} className="flex flex-wrap items-center gap-2">
                    <h3 className="font-condensed text-lg leading-tight font-semibold break-words">
                      {garmentDisplayName(garment)}
                    </h3>
                    <Badge variant={garment.complete ? "default" : "outline"}>
                      {garment.complete ? "Ready" : "Needs setup"}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Printify blueprint {garment.blueprintId}
                    {!garment.known &&
                      `. Found on ${garment.productCount} published ${
                        garment.productCount === 1 ? "product" : "products"
                      }, ${garment.shownCount} shown; not set up yet`}
                  </p>
                </div>
                <GarmentModelForm garment={garment} categories={categories} onSaved={onSaved} />
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">{empty}</p>
      )}
    </section>
  )
}
