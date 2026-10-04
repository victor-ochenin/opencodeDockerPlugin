import { Index, Show, createSignal, onCleanup } from "solid-js"
import type { Plugin } from "@opencode/plugin/tui"
import type { ResolvedTheme } from "@opencode/theme/tui"

import { ACTION_LABEL, availableActions, buildArgs, runDockerArgs } from "./commands.ts"
import { findComposeFile, type ComposeTarget } from "./compose.ts"
import { runDockerLogs, type LogLevel, type LogResult } from "./logs.ts"
import { createDockerPolling, selectRows } from "./poll.ts"
import type { Container, ContainerAction } from "./types.ts"

const LOG_VIEW_LINES = 15
const LOG_REFRESH_MS = 2000

/** The argv a stack needs, in one place so the menu footer and the run cannot drift apart. */
function stackArgs(target: ComposeTarget): string[] {
  return ["compose", "-f", target.file, "-p", target.project, "up", "-d"]
}

type MenuChoice = ContainerAction | "logs" | "pin"

interface ScrollEvent {
  readonly scroll?: { readonly direction: string; readonly delta: number }
}

function dotColor(theme: ResolvedTheme, state: string) {
  if (state === "running") return theme.text.feedback.success.base
  if (state === "paused" || state === "restarting") return theme.text.feedback.warning.base
  if (state === "dead") return theme.text.feedback.error.base
  return theme.text.muted
}

function levelColor(theme: ResolvedTheme, level: LogLevel) {
  if (level === "error") return theme.text.feedback.error.base
  if (level === "warn") return theme.text.feedback.warning.base
  return theme.text.muted
}

function detailLabel(container: Container, pinned: string[]): string {
  const base = container.ports.length > 0 ? container.ports.join("  ") : container.status || container.image
  return [base, container.composeProject, pinned.includes(container.name) ? "pinned" : ""].filter(Boolean).join(" · ")
}

function hasStaleRows(state: { kind: string; containers: Container[] }): boolean {
  return (state.kind === "unavailable" || state.kind === "stale") && state.containers.length > 0
}

/** A fixed viewport is the only way to keep the height predictable: opentui has no scrollable container. */
function LogsView(props: {
  name: string
  result: LogResult | null
  theme: ResolvedTheme
  offset: number
  onScroll: (event: ScrollEvent) => void
  onClose: () => void
}) {
  const lines = () => props.result?.lines ?? []
  const end = () => Math.max(0, lines().length - props.offset)
  const window = () => lines().slice(Math.max(0, end() - LOG_VIEW_LINES), end())

  return (
    <box flexDirection="column">
      <text fg={props.theme.text.muted}> docker logs --tail 200 -- {props.name} </text>
      <Show when={props.result?.error}>
        <text fg={props.theme.text.feedback.error.base}> {props.result?.error ?? ""}</text>
      </Show>
      <Show when={props.result && !props.result.error && lines().length === 0}>
        <text fg={props.theme.text.muted}> no output</text>
      </Show>
      <Show when={!props.result}>
        <text fg={props.theme.text.muted}> reading logs</text>
      </Show>
      <box
        flexDirection="column"
        onMouseScroll={(event) => {
          event.stopPropagation()
          props.onScroll(event)
        }}
      >
        <Index each={window()}>
          {(line) => (
            <text fg={props.theme.text.base}>
              <span style={{ fg: props.theme.text.muted }}>{line().time.slice(11, 19)} </span>
              <span style={{ fg: levelColor(props.theme, line().level) }}>{line().text}</span>
            </text>
          )}
        </Index>
      </box>
      <text
        fg={props.theme.text.muted}
        onMouseUp={(event) => {
          event.stopPropagation()
          props.onClose()
        }}
      >
        {" "}
        {lines().length} lines{end() < lines().length ? `, at ${end()}` : ""} · wheel scrolls · esc or click to close
      </text>
    </box>
  )
}

export function DockerPanel(props: {
  intervalMs: number
  agentDir: string
  pinned: string[]
  onTogglePin: (name: string) => Promise<void>
  theme: ResolvedTheme
  ui: Plugin.Context["ui"]
  reload: () => void
}) {
  const [open, setOpen] = createSignal(true)
  const [busy, setBusy] = createSignal(false)
  const [logs, setLogs] = createSignal<{ name: string; result: LogResult | null } | null>(null)
  const [offset, setOffset] = createSignal(0)
  const theme = () => props.theme
  let logTimer: ReturnType<typeof setInterval> | undefined

  const stopLogs = () => {
    if (logTimer) clearInterval(logTimer)
    logTimer = undefined
    setLogs(null)
    setOffset(0)
  }

  const loadLogs = async (name: string) => {
    const result = await runDockerLogs(name)
    if (logs()?.name !== name) return
    setLogs({ name, result })
  }

  const scrollLogs = (event: ScrollEvent) => {
    const scroll = event.scroll
    if (!scroll || (scroll.direction !== "up" && scroll.direction !== "down")) return
    const total = logs()?.result?.lines.length ?? 0
    const max = Math.max(0, total - LOG_VIEW_LINES)
    const step = Math.max(1, scroll.delta)
    setOffset((current) => Math.min(max, Math.max(0, current + (scroll.direction === "up" ? step : -step))))
  }

  const openLogs = (container: Container) => {
    if (logTimer) clearInterval(logTimer)
    setOffset(0)
    setLogs({ name: container.name, result: null })
    void loadLogs(container.name)
    logTimer = setInterval(() => void loadLogs(container.name), LOG_REFRESH_MS)
    const view = () => (
      <LogsView
        name={container.name}
        result={logs()?.result ?? null}
        theme={props.theme}
        offset={offset()}
        onScroll={scrollLogs}
        onClose={() => props.ui.dialog.clear()}
      />
    )
    props.ui.dialog.show(view, stopLogs)
    props.ui.dialog.set({ size: "large", centered: true })
  }

  onCleanup(() => {
    if (logTimer) clearInterval(logTimer)
    if (logs()) props.ui.dialog.clear()
  })

  // Read the compose file when the panel mounts and again on every poll, never while the host is
  // assembling the render tree.
  const [stackSignal, setStackSignal] = createSignal<ComposeTarget | null>(null)
  const [pendingStack, setPendingStack] = createSignal<ComposeTarget | null>(null)
  const derivePendingStack = (stack: ComposeTarget | null) => {
    setPendingStack(
      stack && !polling.state().containers.some((item) => item.composeProject === stack.project) ? stack : null,
    )
  }
  const refreshStack = () => {
    const stack = findComposeFile(props.agentDir)
    setStackSignal(stack)
    derivePendingStack(stack)
  }
  const polling = createDockerPolling(props.intervalMs, props.reload, refreshStack)

  /** One entry point for every action, so the busy guard and the refresh cannot be forgotten. */
  const run = async (action: ContainerAction, title: string, args: readonly string[]) => {
    if (busy()) return
    setBusy(true)
    const result = await runDockerArgs(args)
    setBusy(false)
    props.ui.toast.show({
      title,
      message: result.ok ? `${ACTION_LABEL[action]}: ${result.message}` : result.message,
      variant: result.ok ? "success" : "error",
    })
    await polling.refreshAfterAction()
  }

  /**
   * The stack the agent directory declares, but only while none of its containers is on the machine.
   * Computed once per poll instead of inside the markup: a `Show` and its own label both read this,
   * and re-deriving it during render is what the crash traced back to.
   */

  /** The list of every container, from which picking one opens the same actions as its row does. */
  const pickContainer = async (all: readonly Container[]) => {
    const choice = await props.ui.dialog.select<Container>({
      title: `All containers (${all.length})`,
      placeholder: "Container",
      options: all.map((container) => ({
        title: container.name,
        value: container,
        description: detailLabel(container, props.pinned),
        footer: container.state,
      })),
    })
    if (!choice) return
    // The list is a snapshot: a container can stop while it is open, so re-read it before offering actions.
    const fresh = polling.state().containers.find((item) => item.name === choice.name)
    if (fresh) await openMenu(fresh)
  }

  /**
   * The single door to the containers the sidebar does not show. Clicking the header lands on the
   * list itself, so there is no menu to pick through first.
   */
  const openBrowse = async () => {
    if (busy()) return
    const all = polling.state().containers
    if (all.length === 0) {
      props.ui.toast.show({ title: "Docker", message: "no containers", variant: "info" })
      return
    }
    await pickContainer(all)
  }

  /**
   * A stack has no container to be the subject of the action, and its file carries build, command and
   * entrypoint, so it asks once and shows the exact argv in the prompt.
   */
  const openStack = async () => {
    if (busy()) return
    const stack = pendingStack()
    if (!stack) return
    const confirmed = await props.ui.dialog.confirm({
      title: `Up ${stack.project}?`,
      message: `Starts every service of this compose project from ${stack.file}:\n\n${stackArgs(stack).join(" ")}`,
      label: { confirm: "Up stack", cancel: "Cancel" },
    })
    if (!confirmed) return
    await run("up", stack.project, stackArgs(stack))
  }

  const openMenu = async (container: Container) => {
    if (busy()) return
    const isPinned = props.pinned.includes(container.name)
    // Read once per menu: compose can build images, so the action must not wait on a second read.
    const stack = stackSignal()?.project === container.composeProject ? stackSignal() : null
    const options = [
      ...availableActions(container, stack).map((item) => ({
        title: ACTION_LABEL[item],
        value: item as MenuChoice,
        description:
          item === "down"
            ? `stops every container of ${container.composeProject}`
            : item === "up"
              ? `starts every service of ${stack?.project} from the agent directory`
              : container.status,
        footer: buildArgs(item, container, stack).join(" "),
      })),
      {
        title: "Logs",
        value: "logs" as MenuChoice,
        description: "read the last 200 log lines in the sidebar",
        footer: `docker logs --tail 200 -- ${container.name}`,
      },
      {
        title: isPinned ? "Unpin" : "Pin",
        value: "pin" as MenuChoice,
        description: isPinned ? "put this container back under the row limit" : "keep this container visible whatever the limit",
        footer: "stored by the host, survives a restart",
      },
    ]
    try {
      const choice = await props.ui.dialog.select<MenuChoice>({ title: container.name, placeholder: "Action", options })
      if (!choice) return
      if (choice === "logs") {
        openLogs(container)
        return
      }
      if (choice === "pin") {
        await props.onTogglePin(container.name)
        props.ui.toast.show({
          title: container.name,
          message: isPinned ? "Unpinned: back under the row limit" : "Pinned: shown whatever the row limit",
        })
        return
      }
      if (choice === "down") {
        const project = container.composeProject
        const confirmed = await props.ui.dialog.confirm({
          title: `Down ${project}?`,
          message: "Removes this project's containers and networks. Volumes are kept. Not reversible from the panel.",
          label: { confirm: "Down", cancel: "Cancel" },
        })
        if (!confirmed) return
      }
      await run(choice, container.name, buildArgs(choice, container, stack))
    } catch (error) {
      props.ui.toast.show({
        title: container.name,
        message: `action failed: ${error instanceof Error ? error.message : String(error)}`,
        variant: "error",
      })
    }
  }


  // A click in opentui is a mousedown plus a mouseup, and the host dismisses an overlay from the
  // next mouse event it sees. Every dialog is therefore armed on the release, and only mounted after
  // that release has finished propagating, so the release cannot land on its own backdrop.
  const arm = (open: () => void, event: { stopPropagation: () => void }) => {
    event.stopPropagation()
    setTimeout(() => void open(), 0)
  }

  const visible = () => selectRows(polling.state().containers, props.pinned)
  const hasRows = () => visible().length > 0

  const pressHeader = () => {
    if (hasRows()) {
      setOpen((value) => !value)
      return
    }
    void openBrowse()
  }

  return (
    <box>
      <box flexDirection="row" gap={1} onMouseUp={(event) => arm(pressHeader, event)}>
        <text fg={theme().text.base}>
          <b>Docker</b>
          <Show when={polling.state().containers.length > 0}>
            <span style={{ fg: theme().text.muted }}> ({polling.state().containers.length})</span>
          </Show>
          <Show when={!hasRows() && polling.state().containers.length > 0}>
            <span style={{ fg: theme().text.muted }}> click for the list</span>
          </Show>
        </text>
        <Show when={hasStaleRows(polling.state())}>
          <text fg={theme().text.feedback.warning.base}> stale</text>
        </Show>
        <Show when={busy()}>
          <text fg={theme().text.muted}> working</text>
        </Show>
      </box>

      <Show when={polling.state().containers.length === 0 && polling.state().detail.length > 0}>
        <text fg={theme().text.muted}> {polling.state().detail}</text>
      </Show>

      <Show when={polling.state().containers.length > 0 && open()}>
        <Index each={visible()}>
          {(container) => (
            <box flexDirection="row" gap={1} onMouseUp={(event) => arm(() => openMenu(container()), event)}>
              <text flexShrink={0} fg={dotColor(theme(), container().state)}>
                •
              </text>
              <text fg={theme().text.base} wrapMode="word">
                {container().name}{" "}
                <span style={{ fg: theme().text.muted }}>{detailLabel(container(), props.pinned)}</span>
              </text>
            </box>
          )}
        </Index>
        <Show when={hasRows() && polling.state().containers.length > visible().length}>
          <text fg={theme().text.muted} onMouseUp={(event) => arm(openBrowse, event)}>
            {" "}
            {polling.state().containers.length - visible().length} more, click for all
          </text>
        </Show>
      </Show>

      <Show when={pendingStack()}>
        <text fg={theme().text.base} onMouseUp={(event) => arm(() => void openStack(), event)}>
          <b>Up stack</b>
          <span style={{ fg: theme().text.muted }}> · {pendingStack()?.project} is not running here</span>
        </text>
      </Show>
    </box>
  )
}
