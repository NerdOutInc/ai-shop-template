import { CheckoutError } from "@/features/checkout/checkout-error"
import { checkoutErrorResponse } from "@/features/checkout/checkout-error-response"
import { createCheckout } from "@/features/checkout/create-checkout.server"
import { getCommerceServices } from "@/features/checkout/get-commerce-services.server"
import { hostedCheckoutRequestSchema } from "@/features/checkout/hosted-checkout-request"
import { readCheckoutBody } from "@/features/checkout/read-checkout-body.server"

export const runtime = "nodejs"
export const maxDuration = 60

export async function POST(request: Request) {
  try {
    const services = getCommerceServices()
    if (request.headers.get("origin") !== services.siteUrl)
      throw new CheckoutError("INVALID_ORIGIN", "Please open checkout from the shop.", 403)
    let body: unknown
    try {
      body = JSON.parse(await readCheckoutBody(request)) as unknown
    } catch (error) {
      if (error instanceof CheckoutError) throw error
      throw new CheckoutError("INVALID_REQUEST", "Please check the items and delivery details in your bag.", 400)
    }
    const parsed = hostedCheckoutRequestSchema.safeParse(body)
    if (!parsed.success)
      throw new CheckoutError("INVALID_REQUEST", "Please check the items and delivery details in your bag.", 400)
    await services.capacity.admit(request.headers)
    // Honor the browser's privacy signal even if a stale tab still sends previously captured metadata.
    if (request.headers.get("sec-gpc") === "1" && "attribution" in parsed.data) delete parsed.data.attribution
    return Response.json(await createCheckout(services, parsed.data), { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    return checkoutErrorResponse(error)
  }
}
