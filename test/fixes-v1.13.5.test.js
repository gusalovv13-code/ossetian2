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

test("полноэкранный режим Telegram возвращён с безопасным fallback", () => {
  assert.match(script, /function requestTelegramFullscreen/);
  assert.match(script, /typeof tg\.requestFullscreen === "function"/);
  assert.match(script, /tg\.isVersionAtLeast\("8\.0"\)/);
  assert.match(script, /if \(!tg\.isFullscreen\) tg\.requestFullscreen\(\)/);
  assert.match(script, /tg\.onEvent\?\.\("fullscreenChanged"/);
  assert.match(script, /tg\.onEvent\?\.\("fullscreenFailed"/);
  assert.match(script, /tg\.onEvent\?\.\("activated", requestTelegramFullscreen\)/);
});

test("заголовок корректно расположен и в fullscreen, и на старых клиентах", () => {
  assert.match(script, /telegram-fullscreen/);
  assert.match(script, /telegram-not-fullscreen/);
  assert.match(css, /html\.telegram-fullscreen \.topbar-title[\s\S]*?translateY\(-30px\)/);
  assert.match(css, /html\.telegram-not-fullscreen \.topbar-title[\s\S]*?translateY\(0\)/);
});
