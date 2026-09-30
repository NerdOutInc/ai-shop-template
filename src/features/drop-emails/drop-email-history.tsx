import { formatStoreMoment } from "@/lib/format-store-moment"

import type { DropEmailHistoryEntry } from "./drop-email-history-entry"

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

/** Newest first. A list rather than a table so it reads the same on a phone. */
export function DropEmailHistory({ entries }: { entries: DropEmailHistoryEntry[] }) {
  if (entries.length === 0)
    return (
      <p className="text-muted-foreground">
        No drop emails yet. The first one goes out on the day of the next drop, once sending is on.
      </p>
    )

  return (
    <ol className="flex flex-col gap-3">
      {entries.map((entry) => {
        const notes = [
          entry.pending > 0 && `${entry.pending} still sending`,
          entry.failed > 0 && `${entry.failed} failed`,
          entry.unsubscribed > 0 && `${entry.unsubscribed} unsubscribed before it reached them`,
        ].filter(Boolean)
        return (
          <li key={entry.liveAt} className="rounded-lg border p-4">
            <h3 className="font-condensed text-lg font-semibold">
              {formatStoreMoment(entry.liveAt, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
            </h3>
            <p className="mt-1 break-words">{entry.subject}</p>
            <p className="mt-2 text-sm text-muted-foreground">
              {entry.recipients === 0
                ? "Nobody was on the list yet."
                : `Sent to ${entry.sent} of ${plural(entry.recipients, "subscriber", "subscribers")}.`}{" "}
              {plural(entry.productCount, "product", "products")}.
              {entry.firstSentAt
                ? ` First sent at ${formatStoreMoment(entry.firstSentAt, { hour: "numeric", minute: "2-digit", timeZoneName: "short" })}.`
                : ""}
            </p>
            {notes.length > 0 && <p className="mt-1 text-sm font-medium text-destructive">{notes.join(" · ")}</p>}
          </li>
        )
      })}
    </ol>
  )
}
