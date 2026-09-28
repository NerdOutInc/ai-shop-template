import "server-only"

import type Stripe from "stripe"
import { z } from "zod"

import { CheckoutError } from "./checkout-error"
import { shippingAddressSchema, type ShippingAddress } from "./shipping-address"

const addressSchema = shippingAddressSchema.extend({
  // Printify requires the field, but its address schema permits an empty surname for a mononym.
  lastName: shippingAddressSchema.shape.lastName.or(z.literal("")),
})
const nameSchema = z
  .string()
  .trim()
  .min(1)
  .max(201)
  .refine((name) => !/[\u0000-\u001f\u007f]/.test(name))

export function readStripeShippingAddress(session: Stripe.Checkout.Session): ShippingAddress {
  // The billing address can belong to a different person. Only Checkout's delivery details are authoritative.
  const shipping = session.collected_information?.shipping_details
  const name = nameSchema.safeParse(shipping?.name)
  const address = shipping?.address
  if (!name.success || !address) {
    throw new CheckoutError("SHIPPING_ADDRESS_INVALID", "Your delivery details need our attention before printing.")
  }
  const [firstName, ...remainingNames] = name.data.split(/\s+/)
  const parsed = addressSchema.safeParse({
    firstName,
    lastName: remainingNames.join(" "),
    email: session.customer_details?.email,
    phone: session.customer_details?.phone,
    country: address.country?.trim().toUpperCase(),
    region: address.state?.trim().toUpperCase(),
    city: address.city,
    address1: address.line1,
    address2: address.line2 ?? "",
    zip: address.postal_code?.trim(),
  })
  if (!parsed.success) {
    const unsupported = parsed.error.issues.some((issue) => ["country", "region"].includes(String(issue.path[0])))
    throw new CheckoutError(
      unsupported ? "SHIPPING_DESTINATION_UNSUPPORTED" : "SHIPPING_ADDRESS_INVALID",
      unsupported
        ? "Your delivery destination needs our attention. We ship to the 50 US states and Washington, DC."
        : "Your delivery details need our attention before printing."
    )
  }
  return parsed.data
}
