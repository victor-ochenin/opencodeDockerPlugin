import type { Plugin } from "@opencode/plugin/tui"

import { DockerPanel } from "./panel.tsx"

const MIN_INTERVAL = 1000
const MAX_INTERVAL = 60000

const plugin: Plugin.Definition = {
  id: "docker.panel.cli",
  setup(context) {
    const requested = Number(context.options.intervalMs)
    const intervalMs = Number.isFinite(requested) ? Math.min(Math.max(requested, MIN_INTERVAL), MAX_INTERVAL) : 3000
    let dispose: (() => void) | undefined

    /** Drops the current claim and registers it again, which is the only way to make the host paint the slot anew. */
    function reload() {
      queueMicrotask(() => {
        dispose?.()
        dispose = context.ui.slot(claim)
      })
    }

    const claim = {
      append: "sidebar.content",
      render: () => <DockerPanel intervalMs={intervalMs} theme={context.theme} ui={context.ui} reload={reload} />,
    } as const

    dispose = context.ui.slot(claim)
    return () => dispose?.()
  },
}

export default plugin
