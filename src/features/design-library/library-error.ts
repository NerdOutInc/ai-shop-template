export class LibraryError extends Error {
  constructor(
    readonly code: "FORBIDDEN" | "INVALID_INPUT" | "CONFLICT" | "NOT_FOUND",
    message: string
  ) {
    super(message)
    this.name = "LibraryError"
  }
}
