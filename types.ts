export type DockerStateKind = "ok" | "empty" | "unavailable" | "stale"

export type ContainerAction = "start" | "restart" | "stop" | "down"

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
