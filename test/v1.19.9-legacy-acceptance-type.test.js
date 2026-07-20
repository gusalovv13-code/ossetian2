import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const server = await readFile(new URL("../server.js", import.meta.url), "utf8");

test("legacy legal acceptance schema fills required acceptance_type", () => {
  assert.match(server, /pushInsert\("acceptance_type", normalizedDocumentKey\)/);
  assert.match(server, /SELECT column_name, is_nullable, column_default, is_identity, is_generated/);
  assert.match(server, /unsupportedRequiredColumns/);
  assert.match(server, /CREATE TABLE IF NOT EXISTS legal_acceptances_v2/);
});
