# Памятка по серверу KnowHub

Памятка для установки без Docker на `apps.shikarno.space`, где KnowHub опубликован по пути `/nvi/knowhub`.

## Публичные адреса

- Админка: `https://apps.shikarno.space/nvi/knowhub/admin/`
- Проверка здоровья: `https://apps.shikarno.space/nvi/knowhub/health`
- Manifest контента: `https://apps.shikarno.space/nvi/knowhub/content/manifest.json`
- Папка опубликованного контента: `https://apps.shikarno.space/nvi/knowhub/content/`
- Папка релизов приложения: `https://apps.shikarno.space/nvi/knowhub/releases/`

Для desktop-приложения значение переменной должно быть:

```bash
KNOWHUB_SERVER_URL=https://apps.shikarno.space/nvi/knowhub
```

## Где что хранится на сервере

- Активная версия кода: `/opt/nvi-knowhub/current`
- Все загруженные версии кода: `/opt/nvi-knowhub/releases/`
- Серверная часть активной версии: `/opt/nvi-knowhub/current/server-stack/server`
- Собранная админка активной версии: `/opt/nvi-knowhub/current/server-stack/admin/dist`
- Данные KnowHub: `/var/lib/nvi-knowhub`
- Черновики статей: `/var/lib/nvi-knowhub/drafts`
- Опубликованные статьи и `manifest.json`: `/var/lib/nvi-knowhub/content`
- Релизы desktop-приложения: `/var/lib/nvi-knowhub/releases`
- Переменные окружения сервиса: `/etc/nvi-knowhub.env`
- Сессии админки (переживают рестарт сервера): `/var/lib/nvi-knowhub/sessions.json`
- Systemd-сервис: `/etc/systemd/system/nvi-knowhub.service`
- Nginx-конфиг сайта: `/etc/nginx/sites-available/default`
- Активный nginx-конфиг: `/etc/nginx/sites-enabled/default`

## Что отдаёт nginx

- `/nvi/knowhub/admin/` отдаёт статическую сборку админки из `/opt/nvi-knowhub/current/server-stack/admin/dist`
- `/nvi/knowhub/api/` проксируется в Node.js сервер на `http://127.0.0.1:3000`
- `/nvi/knowhub/content/` отдаёт файлы из `/var/lib/nvi-knowhub/content`
- `/nvi/knowhub/releases/` отдаёт файлы из `/var/lib/nvi-knowhub/releases`

Важно: на этом сервере публичный порт `443` занят `xray`, а nginx принимает HTTPS через unix-сокет. Поэтому для KnowHub нужно добавлять только `location` в существующий блок `server_name apps.shikarno.space`, не создавая новый `listen 443`.

## Если админка отдаёт 500

Ошибка `500 Internal Server Error` на `/nvi/knowhub/admin/` приходит от nginx, не от Node.js. API и контент при этом могут работать нормально.

Проверить на сервере:

```bash
readlink -f /opt/nvi-knowhub/current
ls -la /opt/nvi-knowhub/current/server-stack/admin/dist/
sudo -u www-data test -r /opt/nvi-knowhub/current/server-stack/admin/dist/index.html && echo readable || echo not_readable
grep -A5 'knowhub/admin' /etc/nginx/sites-available/default
tail -20 /var/log/nginx/error.log
```

Частые причины:

1. `admin/dist` не собран в активном релизе — после `npm run build` в `server-stack/admin` должны появиться `index.html` и папка `assets/`.
2. `current` указывает на релиз, где сборка админки падала или не запускалась.
3. nginx не может прочитать файлы — нужны права `chmod -R a+rX /opt/nvi-knowhub/releases`.
4. в nginx для админки стоит `alias` + `try_files ... /nvi/knowhub/admin/index.html` — такая связка часто даёт 500. Используйте конфиг из `server-stack/nginx/apps.shikarno.space.knowhub.conf` без `try_files`.

Если `dist` отсутствует:

```bash
cd /opt/nvi-knowhub/current/server-stack/admin
BASE_PATH=/nvi/knowhub npm run build
ls -la dist/
```

После правки nginx:

```bash
nginx -t
systemctl reload nginx
curl -I https://apps.shikarno.space/nvi/knowhub/admin/
```

## Полезные команды

Проверить статус сервера KnowHub:

```bash
systemctl status nvi-knowhub --no-pager
```

Посмотреть логи:

```bash
journalctl -u nvi-knowhub -n 100 --no-pager
journalctl -u nvi-knowhub -f
```

Перезапустить сервер KnowHub:

```bash
systemctl restart nvi-knowhub
```

Проверить nginx-конфиг и применить изменения:

```bash
nginx -t
systemctl reload nginx
```

Проверить локальный Node.js сервер:

```bash
curl -i http://127.0.0.1:3000/nvi/knowhub/health
```

Проверить публичные адреса:

```bash
curl -I https://apps.shikarno.space/nvi/knowhub/admin/
curl -I https://apps.shikarno.space/nvi/knowhub/content/manifest.json
curl -I https://apps.shikarno.space/nvi/knowhub/releases/
```

