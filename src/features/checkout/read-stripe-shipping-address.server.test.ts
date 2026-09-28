import type Stripe from "stripe"
import { describe, expect, it, vi } from "vitest"

import { readStripeShippingAddress } from "./read-stripe-shipping-address.server"

vi.mock("server-only", () => ({}))

describe("Stripe delivery details", () => {
  it("uses the delivery recipient and address even when the payer's details differ", () => {
    expect(readStripeShippingAddress(sessionFixture())).toEqual({
      firstName: "Robin",
      lastName: "River Sample",
      email: "payer@example.com",
      phone: "+16125550101",
      country: "US",
      region: "MN",
      city: "Minneapolis",
      address1: "123 Test Street",
      address2: "",
      zip: "55401",
    })
  })

  it("preserves a recipient who uses a single name", () => {
    const session = sessionFixture()
    session.collected_information!.shipping_details!.name = "  Robin  "
    expect(readStripeShippingAddress(session)).toMatchObject({ firstName: "Robin", lastName: "" })
  })

  it("does not fall back to billing or older Session shipping fields", () => {
    const session = sessionFixture()
    Object.assign(session, { shipping_details: session.collected_information!.shipping_details })
    session.collected_information = null
    expect(() => readStripeShippingAddress(session)).toThrowError(
      expect.objectContaining({ code: "SHIPPING_ADDRESS_INVALID" })
    )
  })

  it.each(["CA", "PR", "GU", "VI", "AS", "MP", "UM"])("holds an unsupported country %s", (country) => {
    const session = sessionFixture()
    session.collected_information!.shipping_details!.address.country = country
    expect(() => readStripeShippingAddress(session)).toThrowError(
      expect.objectContaining({ code: "SHIPPING_DESTINATION_UNSUPPORTED" })
    )
  })

  it.each(["PR", "GU", "VI", "AS", "MP", "AA", "AE", "AP"])("holds an unsupported US region %s", (region) => {
    const session = sessionFixture()
    session.collected_information!.shipping_details!.address.state = region
    expect(() => readStripeShippingAddress(session)).toThrowError(
      expect.objectContaining({ code: "SHIPPING_DESTINATION_UNSUPPORTED" })
    )
  })

  it.each(["AK", "HI", "DC"])("accepts covered destination %s", (region) => {
    const session = sessionFixture()
    session.collected_information!.shipping_details!.address.state = region
    expect(readStripeShippingAddress(session).region).toBe(region)
  })

  it.each(["name", "line1", "city", "postal_code", "email", "phone"])("holds missing %s", (field) => {
    const session = sessionFixture()
    const shipping = session.collected_information!.shipping_details!
    if (field === "name") shipping.name = ""
    else if (field === "email" || field === "phone") session.customer_details![field] = null
    else shipping.address[field as "line1" | "city" | "postal_code"] = null
    expect(() => readStripeShippingAddress(session)).toThrowError(
      expect.objectContaining({ code: "SHIPPING_ADDRESS_INVALID" })
    )
  })

  it.each(["Robin\nSample", "Robin\u0000Sample"])("holds control characters in a recipient's name", (name) => {
    const session = sessionFixture()
    session.collected_information!.shipping_details!.name = name
    expect(() => readStripeShippingAddress(session)).toThrowError(
      expect.objectContaining({ code: "SHIPPING_ADDRESS_INVALID" })
    )
  })
})

function sessionFixture() {
  return {
    collected_information: {
      shipping_details: {
        name: "Robin River Sample",
        address: {
          country: "US",
          state: "MN",
          city: "Minneapolis",
          line1: "123 Test Street",
          line2: null,
          postal_code: "55401",
        },
      },
    },
    customer_details: {
      name: "Different Payer",
      email: "payer@example.com",
      phone: "+16125550101",
      address: { country: "CA", state: "ON", city: "Toronto", line1: "9 Billing Street", postal_code: "M5V 1A1" },
    },
  } as Stripe.Checkout.Session
}
