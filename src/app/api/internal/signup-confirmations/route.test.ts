import "../../../../../test/configured-store"
import { storeConfig } from "@/lib/store-config"
import { beforeEach, expect, it, vi } from "vitest"

import { GET } from "./route"

const { settings, run, prune } = vi.hoisted(() => ({
  settings: { CRON_SECRET: "test-secret", SIGNUP_CONFIRMATIONS_ENABLED: "true", VERCEL_ENV: "production" },
  run: vi.fn(),
  prune: vi.fn(),
}))
vi.mock("server-only", () => ({}))
vi.mock("@/features/drop-emails/get-drop-email-pool.server", () => ({ getDropEmailPool: () => ({}) }))
vi.mock("@/features/subscribers/prune-pending-subscribers.server", () => ({ prunePendingSubscribers: prune }))
vi.mock("@/lib/env", () => ({ env: settings }))
vi.mock("@/features/drop-signup/run-signup-confirmations.server", () => ({ runSignupConfirmations: run }))

beforeEach(() => {
  settings.SIGNUP_CONFIRMATIONS_ENABLED = "true"
  settings.VERCEL_ENV = "production"
  prune.mockReset().mockResolvedValue(0)
  run.mockReset().mockResolvedValue({ sent: 2, errors: 0 })
})
const request = (token = "test-secret") =>
  new Request("https://store.example/api/internal/signup-confirmations", {
    headers: { authorization: `Bearer ${token}` },
  })

it("rejects callers without the cron secret", async () => {
  expect((await GET(request("wrong"))).status).toBe(401)
  expect(run).not.toHaveBeenCalled()
})

it("never sends from a preview, or before the owner switches it on", async () => {
  settings.VERCEL_ENV = "preview"
  expect(await (await GET(request())).json()).toMatchObject({ reason: "disabled" })
  expect(prune).not.toHaveBeenCalled()
  settings.VERCEL_ENV = "production"
  settings.SIGNUP_CONFIRMATIONS_ENABLED = "false"
  await GET(request())
  expect(run).not.toHaveBeenCalled()
  expect(prune).toHaveBeenCalledTimes(1)
})

it("answers with counts only, and fails loudly enough for cron monitoring to notice", async () => {
  expect((await GET(request())).status).toBe(200)
  run.mockResolvedValue({ sent: 1, errors: 1 })
  const response = await GET(request())
  expect(response.status).toBe(503)
  expect(response.headers.get("cache-control")).toBe("no-store")
  expect(await response.json()).toEqual({ sent: 1, errors: 1, pruned: 0 })
  run.mockRejectedValue(new Error("Drop emails are not configured"))
  expect((await GET(request())).status).toBe(503)
})

it("reports failed housekeeping without blocking confirmation sending", async () => {
  prune.mockRejectedValue(new Error("permission denied for table drop_subscribers"))
  const response = await GET(request())
  expect(run).toHaveBeenCalledTimes(1)
  expect(response.status).toBe(503)
  expect(await response.json()).toEqual({
    sent: 2,
    errors: 0,
    pruned: 0,
    cleanupError: "Pending signup cleanup needs attention",
  })
  settings.SIGNUP_CONFIRMATIONS_ENABLED = "false"
  const disabled = await GET(request())
  expect(disabled.status).toBe(503)
  expect(await disabled.json()).toMatchObject({
    processed: false,
    reason: "disabled",
    cleanupError: "Pending signup cleanup needs attention",
  })
  expect(run).toHaveBeenCalledTimes(1)
})

it("does not clean up an unconfigured or undisclosed list", async () => {
  storeConfig.configured = false
  await GET(request())
  expect(prune).not.toHaveBeenCalled()
  expect(run).not.toHaveBeenCalled()
  storeConfig.configured = true
  storeConfig.features.dropSignup = false
  storeConfig.privacy.retainedDropSubscribers = false
  await GET(request())
  expect(prune).not.toHaveBeenCalled()
})
