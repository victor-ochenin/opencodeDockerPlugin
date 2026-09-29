# opencode-docker-panel

Панель контейнеров Docker для бокового сайдбара OpenCode 2.

Плагин добавляет себя в слот `sidebar.content` и опрашивает `docker ps --all --format "{{json .}}"`. Панель только читает состояние: показывает, что запущено, какие порты проброшены и сколько контейнер работает. Она ничего не запускает, не останавливает и не выполняет внутри контейнеров.

English version of this file: [README.md](README.md)

## Что показывает панель

```text
Docker (3)
• chroma      127.0.0.1:8000  127.0.0.1:8001
• postgres     0.0.0.0:5432->5432/tcp
• worker-old   Exited (0) 2 days ago
```

Цвет точки зависит от состояния: зелёный для `running`, жёлтый для `paused` и `restarting`, приглушённый для остальных. Сначала идут запущенные, внутри — по убыванию `CreatedAt`, поэтому список не прыгает между опросами. Больше десяти строк обрезается строкой `N more`. Клик по заголовку сворачивает и разворачивает список.

| Состояние | Что видно в панели |
|---|---|
| Docker работает, есть контейнеры | `Docker (N)` и по строке на контейнер |
| Docker работает, контейнеров нет | `no containers` |
| Docker Desktop не запущен | `docker desktop not running` |
| Docker не установлен | `docker not installed` |
| `docker ps` не ответил вовремя | последние известные строки с пометкой `stale` |
| Нет прав на сокет Docker | `no permission to talk to docker` |

Остановленный или отсутствующий Docker — это нормальное состояние, а не поломка плагина, поэтому оно показывается приглушённой строкой, а не ошибкой. При таймауте панель сохраняет последние известные данные, а не очищается.

## Требования

- Рантайм OpenCode 2 со слотами плагинов (`opencode2`)
- `docker` в `PATH`: Docker Desktop на Windows, Docker Engine на Linux и macOS
- Node.js 22 или новее для запуска проверки парсера

## Структура

```text
index.ts      серверная точка входа: id плагина и setup
tui.ts        CLI-точка входа: регистрация слота сайдбара
panel.tsx     Solid-компонент: заголовок, строки, состояния
docker.ts     запуск docker ps, разбор и сортировка вывода
types.ts      типы контейнера и состояния
scripts/      проверка парсера
fixtures/     сохранённый вывод docker ps для проверки
```

## Установка

Схема автообнаружения ожидает `index.ts` и `tui.ts` внутри папки плагина в конфиг-каталоге OpenCode:

```text
~/.config/opencode/plugins/docker-panel/
```

На Windows конфиг-каталог это `%USERPROFILE%\.config\opencode\plugins\docker-panel\`.

Копирование файлов из рабочей копии:

```powershell
$src = "$HOME\Desktop\Projects\Test\opencodeDockerPlugin"
$dst = "$HOME\.config\opencode\plugins\docker-panel"
New-Item -ItemType Directory -Force -Path $dst | Out-Null
Copy-Item "$src\*.ts","$src\*.tsx","$src\package.json" -Destination $dst -Force
```

Плагины из конфиг-каталога обнаруживаются автоматически, правка конфига не обязательна. Чтобы передать опции, зарегистрируй папку в `cli.json`:

```jsonc
{
  "$schema": "https://opencode.ai/v2/cli.json",
  "plugins": [{ "package": "./plugins/docker-panel", "options": { "intervalMs": 3000 } }]
}
```

После копирования или правки файлов перезапусти TUI.

## Опции

| Опция | По умолчанию | Примечания |
|---|---|---|
| `intervalMs` | `3000` | Интервал опроса, ограничивается диапазоном 1000..60000 |

## Проверка

```sh
npm run check
```

```text
parser checks passed
fixture: 3 containers -> chroma:running, postgres:running, worker-old:exited
live: kind=ok detail=- containers=2
```

Проверка на фикстуре подтверждает сортировку, разбор портов, нормализацию имён, обработку лишних данных и устойчивость к битым строкам, затем делает один живой вызов `docker ps` и печатает его состояние. Для части с фикстурой не нужны ни Docker, ни запущенный OpenCode.

Проверка типов:

```sh
npm install
npx tsc --noEmit
```

## Ограничения

- OpenCode 2 находится в бета-фазе, поэтому имена слотов и форма цветовых токенов темы могут измениться. Цвета резолвятся с запасными вариантами именно по этой причине; после подтверждения формы токенов заголовок можно закрепить на литералах.
- Опрос порождает `docker ps` с интервалом. На машине с сотнями контейнеров подними `intervalMs` до 5000 или выше.
- Нет просмотра логов, exec, запуска и остановки, группировки по compose и истории перезапусков. Это отдельные возможности, и здесь они намеренно вне области.

## Лицензия

MIT
