import { For, Show, createSignal } from "solid-js"
import type { Plugin } from "@opencode/plugin/tui"
import type { ResolvedTheme } from "@opencode/theme/tui"

import { ACTION_LABEL, availableActions, buildArgs, runContainerCommand, type CommandResult } from "./commands.ts"
import { createDockerPolling } from "./poll.ts"
import type { Container, ContainerAction } from "./types.ts"

const MAX_ROWS = 10

function dotColor(theme: ResolvedTheme, state: string) {
  if (state === "running") return theme.text.feedback.success.base
  if (state === "paused" || state === "restarting") return theme.text.feedback.warning.base
  if (state === "dead") return theme.text.feedback.error.base
  return theme.text.muted
}

function detailLabel(container: Container): string {
  const base = container.ports.length > 0 ? container.ports.join("  ") : container.status || container.image
  return container.composeProject ? `${base} · ${container.composeProject}` : base
}

function hasStaleRows(state: { kind: string; containers: Container[] }): boolean {
  return (state.kind === "unavailable" || state.kind === "stale") && state.containers.length > 0
}

export function DockerPanel(props: { intervalMs: number; theme: ResolvedTheme; ui: Plugin.Context["ui"] }) {
  const polling = createDockerPolling(props.intervalMs)
  const [open, setOpen] = createSignal(true)
  const [busy, setBusy] = createSignal(false)
  const theme = () => props.theme

  const report = (container: Container, action: ContainerAction, result: CommandResult) => {
    props.ui.toast.show({
      title: container.name,
      message: result.ok ? `${ACTION_LABEL[action]}: ${result.message}` : result.message,
      variant: result.ok ? "success" : "error",
    })
  }

  const run = async (action: ContainerAction, container: Container) => {
    if (busy()) return
    setBusy(true)
    const result = await runContainerCommand(action, container)
    setBusy(false)
    report(container, action, result)
    void polling.refresh()
  }

  const openMenu = async (container: Container) => {
    if (busy()) return
    const actions = availableActions(container)
    if (actions.length === 0) return
    const action = await props.ui.dialog.select<ContainerAction>({
      title: container.name,
      placeholder: "Action",
      options: actions.map((item) => ({
        title: ACTION_LABEL[item],
        value: item,
        description: item === "down" ? `stops every container of ${container.composeProject}` : container.status,
        footer: buildArgs(item, container).join(" "),
      })),
    })
    if (!action) return
    if (action === "down") {
      const project = container.composeProject
      const confirmed = await props.ui.dialog.confirm({
        title: `Down ${project}?`,
        message: "Removes this project's containers and networks. Volumes are kept. Not reversible from the panel.",
        label: { confirm: "Down", cancel: "Cancel" },
      })
      if (!confirmed) return
    }
    await run(action, container)
  }

  return (
    <box>
      <box flexDirection="row" gap={1} onMouseDown={() => setOpen((value) => !value)}>
        <text fg={theme().text.base}>
          <b>Docker</b>
          <Show when={polling.state().containers.length > 0}>
            <span style={{ fg: theme().text.muted }}> ({polling.state().containers.length})</span>
          </Show>
        </text>
        <Show when={hasStaleRows(polling.state())}>
          <span style={{ fg: theme().text.feedback.warning.base }}>stale</span>
        </Show>
        <Show when={busy()}>
          <span style={{ fg: theme().text.muted }}>working</span>
        </Show>
      </box>

      <Show when={polling.state().containers.length === 0 && polling.state().detail.length > 0}>
        <text fg={theme().text.muted}> {polling.state().detail}</text>
      </Show>

      <Show when={polling.state().containers.length > 0 && open()}>
        <For each={polling.state().containers.slice(0, MAX_ROWS)}>
          {(container) => (
            <box flexDirection="row" gap={1} onMouseDown={() => void openMenu(container)}>
              <text flexShrink={0} fg={dotColor(theme(), container.state)}>
                •
              </text>
              <text fg={theme().text.base} wrapMode="word">
                {container.name}{" "}
                <span style={{ fg: theme().text.muted }}>{detailLabel(container)}</span>
              </text>
            </box>
          )}
        </For>
        <Show when={polling.state().containers.length > MAX_ROWS}>
          <text fg={theme().text.muted}> {polling.state().containers.length - MAX_ROWS} more</text>
        </Show>
      </Show>
    </box>
  )
}
