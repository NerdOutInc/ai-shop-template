import { z } from "zod"

/**
 * Deliberately tiny and strict.
 *
 * `source` says which surface collected the address, because consent evidence has to record what the
 * person was looking at. `company` is a honeypot: a real visitor never sees it, so anything in it is
 * a script filling every field it finds.
 */
export const dropSignupRequest = z
  .object({
    email: z.string().trim().min(6).max(254).email(),
    source: z.enum(["design-of-the-week", "footer", "home"]),
    company: z.string().max(200).optional(),
  })
  .strict()

export type DropSignupRequest = z.infer<typeof dropSignupRequest>
