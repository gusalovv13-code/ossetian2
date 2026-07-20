import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const script = await readFile(new URL("../public/script.js", import.meta.url), "utf8");
const server = await readFile(new URL("../server.js", import.meta.url), "utf8");
const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");

test("publish request forwards both listing consent flags", () => {
  assert.match(script, /publicPhoneConsent:\s*ad\.publicPhoneConsent/);
  assert.match(script, /publicTelegramConsent:\s*ad\.publicTelegramConsent/);
});

test("legal acceptance write is compatible with legacy schema", () => {
  assert.match(server, /ALTER TABLE legal_acceptances ADD COLUMN IF NOT EXISTS document_key TEXT/);
  assert.match(server, /async function resolveLegalAcceptanceStorage/);
  assert.match(server, /CREATE TABLE IF NOT EXISTS legal_acceptances_v2/);
  assert.match(server, /const \{ tableName, columns \} = await resolveLegalAcceptanceStorage\(database\)/);
  assert.doesNotMatch(server.match(/async function recordLegalAcceptance[\s\S]*?\n}/)?.[0] || "", /ON CONFLICT \(user_id, document_key, document_version\)/);
});

test("Telegram WebView reloads consent publish hotfix", () => {
  assert.match(html, /script\.js\?v=1\.19\.3&hotfix=1\.19\.6/);
});
