import express from "express";
import compression from "compression";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { createHmac, randomUUID, timingSafeEqual } from "crypto";
import pg from "pg";
import { createTelegramAuthMiddleware } from "./telegram-auth.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const APP_VERSION = "1.12.1";
const BOT_TOKEN = process.env.BOT_TOKEN;
const DATABASE_URL = process.env.DATABASE_URL;
const SUPPORT_USERNAME = String(process.env.SUPPORT_USERNAME || "")
  .trim()
  .replace(/^@/, "");
const DATABASE_SSL = String(process.env.DATABASE_SSL || "true").toLowerCase() !== "false";
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
  "Животные"
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
const FEATURE_COLORS = new Set(["gold", "purple", "blue", "green"]);

if (!BOT_TOKEN) {
  console.error("Ошибка: BOT_TOKEN не найден в переменных окружения");
  process.exit(1);
}

if (!DATABASE_URL) {
  console.error("Ошибка: DATABASE_URL не найден в переменных окружения");
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_SSL ? { rejectUnauthorized: false } : false,
  max: 15,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 7_000,
  statement_timeout: 15_000,
  query_timeout: 15_000,
  keepAlive: true
});

const requireTelegramAuth = createTelegramAuthMiddleware({
  botToken: BOT_TOKEN,
  maxAgeSeconds: TELEGRAM_AUTH_MAX_AGE_SECONDS
});

app.disable("x-powered-by");
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
    archivedAt: row.archived_at ? new Date(row.archived_at).getTime() : null,
    expiresAt: row.expires_at ? new Date(row.expires_at).getTime() : null,
    featuredUntil: row.featured_until ? new Date(row.featured_until).getTime() : null,
    featuredColor: FEATURE_COLORS.has(row.featured_color) ? row.featured_color : "gold",
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
  p.condition,
  p.negotiable,
  p.delivery,
  p.specifications,
  p.views,
  p.status,
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
    hidden: Boolean(row.hidden),
    moderationStatus: MODERATION_STATUSES.has(row.moderation_status) ? row.moderation_status : "approved",
    moderationReason: row.moderation_reason || "",
    archivedAt: row.archived_at ? new Date(row.archived_at).getTime() : null,
    expiresAt: row.expires_at ? new Date(row.expires_at).getTime() : null,
    featuredUntil: row.featured_until ? new Date(row.featured_until).getTime() : null,
    featuredColor: FEATURE_COLORS.has(row.featured_color) ? row.featured_color : "gold",
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

  return {
    id: String(row.telegram_id || row.owner_id || ""),
    username: row.username || row.owner_username || "",
    firstName,
    lastName,
    displayName:
      `${firstName} ${lastName}`.trim() || row.owner_name || "Продавец",
    avatar: row.avatar || "",
    lastSeen: row.last_seen ? new Date(row.last_seen).getTime() : null,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : null
  };
}

function normalizeText(value, maxLength) {
  return String(value ?? "").trim().slice(0, maxLength);
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

  return {
    blocked: uniqueMatches.length > 0,
    reason: uniqueMatches.map(item => item.label).join("; ").slice(0, 1000),
    matches: uniqueMatches.slice(0, 20)
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

  const response = await fetch(url);
  const data = await response.json();

  if (!response.ok || !data.ok) {
    throw new Error(`Telegram Bot API method ${method} failed`);
  }

  return data.result;
}

async function resolveTelegramAvatarUrl(user) {
  if (user.photoUrl) {
    return user.photoUrl;
  }

  const profilePhotos = await fetchTelegramJson("getUserProfilePhotos", {
    user_id: user.id,
    limit: 1
  });

  const photos = profilePhotos?.photos || [];

  if (photos.length === 0) {
    return null;
  }

  const sizes = photos[0];
  const biggestPhoto = sizes[sizes.length - 1];
  const file = await fetchTelegramJson("getFile", {
    file_id: biggestPhoto.file_id
  });

  if (!file?.file_path) {
    return null;
  }

  return `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;
}

async function initDb() {
  await pool.query(`
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
      views INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`
    ALTER TABLE products
    ADD COLUMN IF NOT EXISTS phone TEXT DEFAULT '';
  `);

  await pool.query(`
    ALTER TABLE products
    ADD COLUMN IF NOT EXISTS allow_messages BOOLEAN DEFAULT true;
  `);

  await pool.query(`
    ALTER TABLE products
    ADD COLUMN IF NOT EXISTS images JSONB DEFAULT '[]'::jsonb;
  `);

  await pool.query(`
    ALTER TABLE products
    ADD COLUMN IF NOT EXISTS thumbnail TEXT DEFAULT '';
  `);

  await pool.query(`
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

  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS username TEXT;
  `);

  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS first_name TEXT;
  `);

  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS last_name TEXT;
  `);

  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS avatar TEXT;
  `);

  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS last_seen TIMESTAMPTZ DEFAULT NOW();
  `);

  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
  `);
  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS banned BOOLEAN DEFAULT FALSE;
  `);

  await pool.query(`
    ALTER TABLE products
    ADD COLUMN IF NOT EXISTS hidden BOOLEAN DEFAULT FALSE;
  `);

  await pool.query(`
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
  await pool.query(`
    ALTER TABLE admin_logs
    ALTER COLUMN id DROP DEFAULT;
  `);

  await pool.query(`
    ALTER TABLE admin_logs
    ALTER COLUMN id TYPE TEXT USING id::text;
  `);

  await pool.query(`
    ALTER TABLE admin_logs
    ADD COLUMN IF NOT EXISTS details TEXT DEFAULT '';
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS favorites (
      user_id TEXT NOT NULL,
      product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (user_id, product_id)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS product_images (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      url TEXT NOT NULL,
      preview_url TEXT DEFAULT '',
      position INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS product_feature_requests (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      owner_id TEXT NOT NULL,
      color TEXT DEFAULT 'gold',
      days INTEGER DEFAULT 7,
      price_amount NUMERIC(12,2) DEFAULT 0,
      status TEXT DEFAULT 'pending',
      approved_by TEXT DEFAULT '',
      approved_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_product_feature_requests_pending
    ON product_feature_requests (product_id, owner_id)
    WHERE status = 'pending';
  `);

  await pool.query(`
    ALTER TABLE products
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
  `);

  await pool.query(`
    ALTER TABLE products
    ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';
  `);

  await pool.query(`
    ALTER TABLE products
    ADD COLUMN IF NOT EXISTS condition TEXT DEFAULT 'used';
  `);

  await pool.query(`
    ALTER TABLE products
    ADD COLUMN IF NOT EXISTS negotiable BOOLEAN DEFAULT FALSE;
  `);

  await pool.query(`
    ALTER TABLE products
    ADD COLUMN IF NOT EXISTS delivery BOOLEAN DEFAULT FALSE;
  `);

  await pool.query(`
    ALTER TABLE products
    ADD COLUMN IF NOT EXISTS district TEXT DEFAULT '';
  `);

  await pool.query(`
    ALTER TABLE products
    ADD COLUMN IF NOT EXISTS specifications JSONB DEFAULT '{}'::jsonb;
  `);

  await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS price_amount BIGINT;`);
  await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS previous_price TEXT DEFAULT '';`);
  await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS previous_price_amount BIGINT;`);
  await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS price_dropped_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS moderation_status TEXT DEFAULT 'approved';`);
  await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS moderation_reason TEXT DEFAULT '';`);
  await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS moderation_matches JSONB DEFAULT '[]'::jsonb;`);
  await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS auto_hidden BOOLEAN DEFAULT FALSE;`);
  await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS moderation_target_status TEXT DEFAULT 'active';`);
  await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS featured_until TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS featured_color TEXT DEFAULT 'gold';`);
  await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS featured_paid BOOLEAN DEFAULT FALSE;`);
  await pool.query(`
    UPDATE products
    SET published_at = COALESCE(published_at, created_at, NOW()),
        expires_at = COALESCE(expires_at, COALESCE(published_at, created_at, NOW()) + ($1::int * INTERVAL '1 day'))
    WHERE COALESCE(status, 'active') = 'active';
  `, [PRODUCT_ARCHIVE_DAYS]);

  await pool.query(`
    UPDATE products
    SET price_amount = NULLIF(regexp_replace(price, '[^0-9]', '', 'g'), '')::BIGINT
    WHERE price_amount IS NULL;
  `);
  await pool.query(`
    UPDATE products
    SET moderation_status = 'approved'
    WHERE moderation_status IS NULL OR moderation_status = '';
  `);

  await pool.query(`
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

  await pool.query(`
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
  await pool.query(`
    INSERT INTO moderation_settings (id)
    VALUES (TRUE)
    ON CONFLICT (id) DO NOTHING;
  `);

  await pool.query(`
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
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_moderation_rules_unique_pattern
    ON moderation_rules (LOWER(pattern), match_type);
  `);

  const moderationRuleCount = await pool.query(
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
      await pool.query(
        `
          INSERT INTO moderation_rules (id, pattern, match_type, note, created_by)
          VALUES ($1, $2, $3, 'Базовое правило проекта', 'system')
          ON CONFLICT DO NOTHING;
        `,
        [id, pattern, matchType]
      );
    }
  }

  await pool.query(`
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

  await pool.query(`
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

  await pool.query(`ALTER TABLE advertising_campaigns ADD COLUMN IF NOT EXISTS billing_model TEXT DEFAULT 'flat';`);
  await pool.query(`ALTER TABLE advertising_campaigns ADD COLUMN IF NOT EXISTS rate_amount NUMERIC(12,2) DEFAULT 0;`);
  await pool.query(`ALTER TABLE advertising_campaigns ADD COLUMN IF NOT EXISTS is_paid BOOLEAN DEFAULT FALSE;`);
  await pool.query(`
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

  await pool.query(`
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

  await pool.query(`
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

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_reports_status_created_at
    ON reports (status, created_at DESC);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_reports_product_id
    ON reports (product_id);
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_unique_pending
    ON reports (product_id, reporter_id)
    WHERE status = 'pending';
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_products_status_created_at
    ON products (status, created_at DESC);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_products_owner_created_at
    ON products (owner_id, created_at DESC);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_favorites_user_id
    ON favorites (user_id);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_products_category_location
    ON products (category, location, created_at DESC);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_products_moderation_status
    ON products (moderation_status, created_at DESC);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_price_history_product
    ON product_price_history (product_id, created_at DESC);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_moderation_events_status
    ON moderation_events (status, created_at DESC);
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_moderation_events_unique_pending
    ON moderation_events (product_id)
    WHERE status = 'pending';
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_ad_campaigns_delivery
    ON advertising_campaigns (status, placement, priority DESC, created_at DESC);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_products_public_feed
    ON products (created_at DESC)
    WHERE status = 'active'
      AND hidden = FALSE
      AND moderation_status = 'approved';
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_product_images_product_position
    ON product_images (product_id, position);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_products_expiry
    ON products (expires_at)
    WHERE status = 'active';
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_products_featured
    ON products (featured_until DESC)
    WHERE featured_paid = TRUE;
  `);

  console.log("Database initialized");
}

app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");

    res.json({
      ok: true,
      message: "Server and database are working",
      version: APP_VERSION
    });
  } catch (error) {
    console.error("Health check error:", error);

    res.status(500).json({
      ok: false,
      error: "Database error"
    });
  }
});

app.get("/api/config", (req, res) => {
  res.json({
    ok: true,
    version: APP_VERSION,
    supportUsername: SUPPORT_USERNAME,
    productArchiveDays: PRODUCT_ARCHIVE_DAYS,
    featureHighlightPriceRub: FEATURE_HIGHLIGHT_PRICE_RUB,
    featureHighlightDays: FEATURE_HIGHLIGHT_DAYS
  });
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

app.get("/api/me", requireTelegramAuth, syncTelegramUser, (req, res) => {
  res.json({
    ok: true,
    user: req.telegramUser
  });
});

app.get("/api/avatar", requireTelegramAuth, syncTelegramUser, async (req, res) => {
  try {
    const avatarUrl = await resolveTelegramAvatarUrl(req.telegramUser);

    if (!avatarUrl) {
      return res.status(404).json({
        ok: false,
        error: "Фото профиля не найдено"
      });
    }

    const avatarResponse = await fetch(avatarUrl);

    if (!avatarResponse.ok) {
      return res.status(502).json({
        ok: false,
        error: "Не удалось загрузить фото Telegram"
      });
    }

    const contentLength = Number(avatarResponse.headers.get("content-length") || 0);

    if (contentLength > 5 * 1024 * 1024) {
      return res.status(413).json({
        ok: false,
        error: "Фото Telegram слишком большое"
      });
    }

    const avatarBuffer = Buffer.from(await avatarResponse.arrayBuffer());

    if (avatarBuffer.length > 5 * 1024 * 1024) {
      return res.status(413).json({
        ok: false,
        error: "Фото Telegram слишком большое"
      });
    }

    res.setHeader(
      "Content-Type",
      avatarResponse.headers.get("content-type") || "image/jpeg"
    );
    res.setHeader("Cache-Control", "private, max-age=300");
    return res.send(avatarBuffer);
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
        SELECT telegram_id, username, first_name, last_name, avatar, last_seen, created_at
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

    const result = await pool.query(
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

    res.setHeader("Cache-Control", "public, max-age=15, stale-while-revalidate=30");
    res.json({ ok: true, products: result.rows.map(mapProductSummary) });
  } catch (error) {
    console.error("Get seller products error:", error);
    res.status(500).json({ ok: false, error: "Не удалось получить товары продавца" });
  }
});

function sendProductMedia(res, source, cacheSeconds = 86_400, cacheScope = "public") {
  const value = String(source || "").trim();

  if (/^https:\/\/[^\s"'<>]+$/i.test(value)) {
    res.setHeader("Cache-Control", `${cacheScope}, max-age=${cacheSeconds}, stale-while-revalidate=604800`);
    return res.redirect(302, value);
  }

  const match = value.match(/^data:image\/(jpeg|jpg|png|webp);base64,([a-z0-9+/=\s]+)$/i);
  if (!match) return res.status(404).end();

  try {
    const mimeSubtype = match[1].toLowerCase() === "jpg" ? "jpeg" : match[1].toLowerCase();
    const buffer = Buffer.from(match[2].replace(/\s+/g, ""), "base64");
    if (!buffer.length) return res.status(404).end();

    res.setHeader("Content-Type", `image/${mimeSubtype}`);
    res.setHeader("Content-Length", String(buffer.length));
    res.setHeader("Cache-Control", `${cacheScope}, max-age=${cacheSeconds}, stale-while-revalidate=604800`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.send(buffer);
  } catch (error) {
    console.error("Product media decode error:", error);
    return res.status(500).end();
  }
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
        SELECT COALESCE(
          (SELECT NULLIF(pi.preview_url, '') FROM product_images pi WHERE pi.product_id = p.id ORDER BY pi.position ASC LIMIT 1),
          NULLIF(p.thumbnail, ''),
          (SELECT NULLIF(pi.url, '') FROM product_images pi WHERE pi.product_id = p.id ORDER BY pi.position ASC LIMIT 1),
          NULLIF(p.image, ''),
          CASE
            WHEN jsonb_typeof(p.images) = 'array' THEN p.images ->> 0
            ELSE NULL
          END
        ) AS source
        FROM products p
        WHERE p.id = $1
          AND p.owner_id = $2
          AND COALESCE(status, 'active') <> 'deleted'
        LIMIT 1;
      `,
      [productId, ownerId]
    );

    if (result.rows.length === 0) return res.status(404).end();
    return sendProductMedia(res, result.rows[0].source, 3_600, "private");
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
        SELECT COALESCE(
          (SELECT NULLIF(pi.preview_url, '') FROM product_images pi WHERE pi.product_id = p.id ORDER BY pi.position ASC LIMIT 1),
          NULLIF(p.thumbnail, ''),
          (SELECT NULLIF(pi.url, '') FROM product_images pi WHERE pi.product_id = p.id ORDER BY pi.position ASC LIMIT 1),
          NULLIF(p.image, ''),
          CASE
            WHEN jsonb_typeof(p.images) = 'array' THEN p.images ->> 0
            ELSE NULL
          END
        ) AS source
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
    return sendProductMedia(res, result.rows[0].source);
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
        SELECT COALESCE(
          (SELECT NULLIF(pi.url, '')
           FROM product_images pi
           WHERE pi.product_id = p.id
           ORDER BY pi.position ASC, pi.created_at ASC
           OFFSET $2 LIMIT 1),
          CASE
            WHEN jsonb_typeof(p.images) = 'array' THEN
              COALESCE(p.images ->> $2, CASE WHEN $2 = 0 THEN NULLIF(p.image, '') END)
            WHEN $2 = 0 THEN NULLIF(p.image, '')
            ELSE NULL
          END
        ) AS source
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
    return sendProductMedia(res, result.rows[0].source);
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

    const conditions = [
      "COALESCE(p.status, 'active') = $1",
      "COALESCE(p.hidden, FALSE) = FALSE",
      "COALESCE(p.moderation_status, 'approved') = 'approved'"
    ];
    const values = [PUBLIC_PRODUCT_STATUS];

    const searchTerms = search
      ? [...new Set(search.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean))].slice(0, 6)
      : [];

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
        WHEN LOWER(COALESCE(p.name, '')) = ${fullSearchParameter} THEN 4
        WHEN LOWER(COALESCE(p.name, '')) LIKE '%' || ${fullSearchParameter} || '%' THEN 3
        WHEN LOWER(COALESCE(p.category, '')) LIKE '%' || ${fullSearchParameter} || '%' THEN 2
        WHEN LOWER(COALESCE(p.description, '')) LIKE '%' || ${fullSearchParameter} || '%' THEN 1
        ELSE 0
      END`;
    }

    if (category) {
      values.push(category);
      conditions.push(`p.category = $${values.length}`);
    }

    const whereSql = conditions.join(" AND ");
    const orderBySql = [
      "CASE WHEN p.featured_paid = TRUE AND p.featured_until > NOW() THEN 1 ELSE 0 END DESC",
      ...(relevanceSql ? [`${relevanceSql} DESC`] : []),
      "p.featured_until DESC NULLS LAST",
      "p.created_at DESC"
    ].join(",\n          ");
    const queryValues = [...values, limit + 1, offset];
    const result = await pool.query(
      `
        SELECT ${PRODUCT_SUMMARY_COLUMNS}
        FROM products p
        WHERE ${whereSql}
        ORDER BY
          ${orderBySql}
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

    res.json({ ok: true, products: result.rows.map(mapOwnProductSummary) });
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
          AND COALESCE(status, 'active') <> 'deleted';
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
      allowMessages, condition, negotiable, delivery, district,
      specifications, status
    } = req.body;

    const cleanName = normalizeText(name, 120);
    const cleanPrice = formatStoredPrice(price);
    const cleanPriceAmount = parsePriceAmount(cleanPrice);
    const cleanCategory = normalizeText(category, 60);
    const cleanDescription = normalizeText(desc, 5000);
    const cleanLocation = normalizeText(location, 80) || "Владикавказ";
    const cleanPhone = normalizeText(phone, 30);
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

    const sourceImages = Array.isArray(images) ? images : [];
    const cleanImages = sourceImages.map(normalizeProductImage).filter(Boolean).slice(0, 5);
    const fallbackImage = normalizeProductImage(image);
    if (cleanImages.length === 0 && fallbackImage) cleanImages.push(fallbackImage);
    const cleanThumbnail = normalizeProductImage(thumbnail) || cleanImages[0] || "";

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

    await client.query("BEGIN");
    const result = await client.query(
      `
        INSERT INTO products (
          id, owner_id, owner_name, owner_username, name, price, price_amount,
          category, description, image, images, location, phone, allow_messages,
          condition, negotiable, delivery, district, specifications, views, status,
          hidden, auto_hidden, moderation_status, moderation_reason, moderation_matches,
          moderation_target_status, published_at, expires_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13,
          $14, $15, $16, $17, $18, $19::jsonb, 0, $20, $21, $22, $23, $24, $25::jsonb, $26,
          CASE WHEN $20 = 'active' THEN NOW() ELSE NULL END,
          CASE WHEN $20 = 'active' THEN NOW() + ($27::int * INTERVAL '1 day') ELSE NULL END
        )
        RETURNING *;
      `,
      [
        id, req.telegramUser.id, ownerName || "Пользователь Telegram",
        req.telegramUser.username || "", cleanName, cleanPrice, cleanPriceAmount,
        cleanCategory, cleanDescription, cleanImages[0] || "", JSON.stringify(cleanImages),
        cleanLocation, cleanPhone, allowMessages !== false, cleanCondition,
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
        [randomUUID(), id, req.telegramUser.id, moderation.reason, JSON.stringify(moderation.matches)]
      );
    }

    await client.query("COMMIT");
    res.status(201).json({
      ok: true,
      product: mapProduct(result.rows[0]),
      moderation: { blocked: moderation.blocked, reason: moderation.reason }
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Create product error:", error);
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
      allowMessages, condition, negotiable, delivery, district,
      specifications, status
    } = req.body;

    if (!productId) return res.status(400).json({ ok: false, error: "Некорректный ID товара" });

    const cleanName = normalizeText(name, 120);
    const cleanPrice = formatStoredPrice(price);
    const cleanPriceAmount = parsePriceAmount(cleanPrice);
    const cleanCategory = normalizeText(category, 60);
    const cleanDescription = normalizeText(desc, 5000);
    const cleanLocation = normalizeText(location, 80) || "Владикавказ";
    const cleanPhone = normalizeText(phone, 30);
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
    const existingImages = normalizeImages(existing);
    const mainImageChanged = String(cleanImages[0] || "") !== String(existingImages[0] || existing.image || "");
    const cleanThumbnail = requestedThumbnail || (!mainImageChanged ? existing.thumbnail : "") || cleanImages[0] || "";
    const oldPriceAmount = Number(existing.price_amount) || parsePriceAmount(existing.price);
    const priceChanged = oldPriceAmount > 0 && oldPriceAmount !== cleanPriceAmount;
    const priceDropped = priceChanged && cleanPriceAmount < oldPriceAmount;
    const moderation = await evaluateProductModeration({
      name: cleanName,
      desc: cleanDescription,
      location: cleanLocation,
      district: cleanDistrict,
      specifications: cleanSpecifications
    }, client);
    const finalStatus = moderation.blocked
      ? "draft"
      : (["active", "sold", "draft"].includes(requestedStatus) ? requestedStatus : "active");

    const result = await client.query(
      `
        UPDATE products
        SET name = $3, price = $4, price_amount = $5, category = $6,
            description = $7, image = $8, images = $9::jsonb, location = $10,
            phone = $11, allow_messages = $12, condition = $13, negotiable = $14,
            delivery = $15, district = $16, specifications = $17::jsonb, status = $18,
            previous_price = CASE WHEN $19 THEN price ELSE previous_price END,
            previous_price_amount = CASE WHEN $19 THEN COALESCE(price_amount, $20) ELSE previous_price_amount END,
            price_dropped_at = CASE WHEN $19 THEN NOW() ELSE price_dropped_at END,
            moderation_status = $21, moderation_reason = $22,
            moderation_matches = $23::jsonb,
            moderation_target_status = $25,
            hidden = CASE
              WHEN $24 THEN TRUE
              WHEN COALESCE(auto_hidden, FALSE) = TRUE THEN FALSE
              ELSE hidden
            END,
            auto_hidden = $24,
            thumbnail = $26,
            published_at = CASE WHEN $18 = 'active' AND COALESCE(status, '') <> 'active' THEN NOW() ELSE published_at END,
            expires_at = CASE WHEN $18 = 'active' AND COALESCE(status, '') <> 'active' THEN NOW() + ($27::int * INTERVAL '1 day') ELSE expires_at END,
            archived_at = CASE WHEN $18 = 'active' THEN NULL ELSE archived_at END,
            updated_at = NOW()
        WHERE id = $1 AND owner_id = $2
        RETURNING *;
      `,
      [
        productId, req.telegramUser.id, cleanName, cleanPrice, cleanPriceAmount,
        cleanCategory, cleanDescription, cleanImages[0] || "", JSON.stringify(cleanImages),
        cleanLocation, cleanPhone, allowMessages !== false, cleanCondition,
        normalizeBoolean(negotiable), normalizeBoolean(delivery), cleanDistrict,
        JSON.stringify(cleanSpecifications), finalStatus, priceDropped, oldPriceAmount,
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
        [randomUUID(), productId, req.telegramUser.id, moderation.reason, JSON.stringify(moderation.matches)]
      );
    }

    await client.query("COMMIT");
    res.json({
      ok: true,
      product: mapProduct(result.rows[0]),
      moderation: { blocked: moderation.blocked, reason: moderation.reason },
      priceChange: { changed: priceChanged, dropped: priceDropped }
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Update product error:", error);
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
  try {
    const productId = normalizeText(req.params.id, 64);
    const status = normalizeProductStatus(req.body?.status, "");

    if (!productId || !["active", "sold", "draft", "archived"].includes(status)) {
      return res.status(400).json({
        ok: false,
        error: "Некорректный статус объявления"
      });
    }

    const result = await pool.query(
      `
        UPDATE products
        SET status = $3,
            published_at = CASE WHEN $3 = 'active' THEN NOW() ELSE published_at END,
            expires_at = CASE WHEN $3 = 'active' THEN NOW() + ($4::int * INTERVAL '1 day') ELSE expires_at END,
            archived_at = CASE WHEN $3 = 'archived' THEN NOW() WHEN $3 = 'active' THEN NULL ELSE archived_at END,
            updated_at = NOW()
        WHERE id = $1
          AND owner_id = $2
          AND COALESCE(status, 'active') <> 'deleted'
          AND ($3 <> 'active' OR COALESCE(moderation_status, 'approved') = 'approved')
        RETURNING *;
      `,
      [productId, req.telegramUser.id, status, PRODUCT_ARCHIVE_DAYS]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        error: status === "active"
          ? "Объявление заблокировано модерацией или у вас нет прав"
          : "Объявление не найдено или у вас нет прав"
      });
    }

    res.json({
      ok: true,
      product: mapProduct(result.rows[0])
    });
  } catch (error) {
    console.error("Update product status error:", error);
    res.status(500).json({
      ok: false,
      error: "Не удалось изменить статус объявления"
    });
  }
});

app.post("/api/products/:id/feature-request", requireTelegramAuth, syncTelegramUser, async (req, res) => {
  try {
    const productId = normalizeText(req.params.id, 64);
    const color = FEATURE_COLORS.has(req.body?.color) ? req.body.color : "gold";
    const days = FEATURE_HIGHLIGHT_DAYS;

    if (!productId) {
      return res.status(400).json({ ok: false, error: "Некорректный ID объявления" });
    }

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
          AND COALESCE(status, 'active') <> 'deleted'
        RETURNING id;
      `,
      [productId, req.telegramUser.id]
    );

    if (result.rows.length === 0) {
      return res.status(403).json({
        ok: false,
        error: "Нет прав на удаление или товар не найден"
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
    const [users, products, hidden, banned, pendingReports, pendingModeration, activeAds, adRevenue, newUsersToday, newProductsToday] =
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
      activeAds: activeAds.rows[0].count,
      adRevenue: Number(adRevenue.rows[0].amount) || 0,
      newUsersToday: newUsersToday.rows[0].count,
      newProductsToday: newProductsToday.rows[0].count
    });
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
      WHERE COALESCE(status, 'active') <> 'deleted'
      ORDER BY pending_feature_requests DESC, created_at DESC
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
          AND COALESCE(status, 'active') <> 'deleted'
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
    const color = FEATURE_COLORS.has(req.body?.color) ? req.body.color : "gold";
    const featuredUntil = enabled ? new Date(Date.now() + days * 86_400_000) : null;

    const result = await pool.query(
      `
        UPDATE products
        SET featured_paid = $2,
            featured_color = $3,
            featured_until = $4,
            updated_at = NOW()
        WHERE id = $1
          AND COALESCE(status, 'active') <> 'deleted'
          AND ($2 = FALSE OR status = 'active')
        RETURNING id, name, featured_paid, featured_color, featured_until;
      `,
      [productId, enabled, color, featuredUntil]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "Объявление не найдено" });
    }

    if (enabled) {
      await pool.query(
        `
          UPDATE product_feature_requests
          SET status = 'approved',
              approved_by = $2,
              approved_at = NOW(),
              updated_at = NOW()
          WHERE product_id = $1
            AND status = 'pending';
        `,
        [productId, req.telegramUser.id]
      );
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
        SELECT id, pattern, match_type, is_active, note, created_by, created_at, updated_at
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
      settings: settings.rows[0] || {}
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
    if (pattern.length < 2 || !MODERATION_MATCH_TYPES.has(matchType)) {
      return res.status(400).json({ ok: false, error: "Проверьте выражение и тип правила" });
    }

    const result = await pool.query(
      `
        INSERT INTO moderation_rules (id, pattern, match_type, note, created_by)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT DO NOTHING
        RETURNING *;
      `,
      [randomUUID(), pattern, matchType, note, req.telegramUser.id]
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
            COUNT(p.id)::int AS products_count
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
        COUNT(p.id)::int AS products_count
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


// iOS Telegram Mini App call bridge
app.get("/call", (req, res) => {
  const phone = String(req.query.phone || "").replace(/[^0-9+]/g, "").slice(0, 20);

  if (!phone) {
    return res.status(400).send("Phone missing");
  }

  res.send(`<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Позвонить</title>
<style>
body {
  font-family: Arial, sans-serif;
  text-align:center;
  padding-top:80px;
}
a {
 display:inline-block;
 padding:18px 35px;
 background:#635bff;
 color:white;
 border-radius:14px;
 text-decoration:none;
 font-size:20px;
}
</style>
</head>
<body>
<h2>Позвонить продавцу</h2>
<p>${phone}</p>
<a href="tel:${phone}">📞 Позвонить</a>
</body>
</html>`);
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

    const purged = await pool.query(
      `
        DELETE FROM products
        WHERE status = 'deleted'
          AND updated_at <= NOW() - ($1::int * INTERVAL '1 day')
        RETURNING id;
      `,
      [DELETED_PRODUCT_RETENTION_DAYS]
    );

    if (archived.rowCount || purged.rowCount) {
      console.log(`Lifecycle maintenance: archived=${archived.rowCount}, purged=${purged.rowCount}`);
    }
  } catch (error) {
    console.error("Product lifecycle maintenance error:", error);
  }
}

initDb()
  .then(async () => {
    await runProductLifecycleMaintenance();
    const lifecycleTimer = setInterval(runProductLifecycleMaintenance, 60 * 60 * 1000);
    lifecycleTimer.unref?.();

    app.listen(PORT, () => {
      console.log(`Server started on port ${PORT}`);
    });
  })
  .catch(error => {
    console.error("Database init error:", error);
    process.exit(1);
  });
