import { readFileSync } from "node:fs"
import { basename, dirname, join } from "node:path"

/** compose v2's own search order, so the resolver sees the file the CLI would pick */
const CANDIDATES = ["compose.yaml", "compose.yml", "docker-compose.yaml", "docker-compose.yml"]

/**
 * Compose derives a project name from the directory by lowercasing it, dropping everything outside
 * `[a-z0-9_-]` and then dropping whatever is left before the first alphanumeric. Measured against
 * compose v2: `My.Stack 2` becomes `mystack2`, `A+B` becomes `ab`, `--Lead` becomes `lead`,
 * `Ünïcode` becomes `ncode`, and a directory named `---` fails with "project name must not be empty".
 *
 * The panel passes the name explicitly as `-p`, which replaces that derivation, so the same
 * normalization has to happen here or compose rejects what it would have accepted on its own.
 */
export function normalizeProject(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "")
    .replace(/^[^a-z0-9]+/, "")
}

const VALID_PROJECT = /^[a-z0-9][a-z0-9_-]*$/

export interface ComposeTarget {
  readonly dir: string
  readonly file: string
  readonly project: string
}

/** An unindented `name:` is top-level by construction, which is why a regex beats a YAML parser here */
function declaredProject(body: string): string {
  // A UTF-8 BOM makes `^` miss the first line and hands back the directory name as the project, and
  // PowerShell writes one
  const match = body.replace(/^\uFEFF/, "").match(/^name:[ \t]*(\S.*?)[ \t]*$/m)
  return match?.[1]?.replace(/^["']|["']$/g, "") ?? ""
}

/**
 * Finds the agent directory's compose file and reports the project it declares, if any.
 *
 * Read on every call because the caller opens a menu, not the poll loop.
 */
export function findComposeFile(agentDir: string): ComposeTarget | null {
  if (!agentDir) return null
  for (const candidate of CANDIDATES) {
    const file = join(agentDir, candidate)
    let body: string
    try {
      body = readFileSync(file, "utf8")
    } catch {
      continue
    }
    // The first file that exists wins even when its project differs, because that is the one compose
    // itself would use, and falling through would act on a stack the CLI ignores
    const declared = declaredProject(body)
    const project = declared || normalizeProject(basename(dirname(file)))
    // A declared name compose will reject, or a directory that normalizes to nothing, is a refusal
    // rather than a button that can only fail
    if (!VALID_PROJECT.test(project)) return null
    return { dir: agentDir, file, project }
  }
  return null
}

/**
 * The compose target for a container already part of the project, or null when the agent directory's
 * file belongs to somebody else.
 *
 * `up` runs build and command lines from that file, so an uncertain match has to hide the button
 * rather than point it at the wrong stack.
 */
export function resolveComposeTarget(agentDir: string, project: string): ComposeTarget | null {
  const target = findComposeFile(agentDir)
  if (!target || !project || target.project !== project) return null
  return target
}