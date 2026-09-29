import { DockerPanel } from "./panel.tsx"

const MIN_INTERVAL = 1000
const MAX_INTERVAL = 60000

interface SlotApi {
  options?: Record<string, unknown>
  theme?: unknown
  ui: {
    slot(input: { append: string; render: (ctx: { sessionID?: string }) => unknown }): (() => void) | void
  }
}

export default {
  id: "docker.panel.cli",
  setup(api: SlotApi) {
    const requested = Number(api.options?.intervalMs)
    const intervalMs = Number.isFinite(requested)
      ? Math.min(Math.max(requested, MIN_INTERVAL), MAX_INTERVAL)
      : 3000
    return api.ui.slot({
      append: "sidebar.content",
      render: () => <DockerPanel intervalMs={intervalMs} theme={api.theme} />,
    })
  },
}