import { storeConfig } from "@/lib/store-config"
import { getShippingSchedule } from "@/features/store-policies/get-shipping-schedule"
import { supportEmail } from "@/lib/support-email"
import type { AlertOrder, OwnerEmail, PaymentCheck, ShipmentCheck } from "./order-alert"

export function buildOrderAlertEmail(input: {
  order: AlertOrder
  shipment: ShipmentCheck
  payment: PaymentCheck
  now: Date
  from: string
  siteUrl: string
}): OwnerEmail {
  const { order, shipment, payment, now, from, siteUrl } = input
  const saved = order.snapshot.shippingEstimate
  const schedule = getShippingSchedule(order.payment.paidAt, saved.handlingBusinessDays, now, saved.timeZone)
  const reference = `ORDER-${order.request_id.slice(0, 8).toUpperCase()}`
  const urgent = schedule.today >= schedule.shipByDate || shipment.needsAttention
  const orderUrl = new URL("/admin/orders", siteUrl)
  orderUrl.searchParams.set("order", order.request_id)
  const customer = order.payment.customerName ?? "Customer"
  const email = order.payment.customerEmail ?? order.snapshot.shippingAddress?.email ?? "Not recorded — check the order"
  const heading = urgent ? "Action needed" : "Shipping check-in"
  return {
    from,
    to: [supportEmail],
    subject: `${heading}: ${reference}`,
    text: `${heading}: ${reference}

Original ship-by date: ${schedule.shipByDate} (end of day, ${saved.timeZone}; ${saved.handlingBusinessDays} business days after payment).
Business days since payment: ${schedule.businessDaysElapsed}
Payment confirmed: ${order.payment.paidAt}
Checked: ${now.toISOString()}
Customer: ${customer}
Customer email: ${email}
Captured total: $${(order.payment.totalAmount / 100).toFixed(2)} USD
Current payment check: ${payment.replaceAll("_", " ")}
Store fulfillment: ${order.state}${order.failure_code ? " — needs attention" : ""}
Printify order: ${order.printify_order_id ?? "Not recorded"}
${shipment.summary}

Items:
${(shipment.items.length ? shipment.items : order.snapshot.items.map((item) => `${item.quantity} × ${item.title} (${item.variantLabel}): shipment unverified`)).join("\n")}

Open this order (admin sign-in required):
${orderUrl}
Payment and refunds:
https://dashboard.stripe.com/payments/${encodeURIComponent(order.payment.paymentIntentId)}

What to do:
1. Check every unshipped item in Printify. “Sent to Printify” is not the same as shipped. If seven business days have passed in production, ask Printify Support for an update.
2. Confirm whether it can ship by the ORIGINAL promised date. Contact the customer as soon as a delay is known; do not wait for a reminder or the deadline.
3. If it will be late, fill in the draft below and send it yourself. Check any refund or dispute before offering another refund. Record the message, the customer's choice, and any new follow-up date.

CUSTOMER DRAFT — only use after confirming a delay. Replace every bracketed field and remove inapplicable wording. This email has NOT been sent to the customer.

Subject: An update on your ${storeConfig.name} order ${reference}

Hi ${customer},

I'm sorry — the remaining items in your order ${reference} won't ship by ${schedule.shipByDate} because [confirmed reason].

[Choose one: We now expect these items to ship by DATE. / We don't yet have a reliable new shipping date, and we'll update you by DATE.]

You can cancel the unshipped items for a prompt refund instead of waiting. Please reply to this email to tell us whether you'd like to wait or cancel. [Add the applicable response deadline and explain what happens if we don't hear back, following the delay-notice guidance below.]

I'm sorry for the wait, and thank you for your patience.
The store team
${storeConfig.name}
${supportEmail}

OWNER NOTES — do not include these in the customer message:
Check the consent, no-response, repeat-delay, and refund rules for this particular delay before sending:
https://www.ftc.gov/business-guidance/resources/business-guide-ftcs-mail-internet-or-telephone-order-merchandise-rule
This is an internal reminder, not a customer delay notice. Daily business-day reminders continue until every item is reported shipped or the full payment is confirmed refunded. You still own follow-up on any revised date.
`,
  }
}
