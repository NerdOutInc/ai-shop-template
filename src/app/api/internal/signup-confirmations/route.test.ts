import "../../../../../test/configured-store"
import { storeConfig } from "@/lib/store-config"
import { beforeEach, expect, it, vi } from "vitest"

import { GET } from "./route"

const { settings, run, prune, pruneBudget } = vi.hoisted(() => ({
  settings: {
    DATABASE_URL: "fixture",
    CRON_SECRET: "test-secret",
    SIGNUP_CONFIRMATIONS_ENABLED: "true",
    VERCEL_ENV: "production",
  },
  run: vi.fn(),
  prune: vi.fn(),
  pruneBudget: vi.fn(),
}))
vi.mock("server-only", () => ({}))
vi.mock("@/features/drop-emails/get-drop-email-pool.server", () => ({ getDropEmailPool: () => ({}) }))
vi.mock("@/features/subscribers/prune-pending-subscribers.server", () => ({ prunePendingSubscribers: prune }))
vi.mock("@/features/drop-signup/prune-signup-confirmation-budget.server", () => ({
  pruneSignupConfirmationBudget: pruneBudget,
}))
vi.mock("@/lib/env", () => ({ env: settings }))
vi.mock("@/features/drop-signup/run-signup-confirmations.server", () => ({ runSignupConfirmations: run }))

beforeEach(() => {
  settings.DATABASE_URL = "fixture"
  settings.SIGNUP_CONFIRMATIONS_ENABLED = "true"
  settings.VERCEL_ENV = "production"
  prune.mockReset().mockResolvedValue(0)
  pruneBudget.mockReset().mockResolvedValue(undefined)
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
    cleanupError: "Signup housekeeping needs attention",
  })
  settings.SIGNUP_CONFIRMATIONS_ENABLED = "false"
  const disabled = await GET(request())
  expect(disabled.status).toBe(503)
  expect(await disabled.json()).toMatchObject({
    processed: false,
    reason: "disabled",
    cleanupError: "Signup housekeeping needs attention",
  })
  expect(run).toHaveBeenCalledTimes(1)
})

it("does not clean up without the production database", async () => {
  settings.DATABASE_URL = ""
  expect((await GET(request())).status).toBe(503)
  expect(prune).not.toHaveBeenCalled()
  expect(run).not.toHaveBeenCalled()
})

it("continues expiry when store, policy and list presentation flags are closed", async () => {
  storeConfig.configured = false
  storeConfig.policies.published = false
  storeConfig.features.dropSignup = false
  storeConfig.privacy.retainedDropSubscribers = false
  settings.SIGNUP_CONFIRMATIONS_ENABLED = "false"
  const response = await GET(request())
  expect(response.status).toBe(200)
  expect(prune).toHaveBeenCalledOnce()
  expect(run).not.toHaveBeenCalled()
})

it.each([
  { sent: 0, errors: 0, busy: true, saturated: false },
  { sent: 1, errors: 0, busy: false, saturated: true },
])("reports contention and admission saturation as healthy worker outcomes", async (result) => {
  run.mockResolvedValue(result)
  const response = await GET(request())
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ ...result, pruned: 0 })
})

it("reports sustained saturation to cron monitoring without calling it a delivery error", async () => {
  run.mockResolvedValue({ sent: 1, errors: 0, busy: false, saturated: true, saturationNeedsAttention: true })
  const error = vi.spyOn(console, "error").mockImplementation(() => {})
  const response = await GET(request())
  expect(response.status).toBe(503)
  expect(await response.json()).toMatchObject({ sent: 1, errors: 0, saturationNeedsAttention: true })
  expect(error).toHaveBeenCalledWith("Signup admission has remained saturated for three hours")
})

it("prunes budget identities while sending is disabled and reports cleanup failure without blocking delivery", async () => {
  settings.SIGNUP_CONFIRMATIONS_ENABLED = "false"
  expect((await GET(request())).status).toBe(200)
  expect(pruneBudget).toHaveBeenCalledOnce()
  expect(run).not.toHaveBeenCalled()
  settings.SIGNUP_CONFIRMATIONS_ENABLED = "true"
  pruneBudget.mockRejectedValue(new Error("private database body"))
  expect((await GET(request())).status).toBe(503)
  expect(run).toHaveBeenCalledOnce()
})
