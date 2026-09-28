"use client"

import Link from "next/link"
import { useEffect, useRef, useState, type ReactNode } from "react"

type ProductCardLinkProps = {
  href: string
  labelledBy: string
  hasArtwork: boolean
  children: ReactNode
}

type TouchGesture = {
  pointerId: number
  x: number
  y: number
  startedAt: number
  canceled: boolean
}

const holdDuration = 450
const movementTolerance = 10

function isArtworkMedia(target: EventTarget | null) {
  return target instanceof Element && target.closest(".product-card-media-with-artwork") !== null
}

function movedTooFar(gesture: TouchGesture, event: { clientX: number; clientY: number }) {
  return Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > movementTolerance
}

export function ProductCardLink({ href, labelledBy, hasArtwork, children }: ProductCardLinkProps) {
  const linkRef = useRef<HTMLAnchorElement>(null)
  const gestureRef = useRef<TouchGesture | null>(null)
  const suppressClickRef = useRef(false)
  const pointerTypeRef = useRef("")
  const [touchPreview, setTouchPreview] = useState(false)

  useEffect(() => {
    if (!touchPreview) return
    let outsideGesture: TouchGesture | null = null
    let lastPointerWasTouch = true

    function dismissOnOutsideClick(event: MouseEvent) {
      // Touch dismissal is decided on pointerup; a scroll's compatibility click must not override it.
      if (lastPointerWasTouch && event.detail !== 0) return
      if (event.target instanceof Node && !linkRef.current?.contains(event.target)) {
        setTouchPreview(false)
      }
    }

    function handleOtherTouch(event: PointerEvent) {
      lastPointerWasTouch = event.pointerType === "touch"
      if (event.pointerType !== "touch") return
      if (!event.isPrimary) {
        if (gestureRef.current) gestureRef.current.canceled = true
        if (outsideGesture) outsideGesture.canceled = true
        return
      }
      outsideGesture = null
      if (!(event.target instanceof Node) || linkRef.current?.contains(event.target)) return
      if (isArtworkMedia(event.target)) {
        setTouchPreview(false)
      } else {
        outsideGesture = {
          pointerId: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          startedAt: Date.now(),
          canceled: false,
        }
      }
    }

    function handleOutsideMove(event: PointerEvent) {
      if (outsideGesture?.pointerId === event.pointerId && movedTooFar(outsideGesture, event)) {
        outsideGesture.canceled = true
      }
    }

    function handleOutsideEnd(event: PointerEvent) {
      if (outsideGesture?.pointerId !== event.pointerId) return
      if (
        event.type === "pointerup" &&
        !outsideGesture.canceled &&
        !movedTooFar(outsideGesture, event) &&
        Date.now() - outsideGesture.startedAt < holdDuration
      ) {
        setTouchPreview(false)
      }
      outsideGesture = null
    }

    function cancelNavigation() {
      if (gestureRef.current) gestureRef.current.canceled = true
      if (outsideGesture) outsideGesture.canceled = true
    }

    // Safari may omit click on plain page space. Recognize outside taps without consuming scrolling.
    document.addEventListener("click", dismissOnOutsideClick, true)
    document.addEventListener("pointerdown", handleOtherTouch, true)
    document.addEventListener("pointermove", handleOutsideMove, true)
    document.addEventListener("pointerup", handleOutsideEnd, true)
    document.addEventListener("pointercancel", handleOutsideEnd, true)
    document.addEventListener("scroll", cancelNavigation, true)
    window.addEventListener("blur", cancelNavigation)
    return () => {
      document.removeEventListener("click", dismissOnOutsideClick, true)
      document.removeEventListener("pointerdown", handleOtherTouch, true)
      document.removeEventListener("pointermove", handleOutsideMove, true)
      document.removeEventListener("pointerup", handleOutsideEnd, true)
      document.removeEventListener("pointercancel", handleOutsideEnd, true)
      document.removeEventListener("scroll", cancelNavigation, true)
      window.removeEventListener("blur", cancelNavigation)
    }
  }, [touchPreview])

  return (
    <Link
      ref={linkRef}
      href={href}
      aria-labelledby={labelledBy}
      data-touch-preview={hasArtwork && touchPreview ? "true" : undefined}
      className={`product-card-link block rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring ${hasArtwork ? "product-card-link-with-artwork" : ""}`}
      onPointerDown={(event) => {
        if (!event.isPrimary) {
          if (gestureRef.current) gestureRef.current.canceled = true
          return
        }
        pointerTypeRef.current = event.pointerType
        suppressClickRef.current = false
        gestureRef.current = null
        if (!hasArtwork || event.pointerType !== "touch" || !isArtworkMedia(event.target)) return

        gestureRef.current = {
          pointerId: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          startedAt: Date.now(),
          canceled: false,
        }
        suppressClickRef.current = true
        setTouchPreview(true)
      }}
      onPointerMove={(event) => {
        const gesture = gestureRef.current
        if (gesture?.pointerId === event.pointerId && movedTooFar(gesture, event)) gesture.canceled = true
      }}
      onPointerUp={(event) => {
        const gesture = gestureRef.current
        if (gesture?.pointerId !== event.pointerId) return
        suppressClickRef.current =
          gesture.canceled || movedTooFar(gesture, event) || Date.now() - gesture.startedAt >= holdDuration
        gestureRef.current = null
      }}
      onPointerCancel={(event) => {
        if (gestureRef.current?.pointerId !== event.pointerId) return
        suppressClickRef.current = true
        gestureRef.current = null
      }}
      onClickCapture={(event) => {
        // A canceled pointer stream can still produce a click. Keyboard/AT activation stays native.
        if (suppressClickRef.current && event.detail !== 0) {
          event.preventDefault()
          event.stopPropagation()
        }
      }}
      onContextMenu={(event) => {
        if (hasArtwork && pointerTypeRef.current === "touch" && isArtworkMedia(event.target)) {
          event.preventDefault()
          suppressClickRef.current = true
          if (gestureRef.current) gestureRef.current.canceled = true
        }
      }}
      onDragStart={(event) => {
        if (hasArtwork && pointerTypeRef.current === "touch") event.preventDefault()
      }}
    >
      {children}
    </Link>
  )
}
