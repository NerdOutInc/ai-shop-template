import { z } from "zod"

/**
 * A category's display name, as the create and rename routes accept it.
 *
 * Trimmed before it is measured because commerce.shop_categories refuses a padded name
 * (`name = btrim(name)`), and that refusal would reach the owner as a 503 instead of a 400. Zod
 * counts UTF-16 units where Postgres counts characters, so this is never the looser of the two.
 *
 * Control characters are refused for the same reason. Postgres cannot store U+0000 in text at all
 * (22021), which no table check mentions, and trim() leaves it alone because it is not whitespace.
 * The rest of the class goes with it: a tab or a line break inside a storefront label is never meant.
 */
export const categoryNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .regex(/^\P{Cc}*$/u)
