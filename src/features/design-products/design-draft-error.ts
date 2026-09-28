export class DesignDraftError extends Error {
  constructor(
    readonly code:
      "INVALID_INPUT" | "FORBIDDEN" | "CONFLICT" | "NOT_FOUND" | "PROVIDER_UNAVAILABLE" | "PROVIDER_REJECTED",
    message: string,
    readonly httpStatus?: number
  ) {
    super(message)
    this.name = "DesignDraftError"
  }
}
