# Changelog

All notable changes to this plugin, by version and date. The version is the one in `package.json` at
that commit.

## 0.6.0 - 2026-10-10

- The panel follows `docker events` instead of asking on a timer, so a container appears or disappears
  as soon as Docker reports it: 442 ms on a measured `compose stop`, against up to three seconds before
- Only `start`, `die`, `destroy`, `pause`, `unpause` and `rename` cause a repaint. `kill`, `stop` and
  `create` would redraw a frame identical to the one already on screen, and `exec_` and `health_` events
  are the container's own internals
- Polling stays as a safety net: `docker ps` every 30 seconds, and every 3 seconds while Docker is
  stopped so that starting Docker Desktop from the tray shows up at once
- The event stream is reopened when its process exits, which it does loudly: about thirty seconds of
  silence, then `unexpected EOF` and exit code 1. Reopening waits for `docker ps` to answer, so no
  process is spawned for as long as Docker stays down
- `intervalMs` is gone. It controlled how often the panel ran `docker ps`, and events make that
  meaningless; leaving it in a config is harmless
- Two container changes in quick succession no longer lose the second one, and simultaneous refreshes
  can no longer apply out of order
- `Stop Docker Desktop` hides the `Up stack` line the moment it is pressed rather than after the
  command finishes

## 0.5.1 - 2026-10-08

- The repository is formatted with prettier, with a config that matches the existing style: no semicolons,
  a 120 column width, trailing commas everywhere
- `npm run format` writes, `npm run format:check` only reports
- Version is bumped because the formatting changes every module and the rebuilt `dist` differs from 0.5.0

## 0.5.0 - 2026-10-07

- The panel can start and stop Docker Desktop: `Start Docker Desktop` is a clickable line in the
  sidebar, `Stop Docker Desktop` is the last entry of the container list and is available even with no
  containers at all
- `Stop` confirms first and names the running containers it can see, because an app-level stop ends
  every container of every project
- Engine state comes from a `docker desktop status` probe rather than from `docker ps`, which reports a
  stopped engine as an unavailable socket and cannot tell it apart from a missing CLI
- The probe waits up to nine seconds: measured, the CLI plugin takes 3.5 to 4.5 seconds to answer when
  Docker is stopped, and a shorter timeout turned a provable `stopped` into an unknown state with no
  buttons at all
- Log polling stops while the engine is down instead of spawning a doomed `docker logs` every two
  seconds; the window keeps its last lines and does not resume by itself
- Readme trimmed to install and verification, with the behaviour, the demos and the limits moved to
  `docs/features.md` and `docs/features.ru.md`
- Compose project names derived from a directory are normalized the way compose normalizes them, so an
  uppercase directory like `CarManufacturersMVC` starts as `carmanufacturersmvc` instead of being
  rejected as an invalid project name
- A compose project name that compose would reject, or one that normalizes to nothing, no longer
  offers a button at all
- A stopped engine is read from `docker ps` failing on a missing `dockerDesktopLinuxEngine` pipe, which
  takes a quarter of a second instead of the four seconds `docker desktop status` needs, so the
  `Start Docker Desktop` line shows up right away

## 0.4.8 - 2026-10-04

- The package now ships precompiled ESM: `npm run build` transpiles the sources with the same
  Solid options OpenTUI's own transform uses, and `exports["./tui"]` points at `dist/tui.js`
- `react` dropped: the panel never imported it, and the host rewrites `@opentui/solid` and
  `solid-js` to its own runtime when a package under `node_modules` ships JavaScript
- Peer dependencies stay optional, so npm never writes a second Solid or OpenTUI copy next to
  the plugin
- `check-build` verifies the built entry imports, claims `sidebar.content`, and releases it on
  cleanup

## 0.4.1 — 2026-10-04

- `react` added to peer dependencies, so the panel loads from npm

## 0.4.0 — 2026-10-04

- Sidebar draws running containers only, at most five, with the header opening the full list
- `Pin` and `Unpin` per container, stored by the host and surviving a TUI restart
- `Up stack` starts a compose project from the agent directory, only when the file provably declares
  the clicked container's project
- An unstarted stack in the agent directory gets its own line under the rows
- Packaged for npm: `files` allowlist, peer dependencies, repository metadata, npm install docs
- Readme trimmed to what a user needs, with the working install path first

## 0.3.0 — 2026-09-30

- `Start`, `Restart`, `Stop` and `Down compose project` per container, with `Down` confirming first
- Log view in the same dialog, `docker logs --timestamps --tail 200`, streams merged by timestamp
- Terminal recording added to the readme
- CI running typecheck and parser checks on both Linux and Windows

## 0.2.0 — 2026-09-29

- Loads as a CLI-only plugin, no `@opencode/plugin` import at runtime
- A poll that reports no containers clears the panel instead of keeping stale rows

## 0.1.0 — 2026-09-29

- First version: Docker containers in the `sidebar.content` slot, polled from `docker ps`
