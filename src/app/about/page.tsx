import type { Metadata, ResolvingMetadata } from "next"
import Link from "next/link"

import { storeConfig } from "@/lib/store-config"

export async function generateMetadata(_props: unknown, parent: ResolvingMetadata): Promise<Metadata> {
  const inherited = await parent
  const title = `About | ${storeConfig.name}`
  return {
    title: "About",
    description: storeConfig.description,
    alternates: { canonical: "/about" },
    openGraph: { ...inherited.openGraph, title, description: storeConfig.description, url: "/about" },
    twitter: { ...inherited.twitter, title, description: storeConfig.description },
  }
}

export default function AboutPage() {
  return (
    <main id="main-content" tabIndex={-1} className="page-width prose-page">
      <h1 className="display-heading">About {storeConfig.name}</h1>
      <h2>{storeConfig.about.heading}</h2>
      {storeConfig.about.paragraphs.map((paragraph) => (
        <p key={paragraph}>{paragraph}</p>
      ))}
      {storeConfig.configured && (
        <p>
          Have a question? Reach us at <a href={`mailto:${storeConfig.supportEmail}`}>{storeConfig.supportEmail}</a>.
        </p>
      )}
      <p>
        <Link href="/shop">{storeConfig.home.shopLabel}</Link>
      </p>
    </main>
  )
}
