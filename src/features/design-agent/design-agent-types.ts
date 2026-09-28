export type DesignAgentScope = "library:read" | "library:write" | "drafts:create"
export type DesignAgentActor = { userId: string; grantId: string }
export type DesignAgentGrant = {
  id: string
  label: string
  scopes: DesignAgentScope[]
  createdAt: string
  expiresAt: string
  revokedAt: string | null
}
export type DesignDirection = {
  slot: number
  subject: string
  mechanism: string
  composition: string
  lettering: string
  avoidDesignNumbers: number[]
  parentDesignNumber?: number
}
export type DesignNeighbor = {
  designId: string
  displayNumber: number
  assetId: string
  distance: number
  fingerprint: string
}
