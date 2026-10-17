import "server-only"
import { notFound } from "next/navigation"
import { z } from "zod"

export async function readHeroWeekParam(params: Promise<{ week: string }>) {
  let week: string
  try {
    week = decodeURIComponent((await params).week)
  } catch {
    notFound()
  }
  if (!z.iso.datetime().safeParse(week).success) notFound()
  return week
}
