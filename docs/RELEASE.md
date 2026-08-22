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
- metadata electron-updater: `latest*.yml`;
- `.blockmap` рядом с установщиком (его тоже создаёт builder) — без него клиент качает весь файл целиком, а не дельту.

Без `latest*.yml` автообновление в приложении не увидит новый релиз. Nginx должен отдавать `Accept-Ranges: bytes` для `/releases/` (по умолчанию так и есть для `alias`).

## Подпись

Скрипт `build` по умолчанию отключает auto-discovery сертификатов (`CSC_IDENTITY_AUTO_DISCOVERY=false`). Для signed/notarized сборок уберите флаг и настройте сертификаты платформы.
