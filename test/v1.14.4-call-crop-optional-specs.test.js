import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync("public/index.html", "utf8");
const callPage = fs.readFileSync("public/call.html", "utf8");
const css = fs.readFileSync("public/style.css", "utf8");
const client = fs.readFileSync("public/script.js", "utf8");

test("мобильный звонок открывается через внешнюю страницу", () => {
  assert.match(client, /function buildExternalCallPageUrl\(phone\)/);
  assert.match(client, /tg\.openLink\(url, \{ try_instant_view: false \}\)/);
  assert.match(client, /function handleCallSheetConfirm\(event\)/);
  assert.match(callPage, /id="callLink"[\s\S]*href="#"/);
  assert.match(callPage, /link\.href = "tel:" \+ phone/);
});

test("есть редактор кадра каталога", () => {
  assert.match(html, /id="catalogCoverPreview"/);
  assert.match(html, /id="coverCropDialog"/);
  assert.match(client, /function createCatalogThumbnailFromImage\(/);
  assert.match(client, /function openCoverCropEditor\(/);
  assert.match(client, /function setDraftCoverImage\(index\)/);
  assert.match(css, /\.cover-crop-viewport/);
  assert.match(css, /object-fit:\s*cover\s*!important/);
});

test("точные характеристики не блокируют публикацию", () => {
  assert.match(html, /Точные характеристики[\s\S]*необязательно/);
  assert.match(client, /function getStructuredAdValidationError\(ad\) \{[\s\S]*return "";/);
});
