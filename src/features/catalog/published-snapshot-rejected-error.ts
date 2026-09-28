export class PublishedSnapshotRejectedError extends Error {
  constructor() {
    super("Published product unavailable")
    this.name = "PublishedSnapshotRejectedError"
  }
}
