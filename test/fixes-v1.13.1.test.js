import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const server = await readFile(new URL("../server.js", import.meta.url), "utf8");
const script = await readFile(new URL("../public/script.js", import.meta.url), "utf8");
const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const css = await readFile(new URL("../public/style.css", import.meta.url), "utf8");
const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

test("версия и кеш обновлены до 1.13.4", () => {
  assert.equal(packageJson.version, "1.13.4");
  assert.match(server, /const APP_VERSION = "1\.13\.4"/);
  assert.match(html, /style\.css\?v=1\.13\.4/);
  assert.match(html, /script\.js\?v=1\.13\.4/);
});

test("редактор объявления содержит явное управление скидкой", () => {
  assert.match(html, /id="adDiscountEditor"/);
  assert.match(html, /id="adDiscountEnabled"/);
  assert.match(html, /id="adDiscountPrice"/);
  assert.match(script, /function getDiscountValidationError/);
  assert.match(script, /discountEnabled: ad\.discountEnabled/);
  assert.match(script, /originalPrice: ad\.discountEnabled/);
});

test("сервер проверяет и сохраняет обычную цену и цену со скидкой", () => {
  assert.match(server, /requestedDiscountEnabled/);
  assert.match(server, /Цена со скидкой должна быть ниже обычной цены/);
  assert.match(server, /previous_price = \$19/);
  assert.match(server, /previous_price_amount = \$20/);
  assert.match(server, /discountEnabled: priceDropped/);
});

test("скидка отображается зелёной меткой со старой зачёркнутой ценой", () => {
  assert.match(script, /price-drop-card-badge">Скидка/);
  assert.match(script, /<s>\$\{previousPrice\}<\/s>/);
  assert.match(script, /class="discounted-price"/);
  assert.match(css, /\.price-drop-card-badge/);
  assert.match(css, /#15803d/);
  assert.match(css, /\.discount-editor/);
});
