import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const server = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");
const script = fs.readFileSync(new URL("../public/script.js", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../public/style.css", import.meta.url), "utf8");

test("версия проекта обновлена до 1.12.0", () => {
  assert.match(server, /APP_VERSION = "1\.12\.0"/);
  assert.match(html, /style\.css\?v=1\.12\.0/);
  assert.match(html, /script\.js\?v=1\.12\.0/);
});

test("стандартное фото больше не сохраняется вместо пользовательского", () => {
  assert.match(script, /const mainImage = images\[0\] \|\| ""/);
  assert.match(script, /Добавьте хотя бы одно фото объявления/);
  assert.match(server, /requestedStatus === "active" && cleanImages\.length === 0/);
});

test("редактирование всегда получает исходные фото владельца", () => {
  assert.match(script, /api\/my-products\/\$\{encodeURIComponent\(id\)\}\/details/);
  assert.doesNotMatch(script, /if \(product\.isSummary \|\| !Array\.isArray\(product\.images\)/);
});

test("архив через 15 дней и вкладка архива подключены", () => {
  assert.match(server, /INTERVAL '15 days'/);
  assert.match(server, /status = 'archived'/);
  assert.match(html, /data-status="archived"/);
});

test("галерея поддерживает реальное масштабирование", () => {
  assert.match(script, /function zoomPhoto/);
  assert.match(script, /pinchStartDistance/);
  assert.match(html, /lightbox-zoom-controls/);
  assert.match(css, /lightbox-image-stage/);
});

test("платное выделение управляется администратором", () => {
  assert.match(server, /products\/:id\/promotion/);
  assert.match(server, /promotion_paid/);
  assert.match(script, /toggleProductPromotion/);
  assert.match(css, /product-card\.is-promoted/);
});

test("реклама отображается из кеша до завершения авторизации", () => {
  assert.match(script, /restoreCachedAds\(\);\n  const adsPromise = loadAds\(\);/);
  const adPosition = html.indexOf('id="homeTopAds"');
  const favoritesPosition = html.indexOf("Избранное");
  assert.ok(adPosition > favoritesPosition);
});


test("при отсутствии фото показывается нейтральная заглушка, а не чужое изображение", () => {
  assert.match(script, /const DEFAULT_IMAGE = "\/placeholder\.svg\?v=1\.12\.0"/);
  assert.doesNotMatch(script, /images\.unsplash\.com/);
});
