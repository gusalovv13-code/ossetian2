import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const script = await readFile(new URL("../public/script.js", import.meta.url), "utf8");
const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const css = await readFile(new URL("../public/style.css", import.meta.url), "utf8");
const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

test("версия и кеш обновлены до 1.13.7", () => {
  assert.equal(packageJson.version, "1.13.7");
  assert.match(html, /style\.css\?v=1\.13\.7/);
  assert.match(html, /script\.js\?v=1\.13\.7/);
});

test("страницы получают отдельные анимации для перехода вперёд и назад", () => {
  assert.match(script, /function animatePageEntry/);
  assert.match(script, /page-enter-forward/);
  assert.match(script, /page-enter-back/);
  assert.match(script, /transitionDirection/);
  assert.match(script, /showPage\(prev, false, false, "back"\)/);
  assert.match(css, /@keyframes market-page-enter-forward/);
  assert.match(css, /@keyframes market-page-enter-back/);
});

test("анимация быстро очищается и не остаётся после частых нажатий", () => {
  assert.match(script, /pageTransitionSequence/);
  assert.match(script, /pageTransitionTimer/);
  assert.match(script, /event\.target !== targetPage/);
  assert.match(script, /PAGE_TRANSITION_MS \+ 90/);
});

test("переходы учитывают системное уменьшение движения", () => {
  assert.match(script, /prefers-reduced-motion: reduce/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /\.page\.active\.page-enter-forward/);
  assert.match(css, /animation: none !important/);
});
