import "server-only"

import { z } from "zod"

import type {
  DesignCatalogVariant,
  DesignDraftClient,
  DesignDraftRecipe,
  DesignProductPayload,
} from "./design-draft-types"

import { DesignDraftError } from "./design-draft-error"

const object = z.record(z.string(), z.unknown())
const pagination = z.object({
  data: z.array(object),
  current_page: z.number().int().positive(),
  last_page: z.number().int().positive(),
  total: z.number().int().nonnegative(),
})

export class PrintifyDesignDraftClient implements DesignDraftClient {
  constructor(
    private readonly token: string,
    readonly shopId: string,
    private readonly request: typeof fetch = fetch,
    private readonly signal?: AbortSignal
  ) {
    if (!token.trim() || /[\r\n]/.test(token) || !/^\d+$/.test(shopId))
      throw new DesignDraftError("INVALID_INPUT", "Configure the store's Printify product access")
  }
  private async json(path: string, body?: unknown): Promise<unknown> {
    try {
      const response = await this.request(`https://api.printify.com/v1/${path}`, {
        method: body ? "POST" : "GET",
        headers: {
          Authorization: `Bearer ${this.token}`,
          "User-Agent": "Store-Design-Drafts/1.0",
          Accept: "application/json",
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        cache: "no-store",
        redirect: "error",
        signal: this.signal ? AbortSignal.any([this.signal, AbortSignal.timeout(25000)]) : AbortSignal.timeout(25000),
      })
      if (response.status === 404 && !body) return null
      if (!response.ok) {
        if (body && [400, 401, 403, 404, 422].includes(response.status)) {
          const failure = z
            .object({ status: z.literal("error"), message: z.string().min(1) })
            .safeParse(await response.json())
          if (failure.success)
            throw new DesignDraftError(
              "PROVIDER_REJECTED",
              response.status === 401 || response.status === 403
                ? "Printify rejected the request's authorization; verify the dedicated draft token and scopes"
                : "Printify rejected the product or artwork settings; review the requested model, variants, price and artwork",
              response.status
            )
        }
        throw new Error("Provider request failed")
      }
      return await response.json()
    } catch (error) {
      if (error instanceof DesignDraftError) throw error
      throw new DesignDraftError(
        "PROVIDER_UNAVAILABLE",
        "Printify did not return a verifiable response; keep the existing operation for reconciliation"
      )
    }
  }
  async listProducts() {
    const products: Record<string, unknown>[] = []
    let lastPage = 1,
      total: number | undefined
    for (let page = 1; page <= lastPage; page++) {
      const parsed = pagination.safeParse(await this.json(`shops/${this.shopId}/products.json?limit=50&page=${page}`))
      if (
        !parsed.success ||
        parsed.data.current_page !== page ||
        parsed.data.last_page < page ||
        (total !== undefined && total !== parsed.data.total)
      )
        throw new DesignDraftError(
          "PROVIDER_UNAVAILABLE",
          "Printify inventory changed or pagination was incomplete; reconcile again"
        )
      lastPage = parsed.data.last_page
      total = parsed.data.total
      products.push(...parsed.data.data)
      if (lastPage > 10000)
        throw new DesignDraftError("PROVIDER_UNAVAILABLE", "Printify inventory pagination needs operator review")
    }
    if (
      products.some((value) => typeof value.id !== "string" || !value.id || String(value.shop_id) !== this.shopId) ||
      products.length !== total ||
      new Set(products.map((value) => value.id)).size !== products.length
    )
      throw new DesignDraftError(
        "PROVIDER_UNAVAILABLE",
        "Printify inventory pagination was incomplete; reconcile again"
      )
    return products
  }
  async getProduct(productId: string) {
    const raw = await this.json(`shops/${this.shopId}/products/${encodeURIComponent(productId)}.json`)
    if (raw === null) return null
    const value = object.safeParse(raw)
    if (!value.success || value.data.id !== productId || String(value.data.shop_id) !== this.shopId)
      throw new DesignDraftError("PROVIDER_UNAVAILABLE", "Printify product identity could not be verified")
    return value.data
  }
  private async catalogVariants(blueprintId: number, printProviderId: number) {
    const parsed = z
      .object({
        variants: z.array(
          z.object({
            id: z.number(),
            options: z.record(z.string(), z.string()),
            placeholders: z.array(z.object({ position: z.string(), decoration_method: z.string().optional() })),
            is_available: z.boolean().optional(),
          })
        ),
      })
      .safeParse(await this.json(`catalog/blueprints/${blueprintId}/print_providers/${printProviderId}/variants.json`))
    if (!parsed.success)
      throw new DesignDraftError("PROVIDER_UNAVAILABLE", "Printify provider variants could not be verified")
    return parsed.data.variants
  }
  /** Every garment the provider lists for a model, so a recipe can be built from names rather than ids. */
  async listCatalogVariants(input: { blueprintId: number; printProviderId: number; position: "front" }) {
    return (await this.catalogVariants(input.blueprintId, input.printProviderId)).flatMap(
      (variant): DesignCatalogVariant[] =>
        variant.options.color && variant.options.size
          ? [
              {
                id: variant.id,
                color: variant.options.color,
                size: variant.options.size,
                available:
                  variant.is_available !== false &&
                  variant.placeholders.some(
                    (placeholder) =>
                      placeholder.position === input.position &&
                      (!placeholder.decoration_method || placeholder.decoration_method === "dtg")
                  ),
              },
            ]
          : []
    )
  }
  async validateRecipe(recipe: DesignDraftRecipe) {
    const variants = await this.catalogVariants(recipe.blueprintId, recipe.printProviderId)
    for (const requested of recipe.variants) {
      const current = variants.find((variant) => variant.id === requested.id)
      if (
        !current ||
        current.is_available === false ||
        current.options.color !== requested.color ||
        current.options.size !== requested.size ||
        !current.placeholders.some(
          (placeholder) =>
            placeholder.position === recipe.placement.position &&
            (!placeholder.decoration_method || placeholder.decoration_method === "dtg")
        )
      )
        throw new DesignDraftError(
          "INVALID_INPUT",
          "The selected provider, color, size, or print position is unavailable; review the recipe"
        )
    }
  }
  async uploadImage(input: { fileName: string; url: string }) {
    const parsed = z
      .object({
        id: z.string().min(1),
        width: z.number().positive(),
        height: z.number().positive(),
        mime_type: z.string(),
      })
      .safeParse(await this.json("uploads/images.json", { file_name: input.fileName, url: input.url }))
    if (!parsed.success)
      throw new DesignDraftError("PROVIDER_UNAVAILABLE", "The artwork upload receipt could not be verified")
    return { id: parsed.data.id, width: parsed.data.width, height: parsed.data.height, mimeType: parsed.data.mime_type }
  }
  async createProduct(payload: DesignProductPayload) {
    const parsed = z
      .object({ id: z.string().min(1) })
      .safeParse(await this.json(`shops/${this.shopId}/products.json`, payload))
    if (!parsed.success)
      throw new DesignDraftError(
        "PROVIDER_UNAVAILABLE",
        "The product creation response is uncertain; reconcile this operation"
      )
    return parsed.data
  }
}
