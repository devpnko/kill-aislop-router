import { fileURLToPath } from "node:url";
import { RouterError } from "./router.mjs";
import { canonicalDigest, readJsonPinned } from "./integrity.mjs";
import { canonicalIdentityKey, isReservedParentIdentityAlias } from "./parent-identity.mjs";

// This is a bounded, independent comparison protocol, not a license checker,
// beauty detector, clone permission, human-authorship assertion or Owner vote.
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const SEMANTIC_ID = /^[a-z][a-z0-9-]*$/;
const BINDINGS = ["project_id", "screen_id", "comparison_id", "candidate_id",
  "primary_reference_id", "pack_digest", "producer_state_digest", "task_frame_digest", "cohort_digest"];
const DENIALS = ["creator_access", "browser_access", "redistribution", "network_external",
  "source_duplication", "human_authorship", "owner_approval_granted"];
const SLOT_FIELDS = ["slot_id", "relationship_id", "capture_digest", "viewport", "state", "locale"];
const UNKNOWN_CSS = "source-css-viewport-unknown";
const UNKNOWN_DPR = "source-device-pixel-ratio-unknown";

function need(value, message) {
  if (!value) throw new RouterError(`source craft: ${message}`, 4);
}
function shape(value, keys, label) {
  need(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  need(Object.keys(value).every((key) => keys.includes(key)), `${label} has unsupported fields`);
  need(keys.every((key) => Object.hasOwn(value, key)), `${label} is missing required fields`);
}
function text(value, label) {
  need(typeof value === "string" && value.trim().length > 0, `${label} is required`);
}
function digest(value, label) {
  need(typeof value === "string" && DIGEST.test(value), `${label} is invalid`);
}
function strings(value, label, min = 0) {
  need(Array.isArray(value) && value.length >= min, `${label} is incomplete`);
  value.forEach((item) => text(item, label));
  need(new Set(value).size === value.length, `${label} has duplicates`);
}
function same(actual, expected, label) {
  strings(actual, label);
  need(actual.length === expected.length && actual.every((item) => expected.includes(item)),
    `${label} must cover the exact bound set`);
}
function semantic(value, label) {
  need(typeof value === "string" && SEMANTIC_ID.test(value), `${label} must be a stable semantic ID`);
}
function deny(value, fields, label) {
  for (const key of fields) need(value[key] === false, `${label} cannot grant ${key}`);
}

function authorityShape(authority) {
  shape(authority, ["source_craft_authority_version", "purpose", "status", "issuer_id",
    "reviewer_provider_id", "reviewer_actor_id", ...BINDINGS, "capture_digests", "rights_basis",
    ...DENIALS, "comparison_slots", "target_invention_relationship_ids"], "authority");
  need(authority.source_craft_authority_version === 1 &&
    authority.purpose === "source-target-component-craft" && authority.status === "authorized",
  "authority must explicitly authorize source-target-component-craft v1");
  for (const key of ["issuer_id", "reviewer_provider_id", "reviewer_actor_id", ...BINDINGS]) {
    if (key.endsWith("_digest")) digest(authority[key], `authority ${key}`);
    else text(authority[key], `authority ${key}`);
  }
  deny(authority, DENIALS, "authority");
  shape(authority.rights_basis, ["assertion", "evidence"], "rights basis");
  text(authority.rights_basis.assertion, "rights basis assertion");
  shape(authority.rights_basis.evidence, ["path", "digest"], "rights basis evidence");
  text(authority.rights_basis.evidence.path, "rights basis evidence path");
  digest(authority.rights_basis.evidence.digest, "rights basis evidence digest");
  strings(authority.capture_digests, "authorized capture digests", 1);
  authority.capture_digests.forEach((value) => digest(value, "authorized capture digest"));
  need(Array.isArray(authority.comparison_slots) && authority.comparison_slots.length > 0,
    "comparison slots are required");
  strings(authority.comparison_slots.map((item) => item?.slot_id), "comparison slot IDs", 1);
  for (const slot of authority.comparison_slots) {
    shape(slot, SLOT_FIELDS, "comparison slot");
    for (const key of ["slot_id", "relationship_id"]) semantic(slot[key], `comparison ${key}`);
    for (const key of ["viewport", "state", "locale"]) text(slot[key], `comparison ${key}`);
    digest(slot.capture_digest, "comparison capture digest");
  }
  const observations = authority.comparison_slots.map((slot) => canonicalDigest(
    [slot.relationship_id, slot.capture_digest, slot.viewport, slot.state, slot.locale]));
  need(new Set(observations).size === observations.length, "comparison slots repeat the same observation");
  same(authority.capture_digests, [...new Set(authority.comparison_slots.map((slot) => slot.capture_digest))],
    "authorized captures and comparison slots");
  strings(authority.target_invention_relationship_ids, "target invention relationships");
  authority.target_invention_relationship_ids.forEach((value) => semantic(value, "target invention relationship"));
  return authority;
}

function independence(authority, context) {
  const participants = context.participants;
  need(participants && typeof participants === "object" && !Array.isArray(participants),
    "trusted participant identities are required");
  const identities = [];
  for (const key of ["creator_ids", "browser_ids", "critic_ids", "source_producer_ids"]) {
    strings(participants[key], `trusted participant ${key}`, 1);
    identities.push(...participants[key]);
  }
  if (participants.other_excluded_ids !== undefined) {
    strings(participants.other_excluded_ids, "other excluded participant identities");
    identities.push(...participants.other_excluded_ids);
  }
  const excluded = new Set(identities.map(canonicalIdentityKey));
  for (const key of ["issuer_id", "reviewer_provider_id", "reviewer_actor_id"]) {
    need(!isReservedParentIdentityAlias(authority[key]), `${key} cannot impersonate the parent`);
    need(!excluded.has(canonicalIdentityKey(authority[key])),
      `${key} must be independent of creators, browsers, target critics and source producers`);
  }
  const issuer = canonicalIdentityKey(authority.issuer_id);
  if (participants.issuer_excluded_ids !== undefined) {
    strings(participants.issuer_excluded_ids, "issuer excluded participant identities");
    need(!participants.issuer_excluded_ids.map(canonicalIdentityKey).includes(issuer),
      "authority issuer cannot be a reviewer for another candidate in this cohort");
  }
  need(issuer !== canonicalIdentityKey(authority.reviewer_provider_id) &&
    issuer !== canonicalIdentityKey(authority.reviewer_actor_id),
  "authority issuer cannot be the source reviewer");
  for (const key of ["reviewer_provider_id", "reviewer_actor_id"]) {
    text(context[key], `trusted ${key}`);
    need(authority[key] === context[key], `${key} does not match the bound reviewer`);
  }
}

/**
 * Pure validation. context is trusted integration input, not reviewer claims:
 * - exact project_id/screen_id/comparison_id/candidate_id/primary_reference_id,
 *   pack_digest/producer_state_digest/task_frame_digest/cohort_digest and
 *   reviewer_provider_id/reviewer_actor_id. task_frame_digest includes the pinned
 *   baseline and task frame; cohort_digest binds normalized, sorted absolute
 *   planned_state_paths (membership and count), computed by the integration;
 * - participants: creator_ids/browser_ids/critic_ids/source_producer_ids (each
 *   nonempty; provider AND actor identities), optional other_excluded_ids and
 *   issuer_excluded_ids (cohort-wide source reviewers; only excludes the issuer);
 * - relationships: [{relationship_id, binding:{kind:"recipe"|"target-invention"}}];
 * - required_viewports, required_states, required_locales: planned target sets;
 * - captures: [{digest,pixel_width,pixel_height,css_viewport?,device_pixel_ratio?}].
 *   Intrinsic PNG dimensions are decoded from pinned bytes by the caller. CSS
 *   viewport/DPR, when present, require independent verified metadata; dimensions
 *   never infer either value. No arbitrary minimum image size proves adequacy.
 *
 * The caller pins/revalidates the authority and externally stored rights evidence
 * before invoking this function and before dispatch/replay. The assertion/digest
 * records a rights claim; structural validation does NOT establish a legal license.
 */
export function validateSourceCraftAuthority(authority, context) {
  authorityShape(authority);
  need(context && typeof context === "object", "trusted authority context is required");
  for (const key of BINDINGS) {
    need(context[key] === authority[key], `authority ${key} binding mismatch`);
  }
  independence(authority, context);
  need(Array.isArray(context.relationships) && context.relationships.length > 0,
    "trusted target relationships are required");
  strings(context.relationships.map((item) => item?.relationship_id), "trusted target relationship IDs", 1);
  for (const relation of context.relationships) {
    semantic(relation.relationship_id, "trusted target relationship");
    need(["recipe", "target-invention"].includes(relation.binding?.kind),
      "target relationship needs an explicit recipe or invention classification");
  }
  const recipes = context.relationships.filter((item) => item.binding.kind === "recipe")
    .map((item) => item.relationship_id);
  const inventions = context.relationships.filter((item) => item.binding.kind === "target-invention")
    .map((item) => item.relationship_id);
  same([...new Set(authority.comparison_slots.map((slot) => slot.relationship_id))], recipes,
    "source-compared recipe relationships");
  same(authority.target_invention_relationship_ids, inventions, "target invention relationships");
  for (const [dimension, field] of [["viewport", "required_viewports"], ["state", "required_states"], ["locale", "required_locales"]]) {
    strings(context[field], `trusted ${field}`, 1);
    need(authority.comparison_slots.every((slot) => context[field].includes(slot[dimension])),
      `comparison slot ${dimension} is outside the planned target contract`);
  }
  need(Array.isArray(context.captures) && context.captures.length > 0,
    "trusted source capture metadata is required");
  strings(context.captures.map((item) => item?.digest), "trusted source capture digests", 1);
  for (const captureDigest of authority.capture_digests) {
    const capture = context.captures.find((item) => item.digest === captureDigest);
    need(capture, "authorized source capture is not bound to this reference/producer");
    need(Number.isSafeInteger(capture.pixel_width) && capture.pixel_width > 0 &&
      Number.isSafeInteger(capture.pixel_height) && capture.pixel_height > 0,
    "source capture requires actual intrinsic PNG pixel dimensions");
    if (capture.css_viewport != null) {
      shape(capture.css_viewport, ["width", "height"], "verified source CSS viewport");
      need(Number.isSafeInteger(capture.css_viewport.width) && capture.css_viewport.width > 0 &&
        Number.isSafeInteger(capture.css_viewport.height) && capture.css_viewport.height > 0,
      "verified source CSS viewport is invalid");
    }
    if (capture.device_pixel_ratio != null) {
      need(Number.isFinite(capture.device_pixel_ratio) && capture.device_pixel_ratio > 0,
        "verified source device pixel ratio is invalid");
    }
  }
  return authority;
}

/** Reviewer-only projection. No issuer/rights evidence paths or prose are copied. */
export function sourceCraftPacketContract(authority) {
  authorityShape(authority);
  const obligations = Object.fromEntries([...BINDINGS, "capture_digests", "comparison_slots",
    "target_invention_relationship_ids"].map((key) => [key, structuredClone(authority[key])]));
  return {
    authority_contract_digest: canonicalDigest(authority),
    obligations,
    review_field: "source_craft_review",
    review_contract: readJsonPinned(fileURLToPath(new URL("../schemas/source-craft-review.schema.json", import.meta.url)),
      { label: "source craft review schema" }).input,
    comparison_scope: "authorized-source-captures-versus-actual-target-renders",
    private_reviewer_only: true,
    ...Object.fromEntries(DENIALS.map((key) => [key, false])),
    rule: "Privately compare only the authorized source captures and exact planned relationship slots with actual target screenshots. Judge coupled component craft, not browser PASS, a beauty score or source duplication. Disclose intrinsic PNG size and assess crop/comparability limitations from the provided evidence. Never infer CSS viewport or DPR from pixel dimensions. When verified metadata is absent, include source-css-viewport-unknown and source-device-pixel-ratio-unknown in each affected slot's limitations. Insufficient evidence remains unassessed and cannot support a pass. Explain adaptations without freezing unapproved source treatment. Target inventions have no source parity claim. Rights assertions are bounded claims, not verified legal licenses. Free-text observations remain private to this independent reviewer; parent summaries must use typed verdicts only. This review grants no creator/browser source access, redistribution, external network access, cloning, human authorship or Owner approval."
  };
}

function adequacy(value, label) {
  need(["adequate", "insufficient"].includes(value.adequacy), `${label} adequacy is invalid`);
  text(value.rationale, `${label} rationale`);
  strings(value.limitations, `${label} limitations`, value.adequacy === "insufficient" ? 1 : 0);
}

/**
 * Pure review validator. In addition to authority context, caller supplies raw
 * pinned authority_digest, candidate_result_digest, browser_result_digest and
 * screenshots:[{digest,viewport,state,locale}] from accepted, successful official
 * browser executions. A screenshot filename or reviewer-provided locale is not
 * execution evidence. Boolean return is scoped craft support, never approval.
 * Raw review prose must not be forwarded to creators, browsers or public/parent
 * summaries; callers project only typed IDs, digests, adequacy and verdicts.
 */
export function validateSourceCraftReview(review, authority, context) {
  validateSourceCraftAuthority(authority, context);
  shape(review, ["source_craft_review_version", "authority_digest", "candidate_result_digest",
    "browser_result_digest", "reviewer_provider_id", "reviewer_actor_id", "adequacy", "rationale",
    "limitations", "slots", "target_invention_relationship_ids", "source_duplication",
    "human_authorship", "owner_approval_granted"], "review");
  need(review.source_craft_review_version === 1, "review version must be 1");
  for (const key of ["authority_digest", "candidate_result_digest", "browser_result_digest"]) {
    digest(context[key], `trusted ${key}`);
    need(review[key] === context[key], `review ${key} binding mismatch`);
  }
  for (const key of ["reviewer_provider_id", "reviewer_actor_id"]) {
    need(review[key] === authority[key], `review ${key} binding mismatch`);
  }
  deny(review, ["source_duplication", "human_authorship", "owner_approval_granted"], "review");
  adequacy(review, "review");
  same(review.target_invention_relationship_ids, authority.target_invention_relationship_ids,
    "review target invention relationships");
  need(Array.isArray(review.slots), "review slots are required");
  same(review.slots.map((item) => item?.slot_id), authority.comparison_slots.map((item) => item.slot_id),
    "review comparison slots");
  need(Array.isArray(context.screenshots) && context.screenshots.length > 0,
    "verified executed browser screenshots are required");
  for (const shot of context.screenshots) {
    digest(shot?.digest, "executed screenshot digest");
    for (const key of ["viewport", "state", "locale"]) text(shot[key], `executed screenshot ${key}`);
  }
  let supported = review.adequacy === "adequate";
  for (const slot of review.slots) {
    shape(slot, ["slot_id", "relationship_id", "source_capture_digest", "target_screenshot_digest",
      "viewport", "state", "locale", "adequacy", "limitations", "verdict", "rationale",
      "adaptation_justification"], "review slot");
    const planned = authority.comparison_slots.find((item) => item.slot_id === slot.slot_id);
    for (const key of ["relationship_id", "viewport", "state", "locale"]) {
      need(slot[key] === planned[key], `review slot ${key} binding mismatch`);
    }
    need(slot.source_capture_digest === planned.capture_digest, "review source capture digest binding mismatch");
    need(context.screenshots.some((shot) => shot.digest === slot.target_screenshot_digest &&
      shot.viewport === slot.viewport && shot.state === slot.state && shot.locale === slot.locale),
    "review target screenshot is not bound to the actual executed candidate/browser/locale");
    adequacy(slot, "review slot");
    need(["retained", "adapted", "lost", "unassessed"].includes(slot.verdict), "review slot verdict is invalid");
    need((slot.adequacy === "insufficient") === (slot.verdict === "unassessed"),
      "insufficient evidence must remain unassessed, never a craft pass or loss");
    need(review.adequacy !== "adequate" || slot.adequacy === "adequate",
      "adequate overall review cannot conceal an insufficient slot");
    if (slot.verdict === "adapted") text(slot.adaptation_justification, "adaptation justification");
    else need(slot.adaptation_justification === null, "non-adapted slot must not invent adaptation authority");
    const capture = context.captures.find((item) => item.digest === planned.capture_digest);
    if (capture.css_viewport == null) need(slot.limitations.includes(UNKNOWN_CSS),
      "source CSS viewport is unknown and must be disclosed; PNG size cannot infer it");
    if (capture.device_pixel_ratio == null) need(slot.limitations.includes(UNKNOWN_DPR),
      "source device pixel ratio is unknown and must be disclosed; PNG size cannot infer it");
    supported = supported && slot.adequacy === "adequate" && ["retained", "adapted"].includes(slot.verdict);
  }
  return supported;
}
