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
app.use(express.json({ limit: "80mb" }));
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
    allowMessages: row.allow_messages,
    views: row.views,
    status: row.status,
    createdAt: new Date(row.created_at).getTime()
  };
}

function getTelegramDisplayName(user) {
  return `${user.firstName || ""} ${user.lastName || ""}`.trim();
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

app.use(async (req, res, next) => {
  try {

    if (req.telegramUser) {

      await pool.query(`
        INSERT INTO users
        (
          telegram_id,
          first_name,
          avatar,
          last_seen
        )

        VALUES ($1,$2,$3,NOW())

        ON CONFLICT (telegram_id)

        DO UPDATE SET

        first_name = EXCLUDED.first_name,
        avatar = EXCLUDED.avatar,
        last_seen = NOW()
      `,
      [
        String(req.telegramUser.id),
        req.telegramUser.firstName || '',
        req.telegramUser.photo_url || ''
      ]);

    }

  } catch(e) {

    console.log("USER SAVE ERROR:", e.message);

  }

  next();

});

app.get("/api/me", requireTelegramAuth, (req, res) => {
  res.json({
    ok: true,
    user: req.telegramUser
  });
});

app.get("/api/avatar", requireTelegramAuth, async (req, res) => {
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


app.get("/api/users/:id/products", async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT *
      FROM products
      WHERE owner_id = $1 AND status != 'deleted'
      ORDER BY created_at DESC;
      `,
      [req.params.id]
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
      WHERE status != 'deleted'
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

app.get("/api/my-products", requireTelegramAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `
        SELECT *
        FROM products
        WHERE owner_id = $1 AND status != 'deleted'
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

app.post("/api/products", requireTelegramAuth, async (req, res) => {
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

    if (!name || !price || !category || !desc) {
      return res.status(400).json({
        ok: false,
        error: "Не все обязательные поля заполнены"
      });
    }

    const cleanImages = Array.isArray(images)
      ? images.filter(Boolean).slice(0, 5)
      : [];

    if (cleanImages.length === 0 && image) {
      cleanImages.push(image);
    }

    const mainImage = cleanImages[0] || image || "";
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
        name,
        price,
        category,
        desc,
        mainImage,
        JSON.stringify(cleanImages),
        location || "Владикавказ",
        phone || "",
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
      error: error.message || "Не удалось создать объявление"
    });
  }
});

app.post("/api/products/:id/view", requireTelegramAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `
        UPDATE products
        SET views = views + 1
        WHERE id = $1 AND status != 'deleted'
        RETURNING *;
      `,
      [req.params.id]
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

app.delete("/api/products/:id", requireTelegramAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `
        DELETE FROM products
        WHERE id = $1 AND owner_id = $2
        RETURNING id;
      `,
      [req.params.id, req.telegramUser.id]
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

app.get("/api/favorites", requireTelegramAuth, async (req, res) => {
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

app.post("/api/favorites", requireTelegramAuth, async (req, res) => {
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

app.use("/api", (req, res) => {
  res.status(404).json({
    ok: false,
    error: "API-маршрут не найден"
  });
});


// iOS Telegram Mini App call bridge
app.get("/call", (req, res) => {
  const phone = String(req.query.phone || "").replace(/[^0-9+]/g, "");

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
