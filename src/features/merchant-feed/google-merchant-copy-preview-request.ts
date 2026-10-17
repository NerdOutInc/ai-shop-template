import "server-only"

import { z } from "zod"
import { readGoogleCopyJsonRequest } from "./read-google-copy-json-request"

const schema = z
  .object({
    expectedRevision: z
      .string()
      .regex(/^[1-9]\d*$/)
      .max(40),
    content: z.string().max(10000),
    origin: z.enum(["generated", "human"]),
    variantIds: z
      .array(z.number().int().safe().nonnegative())
      .min(1)
      .max(10000)
      .refine((ids) => new Set(ids).size === ids.length),
  })
  .strict()

export type GoogleCopyPreviewInput = z.infer<typeof schema>

export async function readGoogleMerchantCopyPreviewRequest(request: Request): Promise<GoogleCopyPreviewInput | null> {
  return readGoogleCopyJsonRequest(request, schema)
}
