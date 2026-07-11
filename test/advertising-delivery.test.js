import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const serverSource = await readFile(new URL("../server.js", import.meta.url), "utf8");
const clientSource = await readFile(new URL("../public/script.js", import.meta.url), "utf8");

test("расписание рекламы учитывает часовой пояс браузера", () => {
  assert.match(clientSource, /function datetimeLocalToISOString/);
  assert.match(clientSource, /date\.toISOString\(\)/);
  assert.match(clientSource, /startsAt: datetimeLocalToISOString/);
  assert.match(clientSource, /endsAt: datetimeLocalToISOString/);
});

test("первая реклама видна даже в короткой ленте", () => {
  assert.match(clientSource, /nextAdPosition = Math\.min\(firstInterval, products\.length\)/);
  assert.match(clientSource, /productPosition === nextAdPosition/);
});

test("ответы рекламы не кешируются", () => {
  assert.match(clientSource, /apiRequest\(`\/api\/ads\?_\=\$\{Date\.now\(\)\}`, \{ cache: "no-store" \}\)/);
  assert.match(serverSource, /Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate/);
});

test("админка объясняет состояние доставки рекламы", () => {
  assert.match(clientSource, /function getAdDeliveryNote/);
  assert.match(clientSource, /достигнут лимит показов/);
  assert.match(clientSource, /статус кампании не «Активна»/);
});
