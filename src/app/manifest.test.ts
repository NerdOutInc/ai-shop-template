import { expect, it } from "vitest"

import { storeConfig } from "../../test/store-config"

import manifest from "./manifest"

it("uses the distinct short launcher name and supported document language", () => {
  expect(manifest()).toMatchObject({
    name: storeConfig.name,
    short_name: "Fixture",
    lang: "en-US",
    icons: expect.arrayContaining([expect.objectContaining({ src: "/icons/maskable-512.png", purpose: "maskable" })]),
  })
})
