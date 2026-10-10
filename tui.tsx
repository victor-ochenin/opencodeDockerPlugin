import type { Plugin } from "@opencode/plugin/tui"

import { DockerPanel } from "./panel.tsx"

const plugin: Plugin.Definition = {
  id: "docker.panel.cli",
  setup(context) {
    const agentDir = context.location?.directory ?? process.cwd()
    const [pinned, setPinned] = context.storage.store("docker-panel.pinned", { initial: { names: [] as string[] } })
    let dispose: (() => void) | undefined

    /** Durable storage is the host's own, so a pin outlives the TUI without this plugin owning a user file */
    async function togglePin(name: string): Promise<void> {
      await setPinned((draft) => {
        const index = draft.names.indexOf(name)
        if (index >= 0) draft.names.splice(index, 1)
        else draft.names.push(name)
      })
    }

    /** Drops the claim and registers it again, the only way to make the host paint the slot anew */
    function reload() {
      queueMicrotask(() => {
        dispose?.()
        dispose = context.ui.slot(claim)
      })
    }

    const claim = {
      append: "sidebar.content",
      render: () => (
        <DockerPanel
          agentDir={agentDir}
          pinned={pinned.names}
          onTogglePin={togglePin}
          theme={context.theme}
          ui={context.ui}
          reload={reload}
        />
      ),
    } as const

    dispose = context.ui.slot(claim)
    return () => dispose?.()
  },
}

export default plugin
