import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const server = fs.readFileSync("server.js", "utf8");
const client = fs.readFileSync("public/script.js", "utf8");
const html = fs.readFileSync("public/index.html", "utf8");
const css = fs.readFileSync("public/style.css", "utf8");

test("фото вакансии совпадает по высоте с обычной карточкой", () => {
  assert.match(css, /#productList > \.product-card\.is-vacancy-card:not\(\.owner-product-card\) > img[\s\S]*height:\s*120px/);
});

test("рейтинг и доверие продавца поддерживаются сервером и интерфейсом", () => {
  assert.match(server, /CREATE TABLE IF NOT EXISTS seller_reviews/);
  assert.match(server, /app\.get\("\/api\/users\/:id\/reviews"/);
  assert.match(server, /app\.post\("\/api\/users\/:id\/reviews", requireTelegramAuth/);
  assert.match(html, /id="sellerTrustCard"/);
  assert.match(html, /id="sellerReviewComposer"/);
  assert.match(client, /function getSellerTrustMarkup/);
  assert.match(client, /function submitSellerReview/);
});

test("сохранённые поиски имеют CRUD и клиентский запуск", () => {
  assert.match(server, /CREATE TABLE IF NOT EXISTS saved_searches/);
  assert.match(server, /app\.get\("\/api\/saved-searches", requireTelegramAuth/);
  assert.match(server, /app\.post\("\/api\/saved-searches", requireTelegramAuth/);
  assert.match(server, /app\.delete\("\/api\/saved-searches\/:id", requireTelegramAuth/);
  assert.match(html, /id="saveSearchButton"/);
  assert.match(client, /function saveCurrentSearch/);
  assert.match(client, /function applySavedSearch/);
});

test("защита от дублей работает при создании, редактировании и активации", () => {
  assert.match(server, /duplicate_fingerprint TEXT DEFAULT ''/);
  assert.match(server, /idx_products_owner_duplicate_fingerprint_unique/);
  assert.match(server, /function buildDuplicateFingerprint/);
  assert.ok((server.match(/code:\s*"DUPLICATE_LISTING"/g) || []).length >= 3);
  assert.match(client, /error\.code === "DUPLICATE_LISTING"/);
});

test("HTML не содержит повторяющихся id", () => {
  const ids = [...html.matchAll(/\sid=["']([^"']+)["']/g)].map(match => match[1]);
  assert.equal(ids.length, new Set(ids).size);
});
