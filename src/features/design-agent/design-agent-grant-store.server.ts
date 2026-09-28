import "server-only"
import { createHash, randomBytes, randomUUID } from "node:crypto"
import type { Pool, PoolClient } from "pg"
import { DesignAgentError } from "./design-agent-error"
import type { DesignAgentActor, DesignAgentGrant, DesignAgentScope } from "./design-agent-types"

const allowed = ["library:read", "library:write", "drafts:create"]
const digest = (value: string) => createHash("sha256").update(value).digest("hex")

export class DesignAgentGrantStore {
  constructor(private readonly database: Pool) {}

  async issue(userId: string, input: { label: string; scopes: DesignAgentScope[]; hours: number }) {
    if (
      !input.label.trim() ||
      input.label.length > 100 ||
      !Number.isInteger(input.hours) ||
      input.hours < 1 ||
      input.hours > 168 ||
      !input.scopes.length ||
      new Set(input.scopes).size !== input.scopes.length ||
      input.scopes.some((scope) => !allowed.includes(scope))
    )
      throw new DesignAgentError(
        "INVALID_INPUT",
        "Choose a label, supported scopes, and an expiry between 1 and 168 hours"
      )
    const id = randomUUID()
    const token = `store_agent_${id}_${randomBytes(32).toString("base64url")}`
    const result = await this.database.query(
      `insert into private.design_agent_grants(id,user_id,label,token_hash,scopes,expires_at)
      select $1,$2,$3,$4,$5,now()+($6::int * interval '1 hour') from public.admin_memberships m join private.auth_user_identity u on u.id=m.user_id
      where m.user_id=$2 and m.active and u.email_confirmed_at is not null and not coalesce(u.is_anonymous,false) and (u.banned_until is null or u.banned_until <= now()) returning id,expires_at`,
      [id, userId, input.label.trim(), digest(token), input.scopes, input.hours]
    )
    if (!result.rows.length) throw new DesignAgentError("FORBIDDEN", "Current administrator access is required")
    return { id, token, expiresAt: result.rows[0].expires_at.toISOString() as string }
  }

  async list(userId: string): Promise<DesignAgentGrant[]> {
    const result = await this.database.query(
      `select g.id,g.label,g.scopes,g.created_at,g.expires_at,g.revoked_at from private.design_agent_grants g
      join public.admin_memberships m on m.user_id=g.user_id and m.active where g.user_id=$1 order by g.created_at desc`,
      [userId]
    )
    return result.rows.map((row) => ({
      id: row.id,
      label: row.label,
      scopes: row.scopes,
      createdAt: row.created_at.toISOString(),
      expiresAt: row.expires_at.toISOString(),
      revokedAt: row.revoked_at?.toISOString() ?? null,
    }))
  }

  async revoke(userId: string, id: string) {
    const result = await this.database.query(
      `update private.design_agent_grants set revoked_at=coalesce(revoked_at,now()) where id=$1 and user_id=$2
      and exists(select 1 from public.admin_memberships where user_id=$2 and active) returning id`,
      [id, userId]
    )
    if (!result.rows.length) throw new DesignAgentError("FORBIDDEN", "Grant not found for this administrator")
  }

  async authenticate(token: string, scope: DesignAgentScope): Promise<DesignAgentActor | null> {
    if (!/^store_agent_[0-9a-f-]{36}_[A-Za-z0-9_-]{43}$/.test(token)) return null
    const result = await this.database.query(
      `select g.id,g.user_id from private.design_agent_grants g join public.admin_memberships m on m.user_id=g.user_id
      join private.auth_user_identity u on u.id=g.user_id where g.token_hash=$1 and g.revoked_at is null and g.expires_at>now() and $2=any(g.scopes)
      and m.active and u.email_confirmed_at is not null and not coalesce(u.is_anonymous,false) and (u.banned_until is null or u.banned_until<=now())`,
      [digest(token), scope]
    )
    const row = result.rows[0]
    return row ? { userId: row.user_id, grantId: row.id } : null
  }

  async requireActive(actor: DesignAgentActor, scope: DesignAgentScope, client: Pool | PoolClient = this.database) {
    const result = await client.query(
      `select g.id from private.design_agent_grants g join public.admin_memberships m on m.user_id=g.user_id
      join private.auth_user_identity u on u.id=g.user_id where g.id=$1 and g.user_id=$2 and g.revoked_at is null and g.expires_at>now() and $3=any(g.scopes)
      and m.active and u.email_confirmed_at is not null and not coalesce(u.is_anonymous,false) and (u.banned_until is null or u.banned_until<=now()) for share of g,m`,
      [actor.grantId, actor.userId, scope]
    )
    if (!result.rows.length)
      throw new DesignAgentError("FORBIDDEN", "Agent grant expired, was revoked, or lacks current administrator access")
  }
}
