import type { Metadata } from "next"
import Link from "next/link"

import { ProductsSectionNav } from "@/app/admin/products/_components/products-section-nav"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { requireAdmin } from "@/features/admin/require-admin.server"
import { DropEmailHistory } from "@/features/drop-emails/drop-email-history"
import { DropEmailTestSend } from "@/features/drop-emails/drop-email-test-send"
import { readDropEmailOverview } from "@/features/drop-emails/read-drop-email-overview.server"
import { readDropEmailSetup } from "@/features/drop-emails/read-drop-email-setup.server"
import { renderNextDropEmail, type NextDropEmail } from "@/features/drop-emails/render-next-drop-email.server"
import { readSignupConfirmationSetup } from "@/features/drop-signup/read-signup-confirmation-setup.server"
import { env } from "@/lib/env"
import { formatStoreMoment } from "@/lib/format-store-moment"

export const metadata: Metadata = { title: "Drop emails", robots: { index: false, follow: false } }
export const dynamic = "force-dynamic"

const day = (value: string) => formatStoreMoment(value, { weekday: "long", month: "long", day: "numeric" })
const time = (value: string) => formatStoreMoment(value, { hour: "numeric", minute: "2-digit", timeZoneName: "short" })

export default async function AdminDropEmailsPage() {
  // First, before any read: the proxy only refreshes the session, so this call is the page's lock.
  await requireAdmin()
  const setup = readDropEmailSetup()
  const confirmation = readSignupConfirmationSetup()
  const [overview, next] = await Promise.all([
    readDropEmailOverview(),
    renderNextDropEmail().catch((): NextDropEmail | { status: "unavailable" } => {
      console.warn("Next drop email unavailable", { reason: "storage" })
      return { status: "unavailable" }
    }),
  ])
  const off = [
    setup.missing.length > 0 && `Set ${setup.missing.join(", ")} in Vercel.`,
    setup.storeSettings.length > 0 &&
      `Set ${setup.storeSettings.join(", ")} to true in src/lib/store-config-values.ts.`,
    env.DROP_EMAILS_ENABLED !== "true" && "Set DROP_EMAILS_ENABLED to true when you're ready.",
    env.VERCEL_ENV !== "production" && "Drop emails only ever go out from the production site.",
  ].filter((reason) => typeof reason === "string")

  return (
    <main id="main-content" tabIndex={-1} className="page-width flex flex-col gap-8 py-10 sm:py-14">
      <header className="max-w-2xl">
        <p className="font-condensed mb-3 text-sm font-semibold tracking-widest text-muted-foreground uppercase">
          Products
        </p>
        <h1 className="display-heading">Drop emails</h1>
        <p className="mt-4 text-muted-foreground">
          Everyone on the list hears about each Design of the Week once: at 9 AM store time on the drop&rsquo;s day, or
          when the drop goes live if that is later. One email, just the drop, with a one-click unsubscribe. A week with
          nothing scheduled sends nothing. Short, sweet, and never a surprise sequel.
        </p>
      </header>
      <ProductsSectionNav current="emails" />

      <section aria-labelledby="drop-email-sending" className="max-w-2xl rounded-lg border p-4">
        <h2 id="drop-email-sending" className="font-condensed text-xl font-semibold">
          {setup.sending ? "Sending is on" : "Sending is off"}
        </h2>
        {setup.sending ? (
          <p className="mt-1 text-sm text-muted-foreground">Emails go out from {setup.from}.</p>
        ) : (
          <ul className="mt-2 list-disc pl-5 text-sm text-muted-foreground">
            {off.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="signup-confirmation-sending" className="max-w-2xl rounded-lg border p-4">
        <h2 id="signup-confirmation-sending" className="font-condensed text-xl font-semibold">
          {confirmation.sending ? "Signup confirmation sending is on" : "Signup confirmation sending is off"}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {confirmation.sending
            ? `Confirmation requests are limited to ${confirmation.hourlyLimit} per rolling hour across this store.`
            : "New signups are unavailable. Review the production sender, SIGNUP_CONFIRMATIONS_ENABLED and the authenticated 15-minute worker with setup:check before opening signup."}{" "}
          Weekly sending is a separate switch.
        </p>
      </section>

      <section aria-labelledby="drop-email-subscribers" className="max-w-2xl">
        <h2 id="drop-email-subscribers" className="font-condensed text-xl font-semibold">
          Subscribers
        </h2>
        {overview.status === "ready" ? (
          <p className="mt-1">
            {overview.subscribed} eligible · {overview.pending} awaiting confirmation · {overview.unsubscribed}{" "}
            unsubscribed
          </p>
        ) : (
          <Alert variant="destructive" className="mt-2">
            <AlertDescription>
              The list is unavailable right now. Check that the latest migration has been pushed.
            </AlertDescription>
          </Alert>
        )}
        <p className="mt-1 text-sm text-muted-foreground">Counts only. Addresses never appear in the admin.</p>
      </section>

      <section aria-labelledby="drop-email-next" className="flex flex-col gap-4">
        <h2 id="drop-email-next" className="font-condensed text-xl font-semibold">
          Next email
        </h2>
        {next.status === "ready" ? (
          <>
            <div className="max-w-2xl">
              <p>
                For the {day(next.liveAt)} drop, going out at {time(next.sendAt)}
                {setup.sending ? "" : " if sending is on by then"}.
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Subject: <span className="text-foreground">{next.subject}</span>
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Built from the shop as it stands at send time, so a product hidden or sold out by then is left out.
              </p>
            </div>
            <iframe
              src="/api/admin/drop-emails/preview"
              title={`Preview of the email for the ${day(next.liveAt)} drop`}
              sandbox=""
              className="h-[720px] w-full max-w-[680px] rounded-lg border bg-white"
            />
            <DropEmailTestSend />
          </>
        ) : (
          <div className="max-w-2xl">
            <p>
              {next.status === "empty"
                ? `The ${day(next.liveAt)} drop has nothing that can go in an email yet: its products are hidden for good or sold out.`
                : next.status === "none"
                  ? "Nothing is scheduled, so there's no email to preview."
                  : "The next email can't be previewed right now. Try again shortly."}{" "}
              {next.status !== "unavailable" && (
                <Link href="/admin/products" className="underline underline-offset-4">
                  Open the Shop lineup
                </Link>
              )}
            </p>
            <div className="mt-4">
              <DropEmailTestSend unavailableReason="A test needs an upcoming drop with products in it." />
            </div>
          </div>
        )}
      </section>

      <section aria-labelledby="drop-email-history" className="flex max-w-2xl flex-col gap-4">
        <h2 id="drop-email-history" className="font-condensed text-xl font-semibold">
          Sent so far
        </h2>
        {overview.status === "ready" ? (
          <DropEmailHistory entries={overview.history} />
        ) : (
          <Alert variant="destructive">
            <AlertDescription>The send history is unavailable right now.</AlertDescription>
          </Alert>
        )}
      </section>
    </main>
  )
}
