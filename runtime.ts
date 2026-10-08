import { execFile } from "node:child_process"

const COMMAND = "docker"
/**
 * Measured with Docker Desktop stopped on this machine: three runs took 3497, 4439 and 4453 ms.
 * The CLI plugin spends those seconds waiting on a named pipe that is not answering, so a four second
 * timeout like the `docker ps` one kills the call and turns a provable `stopped` into `unknown`,
 * which hides the Start button. Nine seconds clears the measured worst case with room to spare.
 */
const TIMEOUT_MS = 9000
const MAX_BUFFER = 1024 * 1024

export type EngineState = "running" | "stopped" | "absent" | "unknown"

export type RuntimeAction = "engine-start" | "engine-stop"

/**
 * `docker desktop status` has no output contract for the stopped case: it exits 1 and writes the
 * reason to stderr, so the state comes from the exit code plus the wording rather than from a value.
 *
 * Measured on Docker Desktop CLI plugin v0.2.0, stopped: exit 1, stderr
 * `Could not retrieve status. Is Docker Desktop running?`, stdout `You can start Docker Desktop by
 * running 'docker desktop start'.`. The stdout half is the independent half: it asserts the engine is
 * down and names the command, where the stderr half only asks a question.
 * Measured with an unknown flag on the same build: exit 125, which is docker's own code for a command
 * or flag it does not know, so the code alone cannot tell stopped from missing. `docker desktop engine ls`
 * also exits 1 when the engine is down, but says `unable to retrieve the engine list`, so exit 1 alone
 * would be wrong and the wording is what makes the state provable.
 */
export function parseDesktopStatus(code: number | null, stdout: string, stderr: string): EngineState {
  const text = `${stdout}\n${stderr}`.toLowerCase()
  // Both wordings are real: older docker says `is not a docker command`, this build says `unknown command`
  if (text.includes("is not a docker command") || text.includes("unknown command")) return "absent"
  if (code === 0) return "running"
  // Exit 1 alone is not enough, `docker desktop engine ls` shares it. Both wordings name the engine as
  // down, so either one plus the code makes the state provable rather than inferred
  if (code === 1 && (text.includes("is docker desktop running") || text.includes("you can start docker desktop"))) {
    return "stopped"
  }
  return "unknown"
}

export const ENGINE_TIMEOUT_MS = TIMEOUT_MS

export function runDesktopStatus(timeoutMs: number = TIMEOUT_MS): Promise<EngineState> {
  return new Promise((resolve) => {
    execFile(
      COMMAND,
      ["desktop", "status"],
      { timeout: timeoutMs, windowsHide: true, maxBuffer: MAX_BUFFER },
      (error, stdout, stderr) => {
        if (!error) {
          resolve("running")
          return
        }
        const killed = (error as { killed?: boolean }).killed === true
        if (killed) {
          resolve("unknown")
          return
        }
        const failure = error as { code?: string | number }
        const code = failure.code === "ENOENT" ? null : (failure.code ?? null)
        resolve(parseDesktopStatus(typeof code === "number" ? code : null, String(stdout), String(stderr)))
      },
    )
  })
}

/** An app-level stop kills every container of every project, so it needs a confirmation the container actions do not */
export function buildRuntimeArgs(action: RuntimeAction): string[] {
  return ["desktop", action === "engine-start" ? "start" : "stop"]
}

export const ENGINE_ACTION_LABEL: Record<RuntimeAction, string> = {
  "engine-start": "Start Docker Desktop",
  "engine-stop": "Stop Docker Desktop",
}
