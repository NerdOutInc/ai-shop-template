import "server-only"

import { z } from "zod"
import { readGoogleCopyJsonRequest } from "./read-google-copy-json-request"
import { googleMerchantCopySchema } from "./google-merchant-copy-schema"

const schema = z
  .object({
    expectedRevision: z
      .string()
      .regex(/^[1-9]\d*$/)
      .max(40),
    copy: googleMerchantCopySchema,
    digest: z.string().regex(/^[a-f0-9]{64}$/),
    confirmation: z.literal("APPLY_GOOGLE_COPY"),
  })
  .strict()

export type GoogleCopyApplyInput = z.infer<typeof schema>

export async function readGoogleMerchantCopyApplyRequest(request: Request): Promise<GoogleCopyApplyInput | null> {
  return readGoogleCopyJsonRequest(request, schema)
}
