import { getAdminActor } from "@/features/admin/get-admin-actor.server"
import { dropEmailPreviewToken } from "@/features/drop-emails/drop-email-preview-token"
import { dropEmailSubscriberPlaceholder } from "@/features/drop-emails/drop-email-subscriber-placeholder"
import { renderNextDropEmail } from "@/features/drop-emails/render-next-drop-email.server"
import { privateResponseHeaders } from "@/lib/private-response-headers"

export const dynamic = "force-dynamic"

const text = (body: string, status: number) =>
  new Response(body, { status, headers: { ...privateResponseHeaders, "Content-Type": "text/plain; charset=utf-8" } })

/**
 * The next drop's email as a document of its own, for the Drop emails page's iframe. Sandboxed by its
 * own policy as well as the frame's, and frameable only by this site.
 */
export async function GET() {
  if (!(await getAdminActor())) return text("Sign in as an administrator.", 401)
  try {
    const next = await renderNextDropEmail()
    if (next.status !== "ready") return text("There is no drop email to preview yet.", 404)
    return new Response(next.html.replaceAll(dropEmailSubscriberPlaceholder, dropEmailPreviewToken), {
      headers: {
        ...privateResponseHeaders,
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy":
          "default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; frame-ancestors 'self'; sandbox",
      },
    })
  } catch {
    console.warn("Drop email preview unavailable", { reason: "storage" })
    return text("The preview is unavailable right now.", 503)
  }
}
