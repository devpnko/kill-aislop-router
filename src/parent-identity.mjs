export const KILLSLOPROUTER_ORCHESTRATOR_ID = "kill-slop-router";
export const KILLSLOPROUTER_DISPLAY_NAME = "KillSlopRouter";
export const KILLSLOPROUTER_CANONICAL_ENTRYPOINT = "killsloprouter:kill-slop-router";

export const KILLSLOPROUTER_IDENTITY_ALIASES = Object.freeze([
  KILLSLOPROUTER_ORCHESTRATOR_ID,
  KILLSLOPROUTER_DISPLAY_NAME,
  "killsloprouter",
  KILLSLOPROUTER_CANONICAL_ENTRYPOINT,
  "킬슬롭라우터",
  "킬 슬롭 라우터"
]);

export function canonicalIdentityKey(value) {
  return typeof value === "string"
    ? value.normalize("NFKC").trim().toLowerCase()
    : "";
}

function canonicalParentAliasKey(value) {
  return canonicalIdentityKey(value).replace(/[\s_-]+/gu, "-");
}

export function identitiesCanonicallyEqual(left, right) {
  const leftKey = canonicalIdentityKey(left);
  const rightKey = canonicalIdentityKey(right);
  return Boolean(leftKey && rightKey && leftKey === rightKey);
}

export function canonicalIdentitySet(values) {
  return new Set((values || []).map(canonicalIdentityKey).filter(Boolean));
}

export function isReservedParentIdentityAlias(value, {
  orchestratorId = KILLSLOPROUTER_ORCHESTRATOR_ID
} = {}) {
  const normalized = canonicalParentAliasKey(value);
  if (!normalized) return false;
  const aliases = new Set(KILLSLOPROUTER_IDENTITY_ALIASES.map(canonicalParentAliasKey));
  if (typeof orchestratorId === "string" && orchestratorId.trim()) {
    aliases.add(canonicalParentAliasKey(orchestratorId));
  }
  return aliases.has(normalized);
}

const INVOCATION_LEADING_BOUNDARY = String.raw`(?:^|[\s([{<"'“‘$])`;
const INVOCATION_TRAILING_BOUNDARY = String.raw`(?=$|[\s)\]}>.,!?;:"'”’])`;
const KOREAN_PARTICLE = String.raw`(?:으로|로|을|를|이|가|은|는|와|과|에서|에게|부터|까지|만|도|의)?`;
const PARENT_INVOCATION_PATTERN = new RegExp(
  `${INVOCATION_LEADING_BOUNDARY}(?:` +
    String.raw`killsloprouter:kill[\s_-]+slop[\s_-]+router|` +
    String.raw`kill[\s_-]+slop[\s_-]+router|` +
    String.raw`killsloprouter|` +
    String.raw`킬(?:[\s_-]+)?슬롭(?:[\s_-]+)?라우터` +
  `)${KOREAN_PARTICLE}${INVOCATION_TRAILING_BOUNDARY}`,
  "iu"
);

export function containsReservedParentInvocation(utterance) {
  if (typeof utterance !== "string") return false;
  return PARENT_INVOCATION_PATTERN.test(utterance.normalize("NFKC"));
}
