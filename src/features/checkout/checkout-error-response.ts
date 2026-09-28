import { CheckoutError } from "./checkout-error"

export function checkoutErrorResponse(error: unknown) {
  const known = error instanceof CheckoutError
  return Response.json(
    {
      error: known ? error.message : "The shop hit a tricky hold. Please try again shortly.",
      code: known ? error.code : "CHECKOUT_UNAVAILABLE",
    },
    {
      status: known ? error.status : 503,
      headers: { "Cache-Control": "no-store" },
    }
  )
}
