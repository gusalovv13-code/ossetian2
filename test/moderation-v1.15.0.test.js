import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { containsModerationPattern } from "../moderation-text.js";

const serverSource = await readFile(new URL("../server.js", import.meta.url), "utf8");
const policySource = await readFile(new URL("../moderation-policy.js", import.meta.url), "utf8");
const textSource = await readFile(new URL("../moderation-text.js", import.meta.url), "utf8");
const clientSource = await readFile(new URL("../public/script.js", import.meta.url), "utf8");

test("пакет модерации разделён по категориям и уровням решения", () => {
  assert.match(policySource, /MODERATION_POLICY_VERSION/);
  assert.match(policySource, /DEFAULT_MODERATION_RULES/);
  assert.match(policySource, /"drugs", "block"/);
  assert.match(policySource, /"fraud", "review"/);
  assert.match(policySource, /"regulated_goods", "review"/);
  assert.match(serverSource, /category TEXT DEFAULT 'custom'/);
  assert.match(serverSource, /action TEXT DEFAULT 'review'/);
});

test("маскировки слов распознаются через Unicode, похожие символы и разделители", () => {
  assert.match(textSource, /normalize\("NFKC"\)/);
  assert.match(textSource, /MODERATION_CONFUSABLES/);
  assert.equal(containsModerationPattern("г.е.р.о.и.н", "героин", "word"), true);
  assert.equal(containsModerationPattern("гeр0ин", "героин", "word"), true);
  assert.equal(containsModerationPattern("мееефедрон", "мефедрон", "word"), true);
  assert.equal(containsModerationPattern("героический поступок", "героин", "word"), false);
});

test("администратор может обновить базовый пакет РФ", () => {
  assert.match(serverSource, /"\/api\/admin\/moderation\/defaults"/);
  assert.match(serverSource, /seedDefaultModerationRules/);
  assert.match(clientSource, /syncDefaultModerationRules/);
  assert.match(clientSource, /Обновить базовый пакет РФ/);
});

test("ручные правила получают категорию и действие", () => {
  assert.match(serverSource, /requestedCategory/);
  assert.match(serverSource, /requestedAction/);
  assert.match(clientSource, /moderationRuleCategory/);
  assert.match(clientSource, /moderationRuleAction/);
});
