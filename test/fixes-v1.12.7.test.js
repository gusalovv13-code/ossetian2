import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const server = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");
const script = fs.readFileSync(new URL("../public/script.js", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const env = fs.readFileSync(new URL("../.env", import.meta.url), "utf8");
const envExample = fs.readFileSync(new URL("../.env.example", import.meta.url), "utf8");
const packageJson = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));

test("username бота os_15market_bot уже настроен", () => {
  assert.match(env, /^BOT_USERNAME=os_15market_bot$/m);
  assert.match(envExample, /^BOT_USERNAME=os_15market_bot$/m);
  assert.match(server, /process\.env\.TELEGRAM_BOT_USERNAME \|\| "os_15market_bot"/);
});

test("фотография объявления подготавливается как JPEG для Telegram", () => {
  assert.equal(packageJson.dependencies.sharp.length > 0, true);
  assert.match(server, /app\.get\("\/api\/products\/:id\/share-photo\.jpg"/);
  assert.match(server, /const render = \(size, quality\) => sharp\(input,[\s\S]*?\.jpeg\(\{ quality, mozjpeg: true \}\)/);
  assert.match(server, /Content-Type", "image\/jpeg"/);
});

test("нативная отправка Telegram включает фото, ссылку и кнопку", () => {
  assert.match(server, /savePreparedInlineMessage/);
  assert.match(server, /type: "photo"/);
  assert.match(server, /photo_url: photoUrl/);
  assert.match(server, /text: "Открыть объявление"/);
  assert.match(server, /allow_group_chats: true/);
  assert.match(script, /typeof tg\?\.shareMessage === "function"/);
  assert.match(script, /tg\.shareMessage\(prepared\.preparedMessageId/);
});

test("старые клиенты получают ссылку с фотопревью и возвратом в Telegram", () => {
  assert.match(server, /app\.get\("\/share\/product\/:id"/);
  assert.match(server, /property="og:image"/);
  assert.match(server, /tg:\/\/resolve\?domain=/);
  assert.match(script, /getProductSharePageLink/);
  assert.match(script, /https:\/\/t\.me\/share\/url/);
});

test("кеш фронтенда обновлён до 1.13.4", () => {
  assert.match(html, /style\.css\?v=1\.13\.4/);
  assert.match(html, /script\.js\?v=1\.13\.4/);
});
