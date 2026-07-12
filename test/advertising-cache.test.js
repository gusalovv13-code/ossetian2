import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const serverSource = await readFile(new URL("../server.js", import.meta.url), "utf8");
const clientSource = await readFile(new URL("../public/script.js", import.meta.url), "utf8");
const htmlSource = await readFile(new URL("../public/index.html", import.meta.url), "utf8");

test("клиентские файлы рекламы имеют актуальную версию кеша", () => {
  assert.match(htmlSource, /style\.css\?v=1\.12\.3/);
  assert.match(htmlSource, /script\.js\?v=1\.12\.3/);
  assert.doesNotMatch(htmlSource, /\?v=1120/);
});

test("Telegram WebView обязан перепроверять HTML, JS и CSS", () => {
  assert.match(serverSource, /no-store, no-cache, must-revalidate, proxy-revalidate/);
  assert.match(serverSource, /filePath\.endsWith\("script\.js"\)/);
  assert.match(serverSource, /filePath\.endsWith\("style\.css"\)/);
});

test("активная верхняя реклама видна уже на главной", () => {
  assert.match(htmlSource, /id="homeTopAds"/);
  assert.match(clientSource, /document\.getElementById\("homeTopAds"\)/);
  assert.match(clientSource, /state\.page === "home"/);
  assert.match(clientSource, /feedFallback/);
});

test("запрос рекламы получает уникальный URL", () => {
  assert.match(clientSource, /\/api\/ads\?_\=\$\{Date\.now\(\)\}/);
});
