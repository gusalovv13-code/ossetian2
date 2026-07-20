import express from "express";
import compression from "compression";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { createHash, createHmac, randomUUID, timingSafeEqual } from "crypto";
import pg from "pg";
import sharp from "sharp";
import { lookup } from "dns/promises";
import { isIP } from "net";
import { createTelegramAuthMiddleware } from "./telegram-auth.js";
import { createDatabaseBackup } from "./backup-service.js";
import { DEFAULT_MODERATION_RULES, MODERATION_POLICY_VERSION } from "./moderation-policy.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const APP_VERSION = "1.19.3";
const LEGAL_DOCUMENT_VERSION = "1.16.0";
const BOT_TOKEN = process.env.BOT_TOKEN;
const DATABASE_URL = process.env.DATABASE_URL;
const SUPPORT_USERNAME = String(process.env.SUPPORT_USERNAME || "")
  .trim()
  .replace(/^@/, "");
const BOT_USERNAME = String(
  process.env.BOT_USERNAME || process.env.TELEGRAM_BOT_USERNAME || "os_15market_bot"
)
  .trim()
  .replace(/^@/, "");
const IS_RENDER = Boolean(process.env.RENDER_SERVICE_ID || process.env.RENDER_EXTERNAL_HOSTNAME);
const DATABASE_HOST_HINT = (() => {
  try {
    return new URL(DATABASE_URL).hostname.toLowerCase();
  } catch {
    return "";
  }
})();
const IS_RENDER_POSTGRES = /^dpg-/i.test(DATABASE_HOST_HINT) || DATABASE_HOST_HINT.endsWith(".render.com");
const DATABASE_SSL_CONFIGURED = String(process.env.DATABASE_SSL || "true").toLowerCase() !== "false";
// Render Postgres expects a TLS connection. A stale DATABASE_SSL=false value can
// otherwise make the server close the socket during the PostgreSQL handshake.
const DATABASE_SSL = IS_RENDER && IS_RENDER_POSTGRES ? true : DATABASE_SSL_CONFIGURED;
const PUBLIC_BASE_URL = String(process.env.PUBLIC_BASE_URL || "").trim().replace(/\/+$/, "");
const configuredAuthMaxAge = Number(
  process.env.TELEGRAM_AUTH_MAX_AGE_SECONDS || 86400
);
const TELEGRAM_AUTH_MAX_AGE_SECONDS =
  Number.isFinite(configuredAuthMaxAge) && configuredAuthMaxAge > 0
    ? Math.floor(configuredAuthMaxAge)
    : 86400;

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "public");
const PRODUCT_STATUSES = new Set(["active", "sold", "draft", "archived", "deleted"]);
const PUBLIC_PRODUCT_STATUS = "active";
const PRODUCT_CONDITIONS = new Set(["new", "like_new", "used", "for_parts"]);
const REPORT_REASONS = new Set([
  "fraud",
  "prohibited",
  "wrong_category",
  "wrong_price",
  "duplicate",
  "sold",
  "stolen_photos",
  "offensive",
  "other"
]);
const REPORT_STATUSES = new Set(["pending", "resolved", "rejected"]);
const MODERATION_ACTIONS = new Set([
  "no_action",
  "hide_product",
  "ban_user",
  "hide_and_ban"
]);
const PRODUCT_CATEGORIES = new Set([
  "Электроника",
  "Авто",
  "Одежда",
  "Дом",
  "Инструменты",
  "Сад и огород",
  "Животные",
  "Недвижимость",
  "Вакансии"
]);
const MODERATION_STATUSES = new Set(["approved", "blocked", "rejected"]);
const MODERATION_MATCH_TYPES = new Set(["word", "phrase", "domain"]);
const AD_PLACEMENTS = new Set(["catalog_top", "catalog_feed", "product_detail"]);
const AD_STATUSES = new Set(["draft", "active", "paused", "ended"]);
const AD_BILLING_MODELS = new Set(["flat", "cpm", "cpc"]);
const MAX_STORED_IMAGE_BYTES = 6 * 1024 * 1024;
const PRODUCT_ARCHIVE_DAYS = Math.max(1, Math.min(365, Number(process.env.PRODUCT_ARCHIVE_DAYS) || 15));
const DELETED_PRODUCT_RETENTION_DAYS = Math.max(1, Math.min(3650, Number(process.env.DELETED_PRODUCT_RETENTION_DAYS) || 30));
const FEATURE_HIGHLIGHT_PRICE_RUB = Math.max(0, Number(process.env.FEATURE_HIGHLIGHT_PRICE_RUB) || 199);
const FEATURE_HIGHLIGHT_DAYS = Math.max(1, Math.min(90, Number(process.env.FEATURE_HIGHLIGHT_DAYS) || 7));
const DEFAULT_LISTING_LIMIT = 3;
const MAX_LISTING_LIMIT = 100000;
const PROFESSIONAL_SUBSCRIPTION_PRICE_RUB = Math.max(0, Number(process.env.PROFESSIONAL_SUBSCRIPTION_PRICE_RUB) || 499);
const PROFESSIONAL_SUBSCRIPTION_DAYS = Math.max(1, Math.min(365, Number(process.env.PROFESSIONAL_SUBSCRIPTION_DAYS) || 30));
const PAID_LISTING_PRICES = Object.freeze({
  automobile: Math.max(0, Number(process.env.PAID_LISTING_AUTOMOBILE_PRICE_RUB) || 199),
  vacancy: Math.max(0, Number(process.env.PAID_LISTING_VACANCY_PRICE_RUB) || 99),
  apartment: Math.max(0, Number(process.env.PAID_LISTING_APARTMENT_PRICE_RUB) || 299),
  house: Math.max(0, Number(process.env.PAID_LISTING_HOUSE_PRICE_RUB) || 299),
  land: Math.max(0, Number(process.env.PAID_LISTING_LAND_PRICE_RUB) || 199)
});
const FEATURE_COLOR = "green";
const OPENAI_API_KEY = String(process.env.OPENAI_API_KEY || "").trim();
const OPENAI_MODEL = String(process.env.OPENAI_MODEL || "gpt-5.6-terra").trim();
const AI_LISTING_MODEL = String(process.env.AI_LISTING_MODEL || OPENAI_MODEL || "gpt-5.6-terra").trim();
const AI_MODERATION_MODEL = String(process.env.AI_MODERATION_MODEL || "gpt-5.6-luna").trim();
const AI_MODERATION_ENABLED = String(process.env.AI_MODERATION_ENABLED || "true").toLowerCase() !== "false";
const AI_LISTING_ASSISTANT_ENABLED = String(process.env.AI_LISTING_ASSISTANT_ENABLED || "true").toLowerCase() !== "false";
const AI_TIMEOUT_MS = Math.max(5_000, Math.min(60_000, Number(process.env.AI_TIMEOUT_MS) || 20_000));
const AI_RATE_LIMIT_MAX = Math.max(2, Math.min(100, Number(process.env.AI_RATE_LIMIT_MAX) || 20));
const AI_DAILY_BUDGET_USD = Math.max(0, Math.min(10000, Number(process.env.AI_DAILY_BUDGET_USD) || 5));
const AI_LISTING_INPUT_USD_PER_MTOK = Math.max(0, Number(process.env.AI_LISTING_INPUT_USD_PER_MTOK) || 2.5);
const AI_LISTING_OUTPUT_USD_PER_MTOK = Math.max(0, Number(process.env.AI_LISTING_OUTPUT_USD_PER_MTOK) || 15);
const AI_MODERATION_INPUT_USD_PER_MTOK = Math.max(0, Number(process.env.AI_MODERATION_INPUT_USD_PER_MTOK) || 1);
const AI_MODERATION_OUTPUT_USD_PER_MTOK = Math.max(0, Number(process.env.AI_MODERATION_OUTPUT_USD_PER_MTOK) || 6);
const YOOKASSA_SHOP_ID = String(process.env.YOOKASSA_SHOP_ID || "").trim();
const YOOKASSA_SECRET_KEY = String(process.env.YOOKASSA_SECRET_KEY || "").trim();
const YOOKASSA_API_URL = "https://api.yookassa.ru/v3";
const PAYMENT_PROVIDER = String(process.env.PAYMENT_PROVIDER || "yookassa").trim().toLowerCase();
const PAYMENTS_ENABLED = String(process.env.PAYMENTS_ENABLED || "true").toLowerCase() !== "false";
const ADMIN_ACCESS_CODE_SHA256 = String(process.env.ADMIN_ACCESS_CODE_SHA256 || "").trim().toLowerCase();
const ADMIN_RATE_LIMIT_MAX = Math.max(5, Math.min(500, Number(process.env.ADMIN_RATE_LIMIT_MAX) || 60));
const AUTO_BACKUP_ENABLED = String(process.env.AUTO_BACKUP_ENABLED || "false").toLowerCase() === "true";
const AUTO_BACKUP_INTERVAL_HOURS = Math.max(1, Math.min(168, Number(process.env.AUTO_BACKUP_INTERVAL_HOURS) || 24));
const BACKUP_RETENTION_COUNT = Math.max(1, Math.min(90, Number(process.env.BACKUP_RETENTION_COUNT) || 7));
const BACKUP_DIR = String(process.env.BACKUP_DIR || "./backups").trim();
const SECURITY_EVENT_RETENTION_DAYS = Math.max(7, Math.min(3650, Number(process.env.SECURITY_EVENT_RETENTION_DAYS) || 90));
const PAYMENT_PROVIDER_TIMEOUT_MS = Math.max(5_000, Math.min(60_000, Number(process.env.PAYMENT_PROVIDER_TIMEOUT_MS) || 15_000));
const YOOKASSA_WEBHOOK_IP_CHECK = String(process.env.YOOKASSA_WEBHOOK_IP_CHECK || "false").toLowerCase() === "true";
const ADMIN_SECOND_FACTOR_MAX_FAILURES = Math.max(3, Math.min(20, Number(process.env.ADMIN_SECOND_FACTOR_MAX_FAILURES) || 5));
const ADMIN_SECOND_FACTOR_LOCK_MINUTES = Math.max(1, Math.min(1440, Number(process.env.ADMIN_SECOND_FACTOR_LOCK_MINUTES) || 15));
const SLOW_REQUEST_MS = Math.max(100, Math.min(60_000, Number(process.env.SLOW_REQUEST_MS) || 2000));
const PRODUCT_IMAGE_MAX_WIDTH = Math.max(800, Math.min(3000, Number(process.env.PRODUCT_IMAGE_MAX_WIDTH) || 1600));
const PRODUCT_IMAGE_WEBP_QUALITY = Math.max(50, Math.min(95, Number(process.env.PRODUCT_IMAGE_WEBP_QUALITY) || 82));
const PRODUCT_THUMBNAIL_WIDTH = Math.max(240, Math.min(1000, Number(process.env.PRODUCT_THUMBNAIL_WIDTH) || 640));
const ALERT_TELEGRAM_CHAT_ID = String(process.env.ALERT_TELEGRAM_CHAT_ID || "").trim();
const ERROR_ALERT_THRESHOLD = Math.max(2, Math.min(100, Number(process.env.ERROR_ALERT_THRESHOLD) || 10));
const ERROR_ALERT_WINDOW_MS = Math.max(60_000, Math.min(60 * 60_000, Number(process.env.ERROR_ALERT_WINDOW_MS) || 5 * 60_000));
const PROMOTION_PLANS = Object.freeze({
  boost: { id: "boost", label: "Поднять", days: Math.max(1, Number(process.env.PROMO_BOOST_DAYS) || 1), priceRub: Math.max(0, Number(process.env.PROMO_BOOST_PRICE_RUB) || 99), priority: 1 },
  vip: { id: "vip", label: "VIP", days: Math.max(1, Number(process.env.PROMO_VIP_DAYS) || 7), priceRub: Math.max(0, Number(process.env.PROMO_VIP_PRICE_RUB) || 299), priority: 2 },
  premium: { id: "premium", label: "Премиум", days: Math.max(1, Number(process.env.PROMO_PREMIUM_DAYS) || 14), priceRub: Math.max(0, Number(process.env.PROMO_PREMIUM_PRICE_RUB) || 599), priority: 3 }
});
const preparedShareMessageCache = new Map();
const searchCapabilities = { pgTrgm: false };
const RATE_LIMIT_WINDOW_MS = Math.max(10_000, Math.min(10 * 60_000, Number(process.env.RATE_LIMIT_WINDOW_MS) || 60_000));
const API_RATE_LIMIT_MAX = Math.max(30, Math.min(5000, Number(process.env.API_RATE_LIMIT_MAX) || 300));
const MUTATION_RATE_LIMIT_MAX = Math.max(10, Math.min(1000, Number(process.env.MUTATION_RATE_LIMIT_MAX) || 80));
const SEARCH_RATE_LIMIT_MAX = Math.max(20, Math.min(1000, Number(process.env.SEARCH_RATE_LIMIT_MAX) || 150));
const TRUST_PROXY = process.env.TRUST_PROXY == null
  ? IS_RENDER
  : String(process.env.TRUST_PROXY).toLowerCase() !== "false";

if (TRUST_PROXY) app.set("trust proxy", 1);

if (!BOT_TOKEN) {
  console.error("Ошибка: BOT_TOKEN не найден в переменных окружения");
  process.exit(1);
}

if (!DATABASE_URL) {
  console.error("Ошибка: DATABASE_URL не найден в переменных окружения");
  process.exit(1);
}

const DB_POOL_MAX = Math.max(2, Math.min(20, Number(process.env.DB_POOL_MAX) || 5));
const DB_CONNECTION_TIMEOUT_MS = Math.max(
  5_000,
  Math.min(60_000, Number(process.env.DB_CONNECTION_TIMEOUT_MS) || 20_000)
);
const DB_INIT_MAX_ATTEMPTS = Math.max(
  1,
  Math.min(20, Number(process.env.DB_INIT_MAX_ATTEMPTS) || 8)
);
const DB_INIT_RETRY_BASE_MS = Math.max(
  500,
  Math.min(30_000, Number(process.env.DB_INIT_RETRY_BASE_MS) || 2_000)
);
const DB_INIT_RETRY_MAX_MS = Math.max(
  DB_INIT_RETRY_BASE_MS,
  Math.min(60_000, Number(process.env.DB_INIT_RETRY_MAX_MS) || 30_000)
);
function normalizeDatabaseConnectionString(rawUrl) {
  if (!DATABASE_SSL) return rawUrl;

  try {
    const parsed = new URL(rawUrl);
    // node-postgres replaces the explicit ssl object when these parameters are
    // present in the URL. Remove them so the known Render-safe config below wins.
    for (const key of ["sslmode", "sslcert", "sslkey", "sslrootcert"]) {
      parsed.searchParams.delete(key);
    }
    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

function describeDatabaseTarget(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    return {
      host: parsed.hostname || "unknown",
      port: parsed.port || "5432",
      database: parsed.pathname.replace(/^\//, "") || "unknown",
      renderInternal: /^dpg-/i.test(parsed.hostname) && !parsed.hostname.includes(".")
    };
  } catch {
    return { host: "invalid-url", port: "unknown", database: "unknown", renderInternal: false };
  }
}

const EFFECTIVE_DATABASE_URL = normalizeDatabaseConnectionString(DATABASE_URL);
const DATABASE_TARGET = describeDatabaseTarget(EFFECTIVE_DATABASE_URL);
const databaseState = {
  ready: false,
  initializing: false,
  lastError: "",
  connectedAt: null
};
let databaseInitializationPromise = null;
let lifecycleTimer = null;
let backupTimer = null;
const runtimeMetrics = {
  startedAt: Date.now(),
  requests: 0,
  responses5xx: 0,
  slowRequests: 0,
  totalDurationMs: 0,
  maxDurationMs: 0,
  errorTimestamps: [],
  lastErrorAlertAt: 0
};

if (IS_RENDER && IS_RENDER_POSTGRES && !DATABASE_SSL_CONFIGURED) {
  console.warn("DATABASE_SSL=false is ignored on Render; TLS has been forced on.");
}

const pool = new Pool({
  connectionString: EFFECTIVE_DATABASE_URL,
  ssl: DATABASE_SSL ? { rejectUnauthorized: false } : false,
  max: DB_POOL_MAX,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: DB_CONNECTION_TIMEOUT_MS,
  statement_timeout: 15_000,
  query_timeout: 15_000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
  application_name: `ossetian-market-${APP_VERSION}`
});

pool.on("error", error => {
  // Ошибка на простаивающем соединении не должна аварийно завершать процесс.
  // Пул удалит повреждённый клиент и создаст новый при следующем запросе.
  databaseState.ready = false;
  databaseState.lastError = String(error?.message || error || "Database connection error");
  console.error("Unexpected PostgreSQL pool error:", error);
  ensureDatabaseInitialization();
});

const requireTelegramAuth = createTelegramAuthMiddleware({
  botToken: BOT_TOKEN,
  maxAgeSeconds: TELEGRAM_AUTH_MAX_AGE_SECONDS
});

app.disable("x-powered-by");
app.use((req, res, next) => {
  const requestId = String(req.headers["x-request-id"] || randomUUID()).slice(0, 80);
  req.requestId = requestId;
  res.setHeader("X-Request-Id", requestId);
  res.setHeader("X-Ossetian-Market-Version", APP_VERSION);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cross-Origin-Resource-Policy", "same-site");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(self), microphone=(), geolocation=(), payment=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline' https://telegram.org; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self' https://api.telegram.org https://telegram.org; font-src 'self' data:; frame-ancestors 'self' https://web.telegram.org https://*.telegram.org; base-uri 'self'; form-action 'self'"
  );
  if (IS_RENDER || PUBLIC_BASE_URL.startsWith("https://")) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  const startedAt = Date.now();
  runtimeMetrics.requests += 1;
  res.once("finish", () => {
    const durationMs = Date.now() - startedAt;
    runtimeMetrics.totalDurationMs += durationMs;
    runtimeMetrics.maxDurationMs = Math.max(runtimeMetrics.maxDurationMs, durationMs);
    if (res.statusCode >= 500) {
      runtimeMetrics.responses5xx += 1;
      const now = Date.now();
      runtimeMetrics.errorTimestamps.push(now);
      runtimeMetrics.errorTimestamps = runtimeMetrics.errorTimestamps.filter(timestamp => timestamp >= now - ERROR_ALERT_WINDOW_MS);
      if (
        ALERT_TELEGRAM_CHAT_ID &&
        runtimeMetrics.errorTimestamps.length >= ERROR_ALERT_THRESHOLD &&
        now - runtimeMetrics.lastErrorAlertAt >= ERROR_ALERT_WINDOW_MS
      ) {
        runtimeMetrics.lastErrorAlertAt = now;
        callTelegramBotApi("sendMessage", {
          chat_id: ALERT_TELEGRAM_CHAT_ID,
          text: `⚠️ Алания Маркет: ${runtimeMetrics.errorTimestamps.length} ответов 5xx за последние ${Math.round(ERROR_ALERT_WINDOW_MS / 60000)} мин. Последний: ${req.method} ${req.path}, requestId=${req.requestId}`
        }).catch(error => console.warn("Monitoring alert failed:", error?.message || error));
      }
    }
    if (durationMs >= SLOW_REQUEST_MS) {
      runtimeMetrics.slowRequests += 1;
      console.warn(`[slow-request] ${req.method} ${req.path} ${res.statusCode} ${durationMs}ms requestId=${req.requestId}`);
    }
  });
  next();
});

function createMemoryRateLimiter({ prefix, max, windowMs = RATE_LIMIT_WINDOW_MS }) {
  const buckets = new Map();
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }, Math.max(30_000, windowMs));
  cleanup.unref?.();

  return (req, res, next) => {
    const now = Date.now();
    const identity = String(req.ip || req.socket?.remoteAddress || "unknown");
    const key = `${prefix}:${identity}`;
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    const remaining = Math.max(0, max - bucket.count);
    res.setHeader("RateLimit-Limit", String(max));
    res.setHeader("RateLimit-Remaining", String(remaining));
    res.setHeader("RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));
    if (bucket.count > max) {
      res.setHeader("Retry-After", String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))));
      return res.status(429).json({ ok: false, code: "RATE_LIMITED", error: "Слишком много запросов. Попробуйте немного позже." });
    }
    return next();
  };
}

const apiRateLimiter = createMemoryRateLimiter({ prefix: "api", max: API_RATE_LIMIT_MAX });
const mutationRateLimiter = createMemoryRateLimiter({ prefix: "mutation", max: MUTATION_RATE_LIMIT_MAX });
const searchRateLimiter = createMemoryRateLimiter({ prefix: "search", max: SEARCH_RATE_LIMIT_MAX });
const aiRateLimiter = createMemoryRateLimiter({ prefix: "ai", max: AI_RATE_LIMIT_MAX, windowMs: 60_000 });
const adminRateLimiter = createMemoryRateLimiter({ prefix: "admin", max: ADMIN_RATE_LIMIT_MAX, windowMs: 60_000 });
const paymentRateLimiter = createMemoryRateLimiter({ prefix: "payment", max: 30, windowMs: 60_000 });
const webhookRateLimiter = createMemoryRateLimiter({ prefix: "payment-webhook", max: 120, windowMs: 60_000 });
const adminSecondFactorFailures = new Map();

app.use(compression({ threshold: 1024 }));
app.use("/api", apiRateLimiter);
app.use("/api/admin", adminRateLimiter);
app.use(["/api/admin", "/api/payments", "/api/me"], (req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});
app.use("/api", (req, res, next) => {
  if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return mutationRateLimiter(req, res, next);
  return next();
});
app.use("/api", (req, res, next) => {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return next();
  const origin = String(req.headers.origin || "").trim();
  if (!origin) return next();
  const allowedOrigins = new Set();
  try {
    const host = String(req.headers.host || "").trim();
    if (host) {
      allowedOrigins.add(`https://${host}`);
      allowedOrigins.add(`http://${host}`);
    }
    if (PUBLIC_BASE_URL) allowedOrigins.add(new URL(PUBLIC_BASE_URL).origin);
  } catch {}
  if (!allowedOrigins.has(origin)) {
    recordSecurityEvent(req, "origin_rejected", "warning", { origin }).catch(() => {});
    return res.status(403).json({ ok: false, code: "ORIGIN_REJECTED", error: "Запрос отклонён политикой безопасности" });
  }
  return next();
});
app.use((req, res, next) => {
  const contentLength = Number(req.headers["content-length"] || 0);
  if (contentLength > 32 * 1024 * 1024) {
    return res.status(413).json({ ok: false, code: "PAYLOAD_TOO_LARGE", error: "Размер запроса превышает допустимый лимит" });
  }
  return next();
});
app.use(express.json({ limit: "30mb", strict: true }));
app.use(express.static(publicDir, {
  etag: true,
  lastModified: true,
  maxAge: "1h",
  setHeaders(res, filePath) {
    if (filePath.endsWith("index.html")) {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
      return;
    }

    if (filePath.endsWith("script.js") || filePath.endsWith("style.css")) {
      res.setHeader("Cache-Control", "no-cache, must-revalidate");
    }
  }
}));

function normalizeImages(row) {
  if (Array.isArray(row.images) && row.images.length > 0) {
    return row.images;
  }

  if (row.image) {
    return [row.image];
  }

  return [];
}

function mapProduct(row) {
  const images = normalizeImages(row);
  const specifications =
    row.specifications && typeof row.specifications === "object" && !Array.isArray(row.specifications)
      ? row.specifications
      : {};
  const product = {
    id: row.id,
    ownerId: row.owner_id,
    ownerName: row.owner_name,
    ownerUsername: row.owner_username,
    ownerIsBusiness: Boolean(row.owner_is_business),
    ownerBusinessName: row.owner_business_name || "",
    ownerBusinessVerified: Boolean(row.owner_business_verified),
    name: row.name,
    price: row.price,
    priceAmount: Number(row.price_amount) || parsePriceAmount(row.price),
    previousPrice: row.previous_price || "",
    previousPriceAmount: Number(row.previous_price_amount) || parsePriceAmount(row.previous_price),
    priceDroppedAt: row.price_dropped_at ? new Date(row.price_dropped_at).getTime() : null,
    category: row.category,
    desc: row.description,
    image: images[0] || row.image || "",
    thumbnail: row.thumbnail || images[0] || row.image || "",
    images,
    location: row.location,
    district: row.district || "",
    phone: row.phone || "",
    allowMessages: row.allow_messages !== false,
    allowCalls: row.allow_calls !== false,
    condition: PRODUCT_CONDITIONS.has(row.condition) ? row.condition : "used",
    negotiable: Boolean(row.negotiable),
    delivery: Boolean(row.delivery),
    specifications,
    views: Number(row.views) || 0,
    favoriteCount: Number(row.favorite_count) || 0,
    reportCount: Number(row.report_count) || 0,
    moderationStatus: MODERATION_STATUSES.has(row.moderation_status) ? row.moderation_status : "approved",
    moderationReason: row.moderation_reason || "",
    moderationMatches: Array.isArray(row.moderation_matches) ? row.moderation_matches : [],
    moderationTargetStatus: PRODUCT_STATUSES.has(row.moderation_target_status) ? row.moderation_target_status : "active",
    autoHidden: Boolean(row.auto_hidden),
    hidden: Boolean(row.hidden),
    status: row.status || "active",
    soldAt: row.sold_at ? new Date(row.sold_at).getTime() : null,
    mediaPurgedAt: row.media_purged_at ? new Date(row.media_purged_at).getTime() : null,
    archivedAt: row.archived_at ? new Date(row.archived_at).getTime() : null,
    expiresAt: row.expires_at ? new Date(row.expires_at).getTime() : null,
    featuredUntil: row.featured_until ? new Date(row.featured_until).getTime() : null,
    featuredColor: FEATURE_COLOR,
    featuredPaid: Boolean(row.featured_paid),
    promotionPlan: row.promotion_plan || "",
    promotionPriority: Number(row.promotion_priority) || 0,
    featureRequestPending: Number(row.pending_feature_requests) > 0,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : null
  };
  product.isFeatured = Boolean(product.featuredPaid && product.featuredUntil && product.featuredUntil > Date.now());

  const currentAmount = Number(product.priceAmount) || 0;
  const previousAmount = Number(product.previousPriceAmount) || 0;
  product.priceDropped = Boolean(previousAmount > currentAmount && currentAmount > 0);
  product.priceDropPercent = product.priceDropped
    ? Math.max(1, Math.round(((previousAmount - currentAmount) / previousAmount) * 100))
    : 0;
  product.quality = calculateListingQuality(product);
  return product;
}

const PRODUCT_SUMMARY_COLUMNS = `
  p.id,
  p.owner_id,
  p.owner_name,
  p.owner_username,
  COALESCE((SELECT (u.professional_subscription_until > NOW()) FROM users u WHERE u.telegram_id = p.owner_id LIMIT 1), FALSE) AS owner_is_business,
  COALESCE((SELECT u.business_name FROM users u WHERE u.telegram_id = p.owner_id LIMIT 1), '') AS owner_business_name,
  FALSE AS owner_business_verified,
  p.name,
  p.price,
  p.price_amount,
  p.previous_price,
  p.previous_price_amount,
  p.price_dropped_at,
  p.category,
  LEFT(p.description, 240) AS description,
  CASE
    WHEN EXISTS (SELECT 1 FROM product_images pi WHERE pi.product_id = p.id) THEN TRUE
    WHEN NULLIF(p.thumbnail, '') IS NOT NULL THEN TRUE
    WHEN NULLIF(p.image, '') IS NOT NULL THEN TRUE
    WHEN jsonb_typeof(p.images) = 'array' THEN jsonb_array_length(p.images) > 0
    ELSE FALSE
  END AS has_image,
  p.location,
  p.district,
  p.condition,
  p.negotiable,
  p.delivery,
  p.views,
  p.status,
  p.sold_at,
  p.media_purged_at,
  p.hidden,
  p.moderation_status,
  p.moderation_reason,
  p.archived_at,
  p.expires_at,
  p.featured_until,
  p.featured_color,
  p.featured_paid,
  p.promotion_plan,
  p.promotion_priority,
  p.created_at,
  p.updated_at
`;

const PRODUCT_PUBLIC_DETAIL_COLUMNS = `
  p.id,
  p.owner_id,
  p.owner_name,
  p.owner_username,
  COALESCE((SELECT (u.professional_subscription_until > NOW()) FROM users u WHERE u.telegram_id = p.owner_id LIMIT 1), FALSE) AS owner_is_business,
  COALESCE((SELECT u.business_name FROM users u WHERE u.telegram_id = p.owner_id LIMIT 1), '') AS owner_business_name,
  FALSE AS owner_business_verified,
  p.name,
  p.price,
  p.price_amount,
  p.previous_price,
  p.previous_price_amount,
  p.price_dropped_at,
  p.category,
  p.description,
  p.location,
  p.district,
  p.phone,
  p.allow_messages,
  p.allow_calls,
  p.condition,
  p.negotiable,
  p.delivery,
  p.specifications,
  p.views,
  p.status,
  p.sold_at,
  p.media_purged_at,
  p.hidden,
  p.moderation_status,
  p.moderation_reason,
  p.moderation_matches,
  p.moderation_target_status,
  p.auto_hidden,
  p.archived_at,
  p.expires_at,
  p.featured_until,
  p.featured_color,
  p.featured_paid,
  p.promotion_plan,
  p.promotion_priority,
  p.created_at,
  p.updated_at,
  GREATEST(
    (SELECT COUNT(*)::int FROM product_images pi WHERE pi.product_id = p.id),
    CASE
      WHEN jsonb_typeof(p.images) = 'array' THEN jsonb_array_length(p.images)
      ELSE 0
    END,
    CASE WHEN NULLIF(p.image, '') IS NOT NULL THEN 1 ELSE 0 END
  ) AS image_count
`;

function buildProductMediaUrl(productId, kind, version = "") {
  const base = `/api/products/${encodeURIComponent(String(productId || ""))}/${kind}`;
  const versionValue = version ? new Date(version).getTime() : 0;
  return versionValue > 0 ? `${base}?v=${versionValue}` : base;
}

function getPrivateMediaExpiry() {
  const twoHours = 2 * 60 * 60 * 1000;
  return Math.ceil((Date.now() + twoHours) / 3_600_000) * 3_600_000;
}

function createPrivateMediaToken(productId, ownerId, expiresAt, version = "") {
  return createHmac("sha256", BOT_TOKEN)
    .update(`${productId}:${ownerId}:${expiresAt}:${version}`)
    .digest("base64url");
}

function buildOwnProductThumbnailUrl(row) {
  if (!row.has_image) return "";
  const expiresAt = getPrivateMediaExpiry();
  const ownerId = String(row.owner_id || "");
  const version = String(new Date(row.updated_at || row.created_at || Date.now()).getTime());
  const token = createPrivateMediaToken(row.id, ownerId, expiresAt, version);
  return `/api/my-products/${encodeURIComponent(String(row.id || ""))}/thumbnail` +
    `?owner=${encodeURIComponent(ownerId)}&expires=${expiresAt}&v=${encodeURIComponent(version)}&token=${encodeURIComponent(token)}`;
}

function isValidPrivateMediaToken(productId, ownerId, expiresAt, version, token) {
  if (!productId || !ownerId || !Number.isFinite(expiresAt) || expiresAt < Date.now()) return false;
  if (expiresAt > Date.now() + 3 * 60 * 60 * 1000) return false;

  const expected = createPrivateMediaToken(productId, ownerId, expiresAt, version);
  const actualBuffer = Buffer.from(String(token || ""));
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function mapProductSummary(row) {
  const currentAmount = Number(row.price_amount) || parsePriceAmount(row.price);
  const previousAmount = Number(row.previous_price_amount) || parsePriceAmount(row.previous_price);
  const priceDropped = Boolean(previousAmount > currentAmount && currentAmount > 0);
  const image = row.has_image
    ? buildProductMediaUrl(row.id, "thumbnail", row.updated_at || row.created_at)
    : "";

  return {
    id: row.id,
    ownerId: row.owner_id,
    ownerName: row.owner_name,
    ownerUsername: row.owner_username,
    ownerIsBusiness: Boolean(row.owner_is_business),
    ownerBusinessName: row.owner_business_name || "",
    ownerBusinessVerified: Boolean(row.owner_business_verified),
    name: row.name,
    price: row.price,
    priceAmount: currentAmount,
    previousPrice: row.previous_price || "",
    previousPriceAmount: previousAmount,
    priceDroppedAt: row.price_dropped_at ? new Date(row.price_dropped_at).getTime() : null,
    priceDropped,
    priceDropPercent: priceDropped
      ? Math.max(1, Math.round(((previousAmount - currentAmount) / previousAmount) * 100))
      : 0,
    category: row.category,
    desc: row.description || "",
    image,
    thumbnail: image,
    location: row.location,
    district: row.district || "",
    condition: PRODUCT_CONDITIONS.has(row.condition) ? row.condition : "used",
    negotiable: Boolean(row.negotiable),
    delivery: Boolean(row.delivery),
    views: Number(row.views) || 0,
    favoriteCount: Number(row.favorite_count) || 0,
    status: row.status || "active",
    soldAt: row.sold_at ? new Date(row.sold_at).getTime() : null,
    mediaPurgedAt: row.media_purged_at ? new Date(row.media_purged_at).getTime() : null,
    hidden: Boolean(row.hidden),
    moderationStatus: MODERATION_STATUSES.has(row.moderation_status) ? row.moderation_status : "approved",
    moderationReason: row.moderation_reason || "",
    archivedAt: row.archived_at ? new Date(row.archived_at).getTime() : null,
    expiresAt: row.expires_at ? new Date(row.expires_at).getTime() : null,
    featuredUntil: row.featured_until ? new Date(row.featured_until).getTime() : null,
    featuredColor: FEATURE_COLOR,
    featuredPaid: Boolean(row.featured_paid),
    promotionPlan: row.promotion_plan || "",
    promotionPriority: Number(row.promotion_priority) || 0,
    featureRequestPending: Number(row.pending_feature_requests) > 0,
    isFeatured: Boolean(row.featured_paid && row.featured_until && new Date(row.featured_until).getTime() > Date.now()),
    createdAt: row.created_at ? new Date(row.created_at).getTime() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : null,
    isSummary: true
  };
}

function mapOwnProductSummary(row) {
  const product = mapProductSummary(row);
  const image = buildOwnProductThumbnailUrl(row);
  product.image = image;
  product.thumbnail = image;
  return product;
}

function mapPublicProduct(row) {
  const product = mapProduct(row);
  const imageCount = Math.max(0, Math.min(5, Number(row.image_count) || 0));
  const version = row.updated_at || row.created_at;
  const images = Array.from({ length: imageCount }, (_, index) =>
    buildProductMediaUrl(row.id, `media/${index}`, version)
  );

  product.images = images;
  product.image = images[0] || "";
  product.thumbnail = imageCount > 0
    ? buildProductMediaUrl(row.id, "thumbnail", version)
    : "";
  product.isSummary = false;
  product.quality = calculateListingQuality(product);
  return product;
}

function mapAdCampaign(row) {
  const normalizedPlacement = String(row.placement || "").trim().toLowerCase();
  const normalizedStatus = String(row.status || "").trim().toLowerCase();

  return {
    id: row.id,
    title: row.title || "",
    description: row.description || "",
    imageUrl: row.image_url || "",
    targetUrl: row.target_url || "",
    linkedProductId: row.linked_product_id || "",
    buttonText: row.button_text || "Подробнее",
    placement: AD_PLACEMENTS.has(normalizedPlacement) ? normalizedPlacement : "catalog_feed",
    status: AD_STATUSES.has(normalizedStatus) ? normalizedStatus : "draft",
    startsAt: row.starts_at ? new Date(row.starts_at).getTime() : null,
    endsAt: row.ends_at ? new Date(row.ends_at).getTime() : null,
    priority: Number(row.priority) || 0,
    insertEvery: Math.max(2, Number(row.insert_every) || 6),
    maxImpressions: Math.max(0, Number(row.max_impressions) || 0),
    impressions: Math.max(0, Number(row.impressions) || 0),
    clicks: Math.max(0, Number(row.clicks) || 0),
    billingModel: AD_BILLING_MODELS.has(row.billing_model) ? row.billing_model : "flat",
    rateAmount: Math.max(0, Number(row.rate_amount) || 0),
    isPaid: Boolean(row.is_paid),
    estimatedRevenue: (() => {
      const model = AD_BILLING_MODELS.has(row.billing_model) ? row.billing_model : "flat";
      const rate = Math.max(0, Number(row.rate_amount) || 0);
      if (model === "cpm") return Number((((Number(row.impressions) || 0) / 1000) * rate).toFixed(2));
      if (model === "cpc") return Number(((Number(row.clicks) || 0) * rate).toFixed(2));
      return rate;
    })(),
    ctr: Number(row.impressions) > 0
      ? Number(((Number(row.clicks) / Number(row.impressions)) * 100).toFixed(2))
      : 0,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : null
  };
}

function buildAdImageUrl(row) {
  const version = row.updated_at || row.created_at;
  const timestamp = version ? new Date(version).getTime() : 0;
  const base = `/api/ads/${encodeURIComponent(String(row.id || ""))}/image`;
  return timestamp > 0 ? `${base}?v=${timestamp}` : base;
}

function mapPublicAdCampaign(row) {
  const ad = mapAdCampaign(row);
  if (/^data:image\/(jpeg|jpg|png|webp);base64,/i.test(String(row.image_url || ""))) {
    ad.imageUrl = buildAdImageUrl(row);
  }
  return ad;
}

function getTelegramDisplayName(user) {
  return `${user.firstName || ""} ${user.lastName || ""}`.trim();
}


function mapPublicUser(row) {
  const firstName = row.first_name || "";
  const lastName = row.last_name || "";
  const username = row.username || row.owner_username || "";
  const contactUsername = row.contact_username || username;

  return {
    id: String(row.telegram_id || row.owner_id || ""),
    username,
    contactUsername,
    firstName,
    lastName,
    displayName:
      `${firstName} ${lastName}`.trim() || row.owner_name || "Продавец",
    avatar: row.avatar || "",
    photoUrl: row.avatar || "",
    description: row.profile_description || "",
    city: row.city || "",
    phone: row.phone || "",
    listingLimit: isProfessionalSubscriptionActive(row) ? null : Math.max(1, Math.min(MAX_LISTING_LIMIT, Number(row.listing_limit) || DEFAULT_LISTING_LIMIT)),
    isBusiness: isProfessionalSubscriptionActive(row),
    businessName: row.business_name || "",
    businessCategory: row.business_category || "",
    businessAddress: row.business_address || "",
    businessHours: row.business_hours || "",
    businessWebsite: "",
    businessVerified: false,
    professionalSubscriptionActive: isProfessionalSubscriptionActive(row),
    professionalSubscriptionUntil: row.professional_subscription_until ? new Date(row.professional_subscription_until).toISOString() : null,
    lastSeen: row.last_seen ? new Date(row.last_seen).getTime() : null,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : null
  };
}

function normalizeText(value, maxLength) {
  return String(value ?? "").trim().slice(0, maxLength);
}

async function recordSecurityEvent(req, eventType, severity = "info", details = {}, userId = "") {
  if (!databaseState.ready) return false;
  const ipHash = createHash("sha256").update(String(req?.ip || req?.socket?.remoteAddress || "")).digest("hex").slice(0, 32);
  const userAgentHash = createHash("sha256").update(String(req?.headers?.["user-agent"] || "")).digest("hex").slice(0, 32);
  const safeDetails = details && typeof details === "object" && !Array.isArray(details) ? details : {};
  await pool.query(
    `INSERT INTO security_events (id, user_id, event_type, severity, ip_hash, user_agent_hash, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [randomUUID(), normalizeText(userId, 64), normalizeText(eventType, 80), normalizeText(severity, 20), ipHash, userAgentHash, JSON.stringify(safeDetails)]
  );
  return true;
}

const SEARCH_SYNONYMS = new Map([
  ["айфон", ["iphone", "apple"]],
  ["iphone", ["айфон", "apple"]],
  ["телефон", ["смартфон", "mobile", "phone"]],
  ["смартфон", ["телефон", "mobile", "phone"]],
  ["ноут", ["ноутбук", "laptop"]],
  ["ноутбук", ["ноут", "laptop"]],
  ["машина", ["авто", "автомобиль"]],
  ["автомобиль", ["авто", "машина"]],
  ["работа", ["вакансия", "вакансии"]],
  ["вакансия", ["работа"]],
  ["самсунг", ["samsung"]],
  ["samsung", ["самсунг"]],
  ["сяоми", ["xiaomi"]],
  ["xiaomi", ["сяоми"]],
  ["бмв", ["bmw"]],
  ["bmw", ["бмв"]],
  ["мерседес", ["mercedes", "benz"]],
  ["mercedes", ["мерседес", "benz"]],
  ["владикавказ", ["дзауджикау", "дзæуджыхъæу", "ordzhonikidze"]],
  ["дзауджикау", ["владикавказ", "дзæуджыхъæу"]],
  ["дзæуджыхъæу", ["владикавказ", "дзауджикау"]]
]);

const CYRILLIC_TO_LATIN = new Map(Object.entries({
  а:"a", б:"b", в:"v", г:"g", д:"d", е:"e", ё:"e", ж:"zh", з:"z", и:"i", й:"y", к:"k", л:"l", м:"m", н:"n", о:"o", п:"p", р:"r", с:"s", т:"t", у:"u", ф:"f", х:"kh", ц:"ts", ч:"ch", ш:"sh", щ:"sch", ы:"y", э:"e", ю:"yu", я:"ya"
}));

function normalizeSearchText(value) {
  return normalizeText(value, 100)
    .normalize("NFKC")
    .toLocaleLowerCase("ru")
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function transliterateCyrillicToLatin(value) {
  return [...normalizeSearchText(value)].map(char => CYRILLIC_TO_LATIN.get(char) || char).join("");
}

function transliterateLatinToCyrillic(value) {
  let result = normalizeSearchText(value);
  const pairs = [
    ["shch", "щ"], ["sch", "щ"], ["yo", "е"], ["zh", "ж"], ["kh", "х"], ["ts", "ц"],
    ["ch", "ч"], ["sh", "ш"], ["yu", "ю"], ["ya", "я"], ["ye", "е"],
    ["a", "а"], ["b", "б"], ["v", "в"], ["g", "г"], ["d", "д"], ["e", "е"], ["z", "з"],
    ["i", "и"], ["y", "й"], ["k", "к"], ["l", "л"], ["m", "м"], ["n", "н"], ["o", "о"],
    ["p", "п"], ["r", "р"], ["s", "с"], ["t", "т"], ["u", "у"], ["f", "ф"], ["h", "х"]
  ];
  for (const [latin, cyrillic] of pairs) result = result.replaceAll(latin, cyrillic);
  return result;
}

function expandSearchTerm(term) {
  const normalized = normalizeSearchText(term);
  const variants = new Set([normalized]);
  for (const synonym of SEARCH_SYNONYMS.get(normalized) || []) variants.add(normalizeSearchText(synonym));
  if (/[а-яё]/i.test(normalized)) variants.add(transliterateCyrillicToLatin(normalized));
  if (/[a-z]/i.test(normalized)) variants.add(transliterateLatinToCyrillic(normalized));
  return [...variants].filter(Boolean).slice(0, 6);
}

function normalizeFingerprintText(value, maxLength = 5000) {
  return normalizeText(value, maxLength)
    .normalize("NFKC")
    .toLocaleLowerCase("ru")
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function buildDuplicateFingerprint(product = {}) {
  const specifications = normalizeSpecifications(product.specifications);
  const specificationKey = Object.entries(specifications)
    .map(([key, value]) => [normalizeFingerprintText(key, 80), normalizeFingerprintText(value, 160)])
    .filter(([key, value]) => key && value)
    .sort(([left], [right]) => left.localeCompare(right, "ru"))
    .map(([key, value]) => `${key}:${value}`)
    .join("|");
  const firstImage = String(product.images?.[0] || product.image || "");
  const imageKey = firstImage
    ? `${firstImage.slice(0, 4096)}:${firstImage.slice(-4096)}`
    : "";
  const payload = [
    normalizeFingerprintText(product.name, 240),
    normalizeFingerprintText(product.category, 80),
    String(Number(product.priceAmount) || parsePriceAmount(product.price) || 0),
    normalizeFingerprintText(product.description ?? product.desc, 5000),
    normalizeFingerprintText(product.location, 120),
    normalizeFingerprintText(product.district, 120),
    specificationKey,
    imageKey
  ].join("\n");

  return createHash("sha256").update(payload).digest("hex");
}

async function findDuplicateListing(db, ownerId, fingerprint, excludeId = "") {
  if (!ownerId || !fingerprint) return null;
  const result = await db.query(
    `SELECT id, name, status
     FROM products
     WHERE owner_id = $1
       AND duplicate_fingerprint = $2
       AND id <> $3
       AND COALESCE(status, 'active') IN ('active', 'draft', 'archived')
     ORDER BY created_at ASC
     LIMIT 1`,
    [String(ownerId), fingerprint, String(excludeId || "")]
  );
  return result.rows[0] || null;
}

function normalizeSavedSearchFilters(value) {
  const filters = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const minPrice = normalizeText(filters.minPrice, 12).replace(/[^0-9]/g, "");
  const maxPrice = normalizeText(filters.maxPrice, 12).replace(/[^0-9]/g, "");
  return {
    minPrice,
    maxPrice,
    city: normalizeText(filters.city, 80),
    district: normalizeText(filters.district, 80),
    itemType: normalizeText(filters.itemType, 80),
    brand: normalizeText(filters.brand, 80),
    model: normalizeText(filters.model, 80),
    year: normalizeText(filters.year, 20),
    sort: ["newest", "price_asc", "price_desc"].includes(filters.sort) ? filters.sort : "newest"
  };
}

function buildSavedSearchKey(search, category, filters) {
  return createHash("sha256")
    .update(JSON.stringify({ search, category, filters }))
    .digest("hex");
}

function mapSavedSearch(row) {
  return {
    id: row.id,
    name: row.name || "Сохранённый поиск",
    search: row.search_query || "",
    category: row.category || "Все",
    filters: normalizeSavedSearchFilters(row.filters),
    createdAt: row.created_at ? new Date(row.created_at).getTime() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : null
  };
}

function buildSellerTrust(row = {}) {
  const ratingAverage = Math.max(0, Math.min(5, Number(row.rating_average) || 0));
  const ratingCount = Math.max(0, Number(row.rating_count) || 0);
  const activeListings = Math.max(0, Number(row.active_listings) || 0);
  const soldListings = Math.max(0, Number(row.sold_listings) || 0);
  const totalViews = Math.max(0, Number(row.total_views) || 0);
  const favoriteCount = Math.max(0, Number(row.favorite_count) || 0);
  const pendingReports = Math.max(0, Number(row.pending_reports) || 0);
  const phoneVerified = Boolean(row.phone_verified);
  const telegramVerified = Boolean(row.telegram_verified);
  const professionalSeller = Boolean(row.professional_seller);
  const profileComplete = Boolean(row.profile_complete);
  const memberSince = row.member_since ? new Date(row.member_since).getTime() : null;
  const accountAgeDays = memberSince ? Math.max(0, Math.floor((Date.now() - memberSince) / 86_400_000)) : 0;

  const score = Math.max(0, Math.min(100,
    15 +
    (telegramVerified ? 15 : 0) +
    (phoneVerified ? 15 : 0) +
    (profileComplete ? 5 : 0) +
    (professionalSeller ? 10 : 0) +
    Math.min(10, Math.floor(accountAgeDays / 30) * 2) +
    Math.min(15, soldListings * 3) +
    Math.min(10, ratingCount * 2) +
    (ratingCount ? Math.round((ratingAverage / 5) * 10) : 0) -
    Math.min(20, pendingReports * 5)
  ));

  let level = "new";
  let label = "Новый продавец";
  if (score >= 85 && ratingAverage >= 4.5 && soldListings >= 1) {
    level = "high";
    label = "Высокое доверие";
  } else if (score >= 65) {
    level = "reliable";
    label = "Надёжный продавец";
  } else if (ratingCount > 0 || score >= 45) {
    level = "rated";
    label = "Профиль с историей";
  }

  return {
    ratingAverage: Number(ratingAverage.toFixed(1)),
    ratingCount,
    activeListings,
    soldListings,
    totalViews,
    favoriteCount,
    pendingReports,
    phoneVerified,
    telegramVerified,
    professionalSeller,
    profileComplete,
    memberSince,
    accountAgeDays,
    score,
    level,
    label
  };
}

async function getSellerTrust(db, sellerId) {
  const result = await db.query(
    `SELECT
       COALESCE((SELECT AVG(rating)::numeric(3,2) FROM seller_reviews WHERE seller_id = $1), 0) AS rating_average,
       (SELECT COUNT(*)::int FROM seller_reviews WHERE seller_id = $1) AS rating_count,
       (SELECT COUNT(*)::int FROM products WHERE owner_id = $1 AND COALESCE(status, 'active') = 'active' AND COALESCE(hidden, FALSE) = FALSE) AS active_listings,
       (SELECT COUNT(*)::int FROM products WHERE owner_id = $1 AND COALESCE(status, 'active') = 'sold') AS sold_listings,
       COALESCE((SELECT SUM(views)::bigint FROM products WHERE owner_id = $1), 0) AS total_views,
       (SELECT COUNT(*)::int FROM favorites f JOIN products p ON p.id = f.product_id WHERE p.owner_id = $1) AS favorite_count,
       (SELECT COUNT(*)::int FROM reports r JOIN products p ON p.id = r.product_id WHERE p.owner_id = $1 AND r.status = 'pending') AS pending_reports,
       COALESCE((SELECT phone_normalized <> '' FROM users WHERE telegram_id = $1), FALSE) AS phone_verified,
       EXISTS(SELECT 1 FROM users WHERE telegram_id = $1) AS telegram_verified,
       COALESCE((SELECT professional_subscription_until > NOW() FROM users WHERE telegram_id = $1), FALSE) AS professional_seller,
       COALESCE((SELECT (COALESCE(profile_description, '') <> '' AND COALESCE(city, '') <> '') FROM users WHERE telegram_id = $1), FALSE) AS profile_complete,
       COALESCE((SELECT created_at FROM users WHERE telegram_id = $1), (SELECT MIN(created_at) FROM products WHERE owner_id = $1)) AS member_since`,
    [String(sellerId)]
  );
  return buildSellerTrust(result.rows[0] || {});
}

function mapSellerReview(row) {
  return {
    id: row.id,
    reviewerName: row.reviewer_name || "Покупатель",
    rating: Math.max(1, Math.min(5, Number(row.rating) || 1)),
    comment: row.comment || "",
    createdAt: row.created_at ? new Date(row.created_at).getTime() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : null
  };
}

function normalizePhoneKey(value) {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 10) digits = `7${digits}`;
  if (digits.length === 11 && digits.startsWith("8")) digits = `7${digits.slice(1)}`;
  return digits.slice(0, 15);
}

function isProfessionalSubscriptionActive(row = {}, now = Date.now()) {
  const until = row.professional_subscription_until ?? row.professionalSubscriptionUntil;
  if (!until) return false;
  const timestamp = new Date(until).getTime();
  return Number.isFinite(timestamp) && timestamp > now;
}


function normalizeListingFeeType(value) {
  const normalized = normalizeText(value, 30).toLowerCase();
  return ["automobile", "vacancy", "apartment", "house", "land"].includes(normalized) ? normalized : "";
}

function getListingFeeType(category, specifications = {}) {
  const cleanCategory = normalizeText(category, 60);
  const specs = specifications && typeof specifications === "object" ? specifications : {};
  const itemType = normalizeText(
    specs["Тип товара"] || specs["Подкатегория"] || specs["Тип"] || specs["Тип недвижимости"] || "",
    80
  ).toLowerCase();

  if (cleanCategory === "Вакансии") return "vacancy";
  if (cleanCategory === "Авто" && itemType !== "автозапчасть") return "automobile";
  if (cleanCategory === "Недвижимость") {
    if (itemType.includes("квартир")) return "apartment";
    if (itemType.includes("участ")) return "land";
    if (itemType.includes("дом") || itemType.includes("коттедж")) return "house";
  }
  return "";
}

async function getMonetizationSettings(database = pool) {
  const result = await database.query(`
    SELECT automobile_paid, vacancy_paid, apartment_paid, house_paid, land_paid
    FROM monetization_settings WHERE id = TRUE LIMIT 1
  `);
  const row = result.rows[0] || {};
  return {
    automobile: row.automobile_paid === true,
    vacancy: row.vacancy_paid === true,
    apartment: row.apartment_paid === true,
    house: row.house_paid === true,
    land: row.land_paid === true
  };
}

async function getListingFeeRequirement(database, category, specifications = {}) {
  const feeType = getListingFeeType(category, specifications);
  if (!feeType) return { required: false, feeType: "", priceRub: 0 };
  const settings = await getMonetizationSettings(database);
  return {
    required: settings[feeType] === true,
    feeType,
    priceRub: PAID_LISTING_PRICES[feeType] || 0
  };
}

async function hasSuccessfulListingPayment(database, userId, productId, feeType = "") {
  const values = [String(userId), String(productId)];
  let extra = "";
  if (feeType) {
    values.push(feeType);
    extra = ` AND plan = $3`;
  }
  const result = await database.query(
    `SELECT 1 FROM payment_orders
     WHERE user_id = $1 AND product_id = $2 AND purpose = 'listing_fee' AND status = 'succeeded'${extra}
     LIMIT 1`,
    values
  );
  return result.rows.length > 0;
}

async function getListingQuota(db, userId, { lockUser = false } = {}) {
  const userResult = await db.query(
    `SELECT listing_limit, professional_subscription_started_at, professional_subscription_until
     FROM users
     WHERE telegram_id = $1
     ${lockUser ? "FOR UPDATE" : ""}`,
    [String(userId)]
  );
  const userRow = userResult.rows[0] || {};
  const unlimited = isProfessionalSubscriptionActive(userRow);
  const customLimit = Math.max(1, Math.min(MAX_LISTING_LIMIT, Number(userRow.listing_limit) || DEFAULT_LISTING_LIMIT));
  const limit = unlimited ? null : customLimit;
  const countResult = await db.query(
    `SELECT COUNT(*)::int AS used
     FROM products
     WHERE owner_id = $1
       AND COALESCE(status, 'active') NOT IN ('deleted', 'sold')`,
    [String(userId)]
  );
  const used = Number(countResult.rows[0]?.used) || 0;
  const subscriptionUntil = userRow.professional_subscription_until
    ? new Date(userRow.professional_subscription_until).toISOString()
    : null;
  return {
    used,
    limit,
    unlimited,
    remaining: unlimited ? null : Math.max(0, customLimit - used),
    tier: unlimited ? "professional" : "standard",
    professionalSubscriptionActive: unlimited,
    professionalSubscriptionUntil: subscriptionUntil,
    professionalSubscriptionPriceRub: PROFESSIONAL_SUBSCRIPTION_PRICE_RUB,
    professionalSubscriptionDays: PROFESSIONAL_SUBSCRIPTION_DAYS,
    defaultLimit: DEFAULT_LISTING_LIMIT
  };
}

async function resolveBoundPhone(db, userId, requestedPhone) {
  const userResult = await db.query(
    `SELECT phone, phone_normalized
     FROM users
     WHERE telegram_id = $1
     FOR UPDATE`,
    [String(userId)]
  );
  const user = userResult.rows[0] || {};
  const savedPhone = normalizeText(user.phone, 30);
  const savedKey = normalizePhoneKey(user.phone_normalized || savedPhone);
  const requested = normalizeText(requestedPhone, 30);
  const requestedKey = normalizePhoneKey(requested);

  if (!requestedKey) {
    return { ok: true, phone: savedPhone, phoneKey: savedKey };
  }

  if (requestedKey.length < 10) {
    return { ok: false, status: 400, code: "INVALID_PHONE", error: "Проверьте формат телефона" };
  }

  if (savedKey && savedKey !== requestedKey) {
    return {
      ok: false,
      status: 409,
      code: "PROFILE_PHONE_MISMATCH",
      error: "В объявлении можно использовать только номер, привязанный к вашему профилю. Сначала измените номер в профиле."
    };
  }

  const ownerResult = await db.query(
    `SELECT telegram_id
     FROM users
     WHERE phone_normalized = $1
       AND telegram_id <> $2
     LIMIT 1`,
    [requestedKey, String(userId)]
  );
  if (ownerResult.rows.length > 0) {
    return {
      ok: false,
      status: 409,
      code: "PHONE_ALREADY_USED",
      error: "Этот номер уже привязан к другому профилю"
    };
  }

  if (!savedKey) {
    await db.query(
      `UPDATE users
       SET phone = $2, phone_normalized = $3, updated_at = NOW()
       WHERE telegram_id = $1`,
      [String(userId), requested, requestedKey]
    );
  }

  return { ok: true, phone: savedPhone || requested, phoneKey: requestedKey };
}

function normalizeProductStatus(value, fallback = "active") {
  const status = normalizeText(value, 20).toLowerCase();
  return PRODUCT_STATUSES.has(status) ? status : fallback;
}

function normalizeProductCondition(value, fallback = "used") {
  const condition = normalizeText(value, 30).toLowerCase();
  return PRODUCT_CONDITIONS.has(condition) ? condition : fallback;
}

function normalizeBoolean(value) {
  return value === true || value === "true" || value === 1 || value === "1";
}

function normalizeSpecifications(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const entries = Object.entries(value)
    .slice(0, 20)
    .map(([key, item]) => [normalizeText(key, 50), normalizeText(item, 120)])
    .filter(([key, item]) => key && item);

  return Object.fromEntries(entries);
}

function calculateListingQuality(product) {
  const images = Array.isArray(product.images) ? product.images : [];
  const specifications =
    product.specifications && typeof product.specifications === "object"
      ? product.specifications
      : {};
  const tips = [];
  let score = 0;

  if (String(product.name || "").length >= 12) score += 15;
  else tips.push("Сделайте название подробнее: не менее 12 символов");

  if (String(product.desc || "").length >= 80) score += 20;
  else tips.push("Добавьте подробное описание: не менее 80 символов");

  if (images.length >= 3) score += 25;
  else if (images.length >= 1) {
    score += 15;
    tips.push("Добавьте минимум 3 фотографии");
  } else {
    tips.push("Добавьте фотографии товара");
  }

  if (product.category) score += 10;
  if (product.price) score += 10;
  if (product.condition) score += 8;

  if (product.district) score += 5;
  else tips.push("Укажите район");

  if (Object.keys(specifications).length >= 2) score += 5;
  else tips.push("Добавьте хотя бы 2 характеристики");

  if (product.delivery || product.negotiable) score += 2;

  return {
    score: Math.min(score, 100),
    level: score >= 80 ? "excellent" : score >= 60 ? "good" : "needs_work",
    tips: tips.slice(0, 4)
  };
}

function normalizePositiveInteger(value, fallback, maximum) {
  const number = Number.parseInt(String(value ?? ""), 10);

  if (!Number.isFinite(number) || number <= 0) {
    return fallback;
  }

  return Math.min(number, maximum);
}

function hasValidImageSignature(buffer, subtype) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return false;
  const type = String(subtype || "").toLowerCase();

  if (type === "jpg" || type === "jpeg") {
    return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }

  if (type === "png") {
    return buffer.length >= 8 && buffer.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    );
  }

  if (type === "webp") {
    return buffer.length >= 12 &&
      buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
      buffer.subarray(8, 12).toString("ascii") === "WEBP";
  }

  return false;
}

function parseStoredDataImage(value) {
  const image = String(value ?? "").trim();
  if (!image || image.length > 8_500_000) return null;

  const match = image.match(/^data:image\/(jpeg|jpg|png|webp);base64,([a-z0-9+/]+={0,2})$/i);
  if (!match) return null;

  const subtype = match[1].toLowerCase();
  const payload = match[2];
  if (payload.length % 4 === 1) return null;

  const buffer = Buffer.from(payload, "base64");
  if (!buffer.length || buffer.length > MAX_STORED_IMAGE_BYTES) return null;
  if (!hasValidImageSignature(buffer, subtype)) return null;

  return {
    buffer,
    contentType: subtype === "jpg" ? "image/jpeg" : `image/${subtype}`
  };
}

async function optimizeStoredProductImage(value, { thumbnail = false } = {}) {
  const normalized = normalizeProductImage(value);
  if (!normalized || /^https:\/\//i.test(normalized)) return normalized;
  const parsed = parseStoredDataImage(normalized);
  if (!parsed) return "";
  try {
    const width = thumbnail ? PRODUCT_THUMBNAIL_WIDTH : PRODUCT_IMAGE_MAX_WIDTH;
    const quality = thumbnail ? Math.max(50, PRODUCT_IMAGE_WEBP_QUALITY - 10) : PRODUCT_IMAGE_WEBP_QUALITY;
    const output = await sharp(parsed.buffer, { limitInputPixels: 40_000_000 })
      .rotate()
      .resize({ width, withoutEnlargement: true })
      .webp({ quality, effort: 4 })
      .toBuffer();
    if (!output.length || output.length > MAX_STORED_IMAGE_BYTES) return normalized;
    return `data:image/webp;base64,${output.toString("base64")}`;
  } catch (error) {
    console.warn("Product image optimization fallback:", error?.message || error);
    return normalized;
  }
}

async function optimizeProductImageList(values = []) {
  const normalized = values.map(normalizeProductImage).filter(Boolean).slice(0, 5);
  return Promise.all(normalized.map(value => optimizeStoredProductImage(value)));
}

function normalizeProductImage(value) {
  const image = String(value ?? "").trim();
  if (!image) return "";

  if (/^https:\/\/[^\s"'<>]+$/i.test(image)) {
    return image;
  }

  return parseStoredDataImage(image) ? image : "";
}

function pickValidProductImage(...candidates) {
  for (const candidate of candidates.flat(Infinity)) {
    const normalized = normalizeProductImage(candidate);
    if (normalized) return normalized;
  }

  return "";
}


function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[character]));
}

function getPublicOrigin(req) {
  if (/^https?:\/\/[^\s]+$/i.test(PUBLIC_BASE_URL)) {
    return PUBLIC_BASE_URL;
  }

  const forwardedProtocol = String(req.get("x-forwarded-proto") || "")
    .split(",")[0]
    .trim();
  const forwardedHost = String(req.get("x-forwarded-host") || "")
    .split(",")[0]
    .trim();
  const protocol = forwardedProtocol || req.protocol || "https";
  const host = forwardedHost || req.get("host") || "";

  return host ? `${protocol}://${host}`.replace(/\/+$/, "") : "";
}

function buildProductTelegramLink(productId) {
  const cleanProductId = normalizeText(productId, 64);
  if (!BOT_USERNAME || !cleanProductId) return "";
  return `https://t.me/${encodeURIComponent(BOT_USERNAME)}?startapp=${encodeURIComponent(`product_${cleanProductId}`)}`;
}

async function getPublicProductShareRow(productId) {
  const result = await pool.query(
    `
      SELECT
        p.id,
        p.name,
        p.price,
        p.price_amount,
        p.previous_price,
        p.previous_price_amount,
        p.description,
        p.location,
        p.updated_at,
        p.created_at,
        (SELECT NULLIF(pi.preview_url, '')
         FROM product_images pi
         WHERE pi.product_id = p.id
         ORDER BY pi.position ASC, pi.created_at ASC
         LIMIT 1) AS preview_source,
        NULLIF(p.thumbnail, '') AS thumbnail_source,
        (SELECT NULLIF(pi.url, '')
         FROM product_images pi
         WHERE pi.product_id = p.id
         ORDER BY pi.position ASC, pi.created_at ASC
         LIMIT 1) AS table_source,
        NULLIF(p.image, '') AS primary_source,
        CASE
          WHEN jsonb_typeof(p.images) = 'array' THEN p.images ->> 0
          ELSE NULL
        END AS legacy_source
      FROM products p
      WHERE p.id = $1
        AND COALESCE(p.status, 'active') = 'active'
        AND COALESCE(p.hidden, FALSE) = FALSE
        AND COALESCE(p.moderation_status, 'approved') = 'approved'
      LIMIT 1;
    `,
    [productId]
  );

  return result.rows[0] || null;
}

function getShareRowImageSource(row) {
  if (!row) return "";
  return pickValidProductImage(
    row.preview_source,
    row.thumbnail_source,
    row.table_source,
    row.primary_source,
    row.legacy_source
  );
}

function isPrivateNetworkAddress(address) {
  let value = String(address || "").toLowerCase().split("%")[0];
  if (value.startsWith("::ffff:")) value = value.slice(7);

  const version = isIP(value);
  if (version === 4) {
    const parts = value.split(".").map(Number);
    const [a, b] = parts;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }

  if (version === 6) {
    return (
      value === "::" ||
      value === "::1" ||
      /^f[cd]/i.test(value) ||
      /^fe[89ab]/i.test(value)
    );
  }

  return true;
}

async function validatePublicImageUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("Разрешены только публичные HTTPS-фотографии");
  }
  if (url.port && url.port !== "443") {
    throw new Error("Недопустимый порт фотографии");
  }

  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(item => isPrivateNetworkAddress(item.address))) {
    throw new Error("Адрес фотографии недоступен");
  }

  return url;
}

async function readRemoteImageBuffer(source) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);

  try {
    let currentUrl = await validatePublicImageUrl(source);
    let response = null;

    for (let redirectCount = 0; redirectCount <= 3; redirectCount += 1) {
      response = await fetch(currentUrl, {
        signal: controller.signal,
        headers: { "User-Agent": `OssetianMarket/${APP_VERSION}` },
        redirect: "manual"
      });

      if (response.status < 300 || response.status >= 400) break;
      const location = response.headers.get("location");
      if (!location || redirectCount === 3) {
        throw new Error("Слишком много перенаправлений фотографии");
      }
      currentUrl = await validatePublicImageUrl(new URL(location, currentUrl).toString());
    }

    if (!response?.ok) {
      throw new Error(`Не удалось загрузить фото: HTTP ${response?.status || 0}`);
    }

    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    if (contentType && !contentType.startsWith("image/")) {
      throw new Error("Ссылка не ведёт на изображение");
    }

    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength > MAX_STORED_IMAGE_BYTES) {
      throw new Error("Фотография слишком большая");
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length || buffer.length > MAX_STORED_IMAGE_BYTES) {
      throw new Error("Некорректный размер фотографии");
    }

    return buffer;
  } finally {
    clearTimeout(timeout);
  }
}

async function createShareJpeg(source) {
  const parsed = parseStoredDataImage(source);
  const input = parsed?.buffer || await readRemoteImageBuffer(source);
  const render = (size, quality) => sharp(input, { limitInputPixels: 40_000_000 })
    .rotate()
    .resize({
      width: size,
      height: size,
      fit: "inside",
      withoutEnlargement: true
    })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality, mozjpeg: true })
    .toBuffer();

  const primary = await render(1280, 84);
  return primary.length <= 4_800_000 ? primary : render(1024, 70);
}

async function callTelegramBotApi(method, payload) {
  const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(12_000)
  });

  let data = null;
  try {
    data = await response.json();
  } catch {
    throw new Error(`Telegram API вернул некорректный ответ: HTTP ${response.status}`);
  }

  if (!response.ok || !data?.ok) {
    throw new Error(data?.description || `Telegram API error: HTTP ${response.status}`);
  }

  return data.result;
}

function formatStoredPrice(value) {
  const raw = String(value ?? "").trim();
  const digits = raw.replace(/[\s\u00a0₽]/g, "");

  if (!/^\d+$/.test(digits)) {
    return "";
  }

  const number = Number(digits);

  if (!Number.isSafeInteger(number) || number <= 0 || number > 100_000_000) {
    return "";
  }

  return `${number.toLocaleString("ru-RU")} ₽`;
}

function parsePriceAmount(value) {
  const digits = String(value ?? "").replace(/[^0-9]/g, "");
  const amount = Number(digits);
  return Number.isSafeInteger(amount) && amount > 0 && amount <= 100_000_000
    ? amount
    : 0;
}

function normalizeModerationText(value) {
  return String(value ?? "")
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsModerationPattern(text, pattern, matchType) {
  const normalizedText = normalizeModerationText(text);
  const normalizedPattern = normalizeModerationText(pattern);
  if (!normalizedText || !normalizedPattern) return false;

  if (matchType === "phrase" || matchType === "domain") {
    return normalizedText.includes(normalizedPattern);
  }

  const expression = new RegExp(
    `(^|[^\p{L}\p{N}])${escapeRegExp(normalizedPattern)}(?=$|[^\p{L}\p{N}])`,
    "iu"
  );
  return expression.test(normalizedText);
}

function normalizeOptionalDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeAdTargetUrl(value) {
  const target = normalizeText(value, 1000);
  if (!target) return "";
  return /^https:\/\/[^\s"'<>]+$/i.test(target) ? target : "";
}

function isYooKassaConfigured() {
  let publicUrlOk = false;
  try {
    const parsed = new URL(PUBLIC_BASE_URL);
    publicUrlOk = parsed.protocol === "https:" || (!IS_RENDER && ["localhost", "127.0.0.1"].includes(parsed.hostname));
  } catch {}
  return PAYMENTS_ENABLED && PAYMENT_PROVIDER === "yookassa" && Boolean(YOOKASSA_SHOP_ID && YOOKASSA_SECRET_KEY && publicUrlOk);
}

function yooKassaAuthorizationHeader() {
  return `Basic ${Buffer.from(`${YOOKASSA_SHOP_ID}:${YOOKASSA_SECRET_KEY}`).toString("base64")}`;
}

async function requestYooKassa(endpoint, options = {}) {
  if (!isYooKassaConfigured()) throw new Error("ЮKassa не настроена");
  const response = await fetch(`${YOOKASSA_API_URL}${endpoint}`, {
    ...options,
    signal: options.signal || AbortSignal.timeout(PAYMENT_PROVIDER_TIMEOUT_MS),
    headers: {
      Authorization: yooKassaAuthorizationHeader(),
      "Content-Type": "application/json",
      "User-Agent": `OssetianMarket/${APP_VERSION}`,
      ...(options.headers || {})
    }
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(payload?.description || payload?.code || `YooKassa HTTP ${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

const YOOKASSA_WEBHOOK_NETWORKS = Object.freeze([
  "185.71.76.0/27",
  "185.71.77.0/27",
  "77.75.153.0/25",
  "77.75.156.11/32",
  "77.75.156.35/32",
  "77.75.154.128/25",
  "2a02:5180::/32"
]);

function normalizeRemoteIp(value) {
  const raw = String(value || "").trim().split(",")[0].trim();
  return raw.startsWith("::ffff:") ? raw.slice(7) : raw;
}

function ipv4ToInt(value) {
  const parts = String(value).split(".").map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return (((parts[0] * 256 + parts[1]) * 256 + parts[2]) * 256 + parts[3]) >>> 0;
}

function ipv4InCidr(ip, cidr) {
  const [network, prefixRaw] = cidr.split("/");
  const prefix = Number(prefixRaw);
  const ipInt = ipv4ToInt(ip);
  const networkInt = ipv4ToInt(network);
  if (ipInt === null || networkInt === null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipInt & mask) === (networkInt & mask);
}

function expandIpv6(value) {
  const input = String(value || "").toLowerCase().split("%")[0];
  if (!input.includes(":")) return null;
  const [leftRaw, rightRaw = ""] = input.split("::");
  const left = leftRaw ? leftRaw.split(":").filter(Boolean) : [];
  const right = rightRaw ? rightRaw.split(":").filter(Boolean) : [];
  if (!input.includes("::") && left.length !== 8) return null;
  const missing = 8 - left.length - right.length;
  if (missing < 0) return null;
  const groups = [...left, ...Array(missing).fill("0"), ...right];
  if (groups.length !== 8 || groups.some(group => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups.map(group => parseInt(group, 16));
}

function ipv6InCidr(ip, cidr) {
  const [network, prefixRaw] = cidr.split("/");
  const prefix = Number(prefixRaw);
  const a = expandIpv6(ip);
  const b = expandIpv6(network);
  if (!a || !b || !Number.isInteger(prefix) || prefix < 0 || prefix > 128) return false;
  let bits = prefix;
  for (let i = 0; i < 8 && bits > 0; i += 1) {
    const take = Math.min(16, bits);
    const mask = take === 16 ? 0xffff : (0xffff << (16 - take)) & 0xffff;
    if ((a[i] & mask) !== (b[i] & mask)) return false;
    bits -= take;
  }
  return true;
}

function isAllowedYooKassaWebhookIp(value) {
  const ip = normalizeRemoteIp(value);
  if (isIP(ip) === 4) return YOOKASSA_WEBHOOK_NETWORKS.some(cidr => cidr.includes(".") && ipv4InCidr(ip, cidr));
  if (isIP(ip) === 6) return YOOKASSA_WEBHOOK_NETWORKS.some(cidr => cidr.includes(":") && ipv6InCidr(ip, cidr));
  return false;
}

function paymentAmountString(value) {
  return Math.max(0, Number(value) || 0).toFixed(2);
}

async function createCheckoutPayment({ userId, productId = null, purpose, plan, amount, description, metadata = {}, lockKey = "" }) {
  if (!isYooKassaConfigured()) {
    const error = new Error("Онлайн-оплата пока не настроена");
    error.code = "PAYMENTS_NOT_CONFIGURED";
    throw error;
  }
  const cleanPurpose = normalizeText(purpose, 50);
  const cleanPlan = normalizeText(plan, 50);
  const cleanProductId = productId ? normalizeText(productId, 64) : null;
  const orderClient = await pool.connect();
  let orderId = "";
  let idempotenceKey = "";
  try {
    await orderClient.query("BEGIN");
    await orderClient.query("SELECT pg_advisory_xact_lock(hashtext($1))", [lockKey || `${cleanPurpose}:${userId}:${cleanProductId || "none"}:${cleanPlan}`]);
    await orderClient.query(`
      UPDATE payment_orders SET status='failed', updated_at=NOW()
      WHERE user_id=$1 AND purpose=$2 AND plan=$3
        AND (($4::text IS NULL AND product_id IS NULL) OR product_id=$4)
        AND status='creating' AND created_at < NOW() - INTERVAL '15 minutes'
    `, [String(userId), cleanPurpose, cleanPlan, cleanProductId]);
    const existingResult = await orderClient.query(`
      SELECT id, status, confirmation_url, amount, currency
      FROM payment_orders
      WHERE user_id=$1 AND purpose=$2 AND plan=$3
        AND (($4::text IS NULL AND product_id IS NULL) OR product_id=$4)
        AND status IN ('creating','pending','waiting_for_capture')
      ORDER BY created_at DESC LIMIT 1
    `, [String(userId), cleanPurpose, cleanPlan, cleanProductId]);
    if (existingResult.rows.length) {
      await orderClient.query("COMMIT");
      const existing = existingResult.rows[0];
      return {
        reused: true,
        orderId: existing.id,
        status: existing.status,
        confirmationUrl: existing.confirmation_url || "",
        amount: Number(existing.amount) || Number(amount) || 0,
        currency: existing.currency || "RUB"
      };
    }
    orderId = randomUUID();
    idempotenceKey = randomUUID();
    await orderClient.query(`
      INSERT INTO payment_orders (id,user_id,product_id,purpose,plan,amount,currency,status,provider,idempotence_key,metadata)
      VALUES ($1,$2,$3,$4,$5,$6,'RUB','creating','yookassa',$7,$8::jsonb)
    `, [orderId, String(userId), cleanProductId, cleanPurpose, cleanPlan, Number(amount) || 0, idempotenceKey, JSON.stringify(metadata)]);
    await orderClient.query("COMMIT");
  } catch (error) {
    await orderClient.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    orderClient.release();
  }

  try {
    const payment = await requestYooKassa("/payments", {
      method: "POST",
      headers: { "Idempotence-Key": idempotenceKey },
      body: JSON.stringify({
        amount: { value: paymentAmountString(amount), currency: "RUB" },
        capture: true,
        confirmation: { type: "redirect", return_url: `${PUBLIC_BASE_URL}/?payment=return&order=${encodeURIComponent(orderId)}` },
        description: normalizeText(description, 120),
        metadata: {
          order_id: orderId,
          user_id: String(userId),
          product_id: cleanProductId || "",
          purpose: cleanPurpose,
          plan: cleanPlan,
          app: "ossetian-market"
        }
      })
    });
    await pool.query(`
      UPDATE payment_orders SET status=$2, provider_payment_id=$3, confirmation_url=$4, updated_at=NOW() WHERE id=$1
    `, [orderId, normalizeText(payment.status, 30) || "pending", normalizeText(payment.id, 100), normalizeText(payment.confirmation?.confirmation_url, 1200)]);
    return {
      reused: false,
      orderId,
      status: payment.status || "pending",
      confirmationUrl: payment.confirmation?.confirmation_url || "",
      amount: Number(amount) || 0,
      currency: "RUB"
    };
  } catch (error) {
    await pool.query(`UPDATE payment_orders SET status='failed', updated_at=NOW() WHERE id=$1`, [orderId]).catch(() => {});
    throw error;
  }
}

async function activatePaidPromotion(client, order, providerPayment = null) {
  const plan = PROMOTION_PLANS[order.plan];
  if (!plan) throw new Error("Неизвестный тариф продвижения");
  const productResult = await client.query(
    `SELECT id, owner_id, status, hidden, moderation_status, featured_until FROM products WHERE id = $1 FOR UPDATE`,
    [order.product_id]
  );
  if (!productResult.rows.length) throw new Error("Объявление для оплаты не найдено");
  const product = productResult.rows[0];
  if (String(product.owner_id) !== String(order.user_id)) throw new Error("Владелец платежа не совпадает с владельцем объявления");
  if (product.status !== "active" || product.hidden || (product.moderation_status || "approved") !== "approved") {
    throw new Error("Оплаченное объявление сейчас нельзя продвигать");
  }
  const currentUntil = product.featured_until ? new Date(product.featured_until).getTime() : 0;
  const startAt = Math.max(Date.now(), Number.isFinite(currentUntil) ? currentUntil : 0);
  const featuredUntil = new Date(startAt + plan.days * 86_400_000);
  await client.query(`
    UPDATE products
    SET featured_paid = TRUE, featured_color = $2, featured_until = $3,
        promotion_plan = $4, promotion_priority = $5, updated_at = NOW()
    WHERE id = $1
  `, [order.product_id, FEATURE_COLOR, featuredUntil, plan.id, plan.priority]);

  await client.query(`
    INSERT INTO product_feature_requests (
      id, product_id, owner_id, color, plan, days, price_amount, status, approved_by, approved_at,
      reviewed_by, reviewed_at, admin_note, payment_order_id, request_source
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,'approved','payment',NOW(),'payment',NOW(),$8,$9,'payment')
  `, [randomUUID(), order.product_id, order.user_id, FEATURE_COLOR, plan.id, plan.days, Number(order.amount) || plan.priceRub,
      `Автоматически активировано после оплаты ${providerPayment?.id || order.provider_payment_id || order.id}`, order.id]);
  return { featuredUntil, plan };
}

async function activateProfessionalSubscription(client, order, providerPayment = null) {
  const userResult = await client.query(
    `SELECT telegram_id, professional_subscription_until FROM users WHERE telegram_id = $1 FOR UPDATE`,
    [String(order.user_id)]
  );
  if (!userResult.rows.length) throw new Error("Пользователь подписки не найден");
  const currentUntil = userResult.rows[0].professional_subscription_until
    ? new Date(userResult.rows[0].professional_subscription_until).getTime()
    : 0;
  const startAt = Math.max(Date.now(), Number.isFinite(currentUntil) ? currentUntil : 0);
  const subscriptionUntil = new Date(startAt + PROFESSIONAL_SUBSCRIPTION_DAYS * 86_400_000);
  await client.query(`
    UPDATE users
    SET is_business = TRUE,
        business_verified = FALSE,
        professional_subscription_started_at = COALESCE(professional_subscription_started_at, NOW()),
        professional_subscription_until = $2,
        updated_at = NOW()
    WHERE telegram_id = $1
  `, [String(order.user_id), subscriptionUntil]);
  return { subscriptionUntil };
}

async function activatePaidListing(client, order) {
  const feeType = normalizeListingFeeType(order.plan);
  if (!feeType) throw new Error("Неизвестный тип платной публикации");
  const productResult = await client.query(
    `SELECT id, owner_id, status, hidden, moderation_status, category, specifications
     FROM products WHERE id = $1 FOR UPDATE`,
    [order.product_id]
  );
  if (!productResult.rows.length) throw new Error("Объявление для оплаты не найдено");
  const product = productResult.rows[0];
  if (String(product.owner_id) !== String(order.user_id)) throw new Error("Владелец платежа не совпадает с владельцем объявления");
  if (getListingFeeType(product.category, product.specifications || {}) !== feeType) throw new Error("Тип оплаченного объявления изменился");
  if (product.hidden || (product.moderation_status || "approved") !== "approved") {
    throw new Error("Оплаченное объявление ожидает модерацию и пока не может быть опубликовано");
  }
  await client.query(`
    UPDATE products
    SET status = 'active', published_at = COALESCE(published_at, NOW()),
        expires_at = NOW() + ($2::int * INTERVAL '1 day'), updated_at = NOW()
    WHERE id = $1
  `, [order.product_id, PRODUCT_ARCHIVE_DAYS]);
  return { productId: order.product_id };
}

async function finalizePaymentOrder(orderId, providerPayment) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(`SELECT * FROM payment_orders WHERE id = $1 FOR UPDATE`, [orderId]);
    if (!result.rows.length) { await client.query("ROLLBACK"); return { ok: false, reason: "order_not_found" }; }
    const order = result.rows[0];
    if (order.status === "succeeded") { await client.query("COMMIT"); return { ok: true, alreadyProcessed: true, order }; }
    if (!providerPayment || String(providerPayment.id || "") !== String(order.provider_payment_id || "")) throw new Error("Платёж провайдера не совпадает с заказом");
    if (String(providerPayment.metadata?.order_id || "") !== String(order.id)) throw new Error("Некорректный metadata.order_id");
    if (String(providerPayment.metadata?.user_id || "") !== String(order.user_id)) throw new Error("Некорректный metadata.user_id");
    if (String(providerPayment.metadata?.product_id || "") !== String(order.product_id || "")) throw new Error("Некорректный metadata.product_id");
    if (String(providerPayment.metadata?.purpose || order.purpose || "") !== String(order.purpose || "")) throw new Error("Некорректный metadata.purpose");
    const providerAmount = Number(providerPayment.amount?.value);
    if (!Number.isFinite(providerAmount) || Math.abs(providerAmount - Number(order.amount)) > 0.001 || providerPayment.amount?.currency !== order.currency) {
      throw new Error("Сумма или валюта платежа не совпадает с заказом");
    }
    if (providerPayment.status === "succeeded" && providerPayment.paid === true) {
      let activation = {};
      if (order.purpose === "promotion") activation = await activatePaidPromotion(client, order, providerPayment);
      else if (order.purpose === "professional_subscription") activation = await activateProfessionalSubscription(client, order, providerPayment);
      else if (order.purpose === "listing_fee") activation = await activatePaidListing(client, order, providerPayment);
      else throw new Error("Неизвестное назначение платежа");

      await client.query(
        `UPDATE payment_orders SET status='succeeded', paid_at=NOW(), updated_at=NOW(), metadata=$2::jsonb WHERE id=$1`,
        [order.id, JSON.stringify({ ...(order.metadata || {}), providerStatus: providerPayment.status, activation })]
      );
      await client.query("COMMIT");
      return { ok: true, status: "succeeded", orderId: order.id, ...activation };
    }
    if (providerPayment.status === "canceled") {
      await client.query(`UPDATE payment_orders SET status='canceled', canceled_at=NOW(), updated_at=NOW() WHERE id=$1`, [order.id]);
      await client.query("COMMIT");
      return { ok: true, status: "canceled", orderId: order.id };
    }
    await client.query(`UPDATE payment_orders SET status=$2, updated_at=NOW() WHERE id=$1`, [order.id, normalizeText(providerPayment.status, 30) || "pending"]);
    await client.query("COMMIT");
    return { ok: true, status: providerPayment.status || "pending", orderId: order.id };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

function buildModerationContent(product) {
  const specifications = product.specifications && typeof product.specifications === "object"
    ? Object.entries(product.specifications).flat().join(" ")
    : "";

  return [
    product.name,
    product.desc,
    product.location,
    product.district,
    specifications
  ].filter(Boolean).join(" ");
}

function extractOpenAIResponseText(payload) {
  if (!payload || typeof payload !== "object") return "";
  if (typeof payload.output_text === "string") return payload.output_text.trim();
  const chunks = [];
  for (const item of Array.isArray(payload.output) ? payload.output : []) {
    for (const content of Array.isArray(item?.content) ? item.content : []) {
      if (typeof content?.text === "string") chunks.push(content.text);
      if (typeof content?.output_text === "string") chunks.push(content.output_text);
    }
  }
  return chunks.join("\n").trim();
}

function getAIUsagePricing(kind) {
  if (kind === "moderation") {
    return { input: AI_MODERATION_INPUT_USD_PER_MTOK, output: AI_MODERATION_OUTPUT_USD_PER_MTOK };
  }
  return { input: AI_LISTING_INPUT_USD_PER_MTOK, output: AI_LISTING_OUTPUT_USD_PER_MTOK };
}

async function getAIBudgetStatus(database = pool) {
  if (AI_DAILY_BUDGET_USD <= 0) return { allowed: true, spentUsd: 0, estimatedCostUsd: 0, budgetUsd: 0, requests: 0 };
  try {
    const result = await database.query(`
      SELECT COALESCE(SUM(estimated_cost_usd), 0)::numeric AS spent, COUNT(*)::int AS requests
      FROM ai_usage_events
      WHERE created_at >= CURRENT_DATE;
    `);
    const spentUsd = Number(result.rows[0]?.spent) || 0;
    const requests = Number(result.rows[0]?.requests) || 0;
    return { allowed: spentUsd < AI_DAILY_BUDGET_USD, spentUsd, estimatedCostUsd: spentUsd, budgetUsd: AI_DAILY_BUDGET_USD, requests };
  } catch {
    return { allowed: true, spentUsd: 0, estimatedCostUsd: 0, budgetUsd: AI_DAILY_BUDGET_USD, requests: 0 };
  }
}

async function recordAIUsage({ userId = "", kind = "general", model = "", responseId = "", usage = {} }) {
  const inputTokens = Math.max(0, Number(usage?.input_tokens || usage?.inputTokens) || 0);
  const outputTokens = Math.max(0, Number(usage?.output_tokens || usage?.outputTokens) || 0);
  const pricing = getAIUsagePricing(kind);
  const estimatedCostUsd = (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output;
  try {
    await pool.query(`
      INSERT INTO ai_usage_events (id, user_id, kind, model, response_id, input_tokens, output_tokens, estimated_cost_usd)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8);
    `, [randomUUID(), normalizeText(userId, 64), normalizeText(kind, 40), normalizeText(model, 80), normalizeText(responseId, 120), inputTokens, outputTokens, estimatedCostUsd]);
  } catch (error) {
    console.warn("AI usage accounting failed:", error?.message || error);
  }
  return estimatedCostUsd;
}

async function callOpenAIStructured({ schemaName, schema, input, maxOutputTokens = 700, model = OPENAI_MODEL, kind = "general", userId = "" }) {
  if (!OPENAI_API_KEY) return { ok: false, unavailable: true, error: "OPENAI_API_KEY не настроен" };
  const budget = await getAIBudgetStatus();
  if (!budget.allowed) return { ok: false, unavailable: true, budgetExceeded: true, error: "Дневной лимит расходов AI исчерпан" };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  timeout.unref?.();
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
        "User-Agent": `OssetianMarket/${APP_VERSION}`
      },
      body: JSON.stringify({
        model,
        store: false,
        input,
        max_output_tokens: maxOutputTokens,
        text: {
          format: {
            type: "json_schema",
            name: schemaName,
            strict: true,
            schema
          }
        }
      })
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const message = payload?.error?.message || `OpenAI HTTP ${response.status}`;
      return { ok: false, error: message };
    }
    recordAIUsage({ userId, kind, model, responseId: payload?.id || "", usage: payload?.usage || {} }).catch(() => {});
    const text = extractOpenAIResponseText(payload);
    if (!text) return { ok: false, error: "AI вернул пустой ответ" };
    try {
      return { ok: true, data: JSON.parse(text), responseId: payload?.id || "" };
    } catch {
      return { ok: false, error: "Не удалось разобрать структурированный ответ AI" };
    }
  } catch (error) {
    return { ok: false, error: error?.name === "AbortError" ? "AI не ответил вовремя" : String(error?.message || error) };
  } finally {
    clearTimeout(timeout);
  }
}

function buildFallbackListingSuggestion(context = {}) {
  const category = PRODUCT_CATEGORIES.has(context.category) ? context.category : "Дом";
  const currentName = normalizeText(context.name, 120);
  const itemType = normalizeText(context.itemType, 80);
  const brand = normalizeText(context.brand, 80);
  const model = normalizeText(context.model, 80);
  const parts = [brand, model, itemType].filter(Boolean);
  const name = currentName || parts.join(" ") || (category === "Авто" ? "Автомобиль" : category === "Электроника" ? "Товар электроники" : "Товар");
  const description = normalizeText(context.desc, 3000) || `Продаётся ${name}. Состояние и комплектность уточняйте по фотографиям и у продавца. Возможен осмотр перед покупкой.`;
  const specifications = {};
  if (brand) specifications["Марка / бренд"] = brand;
  if (model) specifications["Модель"] = model;
  if (itemType) specifications["Тип товара"] = itemType;
  return { name: name.slice(0, 120), category, description, specifications, confidence: 0.25, source: "fallback" };
}

async function suggestListingFromImage({ image, context = {}, userId = "" }) {
  const fallback = buildFallbackListingSuggestion(context);
  if (!AI_LISTING_ASSISTANT_ENABLED || !OPENAI_API_KEY) return { ...fallback, aiAvailable: false };
  const imageValue = normalizeText(image, 4_500_000);
  if (!/^data:image\/(?:jpeg|jpg|png|webp);base64,[a-z0-9+/=\r\n]+$/i.test(imageValue)) {
    return { ...fallback, aiAvailable: true, error: "Для AI нужен JPEG, PNG или WebP" };
  }
  if (Buffer.byteLength(imageValue, "utf8") > 4_500_000) {
    return { ...fallback, aiAvailable: true, error: "Фото слишком большое для AI-анализа" };
  }
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      name: { type: "string" },
      category: { type: "string", enum: Array.from(PRODUCT_CATEGORIES) },
      description: { type: "string" },
      specifications: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: { key: { type: "string" }, value: { type: "string" } },
          required: ["key", "value"]
        }
      },
      confidence: { type: "number" },
      warning: { type: "string" }
    },
    required: ["name", "category", "description", "specifications", "confidence", "warning"]
  };
  const prompt = `Ты помощник локального маркетплейса Алания Маркет. По фотографии составь аккуратный черновик объявления на русском языке. Не выдумывай точную модель, характеристики, состояние или комплектность, если они не видны. Не называй цену. Категория должна быть одной из разрешённых. Текущее заполнение пользователя: ${JSON.stringify({ category: context.category || "", name: context.name || "", brand: context.brand || "", model: context.model || "", itemType: context.itemType || "" })}.`;
  const result = await callOpenAIStructured({
    schemaName: "listing_photo_assistant",
    schema,
    maxOutputTokens: 800,
    model: AI_LISTING_MODEL,
    kind: "listing",
    userId,
    input: [{
      role: "user",
      content: [
        { type: "input_text", text: prompt },
        { type: "input_image", image_url: imageValue }
      ]
    }]
  });
  if (!result.ok) return { ...fallback, aiAvailable: true, error: result.error };
  const data = result.data || {};
  const specs = {};
  for (const item of Array.isArray(data.specifications) ? data.specifications.slice(0, 12) : []) {
    const key = normalizeText(item?.key, 80);
    const value = normalizeText(item?.value, 160);
    if (key && value) specs[key] = value;
  }
  return {
    name: normalizeText(data.name, 120) || fallback.name,
    category: PRODUCT_CATEGORIES.has(data.category) ? data.category : fallback.category,
    description: normalizeText(data.description, 3000) || fallback.description,
    specifications: specs,
    confidence: Math.max(0, Math.min(1, Number(data.confidence) || 0)),
    warning: normalizeText(data.warning, 300),
    source: "openai",
    aiAvailable: true
  };
}

async function evaluateAIModeration(product, settings = {}) {
  if (!AI_MODERATION_ENABLED || settings.ai_enabled === false || !OPENAI_API_KEY) return { available: false, blocked: false, review: false, score: 0, reason: "", matches: [] };
  const content = buildModerationContent(product).slice(0, 7000);
  if (!content) return { available: true, blocked: false, review: false, score: 0, reason: "", matches: [] };
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      action: { type: "string", enum: ["allow", "review", "block"] },
      riskScore: { type: "integer" },
      reason: { type: "string" },
      categories: { type: "array", items: { type: "string" } }
    },
    required: ["action", "riskScore", "reason", "categories"]
  };
  const result = await callOpenAIStructured({
    schemaName: "marketplace_moderation",
    schema,
    maxOutputTokens: 400,
    model: AI_MODERATION_MODEL,
    kind: "moderation",
    userId: product.ownerId || product.owner_id || "",
    input: [{ role: "system", content: "Ты модератор российского маркетплейса. Оцени только риски объявления: мошенничество, запрещённые товары, оружие/наркотики, поддельные документы, опасные услуги, явный спам или обход контактов. Не блокируй обычные легальные товары из-за неоднозначности. block используй только при высокой уверенности, review — когда нужна проверка человеком." }, { role: "user", content }]
  });
  if (!result.ok) return { available: true, blocked: false, review: false, score: 0, reason: "", matches: [], error: result.error };
  const data = result.data || {};
  const score = Math.max(0, Math.min(100, Number(data.riskScore) || 0));
  const action = ["allow", "review", "block"].includes(data.action) ? data.action : "allow";
  const reason = normalizeText(data.reason, 800);
  const categories = Array.isArray(data.categories) ? data.categories.slice(0, 8).map(item => normalizeText(item, 80)).filter(Boolean) : [];
  const blockThreshold = Math.max(70, Math.min(100, Number(settings.ai_block_threshold) || 90));
  const reviewThreshold = Math.max(20, Math.min(blockThreshold - 1, Number(settings.ai_review_threshold) || 60));
  const blocked = action === "block" && score >= blockThreshold;
  const review = !blocked && action === "review" && score >= reviewThreshold;
  return {
    available: true,
    blocked,
    review,
    score,
    reason,
    action,
    model: AI_MODERATION_MODEL,
    responseId: result.responseId || "",
    matches: categories.map(label => ({ type: "ai", label: `AI: ${label}`, score }))
  };
}

async function evaluateProductModeration(product, database = pool) {
  const settingsResult = await database.query(`
    SELECT enabled, block_links, block_contacts, block_emails, ai_enabled, ai_review_threshold, ai_block_threshold
    FROM moderation_settings
    WHERE id = TRUE
    LIMIT 1;
  `);
  const settings = settingsResult.rows[0] || {
    enabled: true,
    block_links: true,
    block_contacts: true,
    block_emails: true,
    ai_enabled: true,
    ai_review_threshold: 60,
    ai_block_threshold: 90
  };

  if (settings.enabled === false) {
    return { blocked: false, reason: "", matches: [] };
  }

  const content = buildModerationContent(product);
  const matches = [];
  const linkPattern = /(?:https?:\/\/|tg:\/\/|mailto:|www\.|t\.me\/|telegram\.me\/|(?:[a-z0-9-]+\.)+[a-zа-я]{2,24}\b)/iu;
  const emailPattern = /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/iu;
  const telegramPattern = /(^|[^\p{L}\p{N}_])@[a-z0-9_]{5,32}\b/iu;
  const phonePattern = /(?:\+?\d[\s().-]*){10,}/u;

  if (settings.block_links && linkPattern.test(content)) {
    matches.push({ type: "link", label: "Ссылка в тексте объявления" });
  }
  if (settings.block_emails && emailPattern.test(content)) {
    matches.push({ type: "email", label: "Email в тексте объявления" });
  }
  if (settings.block_contacts && (telegramPattern.test(content) || phonePattern.test(content))) {
    matches.push({ type: "contact", label: "Контактные данные в тексте объявления" });
  }

  const rulesResult = await database.query(`
    SELECT id, pattern, match_type
    FROM moderation_rules
    WHERE is_active = TRUE
    ORDER BY created_at ASC;
  `);

  for (const rule of rulesResult.rows) {
    if (containsModerationPattern(content, rule.pattern, rule.match_type)) {
      matches.push({
        type: rule.match_type,
        ruleId: rule.id,
        label: `Запрещённое выражение: ${rule.pattern}`
      });
    }
  }

  const uniqueMatches = matches.filter((match, index, items) =>
    items.findIndex(item => item.type === match.type && item.label === match.label) === index
  );

  if (uniqueMatches.length > 0) {
    return {
      blocked: true,
      aiReview: false,
      aiScore: 0,
      reason: uniqueMatches.map(item => item.label).join("; ").slice(0, 1000),
      matches: uniqueMatches.slice(0, 20)
    };
  }

  const aiModeration = await evaluateAIModeration(product, settings);
  const aiNeedsHold = Boolean(aiModeration.blocked || aiModeration.review);
  const aiReason = aiNeedsHold
    ? `${aiModeration.review ? "AI рекомендует проверку модератором" : "AI выявил высокий риск"}${aiModeration.reason ? `: ${aiModeration.reason}` : ""}`
    : "";
  return {
    blocked: aiNeedsHold,
    aiReview: Boolean(aiModeration.review),
    aiScore: Number(aiModeration.score) || 0,
    aiAvailable: Boolean(aiModeration.available),
    aiError: aiModeration.error || "",
    aiDecision: aiModeration.action || "allow",
    aiModel: aiModeration.model || "",
    aiResponseId: aiModeration.responseId || "",
    reason: aiReason.slice(0, 1000),
    matches: (aiModeration.matches || []).slice(0, 20)
  };
}

async function recordAdEvent(campaignId, eventType, clientKey, database = pool) {
  const safeCampaignId = normalizeText(campaignId, 64);
  const safeEventType = eventType === "click" ? "click" : "impression";
  const safeClientKey = normalizeText(clientKey, 120) || `anonymous-${safeEventType}`;

  const inserted = await database.query(
    `
      INSERT INTO advertising_events (id, campaign_id, event_type, client_key)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (campaign_id, client_key, event_type, event_date) DO NOTHING
      RETURNING id;
    `,
    [randomUUID(), safeCampaignId, safeEventType, safeClientKey]
  );

  if (inserted.rows.length > 0) {
    const counter = safeEventType === "click" ? "clicks" : "impressions";
    await database.query(
      `UPDATE advertising_campaigns SET ${counter} = COALESCE(${counter}, 0) + 1, updated_at = NOW() WHERE id = $1`,
      [safeCampaignId]
    );
  }

  return inserted.rows.length > 0;
}

async function fetchTelegramJson(method, searchParams) {
  const url = new URL(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`);

  for (const [key, value] of Object.entries(searchParams || {})) {
    url.searchParams.set(key, String(value));
  }

  const response = await fetch(url, {
    signal: AbortSignal.timeout(12_000),
    headers: { "User-Agent": `OssetianMarket/${APP_VERSION}` }
  });

  let data = null;
  try {
    data = await response.json();
  } catch {
    throw new Error(`Telegram Bot API method ${method} returned invalid JSON`);
  }

  if (!response.ok || !data?.ok) {
    throw new Error(data?.description || `Telegram Bot API method ${method} failed`);
  }

  return data.result;
}

async function resolveTelegramAvatarUrls(user, storedAvatar = "") {
  const candidates = [];
  const addCandidate = value => {
    const candidate = String(value || "").trim();
    if (/^https:\/\//i.test(candidate) && !candidates.includes(candidate)) {
      candidates.push(candidate);
    }
  };

  addCandidate(user?.photoUrl);
  addCandidate(storedAvatar);

  try {
    const profilePhotos = await fetchTelegramJson("getUserProfilePhotos", {
      user_id: user.id,
      limit: 1
    });

    const photos = profilePhotos?.photos || [];
    const sizes = Array.isArray(photos[0]) ? photos[0] : [];
    const biggestPhoto = sizes[sizes.length - 1];

    if (biggestPhoto?.file_id) {
      const file = await fetchTelegramJson("getFile", {
        file_id: biggestPhoto.file_id
      });

      if (file?.file_path) {
        addCandidate(`https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`);
      }
    }
  } catch (error) {
    console.warn("Telegram profile photo fallback failed:", error?.message || error);
  }

  return candidates;
}

async function fetchTelegramAvatarBuffer(avatarUrl) {
  const response = await fetch(avatarUrl, {
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
    headers: {
      "User-Agent": `OssetianMarket/${APP_VERSION}`,
      Accept: "image/*"
    }
  });

  if (!response.ok) {
    throw new Error(`Avatar HTTP ${response.status}`);
  }

  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  if (contentType && !contentType.startsWith("image/")) {
    throw new Error("Avatar response is not an image");
  }

  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > 5 * 1024 * 1024) {
    throw new Error("Avatar is too large");
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length || buffer.length > 5 * 1024 * 1024) {
    throw new Error("Invalid avatar size");
  }

  return {
    buffer,
    contentType: contentType.startsWith("image/") ? contentType : "image/jpeg"
  };
}

async function initDb(db = pool) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      owner_name TEXT,
      owner_username TEXT,
      name TEXT NOT NULL,
      price TEXT NOT NULL,
      category TEXT NOT NULL,
      description TEXT NOT NULL,
      image TEXT,
      images JSONB DEFAULT '[]'::jsonb,
      location TEXT DEFAULT 'Владикавказ',
      phone TEXT DEFAULT '',
      allow_messages BOOLEAN DEFAULT true,
      allow_calls BOOLEAN DEFAULT true,
      views INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await db.query(`
    ALTER TABLE products
    ADD COLUMN IF NOT EXISTS phone TEXT DEFAULT '';
  `);

  await db.query(`
    ALTER TABLE products
    ADD COLUMN IF NOT EXISTS allow_messages BOOLEAN DEFAULT true;
  `);

  await db.query(`
    ALTER TABLE products
    ADD COLUMN IF NOT EXISTS allow_calls BOOLEAN DEFAULT true;
  `);

  await db.query(`
    ALTER TABLE products
    ADD COLUMN IF NOT EXISTS images JSONB DEFAULT '[]'::jsonb;
  `);

  await db.query(`
    ALTER TABLE products
    ADD COLUMN IF NOT EXISTS thumbnail TEXT DEFAULT '';
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      telegram_id TEXT PRIMARY KEY,
      username TEXT,
      first_name TEXT,
      last_name TEXT,
      avatar TEXT,
      last_seen TIMESTAMPTZ DEFAULT NOW(),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await db.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS username TEXT;
  `);

  await db.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS first_name TEXT;
  `);

  await db.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS last_name TEXT;
  `);

  await db.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS avatar TEXT;
  `);

  await db.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS last_seen TIMESTAMPTZ DEFAULT NOW();
  `);

  await db.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
  `);
  await db.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS banned BOOLEAN DEFAULT FALSE;
  `);

  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_description TEXT DEFAULT '';`);
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS city TEXT DEFAULT '';`);
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT DEFAULT '';`);
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS contact_username TEXT DEFAULT '';`);
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();`);
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_normalized TEXT DEFAULT '';`);
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS listing_limit INTEGER DEFAULT ${DEFAULT_LISTING_LIMIT};`);
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_business BOOLEAN DEFAULT FALSE;`);
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS business_name TEXT DEFAULT '';`);
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS business_category TEXT DEFAULT '';`);
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS business_address TEXT DEFAULT '';`);
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS business_hours TEXT DEFAULT '';`);
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS business_website TEXT DEFAULT '';`);
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS business_verified BOOLEAN DEFAULT FALSE;`);
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS professional_subscription_started_at TIMESTAMPTZ;`);
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS professional_subscription_until TIMESTAMPTZ;`);
  // v1.19.3: профессиональный статус по-прежнему выдаётся только активной платной подпиской.
  // Индивидуальный лимит администратора хранится отдельно и не сбрасывается при запуске или оплате подписки.
  await db.query(`
    UPDATE users
    SET is_business = CASE WHEN professional_subscription_until > NOW() THEN TRUE ELSE FALSE END,
        business_verified = FALSE,
        listing_limit = CASE
          WHEN listing_limit IS NULL OR listing_limit < 1 THEN ${DEFAULT_LISTING_LIMIT}
          WHEN listing_limit > ${MAX_LISTING_LIMIT} THEN ${MAX_LISTING_LIMIT}
          ELSE listing_limit
        END
  `);
  await db.query(`
    UPDATE users
    SET phone_normalized = CASE
      WHEN LENGTH(REGEXP_REPLACE(COALESCE(phone, ''), '[^0-9]', '', 'g')) = 10
        THEN '7' || REGEXP_REPLACE(COALESCE(phone, ''), '[^0-9]', '', 'g')
      WHEN LENGTH(REGEXP_REPLACE(COALESCE(phone, ''), '[^0-9]', '', 'g')) = 11
        AND LEFT(REGEXP_REPLACE(COALESCE(phone, ''), '[^0-9]', '', 'g'), 1) = '8'
        THEN '7' || SUBSTRING(REGEXP_REPLACE(COALESCE(phone, ''), '[^0-9]', '', 'g') FROM 2)
      ELSE LEFT(REGEXP_REPLACE(COALESCE(phone, ''), '[^0-9]', '', 'g'), 15)
    END
    WHERE COALESCE(phone_normalized, '') = '' AND COALESCE(phone, '') <> '';
  `);
  // В старой БД одинаковый телефон мог быть сохранён у нескольких профилей.
  // Сохраняем привязку у самого раннего профиля, а дубликаты очищаем до создания индекса.
  await db.query(`
    WITH ranked AS (
      SELECT telegram_id,
             ROW_NUMBER() OVER (
               PARTITION BY phone_normalized
               ORDER BY COALESCE(created_at, updated_at, NOW()) ASC, telegram_id ASC
             ) AS duplicate_number
      FROM users
      WHERE COALESCE(phone_normalized, '') <> ''
    )
    UPDATE users u
    SET phone = '', phone_normalized = '', updated_at = NOW()
    FROM ranked r
    WHERE u.telegram_id = r.telegram_id AND r.duplicate_number > 1;
  `);
  await db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone_normalized_unique
    ON users (phone_normalized)
    WHERE phone_normalized <> '';
  `);

  try {
    await db.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm;`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_products_name_trgm ON products USING gin (LOWER(name) gin_trgm_ops);`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_products_description_trgm ON products USING gin (LOWER(description) gin_trgm_ops);`);
    searchCapabilities.pgTrgm = true;
  } catch (error) {
    searchCapabilities.pgTrgm = false;
    console.warn("pg_trgm is unavailable; typo-tolerant search will use exact/synonym/transliteration fallback:", error?.message || error);
  }

  await db.query(`
    ALTER TABLE products
    ADD COLUMN IF NOT EXISTS hidden BOOLEAN DEFAULT FALSE;
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS admin_logs (
      id TEXT PRIMARY KEY,
      admin_id TEXT NOT NULL,
      action TEXT NOT NULL,
      target TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // Ранние сборки создавали id как SERIAL. Приводим старую БД к одной схеме,
  // чтобы журнал действий не ломался после обновления приложения.
  await db.query(`
    ALTER TABLE admin_logs
    ALTER COLUMN id DROP DEFAULT;
  `);

  await db.query(`
    ALTER TABLE admin_logs
    ALTER COLUMN id TYPE TEXT USING id::text;
  `);

  await db.query(`
    ALTER TABLE admin_logs
    ADD COLUMN IF NOT EXISTS details TEXT DEFAULT '';
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS favorites (
      user_id TEXT NOT NULL,
      product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (user_id, product_id)
    );
  `);


  await db.query(`
    CREATE TABLE IF NOT EXISTS seller_reviews (
      id TEXT PRIMARY KEY,
      seller_id TEXT NOT NULL,
      reviewer_id TEXT NOT NULL,
      rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
      comment TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (seller_id, reviewer_id)
    );
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_seller_reviews_seller_created
    ON seller_reviews (seller_id, created_at DESC);
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS saved_searches (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      search_query TEXT DEFAULT '',
      category TEXT DEFAULT 'Все',
      filters JSONB DEFAULT '{}'::jsonb,
      search_key TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (user_id, search_key)
    );
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_saved_searches_user_updated
    ON saved_searches (user_id, updated_at DESC);
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS product_images (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      url TEXT NOT NULL,
      preview_url TEXT DEFAULT '',
      position INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // Existing installations may already have product_images from an older release.
  // CREATE TABLE IF NOT EXISTS does not add new columns to such a table, so every
  // media route must be backed by explicit idempotent migrations.
  await db.query(`
    ALTER TABLE product_images
    ADD COLUMN IF NOT EXISTS preview_url TEXT DEFAULT '';
  `);

  await db.query(`
    ALTER TABLE product_images
    ADD COLUMN IF NOT EXISTS position INTEGER DEFAULT 0;
  `);

  await db.query(`
    ALTER TABLE product_images
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS product_feature_requests (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      owner_id TEXT NOT NULL,
      color TEXT DEFAULT 'green',
      days INTEGER DEFAULT 7,
      price_amount NUMERIC(12,2) DEFAULT 0,
      status TEXT DEFAULT 'pending',
      approved_by TEXT DEFAULT '',
      approved_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_product_feature_requests_pending
    ON product_feature_requests (product_id, owner_id)
    WHERE status = 'pending';
  `);

  await db.query(`
    ALTER TABLE product_feature_requests
    ADD COLUMN IF NOT EXISTS reviewed_by TEXT DEFAULT '';
  `);
  await db.query(`
    ALTER TABLE product_feature_requests
    ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
  `);
  await db.query(`
    ALTER TABLE product_feature_requests
    ADD COLUMN IF NOT EXISTS admin_note TEXT DEFAULT '';
  `);
  await db.query(`ALTER TABLE product_feature_requests ADD COLUMN IF NOT EXISTS plan TEXT DEFAULT 'vip';`);
  await db.query(`ALTER TABLE product_feature_requests ALTER COLUMN color SET DEFAULT 'green';`);
  await db.query(`UPDATE product_feature_requests SET color = 'green' WHERE COALESCE(color, '') <> 'green';`);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_product_feature_requests_status_created
    ON product_feature_requests (status, created_at DESC);
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS product_view_events (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      owner_id TEXT NOT NULL,
      client_key TEXT NOT NULL,
      event_date DATE DEFAULT CURRENT_DATE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (product_id, client_key, event_date)
    );
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_product_view_events_owner_created
    ON product_view_events (owner_id, created_at DESC);
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS security_events (
      id TEXT PRIMARY KEY,
      user_id TEXT DEFAULT '',
      event_type TEXT NOT NULL,
      severity TEXT DEFAULT 'info',
      ip_hash TEXT DEFAULT '',
      user_agent_hash TEXT DEFAULT '',
      details JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_security_events_created
    ON security_events (created_at DESC);
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS payment_orders (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      purpose TEXT DEFAULT 'promotion',
      plan TEXT NOT NULL,
      amount NUMERIC(12,2) NOT NULL,
      currency TEXT DEFAULT 'RUB',
      status TEXT DEFAULT 'created',
      provider TEXT DEFAULT 'yookassa',
      provider_payment_id TEXT DEFAULT '',
      confirmation_url TEXT DEFAULT '',
      idempotence_key TEXT NOT NULL,
      metadata JSONB DEFAULT '{}'::jsonb,
      paid_at TIMESTAMPTZ,
      canceled_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_orders_provider_id ON payment_orders(provider_payment_id) WHERE provider_payment_id <> '';`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_payment_orders_user_created ON payment_orders(user_id, created_at DESC);`);
  await db.query(`ALTER TABLE payment_orders ALTER COLUMN product_id DROP NOT NULL;`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS monetization_settings (
      id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id = TRUE),
      automobile_paid BOOLEAN DEFAULT FALSE,
      vacancy_paid BOOLEAN DEFAULT FALSE,
      apartment_paid BOOLEAN DEFAULT FALSE,
      house_paid BOOLEAN DEFAULT FALSE,
      land_paid BOOLEAN DEFAULT FALSE,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      updated_by TEXT DEFAULT ''
    );
  `);
  await db.query(`INSERT INTO monetization_settings (id) VALUES (TRUE) ON CONFLICT (id) DO NOTHING;`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS legal_acceptances (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      document_key TEXT NOT NULL,
      document_version TEXT NOT NULL,
      metadata JSONB DEFAULT '{}'::jsonb,
      accepted_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id, document_key, document_version)
    );
  `);
  // Совместимость со старыми production-БД. Эти изменения вспомогательные и
  // не должны блокировать весь каталог, если старая таблица занята другим
  // процессом или конкретная миграция получает lock timeout.
  // Уникальный индекс здесь намеренно не создаём: recordLegalAcceptance()
  // использует UPDATE + conditional INSERT и не зависит от ON CONFLICT.
  const legalCompatibilityMigrations = [
    `ALTER TABLE legal_acceptances ADD COLUMN IF NOT EXISTS document_key TEXT;`,
    `ALTER TABLE legal_acceptances ADD COLUMN IF NOT EXISTS document_version TEXT DEFAULT '1.0';`,
    `ALTER TABLE legal_acceptances ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;`,
    `ALTER TABLE legal_acceptances ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ DEFAULT NOW();`,
    `UPDATE legal_acceptances SET document_version = '1.0' WHERE document_version IS NULL OR document_version = '';`,
    // Индекс полезен для новых/чистых БД, но его ошибка (например, из-за
    // legacy-дубликатов) теперь лишь логируется и не выключает весь API.
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_legal_acceptances_unique ON legal_acceptances(user_id, document_key, document_version);`,
    `CREATE INDEX IF NOT EXISTS idx_legal_acceptances_user ON legal_acceptances(user_id, accepted_at DESC);`
  ];

  for (const migrationSql of legalCompatibilityMigrations) {
    try {
      await db.query(migrationSql);
    } catch (error) {
      // Настоящий обрыв соединения должен по-прежнему запускать reconnect.
      if (isRetryableDatabaseError(error)) throw error;
      console.warn(
        `Optional legal_acceptances migration skipped [${getDatabaseErrorCode(error) || 'no-code'}]:`,
        error?.message || error
      );
    }
  }

  // v1.19.2: отдельная верификация бизнеса удалена; старые таблицы в существующей БД не используются.

  await db.query(`
    CREATE TABLE IF NOT EXISTS product_engagement_events (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      owner_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      client_key TEXT NOT NULL,
      event_date DATE DEFAULT CURRENT_DATE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(product_id, event_type, client_key, event_date)
    );
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_product_engagement_owner_created ON product_engagement_events(owner_id, created_at DESC);`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS ai_usage_events (
      id TEXT PRIMARY KEY,
      user_id TEXT DEFAULT '',
      kind TEXT NOT NULL,
      model TEXT NOT NULL,
      response_id TEXT DEFAULT '',
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      estimated_cost_usd NUMERIC(12,6) DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_ai_usage_created ON ai_usage_events(created_at DESC);`);

  await db.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS ai_risk_score INTEGER DEFAULT 0;`);
  await db.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS ai_decision TEXT DEFAULT '';`);
  await db.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS ai_reason TEXT DEFAULT '';`);
  await db.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS ai_model TEXT DEFAULT '';`);
  await db.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS ai_response_id TEXT DEFAULT '';`);
  await db.query(`ALTER TABLE moderation_events ADD COLUMN IF NOT EXISTS ai_score INTEGER DEFAULT 0;`);
  await db.query(`ALTER TABLE moderation_events ADD COLUMN IF NOT EXISTS ai_decision TEXT DEFAULT '';`);
  await db.query(`ALTER TABLE moderation_events ADD COLUMN IF NOT EXISTS ai_model TEXT DEFAULT '';`);
  await db.query(`ALTER TABLE moderation_events ADD COLUMN IF NOT EXISTS ai_response_id TEXT DEFAULT '';`);
  await db.query(`ALTER TABLE moderation_settings ADD COLUMN IF NOT EXISTS ai_enabled BOOLEAN DEFAULT TRUE;`);
  await db.query(`ALTER TABLE moderation_settings ADD COLUMN IF NOT EXISTS ai_review_threshold INTEGER DEFAULT 60;`);
  await db.query(`ALTER TABLE moderation_settings ADD COLUMN IF NOT EXISTS ai_block_threshold INTEGER DEFAULT 90;`);
  await db.query(`ALTER TABLE moderation_rules ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'general';`);
  await db.query(`ALTER TABLE moderation_rules ADD COLUMN IF NOT EXISTS action TEXT DEFAULT 'block';`);
  await db.query(`ALTER TABLE product_feature_requests ADD COLUMN IF NOT EXISTS payment_order_id TEXT DEFAULT '';`);
  await db.query(`ALTER TABLE product_feature_requests ADD COLUMN IF NOT EXISTS request_source TEXT DEFAULT 'manual';`);

  await db.query(`
    ALTER TABLE products
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
  `);

  await db.query(`
    ALTER TABLE products
    ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';
  `);

  await db.query(`
    ALTER TABLE products
    ADD COLUMN IF NOT EXISTS condition TEXT DEFAULT 'used';
  `);

  await db.query(`
    ALTER TABLE products
    ADD COLUMN IF NOT EXISTS negotiable BOOLEAN DEFAULT FALSE;
  `);

  await db.query(`
    ALTER TABLE products
    ADD COLUMN IF NOT EXISTS delivery BOOLEAN DEFAULT FALSE;
  `);

  await db.query(`
    ALTER TABLE products
    ADD COLUMN IF NOT EXISTS district TEXT DEFAULT '';
  `);

  await db.query(`
    ALTER TABLE products
    ADD COLUMN IF NOT EXISTS specifications JSONB DEFAULT '{}'::jsonb;
  `);

  await db.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS price_amount BIGINT;`);
  await db.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS previous_price TEXT DEFAULT '';`);
  await db.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS previous_price_amount BIGINT;`);
  await db.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS price_dropped_at TIMESTAMPTZ;`);
  await db.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS moderation_status TEXT DEFAULT 'approved';`);
  await db.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS moderation_reason TEXT DEFAULT '';`);
  await db.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS moderation_matches JSONB DEFAULT '[]'::jsonb;`);
  await db.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS auto_hidden BOOLEAN DEFAULT FALSE;`);
  await db.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS moderation_target_status TEXT DEFAULT 'active';`);
  await db.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;`);
  await db.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS sold_at TIMESTAMPTZ;`);
  await db.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS media_purged_at TIMESTAMPTZ;`);
  await db.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;`);
  await db.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;`);
  await db.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS featured_until TIMESTAMPTZ;`);
  await db.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS featured_color TEXT DEFAULT 'green';`);
  await db.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS featured_paid BOOLEAN DEFAULT FALSE;`);
  await db.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS promotion_plan TEXT DEFAULT '';`);
  await db.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS promotion_priority INTEGER DEFAULT 0;`);
  await db.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS duplicate_fingerprint TEXT DEFAULT '';`);
  await db.query(`ALTER TABLE products ALTER COLUMN featured_color SET DEFAULT 'green';`);
  await db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_products_owner_duplicate_fingerprint_unique
    ON products (owner_id, duplicate_fingerprint)
    WHERE duplicate_fingerprint <> ''
      AND COALESCE(status, 'active') IN ('active', 'draft', 'archived');
  `);
  await db.query(`UPDATE products SET featured_color = 'green' WHERE COALESCE(featured_color, '') <> 'green';`);
  await db.query(`
    UPDATE products
    SET published_at = COALESCE(published_at, created_at, NOW()),
        expires_at = COALESCE(expires_at, COALESCE(published_at, created_at, NOW()) + ($1::int * INTERVAL '1 day'))
    WHERE COALESCE(status, 'active') = 'active';
  `, [PRODUCT_ARCHIVE_DAYS]);

  await db.query(`
    UPDATE products
    SET price_amount = NULLIF(regexp_replace(price, '[^0-9]', '', 'g'), '')::BIGINT
    WHERE price_amount IS NULL;
  `);
  await db.query(`
    UPDATE products
    SET moderation_status = 'approved'
    WHERE moderation_status IS NULL OR moderation_status = '';
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS product_price_history (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      old_price TEXT NOT NULL,
      new_price TEXT NOT NULL,
      old_price_amount BIGINT NOT NULL,
      new_price_amount BIGINT NOT NULL,
      changed_by TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS moderation_settings (
      id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id = TRUE),
      enabled BOOLEAN DEFAULT TRUE,
      block_links BOOLEAN DEFAULT TRUE,
      block_contacts BOOLEAN DEFAULT TRUE,
      block_emails BOOLEAN DEFAULT TRUE,
      updated_by TEXT DEFAULT '',
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await db.query(`
    INSERT INTO moderation_settings (id)
    VALUES (TRUE)
    ON CONFLICT (id) DO NOTHING;
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS moderation_rules (
      id TEXT PRIMARY KEY,
      pattern TEXT NOT NULL,
      match_type TEXT DEFAULT 'word',
      is_active BOOLEAN DEFAULT TRUE,
      note TEXT DEFAULT '',
      created_by TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_moderation_rules_unique_pattern
    ON moderation_rules (LOWER(pattern), match_type);
  `);

  const moderationRuleCount = await db.query(
    `SELECT COUNT(*)::int AS count FROM moderation_rules`
  );
  if ((moderationRuleCount.rows[0]?.count || 0) === 0) {
    const defaultModerationRules = [
      ['default-heroin', 'героин', 'word'],
      ['default-cocaine', 'кокаин', 'word'],
      ['default-meth', 'метамфетамин', 'word'],
      ['default-fake-passport', 'поддельный паспорт', 'phrase'],
      ['default-drug-stash', 'закладка наркотиков', 'phrase'],
      ['default-ammunition', 'боевые патроны', 'phrase']
    ];
    for (const [id, pattern, matchType] of defaultModerationRules) {
      await db.query(
        `
          INSERT INTO moderation_rules (id, pattern, match_type, note, created_by)
          VALUES ($1, $2, $3, 'Базовое правило проекта', 'system')
          ON CONFLICT DO NOTHING;
        `,
        [id, pattern, matchType]
      );
    }
  }

  await db.query(`
    CREATE TABLE IF NOT EXISTS moderation_events (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      source TEXT DEFAULT 'publish',
      reason TEXT NOT NULL,
      matches JSONB DEFAULT '[]'::jsonb,
      status TEXT DEFAULT 'pending',
      reviewed_by TEXT DEFAULT '',
      admin_note TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS advertising_campaigns (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      image_url TEXT DEFAULT '',
      target_url TEXT DEFAULT '',
      linked_product_id TEXT DEFAULT '',
      button_text TEXT DEFAULT 'Подробнее',
      placement TEXT DEFAULT 'catalog_feed',
      status TEXT DEFAULT 'draft',
      starts_at TIMESTAMPTZ,
      ends_at TIMESTAMPTZ,
      priority INTEGER DEFAULT 0,
      insert_every INTEGER DEFAULT 6,
      max_impressions INTEGER DEFAULT 0,
      impressions INTEGER DEFAULT 0,
      clicks INTEGER DEFAULT 0,
      billing_model TEXT DEFAULT 'flat',
      rate_amount NUMERIC(12,2) DEFAULT 0,
      is_paid BOOLEAN DEFAULT FALSE,
      created_by TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await db.query(`ALTER TABLE advertising_campaigns ADD COLUMN IF NOT EXISTS billing_model TEXT DEFAULT 'flat';`);
  await db.query(`ALTER TABLE advertising_campaigns ADD COLUMN IF NOT EXISTS rate_amount NUMERIC(12,2) DEFAULT 0;`);
  await db.query(`ALTER TABLE advertising_campaigns ADD COLUMN IF NOT EXISTS is_paid BOOLEAN DEFAULT FALSE;`);
  await db.query(`
    UPDATE advertising_campaigns
    SET
      status = CASE
        WHEN LOWER(TRIM(COALESCE(status, ''))) IN ('draft', 'active', 'paused', 'ended')
          THEN LOWER(TRIM(status))
        ELSE 'draft'
      END,
      placement = CASE
        WHEN LOWER(TRIM(COALESCE(placement, ''))) IN ('catalog_top', 'catalog_feed', 'product_detail')
          THEN LOWER(TRIM(placement))
        ELSE 'catalog_feed'
      END;
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS advertising_events (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES advertising_campaigns(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      client_key TEXT NOT NULL,
      event_date DATE DEFAULT CURRENT_DATE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (campaign_id, client_key, event_type, event_date)
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      reporter_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      details TEXT DEFAULT '',
      status TEXT DEFAULT 'pending',
      admin_note TEXT DEFAULT '',
      reviewed_by TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_reports_status_created_at
    ON reports (status, created_at DESC);
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_reports_product_id
    ON reports (product_id);
  `);

  await db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_unique_pending
    ON reports (product_id, reporter_id)
    WHERE status = 'pending';
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_products_status_created_at
    ON products (status, created_at DESC);
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_products_owner_created_at
    ON products (owner_id, created_at DESC);
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_favorites_user_id
    ON favorites (user_id);
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_products_category_location
    ON products (category, location, created_at DESC);
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_products_price_filters
    ON products (price_amount, created_at DESC)
    WHERE status = 'active' AND hidden = FALSE AND moderation_status = 'approved';
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_products_owner_status_history
    ON products (owner_id, status, sold_at DESC, created_at DESC);
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_products_moderation_status
    ON products (moderation_status, created_at DESC);
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_price_history_product
    ON product_price_history (product_id, created_at DESC);
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_moderation_events_status
    ON moderation_events (status, created_at DESC);
  `);
  await db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_moderation_events_unique_pending
    ON moderation_events (product_id)
    WHERE status = 'pending';
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_ad_campaigns_delivery
    ON advertising_campaigns (status, placement, priority DESC, created_at DESC);
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_products_public_feed
    ON products (created_at DESC)
    WHERE status = 'active'
      AND hidden = FALSE
      AND moderation_status = 'approved';
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_product_images_product_position
    ON product_images (product_id, position);
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_products_expiry
    ON products (expires_at)
    WHERE status = 'active';
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_products_featured
    ON products (featured_until DESC)
    WHERE featured_paid = TRUE;
  `);

  console.log("Database initialized");
}


function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getDatabaseErrorCode(error) {
  let current = error;
  for (let depth = 0; current && depth < 5; depth += 1) {
    if (current.code) return String(current.code);
    current = current.cause;
  }
  return "";
}

function isRetryableDatabaseError(error) {
  const code = getDatabaseErrorCode(error);
  const retryableCodes = new Set([
    "ECONNRESET",
    "ECONNREFUSED",
    "ETIMEDOUT",
    "EPIPE",
    "ENETUNREACH",
    "EHOSTUNREACH",
    "08000",
    "08001",
    "08003",
    "08004",
    "08006",
    "08007",
    "08P01",
    "53300",
    "53400",
    "55P03",
    "57P01",
    "57P02",
    "57P03"
  ]);

  if (retryableCodes.has(code)) return true;

  const message = String(error?.message || "").toLowerCase();
  return [
    "connection terminated unexpectedly",
    "connection closed unexpectedly",
    "server closed the connection unexpectedly",
    "terminating connection",
    "timeout expired",
    "connection timeout",
    "read econnreset",
    "socket hang up"
  ].some(fragment => message.includes(fragment));
}

async function initializeDatabaseOnce() {
  let client;
  let failure = null;

  try {
    client = await pool.connect();
    await client.query("SELECT 1");

    // Миграции могут быть тяжелее обычных API-запросов на уже заполненной базе.
    // Для них используем отдельный таймаут, не меняя лимит обычных запросов.
    await client.query("SET statement_timeout TO 120000");
    await client.query("SET lock_timeout TO 20000");

    const migrationDb = {
      query(text, values) {
        if (typeof text === "string") {
          return client.query({ text, values, query_timeout: 120_000 });
        }

        return client.query({
          ...text,
          values: values ?? text.values,
          query_timeout: text.query_timeout ?? 120_000
        });
      }
    };

    await initDb(migrationDb);
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    if (client) {
      if (!failure) {
        try {
          await client.query("RESET statement_timeout");
          await client.query("RESET lock_timeout");
        } catch (resetError) {
          failure = resetError;
          console.warn("Could not reset PostgreSQL migration settings:", resetError?.message || resetError);
        }
      }

      // Передача ошибки в release() заставляет pg-pool уничтожить повреждённое
      // соединение вместо возвращения его обратно в пул.
      client.release(failure || undefined);
    }
  }
}

async function initDbWithRetry() {
  let lastError;

  for (let attempt = 1; attempt <= DB_INIT_MAX_ATTEMPTS; attempt += 1) {
    try {
      await initializeDatabaseOnce();
      if (attempt > 1) {
        console.log(`Database connection restored on attempt ${attempt}/${DB_INIT_MAX_ATTEMPTS}`);
      }
      return;
    } catch (error) {
      lastError = error;
      const retryable = isRetryableDatabaseError(error);
      const hasMoreAttempts = attempt < DB_INIT_MAX_ATTEMPTS;

      console.error(
        `Database init attempt ${attempt}/${DB_INIT_MAX_ATTEMPTS} failed` +
          `${getDatabaseErrorCode(error) ? ` [${getDatabaseErrorCode(error)}]` : ""}:`,
        error?.message || error
      );

      if (!retryable || !hasMoreAttempts) break;

      const delayMs = Math.min(
        DB_INIT_RETRY_MAX_MS,
        DB_INIT_RETRY_BASE_MS * (2 ** (attempt - 1))
      );
      const jitterMs = Math.floor(Math.random() * Math.min(1_000, Math.ceil(delayMs * 0.2)));
      const totalDelayMs = delayMs + jitterMs;
      console.log(`Retrying PostgreSQL initialization in ${totalDelayMs} ms...`);
      await wait(totalDelayMs);
    }
  }

  throw lastError;
}

app.get("/api/version", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({
    ok: true,
    version: APP_VERSION,
    catalogOrderFix: true,
    build: "trust-promotions-ai-store-analytics-security"
  });
});

app.get("/api/health", (req, res) => {
  // Liveness endpoint: Render must see an open HTTP port even while PostgreSQL
  // is waking up, restarting, or temporarily unavailable.
  res.setHeader("Cache-Control", "no-store");
  res.json({
    ok: true,
    server: "online",
    database: databaseState.ready ? "ready" : "connecting",
    version: APP_VERSION
  });
});

app.get("/api/ready", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const status = databaseState.ready ? 200 : 503;
  res.status(status).json({
    ok: databaseState.ready,
    server: "online",
    database: databaseState.ready ? "ready" : "unavailable",
    version: APP_VERSION,
    requestId: req.requestId
  });
});

app.get("/api/config", async (req, res) => {
  let paidListingEnabled = { automobile: false, vacancy: false, apartment: false, house: false, land: false };
  if (databaseState.ready) {
    try {
      paidListingEnabled = await getMonetizationSettings(pool);
    } catch (error) {
      console.warn("Monetization config unavailable:", error?.message || error);
    }
  }
  res.json({
    ok: true,
    version: APP_VERSION,
    supportUsername: SUPPORT_USERNAME,
    botUsername: BOT_USERNAME,
    productArchiveDays: PRODUCT_ARCHIVE_DAYS,
    featureHighlightPriceRub: FEATURE_HIGHLIGHT_PRICE_RUB,
    featureHighlightDays: FEATURE_HIGHLIGHT_DAYS,
    defaultListingLimit: DEFAULT_LISTING_LIMIT,
    professionalListingLimit: null,
    professionalSubscriptionPriceRub: PROFESSIONAL_SUBSCRIPTION_PRICE_RUB,
    professionalSubscriptionDays: PROFESSIONAL_SUBSCRIPTION_DAYS,
    aiListingAssistantEnabled: AI_LISTING_ASSISTANT_ENABLED,
    aiModerationEnabled: AI_MODERATION_ENABLED,
    aiProviderConfigured: Boolean(OPENAI_API_KEY),
    aiDailyBudgetUsd: AI_DAILY_BUDGET_USD,
    paymentEnabled: isYooKassaConfigured(),
    paymentProvider: isYooKassaConfigured() ? "yookassa" : "manual",
    promotionPlans: Object.values(PROMOTION_PLANS),
    paidListingEnabled,
    paidListingPrices: PAID_LISTING_PRICES
  });
});

app.use("/api", (req, res, next) => {
  if (databaseState.ready) return next();

  res.setHeader("Retry-After", "15");
  return res.status(503).json({
    ok: false,
    error: "База данных временно недоступна. Сервер продолжает переподключение — повторите через несколько секунд",
    code: "DATABASE_UNAVAILABLE"
  });
});


app.get("/api/products/:id/share-photo.jpg", async (req, res) => {
  try {
    const productId = normalizeText(req.params.id, 64);
    if (!productId) return res.status(400).end();

    const row = await getPublicProductShareRow(productId);
    if (!row) return res.status(404).end();

    const source = getShareRowImageSource(row);
    if (!source) return res.status(404).end();

    const jpeg = await createShareJpeg(source);
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Content-Length", String(jpeg.length));
    res.setHeader("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.send(jpeg);
  } catch (error) {
    console.error("Product share photo error:", error);
    return res.status(500).end();
  }
});

app.post(
  "/api/products/:id/share-message",
  requireTelegramAuth,
  async (req, res) => {
    try {
      const productId = normalizeText(req.params.id, 64);
      if (!productId) {
        return res.status(400).json({ ok: false, error: "Некорректный ID объявления" });
      }

      const row = await getPublicProductShareRow(productId);
      if (!row) {
        return res.status(404).json({ ok: false, error: "Объявление не найдено" });
      }

      const userId = Number(req.telegramUser?.id);
      if (!Number.isSafeInteger(userId) || userId <= 0) {
        return res.status(400).json({ ok: false, error: "Некорректный Telegram ID" });
      }

      const shareVersion = new Date(row.updated_at || row.created_at || Date.now()).getTime();
      const shareCacheKey = `${userId}:${productId}:${shareVersion}`;
      const cachedPrepared = preparedShareMessageCache.get(shareCacheKey);
      if (cachedPrepared && (!cachedPrepared.expirationDate || cachedPrepared.expirationDate * 1000 > Date.now() + 30_000)) {
        return res.json({ ok: true, ...cachedPrepared, cached: true });
      }

      const origin = getPublicOrigin(req);
      const telegramLink = buildProductTelegramLink(productId);
      if (!origin || !telegramLink) {
        return res.status(500).json({
          ok: false,
          error: "Не настроена публичная ссылка приложения или username бота"
        });
      }

      const title = normalizeText(row.name, 120) || "Объявление";
      const price = normalizeText(row.price, 60) || "Цена не указана";
      const previousPrice = normalizeText(row.previous_price, 60);
      const hasDiscount =
        parsePriceAmount(previousPrice) > parsePriceAmount(price) &&
        parsePriceAmount(price) > 0;
      const priceLine = hasDiscount ? `Скидка: ${previousPrice} → ${price}` : price;
      const location = normalizeText(row.location, 80);
      const captionLines = [title, priceLine];
      if (location) captionLines.push(location);
      captionLines.push("", telegramLink);
      const caption = captionLines.join("\n").slice(0, 1024);
      const replyMarkup = {
        inline_keyboard: [[{
          text: "Открыть объявление",
          url: telegramLink
        }]]
      };
      const source = getShareRowImageSource(row);
      const version = shareVersion;
      const photoUrl = `${origin}/api/products/${encodeURIComponent(productId)}/share-photo.jpg?v=${version}`;

      const result = source && /^https:\/\//i.test(photoUrl)
        ? {
            type: "photo",
            id: `product_${productId}`.slice(0, 64),
            photo_url: photoUrl,
            thumbnail_url: photoUrl,
            title,
            description: [priceLine, location].filter(Boolean).join(" • ").slice(0, 256),
            caption,
            reply_markup: replyMarkup
          }
        : {
            type: "article",
            id: `product_${productId}`.slice(0, 64),
            title,
            description: [priceLine, location].filter(Boolean).join(" • ").slice(0, 256),
            input_message_content: {
              message_text: caption
            },
            reply_markup: replyMarkup
          };

      const prepared = await callTelegramBotApi("savePreparedInlineMessage", {
        user_id: userId,
        result,
        allow_user_chats: true,
        allow_bot_chats: false,
        allow_group_chats: true,
        allow_channel_chats: true
      });

      const responsePayload = {
        preparedMessageId: prepared.id,
        expirationDate: prepared.expiration_date || null,
        includesPhoto: result.type === "photo"
      };
      preparedShareMessageCache.set(shareCacheKey, responsePayload);
      if (preparedShareMessageCache.size > 500) {
        const oldestKey = preparedShareMessageCache.keys().next().value;
        if (oldestKey) preparedShareMessageCache.delete(oldestKey);
      }
      return res.json({ ok: true, ...responsePayload, cached: false });
    } catch (error) {
      console.error("Prepare product share message error:", error);
      return res.status(502).json({
        ok: false,
        error: "Не удалось подготовить объявление для отправки в Telegram"
      });
    }
  }
);

app.get("/share/product/:id", async (req, res) => {
  try {
    const productId = normalizeText(req.params.id, 64);
    const row = productId ? await getPublicProductShareRow(productId) : null;

    if (!row) {
      return res.status(404).type("html").send("<!doctype html><meta charset=\"utf-8\"><title>Объявление не найдено</title><p>Объявление не найдено.</p>");
    }

    const origin = getPublicOrigin(req);
    const telegramLink = buildProductTelegramLink(productId) || `${origin}/?product=${encodeURIComponent(productId)}`;
    const telegramScheme = BOT_USERNAME
      ? `tg://resolve?domain=${encodeURIComponent(BOT_USERNAME)}&startapp=${encodeURIComponent(`product_${productId}`)}`
      : telegramLink;
    const version = new Date(row.updated_at || row.created_at || Date.now()).getTime();
    const imageSource = getShareRowImageSource(row);
    const imageUrl = imageSource
      ? `${origin}/api/products/${encodeURIComponent(productId)}/share-photo.jpg?v=${version}`
      : "";
    const shareUrl = `${origin}/share/product/${encodeURIComponent(productId)}?v=${version}`;
    const title = normalizeText(row.name, 120) || "Объявление";
    const price = normalizeText(row.price, 60) || "Цена не указана";
    const previousPrice = normalizeText(row.previous_price, 60);
    const hasDiscount =
      parsePriceAmount(previousPrice) > parsePriceAmount(price) &&
      parsePriceAmount(price) > 0;
    const priceLine = hasDiscount ? `Скидка: ${previousPrice} → ${price}` : price;
    const description = normalizeText(
      `${priceLine}${row.location ? ` • ${row.location}` : ""}${row.description ? ` — ${String(row.description).replace(/\s+/g, " ")}` : ""}`,
      280
    );
    const imageMeta = imageUrl ? `
      <meta property="og:image" content="${escapeHtml(imageUrl)}">
      <meta property="og:image:secure_url" content="${escapeHtml(imageUrl)}">
      <meta property="og:image:type" content="image/jpeg">
      <meta property="og:image:alt" content="${escapeHtml(title)}">
      <meta name="twitter:image" content="${escapeHtml(imageUrl)}">` : "";

    res.setHeader("Cache-Control", "public, max-age=300, stale-while-revalidate=3600");
    res.type("html").send(`<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(title)} — Алания Маркет</title>
  <meta name="description" content="${escapeHtml(description)}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Алания Маркет">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${escapeHtml(shareUrl)}">${imageMeta}
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(title)}">
  <meta name="twitter:description" content="${escapeHtml(description)}">
  <link rel="canonical" href="${escapeHtml(shareUrl)}">
  <style>
    body{margin:0;min-height:100vh;display:grid;place-items:center;background:#17181c;color:#f4f4f5;font-family:Arial,sans-serif;padding:24px;box-sizing:border-box}
    main{max-width:480px;text-align:center;background:#23252a;border-radius:18px;padding:24px;box-shadow:0 16px 45px rgba(0,0,0,.3)}
    img{width:100%;max-height:340px;object-fit:cover;border-radius:14px;margin-bottom:18px}
    h1{font-size:22px;margin:0 0 8px}p{color:#c8cad1;margin:0 0 18px;line-height:1.45}
    a{display:inline-block;background:#2aabee;color:#fff;text-decoration:none;padding:12px 18px;border-radius:12px;font-weight:700}
  </style>
</head>
<body>
  <main>
    ${imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(title)}">` : ""}
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(priceLine)}</p>
    <a href="${escapeHtml(telegramLink)}">Открыть в Telegram</a>
  </main>
  <script>
    const telegramScheme = ${JSON.stringify(telegramScheme)};
    const telegramLink = ${JSON.stringify(telegramLink)};
    window.location.replace(telegramScheme);
    window.setTimeout(() => window.location.replace(telegramLink), 850);
  </script>
</body>
</html>`);
  } catch (error) {
    console.error("Product share page error:", error);
    return res.status(500).type("html").send("<!doctype html><meta charset=\"utf-8\"><title>Ошибка</title><p>Не удалось открыть объявление.</p>");
  }
});

// Сохраняем или обновляем профиль после успешной Telegram-авторизации.
async function syncTelegramUser(req, res, next) {
  try {
    const user = req.telegramUser;

    const syncResult = await pool.query(
      `
        INSERT INTO users (
          telegram_id,
          first_name,
          last_name,
          username,
          avatar,
          last_seen
        )
        VALUES ($1, $2, $3, $4, $5, NOW())
        ON CONFLICT (telegram_id)
        DO UPDATE SET
          first_name = EXCLUDED.first_name,
          last_name = EXCLUDED.last_name,
          username = EXCLUDED.username,
          avatar = CASE
            WHEN EXCLUDED.avatar <> '' THEN EXCLUDED.avatar
            ELSE users.avatar
          END,
          last_seen = NOW()
        RETURNING banned;
      `,
      [
        String(user.id),
        user.firstName || "",
        user.lastName || "",
        user.username || "",
        user.photoUrl || ""
      ]
    );

    const isBanned = Boolean(syncResult.rows[0]?.banned);
    const isAdmin = ADMIN_IDS.includes(String(user.id));

    if (isBanned && !isAdmin) {
      return res.status(403).json({
        ok: false,
        code: "USER_BANNED",
        error: "Ваш аккаунт заблокирован администратором"
      });
    }
  } catch (error) {
    console.error("User profile sync error:", error);
    return res.status(500).json({
      ok: false,
      error: "Не удалось обновить профиль пользователя"
    });
  }

  next();
}

app.get("/api/me", requireTelegramAuth, syncTelegramUser, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT telegram_id, username, first_name, last_name, avatar, profile_description,
              city, phone, contact_username, listing_limit, is_business, business_name, business_category,
              business_address, business_hours, business_website, business_verified,
              professional_subscription_started_at, professional_subscription_until,
              last_seen, created_at, updated_at
       FROM users WHERE telegram_id = $1 LIMIT 1`,
      [String(req.telegramUser.id)]
    );

    const profile = result.rows[0] ? mapPublicUser(result.rows[0]) : {};
    const listingQuota = await getListingQuota(pool, req.telegramUser.id);
    res.json({
      ok: true,
      listingQuota,
      user: {
        ...req.telegramUser,
        ...profile,
        photoUrl: profile.photoUrl || req.telegramUser.photoUrl || ""
      }
    });
  } catch (error) {
    console.error("Get own profile error:", error);
    res.status(500).json({ ok: false, error: "Не удалось получить профиль" });
  }
});

app.get("/api/me/listing-quota", requireTelegramAuth, syncTelegramUser, async (req, res) => {
  try {
    const listingQuota = await getListingQuota(pool, req.telegramUser.id);
    res.setHeader("Cache-Control", "no-store");
    res.json({ ok: true, listingQuota });
  } catch (error) {
    console.error("Get listing quota error:", error);
    res.status(500).json({ ok: false, error: "Не удалось проверить лимит объявлений" });
  }
});

app.post("/api/ai/listing-suggestion", requireTelegramAuth, syncTelegramUser, aiRateLimiter, async (req, res) => {
  try {
    const image = normalizeText(req.body?.image, 4_500_000);
    const context = req.body?.context && typeof req.body.context === "object" ? req.body.context : {};
    const suggestion = await suggestListingFromImage({ image, context, userId: req.telegramUser.id });
    res.setHeader("Cache-Control", "no-store");
    res.json({ ok: true, suggestion });
  } catch (error) {
    console.error("AI listing suggestion error:", error);
    res.status(500).json({ ok: false, error: "Не удалось подготовить AI-подсказку" });
  }
});

app.patch("/api/me/profile", requireTelegramAuth, syncTelegramUser, async (req, res) => {
  try {
    const description = normalizeText(req.body?.description, 600);
    const city = normalizeText(req.body?.city, 80);
    const phone = normalizeText(req.body?.phone, 30);
    const phoneKey = normalizePhoneKey(phone);
    const contactUsername = normalizeText(req.body?.contactUsername, 40).replace(/^@/, "");
    const businessName = normalizeText(req.body?.businessName, 120);
    const businessCategory = normalizeText(req.body?.businessCategory, 120);
    const businessAddress = normalizeText(req.body?.businessAddress, 180);
    const businessHours = normalizeText(req.body?.businessHours, 180);

    if (contactUsername && !/^[A-Za-z0-9_]{5,32}$/.test(contactUsername)) {
      return res.status(400).json({
        ok: false,
        error: "Telegram username должен содержать 5–32 латинских символа, цифры или подчёркивания"
      });
    }

    if (phone && !/^[+0-9()\s.-]{5,30}$/.test(phone)) {
      return res.status(400).json({ ok: false, error: "Проверьте формат телефона" });
    }
    if (phone && phoneKey.length < 10) {
      return res.status(400).json({ ok: false, code: "INVALID_PHONE", error: "Проверьте формат телефона" });
    }

    const result = await pool.query(
      `UPDATE users
       SET profile_description = $2, city = $3, phone = $4, phone_normalized = $5,
           contact_username = $6, business_name = $7,
           business_category = $8, business_address = $9, business_hours = $10,
           business_website = '', updated_at = NOW()
       WHERE telegram_id = $1
       RETURNING telegram_id, username, first_name, last_name, avatar, profile_description,
                 city, phone, contact_username, listing_limit, is_business, business_name, business_category,
                 business_address, business_hours, business_website, business_verified,
                 professional_subscription_started_at, professional_subscription_until,
                 last_seen, created_at, updated_at`,
      [String(req.telegramUser.id), description, city, phone, phoneKey, contactUsername,
       businessName, businessCategory, businessAddress, businessHours]
    );

    const preferredUsername = contactUsername || result.rows[0]?.username || req.telegramUser.username || "";
    await pool.query(
      `UPDATE products SET owner_username = $2, phone = $3, updated_at = NOW()
       WHERE owner_id = $1 AND COALESCE(status, 'active') NOT IN ('deleted', 'sold')`,
      [String(req.telegramUser.id), preferredUsername, phone]
    );

    const listingQuota = await getListingQuota(pool, req.telegramUser.id);
    res.json({ ok: true, user: mapPublicUser(result.rows[0]), listingQuota });
  } catch (error) {
    console.error("Update own profile error:", error);
    if (error?.code === "23505" && String(error?.constraint || "").includes("phone_normalized")) {
      return res.status(409).json({
        ok: false,
        code: "PHONE_ALREADY_USED",
        error: "Этот номер уже привязан к другому профилю"
      });
    }
    res.status(500).json({ ok: false, error: "Не удалось сохранить профиль" });
  }
});



async function resolveLegalAcceptanceStorage(database) {
  const readColumns = async (tableName) => {
    const result = await database.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = ANY (current_schemas(false))
        AND table_name = $1
    `, [tableName]);
    return new Set(result.rows.map(row => String(row.column_name || "")));
  };

  let columns = await readColumns("legal_acceptances");
  const requiredColumns = ["user_id", "document_key", "document_version", "metadata", "accepted_at"];

  if (!requiredColumns.every(column => columns.has(column))) {
    const repairMigrations = [
      `ALTER TABLE legal_acceptances ADD COLUMN IF NOT EXISTS document_key TEXT;`,
      `ALTER TABLE legal_acceptances ADD COLUMN IF NOT EXISTS document_version TEXT DEFAULT '1.0';`,
      `ALTER TABLE legal_acceptances ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;`,
      `ALTER TABLE legal_acceptances ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ DEFAULT NOW();`
    ];
    for (const migrationSql of repairMigrations) {
      try {
        await database.query(migrationSql);
      } catch (error) {
        if (isRetryableDatabaseError(error)) throw error;
        console.warn(
          `Runtime legal_acceptances repair skipped [${getDatabaseErrorCode(error) || "no-code"}]:`,
          error?.message || error
        );
      }
    }
    columns = await readColumns("legal_acceptances");
  }

  if (requiredColumns.every(column => columns.has(column))) {
    return { tableName: "legal_acceptances", columns };
  }

  // Последний безопасный fallback для production-БД со старой несовместимой
  // таблицей legal_acceptances. Новая таблица не изменяет legacy-данные и
  // позволяет записать согласие, не блокируя публикацию объявления.
  await database.query(`
    CREATE TABLE IF NOT EXISTS legal_acceptances_v2 (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      document_key TEXT NOT NULL,
      document_version TEXT NOT NULL DEFAULT '1.0',
      metadata JSONB DEFAULT '{}'::jsonb,
      accepted_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  const fallbackColumns = await readColumns("legal_acceptances_v2");
  return { tableName: "legal_acceptances_v2", columns: fallbackColumns };
}

async function recordLegalAcceptance(database, userId, documentKey, metadata = {}) {
  const normalizedUserId = String(userId);
  const normalizedDocumentKey = String(documentKey);
  const metadataJson = JSON.stringify(metadata || {});
  const { tableName, columns } = await resolveLegalAcceptanceStorage(database);

  if (!columns.has("user_id") || !columns.has("document_key")) {
    throw Object.assign(new Error("Legal acceptance storage is incompatible"), { code: "LEGAL_SCHEMA_INCOMPATIBLE" });
  }

  const versionColumn = columns.has("document_version");
  const metadataColumn = columns.has("metadata");
  const acceptedAtColumn = columns.has("accepted_at");

  const whereParts = ["user_id = $1", "document_key = $2"];
  const whereValues = [normalizedUserId, normalizedDocumentKey];
  if (versionColumn) {
    whereValues.push(LEGAL_DOCUMENT_VERSION);
    whereParts.push(`document_version = $${whereValues.length}`);
  }

  const existing = await database.query(
    `SELECT 1 FROM ${tableName} WHERE ${whereParts.join(" AND ")} LIMIT 1`,
    whereValues
  );

  if (existing.rows.length > 0) {
    const setParts = [];
    const updateValues = [...whereValues];
    if (metadataColumn) {
      updateValues.push(metadataJson);
      setParts.push(`metadata = $${updateValues.length}::jsonb`);
    }
    if (acceptedAtColumn) setParts.push("accepted_at = NOW()");
    if (setParts.length > 0) {
      await database.query(
        `UPDATE ${tableName} SET ${setParts.join(", ")} WHERE ${whereParts.join(" AND ")}`,
        updateValues
      );
    }
    return;
  }

  const insertColumns = [];
  const insertValues = [];
  const insertParams = [];
  const pushInsert = (column, value, cast = "") => {
    if (!columns.has(column)) return;
    insertColumns.push(column);
    insertValues.push(value);
    insertParams.push(`$${insertValues.length}${cast}`);
  };

  pushInsert("id", randomUUID());
  pushInsert("user_id", normalizedUserId);
  pushInsert("document_key", normalizedDocumentKey);
  pushInsert("document_version", LEGAL_DOCUMENT_VERSION);
  pushInsert("metadata", metadataJson, "::jsonb");

  await database.query(
    `INSERT INTO ${tableName} (${insertColumns.join(", ")}) VALUES (${insertParams.join(", ")})`,
    insertValues
  );
}

async function recordCoreLegalAcceptancesFromRequest(database, userId, body = {}) {
  if (body.coreTermsAccepted === true) await recordLegalAcceptance(database, userId, "user_agreement");
  if (body.corePdConsentAccepted === true) await recordLegalAcceptance(database, userId, "personal_data_processing");
}

async function recordListingLegalAcceptances(database, userId, body = {}) {
  if (body.publicPhoneConsent === true) await recordLegalAcceptance(database, userId, "public_phone", { scope: "listing" });
  if (body.publicTelegramConsent === true) await recordLegalAcceptance(database, userId, "public_telegram", { scope: "listing" });
}

app.post("/api/legal/core-acceptances", requireTelegramAuth, syncTelegramUser, async (req, res) => {
  if (req.body?.coreTermsAccepted !== true || req.body?.corePdConsentAccepted !== true) {
    return res.status(400).json({ ok: false, error: "Подтвердите пользовательское соглашение и согласие на обработку персональных данных отдельно" });
  }
  await recordCoreLegalAcceptancesFromRequest(pool, req.telegramUser.id, req.body);
  res.json({ ok: true, version: LEGAL_DOCUMENT_VERSION });
});

app.all("/api/me/business-verification", requireTelegramAuth, syncTelegramUser, (req, res) => {
  res.status(410).json({ ok: false, code: "BUSINESS_VERIFICATION_REMOVED", error: "Верификация бизнеса больше не используется" });
});

app.get("/api/payments", requireTelegramAuth, syncTelegramUser, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, product_id, purpose, plan, amount, currency, status, provider, provider_payment_id, paid_at, canceled_at, created_at, updated_at
      FROM payment_orders WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50
    `, [String(req.telegramUser.id)]);
    res.setHeader("Cache-Control", "no-store");
    res.json({ ok: true, payments: result.rows });
  } catch (error) {
    res.status(500).json({ ok: false, error: "Не удалось загрузить историю платежей" });
  }
});

app.get("/api/me/professional-subscription", requireTelegramAuth, syncTelegramUser, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT professional_subscription_started_at, professional_subscription_until
      FROM users WHERE telegram_id=$1 LIMIT 1
    `, [String(req.telegramUser.id)]);
    const row = result.rows[0] || {};
    const active = isProfessionalSubscriptionActive(row);
    res.setHeader("Cache-Control", "no-store");
    res.json({
      ok: true,
      subscription: {
        active,
        startedAt: row.professional_subscription_started_at || null,
        until: row.professional_subscription_until || null,
        priceRub: PROFESSIONAL_SUBSCRIPTION_PRICE_RUB,
        days: PROFESSIONAL_SUBSCRIPTION_DAYS,
        unlimitedListings: true
      }
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: "Не удалось получить статус подписки" });
  }
});

app.post("/api/payments/professional-subscription", requireTelegramAuth, syncTelegramUser, paymentRateLimiter, async (req, res) => {
  const userId = String(req.telegramUser.id);
  try {
    const checkout = await createCheckoutPayment({
      userId,
      purpose: "professional_subscription",
      plan: "professional_monthly",
      amount: PROFESSIONAL_SUBSCRIPTION_PRICE_RUB,
      description: `Подписка «Профессиональный продавец» на ${PROFESSIONAL_SUBSCRIPTION_DAYS} дней`,
      metadata: { subscriptionDays: PROFESSIONAL_SUBSCRIPTION_DAYS },
      lockKey: `professional_subscription:${userId}`
    });
    res.status(checkout.reused ? 200 : 201).json({ ok: true, ...checkout });
  } catch (error) {
    console.error("Create professional subscription payment error:", error);
    const code = error?.code === "PAYMENTS_NOT_CONFIGURED" ? "PAYMENTS_NOT_CONFIGURED" : "PAYMENT_PROVIDER_ERROR";
    res.status(code === "PAYMENTS_NOT_CONFIGURED" ? 503 : 502).json({ ok: false, code, error: code === "PAYMENTS_NOT_CONFIGURED" ? "Онлайн-оплата пока не настроена" : "Не удалось создать платёж. Попробуйте позже." });
  }
});

app.post("/api/payments/listing", requireTelegramAuth, syncTelegramUser, paymentRateLimiter, async (req, res) => {
  const userId = String(req.telegramUser.id);
  const productId = normalizeText(req.body?.productId, 64);
  if (!productId) return res.status(400).json({ ok: false, error: "Не указано объявление" });
  try {
    const productResult = await pool.query(`
      SELECT id, owner_id, name, status, hidden, moderation_status, category, specifications
      FROM products WHERE id=$1 AND owner_id=$2 AND COALESCE(status,'active') <> 'deleted' LIMIT 1
    `, [productId, userId]);
    const product = productResult.rows[0];
    if (!product) return res.status(404).json({ ok: false, error: "Объявление не найдено" });
    if (product.hidden || (product.moderation_status || "approved") !== "approved") {
      return res.status(409).json({ ok: false, code: "LISTING_NOT_APPROVED", error: "Сначала дождитесь одобрения объявления модерацией" });
    }
    const requirement = await getListingFeeRequirement(pool, product.category, product.specifications || {});
    if (!requirement.required) {
      return res.status(409).json({ ok: false, code: "LISTING_PAYMENT_NOT_REQUIRED", error: "Для этой категории платная публикация сейчас выключена" });
    }
    const alreadyPaid = await hasSuccessfulListingPayment(pool, userId, productId, requirement.feeType);
    if (alreadyPaid) {
      await pool.query(`UPDATE products SET status='active', published_at=COALESCE(published_at,NOW()), expires_at=NOW()+($2::int*INTERVAL '1 day'), updated_at=NOW() WHERE id=$1`, [productId, PRODUCT_ARCHIVE_DAYS]);
      return res.json({ ok: true, alreadyPaid: true, productId, status: "succeeded" });
    }
    const checkout = await createCheckoutPayment({
      userId,
      productId,
      purpose: "listing_fee",
      plan: requirement.feeType,
      amount: requirement.priceRub,
      description: `Публикация объявления — ${normalizeText(product.name, 80)}`,
      metadata: { category: product.category, feeType: requirement.feeType },
      lockKey: `listing_fee:${userId}:${productId}:${requirement.feeType}`
    });
    res.status(checkout.reused ? 200 : 201).json({ ok: true, ...checkout, feeType: requirement.feeType });
  } catch (error) {
    console.error("Create listing payment error:", error);
    const code = error?.code === "PAYMENTS_NOT_CONFIGURED" ? "PAYMENTS_NOT_CONFIGURED" : "PAYMENT_PROVIDER_ERROR";
    res.status(code === "PAYMENTS_NOT_CONFIGURED" ? 503 : 502).json({ ok: false, code, error: code === "PAYMENTS_NOT_CONFIGURED" ? "Онлайн-оплата пока не настроена" : "Не удалось создать платёж. Попробуйте позже." });
  }
});

app.post("/api/payments/promotion", requireTelegramAuth, syncTelegramUser, paymentRateLimiter, async (req, res) => {
  const userId = String(req.telegramUser.id);
  const productId = normalizeText(req.body?.productId, 64);
  const planId = normalizeText(req.body?.plan, 20).toLowerCase();
  const plan = PROMOTION_PLANS[planId];
  if (!isYooKassaConfigured()) {
    return res.status(503).json({ ok: false, code: "PAYMENTS_NOT_CONFIGURED", error: "Онлайн-оплата пока не настроена. Используйте заявку на продвижение." });
  }
  if (!productId || !plan) return res.status(400).json({ ok: false, error: "Выберите объявление и тариф" });
  try {
    const productResult = await pool.query(`
      SELECT id, owner_id, name, status, hidden, moderation_status
      FROM products WHERE id=$1 AND owner_id=$2 AND COALESCE(status,'active') <> 'deleted'
    `, [productId, userId]);
    const product = productResult.rows[0];
    if (!product) return res.status(404).json({ ok: false, error: "Объявление не найдено" });
    if (product.status !== "active" || product.hidden || (product.moderation_status || "approved") !== "approved") {
      return res.status(409).json({ ok: false, error: "Продвигать можно только активное и одобренное объявление" });
    }
    const amount = Number(plan.priceRub) || 0;
    const orderClient = await pool.connect();
    let orderId = "";
    let idempotenceKey = "";
    try {
      await orderClient.query("BEGIN");
      await orderClient.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`promotion:${userId}:${productId}:${plan.id}`]);
      await orderClient.query(`
        UPDATE payment_orders SET status='failed', updated_at=NOW()
        WHERE user_id=$1 AND product_id=$2 AND plan=$3 AND status='creating'
          AND created_at < NOW() - INTERVAL '15 minutes'
      `, [userId, productId, plan.id]);
      const existingResult = await orderClient.query(`
        SELECT id, status, confirmation_url, amount, currency
        FROM payment_orders
        WHERE user_id=$1 AND product_id=$2 AND plan=$3
          AND purpose='promotion' AND status IN ('creating','pending','waiting_for_capture')
        ORDER BY created_at DESC LIMIT 1
      `, [userId, productId, plan.id]);
      if (existingResult.rows.length) {
        await orderClient.query("COMMIT");
        const existing = existingResult.rows[0];
        return res.status(existing.confirmation_url ? 200 : 202).json({
          ok: true,
          reused: true,
          orderId: existing.id,
          status: existing.status,
          confirmationUrl: existing.confirmation_url || "",
          amount: Number(existing.amount) || amount,
          currency: existing.currency || "RUB"
        });
      }
      orderId = randomUUID();
      idempotenceKey = randomUUID();
      await orderClient.query(`
        INSERT INTO payment_orders (id,user_id,product_id,purpose,plan,amount,currency,status,provider,idempotence_key,metadata)
        VALUES ($1,$2,$3,'promotion',$4,$5,'RUB','creating','yookassa',$6,$7::jsonb)
      `, [orderId, userId, productId, plan.id, amount, idempotenceKey, JSON.stringify({ productName: product.name || "", planLabel: plan.label })]);
      await orderClient.query("COMMIT");
    } catch (orderError) {
      await orderClient.query("ROLLBACK").catch(() => {});
      throw orderError;
    } finally {
      orderClient.release();
    }

    try {
      const payment = await requestYooKassa("/payments", {
        method: "POST",
        headers: { "Idempotence-Key": idempotenceKey },
        body: JSON.stringify({
          amount: { value: paymentAmountString(amount), currency: "RUB" },
          capture: true,
          confirmation: { type: "redirect", return_url: `${PUBLIC_BASE_URL}/?payment=return&order=${encodeURIComponent(orderId)}` },
          description: `Продвижение «${plan.label}» — ${normalizeText(product.name, 80)}`,
          metadata: { order_id: orderId, user_id: userId, product_id: productId, plan: plan.id, app: "ossetian-market" }
        })
      });
      await pool.query(`
        UPDATE payment_orders SET status=$2, provider_payment_id=$3, confirmation_url=$4, updated_at=NOW() WHERE id=$1
      `, [orderId, normalizeText(payment.status, 30) || "pending", normalizeText(payment.id, 100), normalizeText(payment.confirmation?.confirmation_url, 1200)]);
      res.status(201).json({ ok: true, orderId, status: payment.status || "pending", confirmationUrl: payment.confirmation?.confirmation_url || "", amount, currency: "RUB" });
    } catch (providerError) {
      await pool.query(`UPDATE payment_orders SET status='failed', updated_at=NOW() WHERE id=$1`, [orderId]);
      throw providerError;
    }
  } catch (error) {
    console.error("Create promotion payment error:", error);
    await recordSecurityEvent(req, "payment_create_failed", "warning", { productId, plan: planId, message: error?.message || "" }, userId).catch(() => {});
    res.status(502).json({ ok: false, code: "PAYMENT_PROVIDER_ERROR", error: "Не удалось создать платёж. Попробуйте позже." });
  }
});

app.get("/api/payments/:id", requireTelegramAuth, syncTelegramUser, paymentRateLimiter, async (req, res) => {
  try {
    const orderId = normalizeText(req.params.id, 64);
    let result = await pool.query(`SELECT * FROM payment_orders WHERE id=$1 AND user_id=$2 LIMIT 1`, [orderId, String(req.telegramUser.id)]);
    if (!result.rows.length) return res.status(404).json({ ok: false, error: "Платёж не найден" });
    let order = result.rows[0];
    if (["creating", "pending", "waiting_for_capture"].includes(order.status) && order.provider_payment_id && isYooKassaConfigured()) {
      try {
        const payment = await requestYooKassa(`/payments/${encodeURIComponent(order.provider_payment_id)}`, { method: "GET" });
        await finalizePaymentOrder(order.id, payment);
        result = await pool.query(`SELECT * FROM payment_orders WHERE id=$1 AND user_id=$2 LIMIT 1`, [orderId, String(req.telegramUser.id)]);
        order = result.rows[0];
      } catch (error) {
        console.warn("Payment status sync failed:", error?.message || error);
      }
    }
    res.setHeader("Cache-Control", "no-store");
    res.json({ ok: true, payment: { id: order.id, productId: order.product_id, purpose: order.purpose, plan: order.plan, amount: Number(order.amount) || 0, currency: order.currency, status: order.status, paidAt: order.paid_at, createdAt: order.created_at } });
  } catch (error) {
    res.status(500).json({ ok: false, error: "Не удалось проверить платёж" });
  }
});

app.post("/api/payments/yookassa/webhook", webhookRateLimiter, async (req, res) => {
  try {
    if (!isYooKassaConfigured()) return res.status(503).json({ ok: false });
    if (YOOKASSA_WEBHOOK_IP_CHECK && !isAllowedYooKassaWebhookIp(req.ip || req.socket?.remoteAddress)) {
      await recordSecurityEvent(req, "payment_webhook_rejected_ip", "high", {}).catch(() => {});
      return res.status(403).json({ ok: false });
    }
    const type = normalizeText(req.body?.type, 40);
    const providerPaymentId = normalizeText(req.body?.object?.id, 100);
    const event = normalizeText(req.body?.event, 80);
    const allowedEvents = new Set(["payment.waiting_for_capture", "payment.succeeded", "payment.canceled"]);
    if (type !== "notification" || !/^[a-zA-Z0-9_-]{8,100}$/.test(providerPaymentId) || !allowedEvents.has(event)) {
      await recordSecurityEvent(req, "payment_webhook_invalid_payload", "warning", { event }).catch(() => {});
      return res.status(400).json({ ok: false });
    }
    // Тело webhook не является источником истины: актуальный объект повторно получаем у ЮKassa.
    const payment = await requestYooKassa(`/payments/${encodeURIComponent(providerPaymentId)}`, { method: "GET" });
    const orderResult = await pool.query(`SELECT id FROM payment_orders WHERE provider_payment_id=$1 LIMIT 1`, [providerPaymentId]);
    const orderId = String(orderResult.rows[0]?.id || "");
    if (!orderId) {
      await recordSecurityEvent(req, "payment_webhook_unknown_payment", "warning", { providerPaymentId }).catch(() => {});
      return res.status(200).json({ ok: true, ignored: true });
    }
    await finalizePaymentOrder(orderId, payment);
    res.status(200).json({ ok: true });
  } catch (error) {
    console.error("YooKassa webhook error:", error);
    // ЮKassa повторяет доставку при ответе не 200; finalizePaymentOrder идемпотентен.
    res.status(500).json({ ok: false });
  }
});

app.get("/api/avatar", requireTelegramAuth, syncTelegramUser, async (req, res) => {
  try {
    const storedAvatarResult = await pool.query(
      `SELECT avatar FROM users WHERE telegram_id = $1 LIMIT 1`,
      [String(req.telegramUser.id)]
    );
    const storedAvatar = storedAvatarResult.rows[0]?.avatar || "";
    const avatarUrls = await resolveTelegramAvatarUrls(req.telegramUser, storedAvatar);

    if (avatarUrls.length === 0) {
      return res.status(404).json({
        ok: false,
        error: "Фото профиля не найдено"
      });
    }

    let lastError = null;
    for (const avatarUrl of avatarUrls) {
      try {
        const avatar = await fetchTelegramAvatarBuffer(avatarUrl);
        res.setHeader("Content-Type", avatar.contentType);
        res.setHeader("Cache-Control", "private, no-store");
        return res.send(avatar.buffer);
      } catch (error) {
        lastError = error;
        console.warn("Avatar candidate failed:", error?.message || error);
      }
    }

    console.error("All Telegram avatar candidates failed:", lastError);
    return res.status(502).json({
      ok: false,
      error: "Не удалось загрузить фото Telegram"
    });
  } catch (error) {
    console.error("Avatar API error:", error);

    return res.status(500).json({
      ok: false,
      error: "Не удалось получить фото Telegram"
    });
  }
});


app.get("/api/users/:id", async (req, res) => {
  try {
    const userId = normalizeText(req.params.id, 64);

    if (!userId) {
      return res.status(400).json({ ok: false, error: "Некорректный ID продавца" });
    }

    const [userResult, trust] = await Promise.all([
      pool.query(
        `SELECT telegram_id, username, first_name, last_name, avatar, profile_description,
                city, phone, contact_username, listing_limit, is_business, business_name, business_category,
                business_address, business_hours, business_website, business_verified,
                professional_subscription_started_at, professional_subscription_until,
                last_seen, created_at, updated_at
         FROM users
         WHERE telegram_id = $1
         LIMIT 1`,
        [userId]
      ),
      getSellerTrust(pool, userId)
    ]);

    if (userResult.rows.length > 0) {
      return res.json({
        ok: true,
        user: { ...mapPublicUser(userResult.rows[0]), trust }
      });
    }

    // Поддержка старых объявлений, созданных до появления таблицы users.
    const fallbackResult = await pool.query(
      `SELECT owner_id, owner_name, owner_username, created_at
       FROM products
       WHERE owner_id = $1
         AND COALESCE(status, 'active') = 'active'
         AND COALESCE(hidden, FALSE) = FALSE
         AND COALESCE(moderation_status, 'approved') = 'approved'
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId]
    );

    if (fallbackResult.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "Продавец не найден" });
    }

    return res.json({
      ok: true,
      user: { ...mapPublicUser(fallbackResult.rows[0]), trust }
    });
  } catch (error) {
    console.error("Get seller profile error:", error);
    return res.status(500).json({ ok: false, error: "Не удалось получить профиль продавца" });
  }
});

app.get("/api/users/:id/products", async (req, res) => {
  try {
    const userId = normalizeText(req.params.id, 64);

    if (!userId) {
      return res.status(400).json({ ok: false, error: "Некорректный ID продавца" });
    }

    const activeResult = await pool.query(
      `
        SELECT ${PRODUCT_SUMMARY_COLUMNS}
        FROM products p
        WHERE p.owner_id = $1
          AND COALESCE(p.status, 'active') = 'active'
          AND COALESCE(p.hidden, FALSE) = FALSE
          AND COALESCE(p.moderation_status, 'approved') = 'approved'
        ORDER BY p.created_at DESC
        LIMIT 30;
      `,
      [userId]
    );

    const soldResult = await pool.query(
      `
        SELECT ${PRODUCT_SUMMARY_COLUMNS}
        FROM products p
        WHERE p.owner_id = $1
          AND COALESCE(p.status, 'active') = 'sold'
        ORDER BY COALESCE(p.sold_at, p.updated_at, p.created_at) DESC
        LIMIT 30;
      `,
      [userId]
    );

    res.setHeader("Cache-Control", "public, max-age=15, stale-while-revalidate=30");
    res.json({
      ok: true,
      products: activeResult.rows.map(mapProductSummary),
      soldProducts: soldResult.rows.map(mapProductSummary)
    });
  } catch (error) {
    console.error("Get seller products error:", error);
    res.status(500).json({ ok: false, error: "Не удалось получить товары продавца" });
  }
});

app.get("/api/users/:id/store", async (req, res) => {
  try {
    const userId = normalizeText(req.params.id, 64);
    if (!userId) return res.status(400).json({ ok: false, error: "Некорректный ID продавца" });
    const [userResult, trust, categoryResult, topResult] = await Promise.all([
      pool.query(
        `SELECT telegram_id, username, first_name, last_name, avatar, profile_description, city, phone, contact_username,
                listing_limit, is_business, business_name, business_category, business_address, business_hours, business_website, business_verified,
                professional_subscription_started_at, professional_subscription_until,
                last_seen, created_at, updated_at FROM users WHERE telegram_id = $1 LIMIT 1`, [userId]),
      getSellerTrust(pool, userId),
      pool.query(
        `SELECT category, COUNT(*)::int AS count FROM products
         WHERE owner_id = $1 AND COALESCE(status, 'active') = 'active' AND COALESCE(hidden, FALSE) = FALSE AND COALESCE(moderation_status, 'approved') = 'approved'
         GROUP BY category ORDER BY count DESC, category ASC LIMIT 12`, [userId]),
      pool.query(
        `SELECT ${PRODUCT_SUMMARY_COLUMNS} FROM products p
         WHERE p.owner_id = $1 AND COALESCE(p.status, 'active') = 'active' AND COALESCE(p.hidden, FALSE) = FALSE AND COALESCE(p.moderation_status, 'approved') = 'approved'
         ORDER BY CASE WHEN p.featured_paid = TRUE AND p.featured_until > NOW() THEN GREATEST(COALESCE(p.promotion_priority, 1), 1) ELSE 0 END DESC, p.views DESC, p.created_at DESC LIMIT 12`, [userId])
    ]);
    if (!userResult.rows.length) return res.status(404).json({ ok: false, error: "Магазин не найден" });
    const user = mapPublicUser(userResult.rows[0]);
    res.setHeader("Cache-Control", "public, max-age=15, stale-while-revalidate=30");
    res.json({ ok: true, store: {
      user, trust, isStore: Boolean(user.isBusiness),
      categories: categoryResult.rows.map(row => ({ name: row.category, count: Number(row.count) || 0 })),
      featuredProducts: topResult.rows.map(mapProductSummary)
    }});
  } catch (error) {
    console.error("Seller store error:", error);
    res.status(500).json({ ok: false, error: "Не удалось загрузить магазин продавца" });
  }
});

function sendProductMedia(res, source, cacheSeconds = 86_400, cacheScope = "public") {
  const value = normalizeProductImage(source);
  if (!value) return res.status(404).end();

  if (/^https:\/\/[^\s"'<>]+$/i.test(value)) {
    res.setHeader("Cache-Control", `${cacheScope}, max-age=${cacheSeconds}, stale-while-revalidate=604800`);
    return res.redirect(302, value);
  }

  const parsed = parseStoredDataImage(value);
  if (!parsed) return res.status(404).end();

  res.setHeader("Content-Type", parsed.contentType);
  res.setHeader("Content-Length", String(parsed.buffer.length));
  res.setHeader("Cache-Control", `${cacheScope}, max-age=${cacheSeconds}, stale-while-revalidate=604800`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Disposition", "inline");
  return res.send(parsed.buffer);
}

app.get("/api/my-products/:id/thumbnail", async (req, res) => {
  try {
    const productId = normalizeText(req.params.id, 64);
    const ownerId = normalizeText(req.query.owner, 64);
    const expiresAt = Number(req.query.expires);
    const version = normalizeText(req.query.v, 32);
    const token = String(req.query.token || "");

    if (!isValidPrivateMediaToken(productId, ownerId, expiresAt, version, token)) {
      return res.status(403).end();
    }

    const result = await pool.query(
      `
        SELECT
          (SELECT NULLIF(pi.preview_url, '') FROM product_images pi WHERE pi.product_id = p.id ORDER BY pi.position ASC, pi.created_at ASC LIMIT 1) AS preview_source,
          NULLIF(p.thumbnail, '') AS thumbnail_source,
          (SELECT NULLIF(pi.url, '') FROM product_images pi WHERE pi.product_id = p.id ORDER BY pi.position ASC, pi.created_at ASC LIMIT 1) AS table_source,
          NULLIF(p.image, '') AS primary_source,
          CASE
            WHEN jsonb_typeof(p.images) = 'array' THEN p.images ->> 0
            ELSE NULL
          END AS legacy_source
        FROM products p
        WHERE p.id = $1
          AND p.owner_id = $2
          AND COALESCE(status, 'active') <> 'deleted'
        LIMIT 1;
      `,
      [productId, ownerId]
    );

    if (result.rows.length === 0) return res.status(404).end();
    const row = result.rows[0];
    const source = pickValidProductImage(
      row.preview_source,
      row.thumbnail_source,
      row.table_source,
      row.primary_source,
      row.legacy_source
    );
    return sendProductMedia(res, source, 3_600, "private");
  } catch (error) {
    console.error("Own product thumbnail error:", error);
    return res.status(500).end();
  }
});

app.get("/api/products/:id/thumbnail", async (req, res) => {
  try {
    const productId = normalizeText(req.params.id, 64);
    if (!productId) return res.status(400).end();

    const result = await pool.query(
      `
        SELECT
          (SELECT NULLIF(pi.preview_url, '') FROM product_images pi WHERE pi.product_id = p.id ORDER BY pi.position ASC, pi.created_at ASC LIMIT 1) AS preview_source,
          NULLIF(p.thumbnail, '') AS thumbnail_source,
          (SELECT NULLIF(pi.url, '') FROM product_images pi WHERE pi.product_id = p.id ORDER BY pi.position ASC, pi.created_at ASC LIMIT 1) AS table_source,
          NULLIF(p.image, '') AS primary_source,
          CASE
            WHEN jsonb_typeof(p.images) = 'array' THEN p.images ->> 0
            ELSE NULL
          END AS legacy_source
        FROM products p
        WHERE p.id = $1
          AND COALESCE(status, 'active') = 'active'
          AND COALESCE(hidden, FALSE) = FALSE
          AND COALESCE(moderation_status, 'approved') = 'approved'
        LIMIT 1;
      `,
      [productId]
    );

    if (result.rows.length === 0) return res.status(404).end();
    const row = result.rows[0];
    const source = pickValidProductImage(
      row.preview_source,
      row.thumbnail_source,
      row.table_source,
      row.primary_source,
      row.legacy_source
    );
    return sendProductMedia(res, source);
  } catch (error) {
    console.error("Product thumbnail error:", error);
    return res.status(500).end();
  }
});

app.get("/api/products/:id/media/:index", async (req, res) => {
  try {
    const productId = normalizeText(req.params.id, 64);
    const rawIndex = String(req.params.index || "");
    if (!productId || !/^\d+$/.test(rawIndex)) return res.status(400).end();
    const index = Number(rawIndex);
    if (!Number.isInteger(index) || index < 0 || index > 4) return res.status(400).end();

    const result = await pool.query(
      `
        SELECT
          (SELECT NULLIF(pi.url, '')
           FROM product_images pi
           WHERE pi.product_id = p.id
           ORDER BY pi.position ASC, pi.created_at ASC
           OFFSET ($2::int) LIMIT 1) AS table_source,
          CASE
            WHEN jsonb_typeof(p.images) = 'array' THEN p.images ->> ($2::int)
            ELSE NULL
          END AS legacy_source,
          CASE WHEN $2::int = 0 THEN NULLIF(p.image, '') ELSE NULL END AS primary_source,
          CASE WHEN $2::int = 0 THEN NULLIF(p.thumbnail, '') ELSE NULL END AS thumbnail_source,
          CASE WHEN $2::int = 0 THEN
            (SELECT NULLIF(pi.preview_url, '')
             FROM product_images pi
             WHERE pi.product_id = p.id
             ORDER BY pi.position ASC, pi.created_at ASC
             LIMIT 1)
          ELSE NULL END AS preview_source
        FROM products p
        WHERE p.id = $1
          AND COALESCE(status, 'active') = 'active'
          AND COALESCE(hidden, FALSE) = FALSE
          AND COALESCE(moderation_status, 'approved') = 'approved'
        LIMIT 1;
      `,
      [productId, index]
    );

    if (result.rows.length === 0) return res.status(404).end();
    const row = result.rows[0];
    const source = pickValidProductImage(
      row.table_source,
      row.legacy_source,
      row.primary_source,
      row.thumbnail_source,
      row.preview_source
    );
    return sendProductMedia(res, source);
  } catch (error) {
    console.error("Product media error:", error);
    return res.status(500).end();
  }
});

app.use((req, res, next) => {
  if (req.method === "GET" && req.path === "/api/products") {
    return searchRateLimiter(req, res, next);
  }
  return next();
});

app.get("/api/products", async (req, res) => {
  try {
    const page = normalizePositiveInteger(req.query.page, 1, 100000);
    const limit = normalizePositiveInteger(req.query.limit, 12, 30);
    const offset = (page - 1) * limit;
    const search = normalizeText(req.query.q, 100);
    const requestedCategory = normalizeText(req.query.category, 60);
    const category = PRODUCT_CATEGORIES.has(requestedCategory) ? requestedCategory : "";
    const city = normalizeText(req.query.city, 80);
    const district = normalizeText(req.query.district, 80);
    const itemType = normalizeText(req.query.itemType, 80);
    const brand = normalizeText(req.query.brand, 80);
    const model = normalizeText(req.query.model, 80);
    const year = normalizeText(req.query.year, 20);
    const minPrice = Math.max(0, Number(String(req.query.minPrice || "").replace(/[^0-9]/g, "")) || 0);
    const maxPrice = Math.max(0, Number(String(req.query.maxPrice || "").replace(/[^0-9]/g, "")) || 0);
    const requestedSort = normalizeText(req.query.sort, 20);
    const sort = ["newest", "price_asc", "price_desc"].includes(requestedSort)
      ? requestedSort
      : "newest";

    if (minPrice && maxPrice && minPrice > maxPrice) {
      return res.status(400).json({ ok: false, error: "Минимальная цена не может быть выше максимальной" });
    }

    const conditions = [
      "COALESCE(p.status, 'active') = $1",
      "COALESCE(p.hidden, FALSE) = FALSE",
      "COALESCE(p.moderation_status, 'approved') = 'approved'"
    ];
    const values = [PUBLIC_PRODUCT_STATUS];

    const rawSearchTerms = search
      ? [...new Set(normalizeSearchText(search).split(/[^\p{L}\p{N}]+/u).filter(Boolean))].slice(0, 6)
      : [];
    const vacancyRequested = !category && rawSearchTerms.some(term =>
      term.startsWith("ваканс") || ["работа", "работы", "работу", "работе"].includes(term)
    );
    const vacancyStopWords = new Set(["ищу", "найти", "нужна", "нужен", "нужны", "покажи", "показать", "все", "актуальные"]);
    const logicalSearchTerms = vacancyRequested
      ? rawSearchTerms.filter(term =>
          !(term.startsWith("ваканс") || ["работа", "работы", "работу", "работе"].includes(term) || vacancyStopWords.has(term))
        )
      : rawSearchTerms;
    const searchTermGroups = logicalSearchTerms.map(expandSearchTerm).filter(group => group.length > 0);
    const expandedSearchTerms = [...new Set(searchTermGroups.flat())].slice(0, 24);
    const relevanceParts = [];

    if (vacancyRequested) {
      values.push("Вакансии");
      conditions.push(`p.category = $${values.length}`);
    }

    for (const variants of searchTermGroups) {
      const variantConditions = [];
      for (const variant of variants) {
        values.push(variant);
        const exactParameter = `$${values.length}`;
        values.push(`%${variant}%`);
        const likeParameter = `$${values.length}`;
        variantConditions.push(`(
          LOWER(COALESCE(p.name, '')) LIKE ${likeParameter}
          OR LOWER(COALESCE(p.description, '')) LIKE ${likeParameter}
          OR LOWER(COALESCE(p.category, '')) LIKE ${likeParameter}
          OR LOWER(COALESCE(p.location, '')) LIKE ${likeParameter}
          OR LOWER(COALESCE(p.district, '')) LIKE ${likeParameter}
          OR LOWER(COALESCE(p.owner_name, '')) LIKE ${likeParameter}
          OR EXISTS (
            SELECT 1 FROM users search_owner
            WHERE search_owner.telegram_id = p.owner_id
              AND LOWER(COALESCE(search_owner.business_name, '')) LIKE ${likeParameter}
          )
          OR LOWER(COALESCE(p.price, '')) LIKE ${likeParameter}
          OR LOWER(COALESCE(p.specifications::text, '')) LIKE ${likeParameter}
          ${searchCapabilities.pgTrgm ? `OR word_similarity(${exactParameter}, LOWER(COALESCE(p.name, ''))) > 0.52` : ""}
        )`);
        relevanceParts.push(`CASE
          WHEN LOWER(COALESCE(p.name, '')) = ${exactParameter} THEN 14
          WHEN LOWER(COALESCE(p.name, '')) LIKE ${likeParameter} THEN 9
          WHEN LOWER(COALESCE(p.specifications::text, '')) LIKE ${likeParameter} THEN 5
          WHEN LOWER(COALESCE(p.category, '')) LIKE ${likeParameter} THEN 3
          WHEN EXISTS (SELECT 1 FROM users search_owner WHERE search_owner.telegram_id = p.owner_id AND LOWER(COALESCE(search_owner.business_name, '')) LIKE ${likeParameter}) THEN 3
          WHEN LOWER(COALESCE(p.description, '')) LIKE ${likeParameter} THEN 2
          ${searchCapabilities.pgTrgm ? `WHEN word_similarity(${exactParameter}, LOWER(COALESCE(p.name, ''))) > 0.52 THEN 2` : ""}
          ELSE 0 END`);
      }
      conditions.push(`(${variantConditions.join(" OR ")})`);
    }

    let relevanceSql = relevanceParts.length ? `(${relevanceParts.join(" + ")})` : "";

    if (category) {
      values.push(category);
      conditions.push(`p.category = $${values.length}`);
    }

    if (city) {
      values.push(city.toLowerCase());
      conditions.push(`LOWER(COALESCE(p.location, '')) = $${values.length}`);
    }

    if (district) {
      values.push(`%${district.toLowerCase()}%`);
      conditions.push(`LOWER(COALESCE(p.district, '')) LIKE $${values.length}`);
    }

    const addStructuredFilter = (value, keys = []) => {
      if (!value) return;
      values.push(value.toLowerCase());
      const exactParameter = `$${values.length}`;
      values.push(`%${value.toLowerCase()}%`);
      const fallbackParameter = `$${values.length}`;
      const jsonChecks = keys.map(key => `LOWER(COALESCE(p.specifications->>'${key}', '')) = ${exactParameter}`);
      conditions.push(`(
        ${jsonChecks.join("\n        OR ")}
        OR LOWER(COALESCE(p.name, '')) LIKE ${fallbackParameter}
        OR LOWER(COALESCE(p.description, '')) LIKE ${fallbackParameter}
        OR LOWER(COALESCE(p.specifications::text, '')) LIKE ${fallbackParameter}
      )`);
    };
    addStructuredFilter(itemType, ["Тип товара", "Подкатегория", "Тип", "Сфера работы"]);
    addStructuredFilter(brand, ["Марка / бренд", "Марка", "Бренд", "График работы"]);
    addStructuredFilter(model, ["Модель", "Опыт работы"]);
    addStructuredFilter(year, ["Год выпуска", "Год", "Тип занятости"]);

    if (minPrice) {
      values.push(minPrice);
      conditions.push(`COALESCE(p.price_amount, 0) >= $${values.length}`);
    }
    if (maxPrice) {
      values.push(maxPrice);
      conditions.push(`COALESCE(p.price_amount, 0) <= $${values.length}`);
    }

    const whereSql = conditions.join(" AND ");
    // Paid highlighting is visual only: it must not change a listing's position in the public catalog.
    const orderBySql = [
      ...(relevanceSql ? [`${relevanceSql} DESC`] : []),
      "p.created_at DESC",
      "p.id DESC"
    ].join(",\n          ");
    const selectedOrderBySql = sort === "price_asc"
      ? "COALESCE(p.price_amount, 9223372036854775807) ASC, p.created_at DESC, p.id DESC"
      : sort === "price_desc"
        ? "COALESCE(p.price_amount, 0) DESC, p.created_at DESC, p.id DESC"
        : orderBySql;

    const queryValues = [...values, limit + 1, offset];
    const result = await pool.query(
      `
        SELECT ${PRODUCT_SUMMARY_COLUMNS}
        FROM products p
        WHERE ${whereSql}
        ORDER BY
          ${selectedOrderBySql}
        LIMIT $${values.length + 1}
        OFFSET $${values.length + 2};
      `,
      queryValues
    );

    const hasMore = result.rows.length > limit;
    const visibleRows = hasMore ? result.rows.slice(0, limit) : result.rows;
    res.setHeader("Cache-Control", "public, max-age=10, stale-while-revalidate=30");
    res.json({
      ok: true,
      products: visibleRows.map(mapProductSummary),
      filters: { search, category, city, district, itemType, brand, model, year, minPrice, maxPrice, sort },
      searchMeta: {
        normalized: normalizeSearchText(search),
        expandedTerms: expandedSearchTerms,
        typoTolerance: searchCapabilities.pgTrgm,
        transliteration: true
      },
      pagination: {
        page,
        limit,
        hasMore,
        pages: hasMore ? page + 1 : page
      }
    });
  } catch (error) {
    console.error("Get products error:", error);
    res.status(500).json({ ok: false, error: "Не удалось получить товары" });
  }
});

app.get("/api/my-products", requireTelegramAuth, syncTelegramUser, async (req, res) => {
  try {
    const result = await pool.query(
      `
        SELECT ${PRODUCT_SUMMARY_COLUMNS},
          (SELECT COUNT(*)::int FROM product_feature_requests pfr
           WHERE pfr.product_id = p.id AND pfr.owner_id = p.owner_id AND pfr.status = 'pending') AS pending_feature_requests
        FROM products p
        WHERE p.owner_id = $1 AND COALESCE(p.status, 'active') <> 'deleted'
        ORDER BY p.created_at DESC
        LIMIT 100;
      `,
      [req.telegramUser.id]
    );

    const listingQuota = await getListingQuota(pool, req.telegramUser.id);
    res.json({ ok: true, products: result.rows.map(mapOwnProductSummary), listingQuota });
  } catch (error) {
    console.error("Get my products error:", error);
    res.status(500).json({ ok: false, error: "Не удалось получить мои объявления" });
  }
});

app.get("/api/me/analytics", requireTelegramAuth, syncTelegramUser, async (req, res) => {
  try {
    const ownerId = String(req.telegramUser.id);
    const [summaryResult, topProductsResult, dailyViewsResult, engagementResult, previousViewsResult, trust] = await Promise.all([
      pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE COALESCE(status, 'active') = 'active' AND COALESCE(hidden, FALSE) = FALSE)::int AS active_listings,
           COUNT(*) FILTER (WHERE COALESCE(status, 'active') = 'sold')::int AS sold_listings,
           COALESCE(SUM(views), 0)::bigint AS total_views,
           COUNT(*) FILTER (WHERE featured_paid = TRUE AND featured_until > NOW())::int AS active_promotions,
           COALESCE((SELECT COUNT(*) FROM favorites f JOIN products fp ON fp.id = f.product_id WHERE fp.owner_id = $1), 0)::int AS favorites
         FROM products
         WHERE owner_id = $1 AND COALESCE(status, 'active') <> 'deleted'`,
        [ownerId]
      ),
      pool.query(
        `SELECT p.id, p.name, p.price, p.views, p.status, p.featured_paid, p.featured_until, p.promotion_plan,
                (SELECT COUNT(*)::int FROM favorites f WHERE f.product_id = p.id) AS favorite_count
         FROM products p
         WHERE p.owner_id = $1 AND COALESCE(p.status, 'active') <> 'deleted'
         ORDER BY COALESCE(p.views, 0) DESC, p.created_at DESC
         LIMIT 8`,
        [ownerId]
      ),
      pool.query(
        `SELECT event_date, COUNT(*)::int AS unique_views
         FROM product_view_events
         WHERE owner_id = $1 AND event_date >= CURRENT_DATE - INTERVAL '13 days'
         GROUP BY event_date
         ORDER BY event_date ASC`,
        [ownerId]
      ),
      pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE event_type='call_click')::int AS call_clicks,
           COUNT(*) FILTER (WHERE event_type='message_click')::int AS message_clicks,
           COUNT(*) FILTER (WHERE event_type='share_click')::int AS share_clicks
         FROM product_engagement_events
         WHERE owner_id=$1`,
        [ownerId]
      ),
      pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE event_date >= CURRENT_DATE - INTERVAL '6 days')::int AS current_views,
           COUNT(*) FILTER (WHERE event_date BETWEEN CURRENT_DATE - INTERVAL '13 days' AND CURRENT_DATE - INTERVAL '7 days')::int AS previous_views
         FROM product_view_events WHERE owner_id=$1`,
        [ownerId]
      ),
      getSellerTrust(pool, ownerId)
    ]);
    const summary = summaryResult.rows[0] || {};
    const engagement = engagementResult.rows[0] || {};
    const periods = previousViewsResult.rows[0] || {};
    const currentViews = Number(periods.current_views) || 0;
    const previousViews = Number(periods.previous_views) || 0;
    const viewsChangePercent = previousViews > 0 ? Math.round(((currentViews - previousViews) / previousViews) * 100) : (currentViews > 0 ? 100 : 0);
    const contactClicks = (Number(engagement.call_clicks) || 0) + (Number(engagement.message_clicks) || 0);
    const uniqueViewTotal = dailyViewsResult.rows.reduce((sum, row) => sum + (Number(row.unique_views) || 0), 0);
    const contactConversionPercent = uniqueViewTotal > 0 ? Math.round((contactClicks / uniqueViewTotal) * 1000) / 10 : 0;
    res.setHeader("Cache-Control", "no-store");
    res.json({
      ok: true,
      analytics: {
        activeListings: Number(summary.active_listings) || 0,
        soldListings: Number(summary.sold_listings) || 0,
        totalViews: Number(summary.total_views) || 0,
        favorites: Number(summary.favorites) || 0,
        activePromotions: Number(summary.active_promotions) || 0,
        callClicks: Number(engagement.call_clicks) || 0,
        messageClicks: Number(engagement.message_clicks) || 0,
        shareClicks: Number(engagement.share_clicks) || 0,
        contactConversionPercent,
        viewsChangePercent,
        trust,
        dailyViews: dailyViewsResult.rows.map(row => ({ date: row.event_date, views: Number(row.unique_views) || 0 })),
        topProducts: topProductsResult.rows.map(row => ({
          id: row.id, name: row.name || "Объявление", price: row.price || "",
          views: Number(row.views) || 0, favoriteCount: Number(row.favorite_count) || 0,
          status: row.status || "active", promotionPlan: row.promotion_plan || "",
          promoted: Boolean(row.featured_paid && row.featured_until && new Date(row.featured_until).getTime() > Date.now())
        }))
      }
    });
  } catch (error) {
    console.error("Seller analytics error:", error);
    res.status(500).json({ ok: false, error: "Не удалось загрузить аналитику продавца" });
  }
});

app.get("/api/my-products/:id/details", requireTelegramAuth, syncTelegramUser, async (req, res) => {
  try {
    const productId = normalizeText(req.params.id, 64);
    const result = await pool.query(
      `
        SELECT p.*,
          COALESCE(
            (SELECT jsonb_agg(pi.url ORDER BY pi.position ASC, pi.created_at ASC)
             FROM product_images pi WHERE pi.product_id = p.id),
            p.images,
            '[]'::jsonb
          ) AS images,
          (SELECT COUNT(*)::int FROM product_feature_requests pfr
           WHERE pfr.product_id = p.id AND pfr.owner_id = p.owner_id AND pfr.status = 'pending') AS pending_feature_requests
        FROM products p
        WHERE p.id = $1
          AND p.owner_id = $2
          AND COALESCE(status, 'active') NOT IN ('deleted', 'sold');
      `,
      [productId, req.telegramUser.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "Объявление не найдено" });
    }

    res.json({ ok: true, product: mapProduct(result.rows[0]) });
  } catch (error) {
    console.error("Get own product details error:", error);
    res.status(500).json({ ok: false, error: "Не удалось загрузить объявление" });
  }
});

app.post("/api/products", requireTelegramAuth, syncTelegramUser, async (req, res) => {
  const client = await pool.connect();
  try {
    const {
      name, price, category, desc, image, thumbnail, images, location, phone,
      allowCalls, allowMessages, condition, negotiable, delivery, district,
      specifications, status, publicPhoneConsent, publicTelegramConsent
    } = req.body;

    const cleanName = normalizeText(name, 120);
    const cleanPrice = formatStoredPrice(price);
    const cleanPriceAmount = parsePriceAmount(cleanPrice);
    const cleanCategory = normalizeText(category, 60);
    const cleanDescription = normalizeText(desc, 5000);
    const cleanLocation = normalizeText(location, 80) || "Владикавказ";
    let cleanPhone = normalizeText(phone, 30);
    const cleanCondition = normalizeProductCondition(condition);
    const cleanDistrict = normalizeText(district, 80);
    const cleanSpecifications = normalizeSpecifications(specifications);
    const requestedStatus = normalizeProductStatus(status, "active");

    if (!PRODUCT_CATEGORIES.has(cleanCategory)) {
      return res.status(400).json({ ok: false, error: "Выберите допустимую категорию" });
    }
    if (!cleanName || !cleanPrice || !cleanCategory || !cleanDescription) {
      return res.status(400).json({ ok: false, error: "Проверьте название, цену, категорию и описание" });
    }
    if (allowCalls !== false && cleanPhone && publicPhoneConsent !== true) {
      return res.status(400).json({ ok: false, code: "PUBLIC_PHONE_CONSENT_REQUIRED", error: "Подтвердите согласие на публикацию номера телефона" });
    }
    if (allowMessages !== false && publicTelegramConsent !== true) {
      return res.status(400).json({ ok: false, code: "PUBLIC_TELEGRAM_CONSENT_REQUIRED", error: "Подтвердите согласие на публикацию Telegram-контакта" });
    }

    const sourceImages = Array.isArray(images) ? images : [];
    const cleanImages = await optimizeProductImageList(sourceImages);
    const fallbackImage = await optimizeStoredProductImage(image);
    if (cleanImages.length === 0 && fallbackImage) cleanImages.push(fallbackImage);
    const cleanThumbnail = await optimizeStoredProductImage(thumbnail || cleanImages[0] || "", { thumbnail: true });

    await client.query("BEGIN");
    await recordListingLegalAcceptances(client, req.telegramUser.id, { publicPhoneConsent, publicTelegramConsent });
    const listingQuota = await getListingQuota(client, req.telegramUser.id, { lockUser: true });
    if (!listingQuota.unlimited && listingQuota.used >= listingQuota.limit) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        ok: false,
        code: "LISTING_LIMIT_REACHED",
        error: `У вас уже ${listingQuota.used} из ${listingQuota.limit} доступных объявлений. Удалите одно объявление или отметьте его проданным либо подключите подписку «Профессиональный продавец».`,
        listingQuota
      });
    }

    const phoneBinding = await resolveBoundPhone(client, req.telegramUser.id, cleanPhone);
    if (!phoneBinding.ok) {
      await client.query("ROLLBACK");
      return res.status(phoneBinding.status || 409).json(phoneBinding);
    }
    cleanPhone = phoneBinding.phone;

    const moderation = await evaluateProductModeration({
      name: cleanName,
      desc: cleanDescription,
      location: cleanLocation,
      district: cleanDistrict,
      specifications: cleanSpecifications,
      ownerId: req.telegramUser.id
    }, client);
    const listingFeeRequirement = requestedStatus === "active"
      ? await getListingFeeRequirement(client, cleanCategory, cleanSpecifications)
      : { required: false, feeType: "", priceRub: 0 };
    const finalStatus = moderation.blocked
      ? "draft"
      : (requestedStatus === "draft" || listingFeeRequirement.required ? "draft" : "active");
    const duplicateFingerprint = buildDuplicateFingerprint({
      name: cleanName,
      priceAmount: cleanPriceAmount,
      category: cleanCategory,
      description: cleanDescription,
      images: cleanImages,
      location: cleanLocation,
      district: cleanDistrict,
      specifications: cleanSpecifications
    });
    const duplicate = await findDuplicateListing(client, req.telegramUser.id, duplicateFingerprint);
    if (duplicate) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        ok: false,
        code: "DUPLICATE_LISTING",
        error: `Похожее объявление «${duplicate.name}» уже существует. Отредактируйте его вместо повторной публикации.`,
        duplicateProductId: duplicate.id
      });
    }
    const id = randomUUID();
    const ownerName = getTelegramDisplayName(req.telegramUser);

    const result = await client.query(
      `
        INSERT INTO products (
          id, owner_id, owner_name, owner_username, name, price, price_amount,
          category, description, image, images, location, phone, allow_calls, allow_messages,
          condition, negotiable, delivery, district, specifications, views, status,
          hidden, auto_hidden, moderation_status, moderation_reason, moderation_matches,
          moderation_target_status, published_at, expires_at, duplicate_fingerprint
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13,
          $14, $15, $16, $17, $18, $19, $20::jsonb, 0, $21, $22, $23, $24, $25, $26::jsonb, $27,
          CASE WHEN $21 = 'active' THEN NOW() ELSE NULL END,
          CASE WHEN $21 = 'active' THEN NOW() + ($28::int * INTERVAL '1 day') ELSE NULL END,
          $29
        )
        RETURNING *;
      `,
      [
        id, req.telegramUser.id, ownerName || "Пользователь Telegram",
        req.telegramUser.username || "", cleanName, cleanPrice, cleanPriceAmount,
        cleanCategory, cleanDescription, cleanImages[0] || "", JSON.stringify(cleanImages),
        cleanLocation, cleanPhone, allowCalls !== false, allowMessages !== false, cleanCondition,
        normalizeBoolean(negotiable), normalizeBoolean(delivery), cleanDistrict,
        JSON.stringify(cleanSpecifications), finalStatus, moderation.blocked,
        moderation.blocked, moderation.blocked ? "blocked" : "approved",
        moderation.reason, JSON.stringify(moderation.matches),
        requestedStatus === "draft" ? "draft" : "active",
        PRODUCT_ARCHIVE_DAYS,
        duplicateFingerprint
      ]
    );

    await client.query(`
      UPDATE products
      SET ai_risk_score = $2, ai_decision = $3, ai_reason = $4, ai_model = $5, ai_response_id = $6
      WHERE id = $1
    `, [id, Number(moderation.aiScore) || 0, moderation.aiDecision || "allow", moderation.reason || "", moderation.aiModel || "", moderation.aiResponseId || ""]);
    Object.assign(result.rows[0], { ai_risk_score: Number(moderation.aiScore) || 0, ai_decision: moderation.aiDecision || "allow", ai_reason: moderation.reason || "", ai_model: moderation.aiModel || "", ai_response_id: moderation.aiResponseId || "" });

    if (cleanThumbnail) {
      await client.query(`UPDATE products SET thumbnail = $2 WHERE id = $1`, [id, cleanThumbnail]);
      result.rows[0].thumbnail = cleanThumbnail;
    }

    for (const [index, url] of cleanImages.entries()) {
      await client.query(
        `INSERT INTO product_images (id, product_id, url, position) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
        [randomUUID(), id, url, index]
      );
    }

    if (moderation.blocked) {
      await client.query(
        `INSERT INTO moderation_events (id, product_id, user_id, source, reason, matches, ai_score, ai_decision, ai_model, ai_response_id) VALUES ($1, $2, $3, 'publish', $4, $5::jsonb, $6, $7, $8, $9) ON CONFLICT DO NOTHING`,
        [randomUUID(), id, req.telegramUser.id, moderation.reason, JSON.stringify(moderation.matches), Number(moderation.aiScore) || 0, moderation.aiDecision || "", moderation.aiModel || "", moderation.aiResponseId || ""]
      );
      recordSecurityEvent(req, moderation.aiReview ? "ai_moderation_review" : "moderation_block", moderation.aiReview ? "warning" : "high", {
        productId: id, aiScore: moderation.aiScore || 0, reason: moderation.reason
      }, req.telegramUser.id).catch(() => {});
    }

    const updatedListingQuota = await getListingQuota(client, req.telegramUser.id);
    await client.query("COMMIT");
    res.status(201).json({
      ok: true,
      product: mapProduct(result.rows[0]),
      listingQuota: updatedListingQuota,
      moderation: { blocked: moderation.blocked, aiReview: Boolean(moderation.aiReview), aiScore: Number(moderation.aiScore) || 0, reason: moderation.reason },
      paymentRequired: (!moderation.blocked && requestedStatus === "active" && listingFeeRequirement.required)
        ? { type: "listing_fee", feeType: listingFeeRequirement.feeType, priceRub: listingFeeRequirement.priceRub, productId: id }
        : null
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Create product error:", error);
    if (error?.code === "23505" && String(error?.constraint || "").includes("phone_normalized")) {
      return res.status(409).json({ ok: false, code: "PHONE_ALREADY_USED", error: "Этот номер уже привязан к другому профилю" });
    }
    if (error?.code === "23505" && String(error?.constraint || "").includes("duplicate_fingerprint")) {
      return res.status(409).json({ ok: false, code: "DUPLICATE_LISTING", error: "Такое объявление уже опубликовано" });
    }
    res.status(500).json({ ok: false, error: "Не удалось создать объявление" });
  } finally {
    client.release();
  }
});

app.patch("/api/products/:id", requireTelegramAuth, syncTelegramUser, async (req, res) => {
  const client = await pool.connect();
  try {
    const productId = normalizeText(req.params.id, 64);
    const {
      name, price, category, desc, image, thumbnail, images, location, phone,
      allowCalls, allowMessages, condition, negotiable, delivery, district,
      specifications, status, discountEnabled, originalPrice
    } = req.body;

    if (!productId) return res.status(400).json({ ok: false, error: "Некорректный ID товара" });

    const cleanName = normalizeText(name, 120);
    const cleanPrice = formatStoredPrice(price);
    const cleanPriceAmount = parsePriceAmount(cleanPrice);
    const hasDiscountControl = Object.prototype.hasOwnProperty.call(req.body || {}, "discountEnabled");
    const requestedDiscountEnabled = hasDiscountControl && normalizeBoolean(discountEnabled);
    const cleanOriginalPrice = formatStoredPrice(originalPrice);
    const cleanOriginalPriceAmount = parsePriceAmount(cleanOriginalPrice);
    const cleanCategory = normalizeText(category, 60);
    const cleanDescription = normalizeText(desc, 5000);
    const cleanLocation = normalizeText(location, 80) || "Владикавказ";
    let cleanPhone = normalizeText(phone, 30);
    const cleanCondition = normalizeProductCondition(condition);
    const cleanDistrict = normalizeText(district, 80);
    const cleanSpecifications = normalizeSpecifications(specifications);
    const requestedStatus = normalizeProductStatus(status, "active");

    if (!PRODUCT_CATEGORIES.has(cleanCategory)) {
      return res.status(400).json({ ok: false, error: "Выберите допустимую категорию" });
    }
    if (!cleanName || !cleanPrice || !cleanDescription) {
      return res.status(400).json({ ok: false, error: "Проверьте название, цену и описание" });
    }
    if (requestedDiscountEnabled && (!cleanOriginalPrice || cleanOriginalPriceAmount <= cleanPriceAmount)) {
      return res.status(400).json({
        ok: false,
        error: "Цена со скидкой должна быть ниже обычной цены"
      });
    }

    const cleanImages = await optimizeProductImageList(Array.isArray(images) ? images : []);
    const fallbackImage = await optimizeStoredProductImage(image);
    if (cleanImages.length === 0 && fallbackImage) cleanImages.push(fallbackImage);
    const requestedThumbnail = await optimizeStoredProductImage(thumbnail || cleanImages[0] || "", { thumbnail: true });

    await client.query("BEGIN");
    const existingResult = await client.query(
      `SELECT * FROM products WHERE id = $1 AND owner_id = $2 AND COALESCE(status, 'active') <> 'deleted' FOR UPDATE`,
      [productId, req.telegramUser.id]
    );
    if (existingResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ ok: false, error: "Объявление не найдено или у вас нет прав" });
    }

    const existing = existingResult.rows[0];
    if ((existing.status || "active") === "sold") {
      await client.query("ROLLBACK");
      return res.status(409).json({
        ok: false,
        error: "Проданное объявление хранится только в истории и больше не редактируется"
      });
    }
    const phoneBinding = await resolveBoundPhone(client, req.telegramUser.id, cleanPhone);
    if (!phoneBinding.ok) {
      await client.query("ROLLBACK");
      return res.status(phoneBinding.status || 409).json(phoneBinding);
    }
    cleanPhone = phoneBinding.phone;
    const existingImages = normalizeImages(existing);
    const mainImageChanged = String(cleanImages[0] || "") !== String(existingImages[0] || existing.image || "");
    const cleanThumbnail = requestedThumbnail || (!mainImageChanged ? existing.thumbnail : "") || cleanImages[0] || "";
    const oldPriceAmount = Number(existing.price_amount) || parsePriceAmount(existing.price);
    const priceChanged = oldPriceAmount > 0 && oldPriceAmount !== cleanPriceAmount;
    const automaticPriceDropped = priceChanged && cleanPriceAmount < oldPriceAmount;

    let finalPreviousPrice = existing.previous_price || "";
    let finalPreviousPriceAmount = Number(existing.previous_price_amount) || parsePriceAmount(existing.previous_price);
    let finalPriceDroppedAt = existing.price_dropped_at || null;

    if (hasDiscountControl) {
      if (requestedDiscountEnabled) {
        finalPreviousPrice = cleanOriginalPrice;
        finalPreviousPriceAmount = cleanOriginalPriceAmount;
        const sameDiscount =
          Number(existing.previous_price_amount) === cleanOriginalPriceAmount &&
          oldPriceAmount === cleanPriceAmount;
        finalPriceDroppedAt = sameDiscount && existing.price_dropped_at
          ? existing.price_dropped_at
          : new Date();
      } else {
        finalPreviousPrice = "";
        finalPreviousPriceAmount = null;
        finalPriceDroppedAt = null;
      }
    } else if (automaticPriceDropped) {
      finalPreviousPrice = existing.price;
      finalPreviousPriceAmount = oldPriceAmount;
      finalPriceDroppedAt = new Date();
    }

    const priceDropped = Boolean(
      Number(finalPreviousPriceAmount) > cleanPriceAmount && cleanPriceAmount > 0
    );
    const discountMetadataChanged =
      String(existing.previous_price || "") !== String(finalPreviousPrice || "") ||
      (Number(existing.previous_price_amount) || 0) !== (Number(finalPreviousPriceAmount) || 0);

    const moderation = await evaluateProductModeration({
      name: cleanName,
      desc: cleanDescription,
      location: cleanLocation,
      district: cleanDistrict,
      specifications: cleanSpecifications,
      ownerId: req.telegramUser.id
    }, client);
    const listingFeeRequirement = requestedStatus === "active" && (existing.status || "active") !== "active"
      ? await getListingFeeRequirement(client, cleanCategory, cleanSpecifications)
      : { required: false, feeType: "", priceRub: 0 };
    const listingFeePaid = listingFeeRequirement.required
      ? await hasSuccessfulListingPayment(client, req.telegramUser.id, productId, listingFeeRequirement.feeType)
      : false;
    const finalStatus = moderation.blocked
      ? "draft"
      : (requestedStatus === "draft" || (listingFeeRequirement.required && !listingFeePaid) ? "draft" : "active");
    const duplicateFingerprint = buildDuplicateFingerprint({
      name: cleanName,
      priceAmount: cleanPriceAmount,
      category: cleanCategory,
      description: cleanDescription,
      images: cleanImages,
      location: cleanLocation,
      district: cleanDistrict,
      specifications: cleanSpecifications
    });
    const duplicate = await findDuplicateListing(client, req.telegramUser.id, duplicateFingerprint, productId);
    if (duplicate) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        ok: false,
        code: "DUPLICATE_LISTING",
        error: `Похожее объявление «${duplicate.name}» уже существует.`,
        duplicateProductId: duplicate.id
      });
    }

    const result = await client.query(
      `
        UPDATE products
        SET name = $3, price = $4, price_amount = $5, category = $6,
            description = $7, image = $8, images = $9::jsonb, location = $10,
            phone = $11, allow_calls = $12, allow_messages = $13, condition = $14, negotiable = $15,
            delivery = $16, district = $17, specifications = $18::jsonb, status = $19,
            previous_price = $20,
            previous_price_amount = $21,
            price_dropped_at = $22,
            moderation_status = $23, moderation_reason = $24,
            moderation_matches = $25::jsonb,
            moderation_target_status = $27,
            hidden = CASE
              WHEN $26 THEN TRUE
              WHEN COALESCE(auto_hidden, FALSE) = TRUE THEN FALSE
              ELSE hidden
            END,
            auto_hidden = $26,
            thumbnail = $28,
            published_at = CASE WHEN $19 = 'active' AND COALESCE(status, '') <> 'active' THEN NOW() ELSE published_at END,
            expires_at = CASE WHEN $19 = 'active' AND COALESCE(status, '') <> 'active' THEN NOW() + ($29::int * INTERVAL '1 day') ELSE expires_at END,
            archived_at = CASE WHEN $19 = 'active' THEN NULL ELSE archived_at END,
            duplicate_fingerprint = $30,
            updated_at = NOW()
        WHERE id = $1 AND owner_id = $2
        RETURNING *;
      `,
      [
        productId, req.telegramUser.id, cleanName, cleanPrice, cleanPriceAmount,
        cleanCategory, cleanDescription, cleanImages[0] || "", JSON.stringify(cleanImages),
        cleanLocation, cleanPhone, allowCalls !== false, allowMessages !== false, cleanCondition,
        normalizeBoolean(negotiable), normalizeBoolean(delivery), cleanDistrict,
        JSON.stringify(cleanSpecifications), finalStatus,
        finalPreviousPrice, finalPreviousPriceAmount, finalPriceDroppedAt,
        moderation.blocked ? "blocked" : "approved", moderation.reason,
        JSON.stringify(moderation.matches), moderation.blocked,
        requestedStatus, cleanThumbnail, PRODUCT_ARCHIVE_DAYS, duplicateFingerprint
      ]
    );

    await client.query(`
      UPDATE products
      SET ai_risk_score = $2, ai_decision = $3, ai_reason = $4, ai_model = $5, ai_response_id = $6
      WHERE id = $1
    `, [productId, Number(moderation.aiScore) || 0, moderation.aiDecision || "allow", moderation.reason || "", moderation.aiModel || "", moderation.aiResponseId || ""]);
    Object.assign(result.rows[0], { ai_risk_score: Number(moderation.aiScore) || 0, ai_decision: moderation.aiDecision || "allow", ai_reason: moderation.reason || "", ai_model: moderation.aiModel || "", ai_response_id: moderation.aiResponseId || "" });

    if (priceChanged) {
      await client.query(
        `
          INSERT INTO product_price_history (
            id, product_id, old_price, new_price, old_price_amount, new_price_amount, changed_by
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        `,
        [randomUUID(), productId, existing.price, cleanPrice, oldPriceAmount, cleanPriceAmount, req.telegramUser.id]
      );
    }

    await client.query("DELETE FROM product_images WHERE product_id = $1", [productId]);
    for (const [index, url] of cleanImages.entries()) {
      await client.query(
        `INSERT INTO product_images (id, product_id, url, position) VALUES ($1, $2, $3, $4)`,
        [randomUUID(), productId, url, index]
      );
    }

    if (moderation.blocked) {
      await client.query(
        `INSERT INTO moderation_events (id, product_id, user_id, source, reason, matches, ai_score, ai_decision, ai_model, ai_response_id) VALUES ($1, $2, $3, 'edit', $4, $5::jsonb, $6, $7, $8, $9) ON CONFLICT DO NOTHING`,
        [randomUUID(), productId, req.telegramUser.id, moderation.reason, JSON.stringify(moderation.matches), Number(moderation.aiScore) || 0, moderation.aiDecision || "", moderation.aiModel || "", moderation.aiResponseId || ""]
      );
    }

    await client.query("COMMIT");
    res.json({
      ok: true,
      product: mapProduct(result.rows[0]),
      moderation: { blocked: moderation.blocked, aiReview: Boolean(moderation.aiReview), aiScore: Number(moderation.aiScore) || 0, reason: moderation.reason },
      priceChange: {
        changed: priceChanged || discountMetadataChanged,
        dropped: priceDropped,
        discountEnabled: priceDropped
      },
      paymentRequired: (!moderation.blocked && requestedStatus === "active" && listingFeeRequirement.required && !listingFeePaid)
        ? { type: "listing_fee", feeType: listingFeeRequirement.feeType, priceRub: listingFeeRequirement.priceRub, productId }
        : null
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Update product error:", error);
    if (error?.code === "23505" && String(error?.constraint || "").includes("phone_normalized")) {
      return res.status(409).json({ ok: false, code: "PHONE_ALREADY_USED", error: "Этот номер уже привязан к другому профилю" });
    }
    if (error?.code === "23505" && String(error?.constraint || "").includes("duplicate_fingerprint")) {
      return res.status(409).json({ ok: false, code: "DUPLICATE_LISTING", error: "Такое объявление уже существует" });
    }
    res.status(500).json({ ok: false, error: "Не удалось обновить объявление" });
  } finally {
    client.release();
  }
});

app.get("/api/products/:id/details", async (req, res) => {
  try {
    const productId = normalizeText(req.params.id, 64);

    if (!productId) {
      return res.status(400).json({ ok: false, error: "Некорректный ID товара" });
    }

    const productResult = await pool.query(
      `
        SELECT
          ${PRODUCT_PUBLIC_DETAIL_COLUMNS},
          (SELECT COUNT(*)::int FROM favorites f WHERE f.product_id = p.id) AS favorite_count,
          (SELECT COUNT(*)::int FROM reports r WHERE r.product_id = p.id AND r.status = 'pending') AS report_count
        FROM products p
        WHERE p.id = $1
          AND COALESCE(p.status, 'active') = 'active'
          AND COALESCE(p.hidden, FALSE) = FALSE
          AND COALESCE(p.moderation_status, 'approved') = 'approved';
      `,
      [productId]
    );

    if (productResult.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "Товар не найден" });
    }

    const row = productResult.rows[0];
    const [similarResult, sellerResult, priceHistoryResult, sellerTrust] = await Promise.all([
      pool.query(
        `
          SELECT
            ${PRODUCT_SUMMARY_COLUMNS},
            (SELECT COUNT(*)::int FROM favorites f WHERE f.product_id = p.id) AS favorite_count
          FROM products p
          WHERE p.id <> $1
            AND p.category = $2
            AND COALESCE(p.status, 'active') = 'active'
            AND COALESCE(p.hidden, FALSE) = FALSE
          AND COALESCE(p.moderation_status, 'approved') = 'approved'
          ORDER BY (p.location = $3) DESC, p.created_at DESC
          LIMIT 6;
        `,
        [productId, row.category, row.location]
      ),
      pool.query(
        `
          SELECT
            ${PRODUCT_SUMMARY_COLUMNS},
            (SELECT COUNT(*)::int FROM favorites f WHERE f.product_id = p.id) AS favorite_count
          FROM products p
          WHERE p.id <> $1
            AND p.owner_id = $2
            AND COALESCE(p.status, 'active') = 'active'
            AND COALESCE(p.hidden, FALSE) = FALSE
          AND COALESCE(p.moderation_status, 'approved') = 'approved'
          ORDER BY p.created_at DESC
          LIMIT 6;
        `,
        [productId, row.owner_id]
      ),
      pool.query(
        `
          SELECT old_price, new_price, old_price_amount, new_price_amount, created_at
          FROM product_price_history
          WHERE product_id = $1
          ORDER BY created_at DESC
          LIMIT 10;
        `,
        [productId]
      ),
      getSellerTrust(pool, row.owner_id)
    ]);

    res.json({
      ok: true,
      product: mapPublicProduct(row),
      similarProducts: similarResult.rows.map(mapProductSummary),
      sellerProducts: sellerResult.rows.map(mapProductSummary),
      priceHistory: priceHistoryResult.rows,
      sellerTrust
    });
  } catch (error) {
    console.error("Product details error:", error);
    res.status(500).json({ ok: false, error: "Не удалось загрузить карточку товара" });
  }
});

app.post("/api/products/:id/view", async (req, res) => {
  try {
    const productId = normalizeText(req.params.id, 64);

    if (!productId) {
      return res.status(400).json({ ok: false, error: "Некорректный ID товара" });
    }

    const result = await pool.query(
      `
        UPDATE products
        SET views = COALESCE(views, 0) + 1
        WHERE id = $1
          AND COALESCE(status, 'active') = 'active'
          AND COALESCE(hidden, FALSE) = FALSE
          AND COALESCE(moderation_status, 'approved') = 'approved'
        RETURNING id, views, owner_id;
      `,
      [productId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        error: "Товар не найден"
      });
    }

    const fallbackClientKey = createHash("sha256")
      .update(`${req.ip || ""}|${req.headers["user-agent"] || ""}`)
      .digest("hex")
      .slice(0, 48);
    const clientKey = normalizeText(req.body?.clientKey, 120) || fallbackClientKey;
    await pool.query(
      `INSERT INTO product_view_events (id, product_id, owner_id, client_key)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (product_id, client_key, event_date) DO NOTHING`,
      [randomUUID(), result.rows[0].id, result.rows[0].owner_id, clientKey]
    ).catch(error => console.warn("Product analytics event failed:", error?.message || error));

    res.json({
      ok: true,
      product: { id: result.rows[0].id, views: Number(result.rows[0].views) || 0 }
    });
  } catch (error) {
    console.error("View product error:", error);

    res.status(500).json({
      ok: false,
      error: "Не удалось обновить просмотры"
    });
  }
});


app.post("/api/products/:id/engagement", async (req, res) => {
  try {
    const productId = normalizeText(req.params.id, 64);
    const eventType = normalizeText(req.body?.eventType, 30).toLowerCase();
    if (!productId || !["call_click", "message_click", "share_click"].includes(eventType)) {
      return res.status(400).json({ ok: false, error: "Некорректное событие" });
    }
    const productResult = await pool.query(`SELECT id, owner_id FROM products WHERE id=$1 AND COALESCE(status,'active')='active' AND COALESCE(hidden,FALSE)=FALSE`, [productId]);
    if (!productResult.rows.length) return res.status(404).json({ ok: false, error: "Объявление не найдено" });
    const fallbackClientKey = createHash("sha256").update(`${req.ip || ""}|${req.headers["user-agent"] || ""}`).digest("hex").slice(0, 48);
    const clientKey = normalizeText(req.body?.clientKey, 120) || fallbackClientKey;
    await pool.query(`
      INSERT INTO product_engagement_events (id, product_id, owner_id, event_type, client_key)
      VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (product_id,event_type,client_key,event_date) DO NOTHING
    `, [randomUUID(), productId, productResult.rows[0].owner_id, eventType, clientKey]);
    res.status(202).json({ ok: true });
  } catch (error) {
    console.warn("Product engagement analytics failed:", error?.message || error);
    res.status(202).json({ ok: true });
  }
});

app.patch("/api/products/:id/status", requireTelegramAuth, syncTelegramUser, async (req, res) => {
  const client = await pool.connect();
  try {
    const productId = normalizeText(req.params.id, 64);
    const status = normalizeProductStatus(req.body?.status, "");

    if (!productId || !["active", "sold", "draft", "archived"].includes(status)) {
      return res.status(400).json({
        ok: false,
        error: "Некорректный статус объявления"
      });
    }

    await client.query("BEGIN");
    const existingResult = await client.query(
      `SELECT * FROM products WHERE id = $1 AND owner_id = $2 AND COALESCE(status, 'active') <> 'deleted' FOR UPDATE`,
      [productId, req.telegramUser.id]
    );

    if (existingResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        ok: false,
        error: "Объявление не найдено или у вас нет прав"
      });
    }

    const existing = existingResult.rows[0];
    const currentStatus = existing.status || "active";

    if (currentStatus === "sold") {
      await client.query("ROLLBACK");
      return res.status(409).json({
        ok: false,
        error: "Проданное объявление окончательно закрыто и доступно только в истории"
      });
    }

    const statusFingerprint = existing.duplicate_fingerprint || buildDuplicateFingerprint({
      name: existing.name,
      priceAmount: existing.price_amount,
      category: existing.category,
      description: existing.description,
      images: normalizeImages(existing),
      location: existing.location,
      district: existing.district,
      specifications: existing.specifications
    });
    if (["active", "draft", "archived"].includes(status)) {
      const duplicate = await findDuplicateListing(client, req.telegramUser.id, statusFingerprint, productId);
      if (duplicate) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          ok: false,
          code: "DUPLICATE_LISTING",
          error: `Нельзя опубликовать дубликат объявления «${duplicate.name}».`,
          duplicateProductId: duplicate.id
        });
      }
    }

    let result;

    if (status === "sold") {
      if (currentStatus !== "active") {
        await client.query("ROLLBACK");
        return res.status(409).json({
          ok: false,
          error: "Отметить проданным можно только активное объявление"
        });
      }

      await client.query("DELETE FROM favorites WHERE product_id = $1", [productId]);
      await client.query("DELETE FROM product_images WHERE product_id = $1", [productId]);
      await client.query("DELETE FROM product_price_history WHERE product_id = $1", [productId]);
      await client.query("DELETE FROM reports WHERE product_id = $1", [productId]);
      await client.query("DELETE FROM product_feature_requests WHERE product_id = $1", [productId]);
      await client.query("DELETE FROM moderation_events WHERE product_id = $1", [productId]);
      await client.query(
        `UPDATE advertising_campaigns
         SET linked_product_id = '',
             status = CASE WHEN status = 'active' THEN 'paused' ELSE status END,
             updated_at = NOW()
         WHERE linked_product_id = $1`,
        [productId]
      );

      result = await client.query(
        `
          UPDATE products
          SET status = 'sold',
              hidden = TRUE,
              sold_at = COALESCE(sold_at, NOW()),
              media_purged_at = NOW(),
              image = '',
              thumbnail = '',
              images = '[]'::jsonb,
              description = '',
              phone = '',
              allow_messages = FALSE,
              district = '',
              specifications = '{}'::jsonb,
              previous_price = '',
              previous_price_amount = NULL,
              price_dropped_at = NULL,
              moderation_reason = '',
              moderation_matches = '[]'::jsonb,
              moderation_target_status = 'sold',
              featured_paid = FALSE,
              featured_until = NULL,
              duplicate_fingerprint = '',
              expires_at = NULL,
              archived_at = NULL,
              updated_at = NOW()
          WHERE id = $1 AND owner_id = $2
          RETURNING *;
        `,
        [productId, req.telegramUser.id]
      );
    } else {
      result = await client.query(
        `
          UPDATE products
          SET status = $3,
              duplicate_fingerprint = $5,
              published_at = CASE WHEN $3 = 'active' THEN NOW() ELSE published_at END,
              expires_at = CASE WHEN $3 = 'active' THEN NOW() + ($4::int * INTERVAL '1 day') ELSE expires_at END,
              archived_at = CASE WHEN $3 = 'archived' THEN NOW() WHEN $3 = 'active' THEN NULL ELSE archived_at END,
              updated_at = NOW()
          WHERE id = $1
            AND owner_id = $2
            AND COALESCE(status, 'active') NOT IN ('deleted', 'sold')
            AND ($3 <> 'active' OR COALESCE(moderation_status, 'approved') = 'approved')
          RETURNING *;
        `,
        [productId, req.telegramUser.id, status, PRODUCT_ARCHIVE_DAYS, statusFingerprint]
      );
    }

    if (result.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        ok: false,
        error: status === "active"
          ? "Объявление заблокировано модерацией или у вас нет прав"
          : "Объявление не найдено или у вас нет прав"
      });
    }

    await client.query("COMMIT");
    res.json({
      ok: true,
      product: mapProduct(result.rows[0])
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Update product status error:", error);
    if (error?.code === "23505" && String(error?.constraint || "").includes("duplicate_fingerprint")) {
      return res.status(409).json({ ok: false, code: "DUPLICATE_LISTING", error: "Такое объявление уже существует" });
    }
    res.status(500).json({
      ok: false,
      error: "Не удалось изменить статус объявления"
    });
  } finally {
    client.release();
  }
});

app.post("/api/products/:id/feature-request", requireTelegramAuth, syncTelegramUser, async (req, res) => {
  try {
    const productId = normalizeText(req.params.id, 64);
    const planId = normalizeText(req.body?.plan, 20).toLowerCase();
    const plan = PROMOTION_PLANS[planId] || PROMOTION_PLANS.vip;
    const days = plan.days;

    if (!productId) {
      return res.status(400).json({ ok: false, error: "Некорректный ID объявления" });
    }

    const color = FEATURE_COLOR;

    const productResult = await pool.query(
      `
        SELECT id, name
        FROM products
        WHERE id = $1
          AND owner_id = $2
          AND status = 'active'
          AND COALESCE(hidden, FALSE) = FALSE
          AND COALESCE(moderation_status, 'approved') = 'approved'
        LIMIT 1;
      `,
      [productId, req.telegramUser.id]
    );

    if (productResult.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        error: "Для выделения объявление должно быть активным и доступным покупателям"
      });
    }

    let requestResult = await pool.query(
      `
        UPDATE product_feature_requests
        SET color = $3,
            days = $4,
            price_amount = $5,
            plan = $6,
            updated_at = NOW()
        WHERE product_id = $1
          AND owner_id = $2
          AND status = 'pending'
        RETURNING *;
      `,
      [productId, req.telegramUser.id, color, days, plan.priceRub, plan.id]
    );

    if (requestResult.rows.length === 0) {
      requestResult = await pool.query(
        `
          INSERT INTO product_feature_requests (
            id, product_id, owner_id, color, days, price_amount, plan, status
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
          ON CONFLICT DO NOTHING
          RETURNING *;
        `,
        [randomUUID(), productId, req.telegramUser.id, color, days, plan.priceRub, plan.id]
      );

      if (requestResult.rows.length === 0) {
        requestResult = await pool.query(
          `SELECT * FROM product_feature_requests WHERE product_id = $1 AND owner_id = $2 AND status = 'pending' LIMIT 1`,
          [productId, req.telegramUser.id]
        );
      }
    }

    if (requestResult.rows.length === 0) {
      return res.status(409).json({ ok: false, error: "Заявка уже обрабатывается. Обновите страницу." });
    }

    res.status(201).json({
      ok: true,
      request: {
        id: requestResult.rows[0].id,
        productId,
        color,
        plan: requestResult.rows[0].plan || plan.id,
        days,
        priceAmount: Number(requestResult.rows[0].price_amount) || 0,
        status: requestResult.rows[0].status
      }
    });
  } catch (error) {
    console.error("Feature request error:", error);
    res.status(500).json({ ok: false, error: "Не удалось создать заявку на выделение" });
  }
});

app.delete("/api/products/:id", requireTelegramAuth, syncTelegramUser, async (req, res) => {
  try {
    const productId = normalizeText(req.params.id, 64);

    if (!productId) {
      return res.status(400).json({ ok: false, error: "Некорректный ID товара" });
    }

    const result = await pool.query(
      `
        UPDATE products
        SET status = 'deleted',
            hidden = TRUE,
            updated_at = NOW()
        WHERE id = $1
          AND owner_id = $2
          AND COALESCE(status, 'active') NOT IN ('deleted', 'sold')
        RETURNING id;
      `,
      [productId, req.telegramUser.id]
    );

    if (result.rows.length === 0) {
      return res.status(403).json({
        ok: false,
        error: "Проданные объявления не удаляются из истории; либо товар не найден"
      });
    }

    res.json({
      ok: true
    });
  } catch (error) {
    console.error("Delete product error:", error);

    res.status(500).json({
      ok: false,
      error: "Не удалось удалить объявление"
    });
  }
});

app.get("/api/favorites/ids", requireTelegramAuth, syncTelegramUser, async (req, res) => {
  try {
    const result = await pool.query(
      `
        SELECT f.product_id
        FROM favorites f
        JOIN products p ON p.id = f.product_id
        WHERE f.user_id = $1
          AND COALESCE(p.status, 'active') = 'active'
          AND COALESCE(p.hidden, FALSE) = FALSE
          AND COALESCE(p.moderation_status, 'approved') = 'approved';
      `,
      [req.telegramUser.id]
    );
    res.json({ ok: true, favorites: result.rows.map(row => row.product_id) });
  } catch (error) {
    console.error("Get favorite ids error:", error);
    res.status(500).json({ ok: false, error: "Не удалось получить избранное" });
  }
});

app.get("/api/favorites", requireTelegramAuth, syncTelegramUser, async (req, res) => {
  try {
    const result = await pool.query(
      `
        SELECT ${PRODUCT_SUMMARY_COLUMNS}
        FROM favorites f
        JOIN products p ON p.id = f.product_id
        WHERE f.user_id = $1
          AND COALESCE(p.status, 'active') = 'active'
          AND COALESCE(p.hidden, FALSE) = FALSE
          AND COALESCE(p.moderation_status, 'approved') = 'approved'
        ORDER BY f.created_at DESC
        LIMIT 100;
      `,
      [req.telegramUser.id]
    );

    const products = result.rows.map(mapProductSummary);
    res.json({ ok: true, favorites: products.map(product => product.id), products });
  } catch (error) {
    console.error("Get favorites error:", error);
    res.status(500).json({ ok: false, error: "Не удалось получить избранное" });
  }
});

app.post("/api/favorites", requireTelegramAuth, syncTelegramUser, async (req, res) => {
  try {
    const { productId } = req.body;

    if (!productId) {
      return res.status(400).json({
        ok: false,
        error: "productId is required"
      });
    }

    const exists = await pool.query(
      `
        SELECT 1
        FROM favorites
        WHERE user_id = $1 AND product_id = $2;
      `,
      [req.telegramUser.id, productId]
    );

    if (exists.rows.length > 0) {
      await pool.query(
        `
          DELETE FROM favorites
          WHERE user_id = $1 AND product_id = $2;
        `,
        [req.telegramUser.id, productId]
      );

      return res.json({
        ok: true,
        isFavorite: false
      });
    }

    const productResult = await pool.query(
      `
        SELECT 1
        FROM products
        WHERE id = $1
          AND COALESCE(status, 'active') = 'active'
          AND COALESCE(hidden, FALSE) = FALSE
          AND COALESCE(moderation_status, 'approved') = 'approved';
      `,
      [productId]
    );

    if (productResult.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        error: "Товар не найден или недоступен"
      });
    }

    await pool.query(
      `
        INSERT INTO favorites (user_id, product_id)
        VALUES ($1, $2);
      `,
      [req.telegramUser.id, productId]
    );

    res.json({
      ok: true,
      isFavorite: true
    });
  } catch (error) {
    console.error("Toggle favorite error:", error);

    if (error?.code === "23503") {
      return res.status(404).json({
        ok: false,
        error: "Товар не найден"
      });
    }

    res.status(500).json({
      ok: false,
      error: "Не удалось обновить избранное"
    });
  }
});




app.get("/api/saved-searches", requireTelegramAuth, syncTelegramUser, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, search_query, category, filters, created_at, updated_at
       FROM saved_searches
       WHERE user_id = $1
       ORDER BY updated_at DESC
       LIMIT 20`,
      [String(req.telegramUser.id)]
    );
    res.setHeader("Cache-Control", "no-store");
    res.json({ ok: true, savedSearches: result.rows.map(mapSavedSearch) });
  } catch (error) {
    console.error("Get saved searches error:", error);
    res.status(500).json({ ok: false, error: "Не удалось загрузить сохранённые поиски" });
  }
});

app.post("/api/saved-searches", requireTelegramAuth, syncTelegramUser, async (req, res) => {
  try {
    const search = normalizeText(req.body?.search, 100);
    const requestedCategory = normalizeText(req.body?.category, 60) || "Все";
    const category = requestedCategory === "Все" || PRODUCT_CATEGORIES.has(requestedCategory)
      ? requestedCategory
      : "Все";
    const filters = normalizeSavedSearchFilters(req.body?.filters);
    const hasFilters = Object.entries(filters).some(([key, value]) => key === "sort" ? value !== "newest" : Boolean(value));
    if (!search && category === "Все" && !hasFilters) {
      return res.status(400).json({ ok: false, error: "Сначала задайте запрос, категорию или фильтры" });
    }

    const defaultName = search || (category !== "Все" ? category : "Поиск с фильтрами");
    const name = normalizeText(req.body?.name, 80) || defaultName;
    const searchKey = buildSavedSearchKey(search, category, filters);
    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS count FROM saved_searches WHERE user_id = $1`,
      [String(req.telegramUser.id)]
    );
    const existingResult = await pool.query(
      `SELECT id FROM saved_searches WHERE user_id = $1 AND search_key = $2 LIMIT 1`,
      [String(req.telegramUser.id), searchKey]
    );
    if (Number(countResult.rows[0]?.count) >= 20 && existingResult.rows.length === 0) {
      return res.status(409).json({ ok: false, code: "SAVED_SEARCH_LIMIT", error: "Можно сохранить не более 20 поисков" });
    }

    const result = await pool.query(
      `INSERT INTO saved_searches (id, user_id, name, search_query, category, filters, search_key)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
       ON CONFLICT (user_id, search_key)
       DO UPDATE SET name = EXCLUDED.name, updated_at = NOW()
       RETURNING id, name, search_query, category, filters, created_at, updated_at`,
      [randomUUID(), String(req.telegramUser.id), name, search, category, JSON.stringify(filters), searchKey]
    );
    res.status(existingResult.rows.length ? 200 : 201).json({ ok: true, savedSearch: mapSavedSearch(result.rows[0]) });
  } catch (error) {
    console.error("Save search error:", error);
    res.status(500).json({ ok: false, error: "Не удалось сохранить поиск" });
  }
});

app.delete("/api/saved-searches/:id", requireTelegramAuth, syncTelegramUser, async (req, res) => {
  try {
    const id = normalizeText(req.params.id, 64);
    const result = await pool.query(
      `DELETE FROM saved_searches WHERE id = $1 AND user_id = $2 RETURNING id`,
      [id, String(req.telegramUser.id)]
    );
    if (result.rows.length === 0) return res.status(404).json({ ok: false, error: "Поиск не найден" });
    res.json({ ok: true, deletedId: id });
  } catch (error) {
    console.error("Delete saved search error:", error);
    res.status(500).json({ ok: false, error: "Не удалось удалить сохранённый поиск" });
  }
});

app.get("/api/users/:id/reviews", async (req, res) => {
  try {
    const sellerId = normalizeText(req.params.id, 64);
    if (!sellerId) return res.status(400).json({ ok: false, error: "Некорректный ID продавца" });
    const [reviewsResult, trust] = await Promise.all([
      pool.query(
        `SELECT sr.id, sr.rating, sr.comment, sr.created_at, sr.updated_at,
                COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''),
                         CASE WHEN COALESCE(u.username, '') <> '' THEN '@' || u.username ELSE NULL END,
                         'Покупатель') AS reviewer_name
         FROM seller_reviews sr
         LEFT JOIN users u ON u.telegram_id = sr.reviewer_id
         WHERE sr.seller_id = $1
         ORDER BY sr.updated_at DESC
         LIMIT 30`,
        [sellerId]
      ),
      getSellerTrust(pool, sellerId)
    ]);
    res.json({ ok: true, reviews: reviewsResult.rows.map(mapSellerReview), trust });
  } catch (error) {
    console.error("Get seller reviews error:", error);
    res.status(500).json({ ok: false, error: "Не удалось загрузить отзывы" });
  }
});

app.post("/api/users/:id/reviews", requireTelegramAuth, syncTelegramUser, async (req, res) => {
  try {
    const sellerId = normalizeText(req.params.id, 64);
    const reviewerId = String(req.telegramUser.id);
    const rating = Number.parseInt(String(req.body?.rating || ""), 10);
    const comment = normalizeText(req.body?.comment, 800);
    if (!sellerId || !Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({ ok: false, error: "Выберите оценку от 1 до 5" });
    }
    if (sellerId === reviewerId) {
      return res.status(400).json({ ok: false, code: "SELF_REVIEW", error: "Нельзя оценивать собственный профиль" });
    }
    const sellerExists = await pool.query(
      `SELECT 1 FROM users WHERE telegram_id = $1
       UNION ALL
       SELECT 1 FROM products WHERE owner_id = $1 LIMIT 1`,
      [sellerId]
    );
    if (sellerExists.rows.length === 0) return res.status(404).json({ ok: false, error: "Продавец не найден" });

    const result = await pool.query(
      `INSERT INTO seller_reviews (id, seller_id, reviewer_id, rating, comment)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (seller_id, reviewer_id)
       DO UPDATE SET rating = EXCLUDED.rating, comment = EXCLUDED.comment, updated_at = NOW()
       RETURNING id, rating, comment, created_at, updated_at`,
      [randomUUID(), sellerId, reviewerId, rating, comment]
    );
    const trust = await getSellerTrust(pool, sellerId);
    res.json({ ok: true, review: mapSellerReview({ ...result.rows[0], reviewer_name: getTelegramDisplayName(req.telegramUser) || "Вы" }), trust });
  } catch (error) {
    console.error("Save seller review error:", error);
    res.status(500).json({ ok: false, error: "Не удалось сохранить оценку" });
  }
});

app.delete("/api/users/:id/reviews/mine", requireTelegramAuth, syncTelegramUser, async (req, res) => {
  try {
    const sellerId = normalizeText(req.params.id, 64);
    const result = await pool.query(
      `DELETE FROM seller_reviews WHERE seller_id = $1 AND reviewer_id = $2 RETURNING id`,
      [sellerId, String(req.telegramUser.id)]
    );
    if (result.rows.length === 0) return res.status(404).json({ ok: false, error: "Ваша оценка не найдена" });
    const trust = await getSellerTrust(pool, sellerId);
    res.json({ ok: true, trust });
  } catch (error) {
    console.error("Delete seller review error:", error);
    res.status(500).json({ ok: false, error: "Не удалось удалить оценку" });
  }
});

app.get("/api/ads", async (req, res) => {
  try {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    const requestedPlacement = normalizeText(req.query.placement, 30);
    const values = [];
    const conditions = [
      "LOWER(TRIM(COALESCE(status, ''))) = 'active'",
      "(starts_at IS NULL OR starts_at <= NOW())",
      "(ends_at IS NULL OR ends_at >= NOW())",
      "(COALESCE(max_impressions, 0) = 0 OR COALESCE(impressions, 0) < COALESCE(max_impressions, 0))"
    ];

    if (AD_PLACEMENTS.has(requestedPlacement)) {
      values.push(requestedPlacement);
      conditions.push(`placement = $${values.length}`);
    }

    const result = await pool.query(
      `
        SELECT * FROM advertising_campaigns
        WHERE ${conditions.join(" AND ")}
        ORDER BY priority DESC, created_at DESC
        LIMIT 20;
      `,
      values
    );

    res.json({ ok: true, ads: result.rows.map(mapPublicAdCampaign) });
  } catch (error) {
    console.error("Get ads error:", error);
    res.status(500).json({ ok: false, error: "Не удалось загрузить рекламу" });
  }
});

app.get("/api/ads/:id/image", async (req, res) => {
  try {
    const adId = normalizeText(req.params.id, 64);
    const result = await pool.query(
      `
        SELECT id, image_url, updated_at, created_at
        FROM advertising_campaigns
        WHERE id = $1
          AND LOWER(TRIM(COALESCE(status, ''))) = 'active'
          AND (starts_at IS NULL OR starts_at <= NOW())
          AND (ends_at IS NULL OR ends_at >= NOW())
        LIMIT 1;
      `,
      [adId]
    );

    if (!result.rows.length) {
      return res.status(404).end();
    }

    const parsed = parseStoredDataImage(result.rows[0].image_url);
    if (!parsed) {
      return res.status(404).end();
    }

    res.set("Content-Type", parsed.contentType);
    res.set("Content-Length", String(parsed.buffer.length));
    res.set("Cache-Control", "public, max-age=86400, immutable");
    res.set("X-Content-Type-Options", "nosniff");
    return res.send(parsed.buffer);
  } catch (error) {
    console.error("Get ad image error:", error);
    return res.status(500).end();
  }
});

app.post("/api/ads/:id/impression", async (req, res) => {
  try {
    const recorded = await recordAdEvent(req.params.id, "impression", req.body?.clientKey);
    res.json({ ok: true, recorded });
  } catch (error) {
    console.error("Ad impression error:", error);
    res.status(500).json({ ok: false, error: "Не удалось учесть показ" });
  }
});

app.post("/api/ads/:id/click", async (req, res) => {
  try {
    const recorded = await recordAdEvent(req.params.id, "click", req.body?.clientKey);
    res.json({ ok: true, recorded });
  } catch (error) {
    console.error("Ad click error:", error);
    res.status(500).json({ ok: false, error: "Не удалось учесть переход" });
  }
});

app.post("/api/products/:id/reports", requireTelegramAuth, syncTelegramUser, async (req, res) => {
  try {
    const productId = normalizeText(req.params.id, 64);
    const reason = normalizeText(req.body?.reason, 40).toLowerCase();
    const details = normalizeText(req.body?.details, 1000);

    if (!productId || !REPORT_REASONS.has(reason)) {
      return res.status(400).json({ ok: false, error: "Выберите корректную причину жалобы" });
    }

    if (reason === "other" && details.length < 10) {
      return res.status(400).json({ ok: false, error: "Опишите причину жалобы подробнее" });
    }

    const productResult = await pool.query(
      `
        SELECT id, owner_id
        FROM products
        WHERE id = $1
          AND COALESCE(status, 'active') = 'active'
          AND COALESCE(hidden, FALSE) = FALSE
          AND COALESCE(moderation_status, 'approved') = 'approved';
      `,
      [productId]
    );

    if (productResult.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "Объявление не найдено" });
    }

    if (String(productResult.rows[0].owner_id) === String(req.telegramUser.id)) {
      return res.status(400).json({ ok: false, error: "Нельзя пожаловаться на своё объявление" });
    }

    const duplicate = await pool.query(
      `
        SELECT id
        FROM reports
        WHERE product_id = $1 AND reporter_id = $2 AND status = 'pending'
        LIMIT 1;
      `,
      [productId, req.telegramUser.id]
    );

    if (duplicate.rows.length > 0) {
      return res.status(409).json({ ok: false, error: "Ваша жалоба уже находится на рассмотрении" });
    }

    const result = await pool.query(
      `
        INSERT INTO reports (id, product_id, reporter_id, reason, details)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, status, created_at;
      `,
      [randomUUID(), productId, req.telegramUser.id, reason, details]
    );

    res.status(201).json({ ok: true, report: result.rows[0] });
  } catch (error) {
    console.error("Create report error:", error);

    if (error?.code === "23505") {
      return res.status(409).json({ ok: false, error: "Ваша жалоба уже находится на рассмотрении" });
    }

    res.status(500).json({ ok: false, error: "Не удалось отправить жалобу" });
  }
});

// Admin dashboard
const ADMIN_IDS = String(process.env.ADMIN_TELEGRAM_IDS || "")
  .split(",")
  .map(value => value.trim())
  .filter(Boolean);

function requireAdmin(req, res, next) {
  const id = String(req.telegramUser?.id || "");

  if (!ADMIN_IDS.includes(id)) {
    recordSecurityEvent(req, "admin_access_denied", "high", { telegramId: id }).catch(() => {});
    return res.status(403).json({ ok: false, error: "Доступ запрещён" });
  }

  if (ADMIN_ACCESS_CODE_SHA256) {
    const now = Date.now();
    const failure = adminSecondFactorFailures.get(id);
    if (failure?.lockedUntil > now) {
      res.setHeader("Retry-After", String(Math.max(1, Math.ceil((failure.lockedUntil - now) / 1000))));
      return res.status(429).json({ ok: false, code: "ADMIN_SECOND_FACTOR_LOCKED", error: "Слишком много неверных попыток. Повторите позже" });
    }
    const supplied = String(req.headers["x-admin-access-code"] || "");
    const suppliedHash = createHash("sha256").update(supplied).digest("hex");
    const expected = Buffer.from(ADMIN_ACCESS_CODE_SHA256, "hex");
    const actual = Buffer.from(suppliedHash, "hex");
    const valid = expected.length === actual.length && expected.length === 32 && timingSafeEqual(expected, actual);
    if (!valid) {
      const attempts = (failure?.attempts || 0) + 1;
      const lockedUntil = attempts >= ADMIN_SECOND_FACTOR_MAX_FAILURES
        ? now + ADMIN_SECOND_FACTOR_LOCK_MINUTES * 60_000
        : 0;
      adminSecondFactorFailures.set(id, { attempts: lockedUntil ? 0 : attempts, lockedUntil });
      recordSecurityEvent(req, "admin_second_factor_failed", "high", { telegramId: id, locked: Boolean(lockedUntil) }).catch(() => {});
      return res.status(401).json({ ok: false, code: "ADMIN_SECOND_FACTOR_REQUIRED", error: "Требуется код дополнительной защиты администратора" });
    }
    adminSecondFactorFailures.delete(id);
  }

  res.setHeader("Cache-Control", "no-store");
  next();
}

function adminRoute(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      console.error(`Admin route ${req.method} ${req.path}:`, error);

      if (!res.headersSent) {
        res.status(500).json({
          ok: false,
          error: "Ошибка админ-панели"
        });
      }
    }
  };
}

async function addAdminLog(adminId, action, target = "", details = "", database = pool) {
  await database.query(
    `
      INSERT INTO admin_logs (id, admin_id, action, target, details)
      VALUES ($1, $2, $3, $4, $5);
    `,
    [randomUUID(), String(adminId), action, String(target), String(details)]
  );
}

app.get(
  "/api/admin/stats",
  requireTelegramAuth,
  syncTelegramUser,
  requireAdmin,
  adminRoute(async (req, res) => {
    const [users, products, hidden, banned, pendingReports, pendingModeration, pendingFeatureRequests, activeAds, adRevenue, promotionRevenue, newUsersToday, newProductsToday] =
      await Promise.all([
        pool.query("SELECT COUNT(*)::int AS count FROM users"),
        pool.query(
          "SELECT COUNT(*)::int AS count FROM products WHERE COALESCE(status, 'active') <> 'deleted'"
        ),
        pool.query(
          "SELECT COUNT(*)::int AS count FROM products WHERE COALESCE(hidden, FALSE) = TRUE AND COALESCE(status, 'active') <> 'deleted'"
        ),
        pool.query(
          "SELECT COUNT(*)::int AS count FROM users WHERE COALESCE(banned, FALSE) = TRUE"
        ),
        pool.query(
          "SELECT COUNT(*)::int AS count FROM reports WHERE status = 'pending'"
        ),
        pool.query(
          "SELECT COUNT(*)::int AS count FROM moderation_events WHERE status = 'pending'"
        ),
        pool.query(
          "SELECT COUNT(*)::int AS count FROM product_feature_requests WHERE status = 'pending'"
        ),
        pool.query(
          "SELECT COUNT(*)::int AS count FROM advertising_campaigns WHERE status = 'active' AND (ends_at IS NULL OR ends_at >= NOW())"
        ),
        pool.query(`
          SELECT COALESCE(SUM(CASE
            WHEN billing_model = 'cpm' THEN (COALESCE(impressions,0)::numeric / 1000) * COALESCE(rate_amount,0)
            WHEN billing_model = 'cpc' THEN COALESCE(clicks,0)::numeric * COALESCE(rate_amount,0)
            ELSE COALESCE(rate_amount,0)
          END), 0)::numeric(14,2) AS amount
          FROM advertising_campaigns
        `),
        pool.query("SELECT COALESCE(SUM(amount),0)::numeric(14,2) AS amount FROM payment_orders WHERE status='succeeded'"),
        pool.query(
          "SELECT COUNT(*)::int AS count FROM users WHERE created_at >= CURRENT_DATE"
        ),
        pool.query(
          "SELECT COUNT(*)::int AS count FROM products WHERE created_at >= CURRENT_DATE AND COALESCE(status, 'active') <> 'deleted'"
        )
      ]);

    res.json({
      ok: true,
      users: users.rows[0].count,
      products: products.rows[0].count,
      hidden: hidden.rows[0].count,
      banned: banned.rows[0].count,
      pendingReports: pendingReports.rows[0].count,
      pendingModeration: pendingModeration.rows[0].count,
      pendingFeatureRequests: pendingFeatureRequests.rows[0].count,
      activeAds: activeAds.rows[0].count,
      adRevenue: Number(adRevenue.rows[0].amount) || 0,
      promotionRevenue: Number(promotionRevenue.rows[0].amount) || 0,
      newUsersToday: newUsersToday.rows[0].count,
      newProductsToday: newProductsToday.rows[0].count
    });
  })
);


app.get(
  "/api/admin/monetization",
  requireTelegramAuth,
  syncTelegramUser,
  requireAdmin,
  adminRoute(async (req, res) => {
    const settings = await getMonetizationSettings(pool);
    res.json({
      ok: true,
      paidListingEnabled: settings,
      paidListingPrices: PAID_LISTING_PRICES,
      professionalSubscription: {
        alwaysPaid: true,
        priceRub: PROFESSIONAL_SUBSCRIPTION_PRICE_RUB,
        days: PROFESSIONAL_SUBSCRIPTION_DAYS,
        unlimitedListings: true
      }
    });
  })
);

app.patch(
  "/api/admin/monetization",
  requireTelegramAuth,
  syncTelegramUser,
  requireAdmin,
  adminRoute(async (req, res) => {
    const automobile = req.body?.automobile === true;
    const vacancy = req.body?.vacancy === true;
    const apartment = req.body?.apartment === true;
    const house = req.body?.house === true;
    const land = req.body?.land === true;
    const result = await pool.query(`
      UPDATE monetization_settings
      SET automobile_paid=$1, vacancy_paid=$2, apartment_paid=$3, house_paid=$4, land_paid=$5,
          updated_at=NOW(), updated_by=$6
      WHERE id=TRUE
      RETURNING automobile_paid, vacancy_paid, apartment_paid, house_paid, land_paid
    `, [automobile, vacancy, apartment, house, land, String(req.telegramUser.id)]);
    await addAdminLog(req.telegramUser.id, "monetization_settings_update", "settings", JSON.stringify(result.rows[0] || {}));
    res.json({ ok: true, paidListingEnabled: await getMonetizationSettings(pool) });
  })
);


app.get(
  "/api/admin/system-health",
  requireTelegramAuth,
  syncTelegramUser,
  requireAdmin,
  adminRoute(async (req, res) => {
    let databaseLatencyMs = null;
    try {
      const started = Date.now();
      await pool.query("SELECT 1");
      databaseLatencyMs = Date.now() - started;
    } catch {}
    const memory = process.memoryUsage();
    res.json({
      ok: true,
      version: APP_VERSION,
      uptimeSeconds: Math.floor(process.uptime()),
      database: databaseState.ready ? "ready" : "unavailable",
      databaseLatencyMs,
      requests: runtimeMetrics.requests,
      responses5xx: runtimeMetrics.responses5xx,
      slowRequests: runtimeMetrics.slowRequests,
      averageDurationMs: runtimeMetrics.requests ? Number((runtimeMetrics.totalDurationMs / runtimeMetrics.requests).toFixed(1)) : 0,
      maxDurationMs: runtimeMetrics.maxDurationMs,
      memoryMb: {
        rss: Number((memory.rss / 1024 / 1024).toFixed(1)),
        heapUsed: Number((memory.heapUsed / 1024 / 1024).toFixed(1))
      },
      paymentsConfigured: isYooKassaConfigured(),
      aiConfigured: Boolean(OPENAI_API_KEY),
      autoBackupEnabled: AUTO_BACKUP_ENABLED,
      backupRetentionCount: BACKUP_RETENTION_COUNT
    });
  })
);

app.all(
  ["/api/admin/business-verifications", "/api/admin/business-verifications/:id"],
  requireTelegramAuth,
  syncTelegramUser,
  requireAdmin,
  (req, res) => res.status(410).json({ ok: false, code: "BUSINESS_VERIFICATION_REMOVED", error: "Верификация бизнеса больше не используется" })
);

app.post(
  "/api/admin/backups",
  requireTelegramAuth,
  syncTelegramUser,
  requireAdmin,
  adminRoute(async (req, res) => {
    const result = await createDatabaseBackup(pool, { backupDir: BACKUP_DIR, retention: BACKUP_RETENTION_COUNT, appVersion: APP_VERSION });
    await addAdminLog(req.telegramUser.id, "database_backup_create", result.filename || "backup", `${result.bytes || 0} bytes; sha256=${result.checksum || ""}`);
    res.json({ ok: true, backup: { filename: result.filename, bytes: result.bytes, checksum: result.checksum, rowCounts: result.rowCounts } });
  })
);

app.get(
  "/api/admin/feature-requests",
  requireTelegramAuth,
  syncTelegramUser,
  requireAdmin,
  adminRoute(async (req, res) => {
    const requestedStatus = normalizeText(req.query.status, 20).toLowerCase();
    const allowedStatuses = new Set(["pending", "approved", "rejected"]);
    const status = allowedStatuses.has(requestedStatus) ? requestedStatus : "pending";

    const result = await pool.query(
      `
        SELECT
          pfr.id,
          pfr.product_id,
          pfr.owner_id,
          pfr.color,
          pfr.plan,
          pfr.days,
          pfr.price_amount,
          pfr.status,
          pfr.created_at,
          pfr.updated_at,
          pfr.reviewed_by,
          pfr.reviewed_at,
          pfr.admin_note,
          p.name AS product_name,
          p.price AS product_price,
          p.category AS product_category,
          p.status AS product_status,
          p.hidden AS product_hidden,
          p.moderation_status AS product_moderation_status,
          p.updated_at AS product_updated_at,
          p.owner_name,
          p.owner_username,
          u.username AS user_username,
          u.first_name AS user_first_name,
          u.last_name AS user_last_name,
          u.avatar AS user_avatar
        FROM product_feature_requests pfr
        JOIN products p ON p.id = pfr.product_id
        LEFT JOIN users u ON u.telegram_id = pfr.owner_id
        WHERE pfr.status = $1
        ORDER BY pfr.created_at ASC
        LIMIT 200;
      `,
      [status]
    );

    res.json({
      ok: true,
      status,
      requests: result.rows.map(row => ({
        id: row.id,
        productId: row.product_id,
        productName: row.product_name || "Без названия",
        productPrice: row.product_price || "0",
        productCategory: row.product_category || "Без категории",
        productStatus: row.product_status || "active",
        productHidden: Boolean(row.product_hidden),
        productModerationStatus: row.product_moderation_status || "approved",
        productUpdatedAt: row.product_updated_at,
        ownerId: row.owner_id,
        ownerName: [row.user_first_name, row.user_last_name].filter(Boolean).join(" ") || row.owner_name || "Пользователь",
        ownerUsername: row.user_username || row.owner_username || "",
        ownerAvatar: row.user_avatar || "",
        color: FEATURE_COLOR,
        plan: PROMOTION_PLANS[row.plan] ? row.plan : "vip",
        days: Math.max(1, Number(row.days) || FEATURE_HIGHLIGHT_DAYS),
        priceAmount: Number(row.price_amount) || 0,
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        reviewedBy: row.reviewed_by || "",
        reviewedAt: row.reviewed_at,
        adminNote: row.admin_note || ""
      }))
    });
  })
);

app.patch(
  "/api/admin/feature-requests/:id",
  requireTelegramAuth,
  syncTelegramUser,
  requireAdmin,
  adminRoute(async (req, res) => {
    const requestId = normalizeText(req.params.id, 64);
    const decision = normalizeText(req.body?.decision, 20).toLowerCase();
    const adminNote = normalizeText(req.body?.adminNote, 500);

    if (!requestId || !["approve", "reject"].includes(decision)) {
      return res.status(400).json({ ok: false, error: "Некорректное решение по заявке" });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const requestResult = await client.query(
        `
          SELECT *
          FROM product_feature_requests
          WHERE id = $1
          FOR UPDATE;
        `,
        [requestId]
      );

      if (requestResult.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ ok: false, error: "Заявка не найдена" });
      }

      const featureRequest = requestResult.rows[0];
      if (featureRequest.status !== "pending") {
        await client.query("ROLLBACK");
        return res.status(409).json({ ok: false, error: "Эта заявка уже обработана" });
      }

      const productResult = await client.query(
        `
          SELECT id, name, status, hidden, moderation_status
          FROM products
          WHERE id = $1
          FOR UPDATE;
        `,
        [featureRequest.product_id]
      );

      if (productResult.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ ok: false, error: "Объявление из заявки не найдено" });
      }

      const product = productResult.rows[0];
      if (
        decision === "approve" &&
        (product.status !== "active" || product.hidden || (product.moderation_status || "approved") !== "approved")
      ) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          ok: false,
          error: "Объявление нельзя выделить: оно скрыто, неактивно или заблокировано"
        });
      }

      if (decision === "approve") {
        const selectedPlan = PROMOTION_PLANS[featureRequest.plan] || PROMOTION_PLANS.vip;
        const days = Math.max(1, Math.min(90, Number(featureRequest.days) || selectedPlan.days));
        const color = FEATURE_COLOR;
        const featuredUntil = new Date(Date.now() + days * 86_400_000);

        await client.query(
          `
            UPDATE products
            SET featured_paid = TRUE,
                featured_color = $2,
                featured_until = $3,
                promotion_plan = $4,
                promotion_priority = $5,
                updated_at = NOW()
            WHERE id = $1;
          `,
          [featureRequest.product_id, color, featuredUntil, selectedPlan.id, selectedPlan.priority]
        );

        await client.query(
          `
            UPDATE product_feature_requests
            SET status = 'approved',
                approved_by = $2,
                approved_at = NOW(),
                reviewed_by = $2,
                reviewed_at = NOW(),
                admin_note = $3,
                updated_at = NOW()
            WHERE id = $1;
          `,
          [requestId, req.telegramUser.id, adminNote]
        );
      } else {
        await client.query(
          `
            UPDATE product_feature_requests
            SET status = 'rejected',
                reviewed_by = $2,
                reviewed_at = NOW(),
                admin_note = $3,
                updated_at = NOW()
            WHERE id = $1;
          `,
          [requestId, req.telegramUser.id, adminNote]
        );
      }

      await addAdminLog(
        req.telegramUser.id,
        decision === "approve" ? "approve_feature_request" : "reject_feature_request",
        featureRequest.product_id,
        `${product.name}; заявитель ${featureRequest.owner_id}; заявка ${requestId}${adminNote ? `; ${adminNote}` : ""}`,
        client
      );

      await client.query("COMMIT");
      res.json({ ok: true, decision, requestId, productId: featureRequest.product_id });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  })
);

app.get(
  "/api/admin/products",
  requireTelegramAuth,
  syncTelegramUser,
  requireAdmin,
  adminRoute(async (req, res) => {
    const result = await pool.query(`
      SELECT
        id,
        owner_id,
        name,
        price,
        category,
        owner_name,
        owner_username,
        created_at,
        views,
        hidden,
        status,
        moderation_status,
        moderation_reason,
        previous_price,
        price_dropped_at,
        archived_at,
        expires_at,
        featured_until,
        featured_color,
        featured_paid,
        (SELECT COUNT(*)::int FROM reports r WHERE r.product_id = products.id AND r.status = 'pending') AS report_count,
        (SELECT COUNT(*)::int FROM product_feature_requests pfr WHERE pfr.product_id = products.id AND pfr.status = 'pending') AS pending_feature_requests
      FROM products
      WHERE COALESCE(status, 'active') NOT IN ('deleted', 'sold')
      ORDER BY created_at DESC
      LIMIT 100;
    `);

    res.json({
      ok: true,
      products: result.rows
    });
  })
);

app.patch(
  "/api/admin/products/:id/hide",
  requireTelegramAuth,
  syncTelegramUser,
  requireAdmin,
  adminRoute(async (req, res) => {
    const productId = normalizeText(req.params.id, 64);
    const result = await pool.query(
      `
        UPDATE products
        SET hidden = CASE
              WHEN COALESCE(moderation_status, 'approved') = 'blocked' THEN TRUE
              ELSE NOT COALESCE(hidden, FALSE)
            END,
            updated_at = NOW()
        WHERE id = $1
          AND COALESCE(status, 'active') NOT IN ('deleted', 'sold')
        RETURNING id, name, hidden, moderation_status;
      `,
      [productId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        error: "Объявление не найдено"
      });
    }

    const product = result.rows[0];
    await addAdminLog(
      req.telegramUser.id,
      product.hidden ? "hide_product" : "show_product",
      product.id,
      product.name
    );

    res.json({
      ok: true,
      product
    });
  })
);

app.patch(
  "/api/admin/products/:id/feature",
  requireTelegramAuth,
  syncTelegramUser,
  requireAdmin,
  adminRoute(async (req, res) => {
    const productId = normalizeText(req.params.id, 64);
    const enabled = normalizeBoolean(req.body?.enabled);
    const days = Math.max(1, Math.min(90, Number(req.body?.days) || FEATURE_HIGHLIGHT_DAYS));
    const color = FEATURE_COLOR;
    const featuredUntil = enabled ? new Date(Date.now() + days * 86_400_000) : null;

    const result = await pool.query(
      `
        UPDATE products
        SET featured_paid = $2,
            featured_color = $3,
            featured_until = $4,
            updated_at = NOW()
        WHERE id = $1
          AND COALESCE(status, 'active') NOT IN ('deleted', 'sold')
          AND (
            $2 = FALSE
            OR (
              status = 'active'
              AND COALESCE(hidden, FALSE) = FALSE
              AND COALESCE(moderation_status, 'approved') = 'approved'
            )
          )
        RETURNING id, name, featured_paid, featured_color, featured_until;
      `,
      [productId, enabled, color, featuredUntil]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "Объявление не найдено" });
    }

    await addAdminLog(
      req.telegramUser.id,
      enabled ? "feature_product" : "unfeature_product",
      productId,
      `${result.rows[0].name}; ${enabled ? `${days} дн., ${color}` : "выделение снято"}`
    );

    res.json({ ok: true, product: result.rows[0] });
  })
);

app.post(
  "/api/admin/users/:id/ban",
  requireTelegramAuth,
  syncTelegramUser,
  requireAdmin,
  adminRoute(async (req, res) => {
    const userId = normalizeText(req.params.id, 64);

    if (ADMIN_IDS.includes(userId)) {
      return res.status(400).json({
        ok: false,
        error: "Администратора нельзя заблокировать"
      });
    }

    const result = await pool.query(
      `
        UPDATE users
        SET banned = NOT COALESCE(banned, FALSE)
        WHERE telegram_id = $1
        RETURNING telegram_id, username, first_name, banned;
      `,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        error: "Пользователь не найден"
      });
    }

    const user = result.rows[0];
    await addAdminLog(
      req.telegramUser.id,
      user.banned ? "ban_user" : "unban_user",
      user.telegram_id,
      user.username || user.first_name || ""
    );

    res.json({
      ok: true,
      user
    });
  })
);

app.patch(
  "/api/admin/users/:id/listing-limit",
  requireTelegramAuth,
  syncTelegramUser,
  requireAdmin,
  adminRoute(async (req, res) => {
    const userId = normalizeText(req.params.id, 64);
    const requestedLimit = Number.parseInt(String(req.body?.limit ?? ""), 10);

    if (!userId || !Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > MAX_LISTING_LIMIT) {
      return res.status(400).json({
        ok: false,
        error: `Лимит должен быть от 1 до ${MAX_LISTING_LIMIT}`
      });
    }

    const result = await pool.query(
      `UPDATE users
       SET listing_limit = $2,
           updated_at = NOW()
       WHERE telegram_id = $1
       RETURNING telegram_id, username, first_name, last_name, listing_limit, professional_subscription_until`,
      [userId, requestedLimit]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "Пользователь не найден" });
    }

    await addAdminLog(
      req.telegramUser.id,
      "set_listing_limit",
      userId,
      `Индивидуальный лимит объявлений: ${requestedLimit}`
    );

    const user = result.rows[0];
    res.json({
      ok: true,
      user: {
        ...user,
        effective_listing_limit: isProfessionalSubscriptionActive(user) ? null : requestedLimit
      }
    });
  })
);

app.get(
  "/api/admin/reports",
  requireTelegramAuth,
  syncTelegramUser,
  requireAdmin,
  adminRoute(async (req, res) => {
    const requestedStatus = normalizeText(req.query.status, 20).toLowerCase();
    const status = REPORT_STATUSES.has(requestedStatus) ? requestedStatus : "pending";
    const result = await pool.query(
      `
        SELECT
          r.id,
          r.product_id,
          r.reporter_id,
          r.reason,
          r.details,
          r.status,
          r.admin_note,
          r.reviewed_by,
          r.created_at,
          r.updated_at,
          p.name AS product_name,
          p.owner_id,
          p.owner_name,
          p.hidden AS product_hidden,
          u.username AS reporter_username
        FROM reports r
        JOIN products p ON p.id = r.product_id
        LEFT JOIN users u ON u.telegram_id = r.reporter_id
        WHERE r.status = $1
        ORDER BY r.created_at DESC
        LIMIT 100;
      `,
      [status]
    );

    res.json({ ok: true, reports: result.rows, status });
  })
);

app.patch(
  "/api/admin/reports/:id",
  requireTelegramAuth,
  syncTelegramUser,
  requireAdmin,
  adminRoute(async (req, res) => {
    const reportId = normalizeText(req.params.id, 64);
    const decision = normalizeText(req.body?.decision, 20).toLowerCase();
    const action = normalizeText(req.body?.action, 30).toLowerCase() || "no_action";
    const adminNote = normalizeText(req.body?.adminNote, 1000);

    if (!reportId || !["resolved", "rejected"].includes(decision) || !MODERATION_ACTIONS.has(action)) {
      return res.status(400).json({ ok: false, error: "Некорректное решение по жалобе" });
    }

    const client = await pool.connect();
    let report;

    try {
      await client.query("BEGIN");
      const reportResult = await client.query(
        `
          SELECT r.*, p.owner_id, p.name AS product_name
          FROM reports r
          JOIN products p ON p.id = r.product_id
          WHERE r.id = $1
          FOR UPDATE;
        `,
        [reportId]
      );

      if (reportResult.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ ok: false, error: "Жалоба не найдена" });
      }

      report = reportResult.rows[0];

      if (report.status !== "pending") {
        await client.query("ROLLBACK");
        return res.status(409).json({ ok: false, error: "Жалоба уже обработана" });
      }

      if (["ban_user", "hide_and_ban"].includes(action) && ADMIN_IDS.includes(String(report.owner_id))) {
        await client.query("ROLLBACK");
        return res.status(400).json({ ok: false, error: "Администратора нельзя заблокировать" });
      }

      if (["hide_product", "hide_and_ban"].includes(action)) {
        await client.query(
          "UPDATE products SET hidden = TRUE, updated_at = NOW() WHERE id = $1",
          [report.product_id]
        );
      }

      if (["ban_user", "hide_and_ban"].includes(action)) {
        await client.query(
          "UPDATE users SET banned = TRUE WHERE telegram_id = $1",
          [report.owner_id]
        );
      }

      const updated = await client.query(
        `
          UPDATE reports
          SET status = $2,
              admin_note = $3,
              reviewed_by = $4,
              updated_at = NOW()
          WHERE id = $1
          RETURNING *;
        `,
        [reportId, decision, adminNote, req.telegramUser.id]
      );

      await addAdminLog(
        req.telegramUser.id,
        `report_${decision}`,
        reportId,
        `${report.product_name}; действие: ${action}${adminNote ? `; ${adminNote}` : ""}`,
        client
      );
      await client.query("COMMIT");

      res.json({ ok: true, report: updated.rows[0] });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  })
);



async function seedDefaultModerationRules(database = pool, adminId = "system") {
  let inserted = 0;
  let updated = 0;
  for (const [id, pattern, matchType, category, action] of DEFAULT_MODERATION_RULES) {
    const result = await database.query(`
      INSERT INTO moderation_rules (id, pattern, match_type, category, action, is_active, note, created_by)
      VALUES ($1,$2,$3,$4,$5,TRUE,$6,$7)
      ON CONFLICT (id) DO UPDATE SET pattern=EXCLUDED.pattern, match_type=EXCLUDED.match_type,
        category=EXCLUDED.category, action=EXCLUDED.action, updated_at=NOW()
      RETURNING (xmax = 0) AS inserted
    `, [id, pattern, matchType, category, action, `Базовый пакет РФ ${MODERATION_POLICY_VERSION}`, String(adminId)]);
    if (result.rows[0]?.inserted) inserted += 1; else updated += 1;
  }
  return { inserted, updated, version: MODERATION_POLICY_VERSION };
}

app.post(
  "/api/admin/moderation/defaults",
  requireTelegramAuth,
  syncTelegramUser,
  requireAdmin,
  adminRoute(async (req, res) => {
    const result = await seedDefaultModerationRules(pool, req.telegramUser.id);
    await addAdminLog(req.telegramUser.id, "moderation_defaults_sync", result.version, `inserted=${result.inserted}; updated=${result.updated}`);
    res.json({ ok: true, ...result });
  })
);

app.get(
  "/api/admin/moderation",
  requireTelegramAuth,
  syncTelegramUser,
  requireAdmin,
  adminRoute(async (req, res) => {
    const [events, rules, settings, aiUsage] = await Promise.all([
      pool.query(`
        SELECT
          m.id, m.product_id, m.user_id, m.source, m.reason, m.matches,
          m.status, m.created_at, m.ai_score, m.ai_decision, m.ai_model, m.ai_response_id,
          p.name AS product_name, p.description, p.ai_risk_score, p.ai_reason,
          p.owner_name, p.owner_username, COALESCE(NULLIF(p.thumbnail, ''), p.image) AS image, p.price
        FROM moderation_events m
        JOIN products p ON p.id = m.product_id
        WHERE m.status = 'pending'
        ORDER BY m.created_at DESC
        LIMIT 100;
      `),
      pool.query(`
        SELECT id, pattern, match_type, category, action, is_active, note, created_by, created_at, updated_at
        FROM moderation_rules
        ORDER BY is_active DESC, created_at DESC;
      `),
      pool.query(`
        SELECT enabled, block_links, block_contacts, block_emails, ai_enabled, ai_review_threshold, ai_block_threshold, updated_at
        FROM moderation_settings WHERE id = TRUE;
      `),
      getAIBudgetStatus(pool)
    ]);

    res.json({
      ok: true,
      events: events.rows,
      rules: rules.rows,
      settings: settings.rows[0] || {},
      aiUsage
    });
  })
);

app.post(
  "/api/admin/moderation/rules",
  requireTelegramAuth,
  syncTelegramUser,
  requireAdmin,
  adminRoute(async (req, res) => {
    const pattern = normalizeText(req.body?.pattern, 200);
    const matchType = normalizeText(req.body?.matchType, 20).toLowerCase();
    const note = normalizeText(req.body?.note, 500);
    const category = normalizeText(req.body?.category, 40) || "general";
    const action = ["review", "block"].includes(normalizeText(req.body?.action, 20).toLowerCase()) ? normalizeText(req.body?.action, 20).toLowerCase() : "block";
    if (pattern.length < 2 || !MODERATION_MATCH_TYPES.has(matchType)) {
      return res.status(400).json({ ok: false, error: "Проверьте выражение и тип правила" });
    }

    const result = await pool.query(
      `
        INSERT INTO moderation_rules (id, pattern, match_type, category, action, note, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT DO NOTHING
        RETURNING *;
      `,
      [randomUUID(), pattern, matchType, category, action, note, req.telegramUser.id]
    );
    if (!result.rows.length) {
      return res.status(409).json({ ok: false, error: "Такое правило уже существует" });
    }
    await addAdminLog(req.telegramUser.id, "moderation_rule_create", result.rows[0].id, pattern);
    res.status(201).json({ ok: true, rule: result.rows[0] });
  })
);

app.patch(
  "/api/admin/moderation/rules/:id",
  requireTelegramAuth,
  syncTelegramUser,
  requireAdmin,
  adminRoute(async (req, res) => {
    const ruleId = normalizeText(req.params.id, 64);
    const result = await pool.query(
      `UPDATE moderation_rules SET is_active = NOT COALESCE(is_active, TRUE), updated_at = NOW() WHERE id = $1 RETURNING *`,
      [ruleId]
    );
    if (!result.rows.length) return res.status(404).json({ ok: false, error: "Правило не найдено" });
    await addAdminLog(req.telegramUser.id, "moderation_rule_toggle", ruleId, result.rows[0].pattern);
    res.json({ ok: true, rule: result.rows[0] });
  })
);

app.delete(
  "/api/admin/moderation/rules/:id",
  requireTelegramAuth,
  syncTelegramUser,
  requireAdmin,
  adminRoute(async (req, res) => {
    const ruleId = normalizeText(req.params.id, 64);
    const result = await pool.query(`DELETE FROM moderation_rules WHERE id = $1 RETURNING pattern`, [ruleId]);
    if (!result.rows.length) return res.status(404).json({ ok: false, error: "Правило не найдено" });
    await addAdminLog(req.telegramUser.id, "moderation_rule_delete", ruleId, result.rows[0].pattern);
    res.json({ ok: true });
  })
);

app.patch(
  "/api/admin/moderation/settings",
  requireTelegramAuth,
  syncTelegramUser,
  requireAdmin,
  adminRoute(async (req, res) => {
    const result = await pool.query(
      `
        UPDATE moderation_settings
        SET enabled = $1, block_links = $2, block_contacts = $3,
            block_emails = $4, ai_enabled = $5, ai_review_threshold = $6, ai_block_threshold = $7,
            updated_by = $8, updated_at = NOW()
        WHERE id = TRUE
        RETURNING *;
      `,
      [
        normalizeBoolean(req.body?.enabled),
        normalizeBoolean(req.body?.blockLinks),
        normalizeBoolean(req.body?.blockContacts),
        normalizeBoolean(req.body?.blockEmails),
        normalizeBoolean(req.body?.aiEnabled),
        Math.max(20, Math.min(89, Number(req.body?.aiReviewThreshold) || 60)),
        Math.max(70, Math.min(100, Number(req.body?.aiBlockThreshold) || 90)),
        req.telegramUser.id
      ]
    );
    await addAdminLog(req.telegramUser.id, "moderation_settings_update", "settings", JSON.stringify(result.rows[0]));
    res.json({ ok: true, settings: result.rows[0] });
  })
);

app.patch(
  "/api/admin/moderation/:id",
  requireTelegramAuth,
  syncTelegramUser,
  requireAdmin,
  adminRoute(async (req, res) => {
    const eventId = normalizeText(req.params.id, 64);
    const decision = normalizeText(req.body?.decision, 20).toLowerCase();
    const adminNote = normalizeText(req.body?.adminNote, 1000);
    if (!['approve', 'reject'].includes(decision)) {
      return res.status(400).json({ ok: false, error: "Некорректное решение" });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const eventResult = await client.query(
        `SELECT * FROM moderation_events WHERE id = $1 AND status = 'pending' FOR UPDATE`,
        [eventId]
      );
      if (!eventResult.rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ ok: false, error: "Событие модерации не найдено" });
      }
      const event = eventResult.rows[0];
      if (decision === 'approve') {
        await client.query(
          `
            UPDATE products
            SET moderation_status = 'approved', moderation_reason = '', moderation_matches = '[]'::jsonb,
                hidden = FALSE, auto_hidden = FALSE,
                status = CASE WHEN moderation_target_status IN ('active','draft','sold') THEN moderation_target_status ELSE 'active' END,
                updated_at = NOW()
            WHERE id = $1;
          `,
          [event.product_id]
        );
      } else {
        await client.query(
          `UPDATE products SET moderation_status = 'rejected', hidden = TRUE, auto_hidden = TRUE, status = 'deleted', updated_at = NOW() WHERE id = $1`,
          [event.product_id]
        );
      }
      const updated = await client.query(
        `
          UPDATE moderation_events
          SET status = $2, reviewed_by = $3, admin_note = $4, updated_at = NOW()
          WHERE id = $1 RETURNING *;
        `,
        [eventId, decision === 'approve' ? 'approved' : 'rejected', req.telegramUser.id, adminNote]
      );
      await addAdminLog(req.telegramUser.id, `moderation_${decision}`, event.product_id, adminNote, client);
      await client.query('COMMIT');
      res.json({ ok: true, event: updated.rows[0] });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  })
);

app.get(
  "/api/admin/ads",
  requireTelegramAuth,
  syncTelegramUser,
  requireAdmin,
  adminRoute(async (req, res) => {
    const result = await pool.query(`SELECT * FROM advertising_campaigns ORDER BY created_at DESC LIMIT 200`);
    res.json({ ok: true, ads: result.rows.map(mapAdCampaign) });
  })
);

app.post(
  "/api/admin/ads",
  requireTelegramAuth,
  syncTelegramUser,
  requireAdmin,
  adminRoute(async (req, res) => {
    const title = normalizeText(req.body?.title, 120);
    const description = normalizeText(req.body?.description, 1000);
    const rawImageUrl = String(req.body?.imageUrl ?? "").trim();
    const imageUrl = normalizeProductImage(rawImageUrl);
    const targetUrl = normalizeAdTargetUrl(req.body?.targetUrl);
    const linkedProductId = normalizeText(req.body?.linkedProductId, 64);
    const buttonText = normalizeText(req.body?.buttonText, 40) || "Подробнее";
    const placement = AD_PLACEMENTS.has(req.body?.placement) ? req.body.placement : "catalog_feed";
    const status = AD_STATUSES.has(req.body?.status) ? req.body.status : "draft";
    const startsAt = normalizeOptionalDate(req.body?.startsAt);
    const endsAt = normalizeOptionalDate(req.body?.endsAt);
    const priority = Math.max(-100, Math.min(100, Number(req.body?.priority) || 0));
    const insertEvery = Math.max(2, Math.min(20, Number(req.body?.insertEvery) || 6));
    const maxImpressions = Math.max(0, Math.min(100000000, Number(req.body?.maxImpressions) || 0));
    const billingModel = AD_BILLING_MODELS.has(req.body?.billingModel) ? req.body.billingModel : "flat";
    const rateAmount = Math.max(0, Math.min(100000000, Number(req.body?.rateAmount) || 0));
    const isPaid = normalizeBoolean(req.body?.isPaid);

    if (!title || (!targetUrl && !linkedProductId)) {
      return res.status(400).json({ ok: false, error: "Укажите название и ссылку либо ID товара" });
    }
    if (rawImageUrl && !imageUrl) {
      return res.status(400).json({ ok: false, error: "Фото рекламы повреждено, имеет неподдерживаемый формат или слишком большой размер" });
    }
    if (startsAt && endsAt && new Date(startsAt) >= new Date(endsAt)) {
      return res.status(400).json({ ok: false, error: "Дата окончания должна быть позже даты начала" });
    }
    if (linkedProductId) {
      const linkedProduct = await pool.query(
        `SELECT id FROM products WHERE id = $1 AND COALESCE(status, 'active') <> 'deleted'`,
        [linkedProductId]
      );
      if (!linkedProduct.rows.length) {
        return res.status(400).json({ ok: false, error: "Указанное объявление не найдено" });
      }
    }

    const result = await pool.query(
      `
        INSERT INTO advertising_campaigns (
          id, title, description, image_url, target_url, linked_product_id, button_text,
          placement, status, starts_at, ends_at, priority, insert_every,
          max_impressions, billing_model, rate_amount, is_paid, created_by
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
        RETURNING *;
      `,
      [randomUUID(), title, description, imageUrl, targetUrl, linkedProductId, buttonText,
       placement, status, startsAt, endsAt, priority, insertEvery, maxImpressions,
       billingModel, rateAmount, isPaid, req.telegramUser.id]
    );
    await addAdminLog(req.telegramUser.id, "ad_create", result.rows[0].id, title);
    res.status(201).json({ ok: true, ad: mapAdCampaign(result.rows[0]) });
  })
);

app.patch(
  "/api/admin/ads/:id",
  requireTelegramAuth,
  syncTelegramUser,
  requireAdmin,
  adminRoute(async (req, res) => {
    const adId = normalizeText(req.params.id, 64);
    const title = normalizeText(req.body?.title, 120);
    const rawImageUrl = String(req.body?.imageUrl ?? "").trim();
    const imageUrl = normalizeProductImage(rawImageUrl);
    const targetUrl = normalizeAdTargetUrl(req.body?.targetUrl);
    const linkedProductId = normalizeText(req.body?.linkedProductId, 64);
    const placement = AD_PLACEMENTS.has(req.body?.placement) ? req.body.placement : "catalog_feed";
    const status = AD_STATUSES.has(req.body?.status) ? req.body.status : "draft";
    const startsAt = normalizeOptionalDate(req.body?.startsAt);
    const endsAt = normalizeOptionalDate(req.body?.endsAt);
    const billingModel = AD_BILLING_MODELS.has(req.body?.billingModel) ? req.body.billingModel : "flat";
    const rateAmount = Math.max(0, Math.min(100000000, Number(req.body?.rateAmount) || 0));
    const isPaid = normalizeBoolean(req.body?.isPaid);
    if (!adId || !title || (!targetUrl && !linkedProductId)) {
      return res.status(400).json({ ok: false, error: "Проверьте основные поля кампании" });
    }
    if (rawImageUrl && !imageUrl) {
      return res.status(400).json({ ok: false, error: "Фото рекламы повреждено, имеет неподдерживаемый формат или слишком большой размер" });
    }
    if (startsAt && endsAt && new Date(startsAt) >= new Date(endsAt)) {
      return res.status(400).json({ ok: false, error: "Дата окончания должна быть позже даты начала" });
    }
    if (linkedProductId) {
      const linkedProduct = await pool.query(
        `SELECT id FROM products WHERE id = $1 AND COALESCE(status, 'active') <> 'deleted'`,
        [linkedProductId]
      );
      if (!linkedProduct.rows.length) {
        return res.status(400).json({ ok: false, error: "Указанное объявление не найдено" });
      }
    }
    const result = await pool.query(
      `
        UPDATE advertising_campaigns
        SET title=$2, description=$3, image_url=$4, target_url=$5, linked_product_id=$6,
            button_text=$7, placement=$8, status=$9, starts_at=$10, ends_at=$11,
            priority=$12, insert_every=$13, max_impressions=$14,
            billing_model=$15, rate_amount=$16, is_paid=$17, updated_at=NOW()
        WHERE id=$1 RETURNING *;
      `,
      [adId, title, normalizeText(req.body?.description,1000), imageUrl,
       targetUrl, linkedProductId, normalizeText(req.body?.buttonText,40) || "Подробнее",
       placement, status, startsAt, endsAt,
       Math.max(-100,Math.min(100,Number(req.body?.priority)||0)),
       Math.max(2,Math.min(20,Number(req.body?.insertEvery)||6)),
       Math.max(0,Math.min(100000000,Number(req.body?.maxImpressions)||0)),
       billingModel, rateAmount, isPaid]
    );
    if (!result.rows.length) return res.status(404).json({ ok: false, error: "Кампания не найдена" });
    await addAdminLog(req.telegramUser.id, "ad_update", adId, title);
    res.json({ ok: true, ad: mapAdCampaign(result.rows[0]) });
  })
);

app.delete(
  "/api/admin/ads/:id",
  requireTelegramAuth,
  syncTelegramUser,
  requireAdmin,
  adminRoute(async (req, res) => {
    const adId = normalizeText(req.params.id, 64);
    const result = await pool.query(`DELETE FROM advertising_campaigns WHERE id=$1 RETURNING title`, [adId]);
    if (!result.rows.length) return res.status(404).json({ ok: false, error: "Кампания не найдена" });
    await addAdminLog(req.telegramUser.id, "ad_delete", adId, result.rows[0].title);
    res.json({ ok: true });
  })
);

app.get(
  "/api/admin/logs",
  requireTelegramAuth,
  syncTelegramUser,
  requireAdmin,
  adminRoute(async (req, res) => {
    const result = await pool.query(`
      SELECT id, admin_id, action, target, details, created_at
      FROM admin_logs
      ORDER BY created_at DESC
      LIMIT 100;
    `);

    res.json({
      ok: true,
      logs: result.rows
    });
  })
);

app.get(
  "/api/admin/search",
  requireTelegramAuth,
  syncTelegramUser,
  requireAdmin,
  adminRoute(async (req, res) => {
    const cleanQuery = normalizeText(req.query.q, 100);

    if (!cleanQuery) {
      return res.json({
        ok: true,
        products: [],
        users: []
      });
    }

    const query = `%${cleanQuery}%`;
    const [products, users] = await Promise.all([
      pool.query(
        `
          SELECT id, owner_id, name, price, category, owner_name, hidden, created_at
          FROM products
          WHERE COALESCE(status, 'active') <> 'deleted'
            AND (
              name ILIKE $1
              OR category ILIKE $1
              OR owner_name ILIKE $1
              OR owner_username ILIKE $1
            )
          ORDER BY created_at DESC
          LIMIT 50;
        `,
        [query]
      ),
      pool.query(
        `
          SELECT
            u.telegram_id,
            u.username,
            u.first_name,
            u.last_name,
            u.last_seen,
            u.created_at,
            u.banned,
            u.listing_limit,
            (u.professional_subscription_until > NOW()) AS is_business,
            CASE WHEN u.professional_subscription_until > NOW() THEN NULL ELSE COALESCE(u.listing_limit, ${DEFAULT_LISTING_LIMIT}) END AS effective_listing_limit,
            COUNT(p.id)::int AS products_count,
            COUNT(p.id) FILTER (
              WHERE COALESCE(p.status, 'active') NOT IN ('deleted', 'sold')
            )::int AS listing_slots_used
          FROM users u
          LEFT JOIN products p
            ON p.owner_id = u.telegram_id
            AND COALESCE(p.status, 'active') <> 'deleted'
          WHERE u.telegram_id ILIKE $1
             OR u.username ILIKE $1
             OR u.first_name ILIKE $1
             OR u.last_name ILIKE $1
          GROUP BY u.telegram_id
          ORDER BY u.created_at DESC
          LIMIT 50;
        `,
        [query]
      )
    ]);

    res.json({
      ok: true,
      products: products.rows,
      users: users.rows
    });
  })
);

app.get(
  "/api/admin/growth",
  requireTelegramAuth,
  syncTelegramUser,
  requireAdmin,
  adminRoute(async (req, res) => {
    const [users, products] = await Promise.all([
      pool.query(`
        SELECT
          series.day::date AS day,
          COUNT(u.telegram_id)::int AS count
        FROM generate_series(
          CURRENT_DATE - INTERVAL '13 days',
          CURRENT_DATE,
          INTERVAL '1 day'
        ) AS series(day)
        LEFT JOIN users u ON u.created_at::date = series.day::date
        GROUP BY series.day
        ORDER BY series.day ASC;
      `),
      pool.query(`
        SELECT
          series.day::date AS day,
          COUNT(p.id)::int AS count
        FROM generate_series(
          CURRENT_DATE - INTERVAL '13 days',
          CURRENT_DATE,
          INTERVAL '1 day'
        ) AS series(day)
        LEFT JOIN products p
          ON p.created_at::date = series.day::date
          AND COALESCE(p.status, 'active') <> 'deleted'
        GROUP BY series.day
        ORDER BY series.day ASC;
      `)
    ]);

    res.json({
      ok: true,
      users: users.rows,
      products: products.rows
    });
  })
);

// Сохраняем совместимость со старым клиентом, но физически данные не удаляем.
app.delete(
  "/api/admin/products/:id",
  requireTelegramAuth,
  syncTelegramUser,
  requireAdmin,
  adminRoute(async (req, res) => {
    const productId = normalizeText(req.params.id, 64);
    const result = await pool.query(
      `
        UPDATE products
        SET hidden = TRUE,
            status = 'deleted',
            updated_at = NOW()
        WHERE id = $1
          AND COALESCE(status, 'active') <> 'sold'
        RETURNING id, name;
      `,
      [productId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        error: "Объявление не найдено"
      });
    }

    await addAdminLog(
      req.telegramUser.id,
      "archive_product",
      result.rows[0].id,
      result.rows[0].name
    );

    res.json({
      ok: true
    });
  })
);


app.get(
  "/api/admin/users",
  requireTelegramAuth,
  syncTelegramUser,
  requireAdmin,
  adminRoute(async (req, res) => {
    const result = await pool.query(`
      SELECT
        u.telegram_id,
        u.username,
        u.first_name,
        u.last_name,
        u.last_seen,
        u.created_at,
        u.banned,
        u.listing_limit,
        (u.professional_subscription_until > NOW()) AS is_business,
        FALSE AS business_verified,
        u.professional_subscription_until,
        CASE WHEN u.professional_subscription_until > NOW() THEN NULL ELSE COALESCE(u.listing_limit, ${DEFAULT_LISTING_LIMIT}) END AS effective_listing_limit,
        COUNT(p.id)::int AS products_count,
        COUNT(p.id) FILTER (
          WHERE COALESCE(p.status, 'active') NOT IN ('deleted', 'sold')
        )::int AS listing_slots_used
      FROM users u
      LEFT JOIN products p
        ON p.owner_id = u.telegram_id
        AND COALESCE(p.status, 'active') <> 'deleted'
      GROUP BY u.telegram_id
      ORDER BY u.created_at DESC
      LIMIT 100;
    `);

    res.json({
      ok: true,
      users: result.rows
    });
  })
);

app.use("/api", (req, res) => {
  res.status(404).json({
    ok: false,
    error: "API-маршрут не найден"
  });
});


app.get("*", (req, res) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  res.sendFile(path.join(publicDir, "index.html"));
});

app.use((error, req, res, next) => {
  if (error?.type === "entity.too.large") {
    return res.status(413).json({
      ok: false,
      error: "Загружаемые данные слишком большие. Уменьшите размер фотографии и повторите попытку"
    });
  }

  if (error?.type === "entity.parse.failed") {
    return res.status(400).json({ ok: false, error: "Сервер получил некорректные данные" });
  }

  if (String(req.path || "").startsWith("/api/")) {
    console.error("Unhandled API error:", error);
    return res.status(500).json({ ok: false, error: "Внутренняя ошибка сервера" });
  }

  return next(error);
});

async function runProductLifecycleMaintenance() {
  try {
    const archived = await pool.query(
      `
        UPDATE products
        SET status = 'archived',
            archived_at = NOW(),
            featured_paid = FALSE,
            featured_until = NULL,
            updated_at = NOW()
        WHERE status = 'active'
          AND COALESCE(expires_at, created_at + ($1::int * INTERVAL '1 day')) <= NOW()
        RETURNING id;
      `,
      [PRODUCT_ARCHIVE_DAYS]
    );

    const soldCleanup = await pool.query(
      `
        WITH sold_ids AS (
          SELECT id
          FROM products
          WHERE status = 'sold'
            AND media_purged_at IS NULL
        ),
        delete_favorites AS (
          DELETE FROM favorites WHERE product_id IN (SELECT id FROM sold_ids)
        ),
        delete_images AS (
          DELETE FROM product_images WHERE product_id IN (SELECT id FROM sold_ids)
        ),
        delete_price_history AS (
          DELETE FROM product_price_history WHERE product_id IN (SELECT id FROM sold_ids)
        ),
        delete_reports AS (
          DELETE FROM reports WHERE product_id IN (SELECT id FROM sold_ids)
        ),
        delete_feature_requests AS (
          DELETE FROM product_feature_requests WHERE product_id IN (SELECT id FROM sold_ids)
        ),
        delete_moderation_events AS (
          DELETE FROM moderation_events WHERE product_id IN (SELECT id FROM sold_ids)
        ),
        unlink_campaigns AS (
          UPDATE advertising_campaigns
          SET linked_product_id = '',
              status = CASE WHEN status = 'active' THEN 'paused' ELSE status END,
              updated_at = NOW()
          WHERE linked_product_id IN (SELECT id FROM sold_ids)
        )
        UPDATE products
        SET hidden = TRUE,
            sold_at = COALESCE(sold_at, updated_at, NOW()),
            media_purged_at = NOW(),
            image = '',
            thumbnail = '',
            images = '[]'::jsonb,
            description = '',
            phone = '',
            allow_messages = FALSE,
            district = '',
            specifications = '{}'::jsonb,
            previous_price = '',
            previous_price_amount = NULL,
            price_dropped_at = NULL,
            moderation_reason = '',
            moderation_matches = '[]'::jsonb,
            moderation_target_status = 'sold',
            auto_hidden = FALSE,
            featured_paid = FALSE,
            featured_until = NULL,
            expires_at = NULL,
            archived_at = NULL,
            updated_at = NOW()
        WHERE id IN (SELECT id FROM sold_ids)
        RETURNING id;
      `
    );

    const purged = await pool.query(
      `
        DELETE FROM products
        WHERE status = 'deleted'
          AND updated_at <= NOW() - ($1::int * INTERVAL '1 day')
        RETURNING id;
      `,
      [DELETED_PRODUCT_RETENTION_DAYS]
    );

    await pool.query(`DELETE FROM security_events WHERE created_at < NOW() - ($1::int * INTERVAL '1 day')`, [SECURITY_EVENT_RETENTION_DAYS]);
    await pool.query(`UPDATE payment_orders SET status='failed', updated_at=NOW() WHERE status='creating' AND created_at < NOW() - INTERVAL '15 minutes'`);

    if (archived.rowCount || soldCleanup.rowCount || purged.rowCount) {
      console.log(
        `Lifecycle maintenance: archived=${archived.rowCount}, sold-media-purged=${soldCleanup.rowCount}, deleted-purged=${purged.rowCount}`
      );
    }
  } catch (error) {
    console.error("Product lifecycle maintenance error:", error);
  }
}

async function initializeDatabaseUntilReady() {
  if (databaseState.initializing || databaseState.ready) return;
  databaseState.initializing = true;

  try {
    while (!databaseState.ready) {
      try {
        await initDbWithRetry();
        databaseState.ready = true;
        databaseState.lastError = "";
        databaseState.connectedAt = new Date().toISOString();
        console.log("PostgreSQL is ready; database-backed API routes are enabled");

        await runProductLifecycleMaintenance();
        if (!lifecycleTimer) {
          lifecycleTimer = setInterval(runProductLifecycleMaintenance, 60 * 60 * 1000);
          lifecycleTimer.unref?.();
        }
        if (AUTO_BACKUP_ENABLED && !backupTimer) {
          const runBackup = async () => {
            try {
              const backup = await createDatabaseBackup(pool, { backupDir: BACKUP_DIR, retention: BACKUP_RETENTION_COUNT, appVersion: APP_VERSION });
              console.log(`Database backup created: ${backup.filename} (${backup.bytes} bytes)`);
            } catch (backupError) {
              console.error("Automatic database backup error:", backupError);
            }
          };
          setTimeout(runBackup, 60_000).unref?.();
          backupTimer = setInterval(runBackup, AUTO_BACKUP_INTERVAL_HOURS * 60 * 60 * 1000);
          backupTimer.unref?.();
        }
      } catch (error) {
        databaseState.lastError = String(error?.message || error || "Database connection error");
        console.error(
          "PostgreSQL is still unavailable. The web server remains online and will retry in 30 seconds:",
          databaseState.lastError
        );
        await wait(30_000);
      }
    }
  } finally {
    databaseState.initializing = false;
  }
}

function ensureDatabaseInitialization() {
  if (databaseState.ready) return Promise.resolve();
  if (!databaseInitializationPromise) {
    databaseInitializationPromise = initializeDatabaseUntilReady()
      .catch(error => {
        databaseState.lastError = String(error?.message || error || "Database initialization error");
        console.error("Unexpected database initialization loop error:", error);
      })
      .finally(() => {
        databaseInitializationPromise = null;
        if (!databaseState.ready) {
          setTimeout(ensureDatabaseInitialization, 30_000).unref?.();
        }
      });
  }
  return databaseInitializationPromise;
}

console.log(`[Ossetian Market] starting version ${APP_VERSION}; ads, highlighting and feature-request admin flow enabled`);
console.log(
  `PostgreSQL target: host=${DATABASE_TARGET.host} port=${DATABASE_TARGET.port} ` +
  `database=${DATABASE_TARGET.database} ssl=${DATABASE_SSL ? "required" : "disabled"} ` +
  `connection=${DATABASE_TARGET.renderInternal ? "render-internal" : "external-or-custom"}`
);

const httpServer = app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server started on 0.0.0.0:${PORT}; PostgreSQL initialization continues in background`);
});
httpServer.keepAliveTimeout = 120_000;
httpServer.headersTimeout = 125_000;

ensureDatabaseInitialization();

async function shutdown(signal) {
  console.log(`${signal} received; shutting down`);
  if (lifecycleTimer) clearInterval(lifecycleTimer);
  if (backupTimer) clearInterval(backupTimer);
  httpServer.close(async () => {
    try {
      await pool.end();
    } finally {
      process.exit(0);
    }
  });
  setTimeout(() => process.exit(1), 10_000).unref?.();
}

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
