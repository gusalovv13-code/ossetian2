import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const server = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");
const script = fs.readFileSync(new URL("../public/script.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../public/style.css", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const packageJson = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));

test("версия и кеш обновлены до 1.13.2", () => {
  assert.equal(packageJson.version, "1.13.2");
  assert.match(server, /const APP_VERSION = "1\.13\.2"/);
  assert.match(html, /style\.css\?v=1\.13\.2/);
  assert.match(html, /script\.js\?v=1\.13\.2/);
});

test("продажа сохраняет только компактную запись истории и очищает тяжёлые данные", () => {
  assert.match(server, /ADD COLUMN IF NOT EXISTS sold_at TIMESTAMPTZ/);
  assert.match(server, /ADD COLUMN IF NOT EXISTS media_purged_at TIMESTAMPTZ/);
  const route = server.match(/app\.patch\("\/api\/products\/:id\/status"[\s\S]*?\n\}\);/)?.[0] || "";
  assert.ok(route);
  for (const table of [
    "favorites",
    "product_images",
    "product_price_history",
    "reports",
    "product_feature_requests",
    "moderation_events"
  ]) {
    assert.match(route, new RegExp(`DELETE FROM ${table} WHERE product_id = \\$1`));
  }
  assert.match(route, /status = 'sold'/);
  assert.match(route, /media_purged_at = NOW\(\)/);
  assert.match(route, /images = '\[\]'::jsonb/);
  assert.match(route, /description = ''/);
  assert.match(route, /phone = ''/);
  assert.match(route, /allow_messages = FALSE/);
});

test("проданное объявление окончательно закрыто для редактирования, удаления и повторной публикации", () => {
  assert.match(server, /Проданное объявление хранится только в истории и больше не редактируется/);
  assert.match(server, /COALESCE\(status, 'active'\) NOT IN \('deleted', 'sold'\)/);
  assert.match(script, /Проданное объявление закрыто\. Его нельзя открыть или редактировать/);
  assert.match(script, /Проданное объявление нельзя удалить или изменить/);
  assert.match(script, /Восстановить или редактировать объявление будет нельзя/);
});

test("карточка проданного товара не имеет кнопок и не открывается", () => {
  assert.match(script, /const isSoldHistory = options\.ownerActions && status === "sold"/);
  assert.match(script, /sold-history-card is-noninteractive/);
  assert.match(script, /aria-disabled="true" tabindex="-1"/);
  assert.match(script, /Фото и личные данные удалены/);
  assert.match(css, /\.sold-history-card/);
  assert.match(css, /\.sold-history-note/);
});

test("увеличенное фото можно двигать во всех направлениях одним пальцем", () => {
  assert.match(script, /function clampLightboxPan/);
  assert.match(script, /function setLightboxPan/);
  assert.match(script, /function getTouchCenter/);
  assert.match(script, /gestureMode = isLightbox && lightboxZoom > 1\.01 \? "pan" : "swipe"/);
  assert.match(script, /startPanY \+ touch\.clientY - startY/);
  assert.match(script, /lightboxPanY = center\.y - viewportCenterY - nextZoom \* anchorY/);
  assert.match(css, /\.lightbox-viewport[\s\S]*?touch-action: none/);
  assert.match(css, /overscroll-behavior: none/);
});
