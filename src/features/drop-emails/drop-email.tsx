import type { CSSProperties } from "react"
import { Body, Button, Container, Head, Heading, Html, Img, Link, Preview, Section, Text } from "react-email"

import { storeConfig } from "@/lib/store-config"

import type { DropEmailProduct } from "./drop-email-product"

export type DropEmailProps = {
  products: DropEmailProduct[]
  designNames: string[]
  siteUrl: string
  unsubscribeUrl: string
  postalAddress: string
  /** The store's own order attribution label for these links, like dotw-2026-10-05. */
  campaign: string
}

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })
const names = new Intl.ListFormat("en-US", { style: "long", type: "conjunction" })

/**
 * The weekly drop email. The consent a subscriber gave covers new design drops, so this announces the
 * drop and links to the shop, and that is all it may ever do.
 *
 * Inline styles throughout, because mail clients strip stylesheets. They never load the site's web
 * fonts either, so each configured stack ends with the same fallbacks the site's CSS uses.
 */
export function DropEmail({ products, designNames, siteUrl, unsubscribeUrl, postalAddress, campaign }: DropEmailProps) {
  const link = (path: string, attribution = true) => {
    const url = new URL(path, siteUrl)
    if (attribution) {
      url.searchParams.set("utm_source", "drop-email")
      url.searchParams.set("utm_medium", "email")
      url.searchParams.set("utm_campaign", campaign)
    }
    return url.toString()
  }
  const announced = names.format(designNames)

  return (
    <Html lang="en">
      <Head />
      <Preview>{`${announced} just dropped. Come take a look.`}</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Section style={styles.header}>
            <Text style={styles.wordmark}>{storeConfig.name}</Text>
          </Section>
          <Section style={styles.intro}>
            <Text style={styles.eyebrow}>Design of the week</Text>
            <Heading as="h1" style={styles.heading}>
              This week&rsquo;s picks.
            </Heading>
            <Text style={styles.lead}>
              You asked to hear when a new design drops, so consider yourself told: {announced}{" "}
              {designNames.length === 1 ? "is" : "are"} in the shop now.
            </Text>
          </Section>
          {products.map((product) => {
            const href = link(`/shop/${encodeURIComponent(product.id)}`)
            return (
              <Section key={product.id} style={styles.product}>
                {product.image ? (
                  // The heading carries this link in the plain-text version; one copy there is enough.
                  <Link href={href} data-skip-in-text="true">
                    <Img
                      src={product.image.src}
                      alt={product.image.alt}
                      width="536"
                      height="536"
                      style={styles.productImage}
                    />
                  </Link>
                ) : null}
                <Heading as="h2" style={styles.productName}>
                  <Link href={href} style={styles.productNameLink}>
                    {product.title}
                  </Link>
                </Heading>
                {product.price ? (
                  <Text style={styles.price}>
                    {`${product.price.min !== product.price.max ? "From " : ""}${usd.format(product.price.min / 100)}`}
                  </Text>
                ) : null}
                <Button href={href} style={styles.button} data-skip-in-text="true">
                  See it in the shop
                </Button>
              </Section>
            )
          })}
          <Section style={styles.outro}>
            <Text style={styles.outroText}>
              Not quite your style? No hard feelings. The rest of the collection is waiting in the{" "}
              <Link href={link("/shop")} style={styles.inlineLink}>
                shop
              </Link>
              .
            </Text>
          </Section>
          <Section style={styles.footer}>
            <Text style={styles.footerText}>
              You&rsquo;re getting this because you signed up to hear about new {storeConfig.name} designs. That&rsquo;s
              all this list ever sends.
            </Text>
            <Text style={styles.footerText}>
              <Link href={unsubscribeUrl} style={styles.footerLink}>
                Unsubscribe
              </Link>
              {" · "}
              <Link href={link("/privacy", false)} style={styles.footerLink}>
                Privacy
              </Link>
            </Text>
            <Text style={styles.footerText}>
              {storeConfig.name} · {postalAddress}
            </Text>
            <Text style={styles.footerText}>{storeConfig.tagline}</Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

const { theme, fonts } = storeConfig
const body = `${fonts.body}, "Trebuchet MS", sans-serif`
const heading = `${fonts.heading}, Georgia, serif`
const label = `${fonts.label}, "Arial Narrow", sans-serif`

// Every text color sits on a background the store configuration already checks for 4.5:1 contrast.
const styles = {
  body: { backgroundColor: theme.secondary, color: theme.foreground, fontFamily: body, margin: 0, padding: "24px 0" },
  container: { backgroundColor: theme.background, borderRadius: "4px", maxWidth: "600px", margin: "0 auto" },
  header: { backgroundColor: theme.primary, borderRadius: "4px 4px 0 0", padding: "16px 32px" },
  wordmark: {
    color: theme.primaryForeground,
    fontFamily: label,
    fontSize: "18px",
    fontWeight: 700,
    letterSpacing: "0.12em",
    lineHeight: "24px",
    margin: 0,
    textTransform: "uppercase",
  },
  intro: { padding: "32px 32px 8px" },
  eyebrow: {
    color: theme.mutedForeground,
    fontFamily: label,
    fontSize: "13px",
    fontWeight: 700,
    letterSpacing: "0.14em",
    lineHeight: "20px",
    margin: "0 0 8px",
    textTransform: "uppercase",
  },
  heading: {
    color: theme.foreground,
    fontFamily: heading,
    fontSize: "34px",
    fontWeight: 700,
    letterSpacing: "-0.02em",
    lineHeight: "40px",
    margin: "0 0 12px",
  },
  lead: { color: theme.foreground, fontSize: "17px", lineHeight: "27px", margin: 0 },
  product: { padding: "24px 32px 8px" },
  productImage: {
    backgroundColor: theme.secondary,
    borderRadius: "4px",
    display: "block",
    height: "auto",
    maxWidth: "100%",
  },
  productName: { fontFamily: label, fontSize: "22px", fontWeight: 700, lineHeight: "28px", margin: "16px 0 4px" },
  productNameLink: { color: theme.foreground, textDecoration: "none" },
  price: { color: theme.mutedForeground, fontSize: "16px", lineHeight: "24px", margin: "0 0 16px" },
  button: {
    backgroundColor: theme.primary,
    borderRadius: "3px",
    color: theme.primaryForeground,
    fontFamily: label,
    fontSize: "18px",
    fontWeight: 700,
    lineHeight: "22px",
    padding: "13px 28px",
    textDecoration: "none",
  },
  outro: { padding: "16px 32px 24px" },
  outroText: { color: theme.foreground, fontSize: "16px", lineHeight: "26px", margin: 0 },
  inlineLink: { color: theme.foreground, textDecoration: "underline" },
  footer: { backgroundColor: theme.secondary, borderRadius: "0 0 4px 4px", padding: "20px 32px" },
  footerText: { color: theme.mutedForeground, fontSize: "13px", lineHeight: "20px", margin: "0 0 8px" },
  footerLink: { color: theme.mutedForeground, textDecoration: "underline" },
} satisfies Record<string, CSSProperties>
