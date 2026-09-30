import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { z } from "zod"

import { DropUnsubscribePanel } from "@/features/drop-signup/drop-unsubscribe-panel"
import { getDropSignupStore } from "@/features/drop-signup/get-drop-signup-store.server"

export const metadata: Metadata = { title: "Unsubscribe", robots: { index: false, follow: false } }
// Every token is someone's; nothing about this page may be cached or prerendered.
export const dynamic = "force-dynamic"

type UnsubscribePageProps = { params: Promise<{ token: string }> }

/**
 * Where the email's unsubscribe link lands. It only offers a button: mail security scanners open every
 * link in a message, so a link that unsubscribed on its own would unsubscribe people nobody asked.
 *
 * It says what the list says rather than anything the URL claims, which also covers an old email's
 * link clicked after leaving. A read that fails still offers the button, and the button still works.
 */
export default async function UnsubscribePage({ params }: UnsubscribePageProps) {
  const { token } = await params
  if (!z.uuid().safeParse(token).success) notFound()
  let unsubscribed = false
  try {
    unsubscribed = await getDropSignupStore().isUnsubscribed(token)
  } catch {
    console.warn("Drop unsubscribe status unavailable", { reason: "storage" })
  }

  return (
    <main id="main-content" tabIndex={-1} className="page-width py-14 outline-none sm:py-20">
      <p className="font-condensed mb-3 text-sm font-bold tracking-widest uppercase">Design of the week</p>
      <DropUnsubscribePanel token={token} done={unsubscribed} />
    </main>
  )
}
