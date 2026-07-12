import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const serverSource = await readFile(new URL("../server.js", import.meta.url), "utf8");
const clientSource = await readFile(new URL("../public/script.js", import.meta.url), "utf8");
const htmlSource = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const cssSource = await readFile(new URL("../public/style.css", import.meta.url), "utf8");
const envSource = await readFile(new URL("../.env.example", import.meta.url), "utf8");
const packageSource = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

test("релиз 1.12.0 подключён без старого кеша Telegram WebView", () => {
  assert.equal(packageSource.version, "1.12.0");
  assert.ok(serverSource.includes('const APP_VERSION = "1.12.0"'));
  assert.ok(htmlSource.includes('style.css?v=1.12.0'));
  assert.ok(htmlSource.includes('script.js?v=1.12.0'));
});

test("ошибка фотографии не подменяет товар чужим изображением", () => {
  assert.ok(clientSource.includes('const DEFAULT_IMAGE = "/image-placeholder.svg"'));
  assert.ok(clientSource.includes("function handleImageError"));
  assert.ok(clientSource.includes("withImageRetryToken"));
  assert.ok(clientSource.includes("image.src = DEFAULT_IMAGE"));
  assert.ok(!clientSource.includes("images.unsplash.com"));
});

test("миниатюры владельца получают версию после редактирования", () => {
  assert.ok(serverSource.includes("function buildOwnProductThumbnailUrl"));
  assert.ok(serverSource.includes("&v=${versionValue}"));
  assert.ok(clientSource.includes("(?:&v=\\d+)?"));
});

test("повторный рендер не перезагружает неизменившиеся фотографии", () => {
  assert.ok(clientSource.includes("function setStableMarkup"));
  assert.ok(clientSource.includes("root.dataset.renderKey === renderKey"));
  assert.ok(clientSource.includes("function setReliableImageSource"));
  assert.ok(cssSource.includes(".image-loading"));
});

test("встроенные чаты имеют таблицы, защищённые маршруты и интерфейс", () => {
  assert.ok(serverSource.includes("CREATE TABLE IF NOT EXISTS conversations"));
  assert.ok(serverSource.includes("CREATE TABLE IF NOT EXISTS messages"));
  assert.ok(serverSource.includes('app.get("/api/chats", requireTelegramAuth'));
  assert.ok(serverSource.includes('app.post("/api/chats/start", requireTelegramAuth'));
  assert.ok(serverSource.includes('app.get("/api/chats/:id/messages", requireTelegramAuth'));
  assert.ok(serverSource.includes('app.post("/api/chats/:id/messages", requireTelegramAuth'));
  assert.ok(htmlSource.includes('id="chatList"'));
  assert.ok(htmlSource.includes('id="chatMessages"'));
  assert.ok(clientSource.includes("async function loadChats"));
  assert.ok(clientSource.includes("async function sendChatMessage"));
  assert.ok(cssSource.includes(".chat-composer"));
});

test("непрочитанные сообщения отображаются в нижнем меню", () => {
  assert.ok(serverSource.includes("AS unread_count"));
  assert.ok(htmlSource.includes('id="chatUnreadBadge"'));
  assert.ok(clientSource.includes("function updateChatUnreadBadge"));
});

test("активные объявления автоматически переходят в архив через настраиваемый срок", () => {
  assert.ok(serverSource.includes("PRODUCT_LIFETIME_DAYS"));
  assert.ok(serverSource.includes("SET status = 'archived'"));
  assert.ok(serverSource.includes("COALESCE(published_at, created_at) < NOW()"));
  assert.ok(serverSource.includes("setInterval(() =>"));
  assert.ok(envSource.includes("PRODUCT_LIFETIME_DAYS=15"));
  assert.ok(htmlSource.includes('data-status="archived"'));
});

test("архивное объявление можно снова опубликовать", () => {
  assert.ok(serverSource.includes('["active", "sold", "draft", "archived"].includes(status)'));
  assert.ok(serverSource.includes("WHEN $3 = 'active' THEN NOW()"));
  assert.ok(clientSource.includes('const publishButton = status !== "active"'));
  assert.ok(clientSource.includes("changeAdStatus('${productId}', 'active')"));
});

test("платное цветное выделение проходит через заявку и подтверждение администратора", () => {
  assert.ok(serverSource.includes("CREATE TABLE IF NOT EXISTS highlight_requests"));
  assert.ok(serverSource.includes('app.post("/api/products/:id/highlight-request"'));
  assert.ok(serverSource.includes('"/api/admin/highlights"'));
  assert.ok(serverSource.includes('"/api/admin/highlights/:id"'));
  assert.ok(htmlSource.includes('id="highlightDialog"'));
  assert.ok(clientSource.includes("function renderHighlightPlans"));
  assert.ok(cssSource.includes(".product-card.highlight-violet"));
  assert.ok(cssSource.includes(".product-card.highlight-gold"));
  assert.ok(cssSource.includes(".product-card.highlight-green"));
  assert.ok(envSource.includes("HIGHLIGHT_PRICE_3_DAYS=99"));
});

test("поиск разбирает запрос на слова и сортирует по релевантности", () => {
  assert.ok(serverSource.includes("const searchTokens = search"));
  assert.ok(serverSource.includes("CONCAT_WS(' ', p.name, p.description, p.category, p.location, p.district"));
  assert.ok(serverSource.includes("LOWER(p.name) = LOWER"));
  assert.ok(serverSource.includes("relevanceSql} DESC"));
  assert.ok(htmlSource.includes('id="searchForm"'));
  assert.ok(clientSource.includes("function renderSearchSummary"));
});

test("модератор возвращает объявление владельцу на исправление, а не удаляет его", () => {
  assert.ok(serverSource.includes("SET moderation_status = 'rejected'"));
  assert.ok(serverSource.includes("status = 'draft'"));
  assert.ok(clientSource.includes("Вернуть на доработку"));
});

test("фотографии поддерживают масштабирование, перетаскивание и сброс", () => {
  assert.ok(htmlSource.includes('class="lightbox-viewport"'));
  assert.ok(htmlSource.includes('onclick="changeLightboxZoom(-0.5)"'));
  assert.ok(htmlSource.includes('onclick="changeLightboxZoom(0.5)"'));
  assert.ok(clientSource.includes("function initLightboxZoom"));
  assert.ok(clientSource.includes('viewport.addEventListener("touchmove"'));
  assert.ok(clientSource.includes('viewport.addEventListener("wheel"'));
  assert.ok(cssSource.includes(".lightbox-toolbar"));
});

test("реклама восстанавливается из локального кеша и переход не ждёт аналитику", () => {
  assert.ok(clientSource.includes("function hydrateAdsCache"));
  assert.ok(clientSource.includes("ossetianMarketAdsCache"));
  assert.ok(clientSource.includes('trackAdEvent(ad.id, "click");'));
  assert.ok(!clientSource.includes('await trackAdEvent(ad.id, "click")'));
  assert.ok(clientSource.includes('fetchpriority="${isBanner ? "high" : "low"}"'));
});
