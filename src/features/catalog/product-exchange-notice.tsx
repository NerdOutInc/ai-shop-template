import Link from "next/link"

import { storeConfig } from "@/lib/store-config"

export function ProductExchangeNotice() {
  if (!storeConfig.configured || !storeConfig.policies.published) return null
  const summary = storeConfig.policies.returnsText[0]
  if (!summary) return null

  return (
    <aside aria-label="Returns summary" className="mb-4 text-sm leading-relaxed text-muted-foreground">
      <p>{summary}</p>
      <Link
        className="flex min-h-11 w-fit items-center underline underline-offset-4 hover:text-foreground"
        href="/returns"
      >
        Returns & order help
      </Link>
    </aside>
  )
}
