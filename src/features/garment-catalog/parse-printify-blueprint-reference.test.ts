import { afterEach, describe, expect, it, vi } from "vitest"

import { parsePrintifyBlueprintReference } from "./parse-printify-blueprint-reference"

const catalogPage = "https://printify.com/app/products/1317/next-level/unisex-cvc-jersey-t-shirt"

afterEach(() => vi.unstubAllGlobals())

describe("parsePrintifyBlueprintReference", () => {
  it.each([
    ["the documented catalog page", catalogPage, 1317],
    ["the crop top's catalog page", "https://printify.com/app/products/1312/next-level/womens-festival-crop-top", 1312],
    ["a bare number", "1317", 1317],
    ["a bare number with whitespace around it", "  1317\n", 1317],
    ["a single-digit number", "6", 6],
    ["the largest number the column holds", "999999999", 999_999_999],
    ["the www host", "https://www.printify.com/app/products/1317/next-level/unisex-cvc-jersey-t-shirt", 1317],
    ["a link with no slug", "https://printify.com/app/products/1317", 1317],
    ["a trailing slash", "https://printify.com/app/products/1317/", 1317],
    ["a query string", `${catalogPage}?utm_source=newsletter&page=2`, 1317],
    ["a hash", `${catalogPage}#print-providers`, 1317],
    ["a query string and a hash with no slug", "https://printify.com/app/products/1317?tab=1#top", 1317],
    ["a link copied without its scheme", "printify.com/app/products/1317/next-level/unisex-cvc-jersey-t-shirt", 1317],
    ["a www link copied without its scheme", "www.printify.com/app/products/1312?ref=catalog#sizes", 1312],
    ["a scheme-less link with whitespace around it", "  printify.com/app/products/1317  ", 1317],
    ["a host typed in capitals", "HTTPS://Printify.com/app/products/1317", 1317],
  ])("reads %s", (_label, input, blueprintId) => {
    expect(parsePrintifyBlueprintReference(input)).toEqual({ ok: true, blueprintId })
  })

  it.each([
    ["an empty string", ""],
    ["whitespace", "  \n\t "],
    ["null", null],
    ["undefined", undefined],
    ["a number rather than text", 1317],
    ["an object", { blueprintId: 1317 }],
    ["an array", ["1317"]],
  ])("reports %s as empty", (_label, input) => {
    expect(parsePrintifyBlueprintReference(input)).toEqual({ ok: false, reason: "empty" })
  })

  // Product ids are 24 hex characters that often START with digits. A prefix parse would call the
  // first link blueprint 6 and the second one blueprint 1317, and save a garment nobody chose.
  it.each([
    [
      "a product link whose id starts with a digit",
      "https://printify.com/app/product-details/111111000000000000000005",
    ],
    [
      "a product link whose id starts with a real number",
      "https://printify.com/app/product-details/1317b3c29b727c73170ccdf6",
    ],
    ["a product link made only of digits", "https://printify.com/app/product-details/1317"],
    [
      "a product link with a query string",
      "https://www.printify.com/app/product-details/111111000000000000000003?fromProductsPage=1",
    ],
    ["a scheme-less product link", "printify.com/app/product-details/111111000000000000000003"],
    ["the product-details page with no id", "https://printify.com/app/product-details"],
    ["a store product link", "https://printify.com/app/store/products/1"],
    ["a store product link with a numeric-looking id", "https://printify.com/app/store/products/1317/edit"],
  ])("tells the owner %s is a product, not a garment", (_label, input) => {
    expect(parsePrintifyBlueprintReference(input)).toEqual({ ok: false, reason: "product-link" })
  })

  it.each([
    ["a lookalike host", "https://printify.com.attacker.test/app/products/1317"],
    ["a scheme-less lookalike host", "printify.com.attacker.test/app/products/1317"],
    ["a host that only ends like Printify", "https://notprintify.com/app/products/1317"],
    ["a dashed lookalike", "https://printify-com.attacker.test/app/products/1317"],
    ["Printify's API host", "https://api.printify.com/v1/catalog/blueprints/1317.json"],
    ["Printify's developer docs", "https://developers.printify.com/app/products/1317"],
    ["another site carrying the path", "https://attacker.test/app/products/1317"],
    ["another site carrying Printify's name in its path", "https://attacker.test/printify.com/app/products/1317"],
    ["another site carrying the link in its query", `https://attacker.test/?next=${catalogPage}`],
    ["a username", "https://owner@printify.com/app/products/1317"],
    ["a username and password", "https://owner:secret@printify.com/app/products/1317"],
    ["Printify as the username of another host", "https://printify.com@attacker.test/app/products/1317"],
    ["a port", "https://printify.com:8443/app/products/1317"],
    ["https's own port, which the URL parser would hide", "https://printify.com:443/app/products/1317"],
    ["a scheme-less link with a port", "printify.com:8443/app/products/1317"],
    ["plain http", "http://printify.com/app/products/1317"],
    ["a protocol-relative link", "//printify.com/app/products/1317"],
    ["a scheme with its slashes missing", "https:printify.com/app/products/1317"],
    ["a javascript address", "javascript:alert(1317)"],
    ["an ftp address", "ftp://printify.com/app/products/1317"],
    ["a data address", "data:text/plain,1317"],
    ["a path with no host", "/app/products/1317"],
    ["a line break inside the link", "https://printify.com/app/\nproducts/1317"],
    ["a tab inside the host", "https://printi\tfy.com/app/products/1317"],
    ["two links on two lines", `${catalogPage}\n${catalogPage}`],
    ["a domain that is not Printify", "example.com"],
    ["a link that cannot be parsed", "https://[printify.com]/app/products/1317"],
    ["a paste too long to be a link", `${catalogPage}?${"a".repeat(2048)}`],
  ])("refuses %s as not a Printify link", (_label, input) => {
    expect(parsePrintifyBlueprintReference(input)).toEqual({ ok: false, reason: "not-printify" })
  })

  it.each([
    ["Printify's home page", "https://printify.com/"],
    ["the bare host", "printify.com"],
    ["the catalog's index", "https://printify.com/app/products"],
    ["the catalog's index with a trailing slash", "https://printify.com/app/products/"],
    ["an empty number segment", "https://printify.com/app/products//1317"],
    ["the product creator", "https://printify.com/app/editor/1317/99"],
    ["the orders page", "https://printify.com/app/orders/1317"],
    ["a marketing page", "https://printify.com/custom-t-shirts/?id=1317"],
    ["a catalog path in the wrong case", "https://printify.com/App/Products/1317"],
    ["a catalog path nested under another", "https://printify.com/blog/app/products/1317"],
    ["a number that lives only in the query", "https://printify.com/app?products=1317"],
    ["a number that lives only in the hash", "https://printify.com/#/app/products/1317"],
    // A browser reads the backslash as a slash, so this really is printify.com, at a path that is
    // not the catalog. Refused either way; the point is that it is never mistaken for attacker.test.
    ["a backslash dressed up as a username", "https://printify.com\\@attacker.test/app/products/1317"],
  ])("refuses %s as not a catalog page", (_label, input) => {
    expect(parsePrintifyBlueprintReference(input)).toEqual({ ok: false, reason: "not-a-catalog-page" })
  })

  it.each([
    ["leading zeros", "01317"],
    ["zero", "0"],
    ["a minus sign", "-5"],
    ["a plus sign", "+1317"],
    ["a decimal", "1317.0"],
    ["an exponent", "1e3"],
    ["hex", "0x525"],
    ["ten digits", "1234567890"],
    ["a thousands separator", "1,317"],
    ["a space inside the number", "13 17"],
    ["two numbers on two lines", "1317\n1312"],
    ["a product id pasted on its own", "111111000000000000000005"],
    ["a word", "hoodie"],
    ["full-width digits", "１３１７"],
  ])("refuses a bare number with %s", (_label, input) => {
    expect(parsePrintifyBlueprintReference(input)).toEqual({ ok: false, reason: "invalid-id" })
  })

  it.each([
    ["leading zeros", "01317"],
    ["zero", "0"],
    ["a minus sign", "-5"],
    ["a plus sign", "+1317"],
    ["a decimal", "1317.0"],
    ["an exponent", "1e3"],
    ["hex", "0x525"],
    ["ten digits", "1234567890"],
    ["trailing letters", "1317abc"],
    ["a product id where the number belongs", "111111000000000000000005"],
    ["a percent-encoded digit", "%31317"],
    ["a percent-encoded slash", "1317%2Fnext-level"],
  ])("refuses a catalog link whose number has %s", (_label, segment) => {
    const expected = { ok: false, reason: "invalid-id" }
    expect(parsePrintifyBlueprintReference(`https://printify.com/app/products/${segment}`)).toEqual(expected)
    expect(parsePrintifyBlueprintReference(`printify.com/app/products/${segment}/next-level?x=1#y`)).toEqual(expected)
  })

  // The pasted address is only ever read for its number. Following it would hand an attacker's
  // link a server-side request, or the owner's browser a cross-origin one.
  it("never fetches what was pasted", () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    parsePrintifyBlueprintReference(catalogPage)
    parsePrintifyBlueprintReference("https://printify.com.attacker.test/app/products/1317")
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
