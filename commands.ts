import { execFile } from "node:child_process"

import type { ComposeTarget } from "./compose.ts"
import type { Container, ContainerAction } from "./types.ts"

/** Exported because the panel prints a command line and a printed line has to name the binary it will run */
export const COMMAND = "docker"
const TIMEOUT_MS = 60000
const MAX_BUFFER = 1024 * 1024

/**
 * A command as a reader sees it, binary included.
 *
 * The panel prints this beside every action, and a printed line that lost the binary is a line that
 * cannot be pasted back into a shell to be run by hand.
 */
export function commandLine(bin: string, args: readonly string[]): string {
  return [bin, ...args].join(" ")
}

export const ACTION_LABEL: Record<ContainerAction, string> = {
  start: "Start",
  up: "Up stack",
  restart: "Restart",
  stop: "Stop",
  down: "Down compose project",
}

/**
 * `up` acts on a project rather than on a container: nothing stands behind it to name, which is why
 * this takes the resolved target alone and `buildArgs` only delegates here. The panel reaches the
 * same builder from the header, where there is no container at all.
 *
 * Both flags are explicit because the project's `name:` can be templated or overridden by the
 * environment, and this way `up` acts on the project the panel is already showing.
 */
export function buildUpArgs(target: ComposeTarget): string[] {
  return ["compose", "-f", target.file, "-p", target.project, "up", "-d"]
}

/** The name goes after `--` because a container name may start with a dash and docker reads it as a flag */
export function buildArgs(action: ContainerAction, container: Container, target?: ComposeTarget | null): string[] {
  if (action === "up") {
    if (!target) throw new Error(`container ${container.name} has no resolved compose target`)
    return buildUpArgs(target)
  }
  if (action === "down") {
    const project = container.composeProject
    if (!project) throw new Error(`container ${container.name} has no compose project`)
    return ["compose", "-p", project, "down"]
  }
  return [action, "--", container.name]
}

/** Only what docker accepts for the current state, with the destructive action last */
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
  /**
   * The exit code, or null when the process never got to exit one: a timeout kill or a binary that
   * is not on PATH. Kept because the engine probe reads state out of exit codes rather than out of
   * prose: `systemctl is-active` answers 3 for an inactive unit and `docker desktop status` answers
   * 125 for a subcommand that does not exist, and both of those are ordinary failures that a
   * `message` string cannot be told apart from any other.
   */
  readonly code: number | null
  readonly stdout: string
  readonly stderr: string
  /** True when the call was killed rather than answered, so nothing it produced may be read as a verdict */
  readonly timedOut: boolean
}

/**
 * Runs an already-built argument list against a named binary.
 *
 * The binary is a parameter rather than a constant because the engine controls do not go through
 * docker at all: on Linux the daemon is a systemd unit and its commands are `systemctl`, reached
 * through sudo, so `docker <args>` cannot express them.
 *
 * There is no stdin and no TTY here on purpose: a control that waits for a password prompt has
 * nothing to read the password from, so the engine path passes `-n` to sudo and fails fast instead
 * of hanging until the timeout.
 */
export function runProcess(
  bin: string,
  args: readonly string[],
  timeoutMs: number = TIMEOUT_MS,
): Promise<CommandResult> {
  return new Promise((resolve) => {
    execFile(
      bin,
      [...args],
      { timeout: timeoutMs, windowsHide: true, maxBuffer: MAX_BUFFER },
      (error, stdout, stderr) => {
        const out = String(stdout)
        const err = String(stderr)
        if (!error) {
          resolve({ ok: true, message: firstLine(out) || "done", code: 0, stdout: out, stderr: err, timedOut: false })
          return
        }
        const timedOut = (error as { killed?: boolean }).killed === true
        const code = typeof error.code === "number" ? error.code : null
        const reason = firstLine(err) || (timedOut ? "timed out" : firstLine(error.message))
        resolve({ ok: false, message: reason || "command failed", code, stdout: out, stderr: err, timedOut })
      },
    )
  })
}

/**
 * Runs an already-built argument list against the docker CLI.
 *
 * `up` has no container behind it, so the boundary takes the argv rather than a container the caller
 * would have to invent to satisfy the type.
 */
export function runDockerArgs(args: readonly string[]): Promise<CommandResult> {
  return runProcess(COMMAND, args)
}
