import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "crypto";
import { validateTelegramInitData } from "../telegram-auth.js";

const BOT_TOKEN = "123456:TEST_TOKEN";

function createSignedInitData({ authDate, user } = {}) {
  const params = new URLSearchParams({
    auth_date: String(authDate ?? Math.floor(Date.now() / 1000)),
    query_id: "AAEAAAE",
    user: JSON.stringify(
      user ?? {
        id: 123456789,
        first_name: "Алан",
        last_name: "Тестов",
        username: "alan_test"
      }
    )
  });

  const dataCheckString = [...params.entries()]
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = createHmac("sha256", "WebAppData")
    .update(BOT_TOKEN)
    .digest();

  const hash = createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  params.set("hash", hash);
  return params.toString();
}

test("принимает корректно подписанный initData", () => {
  const auth = validateTelegramInitData(createSignedInitData(), BOT_TOKEN);

  assert.equal(auth.user.id, "123456789");
  assert.equal(auth.user.firstName, "Алан");
  assert.equal(auth.user.username, "alan_test");
});

test("отклоняет подмену пользователя", () => {
  const params = new URLSearchParams(createSignedInitData());
  params.set("user", JSON.stringify({ id: 999, first_name: "Hacker" }));

  assert.throws(
    () => validateTelegramInitData(params.toString(), BOT_TOKEN),
    /подпись/i
  );
});

test("отклоняет устаревший initData", () => {
  const authDate = 1_700_000_000;
  const initData = createSignedInitData({ authDate });

  assert.throws(
    () =>
      validateTelegramInitData(initData, BOT_TOKEN, {
        maxAgeSeconds: 86400,
        nowSeconds: authDate + 86401
      }),
    /устарела/i
  );
});
