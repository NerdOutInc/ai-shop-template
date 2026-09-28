import { renderToStaticMarkup } from "react-dom/server"
import { expect, it } from "vitest"

import { JsonLdScript } from "./json-ld-script"

it("preserves JSON text without letting it close the script element in server HTML", () => {
  const data = {
    "@context": "https://schema.org",
    name: '</script><script>alert("unexpected send")</script>',
    description: "A tee < a whole wardrobe & a good hang",
  }
  const html = renderToStaticMarkup(<JsonLdScript data={data} />)
  const document = new DOMParser().parseFromString(html, "text/html")
  const scripts = document.querySelectorAll("script")

  expect(scripts).toHaveLength(1)
  expect(scripts[0]?.type).toBe("application/ld+json")
  expect(scripts[0]?.textContent).not.toContain("<")
  expect(JSON.parse(scripts[0]!.textContent!)).toEqual(data)
})
