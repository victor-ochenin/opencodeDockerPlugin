import { Plugin } from "@opencode/plugin/tui"
import { createComponent } from "solid-js"

import { DockerPanel } from "./panel.tsx"

const MIN_INTERVAL = 1000
const MAX_INTERVAL = 60000

export default Plugin.define({
  id: "docker.panel.cli",
  setup(context) {
    const requested = Number(context.options.intervalMs)
    const intervalMs = Number.isFinite(requested) ? Math.min(Math.max(requested, MIN_INTERVAL), MAX_INTERVAL) : 3000
    return context.ui.slot({
      append: "sidebar.content",
      render: () => createComponent(DockerPanel, { intervalMs }),
    })
  },
})
