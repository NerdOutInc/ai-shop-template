import type { Metadata } from "next"
import { DropConfirmationPanel } from "@/features/drop-signup/drop-confirmation-panel"

export const metadata: Metadata = {
  title: "Confirm signup",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
}
export default function ConfirmSignupPage() {
  return (
    <main id="main-content" tabIndex={-1} className="page-width py-14 outline-none sm:py-20">
      <p className="font-condensed mb-3 text-sm font-bold tracking-widest uppercase">Design of the week</p>
      <DropConfirmationPanel />
    </main>
  )
}
