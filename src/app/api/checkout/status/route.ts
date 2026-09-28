import { CheckoutError } from "@/features/checkout/checkout-error"
import { buildPurchaseConversion } from "@/features/checkout/build-purchase-conversion.server"
import { buildGooglePurchaseConversion } from "@/features/checkout/build-google-purchase-conversion.server"
import { buildMetaPurchaseConversion } from "@/features/checkout/build-meta-purchase-conversion.server"
import { checkoutErrorResponse } from "@/features/checkout/checkout-error-response"
import { getCommerceServices } from "@/features/checkout/get-commerce-services.server"
import { isCheckoutSessionId } from "@/features/checkout/is-checkout-session-id"

export const runtime = "nodejs"

export async function GET(request: Request) {
  try {
    const sessionId = new URL(request.url).searchParams.get("session_id")
    if (!isCheckoutSessionId(sessionId))
      throw new CheckoutError("INVALID_REQUEST", "This checkout link is invalid.", 400)
    const services = getCommerceServices()
    await services.capacity.admitStatus(request.headers)
    const order = await services.store.findBySession(sessionId)
    if (!order) throw new CheckoutError("ORDER_MISSING", "We could not locate this checkout.", 404)
    await services.capacity.reserveStripeRead()
    const session = await services.stripe.checkout.sessions.retrieve(sessionId)
    const paymentStatus =
      session.payment_status === "paid"
        ? "paid"
        : session.status === "expired"
          ? "expired"
          : order.failureCode === "PAYMENT_FAILED"
            ? "failed"
            : "pending"
    const fulfillmentStatus =
      order.state === "submitted"
        ? "submitted"
        : order.state === "simulated"
          ? "simulated"
          : order.failureCode && !["PROVIDER_PROCESSING", "PAYMENT_FAILED"].includes(order.failureCode)
            ? "action_required"
            : "pending"
    const purchase = buildPurchaseConversion(session, order, services.expectedLivemode)
    return Response.json(
      {
        paymentStatus,
        fulfillmentStatus,
        purchase,
        googlePurchase: buildGooglePurchaseConversion(purchase, order),
        metaPurchase: buildMetaPurchaseConversion(purchase, order),
      },
      { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } }
    )
  } catch (error) {
    return checkoutErrorResponse(error)
  }
}
