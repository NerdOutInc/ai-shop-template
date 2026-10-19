import assert from "node:assert/strict"
import http from "node:http"
import { setTimeout as pause } from "node:timers/promises"
import { test } from "node:test"

import { createLoadProxy } from "./create-load-proxy.mjs"

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  return server.address().port
}

async function fixture(t, handler, timeout = 100) {
  const backend = http.createServer(handler)
  const workerPort = await listen(backend)
  const abort = new AbortController()
  const errors = []
  const proxy = createLoadProxy({
    workerPorts: [workerPort],
    signal: abort.signal,
    requestTimeoutMs: timeout,
    onError: (...args) => errors.push(args),
  })
  const port = await listen(proxy)
  t.after(async () => {
    abort.abort()
    backend.closeAllConnections()
    await new Promise((resolve) => backend.close(resolve))
  })
  return { url: `http://127.0.0.1:${port}`, errors, abort }
}

test("a mid-body reset fails that response without crashing the proxy", async (t) => {
  const { url, errors } = await fixture(
    t,
    (req, res) => {
      if (req.url === "/healthy") return res.end("healthy")
      res.writeHead(200, { "content-type": "text/plain" })
      res.write("partial body")
      setTimeout(() => res.destroy(), 20)
    },
    1000
  )
  const response = await fetch(url)
  await assert.rejects(response.text())
  assert.equal(await (await fetch(`${url}/healthy`)).text(), "healthy")
  assert.equal(errors.length, 1)
})

for (const headers of [false, true]) {
  test(`a stalled upstream is destroyed ${headers ? "after" : "before"} headers`, async (t) => {
    let closed = false
    const { url, errors } = await fixture(t, (_req, res) => {
      res.once("close", () => {
        closed = true
      })
      if (headers) res.write("partial body")
    })
    const response = await fetch(url)
    if (headers) await assert.rejects(response.text())
    else assert.equal(response.status, 502)
    await pause(20)
    assert(closed)
    assert.equal(errors.length, 1)
  })
}

test("a downstream abort cancels its upstream and leaves the next request usable", async (t) => {
  const closed = Promise.withResolvers()
  const { url } = await fixture(
    t,
    (req, res) => {
      if (req.url === "/healthy") return res.end("healthy")
      res.once("close", closed.resolve)
      res.write("partial body")
    },
    1000
  )
  const abort = new AbortController()
  const response = await fetch(url, { signal: abort.signal })
  abort.abort()
  await assert.rejects(response.text())
  await Promise.race([closed.promise, pause(500).then(() => assert.fail("upstream was not cancelled"))])
  assert.equal(await (await fetch(`${url}/healthy`)).text(), "healthy")
})

test("shutdown cancels active response streams", async (t) => {
  const closed = Promise.withResolvers()
  const { url, abort } = await fixture(
    t,
    (_req, res) => {
      res.once("close", closed.resolve)
      res.write("partial body")
    },
    1000
  )
  const response = await fetch(url)
  abort.abort()
  await assert.rejects(response.text())
  await Promise.race([closed.promise, pause(500).then(() => assert.fail("upstream survived shutdown"))])
})
