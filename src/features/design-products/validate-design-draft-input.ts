import { z } from "zod"

import { cartLimits } from "@/lib/cart-limits"

import type { DesignDraftInput } from "./design-draft-types"

import { DesignDraftError } from "./design-draft-error"

const text = z.string().trim().min(1).max(200)
const schema = z
  .object({
    requestId: z.uuid(),
    selection: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("numbers"), numbers: z.array(z.number().int().positive()).min(1).max(200) }).strict(),
      z.object({ kind: z.literal("favorites") }).strict(),
      z
        .object({
          kind: z.literal("revisions"),
          items: z
            .array(z.object({ designId: z.uuid(), revisionId: z.uuid() }).strict())
            .min(1)
            .max(200),
        })
        .strict(),
    ]),
    recipe: z
      .object({
        blueprintId: z.number().int().positive(),
        productModelLabel: text,
        printProviderId: z.number().int().positive(),
        variants: z
          .array(
            z
              .object({
                id: z.number().int().positive(),
                price: z.number().int().positive().max(cartLimits.maxUnitAmount),
                color: text,
                size: text,
              })
              .strict()
          )
          .min(1)
          .max(200),
        placement: z
          .object({
            position: z.literal("front"),
            x: z.number().min(0).max(1),
            y: z.number().min(0).max(1),
            scale: z.number().positive().max(10),
            angle: z.number().int().min(0).max(359),
          })
          .strict(),
        description: z.string().trim().min(1).max(10000),
        titleTemplate: text,
      })
      .strict(),
  })
  .strict()

/** Explicit delegated product settings are required; publication is not part of this command. */
export function validateDesignDraftInput(input: unknown): DesignDraftInput {
  const parsed = schema.safeParse(input)
  if (!parsed.success)
    throw new DesignDraftError(
      "INVALID_INPUT",
      `Complete the draft settings: ${parsed.error.issues.map((issue) => issue.path.join(".")).join(", ")}`
    )
  if (new Set(parsed.data.recipe.variants.map((variant) => variant.id)).size !== parsed.data.recipe.variants.length)
    throw new DesignDraftError("INVALID_INPUT", "Choose each provider variant once")
  if (
    parsed.data.selection.kind === "revisions" &&
    new Set(parsed.data.selection.items.map((item) => item.designId)).size !== parsed.data.selection.items.length
  )
    throw new DesignDraftError("INVALID_INPUT", "Choose each design once with one exact revision")
  return parsed.data
}
