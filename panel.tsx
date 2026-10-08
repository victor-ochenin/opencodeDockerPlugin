import { Index, Show, createEffect, createSignal, onCleanup } from "solid-js"
import type { Plugin } from "@opencode/plugin/tui"
import type { ResolvedTheme } from "@opencode/theme/tui"

import { ACTION_LABEL, availableActions, buildArgs, runDockerArgs } from "./commands.ts"
import { findComposeFile, type ComposeTarget } from "./compose.ts"
import { runDockerLogs, type LogLevel, type LogResult } from "./logs.ts"
import { createDockerPolling, createEngineProbe, selectRows } from "./poll.ts"
import { ENGINE_ACTION_LABEL, buildRuntimeArgs, type RuntimeAction } from "./runtime.ts"
import type { Container, ContainerAction } from "./types.ts"

const LOG_VIEW_LINES = 15
const LOG_REFRESH_MS = 2000

/** One source for the argv, so the menu footer and the run cannot drift apart */
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

/** Fixed viewport: opentui has no scrollable container, so the height has to be predictable */
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
  const [stopping, setStopping] = createSignal(false)
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

  const engine = createEngineProbe()
  // The probe only has to be re-read when the poll changes its verdict: an available docker proves the
  // engine answers, and a probe on every poll would stack several four second calls on the same pipe,
  // while never re-reading it would leave a stale stopped engine once docker starts from the tray
  let lastKind = ""
  const polling = createDockerPolling(props.intervalMs, props.reload, (next) => {
    refreshStack()
    if (next.kind === lastKind) return
    lastKind = next.kind
    void engine.refresh()
  })

  // A stop the container poll could see beats a probe that has not answered yet: the poll knows the
  // Desktop pipe is missing in a quarter second, the probe needs four seconds to admit the same
  const engineDown = () => polling.state().kind === "stopped" || engine.state() === "stopped"

  // Read on mount and on every poll, never while the host assembles the render tree
  const [stackSignal, setStackSignal] = createSignal<ComposeTarget | null>(null)
  const [pendingStack, setPendingStack] = createSignal<ComposeTarget | null>(null)
  const derivePendingStack = (stack: ComposeTarget | null) => {
    setPendingStack(
      stack && !engineDown() && !polling.state().containers.some((item) => item.composeProject === stack.project)
        ? stack
        : null,
    )
  }
  const refreshStack = () => {
    const stack = findComposeFile(props.agentDir)
    setStackSignal(stack)
    derivePendingStack(stack)
  }

  // A stopped engine makes every `docker logs` call fail, so the window keeps its last lines and the
  // polling stops rather than spawning a doomed process every two seconds
  createEffect(() => {
    const state = engine.state()
    if (state === "stopped" || state === "absent") {
      if (logTimer) clearInterval(logTimer)
      logTimer = undefined
    }
  })

  /** Single entry point, so the busy guard and the refresh cannot be skipped */
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

  type ListChoice =
    | { readonly kind: "container"; readonly container: Container }
    | { readonly kind: "action"; readonly action: RuntimeAction }

  /**
   * Opens the same actions for a container the sidebar does not show, and carries the one engine
   * action last.
   *
   * The engine entry stays available with no containers at all, because that is exactly when Docker is
   * down and it is the only way to turn it back on.
   */
  const pickContainer = async (all: readonly Container[]) => {
    const action = engine.state() === "running" ? ("engine-stop" as RuntimeAction) : undefined
    const pending = props.ui.dialog.select<ListChoice>({
      title: `All containers (${all.length})`,
      placeholder: "Container",
      options: [
        ...all.map((container) => ({
          title: container.name,
          value: { kind: "container", container } as ListChoice,
          description: detailLabel(container, props.pinned),
          footer: container.state,
        })),
        ...(action
          ? [
              {
                title: ENGINE_ACTION_LABEL[action],
                value: { kind: "action", action } as ListChoice,
                description: "stops every container of every project",
                footer: `docker ${buildRuntimeArgs(action).join(" ")}`,
              },
            ]
          : []),
      ],
    })
    props.ui.dialog.set({ size: "large" })
    const choice = await pending
    if (!choice) return
    if (choice.kind === "action") {
      await runRuntime(choice.action)
      return
    }
    // The list is a snapshot, a container can stop while it is open, so re-read before acting
    const fresh = polling.state().containers.find((item) => item.name === choice.container.name)
    if (fresh) await openMenu(fresh)
  }

  /** Single door to the containers the sidebar does not show, so the header opens the list itself */
  const openBrowse = async () => {
    if (busy()) return
    await pickContainer(polling.state().containers)
  }

  /**
   * Both engine actions ask first, and Stop names what it is about to end.
   *
   * Start confirms too: it brings up a virtual machine and starts consuming memory, so a misclick is
   * not free even though nothing is running that it would interrupt.
   */
  const runRuntime = async (action: RuntimeAction) => {
    if (busy()) return
    const args = buildRuntimeArgs(action)
    const title = ENGINE_ACTION_LABEL[action]
    if (action === "engine-stop") {
      const running = polling.state().containers.filter((item) => item.state === "running")
      const names = running.length > 0 ? running.map((item) => item.name).join(", ") : "nothing the panel knows about"
      const confirmed = await props.ui.dialog.confirm({
        title: "Stop Docker Desktop?",
        message: `Stops the engine, so every container stops with it. Visible to the panel: ${names}.\n\nNot reversible from the panel.`,
        label: { confirm: "Stop", cancel: "Cancel" },
      })
      if (!confirmed) return
    } else {
      const confirmed = await props.ui.dialog.confirm({
        title: "Start Docker Desktop?",
        message: `Brings up the engine and its virtual machine.\n\ndocker ${args.join(" ")}`,
        label: { confirm: "Start", cancel: "Cancel" },
      })
      if (!confirmed) return
    }
    // The containers are about to go, so the rows go with them instead of staying on screen for a
    // poll or two while the engine finishes shutting down
    if (action === "engine-stop") setStopping(true)
    setBusy(true)
    try {
      const result = await runDockerArgs(args)
      props.ui.toast.show({
        title,
        message: result.ok ? `${title}: ${result.message}` : result.message,
        variant: result.ok ? "success" : "error",
      })
      // busy stays on for the whole transition, otherwise working disappears while the VM boots
      // A command that failed will never bring the engine up, and waiting for one costs two minutes
      if (action === "engine-start" && result.ok) await engine.waitForRunning()
      await polling.refreshAfterAction()
    } finally {
      setStopping(false)
      setBusy(false)
    }
  }

  /** A stack has no container to act on and its file carries build and command lines, so confirm with the exact argv */
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
    // Read once per menu, compose can build images and the action must not wait on a second read
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
        description: isPinned
          ? "put this container back under the row limit"
          : "keep this container visible whatever the limit",
        footer: "stored by the host, survives a restart",
      },
    ]
    try {
      const pending = props.ui.dialog.select<MenuChoice>({ title: container.name, placeholder: "Action", options })
      props.ui.dialog.set({ size: "large" })
      const choice = await pending
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
  // next mouse event it sees, so every dialog is armed on the release and mounted after it propagates
  const arm = (open: () => void, event: { stopPropagation: () => void }) => {
    event.stopPropagation()
    setTimeout(() => void open(), 0)
  }

  const visible = () => (stopping() ? [] : selectRows(polling.state().containers, props.pinned))
  const hasRows = () => visible().length > 0
  const hidden = () => Math.max(0, polling.state().containers.length - visible().length)
  // The line stays when nothing is hidden because it is also the only way into the list, which is where
  // stopping the engine lives
  const browseLabel = () =>
    hidden() > 0
      ? `${hidden()} more, click for all`
      : `${polling.state().containers.length} container${polling.state().containers.length === 1 ? "" : "s"}, click for all`

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
          <Show when={!stopping() && polling.state().containers.length > 0}>
            <span style={{ fg: theme().text.muted }}> ({polling.state().containers.length})</span>
          </Show>
        </text>
        <Show when={hasStaleRows(polling.state())}>
          <text fg={theme().text.feedback.warning.base}> stale</text>
        </Show>
        <Show when={busy()}>
          <text fg={theme().text.muted}> working</text>
        </Show>
      </box>

      <Show when={!stopping() && !hasRows() && polling.state().containers.length > 0}>
        <text fg={theme().text.muted} onMouseUp={(event) => arm(openBrowse, event)}>
          {" "}
          click for the list
        </text>
      </Show>

      <Show when={engineDown() && !busy()}>
        <text fg={theme().text.base} onMouseUp={(event) => arm(() => void runRuntime("engine-start"), event)}>
          <b>Start Docker Desktop</b>
          <span style={{ fg: theme().text.muted }}> · click to start</span>
        </text>
      </Show>

      <Show when={!engineDown() && polling.state().containers.length === 0 && polling.state().detail.length > 0}>
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
        <Show when={hasRows()}>
          <text fg={theme().text.muted} onMouseUp={(event) => arm(openBrowse, event)}>
            {" "}
            {browseLabel()}
          </text>
        </Show>
      </Show>

      <Show when={pendingStack() && !engineDown()}>
        <text fg={theme().text.base} onMouseUp={(event) => arm(() => void openStack(), event)}>
          <b>Up stack</b>
          <span style={{ fg: theme().text.muted }}> · {pendingStack()?.project} is not running here</span>
        </text>
      </Show>
    </box>
  )
}
