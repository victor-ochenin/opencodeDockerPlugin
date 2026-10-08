# opencode-docker-panel

[![CI](https://github.com/victor-ochenin/opencodeDockerPlugin/actions/workflows/ci.yml/badge.svg)](https://github.com/victor-ochenin/opencodeDockerPlugin/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/opencode-docker-panel.svg)](https://www.npmjs.com/package/opencode-docker-panel)

A Docker container panel for the OpenCode 2 TUI sidebar, with Docker Desktop control.

![The Docker panel in a session sidebar](docs/demo2.gif)

What it does, with demos: [docs/features.md](docs/features.md). Русская версия этого файла:
[README.ru.md](README.ru.md), демонстрации на русском — [docs/features.ru.md](docs/features.ru.md).

## Requirements

- OpenCode 2 runtime with plugin slots (`opencode2`)
- `docker` on `PATH`. Starting and stopping Docker Desktop needs its `docker desktop` CLI plugin
  and works on Windows only

## Install

### Option A: let an LLM do it

Paste this into any agent (Claude Code, OpenCode, Cursor, and so on):

```text
Install the opencode-docker-panel Docker sidebar plugin by following
https://github.com/victor-ochenin/opencodeDockerPlugin#installation
```

### Option B: manual setup

Add the plugin to `~/.config/opencode/cli.json`. Create the file if it does not exist and keep
whatever is already in it.

```jsonc
{
  "$schema": "https://opencode.ai/v2/cli.json",
  "plugins": [{ "package": "opencode-docker-panel", "options": { "intervalMs": 3000 } }],
}
```

Two things trip people up here, so they are worth stating plainly:

- **It goes in `cli.json`, not `opencode.json`.** This is a terminal-only plugin: it draws in the
  sidebar, and `cli.json` is the file the terminal client reads.
- **There is no login step and no provider to configure.** It talks to the local `docker` CLI and
  nothing else.

Restart the TUI afterwards. The host installs the package on the next start; nothing to copy and
nothing to build.

Pin a version when you want a known state: `{ "package": "opencode-docker-panel@0.5.0" }`.

### Verification

There is no CLI check for this one: the plugin draws in the terminal UI, so `opencode run` will
never show it. Verify in the TUI.

1. `docker ps` returns at least one container. If it fails, the panel has nothing to draw and says
   so.
2. Restart the TUI and open a session.
3. The sidebar gets a `Docker` header with a container count. Running containers appear as rows, at
   most five of them, with a `N more, click for all` line under them when something is still hidden.
4. Click `Docker` to collapse the list, then click it again to open the full list. Pick a container
   to get its actions menu, and the last entry there is `Stop Docker Desktop`.

Stop Docker Desktop and the sidebar gets a clickable `Start Docker Desktop` line instead of a line of text.

If the header never appears, the plugin did not load: check that the entry is in `cli.json` under
`plugins`, and check `~/.local/share/opencode/log/opencode.log` for a load error.

## Options

| Option       | Default | Notes                                 |
| ------------ | ------- | ------------------------------------- |
| `intervalMs` | `3000`  | Poll interval, clamped to 1000..60000 |

Everything else lives in [docs/features.md](docs/features.md).

## Changelog

Versions and dates are in [CHANGELOG.md](CHANGELOG.md).

## License

MIT
