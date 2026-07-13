import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const script = fs.readFileSync(new URL("../public/script.js", import.meta.url), "utf8");
const server = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../public/style.css", import.meta.url), "utf8");
const packageJson = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));

test("версия и кеш обновлены до 1.13.0", () => {
  assert.equal(packageJson.version, "1.13.0");
  assert.match(server, /const APP_VERSION = "1\.13\.0"/);
  assert.match(html, /style\.css\?v=1\.13\.0/);
  assert.match(html, /script\.js\?v=1\.13\.0/);
});

test("фильтры каталога используют зависимые выпадающие списки", () => {
  for (const id of ["filterDistrict", "filterItemType", "filterBrand", "filterModel", "filterYear"]) {
    assert.match(html, new RegExp(`<select id="${id}"`));
  }
  assert.match(script, /const PRODUCT_TAXONOMY/);
  assert.match(script, /function refreshCatalogFilterOptions/);
  assert.match(script, /getModelOptions\(state\.category/);
  assert.match(script, /params\.set\("itemType", filters\.itemType\)/);
  assert.match(script, /params\.set\("year", filters\.year\)/);
});

test("создание объявления сохраняет тип, бренд, модель и год", () => {
  for (const id of ["adStructuredFields", "adItemType", "adBrand", "adModel", "adYear"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(script, /specifications\["Тип товара"\]/);
  assert.match(script, /specifications\["Марка \/ бренд"\]/);
  assert.match(script, /specifications\["Модель"\]/);
  assert.match(script, /specifications\["Год выпуска"\]/);
  assert.match(script, /getStructuredAdValidationError/);
});

test("район зависит от города и допускает ручной ввод", () => {
  assert.match(script, /const CITY_DISTRICTS/);
  assert.match(html, /id="adDistrictCustom"/);
  assert.match(script, /refreshAdDistrictOptions/);
  assert.match(script, /OTHER_OPTION_VALUE/);
});

test("сервер фильтрует структурированные характеристики", () => {
  assert.match(server, /req\.query\.itemType/);
  assert.match(server, /req\.query\.year/);
  assert.match(server, /function? addStructuredFilter|const addStructuredFilter/);
  assert.match(server, /addStructuredFilter\(brand, \["Марка \/ бренд", "Марка", "Бренд"\]\)/);
  assert.match(server, /addStructuredFilter\(year, \["Год выпуска", "Год"\]\)/);
});

test("новые элементы имеют отдельное оформление", () => {
  assert.match(css, /\.structured-fields-card/);
  assert.match(css, /DEPENDENT TAXONOMY SELECTS/);
});
