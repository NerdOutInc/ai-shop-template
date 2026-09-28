import { beforeEach, expect, it, vi } from "vitest"
import { GET } from "./route"
const { settings, run } = vi.hoisted(() => ({
  settings: { CRON_SECRET: "test-secret", ORDER_ALERTS_ENABLED: "true", VERCEL_ENV: "production" },
  run: vi.fn(),
}))
vi.mock("@/lib/env", () => ({ env: settings }))
vi.mock("@/features/order-alerts/run-order-alerts.server", () => ({ runOrderAlerts: run }))
beforeEach(() => {
  settings.ORDER_ALERTS_ENABLED = "true"
  settings.VERCEL_ENV = "production"
  run.mockReset().mockResolvedValue({ checked: 1, sent: 1, errors: 0 })
})
const request = (token = "test-secret") =>
  new Request("https://example.com/api/internal/order-alerts", { headers: { authorization: `Bearer ${token}` } })
it("rejects callers without the cron secret", async () => {
  expect((await GET(request("wrong"))).status).toBe(401)
  expect(run).not.toHaveBeenCalled()
})
it("never sends from previews or while disabled", async () => {
  settings.VERCEL_ENV = "preview"
  expect(await (await GET(request())).json()).toMatchObject({ reason: "disabled" })
  settings.VERCEL_ENV = "production"
  settings.ORDER_ALERTS_ENABLED = "false"
  await GET(request())
  expect(run).not.toHaveBeenCalled()
})
it("exposes only counts and signals failures for cron monitoring", async () => {
  run.mockResolvedValue({ checked: 1, sent: 0, errors: 1 })
  const response = await GET(request())
  expect(response.status).toBe(503)
  expect(response.headers.get("cache-control")).toBe("no-store")
  expect(await response.json()).toEqual({ checked: 1, sent: 0, errors: 1 })
})
