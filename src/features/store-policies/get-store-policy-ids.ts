export function getStorePolicyIds(siteUrl: URL) {
  return {
    merchantReturnPolicy: new URL("/returns#return-policy", siteUrl).href,
    shippingService: new URL("/shipping#standard-shipping", siteUrl).href,
  }
}
