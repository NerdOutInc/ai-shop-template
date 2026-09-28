export class DesignAgentError extends Error {
  constructor(
    public readonly code: "FORBIDDEN" | "CONFLICT" | "INVALID_INPUT" | "NOT_FOUND",
    message: string
  ) {
    super(message)
    this.name = "DesignAgentError"
  }
}
