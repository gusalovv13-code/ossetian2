import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const server = fs.readFileSync("server.js", "utf8");
const client = fs.readFileSync("public/script.js", "utf8");
const html = fs.readFileSync("public/index.html", "utf8");

test("v1.17.1 задаёт уровни лимитов 3 / 10 / 50", () => {
  assert.match(server, /const DEFAULT_LISTING_LIMIT = 3;/);
  assert.match(server, /const PROFESSIONAL_LISTING_LIMIT = 10;/);
  assert.match(server, /const BUSINESS_LISTING_LIMIT = 50;/);
  assert.match(server, /function resolveEffectiveListingLimit/);
  assert.match(server, /Math\.max\(storedLimit, PROFESSIONAL_LISTING_LIMIT\)/);
  assert.match(server, /Math\.max\(storedLimit, BUSINESS_LISTING_LIMIT\)/);
});

test("проверенный бизнес не определяется только по профессиональному лимиту 10", () => {
  assert.match(server, /storedLimit >= BUSINESS_LISTING_LIMIT/);
  assert.doesNotMatch(server, /listing_limit[^\n]+> \$\{DEFAULT_LISTING_LIMIT\}/);
});

test("API квоты возвращает тариф и профессиональный лимит", () => {
  assert.match(server, /tier: resolveListingTier\(userRow\)/);
  assert.match(server, /professionalLimit: PROFESSIONAL_LISTING_LIMIT/);
  assert.match(server, /professionalListingLimit: PROFESSIONAL_LISTING_LIMIT/);
});

test("клиент восстанавливает бизнес-профиль и обновляет квоту после сохранения", () => {
  assert.match(client, /isBusiness: Boolean\(user\.isBusiness\)/);
  assert.match(client, /businessVerified: Boolean\(user\.businessVerified\)/);
  assert.match(client, /if \(data\.listingQuota\) setListingQuota\(data\.listingQuota\)/);
  assert.match(html, /Профессиональный продавец получает до 10 объявлений бесплатно/);
});
