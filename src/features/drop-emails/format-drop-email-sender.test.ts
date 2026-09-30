import { describe, expect, it } from "vitest"

import { formatDropEmailSender } from "./format-drop-email-sender"

describe("formatDropEmailSender", () => {
  it("puts the store's name on its sending address", () => {
    expect(formatDropEmailSender("Fixture Store", "drops@fixture.example")).toBe(
      "Fixture Store <drops@fixture.example>"
    )
  })

  // Unquoted, the comma would read as the start of a second sender.
  it.each([
    ["Smith, Jones & Co.", '"Smith, Jones & Co." <drops@fixture.example>'],
    ['The "Good" Shirt', '"The \\"Good\\" Shirt" <drops@fixture.example>'],
    ["Back\\slash: Tees", '"Back\\\\slash: Tees" <drops@fixture.example>'],
  ])("quotes %s", (name, sender) => {
    expect(formatDropEmailSender(name, "drops@fixture.example")).toBe(sender)
  })

  it("never lets a control character into the header", () => {
    expect(formatDropEmailSender("Fixture\r\nBcc: someone@example.com", "drops@fixture.example")).toBe(
      '"Fixture  Bcc: someone@example.com" <drops@fixture.example>'
    )
  })
})
