import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

import { parseDockerPs, runDockerPs, shortReason } from "../docker.ts"
import { availableActions, buildArgs } from "../commands.ts"
import { keepContainers } from "../poll.ts"
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

const bare: Container = { name: "lonely", image: "img", state: "running", status: "Up 2 hours", ports: [], createdAt: 0 }
assert.deepEqual(buildArgs("stop", bare), ["stop", "--", "lonely"], "name is passed after the flag separator")
assert.deepEqual(buildArgs("restart", compose), ["restart", "--", "web"])
assert.deepEqual(buildArgs("start", bare), ["start", "--", "lonely"])
assert.deepEqual(buildArgs("down", compose), ["compose", "-p", "socnot", "down"], "down targets the compose project")
assert.throws(() => buildArgs("down", bare), /no compose project/, "down is refused without a compose project")

assert.deepEqual(availableActions(compose), ["restart", "stop", "down"], "destructive action goes last")
assert.deepEqual(availableActions(bare), ["restart", "stop"], "no down without a compose project")
assert.deepEqual(availableActions({ ...bare, state: "exited" }), ["start"], "a stopped container can only be started")
assert.deepEqual(availableActions({ ...bare, state: "dead" }), ["start"], "a dead container can only be started")
assert.deepEqual(availableActions({ ...bare, state: "removing" }), [], "an unknown state offers nothing")

const previous = parsed
const ok: DockerState = { kind: "empty", containers: [], detail: "no containers" }
assert.equal(keepContainers(previous, ok).length, 0, "a successful empty poll must not resurrect old rows")
assert.equal(keepContainers(previous, { kind: "stale", containers: [], detail: "docker did not respond" }), previous)
assert.equal(keepContainers(previous, { kind: "unavailable", containers: [], detail: "boom" }), previous)

const live = await runDockerPs()
assert.ok(["ok", "empty", "unavailable", "stale"].includes(live.kind), `unexpected live status: ${live.kind}`)

console.log("parser checks passed")
console.log(`fixture: ${parsed.length} containers -> ${parsed.map((item) => `${item.name}:${item.state}`).join(", ")}`)
console.log(`live: kind=${live.kind} detail=${live.detail || "-"} containers=${live.containers.length}`)
