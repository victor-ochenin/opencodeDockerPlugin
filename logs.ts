import { execFile } from "node:child_process"

const COMMAND = "docker"
const TAIL = 200
const TIMEOUT_MS = 4000
const MAX_BUFFER = 4 * 1024 * 1024

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g

const STAMP = String.raw`\d{4}-\d{2}-\d{2}T\S+`
const TIMESTAMP_ONLY = new RegExp(`^${STAMP}$`)
const TIMESTAMPED = new RegExp(`^(${STAMP})\\s+(.*)$`)

export type LogLevel = "error" | "warn" | "info"

export interface LogLine {
  readonly time: string
  readonly level: LogLevel
  readonly text: string
}

export interface LogResult {
  readonly lines: LogLine[]
  readonly error?: string
}

/** The terminal would run ANSI sequences as control codes, and a lone CR is a terminator, not an overwrite */
export function sanitize(raw: string): string[] {
  return raw
    .replace(ANSI, "")
    .split(/\r\n|\r|\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
}

function level(text: string): LogLevel {
  const lower = text.toLowerCase()
  if (/\b(error|fatal|panic|exception|traceback|failed)\b/.test(lower)) return "error"
  if (/\b(warn|warning|deprecated)\b/.test(lower)) return "warn"
  return "info"
}

/** docker prefixes every line with an RFC3339 timestamp when asked, so a line splits into time and rest */
export function parseLogLines(raw: string): LogLine[] {
  const lines: LogLine[] = []
  for (const line of sanitize(raw)) {
    if (TIMESTAMP_ONLY.test(line)) continue
    const match = TIMESTAMPED.exec(line)
    if (!match) {
      lines.push({ time: "", level: level(line), text: line })
      continue
    }
    const text = match[2] ?? ""
    if (text.trim().length > 0) lines.push({ time: match[1] ?? "", level: level(text), text })
  }
  return lines
}

/** docker interleaves the container's two streams, so the real order only survives in the timestamps */
export function mergeLogLines(parts: string[]): LogLine[] {
  const lines = parts.flatMap((part) => parseLogLines(part))
  return lines.sort((a, b) => (a.time || "￿").localeCompare(b.time || "￿")).slice(-TAIL)
}

export function runDockerLogs(name: string, timeoutMs: number = TIMEOUT_MS): Promise<LogResult> {
  return new Promise((resolve) => {
    execFile(
      COMMAND,
      ["logs", "--timestamps", "--tail", String(TAIL), "--", name],
      { timeout: timeoutMs, windowsHide: true, maxBuffer: MAX_BUFFER },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({ lines: mergeLogLines([String(stdout), String(stderr)]) })
          return
        }
        const killed = (error as { killed?: boolean }).killed === true
        const reason = sanitize(String(stderr))[0] || (killed ? "docker did not respond" : error.message)
        resolve({ lines: [], error: reason || "docker logs failed" })
      },
    )
  })
}
