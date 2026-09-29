import { For, Show, createMemo, createSignal, onCleanup } from "solid-js"
import { usePlugin } from "@opencode/plugin/tui"

import { runDockerPs } from "./docker.ts"
import type { Container, DockerState } from "./types.ts"

const MAX_ROWS = 10
const INITIAL: DockerState = { kind: "empty", containers: [], detail: "loading", at: 0 }

function token(theme: unknown, path: string, fallback: string): string {
  const value = path.split(".").reduce<unknown>((acc, key) => {
    if (typeof acc !== "object" || acc === null) return undefined
    return (acc as Record<string, unknown>)[key]
  }, theme)
  return typeof value === "string" ? value : fallback
}

function stateColor(theme: unknown, state: string): string {
  if (state === "running") return token(theme, "success", "green")
  if (state === "paused" || state === "restarting") return token(theme, "warning", "yellow")
  return token(theme, "text.muted", "gray")
}

function detailLabel(container: Container): string {
  if (container.ports.length > 0) return container.ports.join("  ")
  return container.status || container.image
}

export function DockerPanel(props: { intervalMs: number }) {
  const context = usePlugin()
  const [state, setState] = createSignal<DockerState>(INITIAL)
  const [known, setKnown] = createSignal<Container[]>([])
  const [open, setOpen] = createSignal(true)

  const rows = createMemo(() => (state().containers.length > 0 ? state().containers : known()))
  const isStale = createMemo(() => state().kind === "stale" && known().length > 0)

  let timer: ReturnType<typeof setInterval> | undefined
  let stopped = false

  const refresh = async () => {
    const next = await runDockerPs()
    if (stopped) return
    if (next.containers.length > 0) setKnown(next.containers)
    setState(next)
  }

  void refresh().then(() => {
    if (stopped) return
    timer = setInterval(() => void refresh(), props.intervalMs)
  })

  onCleanup(() => {
    stopped = true
    if (timer) clearInterval(timer)
  })

  return (
    <box>
      <box flexDirection="row" gap={1} onMouseDown={() => setOpen((value) => !value)}>
        <text fg={token(context.theme, "text.base", "white")}>
          <b>Docker</b>
          <Show when={rows().length > 0}>
            <span style={{ fg: token(context.theme, "text.muted", "gray") }}> ({rows().length})</span>
          </Show>
        </text>
        <Show when={isStale()}>
          <span style={{ fg: token(context.theme, "warning", "yellow") }}>stale</span>
        </Show>
      </box>

      <Show when={state().kind === "unavailable"}>
        <text fg={token(context.theme, "text.muted", "gray")}> {state().detail}</text>
      </Show>
      <Show when={state().kind === "ok" && rows().length === 0}>
        <text fg={token(context.theme, "text.muted", "gray")}> no containers</text>
      </Show>

      <Show when={rows().length > 0 && open()}>
        <For each={rows().slice(0, MAX_ROWS)}>
          {(container) => (
            <box flexDirection="row" gap={1}>
              <text flexShrink={0} fg={stateColor(context.theme, container.state)}>
                •
              </text>
              <text fg={token(context.theme, "text.base", "white")} wrapMode="word">
                {container.name}{" "}
                <span style={{ fg: token(context.theme, "text.muted", "gray") }}>{detailLabel(container)}</span>
              </text>
            </box>
          )}
        </For>
        <Show when={rows().length > MAX_ROWS}>
          <text fg={token(context.theme, "text.muted", "gray")}> {rows().length - MAX_ROWS} more</text>
        </Show>
      </Show>
    </box>
  )
}
