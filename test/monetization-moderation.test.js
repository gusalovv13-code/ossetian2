import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const serverSource = await readFile(new URL("../server.js", import.meta.url), "utf8");
const clientSource = await readFile(new URL("../public/script.js", import.meta.url), "utf8");
const htmlSource = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const cssSource = await readFile(new URL("../public/style.css", import.meta.url), "utf8");

test("снижение цены хранится отдельно и показывается пользователю", () => {
  assert.match(serverSource, /CREATE TABLE IF NOT EXISTS product_price_history/);
  assert.match(serverSource, /previous_price = CASE WHEN \$19 THEN price/);
  assert.match(serverSource, /priceDropped/);
  assert.match(clientSource, /Цена снизилась/);
  assert.match(htmlSource, /id="productPriceHistory"/);
  assert.match(cssSource, /\.price-drop-card-badge/);
});

test("автомодерация проверяет ссылки, контакты, email и правила", () => {
  assert.match(serverSource, /function evaluateProductModeration/);
  assert.match(serverSource, /block_links/);
  assert.match(serverSource, /block_contacts/);
  assert.match(serverSource, /block_emails/);
  assert.match(serverSource, /CREATE TABLE IF NOT EXISTS moderation_rules/);
  assert.match(serverSource, /CREATE TABLE IF NOT EXISTS moderation_events/);
  assert.match(serverSource, /moderation_status = \$21/);
});

test("заблокированное объявление не может само вернуться в каталог", () => {
  assert.match(serverSource, /\$3 <> 'active' OR COALESCE\(moderation_status, 'approved'\) = 'approved'/);
  assert.match(serverSource, /COALESCE\(moderation_status, 'approved'\) = 'approved'/);
  assert.match(serverSource, /moderation_target_status/);
});

test("администратор управляет правилами и очередью автомодерации", () => {
  assert.match(htmlSource, /data-admin-tab="moderation"/);
  assert.match(serverSource, /"\/api\/admin\/moderation"/);
  assert.match(serverSource, /"\/api\/admin\/moderation\/rules"/);
  assert.match(serverSource, /"\/api\/admin\/moderation\/settings"/);
  assert.match(clientSource, /function renderAdminModeration/);
  assert.match(clientSource, /function reviewAutoModeration/);
});

test("рекламные кампании имеют размещения, расписание и аналитику", () => {
  assert.match(serverSource, /CREATE TABLE IF NOT EXISTS advertising_campaigns/);
  assert.match(serverSource, /catalog_top/);
  assert.match(serverSource, /catalog_feed/);
  assert.match(serverSource, /product_detail/);
  assert.match(serverSource, /max_impressions/);
  assert.match(serverSource, /advertising_events/);
  assert.match(clientSource, /function renderAdCard/);
  assert.match(clientSource, /function trackAdEvent/);
  assert.match(htmlSource, /data-admin-tab="ads"/);
});

test("реклама явно помечена и не маскируется под обычный товар", () => {
  assert.match(clientSource, /advertising-label/);
  assert.match(clientSource, />Реклама</);
  assert.match(cssSource, /\.advertising-card/);
});

test("монетизация поддерживает фикс, CPM и CPC", () => {
  assert.match(serverSource, /AD_BILLING_MODELS/);
  assert.match(serverSource, /billing_model/);
  assert.match(serverSource, /rate_amount/);
  assert.match(serverSource, /estimatedRevenue/);
  assert.match(clientSource, /adCampaignBilling/);
  assert.match(clientSource, /Доход от рекламы/);
});
