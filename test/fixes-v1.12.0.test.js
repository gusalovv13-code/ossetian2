import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const serverSource = await readFile(new URL("../server.js", import.meta.url), "utf8");
const clientSource = await readFile(new URL("../public/script.js", import.meta.url), "utf8");
const htmlSource = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const cssSource = await readFile(new URL("../public/style.css", import.meta.url), "utf8");
const envSource = await readFile(new URL("../.env.example", import.meta.url), "utf8");

test("изображения используют таблицу product_images и версионные URL", () => {
  assert.match(serverSource, /FROM product_images pi[\s\S]*?ORDER BY pi\.position ASC/);
  assert.match(serverSource, /\?owner=.*&expires=.*&v=.*&token=/);
  assert.match(serverSource, /buildProductMediaUrl\(row\.id, "thumbnail", row\.updated_at/);
  assert.match(serverSource, /mainImageChanged/);
  assert.match(serverSource, /!mainImageChanged \? existing\.thumbnail : ""/);
  assert.match(clientSource, /function swapImageAfterLoad/);
  assert.match(clientSource, /const sequence = \+\+galleryImageSequence/);
});

test("поиск разбивает запрос на слова и ранжирует точные совпадения", () => {
  assert.match(serverSource, /split\(\/\[\^\\p\{L\}\\p\{N\}\]\+\/u\)/);
  assert.match(serverSource, /LOWER\(COALESCE\(p\.specifications::text/);
  assert.match(serverSource, /relevanceSql/);
  assert.match(clientSource, /updateSearchStatus/);
});

test("галерея поддерживает масштаб и безопасную кнопку закрытия", () => {
  assert.match(htmlSource, /id="lightboxZoomReset"/);
  assert.match(clientSource, /function setLightboxZoom/);
  assert.match(clientSource, /getTouchDistance/);
  assert.match(cssSource, /\.lightbox-close[\s\S]*?safe-area-inset-top/);
  assert.match(cssSource, /\.lightbox-zoom-controls/);
});

test("объявления архивируются через настраиваемый срок", () => {
  assert.match(serverSource, /PRODUCT_ARCHIVE_DAYS/);
  assert.match(serverSource, /SET status = 'archived'/);
  assert.match(serverSource, /setInterval\(runProductLifecycleMaintenance, 60 \* 60 \* 1000\)/);
  assert.match(htmlSource, /data-status="archived"/);
  assert.match(envSource, /^PRODUCT_ARCHIVE_DAYS=15$/m);
});

test("платное выделение создаёт заявку и подтверждается администратором", () => {
  assert.match(serverSource, /CREATE TABLE IF NOT EXISTS product_feature_requests/);
  assert.match(serverSource, /"\/api\/products\/:id\/feature-request"/);
  assert.match(serverSource, /"\/api\/admin\/products\/:id\/feature"/);
  assert.match(clientSource, /Заявка на выделение отправлена/);
  assert.match(clientSource, /pending_feature_requests/);
  assert.match(cssSource, /\.product-card\.is-featured/);
});

test("реклама загружается параллельно Telegram-авторизации", () => {
  const init = clientSource.match(/async function initApp\(\)[\s\S]*?\n\}/)?.[0] || "";
  assert.ok(init);
  assert.ok(init.indexOf("const adsPromise = loadAds()") < init.indexOf("await initTelegramUser()"));
});
