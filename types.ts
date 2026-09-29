export type DockerStateKind = "ok" | "empty" | "unavailable" | "stale"

export interface Container {
  name: string
  image: string
  state: string
  status: string
  ports: string[]
  createdAt: number
}

export interface DockerState {
  kind: DockerStateKind
  containers: Container[]
  detail: string
}
