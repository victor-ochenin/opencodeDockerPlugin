/**
 * `stopped` comes from the `docker desktop` probe, not from `docker ps`: the latter fails to connect
 * on a stopped engine and reports `unavailable`, which also covers a missing CLI and no socket access
 */
export type DockerStateKind = "ok" | "empty" | "unavailable" | "stale" | "stopped"

export type ContainerAction = "start" | "up" | "restart" | "stop" | "down"

export interface Container {
  name: string
  image: string
  state: string
  status: string
  ports: string[]
  createdAt: number
  composeProject?: string
  composeService?: string
}

export interface DockerState {
  kind: DockerStateKind
  containers: Container[]
  detail: string
}
