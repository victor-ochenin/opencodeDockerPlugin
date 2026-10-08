# What the panel does

![The panel in a session sidebar](demo.gif)

![An unstarted compose stack from the agent directory](demo2.gif)

Русская версия этого файла: [features.ru.md](features.ru.md)

## Running and stopped containers

```text
Docker (2)
• api           0.0.0.0:8080->8080/tcp · shop
1 more, click for all
Up stack · storefront is not running here
```

The dot is coloured by container state: green for `running`, yellow for `paused` and `restarting`,
red for `dead`, muted for everything else.

The panel draws running containers and nothing else, at most five rows in the order docker reports
them, so the list does not jump between polls. Stopped containers never get a row of their own: the
header opens a dialog with every container, and picking one there opens the same actions as a click
on its row. A line under the rows always opens the full list, because that list is also where `Stop Docker Desktop`
lives. It reads `1 more, click for all` when the five row limit hides something and `2 containers, click
for all` when everything is already shown.
With rows to show, the header collapses and expands them instead.

`Pin` in a container's menu keeps that container visible whatever its state, and it spends the five
row budget when it happens to run, so pinning everything shows everything. A pin is stored by the
host, so it survives a TUI restart and applies to every session; `Unpin` in the same menu drops it.
Pinned rows are marked `pinned` next to their ports and project.

| State                              | Panel output                                  |
| ---------------------------------- | --------------------------------------------- |
| Docker up with containers          | `Docker (N)` plus one row per container       |
| Docker up, nothing created         | `no containers`                               |
| Docker Desktop not running         | a clickable `Start Docker Desktop` line       |
| Docker Desktop CLI plugin missing  | no buttons, nothing offered                   |
| Docker not installed               | `docker not installed`, no buttons            |
| `docker ps` timed out              | last known rows with a `stale` marker         |
| No permission on the Docker socket | `no permission to talk to docker`, no buttons |

A missing or stopped Docker is a normal state, not a plugin failure. A poll that could not reach
docker, whether a timeout or a dead daemon, keeps the last known rows with a `stale` marker instead of
blanking the panel. A stopped engine is not treated that way: every container really is down, so the
rows go and the panel says so instead of showing containers that are not serving anything.

## Actions per container state

| Container state                   | Actions offered                                                                                                                        |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `running`, `restarting`, `paused` | `Restart`, `Stop`, and `Down` when the container belongs to a compose project                                                          |
| `created`, `exited`, `dead`       | `Start`, `Up stack` when the agent directory holds a matching compose file, and `Down` when the container belongs to a compose project |
| anything else                     | none                                                                                                                                   |

| Action   | Command                                       |
| -------- | --------------------------------------------- |
| Start    | `docker start -- <name>`                      |
| Up stack | `docker compose -f <file> -p <project> up -d` |
| Restart  | `docker restart -- <name>`                    |
| Stop     | `docker stop -- <name>`                       |
| Down     | `docker compose -p <project> down`            |

`--` is not optional: a container name may start with a dash, and without the separator docker reads
it as a flag. Every option shows its exact command in the dialog footer, so the destructive one is
never a surprise.

A container whose image is not on the machine pulls that image first, so it takes much longer to
reach `running` than the poll interval and the panel will show it as stopped for a while before it
appears. Nothing is wrong, and no retry is issued.

The result of every action arrives as a toast, and the panel refreshes immediately instead of
waiting for the next poll. While a command runs the header shows `working` and further clicks are
ignored, so a double click cannot launch two commands.

## Compose stacks

`Up stack` starts a whole compose project instead of one container, using the compose file that sits
in the agent directory. That file is executable content: it carries `build`, `command` and
`entrypoint`, which is why the dialog shows the exact command before you run it, and why `up` needs
no confirmation while `down` does.

The button appears only when the file provably belongs to the project of the container you clicked.
The project name is read the way compose v2 reads it: a top-level `name:` if there is one, otherwise
the name of the directory holding the file. It must equal the `com.docker.compose.project` label on
the container, and the container must not be running already. Anything else and the button is simply
absent, because a wrong stack is worse than no button.

A stack that has no containers at all is the normal state of something never started, and it gets
its own way in. When the agent directory holds a compose file and no container on the machine
carries that project label, the panel adds a line under the rows:

```text
Up stack · storefront is not running here
```

Clicking it asks once, showing the exact command before anything runs, because a compose file is
executable content and this stack has no container to name it. The line disappears as soon as one
container of that project shows up, because from then on the per-container `Up stack` is the way in.
Nothing is offered for a Dockerfile on its own: there is no image name to run, so the panel would be
guessing.

The project is passed twice, as `-f <file>` and `-p <project>`. The name inside a compose file can
be templated or overridden by the environment, and `-p` makes sure the stack you start is the one
the panel was already showing rather than a second copy of it.

Because `-p` replaces compose's own derivation, the panel normalizes a directory name the way compose
would: lowercased, with everything outside letters, digits, dash and underscore dropped, and whatever
is left before the first letter dropped too. A directory called `CarManufacturersMVC` is started as
`carmanufacturersmvc`, which is the name compose produces on its own. A name that normalizes to
nothing, or a `name:` line compose would reject, gets no button at all rather than a command that can
only fail.

Candidate file names are tried in compose's own order: `compose.yaml`, `compose.yml`,
`docker-compose.yaml`, `docker-compose.yml`. The first file that exists wins even when it declares
another project, because that is the file compose itself would use, so falling through to the next
candidate would offer a stack the CLI ignores.

`Down` runs `docker compose down` against the compose project the container carries in its labels,
which stops every container of that project and removes their networks. Volumes are kept, and the
confirmation dialog says so. A container with no compose project never gets the option, and
`buildArgs` refuses it as well.

## Logs

`Logs` in the same menu replaces the dialog contents with a log view for that container, so the log
and the actions share one window. It closes with `esc` or by clicking the footer line.

The view is `docker logs --timestamps --tail 200 -- <name>`, refreshed every two seconds while it is
open. Docker interleaves the container's two streams, so the two buffers are parsed separately and
merged back by timestamp; without that the log reads all of stdout first. ANSI sequences and lone
`CR` are stripped, because the terminal would otherwise run them as control codes. A fixed window of
fifteen lines is scrolled with the mouse wheel.

## Docker Desktop

The panel can start and stop Docker Desktop itself. Both actions go through `docker desktop`, the
CLI plugin that ships with Docker Desktop.

| Action                 | Where it lives                                            | Command                |
| ---------------------- | --------------------------------------------------------- | ---------------------- |
| `Start Docker Desktop` | a line in the sidebar, shown only when Desktop is stopped | `docker desktop start` |
| `Stop Docker Desktop`  | the last entry of the container list                      | `docker desktop stop`  |

![Starting Docker Desktop](demo3.gif)

`Start` asks first, the same as `Stop`. A cold start brings up a virtual machine and starts consuming
memory, so a misclick is not free. The panel shows `working` for the whole transition rather than
dropping the indicator as soon as the command returns.

`Stop` always asks first, and the confirmation names every running container the panel can see,
because `docker desktop stop` ends the engine and every container goes down with it, across every
project, not just the one you clicked. The moment the command starts, the rows and the header count go
away and only `Docker working` is left, so the sidebar never shows containers that are on their way
down.

![Stopping Docker Desktop](demo4.gif)

The container list stays reachable when Docker is down and there are no containers at all, because
that is exactly when `Stop` matters. An early exit on an empty list used to show a `no containers`
toast there, and it would have hidden the only way to turn the engine back on.

A log window open at the moment of the stop keeps its last lines and stops polling, since every
`docker logs` call against a stopped engine fails anyway. Opening a container from the list while
Desktop is stopped offers only `Start Docker Desktop`, and nothing at all when the CLI plugin is
missing or the engine state cannot be read.

A stopped engine is read from the container poll, not from a separate probe, because `docker ps`
already says so: the Desktop backend owns the named pipe `dockerDesktopLinuxEngine`, and when it is
missing `docker ps` fails with `open //./pipe/dockerDesktopLinuxEngine: The system cannot find the file
specified` in about a quarter second. `docker desktop status` needs four seconds to admit the same
thing, because the CLI plugin waits on that same pipe before giving up.

The probe is still there for the cases the poll cannot place. `permission denied` on the pipe means a
locked socket rather than a stopped engine, and `docker not installed` means no CLI at all, so those
go to `docker desktop status`. It reports nothing when Docker is stopped: it exits 1 and writes
`Could not retrieve status. Is Docker Desktop running?` to stderr plus `You can start Docker Desktop
by running 'docker desktop start'.` to stdout. The panel reads the exit code together with that
wording, and treats anything it cannot place as unknown rather than guessing. No button is offered on
an unknown state, and the plugin version is never compared, because the CLI plugin is updated
separately from the app.

## Known limits

- The sidebar draws containers that are `running` and nothing else. A `paused` or `restarting`
  container gets no row even though docker still counts it as alive; pin it to see it.
- OpenCode 2 is in beta, so slot names and theme tokens may change.
- A repaint workaround resets the collapsed state and closes an open log view when the container
  list really changes.
- The poll spawns `docker ps` on an interval. On a host with hundreds of containers, raise
  `intervalMs` to 5000 or higher.
- At most five running containers get a row, and the five is a constant rather than an option: a
  host with thirty containers shows five and leaves the rest to the dialog. Pinning is the only way
  to promote a sixth.
- The sidebar itself cannot scroll, so the containers past the five live in the dialog rather than
  in the panel.
- No exec, no volume or image actions, no restart history. `Down` is offered per container but acts
  on the whole compose project. The log view is a fixed window over the last 200 lines with no
  history beyond that.
- `Up stack` only ever starts a stack whose compose file sits in the agent directory. A project that
  was created somewhere else can still be torn down with `Down`, but it can only be started with
  `Start` on a single container.
- `Up stack` may stay hidden when the compose file declares its project in a form the panel cannot
  read, such as an indented `name:` or a quoted value. That is a refusal rather than a wrong stack.
- Actions are mouse-only; the plugin registers no keymap layer.
- Docker Desktop control is Windows only, and needs the `docker desktop` CLI plugin. Without it the
  panel offers nothing. There is no fallback to the app executable: that path cannot be tested on a
  machine where the plugin is present.
- Between Docker Desktop starting and its backend creating the named pipe there is a short window
  where the panel offers `Start Docker Desktop` on an engine that is already coming up. Pressing it is
  harmless, the command returns without doing anything.
- `docker desktop status` takes up to about four and a half seconds to answer when Docker is stopped,
  because the plugin waits on a pipe that is not answering. The panel's probe allows nine seconds so
  that a provable `stopped` is not cut short and reported as unknown.
- The npm package ships precompiled ESM, not TypeScript sources. OpenCode transforms plugin sources
  with OpenTUI's Solid transform, which skips every path under `node_modules`, so a plugin installed
  from npm has to arrive as JavaScript or Bun compiles its JSX against React instead. Do not ship
  `.tsx`.
- `solid-js`, the OpenTUI packages and the OpenCode SDK are optional peers. npm therefore never
  writes a second copy of them next to the plugin, which is what the host rewrites its own imports
  to. Making them hard dependencies puts a second Solid runtime on disk and breaks rendering.
