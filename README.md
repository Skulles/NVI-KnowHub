# NVI KnowHub

Кроссплатформенная desktop-база знаний (Electron + React + TypeScript). Показывает HTML-инструкции и встроенные инструменты (React). Работает офлайн; при старте синхронизирует контент и проверяет обновления приложения с сервера.

Платформы: Windows, macOS, Linux.

## Требования

- Node.js **≥ 20**
- npm 10+
- Для `npm run build` — доступ к `KNOWHUB_SERVER_URL` (сеть) и, на macOS, утилита `sips` для иконки Windows

## Быстрый старт

```bash
cp .env.example .env
# Задайте KNOWHUB_SERVER_URL (локальный сервер или staging/prod)

npm install
npm run dev
```

`npm run dev` запускает `scripts/dev.js`, который снимает `ELECTRON_RUN_AS_NODE` из окружения. Эта переменная часто выставляется Electron-based IDE (VS Code / Cursor) и ломает `require('electron')` в main-процессе.

Полезные команды:

| Команда | Назначение |
|---------|------------|
| `npm run dev` | Dev: electron-vite + окно Electron |
| `npm run typecheck` | Проверка типов (main/preload + renderer) |
| `npm run lint` | ESLint по `src/**` |
| `npm run content:pull` | Тянет статьи с сервера → `resources/content/` |
| `npm run winbox:download` | Качает WinBox → `resources/winbox/` |
| `npm run build` | Иконки + content + WinBox + сборка + installer |
| `npm run build:unpack` | Сборка без installer (`--dir`) |
| `npm run preview` | Превью собранного приложения |

## Переменные окружения

Скопируйте `.env.example` → `.env` (файл в git не коммитится).

| Переменная | Обязательность | Описание |
|------------|----------------|----------|
| `KNOWHUB_SERVER_URL` | Да для sync/build | Базовый URL без `/` в конце. В **main** вшивается на этапе сборки (`electron.vite.config.ts`) |
| `KNOWHUB_RELEASES_URL` | Нет | Каталог релизов для electron-updater; по умолчанию `{KNOWHUB_SERVER_URL}/releases/` |
| `WINBOX_DOWNLOAD_VERSION` | Нет | Версия WinBox для `winbox:download` |

Production-сборка должна использовать `https://`. Для локальной разработки сервера допустим `http://localhost:3000`.

## Архитектура

```
src/
├── main/          Electron main (Node): окно, IPC, sync, updater, WinBox, ping
├── preload/       contextBridge → window.api (единственный мост в renderer)
├── renderer/      React SPA (Vite)
└── shared/        Общие типы и контракт ElectronAPI
```

Точки входа:

| Роль | Исходник | Сборка |
|------|----------|--------|
| Main | `src/main/index.ts` | `out/main/index.js` (`package.json` → `main`) |
| Preload | `src/preload/index.ts` | `out/preload/index.js` |
| Renderer | `src/renderer/index.html` | Vite / `out/renderer` |

Алиасы импортов в renderer: `@renderer` → `src/renderer/src`, `@shared` → `src/shared`.

Безопасность окна: `sandbox`, `contextIsolation`, без `nodeIntegration`. Внешние URL и пути к HTML контента фильтруются в `src/main/safe.ts`.

### Контент

1. Seed: `resources/content/` (в репозитории — в основном `manifest.json`; HTML подтягивается `content:pull`).
2. Runtime: копия в `userData/content/`.
3. Sync: `contentSync.ts` сравнивает remote `manifest.json` и докачивает изменившиеся HTML.
4. Renderer получает `content:updated` через IPC и перечитывает манифест (Zustand).

Секция манифеста может иметь плоский `items` и/или `subsections`. Всегда используйте `flattenSectionItems` / `flattenManifestItems` из `src/shared/manifest.ts`.

### Инструменты (tools)

React-компоненты, зашитые в приложение (обновляются только новым релизом app):

1. Создайте `src/renderer/src/tools/YourTool/YourTool.tsx`
2. Зарегистрируйте в `src/renderer/src/tools/registry.tsx`
3. Добавьте в манифест item с `type: 'tool'` и нужным `toolId`

### IPC (`window.api`)

Контракт: `src/shared/api.ts` → реализация preload → хендлеры в main. Типизация: `src/renderer/src/env.d.ts`.

### Server stack

Каталог `server-stack/` — отдельный backend (Express API + BlockNote admin + nginx/Docker). См. [server-stack/README.md](server-stack/README.md).

## Сборка и публикация релизов

1. Поднимите `version` в корневом `package.json` (должна быть выше уже опубликованной).
2. Проверьте `.env` (`KNOWHUB_SERVER_URL`).
3. Собирайте на целевой ОС (NSIS / DMG / AppImage).
4. Загрузите из `dist/` установщики **и** `latest*.yml` (metadata для electron-updater) в каталог `/releases/` на сервере.

Подпись сборок по умолчанию отключена (`CSC_IDENTITY_AUTO_DISCOVERY=false`). Для signed release уберите флаг и настройте сертификаты платформы.

## Что не коммитить

- `.env`, `server-stack/.env`, `server-stack/data/`
- `node_modules/`, `out/`, `dist/`
- Бинарники WinBox в `resources/winbox/` (кроме `.gitkeep`)
- HTML seed в `resources/content/*.html` (кроме манифеста — см. `.gitignore`)

Лицензия: `UNLICENSED` / `private: true` — внутренний проект NVI.
