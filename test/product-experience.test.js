import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const serverSource = await readFile(new URL("../server.js", import.meta.url), "utf8");
const clientSource = await readFile(
  new URL("../public/script.js", import.meta.url),
  "utf8"
);
const htmlSource = await readFile(
  new URL("../public/index.html", import.meta.url),
  "utf8"
);
const cssSource = await readFile(
  new URL("../public/style.css", import.meta.url),
  "utf8"
);
const packageSource = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8")
);

test("версия проекта обновлена до 1.11.5", () => {
  assert.equal(packageSource.version, "1.11.5");
  assert.match(serverSource, /const APP_VERSION = "1\.11\.5"/);
});

test("карточка товара получает похожие объявления, товары продавца и счётчик избранного", () => {
  assert.match(serverSource, /app\.get\("\/api\/products\/:id\/details"/);
  assert.match(serverSource, /AS favorite_count/);
  assert.match(serverSource, /similarProducts:/);
  assert.match(serverSource, /sellerProducts:/);
  assert.match(clientSource, /state\.similarProducts/);
  assert.match(clientSource, /state\.sellerOtherProducts/);
});

test("галерея поддерживает счётчик, увеличение и свайп", () => {
  assert.match(htmlSource, /id="productImageCounter"/);
  assert.match(htmlSource, /id="photoLightbox"/);
  assert.match(clientSource, /function changeProductImage/);
  assert.match(clientSource, /function initProductGalleryGestures/);
  assert.match(clientSource, /touchstart/);
  assert.match(cssSource, /\.photo-lightbox/);
});

test("карточка показывает даты, просмотры, избранное и характеристики", () => {
  assert.match(htmlSource, /id="productMeta"/);
  assert.match(htmlSource, /id="productSpecifications"/);
  assert.match(clientSource, /Опубликовано/);
  assert.match(clientSource, /Обновлено/);
  assert.match(clientSource, /favoriteCount/);
  assert.match(clientSource, /getConditionLabel/);
});

test("новые свойства объявления сохраняются на сервере", () => {
  for (const column of ["condition", "negotiable", "delivery", "district", "specifications"]) {
    assert.match(serverSource, new RegExp(`ADD COLUMN IF NOT EXISTS ${column}`));
  }

  assert.match(serverSource, /normalizeSpecifications/);
  assert.match(clientSource, /adNegotiable/);
  assert.match(clientSource, /adDelivery/);
  assert.match(clientSource, /adDistrict/);
  assert.match(clientSource, /adSpecifications/);
});

test("качество объявления проверяется на клиенте и сервере", () => {
  assert.match(serverSource, /function calculateListingQuality/);
  assert.match(clientSource, /function calculateClientListingQuality/);
  assert.match(clientSource, /function updateListingQuality/);
  assert.match(htmlSource, /id="listingQualityScore"/);
  assert.match(htmlSource, /id="listingQualityTips"/);
});

test("жалобы требуют Telegram-авторизацию и защищены от жалобы на себя", () => {
  assert.match(
    serverSource,
    /app\.post\("\/api\/products\/:id\/reports", requireTelegramAuth, syncTelegramUser/
  );
  assert.match(serverSource, /Нельзя пожаловаться на своё объявление/);
  assert.match(serverSource, /Ваша жалоба уже находится на рассмотрении/);
  assert.match(htmlSource, /id="reportDialog"/);
  assert.match(clientSource, /function submitProductReport/);
});

test("админка содержит очередь жалоб и действия модератора", () => {
  assert.match(htmlSource, /data-admin-tab="reports"/);
  assert.match(serverSource, /"\/api\/admin\/reports"/);
  assert.match(serverSource, /"\/api\/admin\/reports\/:id"/);
  assert.match(serverSource, /hide_and_ban/);
  assert.match(clientSource, /function renderAdminReports/);
  assert.match(clientSource, /function moderateAdminReport/);
});

test("поделиться и скопировать ссылку используют прямую ссылку на товар", () => {
  assert.match(htmlSource, /onclick="shareProduct\(\)"/);
  assert.match(htmlSource, /onclick="copyProductLink\(\)"/);
  assert.match(clientSource, /url\.searchParams\.set\("product"/);
  assert.match(clientSource, /navigator\.share/);
  assert.match(clientSource, /navigator\.clipboard/);
  assert.match(clientSource, /directProductId/);
});

test("новые элементы имеют адаптивные и тёмные стили", () => {
  assert.match(cssSource, /\.product-meta/);
  assert.match(cssSource, /\.quality-card/);
  assert.match(cssSource, /\.admin-report-controls/);
  assert.match(cssSource, /body\.dark-mode \.report-dialog/);
  assert.match(cssSource, /@media \(max-width: 390px\)/);
});
