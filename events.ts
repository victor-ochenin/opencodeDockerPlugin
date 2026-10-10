import { spawn } from "node:child_process"

const COMMAND = "docker"
const ARGS = ["events", "--filter", "type=container", "--format", "{{json .}}"]

/**
 * The actions that can change what the panel draws.
 *
 * `kill` is left out because it arrives as a pair ahead of `stop` and `die` and changes nothing on its
 * own. `create` is out because the container stays `created` for the half second before `start` and the
 * panel draws no row for that state. `stop` is out because `docker ps` already reports `exited` by the
 * time it arrives. `restart` is out because a measured `docker restart` sends `die` and `start` first,
 * which bracket the whole visible change, so it would repeat the frame `start` just produced.
 * Everything with an `exec_` or `health_` prefix is the container's internals and never reaches the panel.
 */
export const INTERESTING_ACTIONS = ["start", "die", "destroy", "pause", "unpause", "rename"]

interface DockerEvent {
  readonly Type?: unknown
  readonly Action?: unknown
  readonly status?: unknown
  readonly Actor?: { readonly Attributes?: { readonly name?: unknown } }
}

/** Returns the container name an event is about, or null when the panel has no reason to react */
export function parseEventLine(line: string): string | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  let raw: unknown
  try {
    raw = JSON.parse(trimmed)
  } catch {
    return null
  }
  if (typeof raw !== "object" || raw === null) return null
  const event = raw as DockerEvent
  if (event.Type !== "container") return null
  const action = String(event.Action ?? event.status ?? "")
  if (!INTERESTING_ACTIONS.includes(action)) return null
  const name = event.Actor?.Attributes?.name
  return typeof name === "string" && name.length > 0 ? name : null
}

export interface EventWatch {
  /** Fires once per interesting event, immediately. No debounce: the measured gaps are seconds wide */
  readonly onEvent: (onChange: () => void) => void
  /** Fires once when the process is gone on its own, which is the only trustworthy sign it cannot recover */
  readonly onDead: (onDead: () => void) => void
  readonly restart: () => void
  readonly close: () => void
}

/**
 * A long-lived `docker events` reader.
 *
 * The stream ends loudly rather than going quiet: stopping Docker Desktop leaves it silent for about
 * thirty seconds and then writes `unexpected EOF` and exits with code 1. So the caller is told when the
 * process is gone and decides on its own when reopening is worth the attempt.
 */
export function createEventWatch(): EventWatch {
  let child: ReturnType<typeof spawn> | undefined
  let buffer = ""
  let closed = false
  let consumer: (() => void) | undefined
  let onDead: (() => void) | undefined

  const open = () => {
    if (closed) return
    const spawned = spawn(COMMAND, ARGS, { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] })
    child = spawned
    // A docker that is not on the PATH makes spawn emit an error, and an unheard one throws
    spawned.on("error", () => {})
    // A half-written line from the killed process would prepend itself to the new process's first
    // chunk and take that first event down with it
    buffer = ""
    spawned.stdout?.setEncoding("utf8")
    spawned.stdout?.on("data", (chunk: string) => {
      // The last split piece is a partial line and has to survive to the next chunk
      const lines = (buffer + chunk).split("\n")
      buffer = lines.pop() ?? ""
      for (const line of lines) {
        if (!parseEventLine(line)) continue
        consumer?.()
      }
    })
    // Only the process still in hand gets to speak for the stream, and killing one is asynchronous, so
    // after a restart the previous child still reports in. Trusting that report would drop the live
    // child's reference, orphan the process and fake a dead stream. The same check covers our own stop,
    // which clears `child` before killing.
    spawned.on("close", () => {
      if (child !== spawned) return
      child = undefined
      onDead?.()
    })
  }

  const stop = () => {
    const current = child
    child = undefined
    current?.kill()
  }

  open()

  return {
    onEvent: (onChange) => {
      consumer = onChange
    },
    onDead: (handler) => {
      onDead = handler
    },
    restart: () => {
      stop()
      open()
    },
    close: () => {
      closed = true
      consumer = undefined
      onDead = undefined
      stop()
    },
  }
}
