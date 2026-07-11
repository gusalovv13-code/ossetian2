import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const serverSource = await readFile(new URL("../server.js", import.meta.url), "utf8");
const clientSource = await readFile(new URL("../public/script.js", import.meta.url), "utf8");
const htmlSource = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const packageSource = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

test("каталог загружает небольшие страницы вместо сотни полных объявлений", () => {
  assert.match(clientSource, /const CATALOG_PAGE_SIZE = 12/);
  assert.match(serverSource, /normalizePositiveInteger\(req\.query\.limit, 12, 30\)/);
  assert.doesNotMatch(clientSource, /new URLSearchParams\(\{ limit: "100" \}\)/);
});

test("публичные списки используют компактную модель товара", () => {
  assert.match(serverSource, /const PRODUCT_SUMMARY_COLUMNS/);
  assert.match(serverSource, /result\.rows\.map\(mapProductSummary\)/);
  assert.match(serverSource, /LEFT\(p\.description, 240\) AS description/);
});

test("миниатюры сохраняются отдельно от полноразмерных фотографий", () => {
  assert.match(serverSource, /ADD COLUMN IF NOT EXISTS thumbnail TEXT/);
  assert.match(clientSource, /function createThumbnailFromImage/);
  assert.match(clientSource, /thumbnail,/);
});

test("просмотр товара не возвращает повторно все фотографии", () => {
  const route = serverSource.match(/app\.post\("\/api\/products\/:id\/view"[\s\S]*?\n\}\);/)?.[0] || "";
  assert.match(route, /RETURNING id, views/);
  assert.doesNotMatch(route, /RETURNING \*/);
  assert.doesNotMatch(route, /mapProduct\(/);
});

test("каталог поддерживает отмену запросов, кеш и дозагрузку", () => {
  assert.match(clientSource, /productsAbortController\?\.abort\(\)/);
  assert.match(clientSource, /DATA_CACHE_TTL_MS/);
  assert.match(clientSource, /function loadMoreProducts/);
  assert.match(htmlSource, /id="catalogLoadMore"/);
});

test("тяжёлые личные списки загружаются только при открытии раздела", () => {
  const initBlock = clientSource.match(/async function initApp\(\)[\s\S]*?\n\}/)?.[0] || "";
  assert.match(initBlock, /loadFavoriteIds\(\)/);
  assert.doesNotMatch(initBlock, /loadMyProducts\(\)/);
  assert.doesNotMatch(initBlock, /loadFavorites\(\)/);
});

test("повторное открытие карточки использует кеш деталей", () => {
  assert.match(clientSource, /productDetailsCache/);
  assert.match(clientSource, /PRODUCT_DETAILS_CACHE_TTL_MS/);
  assert.match(clientSource, /cacheIsFresh/);
});

test("сервер сжимает текстовые ответы", () => {
  assert.equal(typeof packageSource.dependencies.compression, "string");
  assert.match(serverSource, /app\.use\(compression/);
});
