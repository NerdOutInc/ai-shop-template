export type PublishingHealthCounts = {
  activeProducts: number
  attentionJobs: number
  overdueJobs: number
  checkedProducts: number
}

export type PublishingHealthSnapshot = Omit<PublishingHealthCounts, "checkedProducts"> & {
  productIds: string[]
  openJobProductIds: string[]
  openJobProductCount: number
  failedPublications: number
}

export type PublishingHealth = {
  status: "healthy" | "unhealthy"
  checkedAt: string
  issues: string[]
  counts: PublishingHealthCounts
}
