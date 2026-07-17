import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync("public/index.html", "utf8");
const css = fs.readFileSync("public/style.css", "utf8");
const client = fs.readFileSync("public/script.js", "utf8");
const server = fs.readFileSync("server.js", "utf8");

test("карточки каталога имеют одинаковую высоту", () => {
  assert.match(css, /#productList\.product-list\s*\{[^}]*grid-auto-rows:\s*226px/s);
  assert.match(css, /#productList\.product-list > \.product-card,[\s\S]*height:\s*226px/);
  assert.match(css, /#productList > \.product-card\.is-featured:not\(\.owner-product-card\)[\s\S]*height:\s*226px/);
});

test("плашка выделения уменьшена", () => {
  assert.match(css, /\.featured-card-badge[\s\S]*min-height:\s*18px[\s\S]*font-size:\s*8\.5px/);
});

test("кнопка и номер запускают прямой системный звонок", () => {
  assert.match(client, /<a href="tel:\$\{escapeHTML\(cleanPhone\)\}" class="phone-line-link"/);
  assert.match(client, /callBtn\.onclick[\s\S]*startPhoneCall\(cleanPhone\)/);
  assert.match(client, /window\.location\.href = `tel:\$\{normalizedPhone\}`/);
  assert.doesNotMatch(client, /\/call\?phone=|openCallSheet|callSheetDialog/);
  assert.doesNotMatch(html, /callSheetDialog/);
  assert.doesNotMatch(server, /app\.get\("\/call"/);
});
