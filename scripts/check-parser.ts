import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

import { parseDockerPs, runDockerPs, shortReason } from "../docker.ts"
import { availableActions, buildArgs } from "../commands.ts"
import { mergeLogLines, parseLogLines, runDockerLogs, sanitize } from "../logs.ts"
import { keepContainers, selectRows } from "../poll.ts"
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

assert.equal(shortReason("Cannot find the file specified"), "docker desktop not running")
assert.equal(shortReason("error during connect: is the server running?"), "no connection to docker")
assert.equal(shortReason("Got permission denied while trying to connect"), "no permission to talk to docker")
assert.equal(shortReason(""), "no connection to docker", "empty stderr falls back to a generic reason")
assert.equal(shortReason("x".repeat(80)).length, 60, "long reasons are truncated with an ellipsis")

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

const named = (name: string, state: string): Container => ({
  name,
  image: "img",
  state,
  status: state,
  ports: [],
  createdAt: 0,
})
// docker.ts already sorts running first, so the fixtures have to arrive in that order for the checks to mean anything.
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

const live = await runDockerPs()
assert.ok(["ok", "empty", "unavailable", "stale"].includes(live.kind), `unexpected live status: ${live.kind}`)

console.log("parser checks passed")
console.log(`fixture: ${parsed.length} containers -> ${parsed.map((item) => `${item.name}:${item.state}`).join(", ")}`)
console.log(`live: kind=${live.kind} detail=${live.detail || "-"} containers=${live.containers.length}`)
