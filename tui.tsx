import { DockerPanel, type ThemeLike } from "./panel.tsx"

const MIN_INTERVAL = 1000
const MAX_INTERVAL = 60000

interface SlotApi {
  options?: Record<string, unknown>
  theme?: ThemeLike
  ui: {
    slot(input: { append: string; render: (ctx: { sessionID?: string }) => unknown }): (() => void) | void
  }
}

export default {
  id: "docker.panel.cli",
  setup(api: SlotApi) {
    const host = api as Partial<SlotApi>
    if (typeof host.ui?.slot !== "function") {
      throw new Error("docker panel: the host does not expose context.ui.slot(), so this OpenCode 2 build is unsupported")
    }
    const requested = Number(host.options?.intervalMs)
    const intervalMs = Number.isFinite(requested) ? Math.min(Math.max(requested, MIN_INTERVAL), MAX_INTERVAL) : 3000
    return host.ui.slot({
      append: "sidebar.content",
      render: () => <DockerPanel intervalMs={intervalMs} theme={host.theme ?? {}} />,
    })
  },
}
