"use client"

import { ArrowDown, ArrowUp, Pencil, Trash2 } from "lucide-react"
import { useRouter } from "next/navigation"
import { useEffect, useRef, useState, type FormEvent } from "react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

import type { ShopCategory } from "./garment-catalog"
import { slugifyCategoryName } from "./slugify-category-name"

type Direction = "up" | "down"
type Failure = { status: number; message: string | null }

const unconfirmed = "That change could not be confirmed. Refresh before trying again."

function garmentsInUse(count: number) {
  return count === 1 ? "its garment" : `its ${count} garments`
}

async function send(url: string, method: "POST" | "PUT" | "DELETE", body?: unknown) {
  const response = await fetch(url, {
    method,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const answer = (await response.json().catch(() => null)) as Record<string, unknown> | null
  return { ok: response.ok, status: response.status, answer }
}

function failureOf({ status, answer }: { status: number; answer: Record<string, unknown> | null }): Failure {
  return { status, message: typeof answer?.error === "string" ? answer.error : null }
}

/**
 * The shop's categories: their names, their order, and which ones can go.
 *
 * A category's slug is its identity and is fixed when it is created, because it becomes URL state;
 * renaming changes the name and nothing else, and the create form says so before the owner commits
 * to one. Deleting is offered only when no garment uses the category. The database refuses it
 * anyway, but a button that can only ever fail is a worse way to say "move the garments first".
 *
 * Like the lineup, the list is this component's own state and each change saves as it is made, so
 * the page never re-renders under the owner mid-edit. The server's refusals are shown as written:
 * they name what is in the way.
 *
 * A name field is held while its own request is in flight. Success puts the rename field away and
 * empties the new-name field, so typing taken in that window would be thrown out without a word.
 */
export function CategoryManager({ categories: initialCategories }: { categories: ShopCategory[] }) {
  const router = useRouter()
  const [categories, setCategories] = useState(initialCategories)
  const [status, setStatus] = useState("")
  const [moveMessage, setMoveMessage] = useState("")
  const [error, setError] = useState<{ message: string; reload: boolean } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ slug: string; name: string; problem: string | null } | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [newName, setNewName] = useState("")
  const [newNameProblem, setNewNameProblem] = useState<string | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const focusAfter = useRef<string | null>(null)
  // Order reverts on its own, so a failed reorder cannot undo a rename that did save.
  const confirmedOrder = useRef(initialCategories.map((category) => category.slug))
  const queuedOrder = useRef<string[] | null>(null)
  const savingOrder = useRef(false)

  // Every action here replaces, moves or disables the control that was just pressed, and a control
  // that goes away drops focus to the top of the page. Each handler names where focus belongs next;
  // this waits until that control exists and can take it. No dependency list on purpose: the target
  // may only become focusable a render or two later, once a request settles.
  useEffect(() => {
    const key = focusAfter.current
    if (!key) return
    const find = (name: string) => root.current?.querySelector<HTMLElement>(`[data-focus-key="${name}"]`)
    let target = find(key)
    // Moving a row re-inserts it, and at either end the pressed arrow is disabled: use the other.
    if (target instanceof HTMLButtonElement && target.disabled && key.startsWith("move-"))
      target = find(
        key.startsWith("move-up:") ? key.replace("move-up:", "move-down:") : key.replace("move-down:", "move-up:")
      )
    if (!target || (target instanceof HTMLButtonElement && target.disabled)) return
    focusAfter.current = null
    target.focus()
  })

  // A request takes a moment and the rest of the page stays live, so by the time it settles the
  // owner may be on another control. Focus is handed on only while it is still where the request
  // began (`from`) or has been dropped; taking it from anywhere else would undo a deliberate move.
  function handFocusTo(key: string, from: Element | null) {
    const active = document.activeElement
    if (active && active !== document.body && active !== from) return
    focusAfter.current = key
  }

  function fail({ status: code, message }: Failure, fallback: string, reload: boolean) {
    setStatus("")
    setError({ message: code === 0 ? unconfirmed : (message ?? fallback), reload })
  }

  function takeQueuedOrder() {
    const next = queuedOrder.current
    queuedOrder.current = null
    return next
  }

  async function saveOrder(slugs: string[]) {
    queuedOrder.current = slugs
    // A request is already running; it picks up the newest order when it finishes.
    if (savingOrder.current) return
    savingOrder.current = true
    setStatus("Saving…")
    setError(null)
    let failure: Failure | null = null
    try {
      for (let next = takeQueuedOrder(); next; next = takeQueuedOrder()) {
        const result = await send("/api/admin/products/categories", "PUT", { categorySlugs: next })
        if (!result.ok) {
          failure = failureOf(result)
          break
        }
        confirmedOrder.current = next
      }
    } catch {
      failure = { status: 0, message: null }
    }
    savingOrder.current = false
    if (!failure) {
      setStatus("Order saved.")
      return
    }
    queuedOrder.current = null
    // Putting the rows back can leave the arrow the owner is still on disabled at an end.
    const held = document.activeElement?.getAttribute("data-focus-key")
    if (held?.startsWith("move-")) focusAfter.current = held
    // Back to the last order the server accepted, keeping any rename that saved in the meantime.
    setCategories((current) => [
      ...confirmedOrder.current.flatMap((slug) => current.filter((category) => category.slug === slug)),
      ...current.filter((category) => !confirmedOrder.current.includes(category.slug)),
    ])
    setMoveMessage("The last saved order is back in place.")
    // 409 is the route's staleness check: the set of categories changed somewhere else.
    fail(
      failure,
      "That move didn't save, so the last saved order is back in place. Try it again.",
      failure.status === 409
    )
  }

  function move(index: number, direction: Direction) {
    const to = direction === "up" ? index - 1 : index + 1
    const category = categories[index]
    if (!category || to < 0 || to >= categories.length) return
    const next = [...categories]
    next.splice(index, 1)
    next.splice(to, 0, category)
    focusAfter.current = `move-${direction}:${category.slug}`
    setMoveMessage(`${category.name} moved to position ${to + 1} of ${categories.length}.`)
    setCategories(next)
    void saveOrder(next.map((entry) => entry.slug))
  }

  async function rename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editing || busy) return
    const { slug } = editing
    const name = editing.name.trim()
    const category = categories.find((entry) => entry.slug === slug)
    if (!name) {
      setEditing({ ...editing, problem: "Give the category a name." })
      focusAfter.current = `name:${slug}`
      return
    }
    if (!category || name === category.name) {
      setEditing(null)
      focusAfter.current = `rename:${slug}`
      return
    }
    const from = document.activeElement
    setBusy(`rename:${slug}`)
    setError(null)
    setStatus("")
    try {
      // The body carries the name alone. The slug is the address, and the route refuses one in a body.
      const result = await send(`/api/admin/products/categories/${encodeURIComponent(slug)}`, "PUT", { name })
      if (!result.ok) {
        fail(failureOf(result), "That name didn't save. Try again in a moment.", result.status === 404)
        handFocusTo(`name:${slug}`, from)
        return
      }
      const saved = typeof result.answer?.name === "string" ? result.answer.name : name
      setCategories((current) => current.map((entry) => (entry.slug === slug ? { ...entry, name: saved } : entry)))
      setEditing(null)
      setStatus(`${category.name} is now called ${saved}.`)
      handFocusTo(`rename:${slug}`, from)
    } catch {
      fail({ status: 0, message: null }, unconfirmed, false)
      handFocusTo(`name:${slug}`, from)
    } finally {
      setBusy(null)
    }
  }

  async function remove(category: ShopCategory) {
    if (busy) return
    const from = document.activeElement
    setBusy(`delete:${category.slug}`)
    setError(null)
    setStatus("")
    try {
      const result = await send(`/api/admin/products/categories/${encodeURIComponent(category.slug)}`, "DELETE")
      setConfirming(null)
      if (!result.ok) {
        // 409 means a garment took this category after the page loaded; 404 means it is already gone.
        // The server's list settles both. It settles nothing else, so nothing else offers a reload.
        fail(
          failureOf(result),
          "That category wasn't deleted. Try again in a moment.",
          result.status === 404 || result.status === 409
        )
        const garments = result.status === 409 ? result.answer?.garments : null
        if (typeof garments === "number" && garments > 0) {
          // The refusal carries the real count, so the row can start telling the truth right away.
          // Its Delete button is disabled from here on, which leaves Rename as the nearest control.
          setCategories((current) =>
            current.map((entry) => (entry.slug === category.slug ? { ...entry, garmentCount: garments } : entry))
          )
          handFocusTo(`rename:${category.slug}`, from)
        } else handFocusTo(`delete:${category.slug}`, from)
        return
      }
      confirmedOrder.current = confirmedOrder.current.filter((slug) => slug !== category.slug)
      setCategories((current) => current.filter((entry) => entry.slug !== category.slug))
      setStatus(`${category.name} deleted.`)
      // The row is gone, so there is no neighbouring control that is certain to exist.
      handFocusTo("heading", from)
    } catch {
      setConfirming(null)
      fail({ status: 0, message: null }, unconfirmed, false)
      handFocusTo(`delete:${category.slug}`, from)
    } finally {
      setBusy(null)
    }
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const name = newName.trim()
    // The route applies the same two rules; saying so here saves a round trip and a vaguer message.
    const problem = !name
      ? "Give the category a name."
      : slugifyCategoryName(name)
        ? null
        : "Use at least one letter or number from a to z or 0 to 9, so the category can have a slug."
    setNewNameProblem(problem)
    if (problem) {
      focusAfter.current = "new-name"
      return
    }
    const from = document.activeElement
    setBusy("create")
    setError(null)
    setStatus("")
    try {
      const result = await send("/api/admin/products/categories", "POST", { name })
      if (!result.ok) {
        fail(failureOf(result), "That category wasn't added. Try again in a moment.", false)
        return
      }
      const created = result.answer?.category as Partial<ShopCategory> | undefined
      if (typeof created?.slug !== "string" || typeof created.name !== "string") {
        // Saved, but not in a shape this page can list. The server's list is the honest fallback.
        router.refresh()
        return
      }
      const category = { slug: created.slug, name: created.name, garmentCount: 0 }
      confirmedOrder.current = [...confirmedOrder.current, category.slug]
      setCategories((current) => [...current.filter((entry) => entry.slug !== category.slug), category])
      setNewName("")
      setStatus(`${category.name} added at the end of the list.`)
    } catch {
      fail({ status: 0, message: null }, unconfirmed, false)
    } finally {
      setBusy(null)
      // Back to the field either way: emptied for the next name, or still holding the refused one.
      handFocusTo("new-name", from)
    }
  }

  const slugPreview = slugifyCategoryName(newName)
  return (
    <div ref={root} className="flex flex-col gap-8">
      <section aria-labelledby="shop-categories-heading" className="flex flex-col gap-3">
        <h2
          id="shop-categories-heading"
          tabIndex={-1}
          data-focus-key="heading"
          className="font-condensed text-xl font-bold tracking-wide uppercase outline-none"
        >
          Shop categories
        </h2>
        <div className="flex min-h-6 flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
          <p>Changes save as soon as you make them.</p>
          <p role="status" aria-live="polite">
            {status}
          </p>
        </div>
        <p className="sr-only" aria-live="polite">
          {moveMessage}
        </p>
        {error && (
          <Alert variant="destructive">
            <AlertDescription className="flex flex-wrap items-center gap-3">
              {error.message}
              {error.reload && (
                <Button
                  variant="outline"
                  className="min-h-11"
                  onClick={() => {
                    // The page remounts this list only when the server's copy differs. When it does
                    // not, putting the alert away is what shows the press was heard, and the button
                    // going with it would otherwise drop focus to the top of the page.
                    setError(null)
                    focusAfter.current = "heading"
                    router.refresh()
                  }}
                >
                  Reload categories
                </Button>
              )}
            </AlertDescription>
          </Alert>
        )}
        {categories.length ? (
          <ol aria-label="Shop categories" className="flex flex-col gap-2">
            {categories.map((category, index) => {
              const inUse = category.garmentCount > 0
              const reasonId = `category-${category.slug}-in-use`
              const nameId = `category-${category.slug}-name`
              const renaming = editing?.slug === category.slug ? editing : null
              return (
                <li key={category.slug} className="flex flex-col gap-3 rounded-lg border bg-background p-3 sm:p-4">
                  <div className="flex items-center gap-2 sm:gap-4">
                    <span
                      aria-hidden="true"
                      className="w-6 shrink-0 text-center text-sm text-muted-foreground tabular-nums"
                    >
                      {index + 1}
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <p className="font-condensed text-lg leading-tight font-semibold break-words">{category.name}</p>
                      <p className="text-sm break-words text-muted-foreground">
                        Slug {category.slug} ·{" "}
                        {category.garmentCount === 0
                          ? "no garments yet"
                          : `${category.garmentCount} ${category.garmentCount === 1 ? "garment" : "garments"}`}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col gap-1 sm:flex-row">
                      {(["up", "down"] as const).map((direction) => (
                        <Button
                          key={direction}
                          variant="outline"
                          size="icon-lg"
                          className="size-11"
                          aria-label={`Move ${category.name} ${direction}`}
                          data-focus-key={`move-${direction}:${category.slug}`}
                          // An order save carries every slug, and the route refuses a set that a
                          // delete or an add still in flight is about to change. A rename is no risk.
                          disabled={
                            (direction === "up" ? index === 0 : index === categories.length - 1) ||
                            (busy !== null && !busy.startsWith("rename:"))
                          }
                          onClick={() => move(index, direction)}
                        >
                          {direction === "up" ? <ArrowUp aria-hidden="true" /> : <ArrowDown aria-hidden="true" />}
                        </Button>
                      ))}
                    </div>
                  </div>
                  {renaming ? (
                    <form
                      noValidate
                      aria-busy={busy === `rename:${category.slug}`}
                      className="flex flex-col gap-3"
                      onSubmit={rename}
                    >
                      <Field data-invalid={renaming.problem ? true : undefined}>
                        <FieldLabel htmlFor={nameId}>New name for {category.name}</FieldLabel>
                        <Input
                          id={nameId}
                          data-focus-key={`name:${category.slug}`}
                          disabled={busy === `rename:${category.slug}`}
                          value={renaming.name}
                          maxLength={60}
                          autoComplete="off"
                          className="min-h-11"
                          aria-invalid={renaming.problem ? true : undefined}
                          aria-describedby={renaming.problem ? `${nameId}-hint ${nameId}-error` : `${nameId}-hint`}
                          onChange={(event) => setEditing({ ...renaming, name: event.target.value, problem: null })}
                          onKeyDown={(event) => {
                            if (event.key !== "Escape" || busy) return
                            setEditing(null)
                            focusAfter.current = `rename:${category.slug}`
                          }}
                        />
                        <FieldDescription id={`${nameId}-hint`}>
                          Only the name changes. Its slug stays {category.slug}, so nothing that points at it breaks.
                        </FieldDescription>
                        {renaming.problem && <FieldError id={`${nameId}-error`}>{renaming.problem}</FieldError>}
                      </Field>
                      <div className="flex flex-wrap gap-2">
                        <Button type="submit" className="min-h-11" disabled={busy !== null}>
                          {busy === `rename:${category.slug}` ? "Saving…" : "Save name"}{" "}
                          <span className="sr-only">for {category.name}</span>
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          className="min-h-11"
                          disabled={busy !== null}
                          onClick={() => {
                            setEditing(null)
                            focusAfter.current = `rename:${category.slug}`
                          }}
                        >
                          Cancel <span className="sr-only">renaming {category.name}</span>
                        </Button>
                      </div>
                    </form>
                  ) : confirming === category.slug ? (
                    <div className="flex flex-col gap-3">
                      {/* Focus lands on the question, not on a button, so a second Enter cannot delete. */}
                      <p tabIndex={-1} data-focus-key={`confirm:${category.slug}`} className="text-sm outline-none">
                        Delete {category.name}? No garment uses it, so nothing else changes.
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="destructive"
                          className="min-h-11"
                          disabled={busy !== null}
                          onClick={() => remove(category)}
                        >
                          {busy === `delete:${category.slug}` ? "Deleting…" : "Yes, delete"}{" "}
                          <span className="sr-only">{category.name}</span>
                        </Button>
                        <Button
                          variant="outline"
                          className="min-h-11"
                          disabled={busy !== null}
                          onClick={() => {
                            setConfirming(null)
                            focusAfter.current = `delete:${category.slug}`
                          }}
                        >
                          Keep it<span className="sr-only">: {category.name}</span>
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        variant="outline"
                        className="min-h-11"
                        data-focus-key={`rename:${category.slug}`}
                        disabled={busy !== null}
                        onClick={() => {
                          setConfirming(null)
                          setEditing({ slug: category.slug, name: category.name, problem: null })
                          focusAfter.current = `name:${category.slug}`
                        }}
                      >
                        <Pencil data-icon="inline-start" aria-hidden="true" />
                        Rename <span className="sr-only">{category.name}</span>
                      </Button>
                      <Button
                        variant="outline"
                        className="min-h-11"
                        data-focus-key={`delete:${category.slug}`}
                        aria-describedby={inUse ? reasonId : undefined}
                        disabled={inUse || busy !== null}
                        onClick={() => {
                          setEditing(null)
                          setConfirming(category.slug)
                          focusAfter.current = `confirm:${category.slug}`
                        }}
                      >
                        <Trash2 data-icon="inline-start" aria-hidden="true" />
                        Delete <span className="sr-only">{category.name}</span>
                      </Button>
                      {/* A disabled button cannot be focused, so its reason is ordinary visible text. */}
                      {inUse && (
                        <p id={reasonId} className="text-sm text-muted-foreground">
                          Move {garmentsInUse(category.garmentCount)} to another category before deleting this one.
                        </p>
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ol>
        ) : (
          <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
            No categories yet. Add the first one below and the garments have somewhere to hang.
          </p>
        )}
      </section>

      <section aria-labelledby="new-category-heading" className="flex flex-col gap-3 rounded-lg border p-4 sm:p-6">
        <h2 id="new-category-heading" className="font-condensed text-xl font-bold tracking-wide uppercase">
          Add a category
        </h2>
        <form noValidate aria-busy={busy === "create"} className="flex flex-col gap-3" onSubmit={create}>
          <Field data-invalid={newNameProblem ? true : undefined}>
            <FieldLabel htmlFor="new-category-name">New category name</FieldLabel>
            <Input
              id="new-category-name"
              data-focus-key="new-name"
              disabled={busy === "create"}
              value={newName}
              maxLength={60}
              autoComplete="off"
              className="min-h-11"
              aria-invalid={newNameProblem ? true : undefined}
              aria-describedby={
                newNameProblem ? "new-category-name-hint new-category-name-error" : "new-category-name-hint"
              }
              onChange={(event) => {
                setNewName(event.target.value)
                setNewNameProblem(null)
              }}
            />
            <FieldDescription id="new-category-name-hint">
              Its slug is made from this name when you add it and is fixed from then on, even if you rename the category
              later.{slugPreview ? ` This one would be ${slugPreview}.` : ""}
            </FieldDescription>
            {newNameProblem && <FieldError id="new-category-name-error">{newNameProblem}</FieldError>}
          </Field>
          <Button type="submit" className="min-h-11 w-fit" disabled={busy !== null}>
            {busy === "create" ? "Adding…" : "Add category"}
          </Button>
        </form>
      </section>
    </div>
  )
}
