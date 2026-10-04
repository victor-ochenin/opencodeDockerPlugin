/**
 * Smoke test for the published artifact.
 *
 * The failure this guards against is specific and expensive: under `node_modules` the host's Solid
 * transform never runs, so a stray `.tsx` or a stale relative specifier only shows up as a TUI
 * crash at runtime. Importing the built entry and driving `setup` against a stub context catches
 * both here instead.
 */
import { pathToFileURL } from "node:url"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const entry = join(root, "dist", "tui.js")

const module = await import(pathToFileURL(entry).href)
const plugin = module.default

if (typeof plugin?.setup !== "function") throw new Error("dist/tui.js must default-export a plugin with setup()")
if (plugin.id !== "docker.panel.cli") throw new Error(`unexpected plugin id: ${plugin.id}`)

const slots: { append?: string; render: unknown }[] = []

const context = {
  options: { intervalMs: 3000 },
  location: { directory: root },
  storage: {
    store: (_key: string, options: { initial: { names: string[] } }) => [
      options.initial.names,
      async (update: (draft: { names: string[] }) => void) => update({ names: [] }),
    ],
  },
  theme: {},
  ui: {
    slot: (claim: { append?: string; render: unknown }) => {
      slots.push(claim)
      return () => slots.pop()
    },
  },
}

const dispose = plugin.setup(context as never)

if (slots.length !== 1) throw new Error(`expected one slot claim, got ${slots.length}`)
if (slots[0]?.append !== "sidebar.content") throw new Error("slot must append to sidebar.content")
if (typeof slots[0]?.render !== "function") throw new Error("slot claim must carry a render function")

dispose?.()

if (slots.length > 0) throw new Error("setup's cleanup must release the slot")

console.log("built plugin: dist/tui.js imports, registers sidebar.content, releases it on cleanup")