import express from "express";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
import pg from "pg";
import { createTelegramAuthMiddleware } from "./telegram-auth.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const APP_VERSION = "1.10.0";
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
const PRODUCT_STATUSES = new Set(["active", "sold", "draft", "deleted"]);
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
  ssl: DATABASE_SSL ? { rejectUnauthorized: false } : false
});

const requireTelegramAuth = createTelegramAuthMiddleware({
  botToken: BOT_TOKEN,
  maxAgeSeconds: TELEGRAM_AUTH_MAX_AGE_SECONDS
});

app.disable("x-powered-by");
app.use(express.json({ limit: "30mb" }));
app.use(express.static(publicDir));

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
    category: row.category,
    desc: row.description,
    image: images[0] || row.image || "",
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
    hidden: Boolean(row.hidden),
    status: row.status || "active",
    createdAt: row.created_at ? new Date(row.created_at).getTime() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : null
  };

  product.quality = calculateListingQuality(product);
  return product;
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

function normalizeProductImage(value) {
  const image = String(value ?? "").trim();

  if (!image) return "";

  const isDataImage = /^data:image\/(jpeg|jpg|png|webp);base64,[a-z0-9+/=\s]+$/i.test(image);
  const isHttpsImage = /^https:\/\/[^\s"'<>]+$/i.test(image);

  if (!isDataImage && !isHttpsImage) {
    return "";
  }

  // Ограничиваем одно изображение примерно шестью мегабайтами в base64.
  if (image.length > 8_500_000) {
    return "";
  }

  return image;
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
    supportUsername: SUPPORT_USERNAME
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
      return res.status(400).json({
        ok: false,
        error: "Некорректный ID продавца"
      });
    }

    const result = await pool.query(
      `
      SELECT *
      FROM products
      WHERE owner_id = $1
        AND COALESCE(status, 'active') = 'active'
        AND COALESCE(hidden, FALSE) = FALSE
      ORDER BY created_at DESC;
      `,
      [userId]
    );

    res.json({
      ok: true,
      products: result.rows.map(mapProduct)
    });
  } catch (error) {
    console.error("Get seller products error:", error);
    res.status(500).json({
      ok: false,
      error: "Не удалось получить товары продавца"
    });
  }
});

app.get("/api/products", async (req, res) => {
  try {
    const page = normalizePositiveInteger(req.query.page, 1, 100000);
    const limit = normalizePositiveInteger(req.query.limit, 50, 100);
    const offset = (page - 1) * limit;
    const search = normalizeText(req.query.q, 100);
    const requestedCategory = normalizeText(req.query.category, 60);
    const category = PRODUCT_CATEGORIES.has(requestedCategory)
      ? requestedCategory
      : "";

    const conditions = [
      "COALESCE(status, 'active') = $1",
      "COALESCE(hidden, FALSE) = FALSE"
    ];
    const values = [PUBLIC_PRODUCT_STATUS];

    if (search) {
      values.push(`%${search}%`);
      conditions.push(
        `(name ILIKE $${values.length} OR description ILIKE $${values.length} OR category ILIKE $${values.length})`
      );
    }

    if (category) {
      values.push(category);
      conditions.push(`category = $${values.length}`);
    }

    const whereSql = conditions.join(" AND ");
    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS count FROM products WHERE ${whereSql};`,
      values
    );

    const queryValues = [...values, limit, offset];
    const result = await pool.query(
      `
        SELECT *
        FROM products
        WHERE ${whereSql}
        ORDER BY created_at DESC
        LIMIT $${values.length + 1}
        OFFSET $${values.length + 2};
      `,
      queryValues
    );

    const total = countResult.rows[0]?.count || 0;

    res.json({
      ok: true,
      products: result.rows.map(mapProduct),
      pagination: {
        page,
        limit,
        total,
        pages: Math.max(1, Math.ceil(total / limit))
      }
    });
  } catch (error) {
    console.error("Get products error:", error);

    res.status(500).json({
      ok: false,
      error: "Не удалось получить товары"
    });
  }
});

app.get("/api/my-products", requireTelegramAuth, syncTelegramUser, async (req, res) => {
  try {
    const result = await pool.query(
      `
        SELECT *
        FROM products
        WHERE owner_id = $1 AND COALESCE(status, 'active') <> 'deleted'
        ORDER BY created_at DESC;
      `,
      [req.telegramUser.id]
    );

    res.json({
      ok: true,
      products: result.rows.map(mapProduct)
    });
  } catch (error) {
    console.error("Get my products error:", error);

    res.status(500).json({
      ok: false,
      error: "Не удалось получить мои объявления"
    });
  }
});

app.post("/api/products", requireTelegramAuth, syncTelegramUser, async (req, res) => {
  try {
    const {
      name,
      price,
      category,
      desc,
      image,
      images,
      location,
      phone,
      allowMessages,
      condition,
      negotiable,
      delivery,
      district,
      specifications,
      status
    } = req.body;

    const cleanName = normalizeText(name, 120);
    const cleanPrice = formatStoredPrice(price);
    const cleanCategory = normalizeText(category, 60);
    const cleanDescription = normalizeText(desc, 5000);
    const cleanLocation = normalizeText(location, 80) || "Владикавказ";
    const cleanPhone = normalizeText(phone, 30);
    const cleanCondition = normalizeProductCondition(condition);
    const cleanDistrict = normalizeText(district, 80);
    const cleanSpecifications = normalizeSpecifications(specifications);
    const cleanStatus = normalizeProductStatus(status, "active");

    if (!PRODUCT_CATEGORIES.has(cleanCategory)) {
      return res.status(400).json({
        ok: false,
        error: "Выберите допустимую категорию"
      });
    }

    if (!cleanName || !cleanPrice || !cleanCategory || !cleanDescription) {
      return res.status(400).json({
        ok: false,
        error: "Проверьте название, цену, категорию и описание"
      });
    }

    const sourceImages = Array.isArray(images) ? images : [];
    const cleanImages = sourceImages
      .map(normalizeProductImage)
      .filter(Boolean)
      .slice(0, 5);

    const fallbackImage = normalizeProductImage(image);
    if (cleanImages.length === 0 && fallbackImage) {
      cleanImages.push(fallbackImage);
    }

    const mainImage = cleanImages[0] || "";
    const id = randomUUID();
    const ownerName = getTelegramDisplayName(req.telegramUser);

    const result = await pool.query(
      `
        INSERT INTO products (
          id,
          owner_id,
          owner_name,
          owner_username,
          name,
          price,
          category,
          description,
          image,
          images,
          location,
          phone,
          allow_messages,
          condition,
          negotiable,
          delivery,
          district,
          specifications,
          views,
          status
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13, $14, $15, $16, $17, $18::jsonb, 0, $19)
        RETURNING *;
      `,
      [
        id,
        req.telegramUser.id,
        ownerName || "Пользователь Telegram",
        req.telegramUser.username || "",
        cleanName,
        cleanPrice,
        cleanCategory,
        cleanDescription,
        mainImage,
        JSON.stringify(cleanImages),
        cleanLocation,
        cleanPhone,
        allowMessages !== false,
        cleanCondition,
        normalizeBoolean(negotiable),
        normalizeBoolean(delivery),
        cleanDistrict,
        JSON.stringify(cleanSpecifications),
        cleanStatus === "draft" ? "draft" : "active"
      ]
    );

    // Сохраняем изображения отдельно в новой таблице, если она доступна.
    if (cleanImages.length > 0) {
      await Promise.all(
        cleanImages.map((url, index) =>
          pool.query(
            `
              INSERT INTO product_images (
                id,
                product_id,
                url,
                position
              )
              VALUES ($1, $2, $3, $4)
              ON CONFLICT DO NOTHING;
            `,
            [randomUUID(), id, url, index]
          )
        )
      );
    }

    res.json({
      ok: true,
      product: mapProduct(result.rows[0])
    });
  } catch (error) {
    console.error("Create product error:", error);

    res.status(500).json({
      ok: false,
      error: "Не удалось создать объявление"
    });
  }
});

app.patch("/api/products/:id", requireTelegramAuth, syncTelegramUser, async (req, res) => {
  try {
    const productId = normalizeText(req.params.id, 64);
    const {
      name,
      price,
      category,
      desc,
      image,
      images,
      location,
      phone,
      allowMessages,
      condition,
      negotiable,
      delivery,
      district,
      specifications,
      status
    } = req.body;

    if (!productId) {
      return res.status(400).json({
        ok: false,
        error: "Некорректный ID товара"
      });
    }

    const cleanName = normalizeText(name, 120);
    const cleanPrice = formatStoredPrice(price);
    const cleanCategory = normalizeText(category, 60);
    const cleanDescription = normalizeText(desc, 5000);
    const cleanLocation = normalizeText(location, 80) || "Владикавказ";
    const cleanPhone = normalizeText(phone, 30);
    const cleanCondition = normalizeProductCondition(condition);
    const cleanDistrict = normalizeText(district, 80);
    const cleanSpecifications = normalizeSpecifications(specifications);
    const cleanStatus = normalizeProductStatus(status, "active");

    if (!PRODUCT_CATEGORIES.has(cleanCategory)) {
      return res.status(400).json({
        ok: false,
        error: "Выберите допустимую категорию"
      });
    }

    if (!cleanName || !cleanPrice || !cleanDescription) {
      return res.status(400).json({
        ok: false,
        error: "Проверьте название, цену и описание"
      });
    }

    const sourceImages = Array.isArray(images) ? images : [];
    const cleanImages = sourceImages
      .map(normalizeProductImage)
      .filter(Boolean)
      .slice(0, 5);
    const fallbackImage = normalizeProductImage(image);

    if (cleanImages.length === 0 && fallbackImage) {
      cleanImages.push(fallbackImage);
    }

    const mainImage = cleanImages[0] || "";
    const result = await pool.query(
      `
        UPDATE products
        SET name = $3,
            price = $4,
            category = $5,
            description = $6,
            image = $7,
            images = $8::jsonb,
            location = $9,
            phone = $10,
            allow_messages = $11,
            condition = $12,
            negotiable = $13,
            delivery = $14,
            district = $15,
            specifications = $16::jsonb,
            status = $17,
            updated_at = NOW()
        WHERE id = $1
          AND owner_id = $2
          AND COALESCE(status, 'active') <> 'deleted'
        RETURNING *;
      `,
      [
        productId,
        req.telegramUser.id,
        cleanName,
        cleanPrice,
        cleanCategory,
        cleanDescription,
        mainImage,
        JSON.stringify(cleanImages),
        cleanLocation,
        cleanPhone,
        allowMessages !== false,
        cleanCondition,
        normalizeBoolean(negotiable),
        normalizeBoolean(delivery),
        cleanDistrict,
        JSON.stringify(cleanSpecifications),
        ["active", "sold", "draft"].includes(cleanStatus) ? cleanStatus : "active"
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        error: "Объявление не найдено или у вас нет прав"
      });
    }

    res.json({
      ok: true,
      product: mapProduct(result.rows[0])
    });
  } catch (error) {
    console.error("Update product error:", error);
    res.status(500).json({
      ok: false,
      error: "Не удалось обновить объявление"
    });
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
          p.*,
          (SELECT COUNT(*)::int FROM favorites f WHERE f.product_id = p.id) AS favorite_count,
          (SELECT COUNT(*)::int FROM reports r WHERE r.product_id = p.id AND r.status = 'pending') AS report_count
        FROM products p
        WHERE p.id = $1
          AND COALESCE(p.status, 'active') = 'active'
          AND COALESCE(p.hidden, FALSE) = FALSE;
      `,
      [productId]
    );

    if (productResult.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "Товар не найден" });
    }

    const row = productResult.rows[0];
    const [similarResult, sellerResult] = await Promise.all([
      pool.query(
        `
          SELECT
            p.*,
            (SELECT COUNT(*)::int FROM favorites f WHERE f.product_id = p.id) AS favorite_count
          FROM products p
          WHERE p.id <> $1
            AND p.category = $2
            AND COALESCE(p.status, 'active') = 'active'
            AND COALESCE(p.hidden, FALSE) = FALSE
          ORDER BY (p.location = $3) DESC, p.created_at DESC
          LIMIT 6;
        `,
        [productId, row.category, row.location]
      ),
      pool.query(
        `
          SELECT
            p.*,
            (SELECT COUNT(*)::int FROM favorites f WHERE f.product_id = p.id) AS favorite_count
          FROM products p
          WHERE p.id <> $1
            AND p.owner_id = $2
            AND COALESCE(p.status, 'active') = 'active'
            AND COALESCE(p.hidden, FALSE) = FALSE
          ORDER BY p.created_at DESC
          LIMIT 6;
        `,
        [productId, row.owner_id]
      )
    ]);

    res.json({
      ok: true,
      product: mapProduct(row),
      similarProducts: similarResult.rows.map(mapProduct),
      sellerProducts: sellerResult.rows.map(mapProduct)
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
        RETURNING *;
      `,
      [productId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        error: "Товар не найден"
      });
    }

    const favoriteResult = await pool.query(
      "SELECT COUNT(*)::int AS count FROM favorites WHERE product_id = $1",
      [productId]
    );
    result.rows[0].favorite_count = favoriteResult.rows[0]?.count || 0;

    res.json({
      ok: true,
      product: mapProduct(result.rows[0])
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

    if (!productId || !["active", "sold", "draft"].includes(status)) {
      return res.status(400).json({
        ok: false,
        error: "Некорректный статус объявления"
      });
    }

    const result = await pool.query(
      `
        UPDATE products
        SET status = $3,
            updated_at = NOW()
        WHERE id = $1
          AND owner_id = $2
          AND COALESCE(status, 'active') <> 'deleted'
        RETURNING *;
      `,
      [productId, req.telegramUser.id, status]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        error: "Объявление не найдено или у вас нет прав"
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

app.get("/api/favorites", requireTelegramAuth, syncTelegramUser, async (req, res) => {
  try {
    const result = await pool.query(
      `
        SELECT p.*
        FROM favorites f
        JOIN products p ON p.id = f.product_id
        WHERE f.user_id = $1
          AND COALESCE(p.status, 'active') = 'active'
          AND COALESCE(p.hidden, FALSE) = FALSE
        ORDER BY f.created_at DESC;
      `,
      [req.telegramUser.id]
    );

    const products = result.rows.map(mapProduct);

    res.json({
      ok: true,
      favorites: products.map(product => product.id),
      products
    });
  } catch (error) {
    console.error("Get favorites error:", error);

    res.status(500).json({
      ok: false,
      error: "Не удалось получить избранное"
    });
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
          AND COALESCE(hidden, FALSE) = FALSE;
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
          AND COALESCE(hidden, FALSE) = FALSE;
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
    const [users, products, hidden, banned, pendingReports, newUsersToday, newProductsToday] =
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
        (SELECT COUNT(*)::int FROM reports r WHERE r.product_id = products.id AND r.status = 'pending') AS report_count
      FROM products
      WHERE COALESCE(status, 'active') <> 'deleted'
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
        SET hidden = NOT COALESCE(hidden, FALSE),
            updated_at = NOW()
        WHERE id = $1
          AND COALESCE(status, 'active') <> 'deleted'
        RETURNING id, name, hidden;
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
  res.sendFile(path.join(publicDir, "index.html"));
});

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server started on port ${PORT}`);
    });
  })
  .catch(error => {
    console.error("Database init error:", error);
    process.exit(1);
  });
