# Осетинский маркет v1.12.3 — контроль развёртывания

## Что исправлено

- В каталоге при пустом поиске больше не формируется `ORDER BY 0 DESC`.
- Сортировка собирается только из допустимых SQL-выражений.
- Добавлен публичный маршрут `GET /api/version`, который не зависит от базы данных.
- Каждый ответ сервера содержит заголовок `X-Ossetian-Market-Version: 1.12.3`.
- При старте сервер пишет в журнал: `starting version 1.12.3; catalog ORDER BY fix enabled`.
- Версии CSS и JavaScript обновлены до `1.12.3`, чтобы Telegram не использовал старый интерфейс из кеша.

## Как проверить после развёртывания

Откройте в браузере адрес приложения с окончанием `/api/version`.
Правильный ответ:

```json
{"ok":true,"version":"1.12.3","catalogOrderFix":true,"build":"deploy-proof"}
```

В журнале запуска должна присутствовать строка:

```text
[Ossetian Market] starting version 1.12.3; catalog ORDER BY fix enabled
```

Если отображается другая версия или маршрута нет, хостинг всё ещё запускает старую сборку.

## Docker

```bash
docker compose down
docker compose build --no-cache
docker compose up -d --force-recreate
docker compose logs -f
```

Для обычного Docker:

```bash
docker stop ossetian-market || true
docker rm ossetian-market || true
docker build --no-cache -t ossetian-market:1.12.3 .
docker run --name ossetian-market --env-file .env -p 3000:3000 -d ossetian-market:1.12.3
docker logs -f ossetian-market
```
