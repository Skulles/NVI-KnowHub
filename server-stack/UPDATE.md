# Обновление серверной части KnowHub

Инструкция для деплоя обновлений без Docker на сервер `apps.shikarno.space`, где KnowHub доступен по пути `/nvi/knowhub`.

## Схема на сервере

- Код релизов: `/opt/nvi-knowhub/releases/<version>`
- Активная версия: `/opt/nvi-knowhub/current`
- Данные, статьи и релизы приложения: `/var/lib/nvi-knowhub`
- Env-файл сервиса: `/etc/nvi-knowhub.env`
- Systemd-сервис: `nvi-knowhub.service`

Данные лежат отдельно от кода, поэтому обновление не затирает опубликованные статьи и файлы релизов.

## Подготовить архив локально

Выполнить на локальной машине из корня проекта:

```bash
cd /Users/slls/Desktop/NVI-KnowHub-portable

VERSION=$(date +%Y%m%d-%H%M%S)
COPYFILE_DISABLE=1 tar \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='server-stack/server/node_modules' \
  --exclude='server-stack/admin/node_modules' \
  --exclude='server-stack/server/dist' \
  --exclude='server-stack/admin/dist' \
  --exclude='.env' \
  --exclude='server-stack/.env' \
  -czf "/tmp/nvi-knowhub-$VERSION.tar.gz" .

scp "/tmp/nvi-knowhub-$VERSION.tar.gz" root@apps.shikarno.space:/tmp/
echo "$VERSION"
```

Запомнить значение `VERSION`, оно понадобится на сервере.

## Установить обновление на сервере

Выполнить на сервере, подставив значение `VERSION` из предыдущего шага:

```bash
VERSION=20260611-232748

mkdir -p "/opt/nvi-knowhub/releases/$VERSION"
tar -xzf "/tmp/nvi-knowhub-$VERSION.tar.gz" -C "/opt/nvi-knowhub/releases/$VERSION"

cd "/opt/nvi-knowhub/releases/$VERSION/server-stack/server"
npm ci
npm run build

cd "/opt/nvi-knowhub/releases/$VERSION/server-stack/admin"
npm ci
BASE_PATH=/nvi/knowhub npm run build

ln -sfn "/opt/nvi-knowhub/releases/$VERSION" /opt/nvi-knowhub/current
chmod -R a+rX "/opt/nvi-knowhub/releases/$VERSION"
systemctl restart nvi-knowhub
systemctl status nvi-knowhub --no-pager
```

Перед переключением `current` убедиться, что админка собралась:

```bash
test -f "/opt/nvi-knowhub/releases/$VERSION/server-stack/admin/dist/index.html"
```

## Проверить после обновления

```bash
curl -i http://127.0.0.1:3000/nvi/knowhub/health
curl -I https://apps.shikarno.space/nvi/knowhub/admin/
curl -I https://apps.shikarno.space/nvi/knowhub/content/manifest.json
```

Админка должна открываться по адресу:

```text
https://apps.shikarno.space/nvi/knowhub/admin/
```

## Откатиться на прошлую версию

Посмотреть доступные релизы:

```bash
ls -la /opt/nvi-knowhub/releases
```

Переключить `current` на нужную предыдущую версию:

```bash
PREVIOUS_VERSION=20260607-XXXXXX

ln -sfn "/opt/nvi-knowhub/releases/$PREVIOUS_VERSION" /opt/nvi-knowhub/current
systemctl restart nvi-knowhub
systemctl status nvi-knowhub --no-pager
```

## Очистить старые архивы и релизы

После проверки можно удалить архив из `/tmp`:

```bash
rm -f "/tmp/nvi-knowhub-$VERSION.tar.gz"
```

Старые релизы можно удалить вручную, оставив хотя бы один предыдущий для отката:

```bash
rm -rf /opt/nvi-knowhub/releases/СТАРАЯ_ВЕРСИЯ
```

