import { readFile } from "node:fs/promises"
import { basename } from "node:path"
import { pathToFileURL } from "node:url"
import { normalizeImageRequest } from "./request.mjs"
import { readProviderKey } from "./credentials.mjs"
import { resolvePaidApiAuthorization } from "./authorization.mjs"
import { hashReferenceImages, writeImageReceipt, completeHostReceipt } from "./receipt.mjs"
import { createOpenAiProvider } from "./openai.mjs"
import { createGeminiProvider } from "./gemini.mjs"
import { createHostProvider } from "./host.mjs"

const usage =
  "Usage: pnpm imagegen --input <JSON file> [--dry-run] [--authorized-by-owner] [--complete]\nSet IMAGE_PROVIDER to openai, gemini or host (default). Keys come from OPENAI_API_KEY / GEMINI_API_KEY or their *_FILE paths; never put one in an argument or chat."
const providers = {
  openai: { key: "OPENAI_API_KEY", create: createOpenAiProvider },
  gemini: { key: "GEMINI_API_KEY", create: createGeminiProvider },
  host: { key: null, create: createHostProvider },
}

export function parseImageGenerationArguments(argv) {
  const flags = new Set()
  let input = null
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index]
    if (argument === "--input") {
      input = argv[++index]
      if (!input) throw new Error(usage)
    } else if (["--dry-run", "--authorized-by-owner", "--complete"].includes(argument)) flags.add(argument)
    else throw new Error(usage)
  }
  if (!input) throw new Error(usage)
  return { input, flags: [...flags] }
}

/** The whole command, with every side effect injectable so tests never reach a paid provider. */
export async function runImageGeneration({ argv, environment = process.env, fetcher = fetch, cwd = process.cwd() }) {
  const { input, flags } = parseImageGenerationArguments(argv)
  const request = normalizeImageRequest(JSON.parse(await readFile(input, "utf8")), { cwd })
  const providerName = environment.IMAGE_PROVIDER || "host"
  const definition = providers[providerName]
  if (!definition) throw new Error(`IMAGE_PROVIDER must be one of ${Object.keys(providers).join(", ")}`)
  const references = (await hashReferenceImages(request.referenceImages)).map((reference) => ({
    ...reference,
    fileName: basename(reference.path),
  }))
  const publicReferences = references.map(({ path, bytes, sha256, mimeType }) => ({ path, bytes, sha256, mimeType }))
  if (flags.includes("--complete"))
    return completeHostReceipt({ request, provider: createHostProvider(), references: publicReferences })
  if (providerName === "host") return createHostProvider().instructions(request, publicReferences)
  const authorization = await resolvePaidApiAuthorization({ flags, cwd })
  if (flags.includes("--dry-run")) {
    const provider = definition.create({ key: "", environment, fetcher })
    return {
      dryRun: true,
      provider: providerName,
      ...provider.describe(request),
      count: request.count,
      size: request.size,
      quality: request.quality,
      background: request.background,
      referenceImages: references.length,
      authorization,
      wouldWrite: Array.from({ length: request.count }, (_, index) => `${request.baseName}-${index + 1}.png`),
      outputDir: request.outputDir,
    }
  }
  if (!authorization.authorized)
    throw new Error(
      `Paid image generation needs the owner's authorization: pass --authorized-by-owner after the owner approves it in the active conversation, or record delegation.imageGeneration.paidApi: true in .store-setup.local.json. A large requested count never authorizes a paid API by itself.`
    )
  const key = await readProviderKey(definition.key, environment)
  const provider = definition.create({ key, environment, fetcher })
  const result = await provider.generate(request, references)
  const receipt = await writeImageReceipt({
    request,
    provider: { name: provider.name, model: provider.model, requestId: result.requestId, seed: result.seed },
    images: result.images,
    references: publicReferences,
  })
  return { ...receipt, authorization: authorization.source, notes: result.notes }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await runImageGeneration({ argv: process.argv.slice(2) })
    process.stdout.write(JSON.stringify(result, null, 2) + "\n")
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Image generation failed")
    process.exitCode = 1
  }
}
