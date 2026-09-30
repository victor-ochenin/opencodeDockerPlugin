import { DockerPanel } from "./panel.tsx"
import type { Plugin } from "@opencode/plugin/tui"

const MIN_INTERVAL = 1000
const MAX_INTERVAL = 60000

const plugin: Plugin.Definition = {
  id: "docker.panel.cli",
  setup(context) {
    const requested = Number(context.options.intervalMs)
    const intervalMs = Number.isFinite(requested) ? Math.min(Math.max(requested, MIN_INTERVAL), MAX_INTERVAL) : 3000
    return context.ui.slot({
      append: "sidebar.content",
      render: () => <DockerPanel intervalMs={intervalMs} theme={context.theme} ui={context.ui} />,
    })
  },
}

export default plugin
