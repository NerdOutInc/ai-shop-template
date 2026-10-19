import http from "node:http"

export function createLoadProxy({ workerPorts, signal, requestTimeoutMs = 15_000, onError = console.error }) {
  signal.throwIfAborted()
  // A nonzero timeout lets Node honor Next's shorter keep-alive hint for idle sockets.
  const agent = new http.Agent({ keepAlive: true, maxSockets: 512, timeout: requestTimeoutMs })
  const pending = new Set()
  let nextWorker = 0
  const server = http.createServer((req, res) => {
    let reply
    let finished = false
    const upstream = http.request({
      hostname: "127.0.0.1",
      port: workerPorts[nextWorker++ % workerPorts.length],
      path: req.url,
      method: req.method,
      headers: req.headers,
      agent,
    })
    const deadline = setTimeout(() => fail(new Error("Upstream request timed out")), requestTimeoutMs)
    function finish() {
      finished = true
      clearTimeout(deadline)
      pending.delete(cancel)
    }
    function cancel() {
      finish()
      upstream.destroy()
      reply?.destroy()
      res.destroy()
    }
    function fail(error) {
      if (finished) return
      finish()
      onError("Local proxy failed", {
        code: error.code ?? error.message,
        reusedSocket: upstream.reusedSocket,
        method: req.method,
        path: req.url,
      })
      upstream.destroy()
      reply?.destroy()
      if (res.headersSent || res.destroyed) res.destroy()
      else {
        res.writeHead(502)
        res.end("Local proxy failed")
      }
    }
    pending.add(cancel)
    upstream.on("error", fail)
    upstream.setTimeout(requestTimeoutMs, () => fail(new Error("Upstream socket timed out")))
    upstream.once("response", (response) => {
      reply = response
      reply.on("error", fail)
      if (finished || res.destroyed) return reply.destroy()
      res.writeHead(reply.statusCode, reply.headers)
      reply.pipe(res)
    })
    req.once("aborted", cancel)
    req.once("error", cancel)
    res.once("error", cancel)
    res.once("finish", finish)
    res.once("close", () => {
      if (!res.writableFinished) cancel()
    })
    req.pipe(upstream)
  })
  function dispose() {
    for (const cancel of pending) cancel()
    agent.destroy()
    server.closeAllConnections()
    if (server.listening) server.close()
  }
  signal.addEventListener("abort", dispose, { once: true })
  server.once("close", () => {
    dispose()
    signal.removeEventListener("abort", dispose)
  })
  return server
}
