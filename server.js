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
const BOT_TOKEN = process.env.BOT_TOKEN;
const DATABASE_URL = process.env.DATABASE_URL;
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
  ssl: {
    rejectUnauthorized: false
  }
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

  return {
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
    phone: row.phone || "",
    allowMessages: row.allow_messages !== false,
    views: Number(row.views) || 0,
    status: row.status || "active",
    createdAt: row.created_at ? new Date(row.created_at).getTime() : null
  };
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
  const digits = String(value ?? "").replace(/\D/g, "");
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

  console.log("Database initialized");
}

app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");

    res.json({
      ok: true,
      message: "Server and database are working",
      version: "telegram-auth-v1"
    });
  } catch (error) {
    console.error("Health check error:", error);

    res.status(500).json({
      ok: false,
      error: "Database error"
    });
  }
});

// Сохраняем или обновляем профиль после успешной Telegram-авторизации.
async function syncTelegramUser(req, res, next) {
  try {
    const user = req.telegramUser;

    await pool.query(
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
          last_seen = NOW();
      `,
      [
        String(user.id),
        user.firstName || "",
        user.lastName || "",
        user.username || "",
        user.photoUrl || ""
      ]
    );
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
        WHERE owner_id = $1 AND COALESCE(status, 'active') <> 'deleted'
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
      WHERE owner_id = $1 AND COALESCE(status, 'active') <> 'deleted'
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
    const result = await pool.query(`
      SELECT *
      FROM products
      WHERE COALESCE(status, 'active') <> 'deleted'
      ORDER BY created_at DESC;
    `);

    res.json({
      ok: true,
      products: result.rows.map(mapProduct)
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
      allowMessages
    } = req.body;

    const cleanName = normalizeText(name, 120);
    const cleanPrice = formatStoredPrice(price);
    const cleanCategory = normalizeText(category, 60);
    const cleanDescription = normalizeText(desc, 5000);
    const cleanLocation = normalizeText(location, 80) || "Владикавказ";
    const cleanPhone = normalizeText(phone, 30);

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
          views,
          status
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13, 0, 'active')
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
        allowMessages !== false
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
        WHERE id = $1 AND COALESCE(status, 'active') <> 'deleted'
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

app.delete("/api/products/:id", requireTelegramAuth, syncTelegramUser, async (req, res) => {
  try {
    const productId = normalizeText(req.params.id, 64);

    if (!productId) {
      return res.status(400).json({ ok: false, error: "Некорректный ID товара" });
    }

    const result = await pool.query(
      `
        DELETE FROM products
        WHERE id = $1 AND owner_id = $2
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
        SELECT product_id
        FROM favorites
        WHERE user_id = $1;
      `,
      [req.telegramUser.id]
    );

    res.json({
      ok: true,
      favorites: result.rows.map(row => row.product_id)
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



// Admin enhancements
async function ensureAdminFields(){
  try{
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS banned BOOLEAN DEFAULT FALSE`);
    await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS hidden BOOLEAN DEFAULT FALSE`);
    await pool.query(`CREATE TABLE IF NOT EXISTS admin_logs(
      id SERIAL PRIMARY KEY,
      admin_id TEXT,
      action TEXT,
      target TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )`);
  }catch(e){ console.error("Admin fields:", e.message); }
}
ensureAdminFields();

async function addAdminLog(adminId, action, target){
  await pool.query(
    "INSERT INTO admin_logs(admin_id,action,target) VALUES($1,$2,$3)",
    [String(adminId), action, String(target)]
  );
}

const ADMIN_IDS = String(process.env.ADMIN_TELEGRAM_IDS || "")
  .split(",")
  .map(v => v.trim())
  .filter(Boolean);

function requireAdmin(req, res, next) {
  const id = String(req.telegramUser?.id || req.user?.telegram_id || "");
  if (!ADMIN_IDS.includes(id)) {
    return res.status(403).json({ ok:false, error:"Доступ запрещён" });
  }
  next();
}

app.get("/api/admin/stats", requireTelegramAuth, syncTelegramUser, requireAdmin, async (req,res)=>{
  const users = await pool.query("SELECT COUNT(*)::int AS count FROM users");
  const products = await pool.query("SELECT COUNT(*)::int AS count FROM products");
  res.json({
    ok:true,
    users: users.rows[0].count,
    products: products.rows[0].count
  });
});

app.get("/api/admin/products", requireTelegramAuth, syncTelegramUser, requireAdmin, async (req,res)=>{
  const result = await pool.query(`
    SELECT id,name,price,category,owner_name,created_at,hidden
    FROM products
    ORDER BY id DESC
    LIMIT 100
  `);
  res.json({ok:true, products:result.rows});
});


app.patch("/api/admin/products/:id/hide", requireTelegramAuth, syncTelegramUser, requireAdmin, async(req,res)=>{
  await pool.query("UPDATE products SET hidden=NOT COALESCE(hidden,FALSE) WHERE id=$1",[req.params.id]);
  await addAdminLog(req.telegramUser.id,"toggle_product_visibility",req.params.id);
  res.json({ok:true});
});

app.post("/api/admin/users/:id/ban", requireTelegramAuth, syncTelegramUser, requireAdmin, async(req,res)=>{
  await pool.query("UPDATE users SET banned=TRUE WHERE id=$1",[req.params.id]);
  await addAdminLog(req.telegramUser.id,"ban_user",req.params.id);
  res.json({ok:true});
});

app.get("/api/admin/logs", requireTelegramAuth, syncTelegramUser, requireAdmin, async(req,res)=>{
 const r=await pool.query("SELECT * FROM admin_logs ORDER BY id DESC LIMIT 50");
 res.json({ok:true,logs:r.rows});
});

app.get("/api/admin/search", requireTelegramAuth, syncTelegramUser, requireAdmin, async(req,res)=>{
 const q="%"+String(req.query.q||"")+"%";
 const r=await pool.query("SELECT id,name,price,category,owner_name FROM products WHERE name ILIKE $1 ORDER BY id DESC LIMIT 50",[q]);
 res.json({ok:true,products:r.rows});
});

app.get("/api/admin/growth", requireTelegramAuth, syncTelegramUser, requireAdmin, async(req,res)=>{
 const users=await pool.query("SELECT DATE(created_at) day, COUNT(*) count FROM users GROUP BY day ORDER BY day DESC LIMIT 14");
 const products=await pool.query("SELECT DATE(created_at) day, COUNT(*) count FROM products GROUP BY day ORDER BY day DESC LIMIT 14");
 res.json({ok:true,users:users.rows,products:products.rows});
});

app.delete("/api/admin/products/:id", requireTelegramAuth, syncTelegramUser, requireAdmin, async (req,res)=>{
  await pool.query("DELETE FROM products WHERE id=$1",[req.params.id]);
  res.json({ok:true});
});

app.get("/api/admin/users", requireTelegramAuth, syncTelegramUser, requireAdmin, async(req,res)=>{
  const result = await pool.query(`
    SELECT id,telegram_id,username,first_name,last_seen
    FROM users
    ORDER BY id DESC
    LIMIT 100
  `);
  res.json({ok:true,users:result.rows});
});

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
