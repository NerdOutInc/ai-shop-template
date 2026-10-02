// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest"
import { runSignupConfirmations } from "./run-signup-confirmations.server"
const mocks = vi.hoisted(() => ({ query: vi.fn(), process: vi.fn(), setup: vi.fn() }))
vi.mock("server-only", () => ({}))
vi.mock("@/features/drop-emails/get-drop-email-pool.server", () => ({
  getDropEmailPool: () => ({ query: mocks.query }),
}))
vi.mock("./process-signup-confirmations.server", () => ({ processSignupConfirmations: mocks.process }))
vi.mock("./read-signup-confirmation-setup.server", () => ({ readSignupConfirmationSetup: mocks.setup }))
vi.mock("@/lib/send-single-email.server", () => ({ sendSingleEmail: vi.fn() }))
beforeEach(() => {
  mocks.setup.mockReturnValue({ sending: true, apiKey: "fixture" })
  mocks.process.mockResolvedValue({ sent: 1, errors: 0 })
  mocks.query.mockResolvedValue({ rows: [{ limited: false }] })
})
it("makes recent saturation visible in worker health while still processing durable requests", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {})
  mocks.query.mockResolvedValue({ rows: [{ limited: true }] })
  expect(await runSignupConfirmations()).toEqual({ sent: 1, errors: 1 })
  expect(mocks.process).toHaveBeenCalledOnce()
  expect(console.warn).toHaveBeenCalledWith("Signup confirmation hourly ceiling reached")
})
it("returns healthy delivery results without recent saturation", async () => {
  expect(await runSignupConfirmations()).toEqual({ sent: 1, errors: 0 })
})
it("never processes the queue when the sender is disabled", async () => {
  mocks.setup.mockReturnValue({ sending: false })
  await expect(runSignupConfirmations()).rejects.toThrow("disabled")
  expect(mocks.process).not.toHaveBeenCalled()
  expect(mocks.query).not.toHaveBeenCalled()
})
