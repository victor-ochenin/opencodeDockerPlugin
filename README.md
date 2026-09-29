# opencode-docker-panel

A Docker container panel for the OpenCode 2 TUI sidebar.

The panel appends itself to `sidebar.content` and polls `docker ps --all --format "{{json .}}"`. It is read-only: it shows what is running, which ports are published, and how long a container has been up. It never starts, stops or execs anything.

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

A missing or stopped Docker is a normal state, not a plugin failure, so it is reported as a muted line rather than an error. Timeouts keep the last known rows instead of blanking the panel.

## Requirements

- OpenCode 2 runtime with plugin slots (`opencode2`)
- `docker` on `PATH`: Docker Desktop on Windows, Docker Engine on Linux and macOS
- Node.js 22 or newer for the parser check

## Layout

```text
index.ts      server entrypoint, plugin id and setup
tui.ts        CLI entrypoint, registers the sidebar slot
panel.tsx     Solid component: header, rows, states
docker.ts     runs docker ps, parses and sorts the output
types.ts      container and state types
scripts/      parser check
fixtures/     captured docker ps output used by the check
```

## Install

The discovery layout expects `index.ts` and `tui.ts` inside a plugin folder in the OpenCode config directory:

```text
~/.config/opencode/plugins/docker-panel/
```

On Windows the config directory is `%USERPROFILE%\.config\opencode\plugins\docker-panel\`.

Copy the files from a checkout:

```powershell
$src = "$HOME\Desktop\Projects\Test\opencodeDockerPlugin"
$dst = "$HOME\.config\opencode\plugins\docker-panel"
New-Item -ItemType Directory -Force -Path $dst | Out-Null
Copy-Item "$src\*.ts","$src\*.tsx","$src\package.json" -Destination $dst -Force
```

Plugins under the config directory are discovered automatically, so no config edit is required. To pass options, register the folder in `cli.json`:

```jsonc
{
  "$schema": "https://opencode.ai/v2/cli.json",
  "plugins": [{ "package": "./plugins/docker-panel", "options": { "intervalMs": 3000 } }]
}
```

Restart the TUI after copying or editing files.

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

The check asserts ordering, port splitting, name normalisation, truncation input and tolerance to broken lines against the fixture, then performs one live `docker ps` call and prints its state. It needs neither Docker nor OpenCode to be running for the fixture part.

Type checking:

```sh
npm install
npx tsc --noEmit
```

## Known limits

- OpenCode 2 is in beta, so slot names and the theme token shape may change. Colors are resolved defensively with fallbacks for that reason, and the header can be pinned to literal tokens once the shape is confirmed.
- The poll spawns `docker ps` on an interval. On a host with hundreds of containers, raise `intervalMs` to 5000 or higher.
- No log tail, no exec, no start or stop, no compose grouping, no restart history. Those are separate features and each one is deliberately out of scope here.

## License

MIT
