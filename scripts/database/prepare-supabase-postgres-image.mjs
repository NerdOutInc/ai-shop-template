// Match the Supabase CLI's official registry order without changing the tested database version.
const images = ["public.ecr.aws", "ghcr.io", "docker.io"].map((registry) => `${registry}/supabase/postgres:17.6.1.167`)

export function prepareSupabasePostgresImage(docker) {
  for (const image of images) {
    try {
      docker(["image", "inspect", image])
      return image
    } catch {
      // Reuse any official mirror already cached before making network requests.
    }
  }

  const errors = []
  for (const image of images) {
    try {
      docker(["pull", image])
      return image
    } catch (cause) {
      errors.push(new Error(`Could not pull ${image}`, { cause }))
      console.warn(`Could not pull ${image}; trying the next official mirror if available.`)
    }
  }
  throw new AggregateError(errors, "Could not obtain the required Supabase Postgres test image from any registry")
}
