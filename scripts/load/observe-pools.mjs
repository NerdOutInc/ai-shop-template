if (process.env.COMMERCE_E2E !== "true" || !process.send) throw new Error("Pool observation is fixture-only")

setInterval(() => {
  const pools = [...(globalThis.storePostgresPools?.values() ?? [])]
  if (process.connected)
    process.send(
      { type: "pool-observation", waiting: pools.reduce((sum, pool) => sum + pool.waitingCount, 0) },
      () => {}
    )
}, 100).unref()
