import { z } from "zod"
import { validateDesignDraftInput } from "@/features/design-products/validate-design-draft-input"
const uuid = z.uuid(),
  text = z.string().trim().min(1).max(12000),
  slot = z.number().int().min(1).max(200),
  batch = z.object({ batchId: uuid })
const direction = z
  .object({
    slot,
    subject: text,
    mechanism: text,
    composition: text,
    lettering: z.string().max(4000),
    avoidDesignNumbers: z.array(z.number().int().positive()).max(200),
    parentDesignNumber: z.number().int().positive().optional(),
  })
  .strict()
const schema = z.discriminatedUnion("command", [
  z.object({ command: z.literal("drafts.create"), input: z.unknown().transform(validateDesignDraftInput) }).strict(),
  // What a draft of each design would be, in its own garment colors, before anything is reserved.
  // Fifty a call: one catalogue read serves the page, and fifty recipes still fit a response.
  z
    .object({ command: z.literal("drafts.propose"), numbers: z.array(z.number().int().positive()).min(1).max(50) })
    .strict(),
  z.object({ command: z.literal("drafts.reconcile"), requestId: uuid }).strict(),
  z.object({ command: z.literal("drafts.reconcileBinding"), bindingId: uuid }).strict(),
  z
    .object({
      command: z.literal("artwork.assess"),
      revisionId: uuid,
      widthInches: z.number().positive().max(100),
      heightInches: z.number().positive().max(100),
      nativePpi: z.number().positive(),
      notes: z.string().trim().min(1).max(4000),
    })
    .strict(),
  z
    .object({
      command: z.literal("library.search"),
      search: z.string().max(1000).optional(),
      offset: z.number().int().min(0).optional(),
      limit: z.number().int().min(1).max(200).optional(),
      pendingOffset: z.number().int().min(0).optional(),
    })
    .strict(),
  z.object({ command: z.literal("library.get"), number: z.number().int().positive() }).strict(),
  // The shop's own published product models, so the agent offers a short real list rather than the
  // whole Printify catalogue.
  z.object({ command: z.literal("products.recipes") }).strict(),
  z.object({ command: z.literal("revision.prepare"), designId: uuid, revision: z.unknown() }).strict(),
  z.object({ command: z.literal("revision.upload"), revisionId: uuid, assetId: uuid }).strict(),
  z.object({ command: z.literal("revision.finalize"), revisionId: uuid, assetId: uuid }).strict(),
  z
    .object({
      command: z.literal("design.colors"),
      designId: uuid,
      // The offered set is ordered and capped at five; the app owns each swatch value.
      colors: z.array(z.string().trim().min(1).max(120)).max(5),
    })
    .strict(),
  z
    .object({
      command: z.literal("library.favorites"),
      offset: z.number().int().min(0).optional(),
      limit: z.number().int().min(1).max(200).optional(),
    })
    .strict(),
  z.object({ command: z.literal("batch.create"), requestId: uuid, title: text, brief: text, count: slot }).strict(),
  batch.extend({ command: z.literal("batch.status") }).strict(),
  batch.extend({ command: z.literal("batch.plan"), directions: z.array(direction).min(1).max(200) }).strict(),
  batch.extend({ command: z.literal("slot.claim"), slot, workerId: uuid }).strict(),
  batch.extend({ command: z.literal("slot.register"), slot, workerId: uuid, design: z.unknown() }).strict(),
  batch.extend({ command: z.literal("slot.inspect"), slot }).strict(),
  batch
    .extend({
      command: z.literal("slot.review"),
      slot,
      comparisonHash: z.string().regex(/^[a-f0-9]{64}$/),
      reviewedAssetIds: z.array(uuid).max(2000),
      notes: text,
      contactSheetReviewed: z.literal(true),
    })
    .strict(),
  batch.extend({ command: z.literal("slot.reject"), slot, reason: text }).strict(),
  batch.extend({ command: z.literal("batch.complete") }).strict(),
  batch.extend({ command: z.literal("asset.upload"), assetId: uuid }).strict(),
  batch.extend({ command: z.literal("asset.finalize"), assetId: uuid }).strict(),
])
export function parseDesignAgentCommand(value: unknown) {
  return schema.parse(value)
}
