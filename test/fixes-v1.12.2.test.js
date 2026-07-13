import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const serverSource = await readFile(new URL("../server.js", import.meta.url), "utf8");
const clientSource = await readFile(new URL("../public/script.js", import.meta.url), "utf8");
const htmlSource = await readFile(new URL("../public/index.html", import.meta.url), "utf8");

test("существующая таблица фотографий получает недостающие столбцы", () => {
  assert.match(serverSource, /ALTER TABLE product_images[\s\S]*?ADD COLUMN IF NOT EXISTS preview_url TEXT DEFAULT ''/);
  assert.match(serverSource, /ALTER TABLE product_images[\s\S]*?ADD COLUMN IF NOT EXISTS position INTEGER DEFAULT 0/);
  assert.match(serverSource, /ALTER TABLE product_images[\s\S]*?ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW\(\)/);
});

test("индекс фотографии имеет однозначный тип PostgreSQL", () => {
  assert.match(serverSource, /OFFSET \(\$2::int\) LIMIT 1/);
  assert.match(serverSource, /p\.images ->> \(\$2::int\)/);
  assert.match(serverSource, /CASE WHEN \$2::int = 0/);
});

test("сервер пропускает повреждённый источник и ищет рабочее фото", () => {
  assert.match(serverSource, /function pickValidProductImage/);
  assert.match(serverSource, /row\.table_source,[\s\S]*?row\.legacy_source,[\s\S]*?row\.primary_source,[\s\S]*?row\.thumbnail_source,[\s\S]*?row\.preview_source/);
  assert.doesNotMatch(serverSource, /SELECT COALESCE\([\s\S]*?pi\.preview_url/);
});

test("клиент повторяет загрузку фото и не показывает посторонний снимок", () => {
  assert.match(clientSource, /function addImageRetryParam/);
  assert.match(clientSource, /retry=\$\{Date\.now\(\)\}/);
  assert.match(clientSource, /Фото недоступно/);
  assert.doesNotMatch(clientSource, /images\.unsplash\.com\/photo-1516321318423/);
  assert.match(htmlSource, /script\.js\?v=1\.13\.1/);
  assert.match(htmlSource, /style\.css\?v=1\.13\.1/);
});
