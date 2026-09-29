import { execFile } from "node:child_process"

import type { Container, DockerState } from "./types.ts"

const COMMAND = "docker"
const ARGS = ["ps", "--all", "--format", "{{json .}}"]
const TIMEOUT_MS = 2000
const MAX_BUFFER = 4 * 1024 * 1024

function shortReason(raw: string): string {
  const text = raw.toLowerCase()
  if (text.includes("dockerdesktoplinuxengine") || text.includes("cannot find the file specified")) {
    return "docker desktop not running"
  }
  if (text.includes("docker_engine") || text.includes("is the server running")) return "no connection to docker"
  if (text.includes("access is denied") || text.includes("permission denied")) return "no permission to talk to docker"
  const firstLine = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0)
  if (!firstLine) return "no connection to docker"
  return firstLine.length > 60 ? `${firstLine.slice(0, 57)}...` : firstLine
}

function toContainer(raw: Record<string, unknown>): Container | null {
  const name = String(raw.Names ?? "")
    .replace(/^\//, "")
    .trim()
  if (!name) return null
  const state = String(raw.State ?? "unknown")
  return {
    id: String(raw.ID ?? ""),
    name,
    image: String(raw.Image ?? ""),
    state,
    status: String(raw.Status ?? ""),
    ports: String(raw.Ports ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
    createdAt: Number(raw.CreatedAt ?? 0) || 0,
    running: state === "running",
  }
}

export function parseDockerPs(stdout: string): Container[] {
  const containers: Container[] = []
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let raw: unknown
    try {
      raw = JSON.parse(trimmed)
    } catch {
      continue
    }
    if (typeof raw !== "object" || raw === null) continue
    const container = toContainer(raw as Record<string, unknown>)
    if (container) containers.push(container)
  }
  containers.sort((a, b) => {
    if (a.running !== b.running) return a.running ? -1 : 1
    if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt
    return a.name.localeCompare(b.name)
  })
  return containers
}

export function runDockerPs(timeoutMs: number = TIMEOUT_MS): Promise<DockerState> {
  const now = () => Date.now()
  return new Promise((resolve) => {
    execFile(
      COMMAND,
      ARGS,
      { timeout: timeoutMs, windowsHide: true, maxBuffer: MAX_BUFFER },
      (error, stdout, stderr) => {
        if (!error) {
          const containers = parseDockerPs(String(stdout))
          resolve({
            kind: containers.length > 0 ? "ok" : "empty",
            containers,
            detail: containers.length > 0 ? "" : "no containers",
            at: now(),
          })
          return
        }
        const code = (error as NodeJS.ErrnoException).code
        if (code === "ETIMEDOUT" || (error as { killed?: boolean }).killed === true) {
          resolve({ kind: "stale", containers: [], detail: "docker did not respond", at: now() })
          return
        }
        resolve({
          kind: "unavailable",
          containers: [],
          detail: code === "ENOENT" ? "docker not installed" : shortReason(String(stderr ?? error.message ?? "")),
          at: now(),
        })
      },
    )
  })
}
