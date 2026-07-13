import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const server = await readFile(new URL("../server.js", import.meta.url), "utf8");
const script = await readFile(new URL("../public/script.js", import.meta.url), "utf8");
const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const css = await readFile(new URL("../public/style.css", import.meta.url), "utf8");
const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

test("версия и кеш обновлены до 1.13.7", () => {
  assert.equal(pkg.version, "1.13.7");
  assert.match(server, /const APP_VERSION = "1\.13\.7"/);
  assert.match(html, /style\.css\?v=1\.13\.7/);
  assert.match(html, /script\.js\?v=1\.13\.7/);
});

test("переходы не начинают страницу с прозрачного чёрного кадра", () => {
  assert.match(css, /\.page\.active\.page-transitioning,[\s\S]*?opacity:\s*1\s*!important/);
  assert.match(css, /@keyframes market-page-enter-forward[\s\S]*?from\s*\{[\s\S]*?opacity:\s*1/);
  assert.match(script, /requestAnimationFrame\(\(\) => \{[\s\S]*?loadProducts\(\)/);
});

test("обычный пользователь ограничен тремя объявлениями, администратор может дать до ста", () => {
  assert.match(server, /const DEFAULT_LISTING_LIMIT = 3/);
  assert.match(server, /const BUSINESS_LISTING_LIMIT = 50/);
  assert.match(server, /const MAX_LISTING_LIMIT = 100/);
  assert.match(server, /code:\s*"LISTING_LIMIT_REACHED"/);
  assert.match(server, /NOT IN \('deleted', 'sold'\)/);
  assert.match(server, /\/api\/admin\/users\/:id\/listing-limit/);
  assert.match(html, /id="listingLimitDialog"/);
  assert.match(script, /до \$\{businessLimit\} объявлений за \$\{price\.toLocaleString\("ru-RU"\)\} ₽/);
});

test("назад использует историю без зацикливания и смысловые родительские страницы", () => {
  assert.match(script, /const PAGE_FALLBACK_PARENTS = \{/);
  assert.match(script, /if \(previousHistoryPage === page\)/);
  assert.match(script, /while \(state\.history\.length > 0 && !prev\)/);
  assert.match(script, /showPage\(document\.getElementById\(fallback\) \? fallback : "home"/);
});

test("дозагрузка каталога добавляет только новую порцию карточек", () => {
  assert.match(script, /let catalogAppendStart = null/);
  assert.match(script, /productList\.appendChild\(template\.content\)/);
  assert.match(css, /content-visibility:\s*auto/);
  assert.match(script, /const CATALOG_PAGE_SIZE = 12/);
});

test("нижнее меню скрывается при клавиатуре", () => {
  assert.match(script, /function initKeyboardViewportGuard\(\)/);
  assert.match(script, /root\.classList\.toggle\("keyboard-open"/);
  assert.match(css, /html\.keyboard-open \.bottom-nav[\s\S]*?visibility:\s*hidden\s*!important/);
});

test("номер копируется с подтверждением", () => {
  assert.match(script, /async function copyPhoneNumber\(phone\)/);
  assert.match(script, /showToast\("Номер скопирован"\)/);
  assert.match(html, /id="appToast"/);
});

test("один нормализованный номер может принадлежать только одному профилю", () => {
  assert.match(server, /function normalizePhoneKey\(value\)/);
  assert.match(server, /CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone_normalized_unique/);
  assert.match(server, /code:\s*"PHONE_ALREADY_USED"/);
  assert.match(server, /code:\s*"PROFILE_PHONE_MISMATCH"/);
});

test("мои объявления защищены от устаревшего нулевого ответа", () => {
  assert.match(script, /let myProductsRequestSequence/);
  assert.match(script, /state\.myProductsOwnerId !== ownerId/);
  assert.match(script, /requestSequence !== myProductsRequestSequence/);
  assert.match(script, /cache:\s*"no-store"/);
});

test("свайп назад начинается только у края и требует осознанного жеста", () => {
  assert.match(script, /const swipeStartZone = 28/);
  assert.match(script, /const backTriggerDistance = 92/);
  assert.match(script, /deltaX > deltaY \* 1\.4/);
  assert.match(css, /\.swipe-back-indicator\.completing/);
  assert.match(html, /id="swipeBackIndicator"[^>]*>←<\/div>/);
});

test("фото можно выбрать из галереи или сделать камерой", () => {
  assert.match(html, /id="cameraInput"[^>]*capture="environment"/);
  assert.match(html, /id="takePhotoBtn"/);
  assert.match(script, /cameraInput\?\.addEventListener\("change", processSelectedPhotos\)/);
});
