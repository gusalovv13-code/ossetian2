import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync("public/index.html", "utf8");
const css = fs.readFileSync("public/style.css", "utf8");
const client = fs.readFileSync("public/script.js", "utf8");
const server = fs.readFileSync("server.js", "utf8");
const manifest = JSON.parse(fs.readFileSync("public/manifest.webmanifest", "utf8"));

test("выделение использует один спокойный цвет", () => {
  assert.match(client, /const FEATURE_REQUEST_COLOR = "green"/);
  assert.match(client, /const featuredClass = product\.isFeatured \? "is-featured featured-green"/);
  assert.doesNotMatch(html, /value="purple"|value="gold"|Фиолетовый|Золотой/);
  assert.match(html, /Спокойное выделение/);
  assert.match(server, /const FEATURE_COLOR = "green"/);
  assert.match(server, /UPDATE products SET featured_color = 'green'/);
  assert.match(css, /--feature-card-bg: #1b2b2b/);
});

test("поиск имеет явную кнопку очистки", () => {
  assert.match(html, /id="searchClearButton"/);
  assert.match(html, /aria-label="Очистить поисковый запрос"/);
  assert.match(client, /searchClearButton\?\.addEventListener\("click"/);
  assert.match(client, /searchInput\.value = ""/);
  assert.match(css, /\.search-clear-button/);
});

test("интерфейс запрашивает портретную ориентацию", () => {
  assert.equal(manifest.orientation, "portrait");
  assert.match(html, /name="screen-orientation" content="portrait"/);
  assert.match(client, /tg\?\.lockOrientation\?\.\(\)/);
  assert.match(client, /orientation\.lock\("portrait"\)/);
});

test("кнопка администратора оформлена отдельной строкой настроек", () => {
  assert.match(html, /class="settings-card admin-settings-card"/);
  assert.match(html, /class="admin-settings-row"/);
  assert.match(html, /class="admin-settings-icon"/);
  assert.match(css, /\.admin-settings-row/);
  assert.match(css, /#ff6681/);
});
