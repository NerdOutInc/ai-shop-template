import assert from "node:assert/strict"
import { spawn, execFileSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { createWriteStream } from "node:fs"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { cpus } from "node:os"
import { setTimeout as pause } from "node:timers/promises"

import { Pool } from "pg"
import Stripe from "stripe"

import { configuredStoreConfig } from "../../test/configured-store-config.ts"
import { parseCheckoutCapacityLimits } from "../../src/features/checkout/parse-checkout-capacity-limits.ts"

import { catalogProducts } from "../../e2e/catalog-products.ts"
import { commerceTestConfig as config } from "../../e2e/commerce/test-config.ts"
import { assertIsolatedDatabase } from "../../test/assert-isolated-database.ts"
import { readProviderDelay } from "../../e2e/commerce/read-provider-delay.ts"
import { createLoadProxy } from "./create-load-proxy.mjs"
import { readLoadSourceHash } from "./read-load-source-hash.mjs"

// Deliberately has no remote target option. These fixtures replace this disposable schema.
assertIsolatedDatabase(config.databaseUrl, "store_catalog_e2e")
const rates = (process.env.LOAD_RATES ?? "1,10,25,50,100").split(",").map(Number)
const seconds = Number(process.env.LOAD_STAGE_SECONDS ?? 60)
const instances = Number(process.env.LOAD_INSTANCES ?? 4)
const providerDelay = readProviderDelay(250)
const applicationConnectionLimit = 30
const fixtureDirectory = ".tmp/commerce-storefront-e2e"
const checkoutCapacityLimits = parseCheckoutCapacityLimits(process.env.CHECKOUT_CAPACITY_LIMITS)
let nextClient = 0
assert(rates.every((n) => Number.isFinite(n) && n > 0 && n <= 200))
assert(Number.isInteger(seconds) && seconds >= 10 && seconds <= 600)
assert(Number.isInteger(instances) && instances >= 1 && instances <= 8)
const output = process.env.LOAD_OUTPUT ?? `.tmp/load-results/${Date.now()}`
await mkdir(output, { recursive: true })
const children = []
const observations = new Map()
const logs = []
const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 2,
  connectionTimeoutMillis: 5_000,
  query_timeout: 10_000,
})
const runtimeRole = `store_load_${randomUUID().replaceAll("-", "")}`
let runtimeRoleCreated = false
const shutdown = new AbortController()
const signer = new Stripe(config.stripeKey)
const sessions = []
const sourceHash = await readLoadSourceHash()
const report = {
  status: "running",
  commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  workingTreeChanges: Boolean(
    execFileSync("git", ["status", "--porcelain", "--untracked-files=normal"], { encoding: "utf8" }).trim()
  ),
  testedSourceSha256: sourceHash.sha256,
  sourceHashVersion: sourceHash.version,
  buildId: (await readFile(`${fixtureDirectory}/.next/BUILD_ID`, "utf8")).trim(),
  node: process.version,
  appMachine: { cpu: cpus()[0]?.model, logicalCpus: cpus().length },
  instances,
  providerDelayMs: providerDelay,
  applicationConnectionLimit,
  checkoutCapacityLimits,
  clientIdentity: "Distinct synthetic Vercel ingress addresses; retry probe shares one client identity",
  workload:
    "Open-loop arrivals: three HTML pages, 500ms think time; every twentieth visit checks out and pays. No CDN, images, JS or real providers.",
  stages: [],
}
let proxy
let sampleTimer
let stage
let sampling

function start(name, args, environment) {
  shutdown.signal.throwIfAborted()
  const log = createWriteStream(`${output}/${name}.log`)
  logs.push(log)
  const child = spawn(process.execPath, args, {
    env: { ...process.env, ...environment },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  })
  child.on("message", (message) => {
    if (message.type !== "pool-observation") return
    observations.set(child.pid, message.waiting)
    if (stage)
      stage.peakWaitingForConnection = Math.max(
        stage.peakWaitingForConnection,
        [...observations.values()].reduce((sum, waiting) => sum + waiting, 0)
      )
  })
  child.stdout.pipe(log)
  child.stderr.pipe(log)
  children.push(child)
  child.on("error", fail)
  log.on("error", fail)
  return child
}
async function ready(url, child) {
  for (let attempt = 0; attempt < 120; attempt++) {
    shutdown.signal.throwIfAborted()
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Fixture process exited: ${url}`)
    try {
      const response = await fetch(url, { signal: AbortSignal.any([shutdown.signal, AbortSignal.timeout(1000)]) })
      await response.text()
      if (response.ok) return
    } catch {}
    await pause(250, undefined, { signal: shutdown.signal })
  }
  throw new Error(`Fixture startup timed out: ${url}`)
}
async function request(path, options = {}, label = path) {
  const started = performance.now()
  let status = 0
  let complete = false
  try {
    const response = await fetch(`${config.baseURL}${path}`, {
      ...options,
      signal: AbortSignal.any([shutdown.signal, AbortSignal.timeout(15_000)]),
    })
    status = response.status
    const body = await response.text()
    complete = true
    return { status, body, json: () => JSON.parse(body) }
  } finally {
    stage?.requests.push({ label, status: complete ? status : 0, ms: performance.now() - started })
  }
}
function post(body, client = nextClient++) {
  return {
    method: "POST",
    headers: {
      origin: config.baseURL,
      "content-type": "application/json",
      // The loopback fixture models Vercel's trusted ingress; no production identity is used.
      "x-vercel-forwarded-for": `198.${18 + Math.floor(client / 65536)}.${Math.floor(client / 256) % 256}.${client % 256}`,
    },
    body: JSON.stringify(body),
  }
}
async function provider(path) {
  const response = await fetch(`${config.providerURL}${path}`, {
    method: "POST",
    signal: AbortSignal.any([shutdown.signal, AbortSignal.timeout(5000)]),
  })
  assert.equal(response.status, 200)
  return response.json()
}
function event(sessionId) {
  const body = JSON.stringify({
    id: `evt_load_${sessionId}`,
    type: "checkout.session.completed",
    data: { object: { id: sessionId } },
  })
  return {
    method: "POST",
    body,
    headers: {
      "content-type": "application/json",
      "stripe-signature": signer.webhooks.generateTestHeaderString({ payload: body, secret: config.webhookSecret }),
    },
  }
}
function checkoutInput() {
  return {
    requestId: randomUUID(),
    expectedShippingAmount: configuredStoreConfig.commerce.firstItemShippingCents,
    items: [{ productId: catalogProducts[0].id, variantId: 1004, quantity: 1, expectedUnitAmount: 3200 }],
  }
}
async function visit(index, buying) {
  for (const [path, expected] of [
    ["/", "<main"],
    ["/shop", catalogProducts[0].title],
    [`/shop/${catalogProducts[index % catalogProducts.length].id}`, "Fixture"],
  ]) {
    const response = await request(path, {}, path.startsWith("/shop/") ? "product" : path)
    assert.equal(response.status, 200, `${path}: ${response.body.slice(0, 160)}`)
    assert(response.body.includes(expected), `Missing storefront content: ${path}`)
    await pause(500, undefined, { signal: shutdown.signal })
  }
  if (!buying) return
  const checkout = await request("/api/checkout", post(checkoutInput()))
  if (checkout.status === 429) stage.rateLimitedVisits++
  assert.equal(checkout.status, 200)
  const { sessionId } = checkout.json()
  assert(sessionId)
  await provider(`/fixtures/${sessionId}/paid`)
  sessions.push(sessionId)
  const webhook = await request("/api/webhooks/stripe", event(sessionId))
  assert.equal(webhook.status, 200)
}
function summary(samples) {
  const sorted = samples.map((sample) => sample.ms).sort((a, b) => a - b)
  return {
    requests: sorted.length,
    errors: samples.filter((sample) => sample.status < 200 || sample.status >= 400).length,
    p50Ms: Math.round(sorted[Math.max(0, Math.ceil(sorted.length * 0.5) - 1)] ?? 0),
    p95Ms: Math.round(sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0),
    maxMs: Math.round(sorted.at(-1) ?? 0),
    statuses: samples.reduce(
      (counts, sample) => ({ ...counts, [sample.status]: (counts[sample.status] ?? 0) + 1 }),
      {}
    ),
  }
}
async function runStage(name, rate, duration, checkout = true) {
  stage = {
    name,
    arrivalsPerSecond: rate,
    scheduledSeconds: duration,
    visits: 0,
    failedVisits: 0,
    rateLimitedVisits: 0,
    generatorDrops: 0,
    peakAppConnections: 0,
    peakActiveConnections: 0,
    peakWaitingForConnection: 0,
    requests: [],
  }
  const started = performance.now()
  const pending = new Set()
  const arrivalLags = []
  const count = Math.ceil(rate * duration)
  try {
    for (let index = 0; index < count; index++) {
      await pause(Math.max(0, started + (index * 1000) / rate - performance.now()), undefined, {
        signal: shutdown.signal,
      })
      arrivalLags.push(Math.max(0, performance.now() - started - (index * 1000) / rate))
      if (pending.size >= 512) {
        stage.generatorDrops++
        continue
      }
      stage.visits++
      const task = visit(index, checkout && index % 20 === 19)
        .catch((error) => {
          stage.failedVisits++
          if (stage.failedVisits <= 5) console.error(`${name} visit failed: ${error.message}`)
        })
        .finally(() => pending.delete(task))
      pending.add(task)
    }
  } finally {
    await Promise.all(pending)
  }
  const samples = stage.requests
  const result = {
    ...stage,
    actualSecondsIncludingDrain: Math.round((performance.now() - started) / 100) / 10,
    arrivalLagP95Ms: Math.round(arrivalLags.sort((a, b) => a - b)[Math.ceil(arrivalLags.length * 0.95) - 1]),
    requests: summary(samples),
    byRoute: Object.fromEntries(
      [...new Set(samples.map((sample) => sample.label))].map((label) => [
        label,
        summary(samples.filter((sample) => sample.label === label)),
      ])
    ),
  }
  report.stages.push(result)
  stage = undefined
  console.log(JSON.stringify(result))
  return result
}

function stop(error, exitCode) {
  if (shutdown.signal.aborted) return
  process.exitCode = exitCode
  shutdown.abort(error instanceof Error ? error : new Error(String(error)))
  // Seeding may be awaiting child exit rather than an abortable request.
  for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM")
}
function fail(error) {
  stop(error, 1)
}
function interrupt(signal) {
  stop(new Error(`Load test interrupted by ${signal}`), signal === "SIGINT" ? 130 : 143)
}
const onInterrupt = () => interrupt("SIGINT")
const onTerminate = () => interrupt("SIGTERM")
process.on("SIGINT", onInterrupt)
process.on("SIGTERM", onTerminate)
// This CLI never resumes work after an unexpected event-handler failure; abort into cleanup.
process.on("uncaughtException", fail)
process.on("unhandledRejection", fail)
pool.on("error", fail)

try {
  await rm(`${fixtureDirectory}/.next/cache/fetch-cache`, { recursive: true, force: true })
  const seed = start(
    "seed",
    ["--conditions=react-server", "--import=tsx", "e2e/prepare-catalog.ts"],
    config.environment
  )
  await new Promise((resolve, reject) => {
    seed.once("error", reject)
    seed.once("exit", (code) => (code === 0 ? resolve() : reject(new Error("Fixture seeding failed"))))
  })
  shutdown.signal.throwIfAborted()
  // Inherit the app's real grants and RLS through a run-specific login. Its connection cap must
  // not alter store_app_runtime, which other test databases on this cluster also use.
  await pool.query(
    `create role "${runtimeRole}" with login inherit nosuperuser nocreatedb nocreaterole
      noreplication nobypassrls password 'runtime-fixture' connection limit ${applicationConnectionLimit} in role store_app_runtime`
  )
  runtimeRoleCreated = true
  report.database = (
    await pool.query(
      "select version(), current_setting('max_connections') as max_connections, current_setting('shared_buffers') as shared_buffers"
    )
  ).rows[0]
  const runtimeUrl = new URL(config.databaseUrl)
  runtimeUrl.username = runtimeRole
  runtimeUrl.password = "runtime-fixture"
  const providers = start("providers", ["--import=tsx", "e2e/commerce/provider-server.ts"], {
    ...config.environment,
    COMMERCE_PROVIDER_DELAY_MS: String(providerDelay),
  })
  await ready(`${config.providerURL}/health`, providers)
  for (let index = 0; index < instances; index++) {
    runtimeUrl.searchParams.set("application_name", `store-load-${index}`)
    const port = config.port + index + 1
    const app = start(
      `app-${index}`,
      [
        "--import=./scripts/load/observe-pools.mjs",
        "node_modules/next/dist/bin/next",
        "start",
        fixtureDirectory,
        "--hostname",
        "127.0.0.1",
        "--port",
        String(port),
      ],
      {
        ...config.environment,
        VERCEL: "1",
        DATABASE_URL: runtimeUrl.toString(),
        CHECKOUT_CAPACITY_LIMITS: JSON.stringify(checkoutCapacityLimits),
      }
    )
    await ready(`http://127.0.0.1:${port}/api/health`, app)
  }
  proxy = createLoadProxy({
    workerPorts: Array.from({ length: instances }, (_, index) => config.port + index + 1),
    signal: shutdown.signal,
  })
  proxy.on("error", fail)
  await new Promise((resolve, reject) => {
    proxy.once("error", reject)
    proxy.listen(config.port, "127.0.0.1", resolve)
  })
  sampleTimer = setInterval(() => {
    if (sampling) return
    sampling = pool
      .query(
        "select count(*)::int as total, count(*) filter (where state='active')::int as active from pg_stat_activity where usename=$1 and datname='store_catalog_e2e'",
        [runtimeRole]
      )
      .then(({ rows }) => {
        if (stage) {
          stage.peakAppConnections = Math.max(stage.peakAppConnections, rows[0].total)
          stage.peakActiveConnections = Math.max(stage.peakActiveConnections, rows[0].active)
        }
      })
      .catch(fail)
      .finally(() => {
        sampling = undefined
      })
  }, 100)
  assert.equal((await runStage("cold", 10, 1, false)).failedVisits, 0, "Cold storefront validation failed")
  for (const rate of rates) {
    const result = await runStage(`mixed-${rate}`, rate, seconds)
    await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2))
    if (result.failedVisits / result.visits > 0.01 || result.generatorDrops > 0) break
  }
  // Let shared admission debt refill before the independent retry probe; never reset or bypass it.
  const { rows: debt } = await pool.query(
    "select coalesce(greatest(0, extract(epoch from (max(available_at) - clock_timestamp())) * 1000), 0) as ms from commerce.checkout_capacity where bucket in ('ingress', 'provider', 'stripe-read')"
  )
  report.retryProbeWaitMs = Math.ceil(Number(debt[0].ms)) + 100
  assert(report.retryProbeWaitMs <= 60_000, "Custom admission limits need more than a minute to refill")
  await pause(report.retryProbeWaitMs, undefined, { signal: shutdown.signal })
  // Deliver retries concurrently to different workers and then replay after the first completes.
  const input = checkoutInput()
  const retryClient = nextClient++
  const retries = await Promise.all(Array.from({ length: 8 }, () => request("/api/checkout", post(input, retryClient))))
  assert(
    retries.every(
      (response) =>
        response.status === 200 ||
        (response.status === 409 && response.json().code === "ORDER_BUSY") ||
        (response.status === 429 && response.json().code === "CHECKOUT_RATE_LIMITED")
    )
  )
  const created = retries.find((response) => response.status === 200)?.json()
  assert(created?.sessionId)
  const { sessionId } = created
  await provider(`/fixtures/${sessionId}/paid`)
  sessions.push(sessionId)
  await provider(`/fixtures/${sessionId}/fail-production`)
  const deliveries = await Promise.all(
    Array.from({ length: 8 }, () => request("/api/webhooks/stripe", event(sessionId)))
  )
  assert(deliveries.every((response) => [200, 500].includes(response.status)))
  assert.equal((await request("/api/webhooks/stripe", event(sessionId))).status, 200)
  const recovery = await provider(`/fixtures/${sessionId}`)
  assert.equal(recovery.creates, 1)
  assert.equal(recovery.orders.length, 1)
  assert.equal(recovery.orders[0].submissions, 1)
  report.duplicateRecovery = {
    concurrentCheckoutAttempts: retries.map((r) => r.status),
    concurrentWebhooks: deliveries.map((r) => r.status),
    stripeCreates: recovery.creates,
    printOrders: recovery.orders.length,
    printSubmissions: recovery.orders[0].submissions,
  }
  // Recover any paid work that timed out during the deliberate overload stage, exactly as redelivery would.
  let recovered = 0
  for (const id of sessions) {
    const { rows } = await pool.query("select state from commerce.checkout_orders where session_id=$1", [id])
    if (rows[0]?.state !== "submitted") {
      assert.equal((await request("/api/webhooks/stripe", event(id))).status, 200)
      recovered++
    }
    const fixture = await provider(`/fixtures/${id}`)
    assert.equal(fixture.orders.length, 1)
    assert.equal(fixture.orders[0].submissions, 1)
    assert.equal(fixture.creates, 1)
  }
  report.integrity = { verifiedPaidOrders: sessions.length, recoveredAfterOverload: recovered, duplicateOrders: 0 }
  const paid = await pool.query(
    "select count(*)::int as total, count(*) filter (where state='submitted')::int as submitted from commerce.checkout_orders where payment is not null"
  )
  assert.equal(paid.rows[0].total, sessions.length)
  assert.equal(paid.rows[0].submitted, sessions.length)
  await pause(5500, undefined, { signal: shutdown.signal })
  report.idleAppConnectionsAfterDrain = (
    await pool.query(
      "select count(*)::int as count from pg_stat_activity where usename=$1 and datname='store_catalog_e2e'",
      [runtimeRole]
    )
  ).rows[0].count
  assert.equal(report.idleAppConnectionsAfterDrain, 0)
  clearInterval(sampleTimer)
  await sampling
  shutdown.signal.throwIfAborted()
} catch (error) {
  process.exitCode ||= 1
  report.status = shutdown.signal.aborted && process.exitCode !== 1 ? "interrupted" : "failed"
  report.failure = (shutdown.signal.reason ?? error).message
  console.error(report.failure)
} finally {
  clearInterval(sampleTimer)
  await sampling
  proxy?.closeAllConnections()
  proxy?.close()
  await Promise.all(
    children
      .filter((child) => child.exitCode === null && child.signalCode === null)
      .map(
        (child) =>
          new Promise((resolve) => {
            const timeout = setTimeout(() => child.kill("SIGKILL"), 5000)
            child.once("exit", () => {
              clearTimeout(timeout)
              resolve()
            })
            child.kill("SIGTERM")
          })
      )
  )
  for (const log of logs) log.end()
  try {
    if (runtimeRoleCreated) await pool.query(`drop role "${runtimeRole}"`)
  } finally {
    await pool.end()
    process.off("SIGINT", onInterrupt)
    process.off("SIGTERM", onTerminate)
    process.off("uncaughtException", fail)
    process.off("unhandledRejection", fail)
  }
}
if (report.status === "running") {
  report.status = shutdown.signal.aborted ? (process.exitCode === 1 ? "failed" : "interrupted") : "completed"
  if (shutdown.signal.aborted) report.failure = shutdown.signal.reason.message
}
await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2))
console.log(
  JSON.stringify({
    status: report.status,
    integrity: report.integrity,
    duplicateRecovery: report.duplicateRecovery,
    idleAppConnectionsAfterDrain: report.idleAppConnectionsAfterDrain,
    report: `${output}/report.json`,
  })
)
