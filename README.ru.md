# opencode-docker-panel

[![CI](https://github.com/victor-ochenin/opencodeDockerPlugin/actions/workflows/ci.yml/badge.svg)](https://github.com/victor-ochenin/opencodeDockerPlugin/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/opencode-docker-panel.svg)](https://www.npmjs.com/package/opencode-docker-panel)

Панель контейнеров Docker для бокового сайдбара OpenCode 2, с управлением Docker Desktop.

![Панель Docker в сайдбаре сессии с незапущенным compose-стеком из каталога агента](docs/demo2.gif)

Что она умеет, с демонстрациями: [docs/features.ru.md](docs/features.ru.md). English version of this file:
[README.md](README.md), demos in English — [docs/features.md](docs/features.md).

## Требования

- Рантайм OpenCode 2 со слотами плагинов (`opencode2`)
- `docker` в `PATH`. Запуск и остановка Docker Desktop требуют CLI-плагина `docker desktop` и работают только на Windows

## Установка

### Вариант A: пусть сделает LLM

Вставь это в любого агента (Claude Code, OpenCode, Cursor и так далее):

```text
Установи плагин панели Docker opencode-docker-panel по инструкции
https://github.com/victor-ochenin/opencodeDockerPlugin#installation
```

### Вариант B: вручную

Добавь плагин в `~/.config/opencode/cli.json`. Если файла нет, создай его, и всё, что в нём уже есть, сохрани.

```jsonc
{
  "$schema": "https://opencode.ai/v2/cli.json",
  "plugins": [{ "package": "opencode-docker-panel", "options": { "intervalMs": 3000 } }]
}
```

Два места, на которых обычно спотыкаются, поэтому скажу прямо:

- **Запись идёт в `cli.json`, а не в `opencode.json`.** Плагин только терминальный: он рисуется в сайдбаре, а `cli.json` читает терминальный клиент.
- **Логиниться не нужно, провайдера настраивать не нужно.** Плагин говорит только с локальным `docker` и больше ни с чем.

После этого перезапусти TUI: хост сам поставит пакет при следующем старте, копировать и собирать ничего не нужно.

Если нужна зафиксированная версия, укажи её явно: `{ "package": "opencode-docker-panel@0.5.0" }`.

### Проверка

CLI-проверки у этого плагина нет: он рисуется в терминальном интерфейсе, поэтому `opencode run` его не покажет никогда. Проверяй в TUI.

1. `docker ps` возвращает хотя бы один контейнер. Если команда падает, панели нечего рисовать, и она так и скажет.
2. Перезапусти TUI и открой сессию.
3. В сайдбаре появится заголовок `Docker` со счётчиком контейнеров. Запущенные контейнеры станут строками, не больше пяти, а под ними — строка `N more, click for all`, если что-то ещё скрыто. Если Docker остановлен, под заголовком будет кликабельная строка `Start Docker Desktop` вместо текста.
4. Кликни по `Docker`, чтобы свернуть список, и ещё раз, чтобы открыть полный. Выбери контейнер — откроется меню его действий, а последней позицией в том же списке будет `Stop Docker Desktop`.

Останови Docker Desktop — вместо текста в сайдбаре появится кликабельная строка `Start Docker Desktop`.

Если заголовок так и не появился, плагин не загрузился: проверь, что запись лежит в `cli.json` в секции `plugins`, и посмотри `~/.local/share/opencode/log/opencode.log` на предмет ошибки загрузки.

## Опции

| Опция | По умолчанию | Примечания |
|---|---|---|
| `intervalMs` | `3000` | Интервал опроса, ограничивается диапазоном 1000..60000 |

## Ограничения

- `Stop Docker Desktop` гасит движок, поэтому останавливаются все контейнеры всех проектов.
- Пакет на npm уходит предкомпилированным ESM, а не исходниками TypeScript. Не отдавай `.tsx`, почему — в [docs/features.ru.md](docs/features.ru.md).

Всё остальное — в [docs/features.ru.md](docs/features.ru.md).

## Изменения

Версии и даты в [CHANGELOG.md](CHANGELOG.md).

## Лицензия

MIT