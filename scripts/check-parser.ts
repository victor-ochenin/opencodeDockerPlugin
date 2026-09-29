import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

import { parseDockerPs, runDockerPs } from "../docker.ts"

const fixturePath = fileURLToPath(new URL("../fixtures/docker-ps.jsonl", import.meta.url))

const fixture = await readFile(fixturePath, "utf8")
const parsed = parseDockerPs(fixture)

assert.equal(parsed.length, 3, "all three fixture containers must parse")
assert.deepEqual(
  parsed.map((item) => item.name),
  ["chroma", "postgres", "worker-old"],
  "running first, then newest CreatedAt",
)
assert.equal(parsed[0]?.ports.length, 2, "chroma exposes two ports")
assert.equal(parsed[0]?.ports[0], "127.0.0.1:8000")
assert.equal(parsed[2]?.running, false, "exited is not running")
assert.equal(parsed[2]?.ports.length, 0, "exited container has no ports")
assert.equal(parsed[0]?.name, "chroma", "leading slash stripped from the name")

const dirty = `garbage line\n\n${fixture}\n{"broken":\n{"Names":""}\n`
assert.equal(parseDockerPs(dirty).length, 3, "broken lines are skipped, valid ones still parse")
assert.deepEqual(parseDockerPs(""), [], "empty output yields an empty list")
assert.equal(parseDockerPs('{"Names":"/solo","State":"running"}').length, 1, "minimal record still parses")

const live = await runDockerPs()
assert.ok(
  ["ok", "empty", "unavailable", "stale"].includes(live.kind),
  `unexpected live status: ${live.kind}`,
)

console.log("parser checks passed")
console.log(`fixture: ${parsed.length} containers -> ${parsed.map((item) => `${item.name}:${item.state}`).join(", ")}`)
console.log(`live: kind=${live.kind} detail=${live.detail || "-"} containers=${live.containers.length}`)
