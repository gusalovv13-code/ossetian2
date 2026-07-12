import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const serverSource = await readFile(new URL("../server.js", import.meta.url), "utf8");
const clientSource = await readFile(new URL("../public/script.js", import.meta.url), "utf8");
const cssSource = await readFile(new URL("../public/style.css", import.meta.url), "utf8");

test("фото рекламы выбирается файлом с телефона, а не вводится URL", () => {
  assert.match(clientSource, /id="adCampaignImageFile" type="file" accept="image\/\*"/);
  assert.match(clientSource, /function handleAdCampaignImageChange/);
  assert.match(clientSource, /function compressAdCampaignImage/);
  assert.match(clientSource, /imageUrl: adminAdImageData/);
  assert.doesNotMatch(clientSource, /URL изображения<input id="adCampaignImage"/);
  assert.match(cssSource, /\.ad-image-upload-box/);
});

test("сервер проверяет формат и размер загруженного изображения", () => {
  assert.match(serverSource, /function hasValidImageSignature/);
  assert.match(serverSource, /MAX_STORED_IMAGE_BYTES/);
  assert.match(serverSource, /Фото рекламы повреждено/);
  assert.match(serverSource, /entity\.too\.large/);
});

test("публичный API рекламы не отправляет Base64-картинку внутри JSON", () => {
  assert.match(serverSource, /function mapPublicAdCampaign/);
  assert.match(serverSource, /app\.get\("\/api\/ads\/:id\/image"/);
  assert.match(serverSource, /result\.rows\.map\(mapPublicAdCampaign\)/);
  assert.ok(clientSource.includes("/^\\/api\\/ads\\/[a-z0-9%._~-]+\\/image"));
});

test("реклама работает при недоступном browser storage", () => {
  assert.match(clientSource, /function readBrowserStorage/);
  assert.match(clientSource, /function writeBrowserStorage/);
  assert.doesNotMatch(clientSource, /sessionStorage\.getItem\(sessionKey\)/);
});
