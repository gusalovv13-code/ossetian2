import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync("public/index.html", "utf8");
const css = fs.readFileSync("public/style.css", "utf8");
const client = fs.readFileSync("public/script.js", "utf8");

test("связанные объявления компактнее и показывают почти две карточки", () => {
  assert.match(css, /\.related-products\s*\{[\s\S]*grid-auto-columns:\s*clamp\(140px,\s*43vw,\s*164px\)/);
  assert.match(css, /\.related-products > \.product-card,[\s\S]*height:\s*205px/);
  assert.match(css, /\.related-products > \.product-card > img,[\s\S]*height:\s*104px/);
});

test("возврат восстанавливает позицию прокрутки каталога", () => {
  assert.match(client, /pageScrollPositions:\s*\{\}/);
  assert.match(client, /function savePageScroll\(pageId\)/);
  assert.match(client, /if \(pageChanged\) savePageScroll\(previousPage\)/);
  assert.match(client, /resolvedTransitionDirection === "back"[\s\S]*restorePageScroll\(page\)/);
});

test("кнопка звонка использует прямую tel-ссылку", () => {
  assert.match(html, /<a id="callBtn"[^>]*role="button"[^>]*aria-disabled="true"/);
  assert.match(client, /callBtn\.setAttribute\("href", telHref\)/);
  assert.match(client, /if \(callBtn\.tagName !== "A"\)/);
  assert.match(client, /callLink\.href = `tel:\$\{normalizedPhone\}`/);
  assert.doesNotMatch(client, /window\.location\.href = `tel:/);
});
