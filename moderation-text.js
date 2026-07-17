const MODERATION_CONFUSABLES = Object.freeze({
  a: "а", c: "с", e: "е", h: "н", k: "к", m: "м", o: "о",
  p: "р", t: "т", x: "х", y: "у", b: "в",
  "0": "о", "3": "з", "4": "ч", "6": "б"
});

export function normalizeModerationText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function moderationSkeleton(value) {
  return normalizeModerationText(value)
    .split("")
    .map(char => MODERATION_CONFUSABLES[char] || char)
    .join("");
}

export function compactModerationText(value) {
  return moderationSkeleton(value).replace(/[^\p{L}\p{N}]+/gu, "");
}

export function collapseModerationRepeats(value) {
  return String(value).replace(/([\p{L}\p{N}])\1+/gu, "$1");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function containsModerationPattern(text, pattern, matchType) {
  const normalizedText = normalizeModerationText(text);
  const normalizedPattern = normalizeModerationText(pattern);
  if (!normalizedText || !normalizedPattern) return false;

  const skeletonText = moderationSkeleton(normalizedText);
  const skeletonPattern = moderationSkeleton(normalizedPattern);
  const compactText = compactModerationText(normalizedText);
  const compactPattern = compactModerationText(normalizedPattern);
  const dedupedCompactText = collapseModerationRepeats(compactText);
  const dedupedCompactPattern = collapseModerationRepeats(compactPattern);

  if (matchType === "phrase" || matchType === "domain") {
    return normalizedText.includes(normalizedPattern)
      || skeletonText.includes(skeletonPattern)
      || (compactPattern.length >= 5 && (
        compactText.includes(compactPattern)
        || dedupedCompactText.includes(dedupedCompactPattern)
      ));
  }

  const expression = new RegExp(
    `(^|[^\\p{L}\\p{N}])${escapeRegExp(normalizedPattern)}(?=$|[^\\p{L}\\p{N}])`,
    "iu"
  );
  const skeletonExpression = new RegExp(
    `(^|[^\\p{L}\\p{N}])${escapeRegExp(skeletonPattern)}(?=$|[^\\p{L}\\p{N}])`,
    "iu"
  );

  return expression.test(normalizedText)
    || skeletonExpression.test(skeletonText)
    || (compactPattern.length >= 5 && (
      compactText.includes(compactPattern)
      || dedupedCompactText.includes(dedupedCompactPattern)
    ));
}
