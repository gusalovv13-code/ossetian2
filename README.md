# Алания Маркет 2026

Telegram Mini App локального маркетплейса на Node.js, Express и PostgreSQL.

## Структура

- `public/` — клиентские HTML, CSS и JavaScript.
- `server.js` — API, PostgreSQL и проксирование Telegram-аватара.
- `telegram-auth.js` — проверка подписи `Telegram.WebApp.initData`.
- `Dockerfile` — production-сборка контейнера.

## Переменные окружения

Скопируйте `.env.example` в `.env` и заполните:

- `BOT_TOKEN` — токен Telegram-бота.
- `DATABASE_URL` — строка подключения PostgreSQL.
- `PORT` — порт приложения, по умолчанию `3000`.
- `TELEGRAM_AUTH_MAX_AGE_SECONDS` — максимальный возраст `initData`, по умолчанию 24 часа.

## Запуск

```bash
npm ci
npm start
```

## Защищённые маршруты

Клиент передаёт подписанную строку Telegram в заголовке:

```text
Authorization: tma <Telegram.WebApp.initData>
```

Сервер проверяет подпись и сам определяет пользователя. ID пользователя, имя и username из тела запроса не принимаются.

Основные защищённые маршруты:

- `GET /api/me`
- `GET /api/avatar`
- `GET /api/my-products`
- `POST /api/products`
- `DELETE /api/products/:id`
- `GET /api/favorites`
- `POST /api/favorites`
- `POST /api/products/:id/view`
