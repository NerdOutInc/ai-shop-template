import { storeConfig } from "@/lib/store-config"
import { storeTimeZone } from "@/lib/store-time-zone"

/** Weekly feature times use the store's local clock; weekday counts from Sunday = 0. */
export const DOTW_CADENCE = { ...storeConfig.weeklyFeature, timeZone: storeTimeZone }
