import { z } from "zod"

export const galleryPhotoRoleSchema = z.enum([
  "garment",
  "male-studio",
  "female-studio",
  "male-lifestyle",
  "female-lifestyle",
  "other",
])
