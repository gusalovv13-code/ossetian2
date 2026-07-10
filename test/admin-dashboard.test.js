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

test("админка автоматически загружается при открытии страницы", () => {
  assert.match(
    clientSource,
    /if \(page === "admin"\) \{\s*loadAdminPanel\(\);\s*\}/
  );
});

test("скрытые объявления исключены из публичных запросов", () => {
  const hiddenFilters = serverSource.match(
    /COALESCE\(hidden, FALSE\) = FALSE/g
  ) || [];

  assert.ok(hiddenFilters.length >= 3);
});

test("бан пользователя реально ограничивает защищённые действия", () => {
  assert.match(serverSource, /RETURNING banned/);
  assert.match(serverSource, /code: "USER_BANNED"/);
  assert.match(serverSource, /SET banned = NOT COALESCE\(banned, FALSE\)/);
});

test("журнал администратора использует совместимый текстовый id", () => {
  assert.match(serverSource, /ALTER COLUMN id TYPE TEXT USING id::text/);
  assert.match(
    serverSource,
    /INSERT INTO admin_logs \(id, admin_id, action, target, details\)/
  );
  assert.match(serverSource, /\[randomUUID\(\), String\(adminId\)/);
});

test("административное удаление не удаляет строку физически", () => {
  assert.match(serverSource, /status = 'deleted'/);
  assert.doesNotMatch(
    serverSource,
    /app\.delete\(\s*"\/api\/admin\/products\/:id"[\s\S]*?DELETE FROM products/
  );
});

test("интерфейс содержит все основные разделы админки", () => {
  assert.match(htmlSource, /data-admin-tab="products"/);
  assert.match(htmlSource, /data-admin-tab="users"/);
  assert.match(htmlSource, /data-admin-tab="logs"/);
  assert.match(htmlSource, /data-admin-tab="growth"/);
  assert.match(htmlSource, /id="adminSearch"/);
});

test("для админки есть адаптивные и тёмные стили", () => {
  assert.match(cssSource, /\.admin-stats-grid/);
  assert.match(cssSource, /body\.dark-mode \.admin-toolbar/);
  assert.match(cssSource, /@media \(max-width: 460px\)/);
});
