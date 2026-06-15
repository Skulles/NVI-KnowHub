# Сборка и загрузка новой версии desktop-приложения

Инструкция для публикации новой версии NVI KnowHub на сервер `apps.shikarno.space`.

## Куда загружать релизы

На сервере релизы desktop-приложения хранятся здесь:

```bash
/var/lib/nvi-knowhub/releases
```

Публичный URL каталога:

```text
https://apps.shikarno.space/nvi/knowhub/releases/
```

Именно этот каталог использует `electron-updater`. Поэтому вместе с установщиком нужно загружать metadata-файлы `latest*.yml`, которые создаёт `electron-builder`.

## Подготовить `.env`

В корневом `.env` локального проекта должно быть:

```bash
KNOWHUB_SERVER_URL=https://apps.shikarno.space/nvi/knowhub
```

Если нужно явно задать каталог релизов:

```bash
KNOWHUB_RELEASES_URL=https://apps.shikarno.space/nvi/knowhub/releases
```

Обычно `KNOWHUB_RELEASES_URL` не нужен, потому что по умолчанию берётся `{KNOWHUB_SERVER_URL}/releases/`.

## Обновить версию приложения

Перед сборкой увеличить версию в `package.json`:

```json
{
  "version": "1.0.1"
}
```

Версия должна быть больше предыдущей опубликованной версии, иначе автообновление не предложит новый релиз.

## Собрать приложение

Выполнить локально из корня проекта:

```bash
cd /Users/slls/Desktop/NVI-KnowHub-portable
npm install
npm run typecheck
npm run build
```

Команда `npm run build` делает несколько шагов:

- скачивает опубликованный контент с `KNOWHUB_SERVER_URL` в `resources/content`;
- скачивает WinBox в `resources/winbox`;
- собирает Electron/Vite;
- запускает `electron-builder`;
- кладёт готовые артефакты в `dist/`.

Важно: собирать нужно на той ОС, для которой нужен установщик. Например, Windows-установщик обычно собирается на Windows, macOS `.dmg` — на macOS, Linux `AppImage` — на Linux.

## Какие файлы загружать

После сборки посмотреть содержимое `dist/`:

```bash
ls -la dist
```

Загрузить нужно установщики и metadata-файлы автообновления.

Для Windows обычно нужны:

- `NVI KnowHub Setup *.exe`
- `latest.yml`

Для macOS обычно нужны:

- `*.dmg` — для ручной установки
- `*.zip` — **обязателен** для автообновления (`electron-updater` не умеет обновляться из `.dmg`)
- `latest-mac.yml` — внутри должен быть URL на `.zip`, не на `.dmg`

Для Linux обычно нужны:

- `*.AppImage`
- `latest-linux.yml`

Если рядом есть файлы `.blockmap`, их тоже лучше загрузить: они нужны для дифференциального обновления.

## Загрузить релиз на сервер

Пример для загрузки всех релизных файлов из `dist/`:

```bash
cd /Users/slls/Desktop/NVI-KnowHub-portable

scp dist/*.yml root@apps.shikarno.space:/var/lib/nvi-knowhub/releases/
scp dist/*.blockmap root@apps.shikarno.space:/var/lib/nvi-knowhub/releases/
scp dist/*.exe root@apps.shikarno.space:/var/lib/nvi-knowhub/releases/
scp dist/*.dmg root@apps.shikarno.space:/var/lib/nvi-knowhub/releases/
scp dist/*.zip root@apps.shikarno.space:/var/lib/nvi-knowhub/releases/
scp dist/*.AppImage root@apps.shikarno.space:/var/lib/nvi-knowhub/releases/
```

Если каких-то типов файлов нет, `scp` может вывести ошибку `No such file or directory`. Это нормально, если эта платформа не собиралась.

Более аккуратный вариант через `rsync`:

```bash
cd /Users/slls/Desktop/NVI-KnowHub-portable

rsync -av \
  --include='*/' \
  --include='*.yml' \
  --include='*.blockmap' \
  --include='*.exe' \
  --include='*.dmg' \
  --include='*.zip' \
  --include='*.AppImage' \
  --exclude='*' \
  dist/ root@apps.shikarno.space:/var/lib/nvi-knowhub/releases/
```

## Проверить на сервере

```bash
ls -la /var/lib/nvi-knowhub/releases
curl -I https://apps.shikarno.space/nvi/knowhub/releases/latest.yml
curl -I https://apps.shikarno.space/nvi/knowhub/releases/latest-mac.yml
curl -I https://apps.shikarno.space/nvi/knowhub/releases/latest-linux.yml
```

Проверять нужно только те `latest*.yml`, которые соответствуют собранным платформам.

## Проверить metadata-файл

Для Windows:

```bash
curl -fsSL https://apps.shikarno.space/nvi/knowhub/releases/latest.yml
```

Внутри должны быть новая версия и имя файла установщика, например:

```yaml
version: 1.0.1
files:
  - url: NVI KnowHub Setup 1.0.1.exe
```

Если имя установщика в `latest.yml` не совпадает с файлом на сервере, автообновление не сможет скачать релиз.

```bash
curl -fsSL https://apps.shikarno.space/nvi/knowhub/releases/latest-mac.yml
```

В `files[0].url` должен быть `.zip`, например `NVI KnowHub-1.0.3-mac.zip`. Если там только `.dmg`, автообновление на macOS выдаст `ZIP file not provided`.

## Частые проблемы

- Если на macOS ошибка `ZIP file not provided`, пересоберите с `target: ['dmg', 'zip']` и загрузите на сервер и `.zip`, и обновлённый `latest-mac.yml`.
- Если `npm run build` падает на `content:pull`, проверь что `https://apps.shikarno.space/nvi/knowhub/content/manifest.json` открывается.
- Если приложение не видит обновление, проверь что версия в `package.json` больше установленной версии.
- Если обновление найдено, но не скачивается, проверь что установщик и `.blockmap` реально лежат в `/var/lib/nvi-knowhub/releases`.
- Если `latest.yml` содержит старую версию, значит на сервер загружен старый metadata-файл или сборка делалась до изменения `package.json`.

