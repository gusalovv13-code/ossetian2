import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const serverSource = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");
const packageJson = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));

test("версия обновлена до 1.13.7", () => {
  assert.equal(packageJson.version, "1.13.7");
  assert.match(serverSource, /const APP_VERSION = "1\.13\.7"/);
});

test("инициализация PostgreSQL повторяется после временного ECONNRESET", () => {
  assert.match(serverSource, /async function initDbWithRetry\(\)/);
  assert.match(serverSource, /"ECONNRESET"/);
  assert.match(serverSource, /Retrying PostgreSQL initialization/);
  assert.match(serverSource, /DB_INIT_MAX_ATTEMPTS/);
});

test("миграции используют выделенный клиент и удаляют сломанное соединение", () => {
  assert.match(serverSource, /client = await pool\.connect\(\)/);
  assert.match(serverSource, /await initDb\(migrationDb\)/);
  assert.match(serverSource, /client\.release\(failure \|\| undefined\)/);
});

test("ошибка простаивающего клиента пула не завершает процесс", () => {
  assert.match(serverSource, /pool\.on\("error"/);
  assert.doesNotMatch(serverSource, /pool\.on\("error"[\s\S]{0,300}process\.exit/);
});
