import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const server = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");
const script = fs.readFileSync(new URL("../public/script.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../public/style.css", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

 test("карточка объявления всегда открывается сверху", () => {
  assert.match(script, /function resetPageScroll\(pageId\)/);
  assert.match(script, /document\.documentElement\.scrollTop = 0/);
  assert.match(script, /requestAnimationFrame\(\(\) =>/);
  assert.match(script, /resetPageScroll\(page\)/);
});

test("профиль продавца визуально оформлен как ссылка", () => {
  assert.match(html, /id="productSeller" class="seller-profile-link"/);
  assert.match(script, /<u>Открыть профиль<\/u>/);
  assert.match(css, /\.seller-profile-link[\s\S]*?cursor: pointer/);
});

test("ссылка объявления запускает Telegram Mini App", () => {
  assert.match(server, /botUsername: BOT_USERNAME/);
  assert.match(script, /\?startapp=\$\{encodeURIComponent\(startParam\)\}/);
  assert.match(script, /const startParam = `product_\$\{cleanProductId\}`/);
  assert.match(script, /tgWebAppStartParam/);
  assert.match(script, /initDataUnsafe\?\.start_param/);
});

test("кнопки обмена и шрифты стали компактнее", () => {
  assert.match(html, /class="outline compact-share-action" onclick="shareProduct\(\)"/);
  assert.match(css, /\.product-secondary-actions \.compact-share-action[\s\S]*?min-height: 34px/);
  assert.match(css, /body \{\n  font-size: 15px;/);
});
