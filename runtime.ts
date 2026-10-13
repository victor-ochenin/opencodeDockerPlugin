import { userInfo } from "node:os"

import { runProcess, type CommandResult } from "./commands.ts"

/**
 * The Desktop backend owns the named pipe `dockerDesktopLinuxEngine`, and the CLI plugin spends
 * about four seconds waiting on a pipe that is not answering before it admits the engine is down.
 * Measured with Desktop stopped on this machine: three runs took 3497, 4439 and 4453 ms, so a four
 * second timeout like the `docker ps` one kills the call and turns a provable `stopped` into
 * `unknown`, which hides the Start button. Nine seconds clears the measured worst case with room
 * to spare.
 */
const DESKTOP_COMMAND = "docker"
const DESKTOP_TIMEOUT_MS = 9000

/**
 * Linux has no `docker desktop` subcommand at all: it ships with Docker Desktop, which is a Windows
 * product. On Linux the probe exits with `is not a docker command` and could therefore only ever
 * answer `absent`, which is the one state the panel refuses to draw a Start button for. The Linux
 * engine is the `docker.service` systemd unit instead.
 *
 * `systemctl is-active` answers in 81 ms measured here, against the four seconds above, so this path
 * gets a timeout two thousand times tighter: a call that has not answered in three seconds is not
 * going to answer, and reporting `unknown` is exactly what hides the Start button.
 */
const SYSTEMD_COMMAND = "systemctl"
const SYSTEMD_TIMEOUT_MS = 3000

/**
 * `docker.service` declares `Requires=docker.socket`, and that socket unit is enabled and listening
 * on `/run/docker.sock`. That is socket activation, so any connection to the socket path starts the
 * daemon again.
 *
 * This is what makes the stop need two units rather than one. Stopping the service alone looks like
 * it worked for exactly as long as nothing reconnects, and this panel reconnects by itself every
 * three seconds while it believes the engine is down, so Docker comes straight back on the next
 * poll and the control reads as broken. The socket has to go down too, and naming both units in a
 * single call is what makes the stop stick.
 */
const SYSTEMD_SOCKET_UNIT = "docker.socket"
const SYSTEMD_UNIT = "docker.service"

/**
 * Starting names one unit because `Requires=docker.socket` pulls the socket up with it, so there is
 * nothing to add to a start that stopping does not need.
 */
const SYSTEMD_START_UNITS: readonly string[] = [SYSTEMD_UNIT]
const SYSTEMD_STOP_UNITS: readonly string[] = [SYSTEMD_UNIT, SYSTEMD_SOCKET_UNIT]

/**
 * A unit control is a root operation and the panel has no TTY to answer a password prompt with, so
 * sudo gets `-n` and fails immediately instead of blocking on a prompt that can never be answered.
 * That is the difference between an error the panel can print and a TUI that looks frozen.
 *
 * Allowing it is a one-time root step the user has to take themselves. The panel cannot do it and
 * does not try: it has no way to ask for a password that the user is not there to type.
 */
const SUDO_BIN = "sudo"
const SUDO_NONINTERACTIVE = ["-n"]

export const IS_LINUX = process.platform === "linux"

/**
 * The panel says Docker Desktop because on Windows that is the product being started and stopped.
 * On Linux the unit is a plain `docker.service` and no Desktop is installed, so naming one there
 * would put a false product in front of the reader.
 */
export const ENGINE_NAME = IS_LINUX ? "Docker" : "Docker Desktop"

export type EngineState = "running" | "stopped" | "absent" | "unknown"

export type RuntimeAction = "engine-start" | "engine-stop"

export interface RuntimeCommand {
  readonly bin: string
  readonly args: readonly string[]
}

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

/**
 * `systemctl is-active` is the Linux counterpart, and unlike the Windows probe it has a real output
 * contract: one state word on stdout, with an exit code that follows it. Exit 0 is active, 3 is
 * inactive or failed, 4 is a unit that does not exist.
 *
 * The word is read rather than the code because the codes lose the transitions: `activating` is
 * already on its way up and `deactivating` is already on its way down, and each is the state the
 * panel should be drawing right now rather than the one the unit will be in a moment later.
 *
 * The code still has to be consulted for 4, and that has to happen before the word. Measured on a
 * machine with Docker installed, `systemctl is-active docker-nonexistent-yyz` prints `inactive` and
 * exits 4, so the word alone cannot tell a stopped daemon from a unit that was never there. The word
 * for that case is the same word a genuinely stopped `docker.service` prints, which is why reading
 * only the word offered `Start Docker` for a Docker that does not exist.
 */
export function parseEngineStatus(code: number | null, stdout: string, stderr: string): EngineState {
  const word = stdout
    .trim()
    .toLowerCase()
    .split(/\r?\n/)
    .find((line) => line.length > 0)
  // No code at all means the binary never ran, so there is no state to report and nothing installed
  if (code === null) return "absent"
  // Code 4 is systemd's own answer for a unit it cannot find, and it outranks the word: see above
  if (code === 4) return "absent"
  if (word === "unknown" || word === "not-found") return "absent"
  if (word === "active" || word === "activating" || word === "reloading") return "running"
  if (word === "inactive" || word === "failed" || word === "deactivating") return "stopped"
  // Older systemd wordings for an unresolvable unit, kept as a backstop now that the code is read
  const text = `${stdout}\n${stderr}`.toLowerCase()
  if (text.includes("no such file") || text.includes("could not find the requested service")) return "absent"
  // No systemd at all is also absent rather than unknown, and the distinction is not cosmetic: the
  // panel stops polling `docker logs` for `absent`, so leaving this as `unknown` keeps a container
  // inside, WSL, or any non-systemd init spawning a doomed log call every two seconds. Nothing here
  // can be controlled by a unit command, which is exactly what `absent` already means everywhere else
  if (text.includes("has not been booted with systemd") || text.includes("failed to connect to bus")) {
    return "absent"
  }
  return "unknown"
}

/** An app-level stop kills every container of every project, so it needs a confirmation the container actions do not */
export function buildRuntimeArgs(action: RuntimeAction): readonly string[] {
  if (!IS_LINUX) {
    return ["desktop", action === "engine-start" ? "start" : "stop"]
  }
  const verb = action === "engine-start" ? "start" : "stop"
  const units = action === "engine-start" ? SYSTEMD_START_UNITS : SYSTEMD_STOP_UNITS
  return [SYSTEMD_COMMAND, verb, ...units]
}

/**
 * The binary and the argv, kept apart because the Linux path is not a docker subcommand at all:
 * `runDockerArgs` cannot launch it, so the caller needs to know which binary to run.
 */
export function buildRuntimeCommand(action: RuntimeAction): RuntimeCommand {
  if (!IS_LINUX) return { bin: DESKTOP_COMMAND, args: ["desktop", action === "engine-start" ? "start" : "stop"] }
  return { bin: SUDO_BIN, args: [...SUDO_NONINTERACTIVE, ...buildRuntimeArgs(action)] }
}

/**
 * What the confirmation dialogs and the list footer print, so the reader sees the command that will
 * really run.
 *
 * The binary is part of it: on Linux the argv is `-n systemctl stop docker.service docker.socket`,
 * which is not runnable on its own and silently drops the privilege the call actually needs.
 */
export function describeRuntimeCommand(action: RuntimeAction): string {
  const { bin, args } = buildRuntimeCommand(action)
  return [bin, ...args].join(" ")
}

export const ENGINE_ACTION_LABEL: Record<RuntimeAction, string> = {
  "engine-start": `Start ${ENGINE_NAME}`,
  "engine-stop": `Stop ${ENGINE_NAME}`,
}

/**
 * Running the unit controls needs root and this process has no TTY, so the one failure the user can
 * actually fix is a missing sudoers rule. The raw sudo wording does not say that, and typing the
 * password into the panel is not an option because there is no prompt to type it into.
 *
 * The wordings are measured on this machine, not guessed: sudo 1.9.15 prints `interactive
 * authentication is required` for `-n` with no rule, and the `a terminal is required` family only
 * appears when a password is actually solicited. Matching the wrong one would leave the reader with
 * the same bare error the plugin was asked to improve on.
 */
export function explainPrivilegeFailure(raw: string): string | undefined {
  const text = raw.toLowerCase()
  if (
    text.includes("interactive authentication is required") ||
    text.includes("a terminal is required") ||
    text.includes("password is required") ||
    text.includes("no password was provided")
  ) {
    return sudoersHint()
  }
  if (text.includes("not in the sudoers file") || text.includes("is not allowed to run")) {
    return `${sudoersHint()}\nreason: this user is not allowed to control docker.service at all`
  }
  return undefined
}

/**
 * The name has to be the real one, and `$USER` cannot stand in: it goes inside single quotes, so the
 * shell would not expand it and the reader would end up with a sudoers rule for nobody.
 *
 * `userInfo()` throws when the process runs as a uid with no passwd entry, which is normal inside a
 * container, so it is a fallback rather than the primary source and its own failure falls through to
 * a placeholder that cannot be mistaken for a working rule.
 */
function currentUser(): string {
  const fromEnv = process.env.USER
  if (fromEnv) return fromEnv
  try {
    return userInfo().username
  } catch {
    return "YOUR_USER"
  }
}

const SAFE_USER = /^[A-Za-z0-9._][A-Za-z0-9._-]*$/

/**
 * Printed in the exact form it has to be written, because a sudoers line is not something a reader
 * should have to assemble from the argv. `%u` is not valid here: it has to be the actual user, and
 * `sudo -l` shows whether the rule took.
 *
 * The name is refused unless it looks like a name because this line is a command the reader pastes
 * into a shell running as root, and a name carrying a quote would make it a different command.
 */
export function sudoersHint(user: string = currentUser()): string {
  const name = SAFE_USER.test(user) ? user : "YOUR_USER"
  return [
    `needs root, once, as root: echo '${name} ALL=(root) NOPASSWD: /usr/bin/systemctl start ${SYSTEMD_UNIT}, /usr/bin/systemctl stop ${SYSTEMD_UNIT} ${SYSTEMD_SOCKET_UNIT}' | sudo tee /etc/sudoers.d/opencode-docker`,
  ].join("\n")
}

/**
 * Exported so the checks can assert the two platforms are held to the timeout their own measurement
 * justifies, rather than to one shared number that is too tight for one of them and wasteful for the
 * other: the Desktop probe needs seconds, `systemctl is-active` needs almost nothing.
 */
export const ENGINE_TIMEOUT_MS = IS_LINUX ? SYSTEMD_TIMEOUT_MS : DESKTOP_TIMEOUT_MS

/**
 * The status probe is a read and needs no privileges, so it never goes through sudo. Asking for a
 * password merely to read a unit state would fail in exactly the situation the panel exists to
 * report, which is an engine stopped by someone who has not set up the sudoers rule yet.
 */
export function runEngineStatus(timeoutMs?: number): Promise<EngineState> {
  if (!IS_LINUX) return runDesktopStatus(timeoutMs ?? DESKTOP_TIMEOUT_MS)
  return runProcess(SYSTEMD_COMMAND, ["is-active", SYSTEMD_UNIT], timeoutMs ?? SYSTEMD_TIMEOUT_MS).then(fromResult)
}

/** Same decision, from the result rather than from raw fields, so a timeout cannot be read as a verdict */
function fromResult(result: CommandResult): EngineState {
  if (result.timedOut) return "unknown"
  return parseEngineStatus(result.code, result.stdout, result.stderr)
}

export function runDesktopStatus(timeoutMs: number = DESKTOP_TIMEOUT_MS): Promise<EngineState> {
  return runProcess(DESKTOP_COMMAND, ["desktop", "status"], timeoutMs).then((result) => {
    if (result.timedOut) return "unknown"
    return parseDesktopStatus(result.code, result.stdout, result.stderr)
  })
}
