import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const server = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");
const script = fs.readFileSync(new URL("../public/script.js", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../public/style.css", import.meta.url), "utf8");
const packageJson = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));

test("версия и кеш обновлены до 1.13.0", () => {
  assert.equal(packageJson.version, "1.13.0");
  assert.match(server, /const APP_VERSION = "1\.13\.0"/);
  assert.match(html, /style\.css\?v=1\.13\.0/);
  assert.match(html, /script\.js\?v=1\.13\.0/);
});

test("каталог фильтрует по цене, городу, району, марке и модели", () => {
  for (const id of [
    "filterMinPrice",
    "filterMaxPrice",
    "filterCity",
    "filterDistrict",
    "filterBrand",
    "filterModel",
    "filterSort"
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(server, /req\.query\.minPrice/);
  assert.match(server, /req\.query\.maxPrice/);
  assert.match(server, /req\.query\.city/);
  assert.match(server, /req\.query\.district/);
  assert.match(server, /req\.query\.brand/);
  assert.match(server, /req\.query\.model/);
  assert.match(server, /COALESCE\(p\.price_amount, 0\) >=/);
  assert.match(server, /LOWER\(COALESCE\(p\.specifications::text, ''\)\) LIKE/);
  assert.match(script, /params\.set\("brand", filters\.brand\)/);
  assert.match(script, /params\.set\("model", filters\.model\)/);
  assert.match(css, /\.catalog-filters/);
});

test("продавец может сохранять публичное описание и контакты", () => {
  for (const column of ["profile_description", "city", "phone", "contact_username"]) {
    assert.match(server, new RegExp(`ADD COLUMN IF NOT EXISTS ${column}`));
  }
  assert.match(server, /app\.patch\("\/api\/me\/profile", requireTelegramAuth, syncTelegramUser/);
  assert.match(html, /id="profileEditDialog"/);
  assert.match(html, /id="profileEditDescription"/);
  assert.match(html, /id="profileEditPhone"/);
  assert.match(script, /async function saveProfile/);
  assert.match(script, /renderOwnProfileDetails/);
});

test("профиль продавца показывает активные и проданные товары отдельно", () => {
  assert.match(server, /soldProducts: soldResult\.rows\.map\(mapProductSummary\)/);
  assert.match(server, /COALESCE\(p\.status, 'active'\) = 'sold'/);
  assert.match(html, /id="sellerSoldProducts"/);
  assert.match(html, /id="sellerSoldCount"/);
  assert.match(script, /state\.sellerSoldProducts = soldProducts/);
  assert.match(script, /seller-sold-card/);
  assert.match(script, /aria-disabled="true"/);
  assert.match(css, /\.seller-sold-card[\s\S]*?pointer-events: none/);
});

test("кнопка профиля открывает Telegram-чат продавца", () => {
  assert.match(html, /id="sellerMessageButton"/);
  assert.match(script, /function openTelegramSellerChat/);
  assert.match(script, /tg\?\.openTelegramLink/);
  assert.match(script, /https:\/\/t\.me\/\$\{encodeURIComponent\(username\)\}/);
  assert.match(script, /tg:\/\/user\?id=/);
});
