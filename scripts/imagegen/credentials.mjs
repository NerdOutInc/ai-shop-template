import { readFile, stat } from "node:fs/promises"
import { resolve } from "node:path"

/**
 * Read a provider key from the environment or from the private file named by `<NAME>_FILE`.
 * The value is returned to the caller only; nothing here prints, logs or echoes it.
 */
export async function readProviderKey(name, environment = process.env) {
  const fileVariable = `${name}_FILE`
  if (environment[fileVariable]) {
    const path = resolve(environment[fileVariable])
    const info = await stat(path).catch(() => null)
    if (!info?.isFile()) throw new Error(`${fileVariable} must point to an existing private file`)
    if (process.platform !== "win32" && (info.mode & 0o077) !== 0)
      throw new Error(`${fileVariable} must be private to your account. Run chmod 600 on it.`)
    const key = (await readFile(path, "utf8")).trim()
    if (!key) throw new Error(`${fileVariable} is empty`)
    return key
  }
  const key = environment[name]?.trim()
  if (!key) throw new Error(`Set ${name} in the process environment or ${fileVariable} to a private file (chmod 600)`)
  return key
}
