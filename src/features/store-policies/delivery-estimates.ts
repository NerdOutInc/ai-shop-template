import { storeConfig } from "@/lib/store-config"

// Owner-reviewed estimates shared by checkout, policy copy, feeds, and order reminders.
export const deliveryEstimates = {
  ...storeConfig.commerce.deliveryEstimates,
  businessDays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
  calendar:
    "Business days are Monday–Friday, excluding US public holidays. Estimates start the next business day after payment is confirmed.",
}
