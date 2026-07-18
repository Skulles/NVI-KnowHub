# NVI KnowHub — server stack

Backend и админка для контента desktop-приложения: Express API, BlockNote admin SPA, nginx, Docker.

## Состав

| Путь | Назначение |
|------|------------|
| `server/` | Express API + раздача `/content`, черновики, publish |
| `admin/` | React-админка (редактор статей) |
| `nginx/` | Reverse proxy: `/admin`, `/api`, `/content`, `/releases` |
| `docker-compose.yml` | Production: server + nginx, общий data volume |
| `data/` | Runtime (gitignored): drafts, content, sessions |

## Локальный запуск (без Docker)

```bash
cp .env.example .env   # задайте ADMIN_PASSWORD и при необходимости порты

cd server && npm install && npm run dev
# в другом терминале:
cd admin && npm install && npm run dev
```

Подробности окружения — в `server/.env.example` / корневом `server-stack/.env.example`.

## Документация по эксплуатации

- [SERVER_NOTES.md](./SERVER_NOTES.md) — пути на сервере, health, troubleshooting
- [UPDATE.md](./UPDATE.md) — выкладка без Docker

Desktop-приложение ходит на `{KNOWHUB_SERVER_URL}/content/manifest.json` и каталог `/releases/` для автообновлений.
