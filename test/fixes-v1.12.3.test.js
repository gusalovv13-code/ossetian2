import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const server = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");
const index = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

test("catalog query never falls back to ORDER BY 0", () => {
  assert.equal(server.includes('let relevanceSql = "0"'), false);
  assert.equal(server.includes("let relevanceSql = '0'"), false);
  assert.equal(/ORDER BY[\s\S]{0,180}\b0\s+DESC/i.test(server), false);
  assert.equal(server.includes('...(relevanceSql ? [`${relevanceSql} DESC`] : [])'), true);
});

test("deployment exposes an independently verifiable build version", () => {
  assert.match(server, /const APP_VERSION = "1\.12\.9"/);
  assert.match(server, /app\.get\("\/api\/version"/);
  assert.match(server, /X-Ossetian-Market-Version/);
  assert.match(index, /style\.css\?v=1\.12\.9/);
  assert.match(index, /script\.js\?v=1\.12\.9/);
});
