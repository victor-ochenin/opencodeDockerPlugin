import { execFile } from "node:child_process"

import type { Container, DockerState } from "./types.ts"

const COMMAND = "docker"
const ARGS = ["ps", "--all", "--format", "{{json .}}"]
const TIMEOUT_MS = 4000
const MAX_BUFFER = 4 * 1024 * 1024

const COMPOSE_PROJECT = "com.docker.compose.project"
const COMPOSE_SERVICE = "com.docker.compose.service"

export function shortReason(raw: string): string {
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

/** Docker joins labels with commas, and neither a compose project nor a service name may contain one, so a plain split is enough. */
function composeLabels(raw: string): Pick<Container, "composeProject" | "composeService"> {
  let composeProject: string | undefined
  let composeService: string | undefined
  for (const pair of raw.split(",")) {
    const eq = pair.indexOf("=")
    if (eq <= 0) continue
    const key = pair.slice(0, eq).trim()
    if (key === COMPOSE_PROJECT) composeProject = pair.slice(eq + 1).trim()
    else if (key === COMPOSE_SERVICE) composeService = pair.slice(eq + 1).trim()
  }
  return { composeProject, composeService }
}

function toContainer(raw: Record<string, unknown>): Container | null {
  const name = String(raw.Names ?? "")
    .replace(/^\//, "")
    .trim()
  if (!name) return null
  const compose = composeLabels(String(raw.Labels ?? ""))
  return {
    name,
    image: String(raw.Image ?? ""),
    state: String(raw.State ?? "unknown"),
    status: String(raw.Status ?? ""),
    ports: String(raw.Ports ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
    createdAt: Number(raw.CreatedAt ?? 0) || 0,
    ...compose,
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
    const aRunning = a.state === "running"
    const bRunning = b.state === "running"
    if (aRunning !== bRunning) return aRunning ? -1 : 1
    if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt
    return a.name.localeCompare(b.name)
  })
  return containers
}

export function runDockerPs(timeoutMs: number = TIMEOUT_MS): Promise<DockerState> {
  return new Promise((resolve) => {
    execFile(COMMAND, ARGS, { timeout: timeoutMs, windowsHide: true, maxBuffer: MAX_BUFFER }, (error, stdout, stderr) => {
      if (!error) {
        const containers = parseDockerPs(String(stdout))
        resolve({
          kind: containers.length > 0 ? "ok" : "empty",
          containers,
          detail: containers.length > 0 ? "" : "no containers",
        })
        return
      }
      const failure = error as { code?: string; killed?: boolean }
      if (failure.code === "ETIMEDOUT" || failure.killed === true) {
        resolve({ kind: "stale", containers: [], detail: "docker did not respond" })
        return
      }
      resolve({
        kind: "unavailable",
        containers: [],
        detail: failure.code === "ENOENT" ? "docker not installed" : shortReason(String(stderr || error.message)),
      })
    })
  })
}
