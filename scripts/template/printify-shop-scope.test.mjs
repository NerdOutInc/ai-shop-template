import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { auditPrintifyShopScope } from "./printify-shop-scope.mjs"

const shopId = 918273
const token = "fake-test-only-secret-sentinel"
const environment = { PRINTIFY_SHOP_ID: String(shopId), PRINTIFY_API_TOKEN: token }
const cliPath = fileURLToPath(new URL("./printify-shop-scope.mjs", import.meta.url))

test("each configured token uses only the read-only shop endpoint and counts additional shops", async () => {
  const requests = []
  const result = await auditPrintifyShopScope(
    { ...environment, PRINTIFY_PUBLISHING_API_TOKEN: `${token}-publish`, PRINTIFY_DRAFTS_API_TOKEN: `${token}-draft` },
    {
      fetchImpl: async (url, options) => {
        requests.push({ url, options })
        return Response.json([
          { id: shopId, title: "private-first-title" },
          { id: 654321, title: "private-other-title" },
        ])
      },
    }
  )
  assert.equal(result.exitCode, 0)
  assert.equal(requests.length, 3)
  assert.equal(result.lines.filter((line) => line.startsWith("WARN ")).length, 3)
  assert.match(result.lines[0], /visible shops=2, other shops=1/)
  for (const { url, options } of requests) {
    assert.equal(url, "https://api.printify.com/v1/shops.json")
    assert.equal(options.method, "GET")
    assert.equal(options.redirect, "error")
    assert.equal(options.body, undefined)
    assert.match(options.headers.Authorization, /^Bearer fake-test-only-/)
    assert.ok(options.headers["User-Agent"])
  }
  const output = result.lines.join("\n")
  for (const secret of [token, String(shopId), "654321", "private-first-title", "private-other-title"])
    assert.equal(output.includes(secret), false)
})

test("one visible shop passes but a missing intended shop fails, including an empty listing", async () => {
  const pass = await auditPrintifyShopScope(environment, { fetchImpl: async () => Response.json([{ id: shopId }]) })
  assert.equal(pass.exitCode, 0)
  assert.match(pass.lines[0], /^PASS PRINTIFY_API_TOKEN:/)
  assert.match(pass.lines.at(-1), /does not prove shop isolation/)
  for (const shops of [[], [{ id: 654321 }]]) {
    const result = await auditPrintifyShopScope(environment, { fetchImpl: async () => Response.json(shops) })
    assert.equal(result.exitCode, 1)
    assert.match(result.lines[0], /^FAIL PRINTIFY_API_TOKEN: configured shop is absent/)
  }
})

test("authorization, capability and availability failures remain distinct and unverified", async () => {
  for (const [status, reason] of [
    [401, /authentication rejected/],
    [403, /shop listing denied.*permissions may omit shops.read/],
    [429, /shop listing unavailable/],
    [503, /shop listing unavailable/],
    [302, /shop listing unavailable/],
  ]) {
    const result = await auditPrintifyShopScope(environment, {
      fetchImpl: async () => new Response(`${token} private-response-title`, { status }),
    })
    assert.equal(result.exitCode, 2)
    assert.match(result.lines[0], /^UNVERIFIED PRINTIFY_API_TOKEN:/)
    assert.match(result.lines[0], reason)
    assert.match(result.lines.join("\n"), /Keep runtime token scopes unchanged/)
    assert.equal(result.lines.join("\n").includes(token), false)
    assert.equal(result.lines.join("\n").includes("private-response-title"), false)
  }
})

test("malformed bodies never claim a complete listing or print response contents", async () => {
  for (const body of [{ data: [{ id: shopId }] }, [null], [{ id: "918273" }], [{ id: shopId }, {}]]) {
    const result = await auditPrintifyShopScope(environment, { fetchImpl: async () => Response.json(body) })
    assert.equal(result.exitCode, 2)
    assert.match(result.lines[0], /malformed shop listing/)
    assert.equal(result.lines.join("\n").includes(String(shopId)), false)
  }
  const result = await auditPrintifyShopScope(environment, {
    fetchImpl: async () => new Response(`not-json-${token}`),
  })
  assert.equal(result.exitCode, 2)
  assert.match(result.lines[0], /could not be read/)
  assert.equal(result.lines.join("\n").includes(token), false)
})

test("network errors and timeouts remain unverified without leaking error text", async () => {
  const network = await auditPrintifyShopScope(environment, {
    fetchImpl: async () => {
      throw new Error(`private URL or credential: ${token}`)
    },
  })
  assert.equal(network.exitCode, 2)
  assert.match(network.lines[0], /request failed/)
  assert.equal(network.lines.join("\n").includes(token), false)
  const timeout = await auditPrintifyShopScope(environment, {
    timeoutMs: 5,
    fetchImpl: async (_url, { signal }) =>
      new Promise((_resolve, reject) =>
        signal.addEventListener("abort", () => reject(new Error(token)), { once: true })
      ),
  })
  assert.equal(timeout.exitCode, 2)
  assert.match(timeout.lines[0], /request timed out/)
  assert.equal(timeout.lines.join("\n").includes(token), false)
})

test("a timed-out response body does not become verified", async () => {
  const result = await auditPrintifyShopScope(environment, {
    timeoutMs: 5,
    fetchImpl: async (_url, { signal }) => ({
      status: 200,
      json: () =>
        new Promise((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(new Error(token)), { once: true })
        ),
    }),
  })
  assert.equal(result.exitCode, 2)
  assert.match(result.lines[0], /request timed out/)
})

test("invalid inputs fail before a request and absent optional tokens are not required", async () => {
  const fetchImpl = async () => {
    assert.fail("Invalid input must not make provider requests")
  }
  for (const values of [
    {},
    { ...environment, PRINTIFY_SHOP_ID: "not-a-shop" },
    { PRINTIFY_SHOP_ID: String(shopId) },
    { ...environment, PRINTIFY_API_TOKEN: "[SENSITIVE]" },
    { ...environment, PRINTIFY_API_TOKEN: "[ENCRYPTED]" },
    { ...environment, PRINTIFY_API_TOKEN: `${token}\r\nextra` },
    { ...environment, PRINTIFY_API_TOKEN: "   " },
  ]) {
    const result = await auditPrintifyShopScope(values, { fetchImpl })
    assert.equal(result.exitCode, 1)
    assert.equal(result.lines.join("\n").includes(token), false)
  }
})

test("a confirmed mismatch remains failure even if a different token is unverified", async () => {
  const result = await auditPrintifyShopScope(
    { ...environment, PRINTIFY_DRAFTS_API_TOKEN: `${token}-draft` },
    {
      fetchImpl: async (_url, { headers }) =>
        headers.Authorization.endsWith("-draft") ? new Response("", { status: 403 }) : Response.json([]),
    }
  )
  assert.equal(result.exitCode, 1)
  assert.match(result.lines[0], /^FAIL /)
  assert.match(result.lines[1], /^UNVERIFIED /)
})

test("CLI uses only explicit file values and hides paths and invalid argument values", () => {
  const directory = mkdtempSync(join(tmpdir(), "printify-scope-test-"))
  try {
    const envPath = join(directory, "private.env")
    const mockPath = join(directory, "mock-fetch.mjs")
    writeFileSync(envPath, `PRINTIFY_SHOP_ID=${shopId}\nPRINTIFY_API_TOKEN=${token}\n`, { mode: 0o600 })
    writeFileSync(join(directory, ".env.local"), `PRINTIFY_DRAFTS_API_TOKEN=local-secret-sentinel\n`)
    writeFileSync(
      mockPath,
      `globalThis.fetch = async (_url, options) => {
        if (options.headers.Authorization !== "Bearer ${token}") throw new Error("ambient-or-local-token-merged");
        return Response.json([{id: ${shopId}}]);
      };`
    )
    const run = (args) =>
      spawnSync(process.execPath, ["--import", mockPath, "--", cliPath, ...args], {
        cwd: directory,
        encoding: "utf8",
        env: { ...process.env, PRINTIFY_PUBLISHING_API_TOKEN: "ambient-secret-sentinel" },
      })
    const success = run(["--env-file", envPath])
    assert.equal(success.status, 0, success.stderr)
    assert.equal(success.stdout.match(/^PASS /gm)?.length, 1)
    assert.equal(success.stdout.includes("PRINTIFY_PUBLISHING_API_TOKEN"), false)
    assert.equal(success.stdout.includes("PRINTIFY_DRAFTS_API_TOKEN"), false)
    writeFileSync(envPath, `PRINTIFY_SHOP_ID=${shopId}\n`)
    assert.equal(run(["--env-file", envPath]).status, 1)
    for (const args of [
      [],
      ["--token", token],
      ["--env-file", join(directory, token)],
      ["--env-file", envPath, token],
    ]) {
      const failure = run(args)
      assert.equal(failure.status, 1)
      const output = `${failure.stdout}${failure.stderr}`
      for (const secret of [token, directory, "ambient-secret-sentinel", "local-secret-sentinel"])
        assert.equal(output.includes(secret), false)
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
