"use client"

import { CalendarDays, ChevronDown, Eye, EyeOff, ArrowUp, ArrowDown } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

import type { FeaturedOrderProduct } from "./featured-order-product"

export function ProductActionsMenu({
  product,
  hidden,
  busy,
  scheduled,
  onToggleHidden,
  onSchedule,
  onMove,
  index,
  count,
}: {
  product: FeaturedOrderProduct
  hidden: boolean
  busy?: boolean
  scheduled?: boolean
  onToggleHidden?: () => void
  onSchedule?: () => void
  onMove?: (direction: "up" | "down") => void
  index?: number
  count?: number
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="outline" className="min-h-11 shrink-0" />}
        aria-label={`Actions for ${product.title}`}
        data-visibility-toggle={product.id}
        disabled={busy}
      >
        Actions <ChevronDown aria-hidden="true" data-icon="inline-end" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          {onToggleHidden && (
            <DropdownMenuItem disabled={hidden && Boolean(product.garmentSetup)} onClick={onToggleHidden}>
              {hidden ? <Eye aria-hidden="true" /> : <EyeOff aria-hidden="true" />}
              {hidden ? "Show in shop" : "Hide from shop"}
            </DropdownMenuItem>
          )}
          {onSchedule && (
            <DropdownMenuItem disabled={hidden && Boolean(product.garmentSetup)} onClick={onSchedule}>
              <CalendarDays aria-hidden="true" />
              {scheduled ? "Change featured week" : "Add to Design of the week"}
            </DropdownMenuItem>
          )}
        </DropdownMenuGroup>
        {onMove && (
          <>
            <DropdownMenuSeparator />
            {/* A hidden tee is not in the shop; its order is where it will land once it is shown. */}
            <DropdownMenuGroup>
              <DropdownMenuItem disabled={index === 0} onClick={() => onMove("up")}>
                <ArrowUp aria-hidden="true" /> {hidden ? "Move up" : "Move up in shop"}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={index === (count ?? 0) - 1} onClick={() => onMove("down")}>
                <ArrowDown aria-hidden="true" /> {hidden ? "Move down" : "Move down in shop"}
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
