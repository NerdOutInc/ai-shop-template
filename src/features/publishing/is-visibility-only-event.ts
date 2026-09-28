import type { PublishingEvent } from "./publishing-event"

export function isVisibilityOnlyEvent(event: PublishingEvent): boolean {
  return event.action === "update" && !Object.values(event.publishDetails).some(Boolean)
}
