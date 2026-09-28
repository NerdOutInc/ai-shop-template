import Link from "next/link"

import { formatStoreMoment } from "@/lib/format-store-moment"
import { storeTimeZone } from "@/lib/store-time-zone"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"

import type { AdminOrder, AdminOrderFilters, AdminOrderListResult, OrderChannel } from "./admin-order"
import { adminOrderPageUrl } from "./admin-order-page-url"

const channelLabels: Record<OrderChannel, string> = {
  organic_search: "Organic search",
  paid: "Paid",
  social: "Social",
  email: "Email",
  referral: "Referral",
  direct: "Direct",
  unknown: "Unknown",
}
const fulfillmentLabels = {
  pending: "Awaiting fulfillment",
  creating: "Creating Printify order",
  created: "Printify order created",
  submitting: "Sending to production",
  submitted: "Sent to Printify",
  simulated: "Simulated",
}
const dateOptions: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
}

export function AdminOrders({ filters, result }: { filters: AdminOrderFilters; result: AdminOrderListResult }) {
  return (
    <div className="space-y-7">
      <form action="/admin/orders" method="get" aria-label="Filter orders" className="flex flex-wrap items-end gap-4">
        {filters.orderId && <input type="hidden" name="order" value={filters.orderId} />}
        <Filter
          name="payment"
          label="Payment"
          value={filters.payment}
          options={[
            ["paid", "Captured"],
            ["unverified", "Not recorded"],
            ["all", "All payments"],
          ]}
        />
        <Filter
          name="fulfillment"
          label="Fulfillment"
          value={filters.fulfillment}
          options={[
            ["all", "All fulfillment"],
            ["pending", "In progress"],
            ["attention", "Needs attention"],
            ["submitted", "Sent to Printify"],
          ]}
        />
        <Filter
          name="channel"
          label="Channel"
          value={filters.channel}
          options={[["all", "All channels"], ...Object.entries(channelLabels)]}
        />
        <Filter
          name="mode"
          label="Test orders"
          value={filters.mode}
          options={[
            ["live", "Exclude tests"],
            ["test", "Test only"],
            ["all", "Include tests"],
          ]}
        />
        <Button type="submit" className="min-h-11 px-4">
          Apply filters
        </Button>
        <Link href="/admin/orders" className="inline-flex min-h-11 items-center text-sm underline underline-offset-4">
          Reset
        </Link>
      </form>
      <p className="max-w-3xl text-sm text-muted-foreground">
        Captured payments are saved at checkout. Refunds and disputes are in{" "}
        <a
          href={`https://dashboard.stripe.com/${filters.mode === "test" ? "test/" : ""}payments`}
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-4"
        >
          Stripe (opens in a new tab)
        </a>
        . Fulfillment here tracks the handoff to Printify. Dates use {storeTimeZone} time.
      </p>
      {result.status === "unavailable" ? (
        <Alert variant="destructive">
          <AlertDescription>
            Orders are unavailable right now. Try again shortly, or check that the order database migration is applied.
          </AlertDescription>
        </Alert>
      ) : result.orders.length ? (
        <>
          <p role="status" className="text-sm text-muted-foreground">
            Page {filters.page} · {result.orders.length} {result.orders.length === 1 ? "order" : "orders"}
          </p>
          <ol aria-label="Orders" className="divide-y border-y">
            {result.orders.map((order) => (
              <OrderRow key={order.requestId} order={order} />
            ))}
          </ol>
        </>
      ) : (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>No orders match these filters</EmptyTitle>
            <EmptyDescription>
              Try another channel or include payments that haven’t been recorded yet. Historical sources stay unknown.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      {result.status === "ready" && (filters.page > 1 || result.hasNextPage) && (
        <nav aria-label="Order pages" className="flex flex-wrap gap-3">
          {filters.page > 1 && (
            <Link
              href={adminOrderPageUrl(filters, filters.page - 1)}
              className={buttonVariants({ variant: "outline", className: "min-h-11 px-4" })}
            >
              Previous page
            </Link>
          )}
          {result.hasNextPage && filters.page < 1000 && (
            <Link
              href={adminOrderPageUrl(filters, filters.page + 1)}
              className={buttonVariants({ variant: "outline", className: "min-h-11 px-4" })}
            >
              Next page
            </Link>
          )}
        </nav>
      )}
    </div>
  )
}

function Filter({ name, label, value, options }: { name: string; label: string; value: string; options: string[][] }) {
  return (
    <div className="flex min-w-36 flex-col gap-1.5">
      <label htmlFor={`order-filter-${name}`} className="text-sm font-semibold">
        {label}
      </label>
      <NativeSelect
        id={`order-filter-${name}`}
        name={name}
        defaultValue={value}
        key={value}
        className="w-full [&_select]:min-h-11"
      >
        {options.map(([option, text]) => (
          <NativeSelectOption key={option} value={option}>
            {text}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </div>
  )
}

function OrderRow({ order }: { order: AdminOrder }) {
  const amount =
    order.totalAmount === null
      ? "Unknown"
      : new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: order.currency,
        }).format(order.totalAmount / 100)
  return (
    <li className="py-6">
      <article aria-labelledby={`order-${order.requestId}`}>
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-2">
            <h2
              id={`order-${order.requestId}`}
              className="font-condensed text-xl font-semibold"
              title={order.requestId}
            >
              ORDER-{order.requestId.slice(0, 8).toUpperCase()}
            </h2>
            {order.testOrder && <Badge variant="outline">Test order</Badge>}
            <time dateTime={order.createdAt} className="text-sm text-muted-foreground">
              {formatStoreMoment(order.createdAt, dateOptions)}
            </time>
          </div>
          <p className="font-semibold">
            <span className="mr-2 text-sm font-normal text-muted-foreground">Captured total</span>
            {amount}
          </p>
        </div>
        <dl className="grid gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-[1.25fr_1fr_1fr_1fr]">
          <Detail label={order.customerName ? "Customer (billing)" : "Recipient"}>
            <span className="block">{order.customerName ?? order.recipientName ?? "Not recorded"}</span>
            {order.customerEmail && (
              <span className="block text-sm break-all text-muted-foreground">{order.customerEmail}</span>
            )}
          </Detail>
          <Detail label="Payment and fulfillment">
            <span className="block">
              {order.paymentStatus === "paid" ? "Payment captured" : "Payment not recorded"}
            </span>
            <span className="block text-sm text-muted-foreground">{fulfillmentLabels[order.fulfillmentState]}</span>
            {order.failureCode && (
              <span className="mt-1 block text-sm font-medium text-destructive">Needs attention</span>
            )}
          </Detail>
          <Detail label="Source">
            <span className="block break-all">{order.source ?? channelLabels[order.channel]}</span>
            {order.source && (
              <span className="block text-sm text-muted-foreground">{channelLabels[order.channel]}</span>
            )}
          </Detail>
          <Detail label="Campaign">
            <span className="break-words">{order.campaign ?? "Not recorded"}</span>
          </Detail>
        </dl>
        <details className="mt-4 text-sm text-muted-foreground">
          <summary className="w-fit py-3 underline underline-offset-4">
            Order details <span className="sr-only">for ORDER-{order.requestId.slice(0, 8).toUpperCase()}</span>
          </summary>
          <dl className="mt-2 grid gap-3 sm:grid-cols-2">
            <Detail label="Order reference">
              <span className="break-all">{order.requestId}</span>
            </Detail>
            <Detail label="Delivery recipient">{order.recipientName ?? "Not recorded"}</Detail>
            <Detail label="Printify order">
              <span className="break-all">{order.printifyOrderId ?? "Not created"}</span>
            </Detail>
            <Detail label="Landing page">
              <span className="break-all">{order.landingPath ?? "Unknown"}</span>
            </Detail>
            <Detail label="Referring website">
              <span className="break-all">{order.referrerHost ?? "Not recorded"}</span>
            </Detail>
            <Detail label="Attribution evidence">{order.attributionMethod?.replaceAll("_", " ") ?? "Unknown"}</Detail>
            {order.paidAt && (
              <Detail label="Charge date">
                <time dateTime={order.paidAt}>{formatStoreMoment(order.paidAt, dateOptions)}</time>
              </Detail>
            )}
            {order.failureCode && (
              <Detail label="Attention code">
                <span className="break-all">{order.failureCode}</span>
              </Detail>
            )}
            {order.paymentIntentId && (
              <Detail label="Current payment details">
                <a
                  href={`https://dashboard.stripe.com/${order.testOrder ? "test/" : ""}payments/${order.paymentIntentId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-11 items-center underline underline-offset-4"
                >
                  View in Stripe (opens in a new tab)
                </a>
              </Detail>
            )}
          </dl>
        </details>
      </article>
    </li>
  )
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="mb-1 text-sm text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}
