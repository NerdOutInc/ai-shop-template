import type { KeyboardCoordinateGetter } from "@dnd-kit/core"
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable"

/** Shop and hidden rows sort locally; a queued product's arrows step through the dated weeks. */
export const productDragCoordinates: KeyboardCoordinateGetter = (event, args) => {
  const { context, currentCoordinates } = args
  const kind = context.active?.data.current?.kind
  if (kind === "lineup" || kind === "hidden") return sortableKeyboardCoordinates(event, args)
  if (!["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(event.code)) return undefined
  event.preventDefault()
  const weeks = context.droppableContainers.getEnabled().filter((item) => item.data.current?.kind === "week")
  const current = weeks.findIndex((item) => item.id === context.over?.id)
  const direction = event.code === "ArrowDown" || event.code === "ArrowRight" ? 1 : -1
  const next =
    current < 0 ? (direction > 0 ? 0 : weeks.length - 1) : Math.max(0, Math.min(weeks.length - 1, current + direction))
  const target = weeks[next]
  const rect = target ? context.droppableRects.get(target.id) : undefined
  const active = context.collisionRect
  if (!rect || !active) return undefined
  return {
    x: currentCoordinates.x + rect.left + rect.width / 2 - active.left - active.width / 2,
    y: currentCoordinates.y + rect.top + rect.height / 2 - active.top - active.height / 2,
  }
}
