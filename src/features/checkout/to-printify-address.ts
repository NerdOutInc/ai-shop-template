import type { ShippingAddress } from "./shipping-address"

export function toPrintifyAddress(address: ShippingAddress) {
  return {
    first_name: address.firstName,
    last_name: address.lastName,
    email: address.email,
    phone: address.phone,
    country: address.country,
    region: address.region,
    city: address.city,
    address1: address.address1,
    address2: address.address2,
    zip: address.zip,
  }
}
