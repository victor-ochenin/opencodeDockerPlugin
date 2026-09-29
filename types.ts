export type DockerStateKind = "ok" | "empty" | "unavailable" | "stale"

export interface Container {
  id: string
  name: string
  image: string
  state: string
  status: string
  ports: string[]
  createdAt: number
  running: boolean
}

export interface DockerState {
  kind: DockerStateKind
  containers: Container[]
  detail: string
  at: number
}
