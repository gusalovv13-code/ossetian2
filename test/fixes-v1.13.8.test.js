import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const serverSource = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");
const dockerSource = fs.readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");
const packageJson = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));

test("версия обновлена до 1.13.8", () => {
  assert.equal(packageJson.version, "1.13.8");
  assert.match(serverSource, /const APP_VERSION = "1\.13\.8"/);
});

test("HTTP-порт открывается до завершения подключения PostgreSQL", () => {
  const listenAt = serverSource.indexOf('app.listen(PORT, "0.0.0.0"');
  const initAt = serverSource.lastIndexOf("ensureDatabaseInitialization();");
  assert.ok(listenAt >= 0);
  assert.ok(initAt > listenAt);
  assert.doesNotMatch(serverSource.slice(listenAt), /Database init error:[\s\S]{0,200}process\.exit\(1\)/);
});

test("Render health check использует фактический PORT", () => {
  assert.match(dockerSource, /\$\{PORT:-3000\}\/api\/health/);
});

test("при недоступной БД API возвращает 503, а сервер продолжает переподключение", () => {
  assert.match(serverSource, /DATABASE_UNAVAILABLE/);
  assert.match(serverSource, /server remains online and will retry in 30 seconds/);
  assert.match(serverSource, /app\.get\("\/api\/ready"/);
});

test("на Render принудительно включается TLS и URL не может перезаписать SSL-конфигурацию", () => {
  assert.match(serverSource, /const DATABASE_SSL = IS_RENDER && IS_RENDER_POSTGRES \? true : DATABASE_SSL_CONFIGURED/);
  assert.match(serverSource, /\["sslmode", "sslcert", "sslkey", "sslrootcert"\]/);
});
