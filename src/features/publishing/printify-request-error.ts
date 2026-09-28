export class PrintifyRequestError extends Error {
  constructor(
    readonly delivery: "not-sent" | "rate-limited" | "rejected" | "uncertain",
    readonly retryAfterSeconds?: number
  ) {
    super("PRINTIFY_UNAVAILABLE")
    this.name = "PrintifyRequestError"
  }
}
