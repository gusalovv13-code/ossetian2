import express from "express";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const app = express();

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

if (!BOT_TOKEN) {
  console.error("Ошибка: BOT_TOKEN не найден в файле .env");
  process.exit(1);
}

app.use(express.json());
app.use(express.static(__dirname));

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

app.listen(PORT, () => {
  console.log(`Server started: http://localhost:${PORT}`);
});