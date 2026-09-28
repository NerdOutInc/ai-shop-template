import { createMerchantFeedHandler } from "@/features/merchant-feed/create-merchant-feed-handler.server"

export const dynamic = "force-dynamic"
export const maxDuration = 60

export const GET = createMerchantFeedHandler("meta")
