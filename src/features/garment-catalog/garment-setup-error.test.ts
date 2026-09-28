import { describe, expect, it } from "vitest"

import { GarmentSetupError } from "./garment-setup-error"

describe("GarmentSetupError", () => {
  // The catalog route tells this failure apart from a crash with `instanceof` and logs the code,
  // so both have to survive being thrown across an await.
  it("carries its code and owner-facing message through a rejection", async () => {
    const failure = Promise.reject(new GarmentSetupError("PROVIDER_REJECTED", "Printify refused the catalog lookup"))
    await expect(failure).rejects.toBeInstanceOf(GarmentSetupError)
    await expect(failure).rejects.toBeInstanceOf(Error)
    await expect(failure).rejects.toMatchObject({
      name: "GarmentSetupError",
      code: "PROVIDER_REJECTED",
      message: "Printify refused the catalog lookup",
    })
  })
})
