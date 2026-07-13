import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const server = await readFile(new URL("../server.js", import.meta.url), "utf8");
const script = await readFile(new URL("../public/script.js", import.meta.url), "utf8");
const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const css = await readFile(new URL("../public/style.css", import.meta.url), "utf8");
const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

test("версия и кеш обновлены до 1.13.3", () => {
  assert.equal(packageJson.version, "1.13.3");
  assert.match(server, /const APP_VERSION = "1\.13\.3"/);
  assert.match(html, /style\.css\?v=1\.13\.3/);
  assert.match(html, /script\.js\?v=1\.13\.3/);
});

test("вакансии доступны в каталоге, форме и серверной категории", () => {
  assert.match(html, /data-category="Вакансии"/);
  assert.match(html, /option value="Вакансии"/);
  assert.match(server, /"Вакансии"/);
  assert.match(script, /"Вакансии": \{/);
  assert.match(script, /Сфера работы/);
  assert.match(script, /График работы/);
  assert.match(script, /Тип занятости/);
});

test("поисковые слова вакансии и работа ограничивают результаты актуальными вакансиями", () => {
  assert.match(server, /vacancyRequested/);
  assert.match(server, /term\.startsWith\("ваканс"\)/);
  assert.match(server, /conditions\.push\(`p\.category = \$\$\{values\.length\}`\)/);
  assert.match(server, /COALESCE\(p\.status, 'active'\) = \$1/);
});

test("отправка подготавливается заранее и имеет быстрый резервный переход", () => {
  assert.match(script, /prepareProductShareMessage\(product\)/);
  assert.match(script, /Promise\.race/);
  assert.match(script, /850/);
  assert.match(script, /openFastTelegramShare/);
  assert.match(server, /preparedShareMessageCache/);
});

test("копирование ссылки удалено, а жалоба выделена", () => {
  assert.doesNotMatch(html, /copyProductLink/);
  assert.doesNotMatch(html, /Скопировать ссылку/);
  assert.match(html, /report-product-action/);
  assert.match(html, /Пожаловаться на объявление/);
  assert.match(css, /\.report-product-action/);
});
