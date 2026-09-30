import { createSignal, onCleanup } from "solid-js"

import { runDockerPs } from "./docker.ts"
import type { Container, DockerState } from "./types.ts"

const INITIAL: DockerState = { kind: "empty", containers: [], detail: "loading" }

/** docker reports the old state for a moment after start or stop, so an action is polled twice. */
const SETTLE_MS = 1200

export function keepContainers(previous: Container[], next: DockerState): Container[] {
  if (next.kind === "unavailable" || next.kind === "stale") return previous
  return next.containers
}

export interface DockerPolling {
  readonly state: () => DockerState
  readonly refresh: () => Promise<void>
  readonly refreshAfterAction: () => Promise<void>
}

/** The host does not repaint this slot when only a signal changes, so the panel is remounted on a real change. */
function signature(containers: Container[]): string {
  return containers.map((item) => `${item.name}:${item.state}`).join("|")
}

/** A container in a crash loop changes state on every poll, and each remount costs a fresh docker ps. */
const RELOAD_COOLDOWN_MS = 10000

export function createDockerPolling(intervalMs: number, onContentChange: () => void): DockerPolling {
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
