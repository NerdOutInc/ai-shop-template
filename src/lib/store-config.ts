import { storeConfigSchema } from "./store-config-schema"
import { storeConfigValues } from "./store-config-values"

export const storeConfig = storeConfigSchema.parse(storeConfigValues)
