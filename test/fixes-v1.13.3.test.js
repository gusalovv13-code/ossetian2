import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const script = await readFile(new URL("../public/script.js", import.meta.url), "utf8");
const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const css = await readFile(new URL("../public/style.css", import.meta.url), "utf8");
const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

test("версия и кеш обновлены до 1.13.4", () => {
  assert.equal(packageJson.version, "1.13.4");
  assert.match(html, /style\.css\?v=1\.13\.4/);
  assert.match(html, /script\.js\?v=1\.13\.4/);
});

test("Mini App не запрашивает fullscreen и защищена от вытягивания вниз", () => {
  const initBlock = script.match(/function initTelegramAppUI\(\) \{[\s\S]*?\n\}/)?.[0] || "";
  assert.doesNotMatch(initBlock, /requestTelegramFullscreen\(/);
  assert.doesNotMatch(script, /web_app_request_fullscreen/);
  assert.match(script, /function lockTelegramVerticalSwipes/);
  assert.match(script, /viewportChanged/);
  assert.match(script, /function initAppOverscrollGuard/);
  assert.match(script, /pullingPastTop/);
  assert.match(css, /\.phone \{[\s\S]*?overscroll-behavior-y: none !important/);
});

test("метаданные объявления объединены в компактный блок", () => {
  assert.match(script, /product-meta-dates/);
  assert.match(script, /product-meta-stats/);
  assert.match(css, /\.product-meta-dates/);
  assert.match(css, /\.product-meta-stats/);
});

test("кнопка жалобы не скрывается после Telegram-авторизации", () => {
  assert.match(html, /id="reportProductBtn"/);
  assert.match(script, /reportButton\.hidden = false/);
  assert.doesNotMatch(script, /reportButton\.hidden = isOwnProduct/);
});
