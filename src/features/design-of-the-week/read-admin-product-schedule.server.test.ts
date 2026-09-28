// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest"

import { storeConfig } from "@/lib/store-config"

import { readAdminProductSchedule } from "./read-admin-product-schedule.server"

const { getPublishingStore, list } = vi.hoisted(() => ({ getPublishingStore: vi.fn(), list: vi.fn() }))
vi.mock("server-only", () => ({}))
vi.mock("@/features/publishing/get-publishing-store.server", () => ({ getPublishingStore }))

beforeEach(() => {
  getPublishingStore.mockReturnValue({ productSchedule: { list } })
  list.mockResolvedValue([])
})

it("does not construct a storage client for a disabled feature", async () => {
  storeConfig.features.designOfTheWeek = false
  expect(await readAdminProductSchedule()).toEqual({ status: "disabled" })
  expect(getPublishingStore).not.toHaveBeenCalled()
})

it("reads the owner's schedule when enabled", async () => {
  storeConfig.features.designOfTheWeek = true
  expect(await readAdminProductSchedule()).toMatchObject({ status: "ready", entries: [] })
  expect(list).toHaveBeenCalledOnce()
})
