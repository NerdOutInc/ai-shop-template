/** Public machine-readable USD prices use two decimal places, without a currency symbol. */
export function formatDecimalPrice(cents: number) {
  return (cents / 100).toFixed(2)
}
