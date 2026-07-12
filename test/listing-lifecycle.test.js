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
const envSource = await readFile(new URL("../.env.example", import.meta.url), "utf8");

test("все кнопки категорий имеют точное машинное значение", () => {
  const categories = [
    "Все",
    "Электроника",
    "Авто",
    "Одежда",
    "Дом",
    "Инструменты",
    "Сад и огород",
    "Животные"
  ];

  for (const category of categories) {
    assert.match(htmlSource, new RegExp(`data-category=["']${category}["']`));
  }

  assert.match(clientSource, /button\.dataset\.category/);
  assert.doesNotMatch(clientSource, /replace\(\/\[📱🚗👕🏠\]\//);
});

test("публичные товары ограничены активными и видимыми", () => {
  assert.match(serverSource, /COALESCE\(p\.status, 'active'\) = \$1/);
  assert.match(serverSource, /const values = \[PUBLIC_PRODUCT_STATUS\]/);
  assert.match(serverSource, /COALESCE\(hidden, FALSE\) = FALSE/);
  assert.match(clientSource, /product\.status === "active"/);
});

test("маршрут просмотра не открывает скрытые и неактивные объявления", () => {
  assert.match(
    serverSource,
    /app\.post\("\/api\/products\/:id\/view"[\s\S]*?COALESCE\(status, 'active'\) = 'active'[\s\S]*?COALESCE\(hidden, FALSE\) = FALSE/
  );
});

test("пользовательское удаление является мягким", () => {
  const route = serverSource.match(
    /app\.delete\("\/api\/products\/:id"[\s\S]*?\n\}\);/
  )?.[0] || "";

  assert.ok(route);
  assert.match(route, /UPDATE products[\s\S]*?status = 'deleted'[\s\S]*?hidden = TRUE/);
  assert.doesNotMatch(route, /DELETE FROM products/);
});

test("статусы и вкладки объявлений подключены", () => {
  assert.match(serverSource, /app\.patch\("\/api\/products\/:id\/status"/);
  assert.match(htmlSource, /onclick="publishAd\('draft'\)"/);
  assert.match(htmlSource, /data-status="active"/);
  assert.match(htmlSource, /data-status="sold"/);
  assert.match(htmlSource, /data-status="draft"/);
  assert.match(clientSource, /function setMyAdsTab/);
  assert.match(clientSource, /function changeAdStatus/);
});

test("смена статуса владельцем не снимает скрытие модератора", () => {
  const route = serverSource.match(
    /app\.patch\("\/api\/products\/:id\/status"[\s\S]*?\n\}\);/
  )?.[0] || "";

  assert.ok(route);
  assert.doesNotMatch(route, /hidden\s*=\s*FALSE/);
});


test("владелец может редактировать своё объявление", () => {
  assert.match(
    serverSource,
    /app\.patch\("\/api\/products\/:id", requireTelegramAuth, syncTelegramUser/
  );
  assert.match(clientSource, /function editAd/);
  assert.match(clientSource, /method: editingId \? "PATCH" : "POST"/);
  assert.match(clientSource, /Редактирование объявления/);
});

test("пример окружения содержит настройки администраторов, SSL и поддержки", () => {
  assert.match(envSource, /^DATABASE_SSL=/m);
  assert.match(envSource, /^ADMIN_TELEGRAM_IDS=/m);
  assert.match(envSource, /^SUPPORT_USERNAME=/m);
});
