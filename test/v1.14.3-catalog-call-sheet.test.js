import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync("public/index.html", "utf8");
const css = fs.readFileSync("public/style.css", "utf8");
const client = fs.readFileSync("public/script.js", "utf8");

test("фото каталога вписываются без сильной обрезки", () => {
  assert.match(css, /#productList > \.product-card:not\(\.owner-product-card\) > img,[\s\S]*object-fit:\s*contain\s*!important/);
});

test("вакансии получают отдельный компактный класс", () => {
  assert.match(client, /const isVacancyCard = isVacancyCategory\(product\.category\)/);
  assert.match(client, /\$\{isVacancyCard \? "is-vacancy-card" : ""\}/);
  assert.match(css, /#productList > \.product-card\.is-vacancy-card:not\(\.owner-product-card\) > img\s*\{[\s\S]*height:\s*92px/);
});

test("звонок открывает выезжающее меню с прямой tel-ссылкой", () => {
  assert.match(html, /id="callSheet"[^>]*role="dialog"/);
  assert.match(html, /id="callSheetConfirm"[^>]*href="tel:"/);
  assert.match(client, /function showPhoneMenu\(phone\)/);
  assert.match(client, /event\.preventDefault\(\);[\s\S]*showPhoneMenu\(sellerPhone \|\| cleanPhone\)/);
  assert.match(css, /\.call-sheet\.is-open[\s\S]*pointer-events:\s*auto/);
});
