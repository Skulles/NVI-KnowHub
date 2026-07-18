# Публикация desktop-релиза

## Подготовка

1. Увеличьте `version` в корневом `package.json` (строго выше уже опубликованной).
2. В `.env` задайте `KNOWHUB_SERVER_URL` (и при необходимости `KNOWHUB_RELEASES_URL`).
3. Собирайте на той ОС, для которой нужен установщик.

```bash
npm install
npm run typecheck
npm run build
```

Артефакты появятся в `dist/`.

## Что загружать на сервер

В каталог релизов (`{KNOWHUB_SERVER_URL}/releases/`) нужно положить:

- установщик(и) для целевой платформы;
- metadata electron-updater: `latest*.yml` (и связанные блоб-файлы, которые рядом создал builder).

Без `latest*.yml` автообновление в приложении не увидит новый релиз.

## Подпись

Скрипт `build` по умолчанию отключает auto-discovery сертификатов (`CSC_IDENTITY_AUTO_DISCOVERY=false`). Для signed/notarized сборок уберите флаг и настройте сертификаты платформы.
