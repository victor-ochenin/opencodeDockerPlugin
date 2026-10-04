import { readFileSync } from "node:fs"
import { basename, dirname, join } from "node:path"

/** compose v2's own search order, so the resolver sees the same file the CLI would pick. */
const CANDIDATES = ["compose.yaml", "compose.yml", "docker-compose.yaml", "docker-compose.yml"]

export interface ComposeTarget {
  readonly dir: string
  readonly file: string
  readonly project: string
}

/** An unindented `name:` is top-level by construction, which is why a regex beats a YAML parser here. */
function declaredProject(body: string): string {
  // A UTF-8 BOM makes `^` miss the first line, which would hand back the directory name as if it
  // were the project's. PowerShell and several editors write one, so strip it before matching.
  const match = body.replace(/^\uFEFF/, "").match(/^name:[ \t]*(\S.*?)[ \t]*$/m)
  return match?.[1]?.replace(/^["']|["']$/g, "") ?? ""
}

/**
 * Finds the agent directory's compose file and reports the project it declares, if any. The file is
 * read on every call because the call comes from opening a menu, not from the poll loop.
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
    // The first file that exists wins even when its project differs, because that is the file
    // compose itself would use. Falling through would act on a stack the CLI ignores.
    return { dir: agentDir, file, project: declaredProject(body) || basename(dirname(file)) }
  }
  return null
}

/**
 * The compose target for a container that is already part of the project, or null when the agent
 * directory's file belongs to somebody else. `up` runs build and command lines from that file, so
 * an uncertain match has to hide the button rather than point it at the wrong stack.
 */
export function resolveComposeTarget(agentDir: string, project: string): ComposeTarget | null {
  const target = findComposeFile(agentDir)
  if (!target || !project || target.project !== project) return null
  return target
}