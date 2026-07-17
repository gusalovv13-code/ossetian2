import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("юридический центр содержит основные документы", async () => {
  const html = await read("public/legal/index.html");
  for (const id of [
    "operator", "agreement", "listing-rules", "privacy", "pd-consent",
    "public-data-consent", "cookies", "moderation", "copyright", "paid-services", "safety"
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
});

test("согласие на обработку и соглашение подтверждаются отдельно", async () => {
  const html = await read("public/index.html");
  assert.match(html, /id="coreTermsAccepted"/);
  assert.match(html, /id="corePdConsentAccepted"/);
  assert.match(html, /id="legalOnboardingDialog"/);
});

test("публичный телефон и Telegram имеют отдельные согласия", async () => {
  const html = await read("public/index.html");
  assert.match(html, /id="adPublicPhoneConsent"/);
  assert.match(html, /id="adPublicTelegramConsent"/);
  const script = await read("public/script.js");
  assert.match(script, /PUBLIC_PHONE_CONSENT_REQUIRED|publicPhoneConsent/);
  assert.match(script, /PUBLIC_TELEGRAM_CONSENT_REQUIRED|publicTelegramConsent/);
});

test("сервер хранит версии юридических согласий", async () => {
  const server = await read("server.js");
  assert.match(server, /CREATE TABLE IF NOT EXISTS legal_acceptances/);
  assert.match(server, /recordCoreLegalAcceptancesFromRequest/);
  assert.match(server, /recordListingLegalAcceptances/);
  assert.match(server, /const LEGAL_DOCUMENT_VERSION = "1\.16\.0"/);
});

test("реквизиты вынесены в один конфигурационный файл", async () => {
  const config = await read("public/legal/legal-config.js");
  assert.match(config, /operatorName/);
  assert.match(config, /privacyEmail/);
  assert.match(config, /copyrightEmail/);
  assert.match(config, /\[УКАЖИТЕ/);
});
