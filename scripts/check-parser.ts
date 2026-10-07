import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import { fileURLToPath } from "node:url"

import { parseDockerPs, runDockerPs, shortReason } from "../docker.ts"
import { availableActions, buildArgs } from "../commands.ts"
import { findComposeFile, resolveComposeTarget } from "../compose.ts"
import { mergeLogLines, parseLogLines, runDockerLogs, sanitize } from "../logs.ts"
import { keepContainers, selectRows } from "../poll.ts"
import {
  ENGINE_ACTION_LABEL,
  availableRuntimeActions,
  buildRuntimeArgs,
  parseDesktopStatus,
  runDesktopStatus,
} from "../runtime.ts"
import type { Container, DockerState } from "../types.ts"

const fixturePath = fileURLToPath(new URL("../fixtures/docker-ps.jsonl", import.meta.url))

const fixture = await readFile(fixturePath, "utf8")
const parsed = parseDockerPs(fixture)

assert.equal(parsed.length, 3, "all three fixture containers must parse")
assert.deepEqual(parsed.map((item) => item.name), ["chroma", "postgres", "worker-old"], "running first, then newest CreatedAt")
assert.equal(parsed[0]?.ports.length, 2, "chroma exposes two ports")
assert.equal(parsed[0]?.ports[0], "127.0.0.1:8000")
assert.equal(parsed[2]?.state, "exited", "exited container is not running")
assert.equal(parsed[2]?.ports.length, 0, "exited container has no ports")
assert.equal(parsed[0]?.name, "chroma", "leading slash stripped from the name")

const dirty = `garbage line\n\n${fixture}\n{"broken":\n{"Names":""}\n`
assert.equal(parseDockerPs(dirty).length, 3, "broken lines are skipped, valid ones still parse")
assert.deepEqual(parseDockerPs(""), [], "empty output yields an empty list")
assert.equal(parseDockerPs('{"Names":"/solo","State":"running"}').length, 1, "minimal record still parses")

assert.equal(shortReason("Cannot find the file specified"), "engine not running")
assert.equal(shortReason("error during connect: is the server running?"), "no connection to docker")
assert.equal(shortReason("Got permission denied while trying to connect"), "no permission to talk to docker")
assert.equal(shortReason(""), "no connection to docker", "empty stderr falls back to a generic reason")
assert.equal(shortReason("x".repeat(80)).length, 60, "long reasons are truncated with an ellipsis")

// Every string below is a measured `docker desktop status` output, not an invented one
const STOPPED_STDERR = "Could not retrieve status. Is Docker Desktop running?"
const STOPPED_STDOUT = "You can start Docker Desktop by running 'docker desktop start'."

assert.equal(parseDesktopStatus(0, "", ""), "running", "exit 0 means the engine answers")
assert.equal(
  parseDesktopStatus(1, STOPPED_STDOUT, STOPPED_STDERR),
  "stopped",
  "a stopped engine fails with exit 1 and its reason on stderr, it never prints stopped",
)
assert.equal(
  parseDesktopStatus(1, STOPPED_STDOUT, STOPPED_STDERR.toUpperCase()),
  "stopped",
  "the wording is matched case-insensitively",
)
assert.equal(
  parseDesktopStatus(125, "", "unknown flag: --nope"),
  "unknown",
  "exit 125 is docker's code for an unknown flag, which is not the same as stopped",
)
assert.equal(
  parseDesktopStatus(1, "", 'unable to retrieve the engine list: open \\\\.\\pipe\\dockerBackendApiServer'),
  "unknown",
  "engine ls shares exit 1 with status while the engine is down, so exit 1 alone cannot mean stopped",
)
assert.equal(
  parseDesktopStatus(1, "You can start Docker Desktop by running 'docker desktop start'.", "Could not retrieve status."),
  "stopped",
  "the affirmative half of the message alone proves the engine is down, without the question",
)
assert.equal(
  parseDesktopStatus(1, "", "docker: 'desktop' is not a docker command.\nSee 'docker --help'"),
  "absent",
  "a missing cli plugin is absent, and the check comes before the exit code on purpose",
)
assert.equal(parseDesktopStatus(null, "", ""), "unknown", "no docker binary at all is unknown, never stopped")
assert.equal(parseDesktopStatus(1, "", "permission denied"), "unknown", "a socket refusal is not a stopped engine")
assert.deepEqual(availableRuntimeActions("stopped"), ["engine-start"])
assert.deepEqual(availableRuntimeActions("running"), ["engine-stop"])
assert.deepEqual(availableRuntimeActions("unknown"), [], "an unrecognized state offers nothing to click")
assert.deepEqual(availableRuntimeActions("absent"), [], "a machine without the plugin gets no button that cannot work")
assert.deepEqual(buildRuntimeArgs("engine-start"), ["desktop", "start"])
assert.deepEqual(buildRuntimeArgs("engine-stop"), ["desktop", "stop"])
assert.equal(ENGINE_ACTION_LABEL["engine-stop"], "Stop Docker Desktop")
assert.equal(
  buildRuntimeArgs("engine-stop").includes("--force"),
  false,
  "force would bypass the confirmation that an app-level stop has to ask for",
)

const compose = parseDockerPs(
  '{"Names":"/web","State":"running","Labels":"com.docker.compose.project=socnot,com.docker.compose.service=web,com.docker.compose.oneoff=False"}',
)[0] as Container
assert.equal(compose.composeProject, "socnot", "compose project read from labels")
assert.equal(compose.composeService, "web", "compose service read from labels")
assert.equal((parseDockerPs('{"Names":"/solo","State":"running"}')[0] as Container).composeProject, undefined)

const CREATED_SECONDS = 1757900000
const CREATED_AS_DOCKER_DATE = `${new Date(CREATED_SECONDS * 1000).toISOString().slice(0, 19).replace("T", " ")} +0000 UTC`
const dated = parseDockerPs(`{"Names":"/d","State":"exited","CreatedAt":${JSON.stringify(CREATED_AS_DOCKER_DATE)}}`)[0] as Container
const stamped = parseDockerPs(`{"Names":"/s","State":"exited","CreatedAt":"${CREATED_SECONDS}"}`)[0] as Container
assert.equal(dated.createdAt, CREATED_SECONDS * 1000, "a date with a trailing zone name parses to milliseconds")
assert.equal(stamped.createdAt, CREATED_SECONDS * 1000, "a unix timestamp in seconds is scaled to milliseconds")
assert.ok(
  parseDockerPs('{"Names":"/a","State":"exited","CreatedAt":"garbage"}')[0]!.createdAt === 0,
  "an unreadable CreatedAt falls back to zero instead of NaN",
)

const bare: Container = { name: "lonely", image: "img", state: "running", status: "Up 2 hours", ports: [], createdAt: 0 }
assert.deepEqual(buildArgs("stop", bare), ["stop", "--", "lonely"], "name is passed after the flag separator")
assert.deepEqual(buildArgs("restart", compose), ["restart", "--", "web"])
assert.deepEqual(buildArgs("start", bare), ["start", "--", "lonely"])
assert.deepEqual(buildArgs("down", compose), ["compose", "-p", "socnot", "down"], "down targets the compose project")
assert.throws(() => buildArgs("down", bare), /no compose project/, "down is refused without a compose project")

assert.deepEqual(availableActions(compose), ["restart", "stop", "down"], "destructive action goes last")
assert.deepEqual(availableActions(bare), ["restart", "stop"], "no down without a compose project")
assert.deepEqual(availableActions({ ...bare, state: "exited" }), ["start"], "a bare stopped container can only be started")
assert.deepEqual(
  availableActions({ ...compose, state: "exited" }),
  ["start", "down"],
  "a stopped compose container can be torn down, which is when cleanup is wanted",
)
assert.deepEqual(availableActions({ ...bare, state: "dead" }), ["start"], "a dead container can only be started")
assert.deepEqual(availableActions({ ...bare, state: "removing" }), [], "an unknown state offers nothing")

const stack = { dir: "/agent", file: "/agent/compose.yaml", project: "socnot" }
assert.deepEqual(
  buildArgs("up", compose, stack),
  ["compose", "-f", "/agent/compose.yaml", "-p", "socnot", "up", "-d"],
  "up passes the file and the project explicitly, with -f before -p",
)
assert.throws(() => buildArgs("up", compose), /no resolved compose target/, "up is refused without a resolved target")
assert.deepEqual(
  availableActions({ ...compose, state: "exited" }, stack),
  ["start", "up", "down"],
  "up sits between the reversible start and the destructive down",
)
assert.deepEqual(
  availableActions({ ...compose, state: "exited" }),
  ["start", "down"],
  "a compose container with no matching file in the agent directory gets no up",
)
assert.deepEqual(
  availableActions(compose, stack),
  ["restart", "stop", "down"],
  "a running container is never offered up, it is already up",
)
assert.deepEqual(
  availableActions({ ...bare, state: "exited" }, stack),
  ["start"],
  "up needs a compose label to match the file against",
)

const composeRoot = mkdtempSync(join(tmpdir(), "docker-panel-compose-"))
try {
  const declared = join(composeRoot, "declared")
  mkdirSync(declared)
  writeFileSync(join(declared, "compose.yaml"), "name: socnot\nservices:\n  web:\n    build: .\n")
  const resolved = resolveComposeTarget(declared, "socnot")
  assert.equal(resolved?.project, "socnot", "a top-level name: declares the project")
  assert.equal(resolved?.dir, declared, "the target keeps the agent directory")
  assert.equal(resolved?.file, join(declared, "compose.yaml"), "the target points at the file on disk")
  assert.equal(resolveComposeTarget(declared, "other"), null, "a foreign project is refused instead of offered")
  assert.equal(resolveComposeTarget(declared, ""), null, "an empty label cannot match a project")

  const byDir = join(composeRoot, "bydir")
  mkdirSync(byDir)
  writeFileSync(join(byDir, "docker-compose.yml"), "services:\n  web:\n    image: nginx\n")
  assert.equal(
    resolveComposeTarget(byDir, basename(byDir))?.project,
    basename(byDir),
    "without name: the project is the directory the file lives in",
  )

  const shadowed = join(composeRoot, "shadowed")
  mkdirSync(shadowed)
  writeFileSync(join(shadowed, "compose.yaml"), "name: someoneelse\nservices: {}\n")
  writeFileSync(join(shadowed, "docker-compose.yml"), "name: shadowed\nservices: {}\n")
  assert.equal(resolveComposeTarget(shadowed, "shadowed"), null, "a foreign project hides up rather than pointing it elsewhere")
  assert.equal(
    findComposeFile(shadowed)?.project,
    "someoneelse",
    "the file is still found, it just belongs to a project the container is not part of",
  )

  assert.equal(resolveComposeTarget(join(composeRoot, "empty"), "any"), null, "no compose file means no target")
  assert.equal(findComposeFile(join(composeRoot, "empty")), null, "no compose file is not a stack to start")

  const bom = join(composeRoot, "bom")
  mkdirSync(bom)
  writeFileSync(join(bom, "compose.yaml"), "\uFEFFname: bommed\nservices: {}\n")
  assert.equal(
    findComposeFile(bom)?.project,
    "bommed",
    "a UTF-8 BOM must not push the file onto the directory-name fallback, PowerShell writes one",
  )

  const crlf = join(composeRoot, "crlf")
  mkdirSync(crlf)
  writeFileSync(join(crlf, "compose.yaml"), "name: windows\r\nservices:\r\n  web:\r\n    build: .\r\n")
  assert.equal(findComposeFile(crlf)?.project, "windows", "CRLF line endings do not leak a carriage return into the name")

  const neverStarted = join(composeRoot, "never-started")
  mkdirSync(neverStarted)
  writeFileSync(join(neverStarted, "compose.yaml"), "name: fresh\nservices:\n  web:\n    build: .\n")
  const fresh = findComposeFile(neverStarted)
  assert.equal(fresh?.project, "fresh", "a file with no containers still names a project to start")
  const ghost: Container = { name: "fresh", image: "", state: "exited", status: "", ports: [], createdAt: 0 }
  assert.deepEqual(
    buildArgs("up", ghost, fresh ?? undefined),
    ["compose", "-f", join(neverStarted, "compose.yaml"), "-p", "fresh", "up", "-d"],
    "a stack with no container yet is started with the same explicit flags",
  )
} finally {
  rmSync(composeRoot, { recursive: true, force: true })
}

const ansi = "\u001b[31mred\u001b[0m plain \u001b[1mbold\u001b[0m"
assert.deepEqual(sanitize(ansi), ["red plain bold"], "ANSI sequences are stripped")
assert.deepEqual(sanitize("a\r\nb\rc"), ["a", "b", "c"], "a lone CR terminates a line instead of rewriting it")
const parsedLogs = parseLogLines(
  [
    "2026-09-21T09:56:17.123456789Z starting server",
    "2026-09-21T09:56:18.000000000Z WARNING disk almost full",
    "2026-09-21T09:56:19.000000000Z ERROR connection refused",
  ].join("\n"),
)
assert.equal(parsedLogs.length, 3)
assert.equal(parsedLogs[0]?.time, "2026-09-21T09:56:17.123456789Z", "the timestamp is split off the line")
assert.equal(parsedLogs[0]?.text, "starting server")
assert.deepEqual(
  parsedLogs.map((item) => item.level),
  ["info", "warn", "error"],
  "levels are classified from the message text",
)
assert.deepEqual(
  parseLogLines("2026-09-21T09:56:17.000000000Z\n2026-09-21T09:56:18.000000000Z real text").map((item) => item.text),
  ["real text"],
  "a line that is only a timestamp is an empty log line and is dropped",
)
assert.deepEqual(
  parseLogLines("plain line without a timestamp").map((item) => item.text),
  ["plain line without a timestamp"],
  "a line without a timestamp is kept whole",
)
assert.deepEqual(
  mergeLogLines([
    "2026-09-21T09:56:19.000000000Z from stderr\n2026-09-21T09:56:21.000000000Z also stderr",
    "2026-09-21T09:56:17.000000000Z from stdout\n2026-09-21T09:56:20.000000000Z also stdout",
  ]).map((item) => item.text),
  ["from stdout", "from stderr", "also stdout", "also stderr"],
  "interleaved streams are merged back into timestamp order",
)
assert.deepEqual(
  mergeLogLines(["no timestamp here\n2026-09-21T09:56:17.000000000Z dated"]).map((item) => item.text),
  ["dated", "no timestamp here"],
  "an untimed line sorts last instead of scrambling the order",
)

const liveLogs = await runDockerLogs(parsed[0]!.name)
assert.ok(Array.isArray(liveLogs.lines), "a live log call resolves to lines")
assert.ok(liveLogs.error === undefined || liveLogs.error.length > 0, "a live log call reports why on failure")

const previous = parsed
const ok: DockerState = { kind: "empty", containers: [], detail: "no containers" }
assert.equal(keepContainers(previous, ok).length, 0, "a successful empty poll must not resurrect old rows")
assert.equal(keepContainers(previous, { kind: "stale", containers: [], detail: "docker did not respond" }), previous)
assert.equal(keepContainers(previous, { kind: "unavailable", containers: [], detail: "boom" }), previous)
assert.equal(
  keepContainers(previous, { kind: "stopped", containers: [], detail: "" }),
  previous,
  "a stopped engine leaves the last known rows on screen instead of emptying the panel",
)
assert.deepEqual(
  availableRuntimeActions(parseDesktopStatus(1, STOPPED_STDOUT, STOPPED_STDERR)),
  ["engine-start"],
  "the rows survive the stop and the panel offers the way back",
)

const named = (name: string, state: string): Container => ({
  name,
  image: "img",
  state,
  status: state,
  ports: [],
  createdAt: 0,
})
// docker.ts already sorts running first, so the fixtures have to arrive in that order for the checks to mean anything
const busyHost = Array.from({ length: 12 }, (_, index) => named(`live-${index}`, "running"))
const quietHost = [named("old-a", "exited"), named("old-b", "dead"), named("old-c", "created")]

assert.deepEqual(
  selectRows(busyHost, []).map((item) => item.name),
  ["live-0", "live-1", "live-2", "live-3", "live-4"],
  "at most five running containers get a row, the first five in docker order",
)
assert.deepEqual(selectRows(quietHost, []), [], "a stopped container gets no row while nothing runs")
assert.deepEqual(
  selectRows(quietHost, ["old-c"]).map((item) => item.name),
  ["old-c"],
  "a pinned stopped container is the one row there is",
)
assert.equal(selectRows(quietHost, ["old-a", "old-b", "old-c"]).length, 3, "pinning beats the five row budget")
assert.equal(
  selectRows(busyHost, ["live-9"]).length,
  5,
  "a pinned running container spends the budget instead of adding a sixth row",
)
assert.equal(selectRows(busyHost, ["live-9"])[0]?.name, "live-9", "pinned rows come before the running ones")
assert.deepEqual(selectRows(quietHost, ["gone"]), [], "a pin for a container that no longer exists is ignored")
assert.deepEqual(
  selectRows([named("paused-one", "paused"), named("restarting-one", "restarting")], []),
  [],
  "a paused or restarting container gets no row: the sidebar shows what is serving, not what exists",
)

const live = await runDockerPs()
assert.ok(["ok", "empty", "unavailable", "stale"].includes(live.kind), `unexpected live status: ${live.kind}`)

// Read-only, like runDockerPs above: it must never start or stop anything, and check runs in CI on Linux too
const engine = await runDesktopStatus()
assert.ok(["running", "stopped", "absent", "unknown"].includes(engine), `unexpected engine status: ${engine}`)
assert.ok(
  ["running", "stopped", "absent", "unknown"].includes(await runDesktopStatus(1)),
  "a one millisecond timeout must resolve to a state instead of hanging the checks",
)

console.log("parser checks passed")
console.log(`fixture: ${parsed.length} containers -> ${parsed.map((item) => `${item.name}:${item.state}`).join(", ")}`)
console.log(`live: kind=${live.kind} detail=${live.detail || "-"} containers=${live.containers.length}`)
console.log(`engine: ${engine} actions=${availableRuntimeActions(engine).join(",") || "-"}`)
