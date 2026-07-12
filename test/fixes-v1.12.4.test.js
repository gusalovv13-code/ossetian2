import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const server = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");
const script = fs.readFileSync(new URL("../public/script.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../public/style.css", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

test("featured listings keep chronological catalog order", () => {
  const catalogStart = server.indexOf('app.get("/api/products"');
  const catalogEnd = server.indexOf('app.get("/api/my-products"', catalogStart);
  const catalog = server.slice(catalogStart, catalogEnd);
  assert.doesNotMatch(catalog, /featured_paid[\s\S]*?END DESC/);
  assert.match(catalog, /p\.created_at DESC/);
});

test("feed advertising spans the full two-column catalog", () => {
  assert.match(css, /\.advertising-feed\s*\{[\s\S]*?grid-column:\s*1\s*\/\s*-1/);
});

test("admin has a dedicated feature request workflow with requester identity", () => {
  assert.match(server, /"\/api\/admin\/feature-requests"/);
  assert.match(server, /user_first_name/);
  assert.match(server, /ownerId:\s*row\.owner_id/);
  assert.match(script, /renderAdminFeatureRequests/);
  assert.match(script, /Telegram ID:/);
  assert.match(html, /data-admin-tab="featureRequests"/);
});

test("feature request approval is request-specific", () => {
  assert.match(server, /"\/api\/admin\/feature-requests\/:id"/);
  assert.match(server, /WHERE id = \$1[\s\S]*?FOR UPDATE/);
  assert.match(server, /status = 'approved'/);
  assert.match(server, /status = 'rejected'/);
});
