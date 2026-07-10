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

test("маршрут профиля продавца существует", () => {
  assert.match(serverSource, /app\.get\("\/api\/users\/:id"/);
  assert.match(serverSource, /app\.get\("\/api\/users\/:id\/products"/);
});

test("публичный каталог не требует Telegram-авторизацию", () => {
  assert.match(serverSource, /app\.get\("\/api\/products", async/);
  assert.doesNotMatch(
    serverSource,
    /app\.get\("\/api\/products",\s*requireTelegramAuth/
  );
});

test("защищённые действия используют Telegram-авторизацию", () => {
  assert.match(
    serverSource,
    /app\.post\("\/api\/products", requireTelegramAuth, syncTelegramUser/
  );
  assert.match(
    serverSource,
    /app\.delete\("\/api\/products\/:id", requireTelegramAuth, syncTelegramUser/
  );
  assert.match(
    serverSource,
    /app\.post\("\/api\/favorites", requireTelegramAuth, syncTelegramUser/
  );
});

test("в SQL сохранения пользователя нет прежней ошибки last_seen", () => {
  assert.doesNotMatch(serverSource, /last_seen\s+last_seen/);
  assert.match(serverSource, /avatar,\s*last_seen\s*\)/);
});

test("карточки продавца доступны для открытия товара", () => {
  assert.match(clientSource, /sellerProducts:\s*\[\]/);
  assert.match(clientSource, /state\.sellerProducts = products/);
  assert.match(clientSource, /function findProductById/);
  assert.doesNotMatch(clientSource, /\$\{product\.price\}\s*₽/);
});

test("HTML не содержит повторяющихся id", () => {
  const ids = [...htmlSource.matchAll(/\sid=["']([^"']+)["']/g)].map(
    match => match[1]
  );
  const uniqueIds = new Set(ids);

  assert.equal(ids.length, uniqueIds.size);
});
