import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const server = fs.readFileSync("server.js", "utf8");
const client = fs.readFileSync("public/script.js", "utf8");
const html = fs.readFileSync("public/index.html", "utf8");
const css = fs.readFileSync("public/style.css", "utf8");

test("v1.17.0 добавляет умный поиск с fallback", () => {
  assert.match(server, /SEARCH_SYNONYMS/);
  assert.match(server, /transliterateCyrillicToLatin/);
  assert.match(server, /transliterateLatinToCyrillic/);
  assert.match(server, /CREATE EXTENSION IF NOT EXISTS pg_trgm/);
  assert.match(server, /word_similarity/);
  assert.match(server, /searchMeta/);
});

test("v1.17.0 добавляет профессиональные профили продавцов", () => {
  for (const column of ["is_business", "business_name", "business_category", "business_address", "business_hours", "business_website", "business_verified"]) {
    assert.match(server, new RegExp(column));
  }
  assert.match(html, /id="profileEditIsBusiness"/);
  assert.match(html, /id="sellerBusinessBlock"/);
  assert.match(client, /syncBusinessProfileFields/);
  assert.match(client, /business-card-badge/);
  assert.match(css, /\.seller-business-block/);
});

test("v1.17.0 усиливает HTTP и API безопасность", () => {
  assert.match(server, /Content-Security-Policy/);
  assert.match(server, /Strict-Transport-Security/);
  assert.match(server, /X-Content-Type-Options/);
  assert.match(server, /createMemoryRateLimiter/);
  assert.match(server, /RATE_LIMITED/);
  assert.match(server, /PAYLOAD_TOO_LARGE/);
});

test("публичный каталог остаётся без Telegram-авторизации", () => {
  assert.match(server, /app\.get\("\/api\/products", async/);
  assert.doesNotMatch(server, /app\.get\("\/api\/products",\s*requireTelegramAuth/);
});
