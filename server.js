import express from "express";
import compression from "compression";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { createHmac, randomUUID, timingSafeEqual } from "crypto";
import pg from "pg";
import sharp from "sharp";
import { lookup } from "dns/promises";
import { isIP } from "net";
import { createTelegramAuthMiddleware } from "./telegram-auth.js";
import {
  DEFAULT_MODERATION_RULES,
  MODERATION_CATEGORY_LABELS,
  MODERATION_POLICY_VERSION
} from "./moderation-policy.js";
import { containsModerationPattern } from "./moderation-text.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const APP_VERSION = "1.16.0";
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
  "Вакансии"
]);
const MODERATION_STATUSES = new Set(["approved", "blocked", "rejected"]);
const MODERATION_MATCH_TYPES = new Set(["word", "phrase", "domain"]);
const MODERATION_RULE_ACTIONS = new Set(["review", "block"]);
const MODERATION_RULE_CATEGORIES = new Set(Object.keys(MODERATION_CATEGORY_LABELS));
const AD_PLACEMENTS = new Set(["catalog_top", "catalog_feed", "product_detail"]);
const AD_STATUSES = new Set(["draft", "active", "paused", "ended"]);
const AD_BILLING_MODELS = new Set(["flat", "cpm", "cpc"]);
const MAX_STORED_IMAGE_BYTES = 6 * 1024 * 1024;
const PRODUCT_ARCHIVE_DAYS = Math.max(1, Math.min(365, Number(process.env.PRODUCT_ARCHIVE_DAYS) || 15));
const DELETED_PRODUCT_RETENTION_DAYS = Math.max(1, Math.min(3650, Number(process.env.DELETED_PRODUCT_RETENTION_DAYS) || 30));
const FEATURE_HIGHLIGHT_PRICE_RUB = Math.max(0, Number(process.env.FEATURE_HIGHLIGHT_PRICE_RUB) || 199);
const FEATURE_HIGHLIGHT_DAYS = Math.max(1, Math.min(90, Number(process.env.FEATURE_HIGHLIGHT_DAYS) || 7));
const DEFAULT_LISTING_LIMIT = 3;
const BUSINESS_LISTING_LIMIT = 50;
const MAX_LISTING_LIMIT = 100;
const BUSINESS_LISTING_PRICE_RUB = Math.max(0, Number(process.env.BUSINESS_LISTING_PRICE_RUB) || 299);
const FEATURE_COLOR = "green";
const preparedShareMessageCache = new Map();

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
  res.setHeader("X-Ossetian-Market-Version", APP_VERSION);
  next();
});
app.use(compression({ threshold: 1024 }));
app.use(express.json({ limit: "30mb" }));
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
  p.created_at,
  p.updated_at
`;

const PRODUCT_PUBLIC_DETAIL_COLUMNS = `
  p.id,
  p.owner_id,
  p.owner_name,
  p.owner_username,
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
    listingLimit: normalizeListingLimit(row.listing_limit),
    lastSeen: row.last_seen ? new Date(row.last_seen).getTime() : null,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : null
  };
}

function normalizeText(value, maxLength) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function normalizeLegalAcceptance(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function validateListingLegalAcceptance({ legalAcceptance, status, allowCalls, allowMessages }) {
  if (status !== "active") return null;
  const acceptance = normalizeLegalAcceptance(legalAcceptance);
  if (acceptance.documentVersion !== LEGAL_DOCUMENT_VERSION ||
      acceptance.termsVersion !== LEGAL_DOCUMENT_VERSION ||
      acceptance.listingRulesVersion !== LEGAL_DOCUMENT_VERSION ||
      acceptance.rulesAccepted !== true) {
    return {
      code: "LEGAL_ACCEPTANCE_REQUIRED",
      error: "Подтвердите актуальные Пользовательское соглашение и Правила размещения объявлений"
    };
  }
  if (allowCalls !== false && acceptance.publicPhoneConsent !== true) {
    return {
      code: "PUBLIC_PHONE_CONSENT_REQUIRED",
      error: "Для публикации номера требуется отдельное согласие на распространение персональных данных"
    };
  }
  if (allowMessages !== false && acceptance.publicTelegramConsent !== true) {
    return {
      code: "PUBLIC_TELEGRAM_CONSENT_REQUIRED",
      error: "Для публикации Telegram-контакта требуется отдельное согласие на распространение персональных данных"
    };
  }
  if ((allowCalls !== false || allowMessages !== false) && acceptance.publicDataConsentVersion !== LEGAL_DOCUMENT_VERSION) {
    return {
      code: "PUBLIC_DATA_CONSENT_VERSION_REQUIRED",
      error: "Подтвердите актуальную редакцию согласия на распространение персональных данных"
    };
  }
  return null;
}

async function recordLegalAcceptance(db, { userId, type, version, context = "app", productId = "", metadata = {} }) {
  const cleanUserId = normalizeText(userId, 64);
  const cleanType = normalizeText(type, 64);
  const cleanVersion = normalizeText(version, 32);
  const cleanContext = normalizeText(context, 40) || "app";
  const cleanProductId = normalizeText(productId, 64);
  if (!cleanUserId || !cleanType || !cleanVersion) return;
  await db.query(
    `INSERT INTO legal_acceptances (
       id, user_id, acceptance_type, document_version, context, product_id, evidence
     ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
     ON CONFLICT (user_id, acceptance_type, document_version, context, product_id) DO NOTHING`,
    [randomUUID(), cleanUserId, cleanType, cleanVersion, cleanContext, cleanProductId, JSON.stringify(metadata || {})]
  );
}

async function recordCoreLegalAcceptancesFromRequest(db, req) {
  const termsVersion = normalizeText(req.get("x-legal-terms-version"), 32);
  const pdConsentVersion = normalizeText(req.get("x-pd-consent-version"), 32);
  const clientAcceptedAt = normalizeText(req.get("x-legal-accepted-at"), 80);
  const metadata = { source: "mini_app", clientAcceptedAt };
  if (termsVersion === LEGAL_DOCUMENT_VERSION) {
    await recordLegalAcceptance(db, {
      userId: req.telegramUser?.id, type: "user_agreement", version: termsVersion, metadata
    });
  }
  if (pdConsentVersion === LEGAL_DOCUMENT_VERSION) {
    await recordLegalAcceptance(db, {
      userId: req.telegramUser?.id, type: "pd_processing", version: pdConsentVersion, metadata
    });
  }
}

async function recordListingLegalAcceptances(db, { userId, productId, legalAcceptance, allowCalls, allowMessages }) {
  const acceptance = normalizeLegalAcceptance(legalAcceptance);
  const metadata = { source: "listing_publish", clientAcceptedAt: normalizeText(acceptance.acceptedAt, 80) };
  await recordLegalAcceptance(db, {
    userId, productId, type: "listing_rules", version: LEGAL_DOCUMENT_VERSION, context: "listing", metadata
  });
  if (allowCalls !== false) {
    await recordLegalAcceptance(db, {
      userId, productId, type: "public_phone", version: LEGAL_DOCUMENT_VERSION, context: "listing", metadata
    });
  }
  if (allowMessages !== false) {
    await recordLegalAcceptance(db, {
      userId, productId, type: "public_telegram", version: LEGAL_DOCUMENT_VERSION, context: "listing", metadata
    });
  }
}

function normalizePhoneKey(value) {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 10) digits = `7${digits}`;
  if (digits.length === 11 && digits.startsWith("8")) digits = `7${digits.slice(1)}`;
  return digits.slice(0, 15);
}

function normalizeListingLimit(value, fallback = DEFAULT_LISTING_LIMIT) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(MAX_LISTING_LIMIT, parsed));
}

async function getListingQuota(db, userId, { lockUser = false } = {}) {
  const userResult = await db.query(
    `SELECT listing_limit
     FROM users
     WHERE telegram_id = $1
     ${lockUser ? "FOR UPDATE" : ""}`,
    [String(userId)]
  );
  const limit = normalizeListingLimit(userResult.rows[0]?.listing_limit);
  const countResult = await db.query(
    `SELECT COUNT(*)::int AS used
     FROM products
     WHERE owner_id = $1
       AND COALESCE(status, 'active') NOT IN ('deleted', 'sold')`,
    [String(userId)]
  );
  const used = Number(countResult.rows[0]?.used) || 0;
  return {
    used,
    limit,
    remaining: Math.max(0, limit - used),
    businessLimit: BUSINESS_LISTING_LIMIT,
    businessPriceRub: BUSINESS_LISTING_PRICE_RUB,
    maxLimit: MAX_LISTING_LIMIT
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
        headers: { "User-Agent": "OssetianMarket/1.13.7" },
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

async function evaluateProductModeration(product, database = pool) {
  const settingsResult = await database.query(`
    SELECT enabled, block_links, block_contacts, block_emails
    FROM moderation_settings
    WHERE id = TRUE
    LIMIT 1;
  `);
  const settings = settingsResult.rows[0] || {
    enabled: true,
    block_links: true,
    block_contacts: true,
    block_emails: true
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
    matches.push({ type: "link", category: "custom", action: "review", label: "Ссылка в тексте объявления" });
  }
  if (settings.block_emails && emailPattern.test(content)) {
    matches.push({ type: "email", category: "custom", action: "review", label: "Email в тексте объявления" });
  }
  if (settings.block_contacts && (telegramPattern.test(content) || phonePattern.test(content))) {
    matches.push({ type: "contact", category: "custom", action: "review", label: "Контактные данные в тексте объявления" });
  }

  const rulesResult = await database.query(`
    SELECT id, pattern, match_type, category, action
    FROM moderation_rules
    WHERE is_active = TRUE
    ORDER BY created_at ASC;
  `);

  for (const rule of rulesResult.rows) {
    if (containsModerationPattern(content, rule.pattern, rule.match_type)) {
      const category = MODERATION_RULE_CATEGORIES.has(rule.category) ? rule.category : "custom";
      const action = MODERATION_RULE_ACTIONS.has(rule.action) ? rule.action : "review";
      matches.push({
        type: rule.match_type,
        ruleId: rule.id,
        category,
        action,
        label: `${MODERATION_CATEGORY_LABELS[category]}: ${rule.pattern}`
      });
    }
  }

  const uniqueMatches = matches.filter((match, index, items) =>
    items.findIndex(item => item.type === match.type && item.label === match.label) === index
  );

  const decision = uniqueMatches.some(item => item.action === "block") ? "block" : "review";
  const categories = [...new Set(uniqueMatches.map(item => item.category).filter(Boolean))];
  const categorySummary = categories
    .map(category => MODERATION_CATEGORY_LABELS[category] || "Правила публикации")
    .join(", ");

  return {
    blocked: uniqueMatches.length > 0,
    decision,
    policyVersion: MODERATION_POLICY_VERSION,
    reason: uniqueMatches.length
      ? `Объявление направлено на проверку: ${categorySummary || "правила публикации"}`.slice(0, 1000)
      : "",
    adminReason: uniqueMatches.map(item => item.label).join("; ").slice(0, 1000),
    matches: uniqueMatches.slice(0, 30)
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

async function seedDefaultModerationRules(database = pool) {
  let inserted = 0;
  for (const [id, pattern, matchType, category, action] of DEFAULT_MODERATION_RULES) {
    const values = [
      id,
      pattern,
      matchType,
      category,
      action,
      `Базовый пакет РФ ${MODERATION_POLICY_VERSION}`
    ];
    const updated = await database.query(
      `
        UPDATE moderation_rules
        SET category = $4, action = $5, note = $6, updated_at = NOW()
        WHERE id = $1
        RETURNING id;
      `,
      values
    );
    if (updated.rows.length) continue;

    const result = await database.query(
      `
        INSERT INTO moderation_rules (
          id, pattern, match_type, category, action, note, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, 'system')
        ON CONFLICT DO NOTHING
        RETURNING id;
      `,
      values
    );
    inserted += result.rows.length;
  }
  return inserted;
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


  await db.query(`
    CREATE TABLE IF NOT EXISTS legal_acceptances (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      acceptance_type TEXT NOT NULL,
      document_version TEXT NOT NULL,
      context TEXT NOT NULL DEFAULT 'app',
      product_id TEXT NOT NULL DEFAULT '',
      accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      evidence JSONB NOT NULL DEFAULT '{}'::jsonb
    );
  `);
  await db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_legal_acceptances_unique
    ON legal_acceptances (user_id, acceptance_type, document_version, context, product_id);
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_legal_acceptances_user_date
    ON legal_acceptances (user_id, accepted_at DESC);
  `);
  await db.query(`
    UPDATE users
    SET listing_limit = ${DEFAULT_LISTING_LIMIT}
    WHERE listing_limit IS NULL OR listing_limit < 1 OR listing_limit > ${MAX_LISTING_LIMIT};
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
  await db.query(`ALTER TABLE product_feature_requests ALTER COLUMN color SET DEFAULT 'green';`);
  await db.query(`UPDATE product_feature_requests SET color = 'green' WHERE COALESCE(color, '') <> 'green';`);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_product_feature_requests_status_created
    ON product_feature_requests (status, created_at DESC);
  `);

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
  await db.query(`ALTER TABLE products ALTER COLUMN featured_color SET DEFAULT 'green';`);
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
      category TEXT DEFAULT 'custom',
      action TEXT DEFAULT 'review',
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

  await db.query(`ALTER TABLE moderation_rules ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'custom';`);
  await db.query(`ALTER TABLE moderation_rules ADD COLUMN IF NOT EXISTS action TEXT DEFAULT 'review';`);
  await seedDefaultModerationRules(db);

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
    build: "vacancies-fast-share-visible-report"
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
    lastError: databaseState.ready ? "" : databaseState.lastError,
    version: APP_VERSION
  });
});

app.get("/api/config", (req, res) => {
  res.json({
    ok: true,
    version: APP_VERSION,
    supportUsername: SUPPORT_USERNAME,
    botUsername: BOT_USERNAME,
    productArchiveDays: PRODUCT_ARCHIVE_DAYS,
    featureHighlightPriceRub: FEATURE_HIGHLIGHT_PRICE_RUB,
    featureHighlightDays: FEATURE_HIGHLIGHT_DAYS,
    defaultListingLimit: DEFAULT_LISTING_LIMIT,
    businessListingLimit: BUSINESS_LISTING_LIMIT,
    businessListingPriceRub: BUSINESS_LISTING_PRICE_RUB,
    maxListingLimit: MAX_LISTING_LIMIT
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


    await recordCoreLegalAcceptancesFromRequest(pool, req);
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
              city, phone, contact_username, listing_limit, last_seen, created_at, updated_at
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

app.patch("/api/me/profile", requireTelegramAuth, syncTelegramUser, async (req, res) => {
  try {
    const description = normalizeText(req.body?.description, 600);
    const city = normalizeText(req.body?.city, 80);
    const phone = normalizeText(req.body?.phone, 30);
    const phoneKey = normalizePhoneKey(phone);
    const contactUsername = normalizeText(req.body?.contactUsername, 40).replace(/^@/, "");

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
           contact_username = $6, updated_at = NOW()
       WHERE telegram_id = $1
       RETURNING telegram_id, username, first_name, last_name, avatar, profile_description,
                 city, phone, contact_username, listing_limit, last_seen, created_at, updated_at`,
      [String(req.telegramUser.id), description, city, phone, phoneKey, contactUsername]
    );

    const preferredUsername = contactUsername || result.rows[0]?.username || req.telegramUser.username || "";
    await pool.query(
      `UPDATE products SET owner_username = $2, phone = $3, updated_at = NOW()
       WHERE owner_id = $1 AND COALESCE(status, 'active') NOT IN ('deleted', 'sold')`,
      [String(req.telegramUser.id), preferredUsername, phone]
    );

    res.json({ ok: true, user: mapPublicUser(result.rows[0]) });
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
      return res.status(400).json({
        ok: false,
        error: "Некорректный ID продавца"
      });
    }

    const userResult = await pool.query(
      `
        SELECT telegram_id, username, first_name, last_name, avatar, profile_description,
               city, phone, contact_username, last_seen, created_at, updated_at
        FROM users
        WHERE telegram_id = $1
        LIMIT 1;
      `,
      [userId]
    );

    if (userResult.rows.length > 0) {
      return res.json({
        ok: true,
        user: mapPublicUser(userResult.rows[0])
      });
    }

    // Поддержка старых объявлений, созданных до появления таблицы users.
    const fallbackResult = await pool.query(
      `
        SELECT owner_id, owner_name, owner_username, created_at
        FROM products
        WHERE owner_id = $1
          AND COALESCE(status, 'active') = 'active'
          AND COALESCE(hidden, FALSE) = FALSE
          AND COALESCE(moderation_status, 'approved') = 'approved'
        ORDER BY created_at DESC
        LIMIT 1;
      `,
      [userId]
    );

    if (fallbackResult.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        error: "Продавец не найден"
      });
    }

    return res.json({
      ok: true,
      user: mapPublicUser(fallbackResult.rows[0])
    });
  } catch (error) {
    console.error("Get seller profile error:", error);
    return res.status(500).json({
      ok: false,
      error: "Не удалось получить профиль продавца"
    });
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
      ? [...new Set(search.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean))].slice(0, 6)
      : [];
    const vacancyRequested = !category && rawSearchTerms.some(term =>
      term.startsWith("ваканс") || ["работа", "работы", "работу", "работе"].includes(term)
    );
    const vacancyStopWords = new Set(["ищу", "найти", "нужна", "нужен", "нужны", "покажи", "показать", "все", "актуальные"]);
    const searchTerms = vacancyRequested
      ? rawSearchTerms.filter(term =>
          !(term.startsWith("ваканс") || ["работа", "работы", "работу", "работе"].includes(term) || vacancyStopWords.has(term))
        )
      : rawSearchTerms;

    if (vacancyRequested) {
      values.push("Вакансии");
      conditions.push(`p.category = $${values.length}`);
    }

    for (const term of searchTerms) {
      values.push(`%${term}%`);
      const parameter = `$${values.length}`;
      conditions.push(`(
        LOWER(COALESCE(p.name, '')) LIKE ${parameter}
        OR LOWER(COALESCE(p.description, '')) LIKE ${parameter}
        OR LOWER(COALESCE(p.category, '')) LIKE ${parameter}
        OR LOWER(COALESCE(p.location, '')) LIKE ${parameter}
        OR LOWER(COALESCE(p.district, '')) LIKE ${parameter}
        OR LOWER(COALESCE(p.owner_name, '')) LIKE ${parameter}
        OR LOWER(COALESCE(p.price, '')) LIKE ${parameter}
        OR LOWER(COALESCE(p.specifications::text, '')) LIKE ${parameter}
      )`);
    }

    let relevanceSql = "";
    if (search) {
      values.push(search.toLowerCase());
      const fullSearchParameter = `$${values.length}`;
      relevanceSql = `CASE
        WHEN LOWER(COALESCE(p.name, '')) = ${fullSearchParameter} THEN 6
        WHEN LOWER(COALESCE(p.name, '')) LIKE '%' || ${fullSearchParameter} || '%' THEN 5
        WHEN LOWER(COALESCE(p.specifications::text, '')) LIKE '%' || ${fullSearchParameter} || '%' THEN 4
        WHEN LOWER(COALESCE(p.category, '')) LIKE '%' || ${fullSearchParameter} || '%' THEN 2
        WHEN LOWER(COALESCE(p.description, '')) LIKE '%' || ${fullSearchParameter} || '%' THEN 1
        ELSE 0
      END`;
    }

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
    const orderBySql = [
      ...(relevanceSql ? [`${relevanceSql} DESC`] : []),
      "p.created_at DESC",
      "p.id DESC"
    ].join(",\n          ");
    const selectedOrderBySql = sort === "price_asc"
      ? "COALESCE(p.price_amount, 9223372036854775807) ASC, p.created_at DESC"
      : sort === "price_desc"
        ? "COALESCE(p.price_amount, 0) DESC, p.created_at DESC"
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
      specifications, status, legalAcceptance
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
    const legalError = validateListingLegalAcceptance({
      legalAcceptance, status: requestedStatus, allowCalls, allowMessages
    });
    if (legalError) return res.status(400).json({ ok: false, ...legalError });

    if (!PRODUCT_CATEGORIES.has(cleanCategory)) {
      return res.status(400).json({ ok: false, error: "Выберите допустимую категорию" });
    }
    if (!cleanName || !cleanPrice || !cleanCategory || !cleanDescription) {
      return res.status(400).json({ ok: false, error: "Проверьте название, цену, категорию и описание" });
    }

    const sourceImages = Array.isArray(images) ? images : [];
    const cleanImages = sourceImages.map(normalizeProductImage).filter(Boolean).slice(0, 5);
    const fallbackImage = normalizeProductImage(image);
    if (cleanImages.length === 0 && fallbackImage) cleanImages.push(fallbackImage);
    const cleanThumbnail = normalizeProductImage(thumbnail) || cleanImages[0] || "";

    await client.query("BEGIN");
    const listingQuota = await getListingQuota(client, req.telegramUser.id, { lockUser: true });
    if (listingQuota.used >= listingQuota.limit) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        ok: false,
        code: "LISTING_LIMIT_REACHED",
        error: `У вас уже ${listingQuota.used} из ${listingQuota.limit} доступных объявлений. Удалите одно объявление или отметьте его проданным.`,
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
      specifications: cleanSpecifications
    }, client);
    const finalStatus = moderation.blocked ? "draft" : (requestedStatus === "draft" ? "draft" : "active");
    const id = randomUUID();
    const ownerName = getTelegramDisplayName(req.telegramUser);

    const result = await client.query(
      `
        INSERT INTO products (
          id, owner_id, owner_name, owner_username, name, price, price_amount,
          category, description, image, images, location, phone, allow_calls, allow_messages,
          condition, negotiable, delivery, district, specifications, views, status,
          hidden, auto_hidden, moderation_status, moderation_reason, moderation_matches,
          moderation_target_status, published_at, expires_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13,
          $14, $15, $16, $17, $18, $19, $20::jsonb, 0, $21, $22, $23, $24, $25, $26::jsonb, $27,
          CASE WHEN $21 = 'active' THEN NOW() ELSE NULL END,
          CASE WHEN $21 = 'active' THEN NOW() + ($28::int * INTERVAL '1 day') ELSE NULL END
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
        PRODUCT_ARCHIVE_DAYS
      ]
    );

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
        `INSERT INTO moderation_events (id, product_id, user_id, source, reason, matches) VALUES ($1, $2, $3, 'publish', $4, $5::jsonb) ON CONFLICT DO NOTHING`,
        [randomUUID(), id, req.telegramUser.id, moderation.adminReason || moderation.reason, JSON.stringify(moderation.matches)]
      );
    }

    if (finalStatus === "active") {
      await recordListingLegalAcceptances(client, {
        userId: req.telegramUser.id, productId: id, legalAcceptance, allowCalls, allowMessages
      });
    }

    const updatedListingQuota = await getListingQuota(client, req.telegramUser.id);
    await client.query("COMMIT");
    res.status(201).json({
      ok: true,
      product: mapProduct(result.rows[0]),
      listingQuota: updatedListingQuota,
      moderation: { blocked: moderation.blocked, reason: moderation.reason }
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Create product error:", error);
    if (error?.code === "23505" && String(error?.constraint || "").includes("phone_normalized")) {
      return res.status(409).json({ ok: false, code: "PHONE_ALREADY_USED", error: "Этот номер уже привязан к другому профилю" });
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
      specifications, status, discountEnabled, originalPrice, legalAcceptance
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
    const legalError = validateListingLegalAcceptance({
      legalAcceptance, status: requestedStatus, allowCalls, allowMessages
    });
    if (legalError) return res.status(400).json({ ok: false, ...legalError });

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

    const cleanImages = (Array.isArray(images) ? images : [])
      .map(normalizeProductImage).filter(Boolean).slice(0, 5);
    const fallbackImage = normalizeProductImage(image);
    if (cleanImages.length === 0 && fallbackImage) cleanImages.push(fallbackImage);
    const requestedThumbnail = normalizeProductImage(thumbnail);

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
      specifications: cleanSpecifications
    }, client);
    const finalStatus = moderation.blocked
      ? "draft"
      : (["active", "draft"].includes(requestedStatus) ? requestedStatus : "active");

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
        requestedStatus, cleanThumbnail, PRODUCT_ARCHIVE_DAYS
      ]
    );

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
        `INSERT INTO moderation_events (id, product_id, user_id, source, reason, matches) VALUES ($1, $2, $3, 'edit', $4, $5::jsonb) ON CONFLICT DO NOTHING`,
        [randomUUID(), productId, req.telegramUser.id, moderation.adminReason || moderation.reason, JSON.stringify(moderation.matches)]
      );
    }

    if (finalStatus === "active") {
      await recordListingLegalAcceptances(client, {
        userId: req.telegramUser.id, productId, legalAcceptance, allowCalls, allowMessages
      });
    }

    await client.query("COMMIT");
    res.json({
      ok: true,
      product: mapProduct(result.rows[0]),
      moderation: { blocked: moderation.blocked, reason: moderation.reason },
      priceChange: {
        changed: priceChanged || discountMetadataChanged,
        dropped: priceDropped,
        discountEnabled: priceDropped
      }
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Update product error:", error);
    if (error?.code === "23505" && String(error?.constraint || "").includes("phone_normalized")) {
      return res.status(409).json({ ok: false, code: "PHONE_ALREADY_USED", error: "Этот номер уже привязан к другому профилю" });
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
    const [similarResult, sellerResult, priceHistoryResult] = await Promise.all([
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
      )
    ]);

    res.json({
      ok: true,
      product: mapPublicProduct(row),
      similarProducts: similarResult.rows.map(mapProductSummary),
      sellerProducts: sellerResult.rows.map(mapProductSummary),
      priceHistory: priceHistoryResult.rows
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
        RETURNING id, views;
      `,
      [productId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        error: "Товар не найден"
      });
    }

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
        [productId, req.telegramUser.id, status, PRODUCT_ARCHIVE_DAYS]
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
    const days = FEATURE_HIGHLIGHT_DAYS;

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
            updated_at = NOW()
        WHERE product_id = $1
          AND owner_id = $2
          AND status = 'pending'
        RETURNING *;
      `,
      [productId, req.telegramUser.id, color, days, FEATURE_HIGHLIGHT_PRICE_RUB]
    );

    if (requestResult.rows.length === 0) {
      requestResult = await pool.query(
        `
          INSERT INTO product_feature_requests (
            id, product_id, owner_id, color, days, price_amount, status
          ) VALUES ($1, $2, $3, $4, $5, $6, 'pending')
          ON CONFLICT DO NOTHING
          RETURNING *;
        `,
        [randomUUID(), productId, req.telegramUser.id, color, days, FEATURE_HIGHLIGHT_PRICE_RUB]
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
    return res.status(403).json({
      ok: false,
      error: "Доступ запрещён"
    });
  }

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
    const [users, products, hidden, banned, pendingReports, pendingModeration, pendingFeatureRequests, activeAds, adRevenue, newUsersToday, newProductsToday] =
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
      newUsersToday: newUsersToday.rows[0].count,
      newProductsToday: newProductsToday.rows[0].count
    });
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
        const days = Math.max(1, Math.min(90, Number(featureRequest.days) || FEATURE_HIGHLIGHT_DAYS));
        const color = FEATURE_COLOR;
        const featuredUntil = new Date(Date.now() + days * 86_400_000);

        await client.query(
          `
            UPDATE products
            SET featured_paid = TRUE,
                featured_color = $2,
                featured_until = $3,
                updated_at = NOW()
            WHERE id = $1;
          `,
          [featureRequest.product_id, color, featuredUntil]
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
       SET listing_limit = $2, updated_at = NOW()
       WHERE telegram_id = $1
       RETURNING telegram_id, username, first_name, last_name, listing_limit`,
      [userId, requestedLimit]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "Пользователь не найден" });
    }

    await addAdminLog(
      req.telegramUser.id,
      "set_listing_limit",
      userId,
      `Лимит объявлений: ${requestedLimit}`
    );

    res.json({ ok: true, user: result.rows[0] });
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


app.get(
  "/api/admin/moderation",
  requireTelegramAuth,
  syncTelegramUser,
  requireAdmin,
  adminRoute(async (req, res) => {
    const [events, rules, settings] = await Promise.all([
      pool.query(`
        SELECT
          m.id, m.product_id, m.user_id, m.source, m.reason, m.matches,
          m.status, m.created_at, p.name AS product_name, p.description,
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
        SELECT enabled, block_links, block_contacts, block_emails, updated_at
        FROM moderation_settings WHERE id = TRUE;
      `)
    ]);

    res.json({
      ok: true,
      events: events.rows,
      rules: rules.rows,
      settings: settings.rows[0] || {},
      policyVersion: MODERATION_POLICY_VERSION,
      categories: MODERATION_CATEGORY_LABELS
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
    const requestedCategory = normalizeText(req.body?.category, 40).toLowerCase();
    const requestedAction = normalizeText(req.body?.action, 20).toLowerCase();
    const category = MODERATION_RULE_CATEGORIES.has(requestedCategory) ? requestedCategory : "custom";
    const action = MODERATION_RULE_ACTIONS.has(requestedAction) ? requestedAction : "review";
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

app.post(
  "/api/admin/moderation/defaults",
  requireTelegramAuth,
  syncTelegramUser,
  requireAdmin,
  adminRoute(async (req, res) => {
    const inserted = await seedDefaultModerationRules(pool);
    await addAdminLog(
      req.telegramUser.id,
      "moderation_defaults_sync",
      MODERATION_POLICY_VERSION,
      `Добавлено правил: ${inserted}`
    );
    res.json({
      ok: true,
      inserted,
      policyVersion: MODERATION_POLICY_VERSION,
      totalInPack: DEFAULT_MODERATION_RULES.length
    });
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
            block_emails = $4, updated_by = $5, updated_at = NOW()
        WHERE id = TRUE
        RETURNING *;
      `,
      [
        normalizeBoolean(req.body?.enabled),
        normalizeBoolean(req.body?.blockLinks),
        normalizeBoolean(req.body?.blockContacts),
        normalizeBoolean(req.body?.blockEmails),
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
