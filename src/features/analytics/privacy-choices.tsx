"use client"

import Link from "next/link"
import { useEffect, useId, useRef, useState } from "react"
import { createPortal } from "react-dom"

import { metaPixel } from "./meta-pixel"
import { useMetaPixel } from "./use-meta-pixel"
import { googleTag } from "./google-tag"
import { useGoogleTag } from "./use-google-tag"

export function PrivacyChoices() {
  const { consent, configured, gpc } = useMetaPixel()
  const google = useGoogleTag()
  const [opened, setOpened] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const id = useId()
  const unanswered = (configured && consent === "unknown") || (google.configured && google.consent === "unknown")
  const visible = (configured || google.configured) && (opened || unanswered)

  useEffect(() => {
    if (opened) heading.current?.focus()
  }, [opened])

  function choose(value: "granted" | "denied") {
    metaPixel.setConsent(value)
    setOpened(false)
    if (opened) trigger.current?.focus()
  }

  if (!configured && !google.configured) return null
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="inline-flex min-h-11 items-center"
        aria-expanded={visible}
        aria-controls={id}
        onClick={() => setOpened(true)}
      >
        Privacy choices
      </button>
      {visible && typeof document !== "undefined"
        ? createPortal(
            <section
              id={id}
              aria-labelledby={`${id}-heading`}
              className="fixed inset-x-3 bottom-3 z-50 mx-auto max-h-[calc(100dvh-1.5rem)] max-w-3xl overflow-auto rounded-2xl border border-foreground/25 bg-background p-5 text-left text-foreground shadow-lg sm:inset-x-6 sm:bottom-6 sm:p-6"
            >
              <div className="flex items-start justify-between gap-5">
                <h2 ref={heading} id={`${id}-heading`} tabIndex={-1} className="font-display text-2xl">
                  Your privacy choices
                </h2>
                {opened && !unanswered ? (
                  <button
                    type="button"
                    className="inline-flex min-h-11 items-center text-sm underline underline-offset-4"
                    onClick={() => {
                      setOpened(false)
                      trigger.current?.focus()
                    }}
                  >
                    Close
                  </button>
                ) : null}
              </div>
              {configured ? (
                <div role="group" aria-label="Meta marketing cookies">
                  <p className="mt-3 max-w-prose text-sm leading-6">
                    With your permission, we use Meta cookies to measure sales from Facebook and Instagram and show
                    relevant ads. You can shop without allowing them and change your choice at any time.
                  </p>
                  <p className="mt-2 text-sm leading-6">
                    {gpc
                      ? "Your browser’s Global Privacy Control is on, so Meta marketing cookies are off."
                      : consent === "granted"
                        ? "Meta marketing cookies are currently allowed."
                        : consent === "denied"
                          ? "Meta marketing cookies are currently off."
                          : "Meta marketing cookies stay off until you allow them."}{" "}
                    We remember your choice for 180 days. Read our{" "}
                    <Link href="/privacy" className="underline underline-offset-4">
                      privacy policy
                    </Link>
                    .
                  </p>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <button type="button" className="button w-full" disabled={gpc} onClick={() => choose("granted")}>
                      Allow Meta marketing cookies
                    </button>
                    <button type="button" className="button w-full" onClick={() => choose("denied")}>
                      Decline Meta
                    </button>
                  </div>
                </div>
              ) : null}
              {google.configured ? (
                <div
                  role="group"
                  aria-label="Google marketing cookies"
                  className={configured ? "mt-5 border-t border-foreground/20 pt-5" : ""}
                >
                  <p className="mt-3 max-w-prose text-sm leading-6">
                    With your permission, we allow Google advertising and analytics cookies and share browsing and
                    purchase data for ads and product-listing measurement in Merchant Center. Google receives browser
                    information, product identifiers, purchase amounts, and a purchase identifier. Personalized
                    advertising stays off. You can shop without allowing these cookies. This choice is separate from
                    Meta.
                  </p>
                  <p className="mt-2 text-sm leading-6">
                    {google.gpc
                      ? "Your browser’s Global Privacy Control is on, so Google marketing cookies are off."
                      : google.consent === "granted"
                        ? "Google marketing cookies are currently allowed."
                        : google.consent === "denied"
                          ? "Google marketing cookies are currently off."
                          : "Google marketing cookies stay off until you allow them."}{" "}
                    We remember your choice for 180 days. Read our{" "}
                    <Link href="/privacy" className="underline underline-offset-4">
                      privacy policy
                    </Link>
                    .
                  </p>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <button
                      type="button"
                      className="button w-full"
                      disabled={google.gpc}
                      onClick={() => {
                        googleTag.setConsent("granted")
                        setOpened(false)
                        if (opened) trigger.current?.focus()
                      }}
                    >
                      Allow Google marketing cookies
                    </button>
                    <button
                      type="button"
                      className="button w-full"
                      onClick={() => {
                        googleTag.setConsent("denied")
                        setOpened(false)
                        if (opened) trigger.current?.focus()
                      }}
                    >
                      Decline Google
                    </button>
                  </div>
                </div>
              ) : null}
            </section>,
            document.body
          )
        : null}
    </>
  )
}
