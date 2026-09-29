import { createSignal, onCleanup } from "solid-js"

import { runDockerPs } from "./docker.ts"
import type { Container, DockerState } from "./types.ts"

const INITIAL: DockerState = { kind: "empty", containers: [], detail: "loading" }

export function keepContainers(previous: Container[], next: DockerState): Container[] {
  if (next.kind === "unavailable" || next.kind === "stale") return previous
  return next.containers
}

export function createDockerState(intervalMs: number): () => DockerState {
  const [state, setState] = createSignal<DockerState>(INITIAL)
  let timer: ReturnType<typeof setTimeout> | undefined
  let disposed = false

  const tick = async () => {
    const next = await runDockerPs()
    if (disposed) return
    setState((previous) => ({ ...next, containers: keepContainers(previous.containers, next) }))
    timer = setTimeout(tick, intervalMs)
  }

  void tick()

  onCleanup(() => {
    disposed = true
    if (timer) clearTimeout(timer)
  })

  return state
}
