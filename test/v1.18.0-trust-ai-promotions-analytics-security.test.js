import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const server = fs.readFileSync("server.js", "utf8");
const client = fs.readFileSync("public/script.js", "utf8");
const html = fs.readFileSync("public/index.html", "utf8");
const css = fs.readFileSync("public/style.css", "utf8");

test("v1.18.0 расширяет систему доверия продавца", () => {
  for (const field of ["telegramVerified", "businessVerified", "pendingReports", "accountAgeDays", "totalViews", "favoriteCount"]) {
    assert.match(server, new RegExp(field));
  }
  assert.match(server, /function buildSellerTrust/);
  assert.match(client, /Telegram подтверждён/);
  assert.match(client, /Проверенный бизнес/);
});

test("v1.18.0 добавляет тарифные планы платного продвижения", () => {
  assert.match(server, /const PROMOTION_PLANS = Object\.freeze/);
  assert.match(server, /boost:/);
  assert.match(server, /vip:/);
  assert.match(server, /premium:/);
  assert.match(server, /promotion_priority/);
  assert.match(server, /GREATEST\(COALESCE\(p\.promotion_priority, 1\), 1\)/);
  assert.match(html, /id="highlightPlanSelect"/);
  assert.match(client, /updateHighlightPlanSummary/);
});

test("v1.18.0 добавляет AI-помощник объявления и AI-модерацию с fallback", () => {
  assert.match(server, /app\.post\("\/api\/ai\/listing-suggestion"/);
  assert.match(server, /https:\/\/api\.openai\.com\/v1\/responses/);
  assert.match(server, /type: "input_image"/);
  assert.match(server, /buildFallbackListingSuggestion/);
  assert.match(server, /evaluateAIModeration/);
  assert.match(server, /if \(!AI_MODERATION_ENABLED \|\| !OPENAI_API_KEY\)/);
  assert.match(html, /runAiListingAssistant/);
  assert.match(client, /async function runAiListingAssistant/);
});

test("v1.18.0 добавляет магазин профессионального продавца", () => {
  assert.match(server, /app\.get\("\/api\/users\/:id\/store"/);
  assert.match(html, /id="sellerStorefront"/);
  assert.match(client, /\/api\/users\/\$\{encodeURIComponent\(userId\)\}\/store/);
  assert.match(css, /\.seller-storefront/);
});

test("v1.18.0 добавляет аналитику продавца и дедупликацию просмотров", () => {
  assert.match(server, /CREATE TABLE IF NOT EXISTS product_view_events/);
  assert.match(server, /app\.get\("\/api\/me\/analytics"/);
  assert.match(server, /ON CONFLICT \(product_id, client_key, event_date\) DO NOTHING/);
  assert.match(html, /id="sellerAnalytics"/);
  assert.match(client, /async function loadSellerAnalytics/);
  assert.match(client, /function renderSellerAnalytics/);
});

test("v1.18.0 усиливает защиту чувствительных API", () => {
  assert.match(server, /X-Request-Id/);
  assert.match(server, /Cross-Origin-Resource-Policy/);
  assert.match(server, /ORIGIN_REJECTED/);
  assert.match(server, /CREATE TABLE IF NOT EXISTS security_events/);
  assert.match(server, /function recordSecurityEvent/);
  assert.match(server, /const aiRateLimiter/);
});
