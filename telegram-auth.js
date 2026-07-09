import { createHmac, timingSafeEqual } from "crypto";

const DEFAULT_MAX_AGE_SECONDS = 24 * 60 * 60;
const CLOCK_SKEW_SECONDS = 30;

export class TelegramAuthError extends Error {
  constructor(message, statusCode = 401) {
    super(message);
    this.name = "TelegramAuthError";
    this.statusCode = statusCode;
  }
}

export function validateTelegramInitData(
  initData,
  botToken,
  { maxAgeSeconds = DEFAULT_MAX_AGE_SECONDS, nowSeconds } = {}
) {
  if (typeof initData !== "string" || !initData.trim()) {
    throw new TelegramAuthError("Telegram initData отсутствует");
  }

  if (typeof botToken !== "string" || !botToken) {
    throw new Error("BOT_TOKEN is required for Telegram validation");
  }

  const params = new URLSearchParams(initData);
  const receivedHash = params.get("hash");

  if (!receivedHash || !/^[a-f0-9]{64}$/i.test(receivedHash)) {
    throw new TelegramAuthError("Некорректная подпись Telegram");
  }

  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = createHmac("sha256", "WebAppData")
    .update(botToken)
    .digest();

  const expectedHash = createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  const receivedBuffer = Buffer.from(receivedHash, "hex");
  const expectedBuffer = Buffer.from(expectedHash, "hex");

  if (
    receivedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(receivedBuffer, expectedBuffer)
  ) {
    throw new TelegramAuthError("Подпись Telegram не прошла проверку");
  }

  const authDate = Number(params.get("auth_date"));
  const currentTime = Number.isFinite(nowSeconds)
    ? nowSeconds
    : Math.floor(Date.now() / 1000);

  if (!Number.isInteger(authDate) || authDate <= 0) {
    throw new TelegramAuthError("Некорректная дата авторизации Telegram");
  }

  if (authDate > currentTime + CLOCK_SKEW_SECONDS) {
    throw new TelegramAuthError("Дата авторизации Telegram находится в будущем");
  }

  if (currentTime - authDate > maxAgeSeconds) {
    throw new TelegramAuthError("Сессия Telegram устарела. Откройте приложение заново");
  }

  const userRaw = params.get("user");

  if (!userRaw) {
    throw new TelegramAuthError("Telegram не передал пользователя");
  }

  let user;

  try {
    user = JSON.parse(userRaw);
  } catch {
    throw new TelegramAuthError("Некорректные данные пользователя Telegram");
  }

  if (!user || user.id === undefined || user.id === null) {
    throw new TelegramAuthError("В данных Telegram отсутствует ID пользователя");
  }

  return {
    user: {
      id: String(user.id),
      firstName: typeof user.first_name === "string" ? user.first_name : "",
      lastName: typeof user.last_name === "string" ? user.last_name : "",
      username: typeof user.username === "string" ? user.username : "",
      photoUrl: typeof user.photo_url === "string" ? user.photo_url : "",
      languageCode:
        typeof user.language_code === "string" ? user.language_code : ""
    },
    authDate,
    queryId: params.get("query_id") || ""
  };
}

export function createTelegramAuthMiddleware({ botToken, maxAgeSeconds }) {
  return function telegramAuthMiddleware(req, res, next) {
    const authorization = req.get("authorization") || "";
    const initData = authorization.toLowerCase().startsWith("tma ")
      ? authorization.slice(4).trim()
      : (req.get("x-telegram-init-data") || "").trim();

    try {
      const auth = validateTelegramInitData(initData, botToken, {
        maxAgeSeconds
      });

      req.telegramAuth = auth;
      req.telegramUser = auth.user;
      next();
    } catch (error) {
      if (error instanceof TelegramAuthError) {
        return res.status(error.statusCode).json({
          ok: false,
          error: error.message
        });
      }

      console.error("Telegram auth middleware error:", error);

      return res.status(500).json({
        ok: false,
        error: "Ошибка проверки Telegram-авторизации"
      });
    }
  };
}
