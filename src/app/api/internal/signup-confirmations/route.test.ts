import { beforeEach, expect, it, vi } from "vitest"

import { GET } from "./route"

const { settings, run } = vi.hoisted(() => ({
  settings: { CRON_SECRET: "test-secret", SIGNUP_CONFIRMATIONS_ENABLED: "true", VERCEL_ENV: "production" },
  run: vi.fn(),
}))
vi.mock("@/lib/env", () => ({ env: settings }))
vi.mock("@/features/drop-signup/run-signup-confirmations.server", () => ({ runSignupConfirmations: run }))

beforeEach(() => {
  settings.SIGNUP_CONFIRMATIONS_ENABLED = "true"
  settings.VERCEL_ENV = "production"
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
  settings.VERCEL_ENV = "production"
  settings.SIGNUP_CONFIRMATIONS_ENABLED = "false"
  await GET(request())
  expect(run).not.toHaveBeenCalled()
})

it("answers with counts only, and fails loudly enough for cron monitoring to notice", async () => {
  expect((await GET(request())).status).toBe(200)
  run.mockResolvedValue({ sent: 1, errors: 1 })
  const response = await GET(request())
  expect(response.status).toBe(503)
  expect(response.headers.get("cache-control")).toBe("no-store")
  expect(await response.json()).toEqual({ sent: 1, errors: 1 })
  run.mockRejectedValue(new Error("Drop emails are not configured"))
  expect((await GET(request())).status).toBe(503)
})
