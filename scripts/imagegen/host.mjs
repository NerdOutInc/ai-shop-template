import { imageFilePath } from "./receipt.mjs"

/**
 * The host path costs nothing and calls nothing: it hands the agent the exact prompt and the
 * paths the receipt expects, so a built-in image tool (Claude Code, Codex, Cursor or another
 * host) can produce the files, after which `--complete` hashes them into the same receipt.
 */
export function createHostProvider() {
  return {
    name: "host",
    model: null,
    validate() {},
    describe() {
      return { endpoint: "host image tool", model: null }
    },
    instructions(request, references) {
      return {
        status: "pending-host",
        provider: "host",
        prompt: request.prompt,
        size: request.size,
        quality: request.quality,
        background: request.background,
        count: request.count,
        referenceImages: references.map(({ path, sha256, mimeType }) => ({ path, sha256, mimeType })),
        expectedFiles: Array.from({ length: request.count }, (_, index) => imageFilePath(request, index + 1)),
        nextStep:
          "Generate each image with the host's image tool using this exact prompt and these references, save PNG files at the expected paths, then rerun the same command with --complete to write the receipt.",
      }
    },
  }
}
