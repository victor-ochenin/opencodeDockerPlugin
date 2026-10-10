import { createSignal, onCleanup } from "solid-js"

import { createEventWatch } from "./events.ts"
import { runDockerPs } from "./docker.ts"
import { runDesktopStatus, type EngineState } from "./runtime.ts"
import type { Container, DockerState } from "./types.ts"

const INITIAL: DockerState = { kind: "empty", containers: [], detail: "loading" }

/** docker reports the old state for a moment after start or stop, so an action is polled twice */
const SETTLE_MS = 1200

/**
 * Events drive the panel now, so this is only the net for the case where docker says nothing at all:
 * a container changed outside anything we would hear about, or the stream is gone and the engine has
 * come back since the last attempt.
 */
export const FALLBACK_INTERVAL_MS = 30000

/**
 * Nothing can change while the engine is down, so a start from the tray is the one thing worth waiting
 * on closely, and the engine probe has no timer of its own to notice it.
 */
const ENGINE_DOWN_RETRY_MS = 3000

export function fallbackDelayMs(kind: DockerState["kind"]): number {
  return kind === "stopped" ? ENGINE_DOWN_RETRY_MS : FALLBACK_INTERVAL_MS
}

/**
 * A Docker Desktop cold start boots a virtual machine, which takes a minute and answers `unknown` while
 * it goes. Polling faster than the container loop is what makes the panel notice it came up at all,
 * and the deadline is what stops a dead engine from holding `working` forever.
 */
export const ENGINE_TRANSITION_MS = 2000
export const ENGINE_DEADLINE_MS = 120000

export function keepContainers(previous: Container[], next: DockerState): Container[] {
  // A stopped engine is not a blip, it means every container really is down, so the rows go rather than
  // linger as a lie. Only a poll that could not reach docker keeps what was known
  if (next.kind === "unavailable" || next.kind === "stale") return previous
  return next.containers
}

/** The sidebar belongs to what runs right now, not to every container that exists */
export const MAX_RUNNING = 5

/**
 * A pinned container is shown whatever its state and spends the running budget when it happens to
 * run, so pinning everything shows everything.
 *
 * Stopped containers get no row, the dialog is their only door.
 */
export function selectRows(all: Container[], pinned: string[]): Container[] {
  const isPinned = (item: Container) => pinned.includes(item.name)
  const fixed = all.filter(isPinned)
  const running = all.filter((item) => !isPinned(item) && item.state === "running")
  return [...fixed, ...running.slice(0, Math.max(0, MAX_RUNNING - fixed.length))]
}

export interface DockerPolling {
  readonly state: () => DockerState
  readonly refresh: () => Promise<void>
  readonly refreshAfterAction: () => Promise<void>
}

/**
 * A stream that has closed is only worth reopening once docker answers again. Reopening while the
 * engine is down would spawn a process that cannot work, every tick, for as long as the engine is off.
 */
export function shouldReconnect(kind: DockerState["kind"], streamAlive: boolean): boolean {
  return !streamAlive && (kind === "ok" || kind === "empty")
}

export interface EngineProbe {
  readonly state: () => EngineState
  readonly refresh: () => Promise<EngineState>
  readonly waitForRunning: (deadlineMs?: number) => Promise<boolean>
}

/**
 * The engine has its own probe because `docker ps` cannot report it: on a stopped engine the ps call
 * fails to connect and says only `unavailable`, which is also what a missing CLI or a locked socket
 * produces. `docker desktop status` is the only thing that tells those apart.
 */
export function createEngineProbe(): EngineProbe {
  const [state, setState] = createSignal<EngineState>("unknown")
  let disposed = false
  let probing = false

  /**
   * A stopped engine takes over four seconds to answer, which is longer than the container poll, so a
   * probe per poll would leave several of them waiting on the same pipe at once. One at a time is the
   * whole guard: a call that arrives while one is in flight reads the last known state instead.
   */
  const refresh = async (): Promise<EngineState> => {
    if (probing) return state()
    probing = true
    try {
      const next = await runDesktopStatus()
      if (!disposed) setState(next)
      return next
    } finally {
      probing = false
    }
  }

  onCleanup(() => {
    disposed = true
  })

  /** Polls on a deadline rather than on a timer, so disposal has nothing to cancel */
  const waitForRunning = async (deadlineMs: number = ENGINE_DEADLINE_MS): Promise<boolean> => {
    const until = Date.now() + deadlineMs
    for (;;) {
      if ((await refresh()) === "running") return true
      if (disposed || Date.now() >= until) return false
      await new Promise((resolve) => setTimeout(resolve, ENGINE_TRANSITION_MS))
    }
  }

  void refresh()

  return { state, refresh, waitForRunning }
}

/** The host does not repaint this slot when only a signal changes, so a real change remounts the panel */
function signature(containers: Container[]): string {
  return containers.map((item) => `${item.name}:${item.state}`).join("|")
}

/** A container in a crash loop changes state on every poll and each remount costs a fresh docker ps */
const RELOAD_COOLDOWN_MS = 10000

export function createDockerPolling(onContentChange: () => void, onPoll?: (next: DockerState) => void): DockerPolling {
  const [state, setState] = createSignal<DockerState>(INITIAL)
  let timer: ReturnType<typeof setTimeout> | undefined
  let settle: ReturnType<typeof setTimeout> | undefined
  let disposed = false
  let shown = ""
  let mounted = false
  let reloadedAt = 0

  /**
   * `shown` is what the host has been told, not what was last seen. A change that arrives inside the
   * cooldown has to stay owed rather than be written off, because the signature would match on every
   * later poll and nothing would ever deliver it.
   */
  const apply = (next: DockerState) => {
    if (disposed) return
    if (shouldReconnect(next.kind, streamAlive)) {
      streamAlive = true
      events.restart()
    }
    const visible = keepContainers(state().containers, next)
    setState({ ...next, containers: visible })
    onPoll?.(next)
    if (next.kind === "unavailable" || next.kind === "stale") return
    const current = signature(visible)
    if (!mounted) {
      mounted = true
      shown = current
      return
    }
    if (current === shown) return
    if (Date.now() - reloadedAt < RELOAD_COOLDOWN_MS) return
    shown = current
    reloadedAt = Date.now()
    onContentChange()
  }

  /**
   * One `docker ps` at a time. Events arrive faster than a ps call returns, and without this the older
   * result lands last and overwrites the newer one. A call that arrives while one is in flight asks for
   * one more pass instead of starting a parallel one, the same guard `createEngineProbe` uses.
   */
  let reading = false
  let reread = false
  const refresh = async () => {
    if (reading) {
      reread = true
      return
    }
    reading = true
    try {
      do {
        reread = false
        apply(await runDockerPs())
      } while (reread && !disposed)
    } finally {
      reading = false
    }
  }

  const events = createEventWatch()
  let streamAlive = true
  events.onEvent(() => void refresh())
  events.onDead(() => {
    streamAlive = false
  })

  const tick = async () => {
    await refresh()
    if (disposed) return
    timer = setTimeout(tick, fallbackDelayMs(state().kind))
  }

  void tick()

  onCleanup(() => {
    disposed = true
    if (timer) clearTimeout(timer)
    if (settle) clearTimeout(settle)
    // A docker events process outlives the panel otherwise and stays in the task list
    events.close()
  })

  return {
    state,
    refresh,
    refreshAfterAction: async () => {
      await refresh()
      if (disposed) return
      if (settle) clearTimeout(settle)
      settle = setTimeout(() => void refresh(), SETTLE_MS)
    },
  }
}
