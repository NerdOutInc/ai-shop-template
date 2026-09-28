import assert from "node:assert/strict"
import { test } from "node:test"

import { runPublishingMonitor } from "./run-publishing-monitor.mjs"

const now = Date.parse("2026-09-09T22:00:00.000Z")
const environment = {
  PRINTIFY_MONITOR_SECRET: "health-secret-that-is-at-least-32-characters",
  PRINTIFY_MONITOR_URL: "https://example.com/api/internal/printify-publishing/health",
  PRINTIFY_MONITOR_ASSIGNEE: "store-owner",
  GITHUB_TOKEN: "github-token-never-sent-to-the-store",
  GITHUB_REPOSITORY: "example-owner/example-store",
  GITHUB_RUN_ID: "12345",
}
const incident = {
  number: 51,
  title: "Printify publishing needs attention",
  body: "<!-- your-store-publishing-monitor:v1 -->\nTwo consecutive read-only checks found a publishing problem.\n\nSignals: `DATABASE_UNAVAILABLE`.\n\n[Monitor run](https://github.com/example-owner/example-store/actions/runs/100) · [Recovery guide](https://github.com/example-owner/example-store/blob/HEAD/docs/printify-publishing.md#recovery-and-monitoring)",
  user: { login: "github-actions[bot]" },
  assignees: [{ login: "store-owner" }],
}
function health(status = "healthy", issues = []) {
  return {
    status,
    checkedAt: new Date(now).toISOString(),
    issues,
    counts: { activeProducts: 24, attentionJobs: 0, overdueJobs: 0, checkedProducts: 24 },
  }
}

function scenario(probes, existing = []) {
  const requests = []
  const delays = []
  const config = {
    environment,
    now: () => now,
    wait: async (ms) => delays.push(ms),
    fetchImpl: async (url, options) => {
      requests.push({ url, ...options })
      if (url.startsWith("https://example.com/")) {
        const result = probes.shift()
        if (result instanceof Error) throw result
        return new Response(JSON.stringify(result), { status: result.status === "healthy" ? 200 : 503 })
      }
      if (options.method === "GET") return Response.json(existing)
      return Response.json(incident)
    },
  }
  return { config, requests, delays }
}

test("healthy checks stay quiet, keep credentials on their own hosts, and refuse redirects", async () => {
  const { config, requests, delays } = scenario([health()])
  assert.deepEqual(await runPublishingMonitor(config), { status: "healthy", issues: [], incidentNumber: null })
  assert.deepEqual(delays, [])
  assert.equal(requests.length, 2)
  assert.equal(requests[0].headers.Authorization, `Bearer ${environment.PRINTIFY_MONITOR_SECRET}`)
  assert.equal(requests[1].headers.Authorization, `Bearer ${environment.GITHUB_TOKEN}`)
  assert.ok(requests.every((request) => request.redirect === "error" && request.signal instanceof AbortSignal))
  assert.ok(requests.every((request) => !request.body))
})

test("persistent unhealthy checks open one assigned incident with only safe signals", async () => {
  const { config, requests, delays } = scenario([
    health("unhealthy", ["ATTENTION_JOBS"]),
    health("unhealthy", ["ATTENTION_JOBS"]),
  ])
  assert.equal((await runPublishingMonitor(config)).incidentNumber, 51)
  assert.deepEqual(delays, [30_000])
  const create = requests.find((request) => request.method === "POST")
  const body = JSON.parse(create.body)
  assert.deepEqual(body.assignees, ["store-owner"])
  assert.match(body.body, /ATTENTION_JOBS/)
  assert.match(body.body, /actions\/runs\/12345/)
  assert.ok(!body.body.includes(environment.PRINTIFY_MONITOR_SECRET))
  assert.ok(!body.body.includes(environment.GITHUB_TOKEN))
})

test("an ongoing incident produces no repeated comment or new issue", async () => {
  const { config, requests } = scenario(
    [health("unhealthy", ["DATABASE_UNAVAILABLE"]), health("unhealthy", ["DATABASE_UNAVAILABLE"])],
    [incident]
  )
  assert.equal((await runPublishingMonitor(config)).incidentNumber, 51)
  assert.ok(requests.every((request) => !request.body))
})

test("a changed failure updates the existing incident's signals and evidence without comments or new issues", async () => {
  const issues = ["CATALOG_POPULARITY_STALE", "INVENTORY_SCAN_INCOMPLETE"]
  const note = "\n\nOperator note: pool lifecycle fix deployed; investigate the remaining checks."
  const { config, requests } = scenario(
    [health("unhealthy", ["DATABASE_UNAVAILABLE"]), health("unhealthy", issues)],
    [{ ...incident, body: incident.body + note }]
  )
  assert.deepEqual(await runPublishingMonitor(config), { status: "unhealthy", issues, incidentNumber: 51 })
  const mutations = requests.filter((request) => request.body)
  assert.equal(mutations.length, 1)
  assert.equal(mutations[0].method, "PATCH")
  assert.ok(mutations[0].url.endsWith("/issues/51"))
  assert.deepEqual(JSON.parse(mutations[0].body), {
    body:
      incident.body
        .replace("`DATABASE_UNAVAILABLE`", issues.map((code) => `\`${code}\``).join(", "))
        .replace("/runs/100", "/runs/12345") + note,
  })
})

test("unchanged signal sets stay quiet even when ordering, duplicates, and the run link differ", async () => {
  const issues = ["INVENTORY_SCAN_INCOMPLETE", "CATALOG_POPULARITY_STALE", "INVENTORY_SCAN_INCOMPLETE"]
  const { config, requests } = scenario(
    [health("unhealthy", issues), health("unhealthy", issues)],
    [
      {
        ...incident,
        body: incident.body.replace(
          "`DATABASE_UNAVAILABLE`",
          "`CATALOG_POPULARITY_STALE`, `INVENTORY_SCAN_INCOMPLETE`"
        ),
      },
    ]
  )
  await runPublishingMonitor(config)
  assert.ok(requests.every((request) => !request.body))
})

test("a failed signal update fails the monitor visibly", async () => {
  const { config } = scenario(
    [health("unhealthy", ["CATALOG_POPULARITY_STALE"]), health("unhealthy", ["CATALOG_POPULARITY_STALE"])],
    [incident]
  )
  const fetchImpl = config.fetchImpl
  config.fetchImpl = async (url, options) =>
    options.method === "PATCH" ? new Response("private GitHub response", { status: 403 }) : fetchImpl(url, options)
  await assert.rejects(runPublishingMonitor(config), /GitHub incident update failed/)
})

test("missing managed fields are restored without replacing operator notes and subsequent checks stay quiet", async () => {
  const existing = { ...incident, body: "<!-- your-store-publishing-monitor:v1 -->\nOperator investigation notes." }
  const issues = ["CATALOG_POPULARITY_STALE"]
  const { config, requests } = scenario([health("unhealthy", issues), health("unhealthy", issues)], [existing])
  await runPublishingMonitor(config)
  const update = requests.find((request) => request.method === "PATCH")
  const body = JSON.parse(update.body).body
  assert.ok(body.startsWith(existing.body))
  assert.match(body, /Signals: `CATALOG_POPULARITY_STALE`\./)
  assert.match(body, /\[Monitor run\]\(https:\/\/github.com\/example-owner\/example-store\/actions\/runs\/12345\)/)
  const next = scenario([health("unhealthy", issues), health("unhealthy", issues)], [{ ...existing, body }])
  await runPublishingMonitor(next.config)
  assert.ok(next.requests.every((request) => !request.body))
})

test("inventory timeouts remain actionable signals in the incident notification", async () => {
  const issues = ["INVENTORY_SCAN_INCOMPLETE", "PRINTIFY_TIMEOUT"]
  const { config, requests } = scenario([health("unhealthy", issues), health("unhealthy", issues)])
  assert.deepEqual(await runPublishingMonitor(config), { status: "unhealthy", issues, incidentNumber: 51 })
  const create = requests.find((request) => request.method === "POST")
  assert.match(JSON.parse(create.body).body, /PRINTIFY_TIMEOUT/)
})

test("persistent published Merchant defects open a repair incident with the recognized code", async () => {
  const { config, requests } = scenario([
    health("unhealthy", ["MERCHANT_CATALOG_INVALID"]),
    health("unhealthy", ["MERCHANT_CATALOG_INVALID"]),
  ])
  assert.deepEqual(await runPublishingMonitor(config), {
    status: "unhealthy",
    issues: ["MERCHANT_CATALOG_INVALID"],
    incidentNumber: 51,
  })
  const create = requests.find((request) => request.method === "POST")
  assert.match(JSON.parse(create.body).body, /MERCHANT_CATALOG_INVALID/)
})

test("recovery comments on and closes the existing incident", async () => {
  const { config, requests } = scenario([health()], [incident])
  assert.equal((await runPublishingMonitor(config)).status, "healthy")
  const mutations = requests.filter((request) => request.body)
  assert.equal(mutations.length, 2)
  assert.match(mutations[0].url, /\/issues\/51\/comments$/)
  assert.match(JSON.parse(mutations[0].body).body, /healthy again/)
  assert.deepEqual(JSON.parse(mutations[1].body), { state: "closed", state_reason: "completed" })
})

test("a transient provider error that recovers on the retry does not alert", async () => {
  const { config, requests } = scenario([new Error("private error body"), health()])
  assert.equal((await runPublishingMonitor(config)).status, "healthy")
  assert.ok(requests.every((request) => !request.body))
})

test("unknown data and cached or contradictory healthy reports cannot close an incident", async () => {
  for (const bad of [
    { ...health(), checkedAt: new Date(now - 600_000).toISOString() },
    { ...health(), issues: ["private-field-value"] },
    { ...health(), counts: { ...health().counts, checkedProducts: 0 } },
    { ...health(), counts: { ...health().counts, overdueJobs: 1 } },
  ]) {
    const { config, requests } = scenario([bad, bad], [incident])
    const result = await runPublishingMonitor(config)
    assert.equal(result.status, "unhealthy")
    const mutations = requests.filter((request) => request.body)
    assert.equal(mutations.length, 1)
    assert.equal(mutations[0].method, "PATCH")
    assert.deepEqual(Object.keys(JSON.parse(mutations[0].body)), ["body"])
    assert.match(JSON.parse(mutations[0].body).body, /Signals: `HEALTH_RESPONSE_INVALID`\./)
    assert.ok(!mutations[0].body.includes("private-field-value"))
  }
})

test("a human-authored issue cannot suppress the monitor's notification", async () => {
  const { config, requests } = scenario(
    [health("unhealthy", ["OVERDUE_JOBS"]), health("unhealthy", ["OVERDUE_JOBS"])],
    [{ ...incident, user: { login: "someone-else" } }]
  )
  await runPublishingMonitor(config)
  assert.equal(requests.filter((request) => request.method === "POST").length, 1)
})

test("an existing unassigned incident repairs assignment instead of silently suppressing alerts", async () => {
  const { config, requests } = scenario(
    [health("unhealthy", ["ATTENTION_JOBS"]), health("unhealthy", ["ATTENTION_JOBS"])],
    [{ ...incident, assignees: [] }]
  )
  await runPublishingMonitor(config)
  assert.equal(requests.filter((request) => request.url.endsWith("/issues/51/assignees")).length, 1)
})

test("silently dropped assignment on a new issue fails visibly", async () => {
  const { config } = scenario([health("unhealthy", ["ATTENTION_JOBS"]), health("unhealthy", ["ATTENTION_JOBS"])])
  const fetchImpl = config.fetchImpl
  config.fetchImpl = async (url, options) => {
    if (options.method === "POST") return Response.json({ ...incident, assignees: [] })
    return fetchImpl(url, options)
  }
  await assert.rejects(runPublishingMonitor(config), /notification assignment was not confirmed/)
})

test("missing secrets and GitHub write failures fail the monitor without exposing error details", async () => {
  await assert.rejects(runPublishingMonitor({ environment: {} }), /configuration is incomplete/)
  const { config } = scenario([health()])
  const fetchImpl = config.fetchImpl
  config.fetchImpl = async (url, options) => {
    if (url.startsWith("https://api.github.com/")) return new Response("private GitHub response", { status: 403 })
    return fetchImpl(url, options)
  }
  await assert.rejects(runPublishingMonitor(config), /GitHub incident update failed/)
})

test("an opt-in notification test opens and closes a clearly labeled assigned test issue", async () => {
  const { config, requests } = scenario([health()])
  config.environment = { ...environment, PRINTIFY_MONITOR_TEST_NOTIFICATION: "true" }
  assert.equal((await runPublishingMonitor(config)).testIncidentNumber, 51)
  const mutations = requests.filter((request) => request.body)
  assert.equal(mutations.length, 3)
  assert.equal(JSON.parse(mutations[0].body).title, "Test: Printify publishing notifications")
  assert.deepEqual(JSON.parse(mutations[0].body).assignees, ["store-owner"])
  assert.deepEqual(JSON.parse(mutations[2].body), { state: "closed", state_reason: "completed" })
})

test("catalog refresh warnings create a recognized actionable incident before expiry", async () => {
  const issues = [
    "CATALOG_STOCK_STALE",
    "CATALOG_POPULARITY_STALE",
    "CATALOG_STOCK_INVALID",
    "CATALOG_POPULARITY_INVALID",
    "CATALOG_REFRESH_UNAVAILABLE",
  ]
  const { config, requests } = scenario([health("unhealthy", issues), health("unhealthy", issues)])
  assert.deepEqual(await runPublishingMonitor(config), { status: "unhealthy", issues, incidentNumber: 51 })
  const body = JSON.parse(requests.find((request) => request.method === "POST").body).body
  for (const code of issues) assert.ok(body.includes(code))
})

test("missing or unsafe monitor URLs fail before sending credentials anywhere", async () => {
  for (const url of [
    undefined,
    "",
    "http://example.com/api/internal/printify-publishing/health",
    "https://user:password@example.com/api/internal/printify-publishing/health",
    "https://example.com/other",
    "https://example.com/api/internal/printify-publishing/health?token=private",
  ]) {
    let requests = 0
    await assert.rejects(
      runPublishingMonitor({
        environment: { ...environment, PRINTIFY_MONITOR_URL: url },
        fetchImpl: async () => {
          requests++
          throw new Error("must never fetch")
        },
      }),
      /configuration is incomplete/
    )
    assert.equal(requests, 0)
  }
})

test("a configured new repository works without inheriting an incident assignee", async () => {
  const { config, requests } = scenario([
    health("unhealthy", ["ATTENTION_JOBS"]),
    health("unhealthy", ["ATTENTION_JOBS"]),
  ])
  config.environment = { ...environment, GITHUB_REPOSITORY: "new-owner/new-brand", PRINTIFY_MONITOR_ASSIGNEE: "" }
  await runPublishingMonitor(config)
  const create = requests.find((request) => request.method === "POST")
  assert.equal(create.url, "https://api.github.com/repos/new-owner/new-brand/issues")
  assert.equal("assignees" in JSON.parse(create.body), false)
  assert.ok(JSON.parse(create.body).body.includes("https://github.com/new-owner/new-brand/blob/HEAD/docs/"))
  assert.ok(!requests.some((request) => request.url.endsWith("/assignees")))
})
