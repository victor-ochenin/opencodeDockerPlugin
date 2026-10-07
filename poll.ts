import { createSignal, onCleanup } from "solid-js"

import { runDockerPs } from "./docker.ts"
import type { Container, DockerState } from "./types.ts"

const INITIAL: DockerState = { kind: "empty", containers: [], detail: "loading" }

/** docker reports the old state for a moment after start or stop, so an action is polled twice */
const SETTLE_MS = 1200

export function keepContainers(previous: Container[], next: DockerState): Container[] {
  if (next.kind === "unavailable" || next.kind === "stale" || next.kind === "stopped") return previous
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

/** The host does not repaint this slot when only a signal changes, so a real change remounts the panel */
function signature(containers: Container[]): string {
  return containers.map((item) => `${item.name}:${item.state}`).join("|")
}

/** A container in a crash loop changes state on every poll and each remount costs a fresh docker ps */
const RELOAD_COOLDOWN_MS = 10000

export function createDockerPolling(intervalMs: number, onContentChange: () => void, onPoll?: () => void): DockerPolling {
  const [state, setState] = createSignal<DockerState>(INITIAL)
  let timer: ReturnType<typeof setTimeout> | undefined
  let settle: ReturnType<typeof setTimeout> | undefined
  let disposed = false
  let last = ""
  let seen = false
  let reloadedAt = 0

  const refresh = async () => {
    const next = await runDockerPs()
    if (disposed) return
    const visible = keepContainers(state().containers, next)
    setState({ ...next, containers: visible })
    onPoll?.()
    if (next.kind === "unavailable" || next.kind === "stale") return
    const current = signature(visible)
    if (current === last) return
    last = current
    if (!seen) {
      seen = true
      return
    }
    if (Date.now() - reloadedAt < RELOAD_COOLDOWN_MS) return
    reloadedAt = Date.now()
    onContentChange()
  }

  const tick = async () => {
    await refresh()
    if (disposed) return
    timer = setTimeout(tick, intervalMs)
  }

  void tick()

  onCleanup(() => {
    disposed = true
    if (timer) clearTimeout(timer)
    if (settle) clearTimeout(settle)
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
