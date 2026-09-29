# opencode-docker-panel

A Docker container panel for the OpenCode 2 TUI sidebar.

The panel appends itself to the `sidebar.content` slot and polls `docker ps --all --format "{{json .}}"`. It is read-only: it shows what is running, which ports are published, and how long a container has been up. It never starts, stops or execs anything.

Русская версия этого файла: [README.ru.md](README.ru.md)

## What it shows

```text
Docker (3)
• chroma      127.0.0.1:8000  127.0.0.1:8001
• postgres     0.0.0.0:5432->5432/tcp
• worker-old   Exited (0) 2 days ago
```

The dot is colored by container state: green for `running`, yellow for `paused` and `restarting`, muted for everything else. Running containers sort first, then newest `CreatedAt`, so the list does not jump between polls. More than ten rows are truncated with an `N more` line. Clicking the header collapses and expands the list.

| State | Panel output |
|---|---|
| Docker up with containers | `Docker (N)` plus one row per container |
| Docker up, nothing created | `no containers` |
| Docker Desktop not running | `docker desktop not running` |
| Docker not installed | `docker not installed` |
| `docker ps` timed out | last known rows with a `stale` marker |
| No permission on the Docker socket | `no permission to talk to docker` |

A missing or stopped Docker is a normal state, not a plugin failure, so it is reported as a muted line rather than an error. Any failed poll, whether a timeout or a dead daemon, keeps the last known rows with a `stale` marker instead of blanking the panel; a successful poll that reports no containers clears the list.

## Requirements

- OpenCode 2 runtime with plugin slots (`opencode2`)
- `docker` on `PATH`: Docker Desktop on Windows, Docker Engine on Linux and macOS
- Node.js 22 or newer for the parser check

## Layout

```text
tui.tsx       CLI entrypoint: default export, registers the sidebar slot
panel.tsx     Solid component: header, rows, states
poll.ts       polling loop: owns the last known rows and the refresh timer
docker.ts     runs docker ps, parses and sorts the output
types.ts      container and state types
scripts/      parser check
fixtures/     captured docker ps output used by the check
```

There is deliberately no server entrypoint. The plugin is CLI-only, so OpenCode never asks the server to load it, and no `@opencode/plugin` import has to resolve. The entrypoint exports a plain object with `id` and `setup`; the host passes the plugin context in and the panel reads `context.theme` from it. This is the same shape the herdr integration uses.

`context.ui.slot()` is typed locally in `tui.tsx`, not imported from a package, because no published types were available. The shape matches what the host passes at runtime, and `setup` throws a descriptive error if `ui.slot` is missing, but the signature has not been verified against a released type definition. The panel strings are English only; the docs are bilingual. The package is not installable from npm: it ships a `.tsx` entrypoint and expects the host to transpile it and to provide `solid-js` and `@opentui/*`, which is why they are dev dependencies.

## Install

Copy the files into the OpenCode config directory:

```text
~/.config/opencode/plugins/docker-panel/
```

On Windows that is `%USERPROFILE%\.config\opencode\plugins\docker-panel\`.

```powershell
$src = "path\to\opencodeDockerPlugin"
$dst = "$HOME\.config\opencode\plugins\docker-panel"
New-Item -ItemType Directory -Force -Path $dst | Out-Null
Copy-Item "$src\*.ts","$src\*.tsx","$src\package.json" -Destination $dst -Force
```

Register it in `cli.json`, otherwise the CLI has no entry to load:

```jsonc
{
  "$schema": "https://opencode.ai/v2/cli.json",
  "plugins": [{ "package": "./plugins/docker-panel", "options": { "intervalMs": 3000 } }]
}
```

Restart the TUI afterwards.

## Options

| Option | Default | Notes |
|---|---|---|
| `intervalMs` | `3000` | Poll interval, clamped to 1000..60000 |

## Verification

```sh
npm run check
```

```text
parser checks passed
fixture: 3 containers -> chroma:running, postgres:running, worker-old:exited
live: kind=ok detail=- containers=2
```

The check asserts ordering, port splitting, name normalisation and tolerance to broken lines against the fixture, then performs one live `docker ps` call and prints its state. It needs neither Docker nor OpenCode to be running for the fixture part.

Type checking:

```sh
npm install
npm run typecheck
```

## Known limits

- OpenCode 2 is in beta, so the slot name and the theme token shape may change. Colors are resolved defensively with fallbacks for that reason, and the header can be pinned to literal tokens once the shape is confirmed.
- The poll spawns `docker ps` on an interval. On a host with hundreds of containers, raise `intervalMs` to 5000 or higher.
- No log tail, no exec, no start or stop, no compose grouping, no restart history. Those are separate features and each one is deliberately out of scope here.

## License

MIT