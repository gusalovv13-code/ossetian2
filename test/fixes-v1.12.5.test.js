import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const server = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");
const script = fs.readFileSync(new URL("../public/script.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../public/style.css", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

test("доступны только фиолетовый, зелёный и золотой цвета", () => {
  assert.match(server, /FEATURE_COLORS = new Set\(\["purple", "green", "gold"\]\)/);
  assert.doesNotMatch(server, /FEATURE_COLORS = new Set\([^\n]*"blue"/);
  assert.match(script, /FEATURE_REQUEST_COLORS = new Set\(\["purple", "green", "gold"\]\)/);
});

test("пользователь выбирает цвет до отправки заявки", () => {
  assert.match(html, /id="highlightDialog"/);
  assert.match(html, /name="highlightColor" value="purple" checked/);
  assert.match(html, /name="highlightColor" value="green"/);
  assert.match(html, /name="highlightColor" value="gold"/);
  assert.match(script, /new FormData\(form\)\.get\("highlightColor"\)/);
  assert.match(script, /JSON\.stringify\(\{ color \}\)/);
});

test("реклама в ленте занимает одну ячейку каталога", () => {
  assert.match(css, /\.product-list > \.advertising-feed[\s\S]*?grid-column: auto/);
  assert.match(css, /\.product-list > \.advertising-feed > img[\s\S]*?height: 120px/);
});

test("из заявки администратор может открыть чат пользователя", () => {
  assert.match(script, /openAdminFeatureRequestChat/);
  assert.match(script, /https:\/\/t\.me\/\$\{encodeURIComponent\(username\)\}/);
  assert.match(script, /tg:\/\/user\?id=/);
  assert.match(script, /Написать в Telegram/);
});

test("интерфейс использует единый системный шрифт", () => {
  assert.match(css, /--app-font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto/);
  assert.match(css, /button,\ninput,\nselect,\ntextarea,\ncode[\s\S]*?font-family: var\(--app-font\) !important/);
});
