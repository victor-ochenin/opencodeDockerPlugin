/**
 * Precompiles the plugin to ESM in `dist/`.
 *
 * The TUI host transpiles plugin sources with OpenTUI's Solid transform, whose filter excludes
 * every path under `node_modules`: `^(?!.*[/\\]node_modules[/\\]).*\.[cm]?[jt]sx$`. A plugin
 * installed from npm lives under `node_modules`, so the transform never fires and Bun falls back
 * to its default JSX runtime, which is React's. OpenTUI's own docs prescribe the fix: publish
 * precompiled ESM. See `docs/research/opencode-plugin-loader.md` for the full chain.
 *
 * Files are transpiled one to one and keep their layout. Nothing is bundled, because bundling
 * relocates `import.meta.url` and breaks plugin-relative assets (upstream opencode#39986 rejected
 * a `Bun.build` approach for exactly that).
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import babel from "@babel/core"
import solidPreset from "babel-preset-solid"
import typescriptPreset from "@babel/preset-typescript"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const out = join(root, "dist")

/** Same options OpenTUI's own transform uses, so the output matches what the host would produce. */
const presets = [
  [solidPreset, { moduleName: "@opentui/solid", generate: "universal" }],
  [typescriptPreset],
]

/** Sources import each other with explicit extensions, which have to point at the emitted `.js`. */
const rewriteSpecifiers = (code: string) => code.replace(/((?:from|import)\s*["'])(\.{1,2}\/[^"']+?)\.tsx?(["'])/g, "$1$2.js$3")

async function build() {
  const entries = (await readdir(root)).filter((name) => name.endsWith(".ts") || name.endsWith(".tsx"))

  await mkdir(out, { recursive: true })

  for (const name of entries) {
    const filename = join(root, name)
    const result = await babel.transformAsync(await readFile(filename, "utf8"), {
      filename,
      babelrc: false,
      configFile: false,
      presets,
      sourceMaps: false,
    })
    if (!result?.code) throw new Error(`no output for ${name}`)
    const target = join(out, name.replace(/\.tsx?$/, ".js"))
    await writeFile(target, rewriteSpecifiers(result.code), "utf8")
    console.log(`${name} -> dist/${name.replace(/\.tsx?$/, ".js")}`)
  }
}

await build()