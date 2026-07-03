import express from "express";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";

dotenv.config();

const app = express();

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;
const DATABASE_URL = process.env.DATABASE_URL;

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

app.use(express.json({ limit: "80mb" }));
app.use(express.static(__dirname));

function generateId() {
  return "_" + Math.random().toString(36).substr(2, 9);
}

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
    CREATE TABLE IF NOT EXISTS favorites (
      user_id TEXT NOT NULL,
      product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (user_id, product_id)
    );
  `);

  console.log("Database initialized");
}

app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");

    res.json({
      ok: true,
      message: "Server and database are working",
      version: "products-5-photos"
    });
  } catch (error) {
    console.error("Health check error:", error);

    res.status(500).json({
      ok: false,
      error: "Database error"
    });
  }
});

app.get("/api/avatar/:userId", async (req, res) => {
  try {
    const userId = req.params.userId;

    if (!userId) {
      return res.status(400).json({
        ok: false,
        error: "userId is required"
      });
    }

    const photosUrl =
      `https://api.telegram.org/bot${BOT_TOKEN}/getUserProfilePhotos?user_id=${userId}&limit=1`;

    const photosResponse = await fetch(photosUrl);
    const photosData = await photosResponse.json();

    if (!photosData.ok) {
      return res.status(400).json({
        ok: false,
        error: "getUserProfilePhotos failed",
        details: photosData
      });
    }

    const photos = photosData.result?.photos || [];

    if (photos.length === 0) {
      return res.json({
        ok: true,
        avatarUrl: null,
        message: "Фото профиля не найдено"
      });
    }

    const sizes = photos[0];
    const biggestPhoto = sizes[sizes.length - 1];
    const fileId = biggestPhoto.file_id;

    const fileUrl =
      `https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`;

    const fileResponse = await fetch(fileUrl);
    const fileData = await fileResponse.json();

    if (!fileData.ok) {
      return res.status(400).json({
        ok: false,
        error: "getFile failed",
        details: fileData
      });
    }

    const filePath = fileData.result?.file_path;

    if (!filePath) {
      return res.json({
        ok: true,
        avatarUrl: null,
        message: "Telegram не вернул file_path"
      });
    }

    const avatarUrl =
      `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;

    return res.json({
      ok: true,
      avatarUrl
    });
  } catch (error) {
    console.error("Avatar API error:", error);

    return res.status(500).json({
      ok: false,
      error: "Server error"
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

app.get("/api/my-products/:userId", async (req, res) => {
  try {
    const userId = req.params.userId;

    const result = await pool.query(
      `
        SELECT *
        FROM products
        WHERE owner_id = $1 AND status != 'deleted'
        ORDER BY created_at DESC;
      `,
      [String(userId)]
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

app.post("/api/products", async (req, res) => {
  try {
    const {
      ownerId,
      ownerName,
      ownerUsername,
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

    if (!ownerId || !name || !price || !category || !desc) {
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
    const id = generateId();

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
        String(ownerId),
        ownerName || "",
        ownerUsername || "",
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
    const id = req.params.id;

    const result = await pool.query(
      `
        UPDATE products
        SET views = views + 1
        WHERE id = $1
        RETURNING *;
      `,
      [id]
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

app.delete("/api/products/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const ownerId = req.query.ownerId;

    if (!ownerId) {
      return res.status(400).json({
        ok: false,
        error: "ownerId is required"
      });
    }

    const result = await pool.query(
      `
        DELETE FROM products
        WHERE id = $1 AND owner_id = $2
        RETURNING id;
      `,
      [id, String(ownerId)]
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

app.get("/api/favorites/:userId", async (req, res) => {
  try {
    const userId = req.params.userId;

    const result = await pool.query(
      `
        SELECT product_id
        FROM favorites
        WHERE user_id = $1;
      `,
      [String(userId)]
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

app.post("/api/favorites", async (req, res) => {
  try {
    const { userId, productId } = req.body;

    if (!userId || !productId) {
      return res.status(400).json({
        ok: false,
        error: "userId and productId are required"
      });
    }

    const exists = await pool.query(
      `
        SELECT *
        FROM favorites
        WHERE user_id = $1 AND product_id = $2;
      `,
      [String(userId), productId]
    );

    if (exists.rows.length > 0) {
      await pool.query(
        `
          DELETE FROM favorites
          WHERE user_id = $1 AND product_id = $2;
        `,
        [String(userId), productId]
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
      [String(userId), productId]
    );

    res.json({
      ok: true,
      isFavorite: true
    });
  } catch (error) {
    console.error("Toggle favorite error:", error);

    res.status(500).json({
      ok: false,
      error: "Не удалось обновить избранное"
    });
  }
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