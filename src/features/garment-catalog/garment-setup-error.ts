/**
 * Why a Printify catalog lookup could not answer.
 *
 * The message is written here, for the owner, and never copied from Printify: a provider body can
 * echo the request, token included. A blueprint Printify simply does not have is not an error (the
 * reader returns null), so every code here means "type the garment's name yourself for now".
 */
export class GarmentSetupError extends Error {
  constructor(
    readonly code: "NOT_CONFIGURED" | "PROVIDER_REJECTED" | "PROVIDER_UNAVAILABLE",
    message: string
  ) {
    super(message)
    this.name = "GarmentSetupError"
  }
}
