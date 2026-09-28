"use client"

import { useEffect, useState, useSyncExternalStore } from "react"

import type { MetaCartResult } from "@/features/cart/resolve-meta-cart.server"

type RecoveryResponse = { kind: "success"; sessionId: string | null } | { kind: "meta"; result: MetaCartResult }

function subscribe(listener: () => void) {
  window.addEventListener("popstate", listener)
  return () => window.removeEventListener("popstate", listener)
}

function getReference() {
  try {
    return JSON.stringify(window.history.state?.storeCheckoutRecovery ?? null)
  } catch {
    return "null"
  }
}

export function useCheckoutRecovery(kind: RecoveryResponse["kind"]) {
  const rawReference = useSyncExternalStore(subscribe, getReference, () => null)
  const reference: unknown = JSON.parse(rawReference ?? "null")
  const selector =
    reference &&
    typeof reference === "object" &&
    "kind" in reference &&
    reference.kind === kind &&
    "selector" in reference &&
    typeof reference.selector === "string" &&
    /^[a-f0-9]{32}$/.test(reference.selector)
      ? reference.selector
      : null
  const [state, setState] = useState<{
    data: RecoveryResponse | null
    status: "loading" | "ready" | "error" | "gone"
    key: string
  }>({
    data: null,
    status: "loading",
    key: "",
  })
  const [attempt, setAttempt] = useState(0)
  const key = `${kind}:${selector}:${attempt}`
  useEffect(() => {
    if (!selector) return
    const controller = new AbortController()
    void fetch("/api/checkout/recovery", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, selector }),
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.status === 404) {
          if (!controller.signal.aborted) setState({ data: null, status: "gone", key })
          return
        }
        if (!response.ok) throw new Error("Recovery unavailable")
        const data = (await response.json()) as RecoveryResponse
        if (
          data.kind !== kind ||
          (data.kind === "success" && data.sessionId !== null && typeof data.sessionId !== "string") ||
          (data.kind === "meta" && !["ready", "error"].includes(data.result?.status))
        )
          throw new Error("Invalid recovery")
        if (!controller.signal.aborted) setState({ data, status: "ready", key })
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ data: null, status: "error", key })
      })
    return () => controller.abort()
  }, [kind, selector, key])
  return {
    data: state.key === key ? state.data : null,
    error: state.key === key && state.status === "error",
    gone: (rawReference !== null && selector === null) || (state.key === key && state.status === "gone"),
    retry: () => setAttempt((value) => value + 1),
  }
}
