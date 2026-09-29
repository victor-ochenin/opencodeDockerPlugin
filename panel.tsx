import { For, Show, createSignal } from "solid-js"

import { createDockerState } from "./poll.ts"
import type { Container, DockerState } from "./types.ts"

const MAX_ROWS = 10

type ColorName = "base" | "muted" | "success" | "warning"

const FALLBACK: Record<ColorName, string> = { base: "white", muted: "gray", success: "green", warning: "yellow" }

export interface ThemeLike {
  text?: { base?: string; muted?: string }
  success?: string
  warning?: string
}

function fg(theme: ThemeLike, name: ColorName): string {
  const value = name === "base" || name === "muted" ? theme.text?.[name] : theme[name]
  return value ?? FALLBACK[name]
}

function stateColor(theme: ThemeLike, state: string): string {
  if (state === "running") return fg(theme, "success")
  if (state === "paused" || state === "restarting") return fg(theme, "warning")
  return fg(theme, "muted")
}

function detailLabel(container: Container): string {
  if (container.ports.length > 0) return container.ports.join("  ")
  return container.status || container.image
}

function hasStaleRows(state: DockerState): boolean {
  return (state.kind === "unavailable" || state.kind === "stale") && state.containers.length > 0
}

export function DockerPanel(props: { intervalMs: number; theme: ThemeLike }) {
  const state = createDockerState(props.intervalMs)
  const [open, setOpen] = createSignal(true)

  return (
    <box>
      <box flexDirection="row" gap={1} onMouseDown={() => setOpen((value) => !value)}>
        <text fg={fg(props.theme, "base")}>
          <b>Docker</b>
          <Show when={state().containers.length > 0}>
            <span style={{ fg: fg(props.theme, "muted") }}> ({state().containers.length})</span>
          </Show>
        </text>
        <Show when={hasStaleRows(state())}>
          <span style={{ fg: fg(props.theme, "warning") }}>stale</span>
        </Show>
      </box>

      <Show when={state().containers.length === 0 && state().detail.length > 0}>
        <text fg={fg(props.theme, "muted")}> {state().detail}</text>
      </Show>

      <Show when={state().containers.length > 0 && open()}>
        <For each={state().containers.slice(0, MAX_ROWS)}>
          {(container) => (
            <box flexDirection="row" gap={1}>
              <text flexShrink={0} fg={stateColor(props.theme, container.state)}>
                •
              </text>
              <text fg={fg(props.theme, "base")} wrapMode="word">
                {container.name}{" "}
                <span style={{ fg: fg(props.theme, "muted") }}>{detailLabel(container)}</span>
              </text>
            </box>
          )}
        </For>
        <Show when={state().containers.length > MAX_ROWS}>
          <text fg={fg(props.theme, "muted")}> {state().containers.length - MAX_ROWS} more</text>
        </Show>
      </Show>
    </box>
  )
}
