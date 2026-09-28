"use server"
import { z } from "zod"
import { getAdminActor } from "@/features/admin/get-admin-actor.server"
import { getAdminDatabase } from "@/features/admin/get-admin-database.server"
import { DesignAgentGrantStore } from "./design-agent-grant-store.server"
const schema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("issue"),
    label: z.string().trim().min(1).max(100),
    hours: z.number().int().min(1).max(168),
    scopes: z
      .array(z.enum(["library:read", "library:write", "drafts:create"]))
      .min(1)
      .max(3),
  }),
  z.object({ operation: z.literal("revoke"), id: z.uuid() }),
])
export async function agentGrantAction(input: unknown) {
  const parsed = schema.safeParse(input),
    actor = await getAdminActor()
  if (!actor || !parsed.success)
    return { ok: false as const, message: "Current administrator access and valid grant settings are required." }
  try {
    const store = new DesignAgentGrantStore(getAdminDatabase())
    if (parsed.data.operation === "revoke") {
      await store.revoke(actor.userId, parsed.data.id)
      return { ok: true as const, message: "Agent access revoked." }
    }
    const result = await store.issue(actor.userId, parsed.data)
    return { ok: true as const, message: "Save this credential now. It is shown only once.", credential: result }
  } catch {
    return { ok: false as const, message: "Agent access could not be changed. Please try again." }
  }
}
