import { readFile } from "node:fs/promises"
import { basename } from "node:path"
import { pathToFileURL } from "node:url"
import { normalizeImageRequest } from "./request.mjs"
import { readProviderKey } from "./credentials.mjs"
import { resolvePaidApiAuthorization } from "./authorization.mjs"
import { hashReferenceImages, prepareImageOutput, createImageWriter, completeHostReceipt } from "./receipt.mjs"
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
    provider.validate(request)
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
      `Paid image generation needs the owner's authorization from the active conversation: pass --authorized-by-owner once the owner has approved paid generation there. ${
        authorization.savedDelegation === true
          ? "The saved delegation.imageGeneration.paidApi in .store-setup.local.json is evidence to cite, not permission on its own."
          : "A saved delegation in .store-setup.local.json is evidence only and never authorizes spending by itself."
      } A large requested count never authorizes a paid API.`
    )
  const key = await readProviderKey(definition.key, environment)
  const provider = definition.create({ key, environment, fetcher })
  provider.validate(request)
  // Collisions and resumable progress are settled before the provider can bill anything.
  const { images, resumed } = await prepareImageOutput(request, publicReferences)
  const writer = createImageWriter({
    request,
    provider: { name: provider.name, model: provider.model },
    references: publicReferences,
    images,
  })
  let notes = []
  try {
    notes = (await provider.generate(request, references, writer)).notes
  } catch (error) {
    if (writer.completed === 0) throw error
    const receipt = await writer.finish({ notes: [`generation stopped: ${error.message}`] })
    throw new Error(
      `${error.message}. ${receipt.completed} of ${request.count} images are saved and recorded as incomplete in ${receipt.receiptPath}; rerun the same command to generate only the remaining ${request.count - receipt.completed}.`
    )
  }
  const receipt = await writer.finish({ notes })
  return { ...receipt, authorization: authorization.source, resumed }
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
