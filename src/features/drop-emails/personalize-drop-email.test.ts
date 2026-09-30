import { describe, expect, it } from "vitest"

import { dropEmailSubscriberPlaceholder } from "./drop-email-subscriber-placeholder"
import { personalizeDropEmail } from "./personalize-drop-email"

describe("personalizeDropEmail", () => {
  it("fills in only this subscriber's own links, and one-click unsubscribe for their mail app", () => {
    const link = `https://store.example/unsubscribe/${dropEmailSubscriberPlaceholder}`
    const message = personalizeDropEmail(
      {
        fromAddress: "Fixture Store <drops@fixture.example>",
        replyTo: "support@fixture.example",
        subject: "New this week: Abstract Lines",
        html: `<a href="${link}">Unsubscribe</a> <a href="${link}">again</a>`,
        textBody: `Unsubscribe ${link}`,
        siteOrigin: "https://store.example",
      },
      { id: "5f0b2c4e-8a51-4d8e-9a57-2c1f7f3b9d10", email: "customer@example.com" }
    )
    expect(message).toEqual({
      from: "Fixture Store <drops@fixture.example>",
      to: ["customer@example.com"],
      reply_to: "support@fixture.example",
      subject: "New this week: Abstract Lines",
      html: '<a href="https://store.example/unsubscribe/5f0b2c4e-8a51-4d8e-9a57-2c1f7f3b9d10">Unsubscribe</a> <a href="https://store.example/unsubscribe/5f0b2c4e-8a51-4d8e-9a57-2c1f7f3b9d10">again</a>',
      text: "Unsubscribe https://store.example/unsubscribe/5f0b2c4e-8a51-4d8e-9a57-2c1f7f3b9d10",
      headers: {
        "List-Unsubscribe": "<https://store.example/api/drop-unsubscribe/5f0b2c4e-8a51-4d8e-9a57-2c1f7f3b9d10>",
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    })
  })
})
