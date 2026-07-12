import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const serverSource = await readFile(new URL("../server.js", import.meta.url), "utf8");
const clientSource = await readFile(new URL("../public/script.js", import.meta.url), "utf8");
const htmlSource = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const cssSource = await readFile(new URL("../public/style.css", import.meta.url), "utf8");

test("каталог без поискового запроса не создаёт запрещённый ORDER BY 0", () => {
  assert.doesNotMatch(serverSource, /let relevanceSql = "0"/);
  assert.doesNotMatch(serverSource, /\$\{relevanceSql\} DESC,/);
  assert.match(serverSource, /\.\.\.\(relevanceSql \? \[\`\$\{relevanceSql\} DESC\`\] : \[\]\)/);
  assert.match(serverSource, /const orderBySql = \[/);
});

test("категории не сжимаются и обрабатываются единым обработчиком", () => {
  assert.match(cssSource, /\.categories button \{[\s\S]*?flex: 0 0 auto;/);
  assert.match(cssSource, /min-width: max-content;/);
  assert.match(cssSource, /\.categories::-webkit-scrollbar/);
  assert.match(clientSource, /const categoriesRoot = document\.querySelector\("\.categories"\)/);
  assert.match(clientSource, /event\.target\.closest\("button\[data-category\]"\)/);
  assert.match(htmlSource, /aria-pressed="true"/);
});

test("кнопки управления объявлениями имеют подписи и отдельную мобильную раскладку", () => {
  for (const label of ["Редактировать", "Продано", "Опубликовать", "Выделить цветом", "Удалить"]) {
    assert.match(clientSource, new RegExp(label));
  }
  assert.match(clientSource, /owner-product-card/);
  assert.match(cssSource, /#myAdsList\.product-list[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(cssSource, /#myAdsList \.owner-product-card \.product-card-actions[\s\S]*?repeat\(2, minmax\(0, 1fr\)\)/);
});
