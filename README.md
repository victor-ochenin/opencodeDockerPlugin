# opencode-docker-panel

A Docker container panel for the OpenCode 2 TUI sidebar.

The panel appends itself to the `sidebar.content` slot, polls `docker ps --all --format "{{json .}}"`, and lets you act on a container from the row itself. Clicking a row opens a dialog with the actions docker accepts for that container's current state; `Down` is the only one that asks for confirmation.

Русская версия этого файла: [README.ru.md](README.ru.md)

![The Docker panel in the session sidebar, a container action dialog and the log view](docs/demo.gif)

## What it does

```text
Docker (3)                                              <- click to collapse
• chroma      127.0.0.1:8000  127.0.0.1:8001            <- click for actions
• socnot-db   0.0.0.0:5432->5432/tcp · socnot
```

| Container state | Actions offered |
|---|---|
| `running`, `restarting`, `paused` | `Restart`, `Stop`, and `Down` when the container belongs to a compose project |
| `created`, `exited`, `dead` | `Start` |
| anything else | none |

| Action | Command |
|---|---|
| Start | `docker start -- <name>` |
| Restart | `docker restart -- <name>` |
| Stop | `docker stop -- <name>` |
| Down | `docker compose -p <project> down` |

`--` is not optional: a container name may start with a dash, and without the separator docker reads it as a flag. Every option shows its exact command in the dialog footer, so the destructive one is never a surprise.

`Down` runs `docker compose down` against the compose project the container carries in its labels, which stops every container of that project and removes their networks. Volumes are kept, and the confirmation dialog says so. A container with no compose project never gets the option, and `buildArgs` refuses it as well.

The result of every action arrives as a toast, and the panel refreshes immediately instead of waiting for the next poll. While a command runs the header shows `working` and further clicks are ignored, so a double click cannot launch two commands.

## Logs

`Logs` in the same menu replaces the dialog contents with a log view for that container, so the log and the actions share one window. It closes with `esc` or by clicking the footer line.

The view is `docker logs --timestamps --tail 200 -- <name>`, refreshed every two seconds while it is open. Docker interleaves the container's two streams, so the two buffers are parsed separately and merged back by timestamp; without that the log reads all of stdout first. ANSI sequences and lone `CR` are stripped, because the terminal would otherwise run them as control codes. A fixed window of fifteen lines is scrolled with the mouse wheel.

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
tui.tsx       CLI entrypoint: registers the sidebar slot
panel.tsx     Solid component: header, rows, states, action dialog
poll.ts       polling loop: owns the last known rows and the refresh timer
commands.ts   builds and runs the lifecycle commands
logs.ts       reads, sanitises and orders container log lines
docker.ts     runs docker ps, parses and sorts the output
types.ts      container and state types
scripts/      parser and command checks
fixtures/     captured docker ps output used by the check
```

There is deliberately no server entrypoint. The plugin is CLI-only, so OpenCode never asks the server to load it and no `@opencode/plugin` value import has to resolve at runtime. The entrypoint exports a plain object with `id` and `setup`, typed as `Plugin.Definition` and checked against `Plugin.Context` with a type-only import, which is erased at load time. That is what proves the shape is right: the slot claim, the dialog options, the toast variants and the theme tokens below are all checked against the published types rather than against a local guess.

Colors come straight from `context.theme`: `text.base`, `text.muted` and `text.feedback.{success,warning,error}.base`. They are required, typed `RGBA` tokens, so there is no fallback chain to keep in sync, and a host that stops providing them fails the build instead of silently rendering the wrong hue.

The panel strings are English only; the docs are bilingual. The package is not installable from npm: it ships a `.tsx` entrypoint and expects the host to transpile it and to provide `solid-js` and `@opentui/*`, which is why they are dev dependencies.

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

The check asserts ordering, port splitting, name normalisation and tolerance to broken lines against the fixture, compose label extraction, the exact command line built for every action, which actions each state offers, and the polling rule that a failed poll keeps the last rows. It then performs one live `docker ps` call and prints its state. It needs neither Docker nor OpenCode to be running for everything except that last line.

Type checking:

```sh
npm install
npm run typecheck
```

Type checking is also how the plugin is validated against the host: `@opencode/plugin` and `@opencode/theme` are dev-only type sources, so a breaking change in the TUI plugin API fails `npm run typecheck` instead of failing at load.

## Known limits

- OpenCode 2 is in beta, so slot names and theme tokens may change; that surfaces as a type error rather than a runtime surprise.
- The host does not repaint a slot when only a reactive value changes, so the panel is remounted through a fresh slot claim whenever the container list really changes, at most once every ten seconds. That is a workaround, and it resets the collapsed state and closes an open log view; the underlying repaint gap belongs to the host.
- The poll spawns `docker ps` on an interval. On a host with hundreds of containers, raise `intervalMs` to 5000 or higher.
- Rows are capped at ten with an `N more` line and there is no scrolling, which suits a sidebar but not a real container list.
- No exec, no volume or image actions, no restart history. `Down` is offered per container but acts on the whole compose project. The log view is a fixed window over the last 200 lines with no history beyond that.
- Actions are mouse-only; the plugin registers no keymap layer.

## License

MIT