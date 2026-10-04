# Changelog

All notable changes to this plugin, by version and date. The version is the one in `package.json` at
that commit; `npm` has no releases yet, so nothing here has been published.

## 0.4.0 — 2026-10-04

Branch `compose-stack`, not yet merged.

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