import { connection } from "next/server"
import { readSignupConfirmationSetup } from "@/features/drop-signup/read-signup-confirmation-setup.server"
import { DropSignupForm } from "@/features/drop-signup/drop-signup-form"

export async function HomeSignup() {
  await connection()
  return (
    <section aria-label="New design updates" className="page-width py-10 sm:py-14">
      {readSignupConfirmationSetup().sending ? (
        <DropSignupForm ready source="home" />
      ) : (
        <p className="text-sm text-muted-foreground">New design email signups are paused right now. Check back soon.</p>
      )}
    </section>
  )
}
