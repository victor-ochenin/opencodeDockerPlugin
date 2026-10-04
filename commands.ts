import { execFile } from "node:child_process"

import type { ComposeTarget } from "./compose.ts"
import type { Container, ContainerAction } from "./types.ts"

const COMMAND = "docker"
const TIMEOUT_MS = 60000
const MAX_BUFFER = 1024 * 1024

export const ACTION_LABEL: Record<ContainerAction, string> = {
  start: "Start",
  up: "Up stack",
  restart: "Restart",
  stop: "Stop",
  down: "Down compose project",
}

/** The name is passed after `--` because a container name may start with a dash and docker would read it as a flag. */
export function buildArgs(action: ContainerAction, container: Container, target?: ComposeTarget | null): string[] {
  if (action === "up") {
    if (!target) throw new Error(`container ${container.name} has no resolved compose target`)
    // Both flags are explicit: the project name in the file can be templated or overridden by the
    // environment, and this way `up` acts on the very project the panel is already showing.
    return ["compose", "-f", target.file, "-p", target.project, "up", "-d"]
  }
  if (action === "down") {
    const project = container.composeProject
    if (!project) throw new Error(`container ${container.name} has no compose project`)
    return ["compose", "-p", project, "down"]
  }
  return [action, "--", container.name]
}

/** Only offers what docker accepts for the current state, with the destructive action last. */
export function availableActions(container: Container, target?: ComposeTarget | null): ContainerAction[] {
  const down: ContainerAction[] = container.composeProject ? ["down"] : []
  const up: ContainerAction[] = container.composeProject && target ? ["up"] : []
  switch (container.state) {
    case "running":
    case "restarting":
    case "paused":
      return ["restart", "stop", ...down]
    case "created":
    case "exited":
    case "dead":
      return ["start", ...up, ...down]
    default:
      return []
  }
}

function firstLine(text: string): string {
  const line = text
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => item.length > 0)
  if (!line) return ""
  return line.length > 80 ? `${line.slice(0, 77)}...` : line
}

export interface CommandResult {
  readonly ok: boolean
  readonly message: string
}

/**
 * Runs an already-built argument list. `up` has no container behind it, so the boundary takes the
 * argv rather than a container the caller would have to invent to satisfy the type.
 */
export function runDockerArgs(args: readonly string[]): Promise<CommandResult> {
  return new Promise((resolve) => {
    execFile(
      COMMAND,
      [...args],
      { timeout: TIMEOUT_MS, windowsHide: true, maxBuffer: MAX_BUFFER },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({ ok: true, message: firstLine(String(stdout)) || "done" })
          return
        }
        const killed = (error as { killed?: boolean }).killed === true
        const reason = firstLine(String(stderr)) || (killed ? "timed out" : error.message)
        resolve({ ok: false, message: reason || "command failed" })
      },
    )
  })
}
