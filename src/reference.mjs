import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import {
  executeAuditPacket,
  inspectPacketAdapter,
  loadHostManifest
} from "./execution.mjs";
import {
  canonicalDigest,
  hashArtifact,
  publicSnapshot,
  readFilePinned,
  readJsonPinned,
  verifySnapshot,
  writeJsonAtomic
} from "./integrity.mjs";
import {
  assertInternalIdentityIsNotOrchestrator,
  canonicalIdentityKey,
  canonicalIdentitySet,
  createJourneyIdentity,
  createParticipant,
  identitiesMatch,
  verifyJourneyIdentity,
  verifyPacketJourney
} from "./identity.mjs";
import { RouterError, VALID_SURFACES } from "./router.mjs";
import { ensureSecureDirectory } from "./path-security.mjs";
import {
  acquireStateLease,
  claimStaleStateLease,
  commitStateLeaseWrite,
  completeStateLeaseRecovery,
  inspectStateLease,
  markStateLeaseChildExecution,
  prepareStateLeaseWrite,
  releaseStateLease
} from "./state-lease.mjs";

export const REFERENCE_RESULT_KINDS = new Set([
  "reference-discovery",
  "reference-grammar",
  "reference-review"
]);

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const RFC3339_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const FIT_BANDS = ["exact", "adjacent", "weak"];
const FIT_BAND_WEIGHT = { exact: 3, adjacent: 2, weak: 1 };
const FIT_DIMENSIONS = ["user", "task", "screen", "trust", "density", "locale"];
const SCREEN_ROLES = new Set([
  "operational", "transactional", "navigational", "state", "promotional"
]);
const EVIDENCE_STRENGTHS = new Set(["weak", "medium", "strong"]);
const SAMPLING_COHORTS = new Set([
  "task-fit", "cross-domain", "competent-baseline", "high-bookmark", "high-reach"
]);
const REQUIRED_SAMPLING_COHORTS = new Set([
  "task-fit", "cross-domain", "competent-baseline"
]);
const GRAMMAR_DIMENSIONS = new Set([
  "information-hierarchy", "navigation", "component-composition", "data-comparison",
  "evidence-presentation", "typography", "color-roles", "density", "interaction", "responsive"
]);
const OPERATIONAL_GRAMMAR_DIMENSIONS = new Set([
  "information-hierarchy", "navigation", "component-composition", "data-comparison",
  "evidence-presentation", "interaction", "responsive"
]);
export const REFERENCE_DESIGN_CHECKS = Object.freeze([
  "decision-inventory", "state-cardinality", "accent-role-budget",
  "comparison-slot-alignment", "risk-near-action", "density-by-cadence",
  "live-data-scaffolding", "state-completeness", "responsive-reprioritization",
  "promotional-citation-firewall", "source-composition-independence"
]);
const DESIGN_REVIEW_STAGES = new Set(["direction-review", "color-review"]);
const SOURCE_STYLE_LITERAL_PATTERN =
  /#[0-9a-f]{3,8}\b|\b\d+(?:\.\d+)?(?:px|rem|em)\b|\b(?:clone|pixel[- ]?copy)\b/i;
const SOURCE_PIXEL_MATERIAL_PATTERN =
  /data:image|<svg\b|iVBORw0KGgo|\/9j\/4AAQ|R0lGOD|UklGR|[A-Za-z0-9+/]{256,}={0,2}|(?:^|[/?._-])base64(?:$|[/?._-])|blob:|\.(?:png|jpe?g|gif|webp|avif|bmp|tiff?|svg)(?:\b|\?)/i;
export const HUMAN_DESIGN_REASONING_REGISTRY_PATH = fileURLToPath(new URL(
  "../registry/human-design-reasoning.json",
  import.meta.url
));
const DISCOVERY_CAPABILITIES = [
  "reference-discovery", "source-provenance", "rights-aware-research", "popularity-evidence"
];
const GRAMMAR_CAPABILITIES = [
  "reference-grammar-extraction", "information-hierarchy-analysis",
  "component-pattern-analysis", "product-fit-analysis"
];
const REVIEW_CAPABILITIES = [
  "reference-evidence-review", "anti-copy-review", "product-fit-review",
  "popularity-ranking-review"
];

function requireValue(condition, message, exitCode = 2) {
  if (!condition) throw new RouterError(message, exitCode);
}

function object(value, label) {
  requireValue(value && typeof value === "object" && !Array.isArray(value),
    `${label} must be an object`);
  return value;
}

function exact(value, keys, label) {
  object(value, label);
  for (const key of Object.keys(value)) {
    requireValue(keys.has(key), `${label} contains unsupported field: ${key}`);
  }
}

function string(value, label) {
  requireValue(typeof value === "string" && value.trim().length > 0,
    `${label} must be a non-empty string`);
  return value;
}

function safeId(value, label) {
  string(value, label);
  requireValue(ID_PATTERN.test(value), `${label} must use letters, numbers, dot, underscore, or hyphen`);
  return value;
}

function uniqueStrings(value, label, { min = 1, allowed = null } = {}) {
  requireValue(Array.isArray(value) && value.length >= min,
    `${label} must contain at least ${min} value${min === 1 ? "" : "s"}`);
  value.forEach((item, index) => {
    string(item, `${label}[${index}]`);
    if (allowed) requireValue(allowed.has(item), `${label}[${index}] is unsupported: ${item}`);
  });
  requireValue(new Set(value).size === value.length, `${label} contains duplicates`);
  return value;
}

function sameStringSet(left, right) {
  return Array.isArray(left) && Array.isArray(right) &&
    left.length === right.length && new Set(left).size === left.length &&
    left.every((item) => right.includes(item));
}

function productFitScore(dimensions) {
  const total = FIT_DIMENSIONS.reduce((sum, dimension) => sum + dimensions[dimension], 0);
  return Math.round((total / (FIT_DIMENSIONS.length * 5)) * 100);
}

function productFitBand(score) {
  if (score >= 80) return "exact";
  if (score >= 50) return "adjacent";
  return "weak";
}

function validatePopularityNormalization(input, metric, label, exitCode = 2) {
  exact(input, new Set([
    "formula", "lower_bound", "upper_bound", "direction"
  ]), label);
  const expectedDirection = metric === "popular-rank"
    ? "lower-is-better" : "higher-is-better";
  requireValue(input.formula === "linear-bounds-v1" &&
    typeof input.lower_bound === "number" && Number.isFinite(input.lower_bound) &&
    typeof input.upper_bound === "number" && Number.isFinite(input.upper_bound) &&
    input.upper_bound > input.lower_bound && input.direction === expectedDirection,
  `${label} must use finite linear bounds and the metric direction`, exitCode);
  return input;
}

function popularityPolicyMatches(value, policy) {
  return value.id === policy.id && value.metric === policy.metric &&
    value.subject_kind === policy.subject_kind && value.scope === policy.scope &&
    value.category === policy.category &&
    canonicalDigest(value.normalization) === canonicalDigest(policy.normalization);
}

function normalizedPopularityScore(signal) {
  const { lower_bound: lower, upper_bound: upper, direction } = signal.normalization;
  const bounded = Math.min(upper, Math.max(lower, signal.raw_value));
  const ratio = (bounded - lower) / (upper - lower);
  const score = direction === "higher-is-better" ? ratio : 1 - ratio;
  return Number((score * 100).toFixed(6));
}

function weightedPopularityScore(signals, policySignals) {
  const weights = new Map(policySignals.map((item) => [item.id, item]));
  let numerator = 0;
  let denominator = 0;
  for (const signal of signals) {
    const configured = weights.get(signal.id);
    if (!configured || !popularityPolicyMatches(signal, configured)) return null;
    numerator += normalizedPopularityScore(signal) * configured.weight;
    denominator += configured.weight;
  }
  if (signals.length !== policySignals.length || denominator <= 0) return null;
  return Number((numerator / denominator).toFixed(6));
}

function timestamp(value, label) {
  string(value, label);
  requireValue(RFC3339_PATTERN.test(value) && !Number.isNaN(Date.parse(value)),
    `${label} must be an RFC 3339 date-time`);
  return value;
}

function digest(value, label) {
  requireValue(DIGEST_PATTERN.test(value || ""), `${label} must be a sha256 digest`);
  return value;
}

function stateBody(state) {
  const { state_digest: _digest, ...body } = state;
  return body;
}

function packetBody(packet) {
  const { packet_digest: _digest, ...body } = packet;
  return body;
}

function sealState(state) {
  state.state_digest = canonicalDigest(stateBody(state));
  return state;
}

function nowIso() {
  return new Date().toISOString();
}

function stateDirectory(statePath) {
  const absolute = path.resolve(statePath);
  const extension = path.extname(absolute);
  return `${extension ? absolute.slice(0, -extension.length) : absolute}.reference`;
}

function inside(candidate, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative));
}

function readPinnedJson(target, label) {
  try {
    return readJsonPinned(path.resolve(target), { label });
  } catch (error) {
    throw new RouterError(error.message, 4);
  }
}

function pinnedSnapshot(pinned, root) {
  const absoluteRoot = path.resolve(root || process.cwd());
  const relative = path.relative(absoluteRoot, pinned.path);
  return {
    path: relative && !relative.startsWith("..") && !path.isAbsolute(relative)
      ? relative.split(path.sep).join("/")
      : (!relative ? "." : pinned.path),
    resolved_path: pinned.path,
    kind: "file",
    bytes: pinned.bytes,
    digest: pinned.digest,
    physical_identity_digest: pinned.physical_identity_digest
  };
}

function writePinnedJson(target, value, label, root) {
  writeJsonAtomic(target, value, { label });
  const pinned = readPinnedJson(target, label);
  requireValue(canonicalDigest(pinned.input) === canonicalDigest(value),
    `${label} changed between write and provenance binding`, 4);
  return pinnedSnapshot(pinned, root);
}

function verifyBoundSnapshot(snapshot, label) {
  const result = verifySnapshot(snapshot);
  requireValue(result.ok, `${label} changed after it was digest-bound (${result.reason})`, 4);
}

function resolveEvidence(root, declaration, label, { json = false } = {}) {
  exact(declaration, new Set(["id", "kind", "path", "digest"]), label);
  string(declaration.path, `${label}.path`);
  digest(declaration.digest, `${label}.digest`);
  const absolute = path.resolve(root, declaration.path);
  let pinned;
  try {
    pinned = json
      ? readJsonPinned(absolute, { label })
      : readFilePinned(absolute, { label });
  } catch (error) {
    throw new RouterError(error.message, 4);
  }
  requireValue(pinned.digest === declaration.digest,
    `${label} digest mismatch: ${declaration.path}`, 4);
  return {
    snapshot: pinnedSnapshot(pinned, root),
    input: json ? pinned.input : null
  };
}

function validateProductFrame(frame) {
  exact(frame, new Set([
    "primary_user", "user_job", "screen_family", "main_object", "core_task",
    "trust_risk", "density", "required_states", "success_metric"
  ]), "reference brief planning.product_frame");
  for (const field of [
    "primary_user", "user_job", "screen_family", "main_object", "core_task", "success_metric"
  ]) string(frame[field], `reference brief planning.product_frame.${field}`);
  requireValue(["low", "standard", "high"].includes(frame.trust_risk),
    "reference brief planning.product_frame.trust_risk is invalid");
  requireValue(["sparse", "balanced", "compact", "dense"].includes(frame.density),
    "reference brief planning.product_frame.density is invalid");
  uniqueStrings(frame.required_states, "reference brief planning.product_frame.required_states");
}

export function validateHumanDesignReasoningRegistry(input) {
  exact(input, new Set([
    "human_design_reasoning_registry_version", "authority_scope",
    "source_pixels_included", "research_basis", "design_checks", "lenses"
  ]), "human-design reasoning registry");
  requireValue(input.human_design_reasoning_registry_version === 1,
    "human-design reasoning registry version must be 1");
  requireValue(input.authority_scope === "non-authoritative-research-aid",
    "human-design reasoning registry cannot grant design authority");
  requireValue(input.source_pixels_included === false,
    "human-design reasoning registry must not include source pixels");
  exact(input.research_basis, new Set([
    "source_provider", "source_url", "sampled_at", "sample_size",
    "selection_method", "caveats"
  ]), "human-design reasoning registry research_basis");
  requireValue(input.research_basis.source_provider === "uibowl",
    "human-design reasoning registry source must be uibowl");
  validateSourceUri(input.research_basis.source_url);
  timestamp(input.research_basis.sampled_at,
    "human-design reasoning registry research_basis.sampled_at");
  exact(input.research_basis.sample_size, new Set([
    "products", "screens", "mobile_products", "desktop_products"
  ]), "human-design reasoning registry sample_size");
  for (const field of ["products", "screens", "mobile_products", "desktop_products"]) {
    requireValue(Number.isInteger(input.research_basis.sample_size[field]) &&
      input.research_basis.sample_size[field] >= 0,
    `human-design reasoning registry sample_size.${field} must be a non-negative integer`);
  }
  requireValue(input.research_basis.sample_size.products > 0 &&
    input.research_basis.sample_size.screens >= input.research_basis.sample_size.products &&
    input.research_basis.sample_size.mobile_products +
      input.research_basis.sample_size.desktop_products === input.research_basis.sample_size.products,
  "human-design reasoning registry sample size is inconsistent");
  string(input.research_basis.selection_method,
    "human-design reasoning registry selection_method");
  uniqueStrings(input.research_basis.caveats,
    "human-design reasoning registry caveats");
  requireValue(Array.isArray(input.lenses) && input.lenses.length >= 8,
    "human-design reasoning registry requires at least eight lenses");
  const ids = new Set();
  for (const [index, lens] of input.lenses.entries()) {
    exact(lens, new Set([
      "lens_id", "question", "decision_test", "failure_if_ignored",
      "applies_to", "tradeoff", "anti_copy_boundary"
    ]), `human-design reasoning registry lenses[${index}]`);
    safeId(lens.lens_id, `human-design reasoning registry lenses[${index}].lens_id`);
    requireValue(!ids.has(lens.lens_id),
      `duplicate human-design reasoning lens: ${lens.lens_id}`);
    ids.add(lens.lens_id);
    for (const field of [
      "question", "decision_test", "failure_if_ignored", "tradeoff", "anti_copy_boundary"
    ]) string(lens[field], `human-design reasoning lens ${lens.lens_id}.${field}`);
    uniqueStrings(lens.applies_to, `human-design reasoning lens ${lens.lens_id}.applies_to`);
    const language = `${lens.question} ${lens.decision_test} ${lens.failure_if_ignored} ` +
      `${lens.tradeoff} ${lens.anti_copy_boundary}`;
    requireValue(!SOURCE_STYLE_LITERAL_PATTERN.test(language) &&
      !SOURCE_PIXEL_MATERIAL_PATTERN.test(language),
      `human-design reasoning lens ${lens.lens_id} contains source-specific styling`);
  }
  requireValue(Array.isArray(input.design_checks) &&
    input.design_checks.length === REFERENCE_DESIGN_CHECKS.length,
  "human-design reasoning registry requires the fixed design-check contract");
  const checkIds = new Set();
  for (const [index, check] of input.design_checks.entries()) {
    const label = `human-design reasoning registry design_checks[${index}]`;
    exact(check, new Set([
      "check_id", "lens_ids", "pass_condition", "required_evidence", "stages", "failure_code"
    ]), label);
    safeId(check.check_id, `${label}.check_id`);
    requireValue(REFERENCE_DESIGN_CHECKS.includes(check.check_id) &&
      !checkIds.has(check.check_id), `${label}.check_id is unsupported or duplicated`);
    checkIds.add(check.check_id);
    uniqueStrings(check.lens_ids, `${label}.lens_ids`);
    requireValue(check.lens_ids.every((id) => ids.has(id)),
      `${label}.lens_ids cites an unknown reasoning lens`);
    string(check.pass_condition, `${label}.pass_condition`);
    uniqueStrings(check.required_evidence, `${label}.required_evidence`);
    uniqueStrings(check.stages, `${label}.stages`, { allowed: DESIGN_REVIEW_STAGES });
    requireValue(check.failure_code === `reference-check-failed:${check.check_id}`,
      `${label}.failure_code must be bound to check_id`);
    requireValue(!SOURCE_STYLE_LITERAL_PATTERN.test(JSON.stringify(check)) &&
      !SOURCE_PIXEL_MATERIAL_PATTERN.test(JSON.stringify(check)),
      `${label} contains source-specific styling`);
  }
  requireValue(sameStringSet([...checkIds], REFERENCE_DESIGN_CHECKS),
    "human-design reasoning registry design-check set is incomplete");
  return input;
}

export function loadHumanDesignReasoningRegistry() {
  const pinned = readPinnedJson(
    HUMAN_DESIGN_REASONING_REGISTRY_PATH,
    "human-design reasoning registry"
  );
  const registry = validateHumanDesignReasoningRegistry(pinned.input);
  return {
    registry: structuredClone(registry),
    digest: canonicalDigest(registry),
    source_digest: pinned.digest
  };
}

function reviewerSourceCaptureReadiness(input) {
  const captures = input.evidence_manifest.filter((item) => item.kind === "source-capture");
  const captureById = new Map(captures.map((item) => [item.evidence_id, item]));
  const referencesWithCapture = new Set(captures.map((item) => item.reference_id));
  const captureEvidenceIds = [...captureById.keys()].sort((left, right) =>
    left.localeCompare(right, "en"));
  const uncoveredReferenceIds = input.references
    .map((item) => item.reference_id)
    .filter((referenceId) => !referencesWithCapture.has(referenceId))
    .sort((left, right) => left.localeCompare(right, "en"));
  const uncoveredObservationIds = input.verified_observations
    .filter((observation) => !observation.evidence_ids.some((evidenceId) => {
      const capture = captureById.get(evidenceId);
      return capture?.reference_id === observation.reference_id &&
        capture.frame_ids.includes(observation.frame_id);
    }))
    .map((item) => item.observation_id)
    .sort((left, right) => left.localeCompare(right, "en"));
  return {
    status: uncoveredReferenceIds.length === 0 && uncoveredObservationIds.length === 0
      ? "ready_at_compilation"
      : "manual_pending",
    capture_evidence_ids: captureEvidenceIds,
    uncovered_reference_ids: uncoveredReferenceIds,
    uncovered_observation_ids: uncoveredObservationIds,
    revalidate_on_design_start: true
  };
}

export function validateReferencePack(input) {
  exact(input, new Set([
    "reference_pack_version", "run_id", "journey_identity", "project_id", "surface",
    "authority_scope", "planning_target_id", "product_frame_digest", "planning_frame",
    "selection", "references", "evidence_manifest", "reasoning_lenses", "verified_observations",
    "verified_hierarchy_reasoning", "verified_grammar", "ranking_policy",
    "downstream_contract", "provenance", "compiled_at", "pack_digest"
  ]), "reference intelligence pack");
  requireValue(input.reference_pack_version === 1,
    "reference intelligence pack version must be 1", 4);
  string(input.run_id, "reference intelligence pack run_id");
  verifyJourneyIdentity(input.journey_identity, {
    runId: input.run_id,
    label: "reference intelligence pack journey_identity"
  });
  safeId(input.project_id, "reference intelligence pack project_id");
  requireValue(VALID_SURFACES.has(input.surface),
    "reference intelligence pack surface is invalid", 4);
  requireValue(input.authority_scope === "discovery-evidence-only",
    "reference intelligence pack cannot grant visual authority", 4);
  safeId(input.planning_target_id, "reference intelligence pack planning_target_id");
  digest(input.product_frame_digest, "reference intelligence pack product_frame_digest");
  validateProductFrame(input.planning_frame);
  requireValue(canonicalDigest(input.planning_frame) === input.product_frame_digest,
    "reference intelligence pack product_frame_digest mismatch", 4);

  exact(input.selection, new Set([
    "owner_id", "selection_digest", "anchor_reference_id",
    "supporting_reference_ids", "rationale"
  ]), "reference intelligence pack selection");
  string(input.selection.owner_id, "reference intelligence pack selection.owner_id");
  digest(input.selection.selection_digest,
    "reference intelligence pack selection.selection_digest");
  safeId(input.selection.anchor_reference_id,
    "reference intelligence pack selection.anchor_reference_id");
  uniqueStrings(input.selection.supporting_reference_ids,
    "reference intelligence pack selection.supporting_reference_ids");
  requireValue(input.selection.supporting_reference_ids.length <= 4 &&
    !input.selection.supporting_reference_ids.includes(input.selection.anchor_reference_id),
  "reference intelligence pack selection must contain one anchor and 1-4 distinct supports", 4);
  string(input.selection.rationale, "reference intelligence pack selection.rationale");

  requireValue(Array.isArray(input.references) && input.references.length >= 2 &&
    input.references.length <= 5,
  "reference intelligence pack must contain the selected anchor and 1-4 supports", 4);
  const selectedIds = new Set([
    input.selection.anchor_reference_id,
    ...input.selection.supporting_reference_ids
  ]);
  requireValue(selectedIds.size === input.references.length,
    "reference intelligence pack selection/reference cardinality mismatch", 4);
  const referenceIds = new Set();
  const packSourceUris = new Set();
  const packScreenRecordIds = new Set();
  const referenceFrames = new Map();
  const referenceProductFits = new Map();
  const referencesById = new Map();
  for (const [index, reference] of input.references.entries()) {
    const label = `reference intelligence pack references[${index}]`;
    exact(reference, new Set([
      "reference_id", "role", "source", "app_name", "product_category",
      "screen_family", "platform", "environment_of_use", "business_model",
      "session_shape", "locale", "sampled_because", "family", "screen_role",
      "evidence_strength", "sampling", "component_families", "patterns", "product_fit",
      "popularity"
    ]), label);
    safeId(reference.reference_id, `${label}.reference_id`);
    requireValue(selectedIds.has(reference.reference_id) &&
      !referenceIds.has(reference.reference_id),
    `${label}.reference_id is not a unique selected reference`, 4);
    referenceIds.add(reference.reference_id);
    referencesById.set(reference.reference_id, reference);
    requireValue(reference.role ===
      (reference.reference_id === input.selection.anchor_reference_id ? "anchor" : "support"),
    `${label}.role conflicts with owner selection`, 4);
    exact(reference.source, new Set([
      "provider", "uri", "record_id", "product_record_id", "screen_record_id", "captured_at"
    ]),
      `${label}.source`);
    requireValue(reference.source.provider === "uibowl",
      `${label}.source.provider must be uibowl`, 4);
    validateSourceUri(reference.source.uri);
    string(reference.source.record_id, `${label}.source.record_id`);
    string(reference.source.product_record_id, `${label}.source.product_record_id`);
    string(reference.source.screen_record_id, `${label}.source.screen_record_id`);
    requireValue(reference.source.record_id === reference.source.screen_record_id,
      `${label}.source.record_id must equal screen_record_id`, 4);
    const normalizedUri = new URL(reference.source.uri).href;
    const normalizedScreenRecord = reference.source.screen_record_id.trim().toLocaleLowerCase("en");
    requireValue(!packSourceUris.has(normalizedUri) &&
      !packScreenRecordIds.has(normalizedScreenRecord),
    `${label} repackages a duplicate UI Bowl screen`, 4);
    packSourceUris.add(normalizedUri);
    packScreenRecordIds.add(normalizedScreenRecord);
    timestamp(reference.source.captured_at, `${label}.source.captured_at`);
    for (const field of [
      "app_name", "product_category", "screen_family", "environment_of_use",
      "business_model", "locale", "sampled_because"
    ]) string(reference[field], `${label}.${field}`);
    requireValue(["mobile", "desktop", "responsive"].includes(reference.platform),
      `${label}.platform is invalid`, 4);
    requireValue([
      "one-shot", "repeated", "interrupted", "multi-session", "exploratory"
    ].includes(reference.session_shape), `${label}.session_shape is invalid`, 4);
    exact(reference.family, new Set([
      "family_id", "frame_count", "core_task_frame_count", "state_frame_count",
      "promotional_frame_count", "frames"
    ]), `${label}.family`);
    safeId(reference.family.family_id, `${label}.family.family_id`);
    for (const field of [
      "frame_count", "core_task_frame_count", "state_frame_count", "promotional_frame_count"
    ]) {
      requireValue(Number.isInteger(reference.family[field]) && reference.family[field] >= 0,
        `${label}.family.${field} must be a non-negative integer`, 4);
    }
    requireValue(reference.family.frame_count >= 1 &&
      reference.family.core_task_frame_count <= reference.family.frame_count &&
      reference.family.state_frame_count <= reference.family.frame_count &&
      reference.family.promotional_frame_count <= reference.family.frame_count,
    `${label}.family frame counts are inconsistent`, 4);
    requireValue(Array.isArray(reference.family.frames) &&
      reference.family.frames.length === reference.family.frame_count,
    `${label}.family frame manifest is incomplete`, 4);
    const packFrames = new Map();
    for (const frame of reference.family.frames) {
      exact(frame, new Set(["frame_id", "role", "core_task", "state"]),
        `${label}.family frame`);
      safeId(frame.frame_id, `${label}.family frame_id`);
      requireValue(!packFrames.has(frame.frame_id) && SCREEN_ROLES.has(frame.role) &&
        typeof frame.core_task === "boolean" && typeof frame.state === "boolean",
      `${label}.family frame is invalid or duplicated`, 4);
      packFrames.set(frame.frame_id, frame);
    }
    requireValue([...packFrames.values()].filter((item) => item.core_task).length ===
      reference.family.core_task_frame_count &&
      [...packFrames.values()].filter((item) => item.state).length ===
        reference.family.state_frame_count &&
      [...packFrames.values()].filter((item) => item.role === "promotional").length ===
        reference.family.promotional_frame_count,
    `${label}.family counts do not match its frame manifest`, 4);
    referenceFrames.set(reference.reference_id, packFrames);
    requireValue(SCREEN_ROLES.has(reference.screen_role),
      `${label}.screen_role is invalid`, 4);
    requireValue([...packFrames.values()].some((item) =>
      item.role === reference.screen_role),
    `${label}.screen_role is absent from its frame manifest`, 4);
    requireValue(reference.family.promotional_frame_count !== reference.family.frame_count ||
      reference.screen_role === "promotional",
    `${label} all-promotional family must declare promotional screen_role`, 4);
    requireValue(EVIDENCE_STRENGTHS.has(reference.evidence_strength),
      `${label}.evidence_strength is invalid`, 4);
    requireValue(reference.screen_role !== "promotional" ||
      reference.evidence_strength === "weak",
    `${label} promotional evidence must remain weak`, 4);
    requireValue((reference.family.frame_count >= 2 &&
      reference.family.core_task_frame_count >= 1) || reference.evidence_strength === "weak",
    `${label} single-frame or no-task evidence must remain weak`, 4);
    exact(reference.sampling, new Set(["ecosystem_id", "cohorts"]),
      `${label}.sampling`);
    safeId(reference.sampling.ecosystem_id, `${label}.sampling.ecosystem_id`);
    uniqueStrings(reference.sampling.cohorts, `${label}.sampling.cohorts`, {
      allowed: SAMPLING_COHORTS
    });
    uniqueStrings(reference.component_families, `${label}.component_families`);
    uniqueStrings(reference.patterns, `${label}.patterns`);
    exact(reference.product_fit, new Set([
      "band", "score", "dimensions", "rationale", "observed_ids"
    ]), `${label}.product_fit`);
    exact(reference.product_fit.dimensions, new Set(FIT_DIMENSIONS),
      `${label}.product_fit.dimensions`);
    for (const dimension of FIT_DIMENSIONS) {
      requireValue(Number.isInteger(reference.product_fit.dimensions[dimension]) &&
        reference.product_fit.dimensions[dimension] >= 0 &&
        reference.product_fit.dimensions[dimension] <= 5,
      `${label}.product_fit.dimensions.${dimension} must be 0-5`, 4);
    }
    requireValue(reference.product_fit.score ===
      productFitScore(reference.product_fit.dimensions) &&
      reference.product_fit.band === productFitBand(reference.product_fit.score),
    `${label}.product_fit is not router-reproducible`, 4);
    string(reference.product_fit.rationale, `${label}.product_fit.rationale`);
    uniqueStrings(reference.product_fit.observed_ids,
      `${label}.product_fit.observed_ids`);
    referenceProductFits.set(reference.reference_id, reference.product_fit);
    exact(reference.popularity, new Set([
      "status", "signals", "conflicts", "verified", "computed_score"
    ]), `${label}.popularity`);
    requireValue(["verified-snapshot", "conflicted"].includes(reference.popularity.status),
      `${label}.popularity.status is invalid`, 4);
    requireValue(typeof reference.popularity.verified === "boolean",
      `${label}.popularity.verified must be boolean`, 4);
    requireValue(Array.isArray(reference.popularity.signals) &&
      reference.popularity.signals.length > 0,
    `${label}.popularity.signals must be non-empty`, 4);
    const signalIds = new Set();
    for (const signal of reference.popularity.signals) {
      exact(signal, new Set([
        "id", "metric", "raw_value", "normalized_score", "scope", "category",
        "as_of", "subject_kind", "subject_record_id", "snapshot_at", "normalization",
        "evidence_ids"
      ]), `${label}.popularity signal`);
      safeId(signal.id, `${label}.popularity signal.id`);
      requireValue(!signalIds.has(signal.id),
        `${label}.popularity repeats signal ${signal.id}`, 4);
      signalIds.add(signal.id);
      requireValue(["mau", "bookmark-count", "popular-rank", "curation-popularity"].includes(
        signal.metric
      ), `${label}.popularity signal.metric is invalid`, 4);
      requireValue(["product", "screen"].includes(signal.subject_kind) &&
        (signal.metric !== "mau" || signal.subject_kind === "product"),
      `${label}.popularity signal.subject_kind is invalid`, 4);
      requireValue(typeof signal.raw_value === "number" && Number.isFinite(signal.raw_value) &&
        typeof signal.normalized_score === "number" &&
        signal.normalized_score >= 0 && signal.normalized_score <= 100,
      `${label}.popularity signal values are invalid`, 4);
      for (const field of ["scope", "category"]) string(signal[field],
        `${label}.popularity signal.${field}`);
      timestamp(signal.as_of, `${label}.popularity signal.as_of`);
      timestamp(signal.snapshot_at, `${label}.popularity signal.snapshot_at`);
      exact(signal.normalization, new Set([
        "formula", "lower_bound", "upper_bound", "direction"
      ]), `${label}.popularity signal.normalization`);
      requireValue(signal.normalization.formula === "linear-bounds-v1" &&
        typeof signal.normalization.lower_bound === "number" &&
        Number.isFinite(signal.normalization.lower_bound) &&
        typeof signal.normalization.upper_bound === "number" &&
        Number.isFinite(signal.normalization.upper_bound) &&
        signal.normalization.upper_bound > signal.normalization.lower_bound &&
        signal.normalization.direction === (signal.metric === "popular-rank"
          ? "lower-is-better" : "higher-is-better") &&
        signal.normalized_score === normalizedPopularityScore(signal),
      `${label}.popularity signal normalization is not router-reproducible`, 4);
      requireValue(signal.subject_record_id === (signal.subject_kind === "product"
        ? reference.source.product_record_id : reference.source.screen_record_id),
      `${label}.popularity signal subject conflicts with its source`, 4);
      uniqueStrings(signal.evidence_ids, `${label}.popularity signal.evidence_ids`);
    }
    requireValue(Array.isArray(reference.popularity.conflicts),
      `${label}.popularity.conflicts must be an array`, 4);
    for (const conflict of reference.popularity.conflicts) {
      exact(conflict, new Set([
        "signal_id", "subject_kind", "subject_record_id", "raw_value", "as_of", "note",
        "evidence_ids"
      ]), `${label}.popularity conflict`);
      requireValue(signalIds.has(conflict.signal_id),
        `${label}.popularity conflict cites an unknown signal`, 4);
      requireValue(["product", "screen"].includes(conflict.subject_kind) &&
        conflict.subject_record_id === (conflict.subject_kind === "product"
          ? reference.source.product_record_id : reference.source.screen_record_id),
      `${label}.popularity conflict subject conflicts with its source`, 4);
      requireValue(typeof conflict.raw_value === "number" && Number.isFinite(conflict.raw_value),
        `${label}.popularity conflict.raw_value is invalid`, 4);
      timestamp(conflict.as_of, `${label}.popularity conflict.as_of`);
      string(conflict.note, `${label}.popularity conflict.note`);
      uniqueStrings(conflict.evidence_ids, `${label}.popularity conflict.evidence_ids`);
    }
    if (reference.popularity.status === "conflicted") {
      requireValue(reference.popularity.conflicts.length > 0 &&
        reference.popularity.verified === false &&
        reference.popularity.computed_score === null,
      `${label} conflicted popularity must remain unverified and unscored`, 4);
    } else {
      requireValue(reference.popularity.conflicts.length === 0,
        `${label} verified-snapshot popularity cannot retain conflicts`, 4);
      requireValue(reference.popularity.verified
        ? typeof reference.popularity.computed_score === "number" &&
          Number.isFinite(reference.popularity.computed_score) &&
          reference.popularity.computed_score >= 0 &&
          reference.popularity.computed_score <= 100
        : reference.popularity.computed_score === null,
      `${label} popularity score conflicts with critic verification`, 4);
    }
  }
  requireValue(referenceIds.size === selectedIds.size &&
    [...selectedIds].every((id) => referenceIds.has(id)),
  "reference intelligence pack does not contain the exact owner selection", 4);
  const anchor = input.references.find((item) => item.role === "anchor");
  const supports = input.references.filter((item) => item.role === "support");
  requireValue(supports.some((item) =>
    item.source.product_record_id.trim().toLocaleLowerCase("en") !==
      anchor.source.product_record_id.trim().toLocaleLowerCase("en")) &&
    supports.some((item) => item.product_category.trim().toLocaleLowerCase("en") !==
      anchor.product_category.trim().toLocaleLowerCase("en")) &&
    supports.some((item) => item.sampling.ecosystem_id.trim().toLocaleLowerCase("en") !==
      anchor.sampling.ecosystem_id.trim().toLocaleLowerCase("en")),
  "reference intelligence pack support does not cross product, category, and ecosystem", 4);

  requireValue(Array.isArray(input.evidence_manifest) && input.evidence_manifest.length > 0,
    "reference intelligence pack requires a source evidence manifest", 4);
  const evidenceManifestById = new Map();
  const usedEvidenceIds = new Set();
  for (const evidence of input.evidence_manifest) {
    exact(evidence, new Set([
      "evidence_id", "kind", "digest", "reference_id", "product_record_id",
      "screen_record_id", "frame_ids", "subject_bindings"
    ]), "reference intelligence pack evidence manifest item");
    safeId(evidence.evidence_id,
      "reference intelligence pack evidence manifest evidence_id");
    safeId(evidence.reference_id,
      `reference intelligence pack evidence ${evidence.evidence_id}.reference_id`);
    requireValue(!evidenceManifestById.has(evidence.evidence_id) &&
      ["source-capture", "source-metadata"].includes(evidence.kind),
    `reference intelligence pack evidence ${evidence.evidence_id} is invalid or duplicated`, 4);
    digest(evidence.digest,
      `reference intelligence pack evidence ${evidence.evidence_id}.digest`);
    string(evidence.product_record_id,
      `reference intelligence pack evidence ${evidence.evidence_id}.product_record_id`);
    string(evidence.screen_record_id,
      `reference intelligence pack evidence ${evidence.evidence_id}.screen_record_id`);
    uniqueStrings(evidence.frame_ids,
      `reference intelligence pack evidence ${evidence.evidence_id}.frame_ids`);
    const reference = referencesById.get(evidence.reference_id);
    requireValue(reference &&
      evidence.product_record_id === reference.source.product_record_id &&
      evidence.screen_record_id === reference.source.screen_record_id &&
      evidence.frame_ids.every((frameId) =>
        referenceFrames.get(evidence.reference_id).has(frameId)),
    `reference intelligence pack evidence ${evidence.evidence_id} has an invalid source binding`, 4);
    requireValue(Array.isArray(evidence.subject_bindings) &&
      evidence.subject_bindings.length > 0,
    `reference intelligence pack evidence ${evidence.evidence_id} requires subject bindings`, 4);
    const subjectBindings = new Set();
    for (const binding of evidence.subject_bindings) {
      exact(binding, new Set(["subject_kind", "subject_record_id"]),
        `reference intelligence pack evidence ${evidence.evidence_id} subject binding`);
      requireValue(["product", "screen"].includes(binding.subject_kind) &&
        binding.subject_record_id === (binding.subject_kind === "product"
          ? evidence.product_record_id : evidence.screen_record_id),
      `reference intelligence pack evidence ${evidence.evidence_id} has an invalid subject binding`, 4);
      const bindingKey = `${binding.subject_kind}\u0000${binding.subject_record_id}`;
      requireValue(!subjectBindings.has(bindingKey),
        `reference intelligence pack evidence ${evidence.evidence_id} repeats a subject binding`, 4);
      subjectBindings.add(bindingKey);
    }
    requireValue(subjectBindings.has(`screen\u0000${evidence.screen_record_id}`),
      `reference intelligence pack evidence ${evidence.evidence_id} must bind its screen subject`, 4);
    evidenceManifestById.set(evidence.evidence_id, evidence);
  }
  for (const reference of input.references) {
    for (const item of [
      ...reference.popularity.signals,
      ...reference.popularity.conflicts
    ]) {
      requireValue(item.evidence_ids.every((id) => {
        const evidence = evidenceManifestById.get(id);
        return evidence && evidence.reference_id === reference.reference_id &&
          evidence.product_record_id === reference.source.product_record_id &&
          evidence.screen_record_id === reference.source.screen_record_id &&
          evidenceHasSubjectBinding(
            evidence, item.subject_kind, item.subject_record_id
          );
      }), `reference intelligence pack ${reference.reference_id} popularity evidence is not source-bound`, 4);
      item.evidence_ids.forEach((id) => usedEvidenceIds.add(id));
    }
  }

  requireValue(Array.isArray(input.verified_observations) &&
    input.verified_observations.length > 0,
  "reference intelligence pack requires verified text observations", 4);
  const observationIds = new Set();
  const observationReferences = new Map();
  const observationsById = new Map();
  for (const observation of input.verified_observations) {
    exact(observation, new Set([
      "observation_id", "frame_id", "frame_role", "kind", "priority", "statement",
      "evidence_ids", "reference_id"
    ]), "reference intelligence pack verified observation");
    safeId(observation.observation_id,
      "reference intelligence pack verified observation_id");
    requireValue(!observationIds.has(observation.observation_id),
      `duplicate verified observation: ${observation.observation_id}`, 4);
    observationIds.add(observation.observation_id);
    observationsById.set(observation.observation_id, observation);
    safeId(observation.reference_id,
      `verified observation ${observation.observation_id}.reference_id`);
    requireValue(referenceIds.has(observation.reference_id),
      `verified observation ${observation.observation_id} cites an unselected reference`, 4);
    observationReferences.set(observation.observation_id, observation.reference_id);
    safeId(observation.frame_id,
      `verified observation ${observation.observation_id}.frame_id`);
    requireValue(referenceFrames.get(observation.reference_id)?.has(observation.frame_id) &&
      referenceFrames.get(observation.reference_id).get(observation.frame_id).role ===
        observation.frame_role && SCREEN_ROLES.has(observation.frame_role) &&
      ["structure", "hierarchy", "component", "navigation", "type", "color", "state"].includes(
        observation.kind
      ) && ["primary", "secondary", "supporting", "ambient"].includes(observation.priority),
    `verified observation ${observation.observation_id} has invalid classification`, 4);
    string(observation.statement,
      `verified observation ${observation.observation_id}.statement`);
    uniqueStrings(observation.evidence_ids,
      `verified observation ${observation.observation_id}.evidence_ids`);
    requireValue(observation.evidence_ids.length > 0,
      `verified observation ${observation.observation_id} requires evidence digests`, 4);
    requireValue(observation.evidence_ids.every((id) => {
      const evidence = evidenceManifestById.get(id);
      return evidence && evidence.reference_id === observation.reference_id &&
        evidence.product_record_id ===
          referencesById.get(observation.reference_id).source.product_record_id &&
        evidence.screen_record_id ===
          referencesById.get(observation.reference_id).source.screen_record_id &&
        evidenceHasSubjectBinding(
          evidence,
          "screen",
          referencesById.get(observation.reference_id).source.screen_record_id
        ) &&
        evidence.frame_ids.includes(observation.frame_id);
    }), `verified observation ${observation.observation_id} evidence is not frame-bound`, 4);
    observation.evidence_ids.forEach((id) => usedEvidenceIds.add(id));
  }
  for (const [referenceId, fit] of referenceProductFits) {
    requireValue(fit.observed_ids.every((id) =>
      observationIds.has(id) && observationReferences.get(id) === referenceId),
    `reference intelligence pack ${referenceId} product_fit cites unverified observations`, 4);
  }
  requireValue(usedEvidenceIds.size === evidenceManifestById.size &&
    [...evidenceManifestById.keys()].every((id) => usedEvidenceIds.has(id)),
  "reference intelligence pack evidence manifest contains unreferenced material", 4);

  requireValue(Array.isArray(input.reasoning_lenses) && input.reasoning_lenses.length >= 8,
    "reference intelligence pack requires reasoning lenses", 4);
  const packLensIds = new Set();
  for (const [index, lens] of input.reasoning_lenses.entries()) {
    const label = `reference intelligence pack reasoning_lenses[${index}]`;
    exact(lens, new Set([
      "lens_id", "question", "decision_test", "failure_if_ignored",
      "applies_to", "tradeoff", "anti_copy_boundary"
    ]), label);
    safeId(lens.lens_id, `${label}.lens_id`);
    requireValue(!packLensIds.has(lens.lens_id),
      `duplicate reference intelligence reasoning lens: ${lens.lens_id}`, 4);
    packLensIds.add(lens.lens_id);
    for (const field of [
      "question", "decision_test", "failure_if_ignored", "tradeoff", "anti_copy_boundary"
    ]) string(lens[field], `${label}.${field}`);
    uniqueStrings(lens.applies_to, `${label}.applies_to`);
    requireValue(!SOURCE_STYLE_LITERAL_PATTERN.test(JSON.stringify(lens)) &&
      !SOURCE_PIXEL_MATERIAL_PATTERN.test(JSON.stringify(lens)),
    `${label} contains source-specific styling`, 4);
  }

  requireValue(Array.isArray(input.verified_hierarchy_reasoning) &&
    input.verified_hierarchy_reasoning.length > 0,
  "reference intelligence pack requires verified hierarchy reasoning", 4);
  const reasoningIds = new Set();
  const reasoningReferences = new Map();
  const reasoningById = new Map();
  for (const reasoning of input.verified_hierarchy_reasoning) {
    exact(reasoning, new Set([
      "reasoning_id", "observed_priority", "user_decision", "likely_constraint",
      "consequence_if_flattened", "confidence", "observed_ids", "reference_id"
    ]), "reference intelligence pack hierarchy reasoning");
    safeId(reasoning.reasoning_id, "reference intelligence pack reasoning_id");
    requireValue(!reasoningIds.has(reasoning.reasoning_id),
      `duplicate reference intelligence reasoning: ${reasoning.reasoning_id}`, 4);
    reasoningIds.add(reasoning.reasoning_id);
    reasoningById.set(reasoning.reasoning_id, reasoning);
    safeId(reasoning.reference_id, `reference reasoning ${reasoning.reasoning_id}.reference_id`);
    requireValue(referenceIds.has(reasoning.reference_id),
      `reference reasoning ${reasoning.reasoning_id} cites an unselected reference`, 4);
    reasoningReferences.set(reasoning.reasoning_id, reasoning.reference_id);
    requireValue(["primary", "secondary", "supporting", "ambient"].includes(
      reasoning.observed_priority
    ), `reference reasoning ${reasoning.reasoning_id}.observed_priority is invalid`, 4);
    for (const field of ["user_decision", "likely_constraint", "consequence_if_flattened"]) {
      string(reasoning[field], `reference reasoning ${reasoning.reasoning_id}.${field}`);
    }
    requireValue(["low", "medium", "high"].includes(reasoning.confidence),
      `reference reasoning ${reasoning.reasoning_id}.confidence is invalid`, 4);
    uniqueStrings(reasoning.observed_ids,
      `reference reasoning ${reasoning.reasoning_id}.observed_ids`);
    requireValue(reasoning.observed_ids.every((id) =>
      observationIds.has(id) && observationReferences.get(id) === reasoning.reference_id),
    `reference reasoning ${reasoning.reasoning_id} cites an unverified observation`, 4);
  }

  requireValue(Array.isArray(input.verified_grammar) && input.verified_grammar.length > 0,
    "reference intelligence pack requires verified grammar", 4);
  const grammarIds = new Set();
  for (const grammar of input.verified_grammar) {
    exact(grammar, new Set([
      "grammar_id", "dimension", "principle", "application", "application_conditions",
      "tradeoff", "harmful_when", "requires_live_data", "avoid", "observed_ids",
      "reasoning_ids", "reference_id"
    ]), "reference intelligence pack grammar");
    safeId(grammar.grammar_id, "reference intelligence pack grammar_id");
    requireValue(!grammarIds.has(grammar.grammar_id),
      `duplicate reference intelligence grammar: ${grammar.grammar_id}`, 4);
    grammarIds.add(grammar.grammar_id);
    safeId(grammar.reference_id, `reference grammar ${grammar.grammar_id}.reference_id`);
    requireValue(referenceIds.has(grammar.reference_id),
      `reference grammar ${grammar.grammar_id} cites an unselected reference`, 4);
    requireValue(GRAMMAR_DIMENSIONS.has(grammar.dimension),
      `reference grammar ${grammar.grammar_id}.dimension is invalid`, 4);
    for (const field of ["principle", "application", "tradeoff", "avoid"]) {
      string(grammar[field], `reference grammar ${grammar.grammar_id}.${field}`);
    }
    uniqueStrings(grammar.application_conditions,
      `reference grammar ${grammar.grammar_id}.application_conditions`);
    uniqueStrings(grammar.harmful_when,
      `reference grammar ${grammar.grammar_id}.harmful_when`);
    requireValue(typeof grammar.requires_live_data === "boolean",
      `reference grammar ${grammar.grammar_id}.requires_live_data must be boolean`, 4);
    uniqueStrings(grammar.observed_ids, `reference grammar ${grammar.grammar_id}.observed_ids`);
    requireValue(grammar.observed_ids.every((id) =>
      observationIds.has(id) && observationReferences.get(id) === grammar.reference_id),
    `reference grammar ${grammar.grammar_id} cites an unverified observation`, 4);
    uniqueStrings(grammar.reasoning_ids, `reference grammar ${grammar.grammar_id}.reasoning_ids`);
    requireValue(grammar.reasoning_ids.every((id) =>
      reasoningIds.has(id) && reasoningReferences.get(id) === grammar.reference_id),
    `reference grammar ${grammar.grammar_id} cites unverified cross-reference reasoning`, 4);
    if (OPERATIONAL_GRAMMAR_DIMENSIONS.has(grammar.dimension)) {
      const citedObservations = [
        ...grammar.observed_ids,
        ...grammar.reasoning_ids.flatMap((id) => reasoningById.get(id).observed_ids)
      ].map((id) => observationsById.get(id));
      requireValue(citedObservations.every((observation) =>
        observation.frame_role !== "promotional"),
      `reference grammar ${grammar.grammar_id} uses promotional evidence for operational structure`, 4);
    }
    requireValue(!SOURCE_STYLE_LITERAL_PATTERN.test(
      JSON.stringify(grammar)
    ), `reference grammar ${grammar.grammar_id} contains source-specific copying instructions`, 4);
  }

  exact(input.ranking_policy, new Set([
    "primary", "within_band", "unverified_or_conflicted_popularity",
    "popularity_cannot_affect", "signals"
  ]), "reference intelligence pack ranking_policy");
  requireValue(input.ranking_policy.primary === "product-fit-band" &&
    input.ranking_policy.within_band === "popularity-descending" &&
    input.ranking_policy.unverified_or_conflicted_popularity === "rank-last-within-fit-band" &&
    sameStringSet(input.ranking_policy.popularity_cannot_affect,
      ["eligibility", "hard-gates", "owner-approval"]),
  "reference intelligence pack weakens popularity isolation", 4);
  requireValue(Array.isArray(input.ranking_policy.signals) &&
    input.ranking_policy.signals.length > 0,
  "reference intelligence pack ranking_policy.signals must be non-empty", 4);
  const rankingSignalIds = new Set();
  for (const signal of input.ranking_policy.signals) {
    exact(signal, new Set([
      "id", "metric", "subject_kind", "weight", "scope", "category", "normalization"
    ]),
      "reference intelligence pack ranking signal");
    safeId(signal.id, "reference intelligence pack ranking signal.id");
    requireValue(!rankingSignalIds.has(signal.id) &&
      ["mau", "bookmark-count", "popular-rank", "curation-popularity"].includes(
        signal.metric
      ) && ["product", "screen"].includes(signal.subject_kind) &&
      (signal.metric !== "mau" || signal.subject_kind === "product") &&
      typeof signal.weight === "number" && Number.isFinite(signal.weight) &&
      signal.weight > 0,
    "reference intelligence pack ranking signal is invalid or duplicated", 4);
    string(signal.scope, "reference intelligence pack ranking signal.scope");
    string(signal.category, "reference intelligence pack ranking signal.category");
    validatePopularityNormalization(
      signal.normalization,
      signal.metric,
      "reference intelligence pack ranking signal.normalization",
      4
    );
    rankingSignalIds.add(signal.id);
  }
  for (const reference of input.references) {
    const recomputed = weightedPopularityScore(
      reference.popularity.signals,
      input.ranking_policy.signals
    );
    requireValue(recomputed !== null &&
      (reference.popularity.verified
        ? reference.popularity.computed_score === recomputed
        : reference.popularity.computed_score === null),
    `reference intelligence pack ${reference.reference_id} popularity score is not router-reproducible`, 4);
  }

  exact(input.downstream_contract, new Set([
    "source_pixels_included", "reasoning_registry_is_visual_authority",
    "visual_authority_granted", "visual_signature_granted", "design_creation_started",
    "exact_three_3x3_route_unchanged", "required_design_checks",
    "design_check_contracts", "reviewer_source_capture_readiness", "required_next_gate"
  ]), "reference intelligence pack downstream_contract");
  requireValue(input.downstream_contract.source_pixels_included === false &&
    input.downstream_contract.reasoning_registry_is_visual_authority === false &&
    input.downstream_contract.visual_authority_granted === false &&
    input.downstream_contract.visual_signature_granted === false &&
    input.downstream_contract.design_creation_started === false &&
    input.downstream_contract.exact_three_3x3_route_unchanged === true,
  "reference intelligence pack weakens the downstream authority boundary", 4);
  requireValue(sameStringSet(input.downstream_contract.required_design_checks,
    REFERENCE_DESIGN_CHECKS),
  "reference intelligence pack cannot weaken or replace required design checks", 4);
  requireValue(Array.isArray(input.downstream_contract.design_check_contracts) &&
    input.downstream_contract.design_check_contracts.length ===
      REFERENCE_DESIGN_CHECKS.length,
  "reference intelligence pack design-check contracts are incomplete", 4);
  const packCheckIds = new Set();
  for (const [index, check] of
    input.downstream_contract.design_check_contracts.entries()) {
    const label = `reference intelligence pack design_check_contracts[${index}]`;
    exact(check, new Set([
      "check_id", "lens_ids", "pass_condition", "required_evidence", "stages", "failure_code"
    ]), label);
    safeId(check.check_id, `${label}.check_id`);
    requireValue(REFERENCE_DESIGN_CHECKS.includes(check.check_id) &&
      !packCheckIds.has(check.check_id),
    `${label}.check_id is unsupported or duplicated`, 4);
    packCheckIds.add(check.check_id);
    uniqueStrings(check.lens_ids, `${label}.lens_ids`);
    requireValue(check.lens_ids.every((id) => packLensIds.has(id)),
      `${label}.lens_ids cites an unknown reasoning lens`, 4);
    string(check.pass_condition, `${label}.pass_condition`);
    uniqueStrings(check.required_evidence, `${label}.required_evidence`);
    uniqueStrings(check.stages, `${label}.stages`, { allowed: DESIGN_REVIEW_STAGES });
    requireValue(check.failure_code === `reference-check-failed:${check.check_id}`,
      `${label}.failure_code must be bound to check_id`, 4);
    requireValue(!SOURCE_STYLE_LITERAL_PATTERN.test(JSON.stringify(check)) &&
      !SOURCE_PIXEL_MATERIAL_PATTERN.test(JSON.stringify(check)),
    `${label} contains source-specific styling`, 4);
  }
  requireValue(sameStringSet([...packCheckIds], REFERENCE_DESIGN_CHECKS),
    "reference intelligence pack design-check contracts are incomplete", 4);
  const sourceCaptureReadiness = input.downstream_contract.reviewer_source_capture_readiness;
  exact(sourceCaptureReadiness, new Set([
    "status", "capture_evidence_ids", "uncovered_reference_ids",
    "uncovered_observation_ids", "revalidate_on_design_start"
  ]), "reference intelligence pack reviewer_source_capture_readiness");
  requireValue(["ready_at_compilation", "manual_pending"].includes(
    sourceCaptureReadiness.status
  ), "reference intelligence pack reviewer source-capture status is invalid", 4);
  uniqueStrings(sourceCaptureReadiness.capture_evidence_ids,
    "reference intelligence pack reviewer capture_evidence_ids", { min: 0 });
  uniqueStrings(sourceCaptureReadiness.uncovered_reference_ids,
    "reference intelligence pack reviewer uncovered_reference_ids", { min: 0 });
  uniqueStrings(sourceCaptureReadiness.uncovered_observation_ids,
    "reference intelligence pack reviewer uncovered_observation_ids", { min: 0 });
  requireValue(sourceCaptureReadiness.revalidate_on_design_start === true &&
    canonicalDigest(sourceCaptureReadiness) ===
      canonicalDigest(reviewerSourceCaptureReadiness(input)),
  "reference intelligence pack reviewer source-capture readiness is not router-reproducible",
  4);
  string(input.downstream_contract.required_next_gate,
    "reference intelligence pack downstream_contract.required_next_gate");

  exact(input.provenance, new Set([
    "brief_digest", "reasoning_registry_version", "reasoning_registry_digest",
    "reasoning_registry_source_digest", "planning_digests", "source_export_digests", "rights_digest",
    "result_digests", "selection_scope_digest"
  ]), "reference intelligence pack provenance");
  for (const field of [
    "brief_digest", "reasoning_registry_digest", "reasoning_registry_source_digest",
    "rights_digest", "selection_scope_digest"
  ]) digest(input.provenance[field], `reference intelligence pack provenance.${field}`);
  requireValue(input.provenance.reasoning_registry_version === 1,
    "reference intelligence pack provenance.reasoning_registry_version must be 1", 4);
  uniqueStrings(input.provenance.planning_digests,
    "reference intelligence pack provenance.planning_digests");
  input.provenance.planning_digests.forEach((value, index) => digest(value,
    `reference intelligence pack provenance.planning_digests[${index}]`));
  uniqueStrings(input.provenance.source_export_digests,
    "reference intelligence pack provenance.source_export_digests", { min: 0 });
  input.provenance.source_export_digests.forEach((value, index) => digest(value,
    `reference intelligence pack provenance.source_export_digests[${index}]`));
  exact(input.provenance.result_digests, new Set([
    "reference-discovery", "reference-grammar", "reference-review"
  ]), "reference intelligence pack provenance.result_digests");
  for (const kind of ["reference-discovery", "reference-grammar", "reference-review"]) {
    digest(input.provenance.result_digests[kind],
      `reference intelligence pack provenance.result_digests.${kind}`);
  }
  const currentRegistry = loadHumanDesignReasoningRegistry();
  requireValue(input.provenance.reasoning_registry_version ===
    currentRegistry.registry.human_design_reasoning_registry_version &&
    input.provenance.reasoning_registry_digest === currentRegistry.digest &&
    canonicalDigest(input.reasoning_lenses) === canonicalDigest(currentRegistry.registry.lenses) &&
    canonicalDigest(input.downstream_contract.design_check_contracts) ===
      canonicalDigest(currentRegistry.registry.design_checks),
  "reference intelligence pack reasoning registry is not the bundled version", 4);
  timestamp(input.compiled_at, "reference intelligence pack compiled_at");
  digest(input.pack_digest, "reference intelligence pack pack_digest");
  const { pack_digest: packDigest, ...body } = input;
  requireValue(canonicalDigest(body) === packDigest,
    "reference intelligence pack digest mismatch", 4);
  requireValue(!SOURCE_PIXEL_MATERIAL_PATTERN.test(JSON.stringify(input)),
    "reference intelligence pack contains source-pixel material", 4);
  requireValue(!SOURCE_STYLE_LITERAL_PATTERN.test(JSON.stringify({
    reasoning_lenses: input.reasoning_lenses,
    verified_observations: input.verified_observations,
    verified_hierarchy_reasoning: input.verified_hierarchy_reasoning,
    verified_grammar: input.verified_grammar,
    design_check_contracts: input.downstream_contract.design_check_contracts
  })), "reference intelligence pack contains source-specific styling literals", 4);
  return input;
}

function bindHumanDesignReasoningRegistry(directory) {
  const loaded = loadHumanDesignReasoningRegistry();
  const target = path.join(directory, "authority", "human-design-reasoning.json");
  const source = writePinnedJson(
    target,
    loaded.registry,
    "bound human-design reasoning registry",
    directory
  );
  return {
    registry_version: loaded.registry.human_design_reasoning_registry_version,
    authority_scope: loaded.registry.authority_scope,
    source_pixels_included: false,
    registry_digest: loaded.digest,
    source,
    research_basis: structuredClone(loaded.registry.research_basis),
    design_checks: structuredClone(loaded.registry.design_checks),
    lenses: structuredClone(loaded.registry.lenses)
  };
}

function reasoningTaskContract(state) {
  return {
    registry_digest: state.reasoning_registry.registry_digest,
    authority_scope: state.reasoning_registry.authority_scope,
    source_pixels_included: false,
    design_checks: structuredClone(state.reasoning_registry.design_checks),
    lenses: structuredClone(state.reasoning_registry.lenses)
  };
}

function manualPopularityRecordKey(record) {
  if (record.record_kind === "conflict") {
    return canonicalDigest({
      record_kind: record.record_kind,
      signal_id: record.signal_id,
      subject_kind: record.subject_kind,
      subject_record_id: record.subject_record_id,
      raw_value: record.raw_value,
      as_of: record.as_of,
      evidence_ids: [...record.evidence_ids].sort()
    });
  }
  return canonicalDigest({
    record_kind: record.record_kind,
    signal_id: record.signal_id,
    metric: record.metric,
    subject_kind: record.subject_kind,
    subject_record_id: record.subject_record_id,
    raw_value: record.raw_value,
    scope: record.scope,
    category: record.category,
    as_of: record.as_of,
    snapshot_at: record.snapshot_at,
    normalization: record.normalization,
    evidence_ids: [...record.evidence_ids].sort()
  });
}

function manualPopularitySubjectKey(record) {
  return `${record.subject_kind}\u0000${record.subject_record_id}\u0000${record.signal_id}`;
}

function manualPopularityProductEvidence(record, evidenceById) {
  return record.evidence_ids.map((evidenceId) => {
    const evidence = evidenceById.get(evidenceId);
    const subjectBindings = evidence.subject_bindings
      .filter((binding) => binding.subject_kind === "product")
      .map((binding) => ({
        subject_kind: binding.subject_kind,
        subject_record_id: binding.subject_record_id
      }))
      .sort((left, right) =>
        left.subject_record_id.localeCompare(right.subject_record_id, "en"));
    const identity = {
      kind: evidence.kind,
      digest: evidence.digest,
      subject_bindings: subjectBindings
    };
    return {
      evidence_identity_digest: canonicalDigest(identity),
      ...identity
    };
  }).sort((left, right) =>
    left.evidence_identity_digest.localeCompare(right.evidence_identity_digest, "en"));
}

function manualPopularitySignalClaim(record, evidenceById) {
  return {
    signal_id: record.signal_id,
    metric: record.metric,
    subject_kind: record.subject_kind,
    subject_record_id: record.subject_record_id,
    raw_value: record.raw_value,
    scope: record.scope,
    category: record.category,
    as_of: record.as_of,
    snapshot_at: record.snapshot_at,
    normalization: record.normalization,
    product_subject_evidence: manualPopularityProductEvidence(record, evidenceById)
  };
}

function manualPopularityConflictClaim(record, evidenceById = null) {
  return canonicalDigest({
    signal_id: record.signal_id,
    subject_kind: record.subject_kind,
    subject_record_id: record.subject_record_id,
    raw_value: record.raw_value,
    as_of: record.as_of,
    product_subject_evidence: record.product_subject_evidence ||
      manualPopularityProductEvidence(record, evidenceById)
  });
}

export function validateUiBowlManualExport(input, label = "UI Bowl manual export") {
  exact(input, new Set([
    "export_version", "provider", "access_mode", "captured_at", "query_ids", "records"
  ]), label);
  requireValue(input.export_version === 1, `${label}.export_version must be 1`, 4);
  requireValue(input.provider === "uibowl" && input.access_mode === "manual-export",
    `${label} must be a UI Bowl manual export`, 4);
  timestamp(input.captured_at, `${label}.captured_at`);
  uniqueStrings(input.query_ids, `${label}.query_ids`);
  requireValue(Array.isArray(input.records) && input.records.length > 0,
    `${label}.records must contain at least one record`, 4);
  const screenIds = new Set();
  const uris = new Set();
  for (const [index, record] of input.records.entries()) {
    const recordLabel = `${label}.records[${index}]`;
    exact(record, new Set([
      "product_record_id", "screen_record_id", "uri", "captured_at", "query_ids",
      "frames", "evidence_records", "popularity_records"
    ]), recordLabel);
    string(record.product_record_id, `${recordLabel}.product_record_id`);
    string(record.screen_record_id, `${recordLabel}.screen_record_id`);
    validateSourceUri(record.uri);
    timestamp(record.captured_at, `${recordLabel}.captured_at`);
    uniqueStrings(record.query_ids, `${recordLabel}.query_ids`);
    requireValue(record.query_ids.every((id) => input.query_ids.includes(id)),
      `${recordLabel}.query_ids contains an ID outside the export query scope`, 4);
    const normalizedScreen = record.screen_record_id.trim().toLocaleLowerCase("en");
    const normalizedUri = new URL(record.uri).href;
    requireValue(!screenIds.has(normalizedScreen) && !uris.has(normalizedUri),
      `${recordLabel} duplicates a UI Bowl screen record or URI`, 4);
    screenIds.add(normalizedScreen);
    uris.add(normalizedUri);

    requireValue(Array.isArray(record.frames) && record.frames.length > 0,
      `${recordLabel}.frames must contain at least one frame`, 4);
    const frameIds = new Set();
    for (const [frameIndex, frame] of record.frames.entries()) {
      const frameLabel = `${recordLabel}.frames[${frameIndex}]`;
      exact(frame, new Set(["frame_id", "role", "core_task", "state"]), frameLabel);
      safeId(frame.frame_id, `${frameLabel}.frame_id`);
      requireValue(!frameIds.has(frame.frame_id) && SCREEN_ROLES.has(frame.role) &&
        typeof frame.core_task === "boolean" && typeof frame.state === "boolean",
      `${frameLabel} is invalid or duplicated`, 4);
      frameIds.add(frame.frame_id);
    }

    requireValue(Array.isArray(record.evidence_records) &&
      record.evidence_records.length > 0,
    `${recordLabel}.evidence_records must be non-empty`, 4);
    const evidenceIds = new Set();
    const evidencedFrames = new Set();
    const evidenceSubjects = new Map();
    for (const [evidenceIndex, evidence] of record.evidence_records.entries()) {
      const evidenceLabel = `${recordLabel}.evidence_records[${evidenceIndex}]`;
      exact(evidence, new Set([
        "evidence_id", "kind", "path", "digest", "frame_ids", "subject_bindings"
      ]), evidenceLabel);
      safeId(evidence.evidence_id, `${evidenceLabel}.evidence_id`);
      requireValue(!evidenceIds.has(evidence.evidence_id),
        `${evidenceLabel}.evidence_id is duplicated`, 4);
      evidenceIds.add(evidence.evidence_id);
      requireValue(["source-capture", "source-metadata"].includes(evidence.kind),
        `${evidenceLabel}.kind is invalid`, 4);
      string(evidence.path, `${evidenceLabel}.path`);
      digest(evidence.digest, `${evidenceLabel}.digest`);
      uniqueStrings(evidence.frame_ids, `${evidenceLabel}.frame_ids`);
      requireValue(evidence.frame_ids.every((frameId) => frameIds.has(frameId)),
        `${evidenceLabel} contains a frame outside its export record`, 4);
      evidence.frame_ids.forEach((frameId) => evidencedFrames.add(frameId));
      requireValue(Array.isArray(evidence.subject_bindings) &&
        evidence.subject_bindings.length > 0,
      `${evidenceLabel}.subject_bindings must be non-empty`, 4);
      const subjects = new Set();
      for (const [subjectIndex, subject] of evidence.subject_bindings.entries()) {
        const subjectLabel = `${evidenceLabel}.subject_bindings[${subjectIndex}]`;
        exact(subject, new Set(["subject_kind", "subject_record_id"]), subjectLabel);
        requireValue(["product", "screen"].includes(subject.subject_kind),
          `${subjectLabel}.subject_kind is invalid`, 4);
        requireValue(subject.subject_record_id ===
          (subject.subject_kind === "product"
            ? record.product_record_id : record.screen_record_id),
        `${subjectLabel} conflicts with its export record`, 4);
        const subjectKey = `${subject.subject_kind}\u0000${subject.subject_record_id}`;
        requireValue(!subjects.has(subjectKey), `${subjectLabel} is duplicated`, 4);
        subjects.add(subjectKey);
      }
      requireValue(subjects.has(`screen\u0000${record.screen_record_id}`),
        `${evidenceLabel} must bind its screen subject`, 4);
      evidenceSubjects.set(evidence.evidence_id, subjects);
    }
    requireValue([...frameIds].every((frameId) => evidencedFrames.has(frameId)),
      `${recordLabel}.evidence_records must cover every exported frame`, 4);

    requireValue(Array.isArray(record.popularity_records) &&
      record.popularity_records.length > 0,
    `${recordLabel}.popularity_records must be non-empty`, 4);
    const popularityRecords = new Set();
    for (const [popularityIndex, popularity] of record.popularity_records.entries()) {
      const popularityLabel = `${recordLabel}.popularity_records[${popularityIndex}]`;
      requireValue(["signal", "conflict"].includes(popularity.record_kind),
        `${popularityLabel}.record_kind is invalid`, 4);
      const fields = popularity.record_kind === "signal"
        ? [
            "record_kind", "signal_id", "metric", "subject_kind", "subject_record_id",
            "raw_value", "scope", "category", "as_of", "snapshot_at", "normalization",
            "evidence_ids"
          ]
        : [
            "record_kind", "signal_id", "subject_kind", "subject_record_id",
            "raw_value", "as_of", "evidence_ids"
          ];
      exact(popularity, new Set(fields), popularityLabel);
      safeId(popularity.signal_id, `${popularityLabel}.signal_id`);
      requireValue(["product", "screen"].includes(popularity.subject_kind),
        `${popularityLabel}.subject_kind is invalid`, 4);
      requireValue(popularity.subject_record_id ===
        (popularity.subject_kind === "product"
          ? record.product_record_id : record.screen_record_id),
      `${popularityLabel} subject conflicts with its export record`, 4);
      requireValue(typeof popularity.raw_value === "number" &&
        Number.isFinite(popularity.raw_value),
      `${popularityLabel}.raw_value must be finite`, 4);
      timestamp(popularity.as_of, `${popularityLabel}.as_of`);
      uniqueStrings(popularity.evidence_ids, `${popularityLabel}.evidence_ids`);
      requireValue(popularity.evidence_ids.every((id) => evidenceIds.has(id) &&
        evidenceSubjects.get(id).has(
          `${popularity.subject_kind}\u0000${popularity.subject_record_id}`
        )),
      `${popularityLabel} lacks subject-bound exported evidence`, 4);
      if (popularity.record_kind === "signal") {
        requireValue([
          "mau", "bookmark-count", "popular-rank", "curation-popularity"
        ].includes(popularity.metric) &&
          (popularity.metric !== "mau" || popularity.subject_kind === "product"),
        `${popularityLabel}.metric or subject is invalid`, 4);
        string(popularity.scope, `${popularityLabel}.scope`);
        string(popularity.category, `${popularityLabel}.category`);
        timestamp(popularity.snapshot_at, `${popularityLabel}.snapshot_at`);
        validatePopularityNormalization(
          popularity.normalization, popularity.metric,
          `${popularityLabel}.normalization`, 4
        );
      }
      const popularityKey = manualPopularityRecordKey(popularity);
      requireValue(!popularityRecords.has(popularityKey),
        `${popularityLabel} duplicates another popularity record`, 4);
      popularityRecords.add(popularityKey);
    }
  }
  return input;
}

function buildManualExportIndex(brief, loadedExports) {
  if (brief.source.access_mode !== "manual-export") return null;
  requireValue(loadedExports.length === brief.source.exports.length && loadedExports.length > 0,
    "manual-export membership requires every digest-bound export", 4);
  const configuredSignals = new Map(
    brief.popularity_prior.signals.map((signal) => [signal.id, signal])
  );
  const expectedQueryIds = brief.source.queries.map((query) => query.id);
  const coveredQueryIds = new Set();
  const recordsByScreen = new Map();
  const uris = new Set();
  const evidenceIds = new Set();
  const productSignalClaims = new Map();
  for (const loaded of loadedExports) {
    const label = `UI Bowl manual export ${loaded.id}`;
    const manifest = validateUiBowlManualExport(loaded.input, label);
    requireValue(manifest.query_ids.every((id) => expectedQueryIds.includes(id)),
      `${label} contains a query outside the reference brief`, 4);
    manifest.query_ids.forEach((id) => coveredQueryIds.add(id));
    for (const record of manifest.records) {
      requireValue(record.query_ids.every((id) => expectedQueryIds.includes(id)),
        `${label} record ${record.screen_record_id} contains an unbound query`, 4);
      const normalizedScreen = record.screen_record_id.trim().toLocaleLowerCase("en");
      const normalizedUri = new URL(record.uri).href;
      requireValue(!recordsByScreen.has(normalizedScreen) && !uris.has(normalizedUri),
        `${label} duplicates a screen record or URI from another export`, 4);
      uris.add(normalizedUri);
      const signalRecordIds = new Set();
      const popularityRecordKeys = new Set();
      const evidenceById = new Map();
      for (const evidence of record.evidence_records) {
        requireValue(!evidenceIds.has(evidence.evidence_id),
          `${label} repeats evidence ID ${evidence.evidence_id}`, 4);
        evidenceIds.add(evidence.evidence_id);
        evidenceById.set(evidence.evidence_id, structuredClone(evidence));
      }
      for (const popularity of record.popularity_records) {
        const configured = configuredSignals.get(popularity.signal_id);
        requireValue(configured && configured.subject_kind === popularity.subject_kind,
          `${label} record ${record.screen_record_id} has an unconfigured popularity subject`, 4);
        if (popularity.record_kind === "signal") {
          requireValue(popularityPolicyMatches({
            id: popularity.signal_id,
            ...popularity
          }, configured),
          `${label} record ${record.screen_record_id} changes popularity scope, category, or normalization`, 4);
          requireValue(!signalRecordIds.has(popularity.signal_id),
            `${label} record ${record.screen_record_id} duplicates popularity signal ${popularity.signal_id}`, 4);
          signalRecordIds.add(popularity.signal_id);
          if (popularity.subject_kind === "product") {
            const subjectKey = manualPopularitySubjectKey(popularity);
            if (!productSignalClaims.has(subjectKey)) productSignalClaims.set(subjectKey, []);
            productSignalClaims.get(subjectKey).push({
              screen_record_id: record.screen_record_id,
              claim: manualPopularitySignalClaim(popularity, evidenceById),
              conflicts: record.popularity_records
                .filter((item) => item.record_kind === "conflict" &&
                  manualPopularitySubjectKey(item) === subjectKey)
                .map((item) => manualPopularityConflictClaim(item, evidenceById))
            });
          }
        }
        popularityRecordKeys.add(manualPopularityRecordKey(popularity));
      }
      requireValue(sameStringSet([...signalRecordIds], [...configuredSignals.keys()]),
        `${label} record ${record.screen_record_id} does not contain every configured popularity signal`, 4);
      recordsByScreen.set(normalizedScreen, {
        ...structuredClone(record),
        export_id: loaded.id,
        manifest_path: loaded.path,
        normalized_uri: normalizedUri,
        frames_by_id: new Map(record.frames.map((frame) => [frame.frame_id, frame])),
        evidence_by_id: evidenceById,
        popularity_record_keys: popularityRecordKeys
      });
    }
  }
  requireValue(sameStringSet([...coveredQueryIds], expectedQueryIds),
    "UI Bowl manual exports do not cover the exact bounded query set", 4);
  for (const [subjectKey, entries] of productSignalClaims) {
    if (entries.length < 2) continue;
    const snapshotClaims = new Set(entries.map((entry) => entry.claim.snapshot_at));
    requireValue(snapshotClaims.size === 1,
      `UI Bowl product popularity ${subjectKey} snapshot_at differs across screens`, 4);
    const claims = new Map(entries.map((entry) => [
      canonicalDigest(entry.claim), entry.claim
    ]));
    if (claims.size === 1) continue;
    for (const entry of entries) {
      const ownClaimDigest = canonicalDigest(entry.claim);
      const expectedConflicts = [...claims.entries()]
        .filter(([claimDigest]) => claimDigest !== ownClaimDigest)
        .map(([, claim]) => manualPopularityConflictClaim(claim));
      requireValue(expectedConflicts.every((claim) => entry.conflicts.includes(claim)),
        `UI Bowl product popularity ${subjectKey} differs across screens without reciprocal explicit conflict records (${entry.screen_record_id})`, 4);
    }
  }
  return { records_by_screen: recordsByScreen };
}

function loadManualExportAuthorities(brief, root) {
  if (brief.source.access_mode !== "manual-export") {
    return { manifests: [], evidence: [], index: null };
  }
  const manifests = [];
  const evidence = [];
  for (const declaration of brief.source.exports) {
    const resolved = resolveEvidence(
      root,
      declaration,
      `UI Bowl manual export ${declaration.id}`,
      { json: true }
    );
    const manifest = validateUiBowlManualExport(
      resolved.input,
      `UI Bowl manual export ${declaration.id}`
    );
    manifests.push({
      id: declaration.id,
      path: resolved.snapshot.resolved_path,
      input: manifest,
      snapshot: resolved.snapshot
    });
    const exportDirectory = path.dirname(resolved.snapshot.resolved_path);
    for (const record of manifest.records) {
      for (const source of record.evidence_records) {
        requireValue(!path.isAbsolute(source.path),
          `UI Bowl manual export evidence ${source.evidence_id} path must be relative`, 4);
        const target = path.resolve(exportDirectory, source.path);
        requireValue(inside(target, exportDirectory),
          `UI Bowl manual export evidence ${source.evidence_id} escapes its export directory`, 4);
        let pinned;
        try {
          pinned = readFilePinned(target, {
            label: `UI Bowl manual export evidence ${source.evidence_id}`
          });
        } catch (error) {
          throw new RouterError(error.message, 4);
        }
        requireValue(pinned.digest === source.digest,
          `UI Bowl manual export evidence ${source.evidence_id} digest mismatch`, 4);
        validateManualExportEvidenceContent(
          pinned,
          source,
          record,
          `UI Bowl manual export evidence ${source.evidence_id}`
        );
        evidence.push({
          export_id: declaration.id,
          evidence_id: source.evidence_id,
          evidence_kind: source.kind,
          product_record_id: record.product_record_id,
          screen_record_id: record.screen_record_id,
          frame_ids: structuredClone(source.frame_ids),
          subject_bindings: structuredClone(source.subject_bindings),
          ...pinnedSnapshot(pinned, root)
        });
      }
    }
  }
  return {
    manifests,
    evidence,
    index: buildManualExportIndex(brief, manifests)
  };
}

function paethPredictor(left, above, upperLeft) {
  const value = left + above - upperLeft;
  const leftDistance = Math.abs(value - left);
  const aboveDistance = Math.abs(value - above);
  const upperLeftDistance = Math.abs(value - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left;
  return aboveDistance <= upperLeftDistance ? above : upperLeft;
}

function validatePngCapture(bytes, label) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  requireValue(bytes.length >= 57 && bytes.subarray(0, 8).equals(signature),
    `${label} must be a complete PNG capture`, 4);
  let offset = 8;
  let header = null;
  const compressed = [];
  let ended = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const next = offset + 12 + length;
    requireValue(next <= bytes.length, `${label} contains a truncated PNG chunk`, 4);
    const type = bytes.subarray(offset + 4, offset + 8).toString("ascii");
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") header = Buffer.from(data);
    if (type === "IDAT") compressed.push(Buffer.from(data));
    offset = next;
    if (type === "IEND") {
      ended = true;
      break;
    }
  }
  requireValue(ended && offset === bytes.length && header?.length === 13 && compressed.length > 0,
    `${label} must contain complete IHDR, IDAT, and IEND chunks`, 4);
  const width = header.readUInt32BE(0);
  const height = header.readUInt32BE(4);
  const bitDepth = header[8];
  const colorType = header[9];
  const channels = colorType === 2 ? 3 : colorType === 6 ? 4 : 0;
  requireValue(width >= 64 && height >= 64 && width <= 20_000 && height <= 20_000 &&
    width * height <= 100_000_000,
  `${label} dimensions must be a meaningful bounded UI capture`, 4);
  requireValue(bitDepth === 8 && channels > 0 && header[10] === 0 &&
    header[11] === 0 && header[12] === 0,
  `${label} must be a non-interlaced 8-bit RGB or RGBA PNG`, 4);
  const rowBytes = width * channels;
  const expectedBytes = (rowBytes + 1) * height;
  let inflated;
  try {
    inflated = zlib.inflateSync(Buffer.concat(compressed), {
      maxOutputLength: expectedBytes
    });
  } catch (error) {
    throw new RouterError(`${label} PNG pixels cannot be decoded: ${error.message}`, 4);
  }
  requireValue(inflated.length === expectedBytes,
    `${label} PNG pixel length is inconsistent`, 4);
  let previous = Buffer.alloc(rowBytes);
  let firstPixel = null;
  let varied = false;
  for (let row = 0; row < height; row += 1) {
    const rowOffset = row * (rowBytes + 1);
    const filter = inflated[rowOffset];
    requireValue(filter <= 4, `${label} PNG uses an invalid row filter`, 4);
    const current = Buffer.alloc(rowBytes);
    for (let column = 0; column < rowBytes; column += 1) {
      const raw = inflated[rowOffset + 1 + column];
      const left = column >= channels ? current[column - channels] : 0;
      const above = previous[column];
      const upperLeft = column >= channels ? previous[column - channels] : 0;
      const predictor = filter === 0 ? 0
        : filter === 1 ? left
          : filter === 2 ? above
            : filter === 3 ? Math.floor((left + above) / 2)
              : paethPredictor(left, above, upperLeft);
      current[column] = (raw + predictor) & 0xff;
    }
    for (let column = 0; column < rowBytes; column += channels) {
      const pixel = current.subarray(column, column + channels);
      if (!firstPixel) firstPixel = Buffer.from(pixel);
      else if (!pixel.equals(firstPixel)) varied = true;
    }
    previous = current;
  }
  requireValue(varied, `${label} cannot be a blank single-color capture`, 4);
}

function validateManualExportEvidenceContent(pinned, source, record, label) {
  const extension = path.extname(pinned.path).toLocaleLowerCase("en");
  if (source.kind === "source-capture") {
    requireValue(extension === ".png", `${label} must use a .png path`, 4);
    validatePngCapture(pinned.source, label);
    return;
  }
  requireValue(extension === ".json", `${label} must use a .json path`, 4);
  let metadata;
  try {
    metadata = JSON.parse(pinned.source.toString("utf8"));
  } catch (error) {
    throw new RouterError(`${label} metadata must be valid JSON: ${error.message}`, 4);
  }
  exact(metadata, new Set([
    "uibowl_source_metadata_version", "product_record_id", "screen_record_id",
    "captured_at", "frames", "frame_summaries", "popularity_records"
  ]), `${label} metadata`);
  requireValue(Array.isArray(metadata.frame_summaries) &&
    metadata.frame_summaries.length === source.frame_ids.length,
  `${label} metadata must summarize every bound frame`, 4);
  const summaryFrameIds = new Set();
  for (const [index, summary] of metadata.frame_summaries.entries()) {
    const summaryLabel = `${label} metadata.frame_summaries[${index}]`;
    exact(summary, new Set(["frame_id", "visible_regions"]), summaryLabel);
    safeId(summary.frame_id, `${summaryLabel}.frame_id`);
    requireValue(!summaryFrameIds.has(summary.frame_id) &&
      source.frame_ids.includes(summary.frame_id),
    `${summaryLabel}.frame_id is unbound or duplicated`, 4);
    summaryFrameIds.add(summary.frame_id);
    uniqueStrings(summary.visible_regions, `${summaryLabel}.visible_regions`);
  }
  requireValue(metadata.uibowl_source_metadata_version === 1 &&
    metadata.product_record_id === record.product_record_id &&
    metadata.screen_record_id === record.screen_record_id &&
    metadata.captured_at === record.captured_at &&
    canonicalDigest(metadata.frames) === canonicalDigest(record.frames) &&
    canonicalDigest(metadata.popularity_records) === canonicalDigest(
      record.popularity_records.map(({ evidence_ids: _evidenceIds, ...item }) => item)
    ),
  `${label} metadata conflicts with its export record`, 4);
}

function readBoundManualExports(state) {
  if (state.brief.source.access_mode !== "manual-export") return null;
  const loaded = state.authority_sources.exports.map((source) => {
    verifyBoundSnapshot(source, `UI Bowl manual export ${source.id}`);
    const pinned = readPinnedJson(source.resolved_path, `UI Bowl manual export ${source.id}`);
    const current = pinnedSnapshot(pinned, state.state_directory);
    requireValue(current.digest === source.digest && current.bytes === source.bytes &&
      current.physical_identity_digest === source.physical_identity_digest,
    `UI Bowl manual export ${source.id} changed before membership validation`, 4);
    return { id: source.id, path: source.resolved_path, input: pinned.input };
  });
  const index = buildManualExportIndex(state.brief, loaded);
  requireValue(Array.isArray(state.authority_sources.export_evidence),
    "reference authority_sources.export_evidence must be an array", 4);
  const boundEvidence = new Map();
  for (const source of state.authority_sources.export_evidence) {
    requireValue(!boundEvidence.has(source.evidence_id),
      `duplicate bound UI Bowl evidence ${source.evidence_id}`, 4);
    verifyBoundSnapshot(source, `UI Bowl manual export evidence ${source.evidence_id}`);
    boundEvidence.set(source.evidence_id, source);
  }
  let expectedEvidenceCount = 0;
  for (const record of index.records_by_screen.values()) {
    for (const expected of record.evidence_by_id.values()) {
      expectedEvidenceCount += 1;
      const source = boundEvidence.get(expected.evidence_id);
      const expectedPath = path.resolve(path.dirname(record.manifest_path), expected.path);
      requireValue(source && source.export_id === record.export_id &&
        source.evidence_kind === expected.kind && source.digest === expected.digest &&
        source.resolved_path === expectedPath &&
        source.product_record_id === record.product_record_id &&
        source.screen_record_id === record.screen_record_id &&
        sameStringSet(source.frame_ids, expected.frame_ids) &&
        sameStringSet(
          normalizedSubjectBindingKeys(source.subject_bindings),
          normalizedSubjectBindingKeys(expected.subject_bindings)
        ),
      `UI Bowl manual export evidence ${expected.evidence_id} state binding mismatch`, 4);
    }
  }
  requireValue(boundEvidence.size === expectedEvidenceCount,
    "reference authority contains unbound UI Bowl export evidence", 4);
  return index;
}

function normalizedSubjectBindingKeys(bindings) {
  return bindings.map((binding) =>
    `${binding.subject_kind}\u0000${binding.subject_record_id}`).sort();
}

function validateManualEvidenceSnapshots(state, result, evidenceSnapshots) {
  if (result.kind !== "reference-discovery" ||
    state.brief.source.access_mode !== "manual-export") return;
  const manualExportIndex = readBoundManualExports(state);
  for (const evidence of evidenceSnapshots) {
    const manualRecord = manualExportIndex.records_by_screen.get(
      evidence.screen_record_id.trim().toLocaleLowerCase("en")
    );
    const exported = manualRecord?.evidence_by_id.get(evidence.evidence_id);
    requireValue(manualRecord && exported &&
      manualRecord.product_record_id === evidence.product_record_id &&
      exported.kind === evidence.evidence_kind &&
      exported.digest === evidence.digest &&
      sameStringSet(exported.frame_ids, evidence.frame_ids) &&
      sameStringSet(
        normalizedSubjectBindingKeys(exported.subject_bindings),
        normalizedSubjectBindingKeys(evidence.subject_bindings)
      ),
    `reference evidence ${evidence.evidence_id} is not the exact digest-bound manual export evidence`, 4);
  }
}

function verifyReferenceAuthorityGraph(state) {
  validateReferenceBrief(state.brief, { verifyEvidence: false });
  object(state.authority_sources, "reference authority_sources");
  requireValue(Array.isArray(state.authority_sources.planning) &&
    Array.isArray(state.authority_sources.exports) &&
    Array.isArray(state.authority_sources.export_evidence),
  "reference authority source collections must be arrays", 4);
  verifyBoundSnapshot(state.brief_source, "reference brief");
  const sourceBrief = readPinnedJson(
    state.brief_source.resolved_path,
    "reference brief"
  ).input;
  requireValue(canonicalDigest(sourceBrief) === canonicalDigest(state.brief),
    "reference brief state binding mismatch", 4);

  verifyBoundSnapshot(state.authority_sources.activation,
    "reference owner activation evidence");
  requireValue(state.authority_sources.activation.digest ===
    state.brief.activation.evidence.digest,
  "reference owner activation state binding mismatch", 4);
  verifyBoundSnapshot(state.authority_sources.rights,
    "reference rights evidence");
  requireValue(state.authority_sources.rights.digest ===
    state.brief.source.rights.evidence.digest,
  "reference rights state binding mismatch", 4);

  requireValue(state.authority_sources.planning.length ===
    state.brief.planning.sources.length,
  "reference planning authority count conflicts with the brief", 4);
  const planningDeclarations = new Map(
    state.brief.planning.sources.map((source) => [source.id, source])
  );
  for (const source of state.authority_sources.planning) {
    const declaration = planningDeclarations.get(source.id);
    requireValue(declaration && declaration.digest === source.digest,
      `service-planning source ${source.id} state binding mismatch`, 4);
    verifyBoundSnapshot(source, `service-planning source ${source.id}`);
    const gate = readPinnedJson(
      source.resolved_path,
      `service-planning source ${source.id}`
    ).input;
    requireValue(gate.planning_gate_version === 1,
      `service-planning source ${source.id} is not a V1 planning gate`, 4);
    requireValue(gate.project_id === state.brief.project_id &&
      gate.surface === state.brief.surface,
    `service-planning source ${source.id} conflicts with project or surface`, 4);
    for (const gateId of state.brief.planning.required_gate_ids) {
      requireValue(["passed", "approved", "locked"].includes(gate.gates?.[gateId]?.status),
        `service-planning source ${source.id} has not cleared required gate ${gateId}`, 4);
    }
  }

  requireValue(state.authority_sources.exports.length ===
    state.brief.source.exports.length,
  "reference source export count conflicts with the brief", 4);
  const exportDeclarations = new Map(
    state.brief.source.exports.map((source) => [source.id, source])
  );
  for (const source of state.authority_sources.exports) {
    const declaration = exportDeclarations.get(source.id);
    requireValue(declaration && declaration.digest === source.digest,
      `UI Bowl manual export ${source.id} state binding mismatch`, 4);
    verifyBoundSnapshot(source, `UI Bowl manual export ${source.id}`);
  }
  if (state.brief.source.access_mode === "manual-export") {
    readBoundManualExports(state);
  } else {
    requireValue(Array.isArray(state.authority_sources.export_evidence) &&
      state.authority_sources.export_evidence.length === 0,
    "authorized read-only reference state cannot retain manual export evidence", 4);
  }

  object(state.reasoning_registry, "reference reasoning registry binding");
  verifyBoundSnapshot(state.reasoning_registry.source,
    "reference reasoning registry source");
  const pinnedRegistry = readPinnedJson(
    state.reasoning_registry.source.resolved_path,
    "reference reasoning registry source"
  );
  const currentRegistry = pinnedSnapshot(pinnedRegistry, state.state_directory);
  requireValue(currentRegistry.digest === state.reasoning_registry.source.digest &&
    currentRegistry.physical_identity_digest ===
      state.reasoning_registry.source.physical_identity_digest &&
    currentRegistry.bytes === state.reasoning_registry.source.bytes,
  "reference reasoning registry physical identity changed before parse", 4);
  const sourceRegistry = pinnedRegistry.input;
  validateHumanDesignReasoningRegistry(sourceRegistry);
  requireValue(canonicalDigest(sourceRegistry) === state.reasoning_registry.registry_digest &&
    state.reasoning_registry.authority_scope === "non-authoritative-research-aid" &&
    state.reasoning_registry.registry_version ===
      sourceRegistry.human_design_reasoning_registry_version &&
    state.reasoning_registry.source_pixels_included === false &&
    canonicalDigest(sourceRegistry.lenses) === canonicalDigest(state.reasoning_registry.lenses) &&
    canonicalDigest(sourceRegistry.design_checks) ===
      canonicalDigest(state.reasoning_registry.design_checks) &&
    canonicalDigest(sourceRegistry.research_basis) ===
      canonicalDigest(state.reasoning_registry.research_basis),
  "reference reasoning registry state binding mismatch", 4);
}

export function validateReferenceBrief(input, { root = process.cwd(), verifyEvidence = true } = {}) {
  exact(input, new Set([
    "reference_brief_version", "project_id", "surface", "locales", "activation",
    "planning", "source", "coverage", "popularity_prior", "providers"
  ]), "reference brief");
  requireValue(input.reference_brief_version === 1, "reference_brief_version must be 1");
  safeId(input.project_id, "reference brief project_id");
  requireValue(VALID_SURFACES.has(input.surface), `unsupported reference surface: ${input.surface}`);
  uniqueStrings(input.locales, "reference brief locales");

  exact(input.activation, new Set([
    "mode", "owner_request_id", "request_excerpt", "authorized_at", "evidence"
  ]), "reference brief activation");
  requireValue(input.activation.mode === "explicit-owner-reference-research",
    "reference research requires explicit owner activation");
  safeId(input.activation.owner_request_id, "reference brief activation.owner_request_id");
  string(input.activation.request_excerpt, "reference brief activation.request_excerpt");
  timestamp(input.activation.authorized_at, "reference brief activation.authorized_at");

  exact(input.planning, new Set([
    "target_id", "product_frame", "sources", "required_gate_ids"
  ]), "reference brief planning");
  safeId(input.planning.target_id, "reference brief planning.target_id");
  validateProductFrame(input.planning.product_frame);
  uniqueStrings(input.planning.required_gate_ids, "reference brief planning.required_gate_ids");
  requireValue(Array.isArray(input.planning.sources) && input.planning.sources.length > 0,
    "reference brief requires at least one service-planning source");
  const planningIds = new Set();
  for (const [index, source] of input.planning.sources.entries()) {
    exact(source, new Set(["id", "kind", "path", "digest"]), `reference brief planning.sources[${index}]`);
    safeId(source.id, `reference brief planning.sources[${index}].id`);
    requireValue(!planningIds.has(source.id), `duplicate planning source id: ${source.id}`);
    planningIds.add(source.id);
    requireValue(source.kind === "service-planning-gate",
      "reference intelligence accepts only service-planning-gate planning authority");
    string(source.path, `reference brief planning.sources[${index}].path`);
    digest(source.digest, `reference brief planning.sources[${index}].digest`);
  }

  exact(input.source, new Set(["provider", "access_mode", "rights", "queries", "exports"]),
    "reference brief source");
  requireValue(input.source.provider === "uibowl", "reference source.provider must be uibowl");
  requireValue(["manual-export", "authorized-read-only-adapter"].includes(input.source.access_mode),
    "reference source.access_mode is invalid");
  exact(input.source.rights, new Set([
    "status", "evidence", "redistribution", "creator_pixel_access"
  ]), "reference brief source.rights");
  requireValue(["reference-only", "cleared"].includes(input.source.rights.status),
    "reference source rights must be reference-only or cleared");
  requireValue(input.source.rights.redistribution === false,
    "reference source redistribution must remain false");
  requireValue(input.source.rights.creator_pixel_access === false,
    "source pixels must not be exposed to downstream creators");
  requireValue(Array.isArray(input.source.queries) && input.source.queries.length > 0,
    "reference brief requires one or more bounded UI Bowl queries");
  const queryIds = new Set();
  for (const [index, query] of input.source.queries.entries()) {
    exact(query, new Set(["id", "kind", "term", "screen_family"]),
      `reference brief source.queries[${index}]`);
    safeId(query.id, `reference brief source.queries[${index}].id`);
    requireValue(!queryIds.has(query.id), `duplicate source query id: ${query.id}`);
    queryIds.add(query.id);
    requireValue(["pattern", "component", "app", "ocr"].includes(query.kind),
      `unsupported source query kind: ${query.kind}`);
    string(query.term, `reference brief source.queries[${index}].term`);
    if (query.screen_family !== undefined) string(query.screen_family,
      `reference brief source.queries[${index}].screen_family`);
  }
  requireValue(Array.isArray(input.source.exports),
    "reference brief source.exports must be an array");
  if (input.source.access_mode === "manual-export") {
    requireValue(input.source.exports.length > 0,
      "manual-export reference research requires digest-bound source.exports");
  } else {
    requireValue(input.source.exports.length === 0,
      "authorized read-only reference research cannot mix manual exports into network discovery");
  }
  const exportIds = new Set();
  for (const [index, sourceExport] of input.source.exports.entries()) {
    exact(sourceExport, new Set(["id", "kind", "path", "digest"]),
      `reference brief source.exports[${index}]`);
    safeId(sourceExport.id, `reference brief source.exports[${index}].id`);
    requireValue(!exportIds.has(sourceExport.id),
      `duplicate reference source export: ${sourceExport.id}`);
    exportIds.add(sourceExport.id);
    requireValue(sourceExport.kind === "uibowl-manual-export",
      `reference brief source.exports[${index}].kind must be uibowl-manual-export`);
    string(sourceExport.path, `reference brief source.exports[${index}].path`);
    digest(sourceExport.digest, `reference brief source.exports[${index}].digest`);
  }

  exact(input.coverage, new Set([
    "minimum_verified_references", "maximum_references", "required_component_families",
    "required_patterns", "required_grammar_dimensions", "sampling_policy"
  ]), "reference brief coverage");
  requireValue(Number.isInteger(input.coverage.minimum_verified_references) &&
    input.coverage.minimum_verified_references >= 3,
  "reference coverage requires at least three verified references");
  requireValue(Number.isInteger(input.coverage.maximum_references) &&
    input.coverage.maximum_references >= input.coverage.minimum_verified_references &&
    input.coverage.maximum_references <= 24,
  "reference maximum_references must be between the minimum and 24");
  uniqueStrings(input.coverage.required_component_families,
    "reference brief coverage.required_component_families");
  uniqueStrings(input.coverage.required_patterns, "reference brief coverage.required_patterns");
  uniqueStrings(input.coverage.required_grammar_dimensions,
    "reference brief coverage.required_grammar_dimensions", { allowed: GRAMMAR_DIMENSIONS });
  exact(input.coverage.sampling_policy, new Set([
    "minimum_distinct_products", "minimum_distinct_product_categories",
    "maximum_references_per_product", "maximum_references_per_ecosystem",
    "minimum_strong_hierarchy_references", "minimum_multi_state_families",
    "minimum_references_per_target_locale", "maximum_promotional_reference_ratio", "required_cohorts",
    "promotional_capture_policy"
  ]), "reference brief coverage.sampling_policy");
  const sampling = input.coverage.sampling_policy;
  for (const [field, minimum] of [
    ["minimum_distinct_products", 3],
    ["minimum_distinct_product_categories", 2],
    ["maximum_references_per_product", 1],
    ["maximum_references_per_ecosystem", 1],
    ["minimum_strong_hierarchy_references", 1],
    ["minimum_multi_state_families", 1],
    ["minimum_references_per_target_locale", 1]
  ]) {
    requireValue(Number.isInteger(sampling[field]) && sampling[field] >= minimum &&
      sampling[field] <= input.coverage.maximum_references,
    `reference sampling policy ${field} must be between ${minimum} and maximum_references`);
  }
  requireValue(sampling.minimum_distinct_products >=
    input.coverage.minimum_verified_references,
  "reference sampling must keep every minimum verified reference product-distinct");
  requireValue(sampling.minimum_distinct_product_categories <=
    sampling.minimum_distinct_products,
  "reference sampling category minimum cannot exceed its product minimum");
  requireValue(typeof sampling.maximum_promotional_reference_ratio === "number" &&
    sampling.maximum_promotional_reference_ratio >= 0 &&
    sampling.maximum_promotional_reference_ratio <= 0.2,
  "reference sampling promotional ratio must be between 0 and 0.2");
  uniqueStrings(sampling.required_cohorts,
    "reference brief coverage.sampling_policy.required_cohorts", {
      min: REQUIRED_SAMPLING_COHORTS.size,
      allowed: REQUIRED_SAMPLING_COHORTS
    });
  requireValue(sameStringSet(sampling.required_cohorts,
    [...REQUIRED_SAMPLING_COHORTS]),
  "reference sampling must include task-fit, cross-domain, and competent-baseline cohorts");
  requireValue(sampling.promotional_capture_policy === "weak-evidence-only",
    "promotional captures must remain weak evidence only");

  exact(input.popularity_prior, new Set([
    "role", "primary_sort", "signals", "cannot_affect"
  ]), "reference brief popularity_prior");
  requireValue(input.popularity_prior.role === "within-fit-band-ranking-only",
    "popularity may rank only within an equal product-fit band");
  requireValue(input.popularity_prior.primary_sort === "product-fit-band",
    "product-fit band must remain the primary ranking key");
  requireValue(Array.isArray(input.popularity_prior.signals) &&
    input.popularity_prior.signals.length > 0,
  "reference brief requires at least one popularity signal");
  const popularitySignalIds = new Set();
  for (const [index, signal] of input.popularity_prior.signals.entries()) {
    exact(signal, new Set([
      "id", "metric", "subject_kind", "weight", "scope", "category", "normalization"
    ]),
      `reference brief popularity_prior.signals[${index}]`);
    safeId(signal.id, `reference brief popularity_prior.signals[${index}].id`);
    requireValue(!popularitySignalIds.has(signal.id),
      `duplicate reference popularity signal id: ${signal.id}`);
    popularitySignalIds.add(signal.id);
    requireValue(["mau", "bookmark-count", "popular-rank", "curation-popularity"].includes(signal.metric),
      `unsupported popularity metric: ${signal.metric}`);
    requireValue(["product", "screen"].includes(signal.subject_kind) &&
      (signal.metric !== "mau" || signal.subject_kind === "product"),
    `reference brief popularity_prior.signals[${index}].subject_kind is invalid`);
    requireValue(typeof signal.weight === "number" && Number.isFinite(signal.weight) &&
      signal.weight > 0,
      `reference brief popularity_prior.signals[${index}].weight must be positive`);
    string(signal.scope, `reference brief popularity_prior.signals[${index}].scope`);
    string(signal.category, `reference brief popularity_prior.signals[${index}].category`);
    validatePopularityNormalization(
      signal.normalization,
      signal.metric,
      `reference brief popularity_prior.signals[${index}].normalization`
    );
  }
  const requiredCannotAffect = ["eligibility", "hard-gates", "owner-approval"];
  uniqueStrings(input.popularity_prior.cannot_affect,
    "reference brief popularity_prior.cannot_affect");
  requireValue(requiredCannotAffect.every((item) => input.popularity_prior.cannot_affect.includes(item)),
    "popularity prior cannot affect eligibility, hard gates, or owner approval");

  exact(input.providers, new Set(["discovery", "grammar_extractor", "critic"]),
    "reference brief providers");
  for (const key of ["discovery", "grammar_extractor", "critic"]) {
    assertInternalIdentityIsNotOrchestrator(input.providers[key], {
      label: `reference brief providers.${key}`
    });
    safeId(input.providers[key], `reference brief providers.${key}`);
  }
  requireValue(canonicalIdentitySet(Object.values(input.providers)).size === 3,
    "reference discovery, grammar extraction, and critic providers must be distinct");

  if (verifyEvidence) {
    resolveEvidence(root, input.activation.evidence, "reference owner activation evidence");
    resolveEvidence(root, input.source.rights.evidence, "reference rights evidence");
    for (const source of input.planning.sources) {
      const resolved = resolveEvidence(root, source, `service-planning source ${source.id}`, { json: true });
      const gate = resolved.input;
      requireValue(gate.planning_gate_version === 1,
        `service-planning source ${source.id} is not a V1 planning gate`, 4);
      requireValue(gate.project_id === input.project_id && gate.surface === input.surface,
        `service-planning source ${source.id} conflicts with project or surface`, 4);
      for (const gateId of input.planning.required_gate_ids) {
        requireValue(["passed", "approved", "locked"].includes(gate.gates?.[gateId]?.status),
          `service-planning source ${source.id} has not cleared required gate ${gateId}`, 4);
      }
    }
    loadManualExportAuthorities(input, root);
  }
  return input;
}

function authoritySources(brief, root) {
  const manual = loadManualExportAuthorities(brief, root);
  return {
    activation: resolveEvidence(root, brief.activation.evidence,
      "reference owner activation evidence").snapshot,
    rights: resolveEvidence(root, brief.source.rights.evidence,
      "reference rights evidence").snapshot,
    planning: brief.planning.sources.map((source) => ({
      id: source.id,
      ...resolveEvidence(root, source, `service-planning source ${source.id}`, { json: true }).snapshot
    })),
    exports: manual.manifests.map((source) => ({
      id: source.id,
      ...source.snapshot
    })),
    export_evidence: manual.evidence
  };
}

function makePacket(state, {
  packetId, stageId, providerId, role, capabilities, strength, permissions,
  forbiddenPermissions = [], task
}) {
  const packet = {
    reference_packet_version: 1,
    packet_id: packetId,
    run_id: state.run_id,
    journey_identity: structuredClone(state.journey_identity),
    participant: createParticipant({ providerId, stageId, role }),
    stage_id: stageId,
    provider: { id: providerId, kind: "external", version: null },
    assigned_capabilities: [...capabilities],
    minimum_strength: strength,
    required_permissions: [...permissions],
    forbidden_permissions: [...forbiddenPermissions],
    evidence_contract: { required_viewports: [], required_checks: [] },
    reference_task: task
  };
  packet.packet_digest = canonicalDigest(packet);
  return packet;
}

function referencePacketAuthorityDigest(state) {
  return canonicalDigest({
    brief_source: state.brief_source,
    activation: state.authority_sources.activation,
    rights: state.authority_sources.rights,
    planning: state.authority_sources.planning,
    exports: state.authority_sources.exports,
    export_evidence: state.authority_sources.export_evidence,
    reasoning_registry_source: state.reasoning_registry.source
  });
}

function discoveryPacket(state) {
  return makePacket(state, {
    packetId: "reference-discovery",
    stageId: "reference-discovery",
    providerId: state.brief.providers.discovery,
    role: "researcher",
    capabilities: DISCOVERY_CAPABILITIES,
    strength: 3,
    permissions: ["artifact:read", "evidence:write",
      ...(state.brief.source.access_mode === "authorized-read-only-adapter" ? ["network:external"] : [])],
    forbiddenPermissions: state.brief.source.access_mode === "manual-export"
      ? ["network:external"] : [],
    task: {
      kind: "reference-discovery",
      project_id: state.brief.project_id,
      surface: state.brief.surface,
      locales: [...state.brief.locales],
      brief_digest: state.brief_source.digest,
      authority_graph_digest: referencePacketAuthorityDigest(state),
      product_frame: structuredClone(state.brief.planning.product_frame),
      source: structuredClone(state.brief.source),
      coverage: structuredClone(state.brief.coverage),
      popularity_prior: structuredClone(state.brief.popularity_prior),
      human_design_reasoning: reasoningTaskContract(state),
      maximum_references: state.brief.coverage.maximum_references,
      rule: "collect source-linked observations with screen role, evidence strength, salience, sampling cohort, and snapshot-specific popularity provenance; do not infer visual authority"
    }
  });
}

function grammarPacket(state, discovery) {
  return makePacket(state, {
    packetId: "reference-grammar",
    stageId: "reference-grammar",
    providerId: state.brief.providers.grammar_extractor,
    role: "researcher",
    capabilities: GRAMMAR_CAPABILITIES,
    strength: 3,
    permissions: ["artifact:read", "evidence:write"],
    forbiddenPermissions: ["network:external"],
    task: {
      kind: "reference-grammar",
      project_id: state.brief.project_id,
      surface: state.brief.surface,
      locales: [...state.brief.locales],
      brief_digest: state.brief_source.digest,
      authority_graph_digest: referencePacketAuthorityDigest(state),
      subject_result_digest: discovery.result_digest,
      product_frame: structuredClone(state.brief.planning.product_frame),
      required_dimensions: [...state.brief.coverage.required_grammar_dimensions],
      human_design_reasoning: reasoningTaskContract(state),
      rule: "separate observation from inference and trace each principle through visible priority, supported user decision, likely constraint, flattening consequence, applicability, and tradeoff"
    }
  });
}

function reviewPacket(state, discovery, grammar) {
  return makePacket(state, {
    packetId: "reference-review",
    stageId: "reference-review",
    providerId: state.brief.providers.critic,
    role: "critic",
    capabilities: REVIEW_CAPABILITIES,
    strength: 4,
    permissions: ["artifact:read", "evidence:write"],
    forbiddenPermissions: ["network:external"],
    task: {
      kind: "reference-review",
      project_id: state.brief.project_id,
      surface: state.brief.surface,
      locales: [...state.brief.locales],
      brief_digest: state.brief_source.digest,
      authority_graph_digest: referencePacketAuthorityDigest(state),
      discovery_result_digest: discovery.result_digest,
      grammar_result_digest: grammar.result_digest,
      product_frame: structuredClone(state.brief.planning.product_frame),
      coverage: structuredClone(state.brief.coverage),
      popularity_rule: structuredClone(state.brief.popularity_prior),
      human_design_reasoning: reasoningTaskContract(state),
      rule: "verify provenance, sampling diversity, causal hierarchy reasoning, applicability, tradeoffs, promotional-evidence limits, and anti-copy safety without selecting for the owner"
    }
  });
}

function expectedReferencePacket(state, packetId) {
  if (packetId === "reference-discovery") return discoveryPacket(state);
  if (packetId === "reference-grammar") {
    const discovery = resultFor(state, "reference-discovery");
    requireValue(discovery,
      "reference grammar packet cannot precede its discovery result", 4);
    return grammarPacket(state, discovery);
  }
  if (packetId === "reference-review") {
    const discovery = resultFor(state, "reference-discovery");
    const grammar = resultFor(state, "reference-grammar");
    requireValue(discovery && grammar,
      "reference review packet cannot precede its discovery and grammar results", 4);
    return reviewPacket(state, discovery, grammar);
  }
  throw new RouterError(`unsupported persisted reference packet: ${packetId}`, 4);
}

function verifyReferencePacketStateAuthority(state, packet) {
  const task = packet.reference_task;
  requireValue(task?.brief_digest === state.brief_source.digest &&
    task.authority_graph_digest === referencePacketAuthorityDigest(state) &&
    task.project_id === state.brief.project_id &&
    task.surface === state.brief.surface &&
    canonicalDigest(task.locales) === canonicalDigest(state.brief.locales) &&
    canonicalDigest(task.product_frame) ===
      canonicalDigest(state.brief.planning.product_frame),
  `reference packet ${packet.packet_id} conflicts with its immutable brief authority`, 4);
  const expected = expectedReferencePacket(state, packet.packet_id);
  requireValue(canonicalDigest(packet) === canonicalDigest(expected),
    `reference packet ${packet.packet_id} conflicts with its canonical state contract`, 4);
}

function packetFile(state, packetId) {
  return path.join(state.state_directory, "packets", `${packetId}.json`);
}

function writeState(state, lease, { inFlight = false, faultInjector = null } = {}) {
  state.updated_at = nowIso();
  sealState(state);
  prepareStateLeaseWrite(lease, state.state_digest);
  writeJsonAtomic(state.state_path, state, {
    label: "reference intelligence state",
    faultInjector: faultInjector
      ? (point, details) => faultInjector(`state-${point}`, details)
      : null
  });
  faultInjector?.("after-state-write-before-lease-commit", {
    state_path: state.state_path,
    state_digest: state.state_digest,
    in_flight: state.in_flight,
    attempt_count: state.attempts.length,
    result_count: state.results.length
  });
  commitStateLeaseWrite(lease, state, { inFlight });
  return state;
}

function addPacket(state, lease, packet, faultInjector = null) {
  if (state.packets.some((item) => item.packet_id === packet.packet_id)) return;
  verifyReferencePacketStateAuthority(state, packet);
  const target = packetFile(state, packet.packet_id);
  const packetSource = writePinnedJson(
    target,
    packet,
    `reference packet ${packet.packet_id}`,
    state.state_directory
  );
  state.packets.push(packet);
  state.packet_files[packet.packet_id] = packetSource;
  writeState(state, lease, { faultInjector });
}

function resultFor(state, packetId) {
  return state.results.find((item) => item.packet_id === packetId) || null;
}

function lastAttempt(state, packetId) {
  return [...state.attempts].reverse().find((item) => item.packet_id === packetId) || null;
}

function attemptNumber(state, packetId) {
  return state.attempts.filter((item) => item.packet_id === packetId).length + 1;
}

function executionAuthorityFile(state, packet, attempt) {
  return path.join(
    state.state_directory,
    "authority",
    "execution",
    `${packet.packet_id}-attempt-${attempt}.json`
  );
}

function publicExecutionEntrypoint(entrypoint) {
  if (!entrypoint) return null;
  const { graph_digest: _graphDigest, ...snapshot } = entrypoint;
  return publicSnapshot({ ...snapshot, path: snapshot.resolved_path });
}

function captureExecutionAuthority(state, packet, manifest, declaration, attempt) {
  requireValue(manifest?.manifest_path && declaration,
    "ready reference execution requires a loaded host authority", 4);
  const hostPinned = readPinnedJson(
    manifest.manifest_path,
    `reference execution host manifest ${packet.packet_id}`
  );
  const hostManifest = pinnedSnapshot(hostPinned, state.state_directory);
  requireValue(hostManifest.digest === manifest.manifest_digest &&
    hostManifest.physical_identity_digest === manifest.manifest_physical_identity_digest,
  "reference host manifest changed before execution authority capture", 4);
  const rawDeclaration = hostPinned.input.providers?.[packet.provider.id];
  requireValue(rawDeclaration,
    `reference host manifest lost provider ${packet.provider.id}`, 4);

  let adapterEntrypoint = null;
  if (declaration.entrypoint) {
    const entrypointPinned = readFilePinned(declaration.entrypoint, {
      label: `reference execution entrypoint ${packet.provider.id}`,
      requireCallerOwned: false,
      requireSingleLink: false
    });
    requireValue(entrypointPinned.digest === declaration.entrypoint_authority?.digest &&
      entrypointPinned.physical_identity_digest ===
        declaration.entrypoint_authority?.physical_identity_digest,
    `reference adapter entrypoint changed before execution authority capture: ${packet.provider.id}`,
    4);
    adapterEntrypoint = {
      ...pinnedSnapshot(entrypointPinned, state.state_directory),
      graph_digest: declaration.entrypoint_authority.graph_digest
    };
  }

  const body = {
    reference_execution_authority_version: 1,
    host_manifest: hostManifest,
    provider: {
      provider_id: packet.provider.id,
      declaration_digest: canonicalDigest(rawDeclaration),
      adapter: declaration.adapter,
      strength: declaration.strength,
      capabilities: structuredClone(declaration.capabilities),
      permissions: structuredClone(declaration.permissions),
      timeout_ms: declaration.timeout_ms
    },
    adapter_entrypoint: adapterEntrypoint
  };
  const authority = { ...body, authority_digest: canonicalDigest(body) };
  const source = writePinnedJson(
    executionAuthorityFile(state, packet, attempt),
    authority,
    `reference execution authority ${packet.packet_id} attempt ${attempt}`,
    state.state_directory
  );
  return { authority, source };
}

function verifyAttemptExecutionAuthority(state, packet, attempt) {
  const authority = attempt.execution_authority;
  const authoritySource = attempt.execution_authority_source;
  object(authority, `reference attempt ${packet.packet_id} execution_authority`);
  exact(authority, new Set([
    "reference_execution_authority_version", "host_manifest", "provider",
    "adapter_entrypoint", "authority_digest"
  ]), `reference attempt ${packet.packet_id} execution_authority`);
  requireValue(authority.reference_execution_authority_version === 1,
    `reference attempt ${packet.packet_id} execution authority version is invalid`, 4);
  object(authority.provider,
    `reference attempt ${packet.packet_id} execution_authority.provider`);
  exact(authority.provider, new Set([
    "provider_id", "declaration_digest", "adapter", "strength", "capabilities",
    "permissions", "timeout_ms"
  ]), `reference attempt ${packet.packet_id} execution_authority.provider`);
  const body = { ...authority };
  delete body.authority_digest;
  requireValue(canonicalDigest(body) === authority.authority_digest,
    `reference attempt ${packet.packet_id} execution authority digest mismatch`, 4);

  exact(authoritySource, new Set([
    "path", "resolved_path", "kind", "bytes", "digest", "physical_identity_digest"
  ]), `reference attempt ${packet.packet_id} execution authority source`);
  verifyBoundSnapshot(authoritySource,
    `reference attempt ${packet.packet_id} execution authority source`);
  const sourceAuthority = readPinnedJson(
    authoritySource.resolved_path,
    `reference attempt ${packet.packet_id} execution authority source`
  ).input;
  requireValue(canonicalDigest(sourceAuthority) === canonicalDigest(authority),
    `reference attempt ${packet.packet_id} execution authority conflicts with its immutable source`,
    4);

  exact(authority.host_manifest, new Set([
    "path", "resolved_path", "kind", "bytes", "digest", "physical_identity_digest"
  ]), `reference attempt ${packet.packet_id} host manifest`);
  verifyBoundSnapshot(authority.host_manifest,
    `reference attempt ${packet.packet_id} host manifest`);
  const rawHost = readPinnedJson(
    authority.host_manifest.resolved_path,
    `reference attempt ${packet.packet_id} host manifest`
  ).input;
  const rawDeclaration = rawHost.providers?.[packet.provider.id];
  const loadedHost = loadHostManifest(authority.host_manifest.resolved_path);
  const declaration = loadedHost.providers?.[packet.provider.id];
  requireValue(declaration && rawDeclaration &&
    loadedHost.manifest_digest === authority.host_manifest.digest &&
    loadedHost.manifest_physical_identity_digest ===
      authority.host_manifest.physical_identity_digest &&
    authority.provider.provider_id === packet.provider.id &&
    authority.provider.declaration_digest === canonicalDigest(rawDeclaration) &&
    authority.provider.adapter === declaration.adapter &&
    authority.provider.strength === declaration.strength &&
    sameStringSet(authority.provider.capabilities, declaration.capabilities) &&
    sameStringSet(authority.provider.permissions, declaration.permissions) &&
    authority.provider.timeout_ms === declaration.timeout_ms,
  `reference attempt ${packet.packet_id} execution authority conflicts with its host manifest`, 4);

  if (declaration.entrypoint) {
    object(authority.adapter_entrypoint,
      `reference attempt ${packet.packet_id} adapter entrypoint authority`);
    exact(authority.adapter_entrypoint, new Set([
      "path", "resolved_path", "kind", "bytes", "digest",
      "physical_identity_digest", "graph_digest"
    ]), `reference attempt ${packet.packet_id} adapter entrypoint authority`);
    verifyBoundSnapshot(authority.adapter_entrypoint,
      `reference attempt ${packet.packet_id} adapter entrypoint`);
    requireValue(
      path.resolve(authority.adapter_entrypoint.resolved_path) ===
        path.resolve(declaration.entrypoint) &&
      authority.adapter_entrypoint.digest === declaration.entrypoint_authority.digest &&
      authority.adapter_entrypoint.physical_identity_digest ===
        declaration.entrypoint_authority.physical_identity_digest &&
      authority.adapter_entrypoint.graph_digest === declaration.entrypoint_authority.graph_digest,
    `reference attempt ${packet.packet_id} adapter entrypoint conflicts with its host manifest`, 4);
  } else {
    requireValue(authority.adapter_entrypoint === null,
      `reference attempt ${packet.packet_id} has unexpected adapter entrypoint authority`, 4);
  }

  requireValue(authority.provider.strength >= packet.minimum_strength &&
    packet.assigned_capabilities.every((capability) =>
      authority.provider.capabilities.includes(capability)) &&
    packet.required_permissions.every((permission) =>
      authority.provider.permissions.includes(permission)) &&
    !authority.provider.permissions.some((permission) =>
      packet.forbidden_permissions.includes(permission)),
  `reference attempt ${packet.packet_id} does not satisfy its packet authority`, 4);

  const expectedAdapterEntrypoint = publicExecutionEntrypoint(authority.adapter_entrypoint);
  requireValue(attempt.adapter === authority.provider.adapter &&
    attempt.host_manifest_digest === authority.host_manifest.digest &&
    attempt.strength === authority.provider.strength &&
    sameStringSet(attempt.capabilities, authority.provider.capabilities) &&
    sameStringSet(attempt.permission_scopes, authority.provider.permissions) &&
    canonicalDigest(attempt.adapter_entrypoint) === canonicalDigest(expectedAdapterEntrypoint),
  `reference attempt ${packet.packet_id} execution fields conflict with immutable authority`, 4);
}

export function referenceSourceRecipientExecutionLineage(state) {
  object(state, "reference source-recipient execution lineage state");
  requireValue(Array.isArray(state.packets) && Array.isArray(state.attempts),
    "reference source-recipient execution lineage requires packet and attempt ledgers", 4);
  const packets = new Map(state.packets.map((packet) => [packet.packet_id, packet]));
  const attempts = [];
  const attemptKeys = new Set();
  for (const attempt of state.attempts) {
    if (!attempt.execution_authority && !attempt.execution_authority_source) continue;
    requireValue(attempt.execution_authority && attempt.execution_authority_source,
      `reference source recipient ${attempt.packet_id || "unknown"} has partial execution authority`,
      4);
    const packet = packets.get(attempt.packet_id);
    requireValue(packet && Number.isInteger(attempt.attempt) && attempt.attempt >= 1,
      `reference source recipient has invalid attempt lineage: ${attempt.packet_id || "unknown"}`,
      4);
    const attemptKey = `${attempt.packet_id}\u0000${attempt.attempt}`;
    requireValue(!attemptKeys.has(attemptKey),
      `reference source recipient attempt is duplicated: ${attempt.packet_id}/${attempt.attempt}`,
      4);
    attemptKeys.add(attemptKey);
    requireValue(attempt.execution_status === "ran" ||
      attempt.execution_status === "manual_pending" ||
      attempt.execution_status.startsWith("blocked_"),
    `reference source recipient attempt has a non-execution status: ${attempt.execution_status}`,
    4);
    verifyAttemptExecutionAuthority(state, packet, attempt);
    const authority = attempt.execution_authority;
    attempts.push({
      packet_id: attempt.packet_id,
      attempt: attempt.attempt,
      execution_status: attempt.execution_status,
      provider_id: authority.provider.provider_id,
      adapter: authority.provider.adapter,
      authority_digest: authority.authority_digest,
      provider_declaration_digest: authority.provider.declaration_digest,
      adapter_entrypoint: authority.adapter_entrypoint === null
        ? null
        : {
            digest: authority.adapter_entrypoint.digest,
            physical_identity_digest:
              authority.adapter_entrypoint.physical_identity_digest,
            graph_digest: authority.adapter_entrypoint.graph_digest
          }
    });
  }
  attempts.sort((left, right) => {
    if (left.packet_id !== right.packet_id) {
      return left.packet_id < right.packet_id ? -1 : 1;
    }
    return left.attempt - right.attempt;
  });
  const body = {
    reference_source_recipient_execution_lineage_version: 1,
    attempts
  };
  return { ...body, lineage_digest: canonicalDigest(body) };
}

function validateEvidence(result) {
  requireValue(Array.isArray(result.evidence) && result.evidence.length > 0,
    "reference result requires evidence", 4);
  const evidenceById = new Map();
  for (const [index, evidence] of result.evidence.entries()) {
    const discoveryFields = result.kind === "reference-discovery"
      ? [
          "reference_id", "product_record_id", "screen_record_id", "frame_ids",
          "subject_bindings"
        ]
      : [];
    exact(evidence, new Set(["evidence_id", "kind", "path", ...discoveryFields]),
      `reference result evidence[${index}]`);
    safeId(evidence.evidence_id, `reference result evidence[${index}].evidence_id`);
    requireValue(!evidenceById.has(evidence.evidence_id),
      `duplicate reference evidence id: ${evidence.evidence_id}`, 4);
    evidenceById.set(evidence.evidence_id, evidence);
    requireValue(["source-capture", "source-metadata", "analysis-report", "review-report"].includes(evidence.kind),
      `unsupported reference evidence kind: ${evidence.kind}`, 4);
    string(evidence.path, `reference result evidence[${index}].path`);
    if (result.kind === "reference-discovery") {
      safeId(evidence.reference_id,
        `reference result evidence[${index}].reference_id`);
      string(evidence.product_record_id,
        `reference result evidence[${index}].product_record_id`);
      string(evidence.screen_record_id,
        `reference result evidence[${index}].screen_record_id`);
      uniqueStrings(evidence.frame_ids,
        `reference result evidence[${index}].frame_ids`);
      requireValue(Array.isArray(evidence.subject_bindings) &&
        evidence.subject_bindings.length > 0,
      `reference result evidence[${index}].subject_bindings must be non-empty`, 4);
      const subjectBindings = new Set();
      for (const [bindingIndex, binding] of evidence.subject_bindings.entries()) {
        const bindingLabel =
          `reference result evidence[${index}].subject_bindings[${bindingIndex}]`;
        exact(binding, new Set(["subject_kind", "subject_record_id"]), bindingLabel);
        requireValue(["product", "screen"].includes(binding.subject_kind),
          `${bindingLabel}.subject_kind is invalid`, 4);
        string(binding.subject_record_id, `${bindingLabel}.subject_record_id`);
        requireValue(binding.subject_record_id ===
          (binding.subject_kind === "product"
            ? evidence.product_record_id : evidence.screen_record_id),
        `${bindingLabel} conflicts with the evidence record binding`, 4);
        const bindingKey = `${binding.subject_kind}\u0000${binding.subject_record_id}`;
        requireValue(!subjectBindings.has(bindingKey),
          `${bindingLabel} is duplicated`, 4);
        subjectBindings.add(bindingKey);
      }
      requireValue(subjectBindings.has(`screen\u0000${evidence.screen_record_id}`),
        `reference result evidence[${index}] must bind its screen subject`, 4);
    }
  }
  const expectedKinds = {
    "reference-discovery": new Set(["source-capture", "source-metadata"]),
    "reference-grammar": new Set(["analysis-report"]),
    "reference-review": new Set(["review-report"])
  }[result.kind];
  requireValue([...evidenceById.values()].every((item) => expectedKinds.has(item.kind)),
    `${result.kind} returned evidence from another stage`, 4);
  return evidenceById;
}

function validateActor(result) {
  exact(result.actor, new Set(["actor_id", "kind"]), "reference result actor");
  string(result.actor.actor_id, "reference result actor.actor_id");
  assertInternalIdentityIsNotOrchestrator(result.actor.actor_id, {
    label: "reference result actor.actor_id"
  });
  requireValue(["agent", "skill", "human"].includes(result.actor.kind),
    "reference result actor.kind is invalid", 4);
}

function evidenceHasSubjectBinding(evidence, subjectKind, subjectRecordId) {
  return evidence.subject_bindings.some((binding) =>
    binding.subject_kind === subjectKind && binding.subject_record_id === subjectRecordId);
}

function validateBaseResult(state, packet, input) {
  object(input, "reference result");
  requireValue(input.reference_result_version === 1, "reference_result_version must be 1", 4);
  requireValue(REFERENCE_RESULT_KINDS.has(input.kind), `unsupported reference result kind: ${input.kind}`, 4);
  requireValue(input.kind === packet.reference_task.kind,
    `reference result kind conflicts with packet ${packet.packet_id}`, 4);
  requireValue(input.packet_id === packet.packet_id, "reference result packet_id mismatch", 4);
  requireValue(input.provider_id === packet.provider.id, "reference result provider_id mismatch", 4);
  requireValue(input.packet_digest === packet.packet_digest, "reference result packet digest mismatch", 4);
  requireValue(input.status === "completed", "reference result status must be completed", 4);
  const common = [
    "reference_result_version", "kind", "packet_id", "provider_id", "actor",
    "status", "packet_digest", "evidence"
  ];
  const kindFields = {
    "reference-discovery": ["references"],
    "reference-grammar": ["subject_result_digest", "references"],
    "reference-review": ["discovery_result_digest", "grammar_result_digest", "dispositions"]
  };
  exact(input, new Set([...common, ...kindFields[input.kind]]), "reference result");
  validateActor(input);
  const evidenceIds = validateEvidence(input);
  return { result: structuredClone(input), evidenceIds };
}

function validateSourceUri(value) {
  let uri;
  try {
    uri = new URL(value);
  } catch {
    throw new RouterError(`reference source URI is invalid: ${value}`, 4);
  }
  requireValue(uri.protocol === "https:" &&
    (uri.hostname === "uibowl.io" || uri.hostname.endsWith(".uibowl.io")),
  `reference source URI must be an HTTPS UI Bowl URL: ${value}`, 4);
}

function validateDiscovery(state, result, evidenceIds) {
  requireValue(Array.isArray(result.references) && result.references.length >= 1 &&
    result.references.length <= state.brief.coverage.maximum_references,
  `reference discovery must return 1-${state.brief.coverage.maximum_references} references`, 4);
  const ids = new Set();
  const sourceUris = new Set();
  const screenRecordIds = new Set();
  const sourceBindings = new Map();
  const frameBindings = new Map();
  const usedEvidenceIds = new Set();
  const manualExportIndex = readBoundManualExports(state);
  const manualRecords = new Map();
  for (const [index, reference] of result.references.entries()) {
    exact(reference, new Set([
      "reference_id", "source", "app_name", "product_category", "screen_family",
      "platform", "environment_of_use", "business_model", "session_shape", "locale",
      "sampled_because", "family", "screen_role", "evidence_strength", "sampling",
      "component_families", "patterns", "observed", "popularity", "rights"
    ]), `reference discovery references[${index}]`);
    safeId(reference.reference_id, `reference discovery references[${index}].reference_id`);
    requireValue(!ids.has(reference.reference_id),
      `duplicate reference id: ${reference.reference_id}`, 4);
    ids.add(reference.reference_id);
    exact(reference.source, new Set([
      "provider", "uri", "record_id", "product_record_id", "screen_record_id", "captured_at"
    ]),
      `reference ${reference.reference_id}.source`);
    requireValue(reference.source.provider === "uibowl", "discovered source provider must be uibowl", 4);
    validateSourceUri(reference.source.uri);
    string(reference.source.record_id, `reference ${reference.reference_id}.source.record_id`);
    string(reference.source.product_record_id,
      `reference ${reference.reference_id}.source.product_record_id`);
    string(reference.source.screen_record_id,
      `reference ${reference.reference_id}.source.screen_record_id`);
    requireValue(reference.source.record_id === reference.source.screen_record_id,
      `reference ${reference.reference_id} legacy record_id must equal screen_record_id`, 4);
    const normalizedUri = new URL(reference.source.uri).href;
    const normalizedScreenRecord = reference.source.screen_record_id.trim().toLocaleLowerCase("en");
    requireValue(!sourceUris.has(normalizedUri) && !screenRecordIds.has(normalizedScreenRecord),
      `reference ${reference.reference_id} repackages a duplicate UI Bowl screen`, 4);
    sourceUris.add(normalizedUri);
    screenRecordIds.add(normalizedScreenRecord);
    timestamp(reference.source.captured_at, `reference ${reference.reference_id}.source.captured_at`);
    if (manualExportIndex) {
      const manualRecord = manualExportIndex.records_by_screen.get(normalizedScreenRecord);
      requireValue(manualRecord &&
        manualRecord.product_record_id === reference.source.product_record_id &&
        manualRecord.normalized_uri === normalizedUri &&
        manualRecord.captured_at === reference.source.captured_at,
      `reference ${reference.reference_id} is not a member of the digest-bound manual export`, 4);
      manualRecords.set(reference.reference_id, manualRecord);
    }
    for (const field of ["app_name", "product_category", "screen_family"]) {
      string(reference[field], `reference ${reference.reference_id}.${field}`);
    }
    requireValue(["mobile", "desktop", "responsive"].includes(reference.platform),
      `reference ${reference.reference_id} platform is invalid`, 4);
    for (const field of ["environment_of_use", "business_model", "locale", "sampled_because"]) {
      string(reference[field], `reference ${reference.reference_id}.${field}`);
    }
    requireValue([
      "one-shot", "repeated", "interrupted", "multi-session", "exploratory"
    ].includes(reference.session_shape),
    `reference ${reference.reference_id} session_shape is invalid`, 4);
    exact(reference.family, new Set([
      "family_id", "frame_count", "core_task_frame_count", "state_frame_count",
      "promotional_frame_count", "frames"
    ]), `reference ${reference.reference_id}.family`);
    safeId(reference.family.family_id,
      `reference ${reference.reference_id}.family.family_id`);
    for (const field of [
      "frame_count", "core_task_frame_count", "state_frame_count", "promotional_frame_count"
    ]) {
      requireValue(Number.isInteger(reference.family[field]) && reference.family[field] >= 0,
        `reference ${reference.reference_id}.family.${field} must be non-negative`, 4);
    }
    requireValue(reference.family.frame_count >= 1 &&
      reference.family.core_task_frame_count <= reference.family.frame_count &&
      reference.family.state_frame_count <= reference.family.frame_count &&
      reference.family.promotional_frame_count <= reference.family.frame_count,
    `reference ${reference.reference_id} family frame counts are inconsistent`, 4);
    requireValue(Array.isArray(reference.family.frames) &&
      reference.family.frames.length === reference.family.frame_count,
    `reference ${reference.reference_id} family must enumerate every frame`, 4);
    const frames = new Map();
    for (const frame of reference.family.frames) {
      exact(frame, new Set(["frame_id", "role", "core_task", "state"]),
        `reference ${reference.reference_id} family frame`);
      safeId(frame.frame_id, `reference ${reference.reference_id} family frame_id`);
      requireValue(!frames.has(frame.frame_id),
        `reference ${reference.reference_id} repeats family frame ${frame.frame_id}`, 4);
      requireValue(SCREEN_ROLES.has(frame.role),
        `reference ${reference.reference_id} family frame role is invalid`, 4);
      requireValue(typeof frame.core_task === "boolean" && typeof frame.state === "boolean",
        `reference ${reference.reference_id} family frame flags must be boolean`, 4);
      frames.set(frame.frame_id, frame);
    }
    requireValue([...frames.values()].filter((item) => item.core_task).length ===
      reference.family.core_task_frame_count &&
      [...frames.values()].filter((item) => item.state).length ===
        reference.family.state_frame_count &&
      [...frames.values()].filter((item) => item.role === "promotional").length ===
        reference.family.promotional_frame_count,
    `reference ${reference.reference_id} family frame counts do not match its frame manifest`, 4);
    if (manualExportIndex) {
      const manualRecord = manualRecords.get(reference.reference_id);
      requireValue([...frames.values()].every((frame) => {
        const exportedFrame = manualRecord.frames_by_id.get(frame.frame_id);
        return exportedFrame && canonicalDigest(exportedFrame) === canonicalDigest(frame);
      }), `reference ${reference.reference_id} contains a frame outside its manual export`, 4);
    }
    sourceBindings.set(reference.reference_id, {
      product_record_id: reference.source.product_record_id,
      screen_record_id: reference.source.screen_record_id
    });
    frameBindings.set(reference.reference_id, frames);
    requireValue(SCREEN_ROLES.has(reference.screen_role),
      `reference ${reference.reference_id} screen_role is invalid`, 4);
    requireValue([...frames.values()].some((item) => item.role === reference.screen_role),
      `reference ${reference.reference_id} screen_role is absent from its family`, 4);
    requireValue(reference.family.promotional_frame_count !== reference.family.frame_count ||
      reference.screen_role === "promotional",
    `all-promotional reference ${reference.reference_id} must declare promotional screen_role`, 4);
    requireValue(EVIDENCE_STRENGTHS.has(reference.evidence_strength),
      `reference ${reference.reference_id} evidence_strength is invalid`, 4);
    if (reference.screen_role === "promotional") {
      requireValue(reference.evidence_strength === "weak",
        `promotional reference ${reference.reference_id} must remain weak evidence`, 4);
    }
    if (reference.family.frame_count < 2 || reference.family.core_task_frame_count < 1) {
      requireValue(reference.evidence_strength === "weak",
        `single-frame or no-task family ${reference.reference_id} must remain weak evidence`, 4);
    }
    exact(reference.sampling, new Set(["ecosystem_id", "cohorts"]),
      `reference ${reference.reference_id}.sampling`);
    safeId(reference.sampling.ecosystem_id,
      `reference ${reference.reference_id}.sampling.ecosystem_id`);
    uniqueStrings(reference.sampling.cohorts,
      `reference ${reference.reference_id}.sampling.cohorts`, {
        allowed: SAMPLING_COHORTS
      });
    uniqueStrings(reference.component_families,
      `reference ${reference.reference_id}.component_families`);
    uniqueStrings(reference.patterns, `reference ${reference.reference_id}.patterns`);
    requireValue(Array.isArray(reference.observed) && reference.observed.length > 0,
      `reference ${reference.reference_id} requires observations`, 4);
    const observationIds = new Set();
    for (const observation of reference.observed) {
      exact(observation, new Set([
        "observation_id", "frame_id", "frame_role", "kind", "priority", "statement", "evidence_ids"
      ]),
        `reference ${reference.reference_id} observation`);
      safeId(observation.observation_id, "reference observation_id");
      requireValue(!observationIds.has(observation.observation_id),
        `duplicate observation id: ${observation.observation_id}`, 4);
      observationIds.add(observation.observation_id);
      safeId(observation.frame_id, "reference observation frame_id");
      requireValue(frames.has(observation.frame_id) &&
        observation.frame_role === frames.get(observation.frame_id).role,
      `reference observation ${observation.observation_id} has an invalid frame binding`, 4);
      requireValue(["structure", "hierarchy", "component", "navigation", "type", "color", "state"].includes(observation.kind),
        `unsupported observation kind: ${observation.kind}`, 4);
      requireValue(["primary", "secondary", "supporting", "ambient"].includes(observation.priority),
        `reference observation ${observation.observation_id} priority is invalid`, 4);
      string(observation.statement, "reference observation statement");
      uniqueStrings(observation.evidence_ids, "reference observation evidence_ids");
      requireValue(observation.evidence_ids.every((id) => evidenceIds.has(id)),
        `reference observation ${observation.observation_id} cites unknown evidence`, 4);
      requireValue(observation.evidence_ids.every((id) =>
        ["source-capture", "source-metadata"].includes(evidenceIds.get(id).kind) &&
        evidenceIds.get(id).reference_id === reference.reference_id &&
        evidenceIds.get(id).product_record_id === reference.source.product_record_id &&
        evidenceIds.get(id).screen_record_id === reference.source.screen_record_id &&
        evidenceHasSubjectBinding(
          evidenceIds.get(id), "screen", reference.source.screen_record_id
        ) &&
        evidenceIds.get(id).frame_ids.includes(observation.frame_id)),
      `reference observation ${observation.observation_id} lacks frame-bound source evidence`, 4);
      observation.evidence_ids.forEach((id) => usedEvidenceIds.add(id));
    }
    exact(reference.popularity, new Set(["status", "signals", "conflicts"]),
      `reference ${reference.reference_id}.popularity`);
    requireValue(["verified-snapshot", "conflicted"].includes(reference.popularity.status),
      `reference ${reference.reference_id} popularity status is invalid`, 4);
    requireValue(Array.isArray(reference.popularity.conflicts),
      `reference ${reference.reference_id} popularity conflicts must be an array`, 4);
    if (reference.popularity.status === "verified-snapshot") {
      requireValue(reference.popularity.conflicts.length === 0,
        `reference ${reference.reference_id} verified popularity cannot retain conflicts`, 4);
    } else {
      requireValue(reference.popularity.conflicts.length > 0,
        `reference ${reference.reference_id} conflicted popularity requires conflict evidence`, 4);
    }
    requireValue(Array.isArray(reference.popularity.signals) &&
      reference.popularity.signals.length === state.brief.popularity_prior.signals.length,
    `reference ${reference.reference_id} must report every configured popularity signal`, 4);
    const expectedSignals = new Map(state.brief.popularity_prior.signals.map((item) => [item.id, item]));
    const seenSignals = new Set();
    for (const signal of reference.popularity.signals) {
      exact(signal, new Set([
        "id", "metric", "raw_value", "normalized_score", "scope", "category", "as_of",
        "subject_kind", "subject_record_id", "snapshot_at", "normalization", "evidence_ids"
      ]), `reference ${reference.reference_id} popularity signal`);
      const expected = expectedSignals.get(signal.id);
      requireValue(expected && popularityPolicyMatches(signal, expected),
        `reference ${reference.reference_id} popularity signal is not configured: ${signal.id}`, 4);
      requireValue(["product", "screen"].includes(signal.subject_kind) &&
        (signal.metric !== "mau" || signal.subject_kind === "product"),
      `reference ${reference.reference_id} popularity signal subject is not configured: ${signal.id}`, 4);
      requireValue(!seenSignals.has(signal.id),
        `reference ${reference.reference_id} repeats popularity signal: ${signal.id}`, 4);
      seenSignals.add(signal.id);
      requireValue(typeof signal.raw_value === "number" && Number.isFinite(signal.raw_value),
        `reference ${reference.reference_id} popularity raw_value must be numeric`, 4);
      requireValue(typeof signal.normalized_score === "number" &&
        signal.normalized_score >= 0 && signal.normalized_score <= 100,
      `reference ${reference.reference_id} popularity normalized_score must be 0-100`, 4);
      validatePopularityNormalization(signal.normalization, signal.metric,
        `reference ${reference.reference_id} popularity normalization`, 4);
      requireValue(signal.normalized_score === normalizedPopularityScore(signal),
      `reference ${reference.reference_id} popularity normalized_score is not router-reproducible`, 4);
      string(signal.scope, `reference ${reference.reference_id} popularity.scope`);
      string(signal.category, `reference ${reference.reference_id} popularity.category`);
      timestamp(signal.as_of, `reference ${reference.reference_id} popularity.as_of`);
      requireValue(signal.subject_record_id === (signal.subject_kind === "product"
        ? reference.source.product_record_id : reference.source.screen_record_id),
      `reference ${reference.reference_id} popularity subject conflicts with its source`, 4);
      timestamp(signal.snapshot_at,
        `reference ${reference.reference_id} popularity.snapshot_at`);
      uniqueStrings(signal.evidence_ids,
        `reference ${reference.reference_id} popularity.evidence_ids`);
      requireValue(signal.evidence_ids.every((id) => evidenceIds.has(id)),
        `reference ${reference.reference_id} popularity cites unknown evidence`, 4);
      requireValue(signal.evidence_ids.every((id) =>
        ["source-capture", "source-metadata"].includes(evidenceIds.get(id).kind) &&
        evidenceIds.get(id).reference_id === reference.reference_id &&
        evidenceIds.get(id).product_record_id === reference.source.product_record_id &&
        evidenceIds.get(id).screen_record_id === reference.source.screen_record_id &&
        evidenceHasSubjectBinding(
          evidenceIds.get(id), signal.subject_kind, signal.subject_record_id
        )),
      `reference ${reference.reference_id} popularity lacks record-bound source evidence`, 4);
      if (manualExportIndex) {
        const manualKey = manualPopularityRecordKey({
          record_kind: "signal",
          signal_id: signal.id,
          metric: signal.metric,
          subject_kind: signal.subject_kind,
          subject_record_id: signal.subject_record_id,
          raw_value: signal.raw_value,
          scope: signal.scope,
          category: signal.category,
          as_of: signal.as_of,
          snapshot_at: signal.snapshot_at,
          normalization: signal.normalization,
          evidence_ids: signal.evidence_ids
        });
        requireValue(manualRecords.get(reference.reference_id)
          .popularity_record_keys.has(manualKey),
        `reference ${reference.reference_id} popularity signal ${signal.id} is absent from its manual export`, 4);
      }
      signal.evidence_ids.forEach((id) => usedEvidenceIds.add(id));
    }
    for (const [conflictIndex, conflict] of reference.popularity.conflicts.entries()) {
      exact(conflict, new Set([
        "signal_id", "subject_kind", "subject_record_id", "raw_value", "as_of", "note",
        "evidence_ids"
      ]), `reference ${reference.reference_id} popularity conflict[${conflictIndex}]`);
      requireValue(expectedSignals.has(conflict.signal_id),
        `reference ${reference.reference_id} popularity conflict cites an unknown signal`, 4);
      const expectedConflictSignal = expectedSignals.get(conflict.signal_id);
      requireValue(conflict.subject_kind === expectedConflictSignal.subject_kind &&
        conflict.subject_record_id === (conflict.subject_kind === "product"
          ? reference.source.product_record_id : reference.source.screen_record_id),
      `reference ${reference.reference_id} popularity conflict subject is invalid`, 4);
      requireValue(typeof conflict.raw_value === "number" && Number.isFinite(conflict.raw_value),
        `reference ${reference.reference_id} popularity conflict raw_value must be numeric`, 4);
      timestamp(conflict.as_of,
        `reference ${reference.reference_id} popularity conflict as_of`);
      string(conflict.note, `reference ${reference.reference_id} popularity conflict note`);
      uniqueStrings(conflict.evidence_ids,
        `reference ${reference.reference_id} popularity conflict evidence_ids`);
      requireValue(conflict.evidence_ids.every((id) => evidenceIds.has(id)),
        `reference ${reference.reference_id} popularity conflict cites unknown evidence`, 4);
      requireValue(conflict.evidence_ids.every((id) =>
        ["source-capture", "source-metadata"].includes(evidenceIds.get(id).kind) &&
        evidenceIds.get(id).reference_id === reference.reference_id &&
        evidenceIds.get(id).product_record_id === reference.source.product_record_id &&
        evidenceIds.get(id).screen_record_id === reference.source.screen_record_id &&
        evidenceHasSubjectBinding(
          evidenceIds.get(id), conflict.subject_kind, conflict.subject_record_id
        )),
      `reference ${reference.reference_id} popularity conflict lacks record-bound source evidence`, 4);
      if (manualExportIndex) {
        const manualKey = manualPopularityRecordKey({
          record_kind: "conflict",
          signal_id: conflict.signal_id,
          subject_kind: conflict.subject_kind,
          subject_record_id: conflict.subject_record_id,
          raw_value: conflict.raw_value,
          as_of: conflict.as_of,
          evidence_ids: conflict.evidence_ids
        });
        requireValue(manualRecords.get(reference.reference_id)
          .popularity_record_keys.has(manualKey),
        `reference ${reference.reference_id} popularity conflict ${conflict.signal_id} is absent from its manual export`, 4);
      }
      conflict.evidence_ids.forEach((id) => usedEvidenceIds.add(id));
    }
    exact(reference.rights, new Set(["status", "redistribution", "creator_pixel_access"]),
      `reference ${reference.reference_id}.rights`);
    requireValue(reference.rights.status === state.brief.source.rights.status &&
      reference.rights.redistribution === false && reference.rights.creator_pixel_access === false,
    `reference ${reference.reference_id} weakens the source rights boundary`, 4);
  }
  for (const evidence of evidenceIds.values()) {
    const frames = frameBindings.get(evidence.reference_id);
    const source = sourceBindings.get(evidence.reference_id);
    requireValue(source && source.product_record_id === evidence.product_record_id &&
      source.screen_record_id === evidence.screen_record_id &&
      frames && evidence.frame_ids.every((frameId) => frames.has(frameId)),
    `reference evidence ${evidence.evidence_id} has an invalid source binding`, 4);
  }
  requireValue(usedEvidenceIds.size === evidenceIds.size &&
    [...evidenceIds.keys()].every((id) => usedEvidenceIds.has(id)),
  "reference discovery contains unreferenced source evidence", 4);
}

function validateGrammar(state, result, discovery) {
  requireValue(result.subject_result_digest === discovery.result_digest,
    "reference grammar subject digest mismatch", 4);
  requireValue(canonicalIdentityKey(result.actor.actor_id) !==
    canonicalIdentityKey(discovery.normalized.actor.actor_id),
    "reference grammar researcher must use a distinct actor from discovery", 4);
  requireValue(Array.isArray(result.references) &&
    result.references.length === discovery.normalized.references.length,
  "reference grammar must cover every discovered reference", 4);
  const discovered = new Map(discovery.normalized.references.map((item) => [item.reference_id, item]));
  const grammarIds = new Set();
  const reasoningIds = new Set();
  const coveredReferences = new Set();
  for (const entry of result.references) {
    exact(entry, new Set([
      "reference_id", "product_fit", "inferred_rationale", "locale_analysis",
      "hierarchy_reasoning", "grammar"
    ]), `reference grammar ${entry.reference_id || "unknown"}`);
    const source = discovered.get(entry.reference_id);
    requireValue(source, `reference grammar cites unknown reference: ${entry.reference_id}`, 4);
    requireValue(!coveredReferences.has(entry.reference_id),
      `reference grammar repeats reference: ${entry.reference_id}`, 4);
    coveredReferences.add(entry.reference_id);
    const observationIds = new Set(source.observed.map((item) => item.observation_id));
    const observationsById = new Map(source.observed.map((item) => [item.observation_id, item]));
    exact(entry.product_fit, new Set(["band", "score", "dimensions", "rationale", "observed_ids"]),
      `reference grammar ${entry.reference_id}.product_fit`);
    requireValue(FIT_BANDS.includes(entry.product_fit.band),
      `reference grammar ${entry.reference_id} fit band is invalid`, 4);
    requireValue(Number.isInteger(entry.product_fit.score) && entry.product_fit.score >= 0 &&
      entry.product_fit.score <= 100,
    `reference grammar ${entry.reference_id} fit score must be 0-100`, 4);
    exact(entry.product_fit.dimensions, new Set(FIT_DIMENSIONS),
      `reference grammar ${entry.reference_id} fit dimensions`);
    for (const dimension of FIT_DIMENSIONS) {
      requireValue(Number.isInteger(entry.product_fit.dimensions[dimension]) &&
        entry.product_fit.dimensions[dimension] >= 0 && entry.product_fit.dimensions[dimension] <= 5,
      `reference grammar ${entry.reference_id} fit dimension ${dimension} must be 0-5`, 4);
    }
    const expectedFitScore = productFitScore(entry.product_fit.dimensions);
    requireValue(entry.product_fit.score === expectedFitScore &&
      entry.product_fit.band === productFitBand(expectedFitScore),
    `reference grammar ${entry.reference_id} fit score/band is not router-reproducible`, 4);
    string(entry.product_fit.rationale, `reference grammar ${entry.reference_id} fit rationale`);
    uniqueStrings(entry.product_fit.observed_ids,
      `reference grammar ${entry.reference_id} fit observed_ids`);
    requireValue(entry.product_fit.observed_ids.every((id) => observationIds.has(id)),
      `reference grammar ${entry.reference_id} fit cites unknown observation`, 4);
    requireValue(Array.isArray(entry.inferred_rationale) && entry.inferred_rationale.length > 0,
      `reference grammar ${entry.reference_id} requires inferred rationale`, 4);
    for (const inference of entry.inferred_rationale) {
      exact(inference, new Set(["inference_id", "statement", "confidence", "observed_ids"]),
        `reference grammar ${entry.reference_id} inference`);
      safeId(inference.inference_id, "reference inference_id");
      string(inference.statement, "reference inference statement");
      requireValue(["low", "medium", "high"].includes(inference.confidence),
        `reference inference ${inference.inference_id} confidence is invalid`, 4);
      uniqueStrings(inference.observed_ids, `reference inference ${inference.inference_id} observed_ids`);
      requireValue(inference.observed_ids.every((id) => observationIds.has(id)),
        `reference inference ${inference.inference_id} cites unknown observation`, 4);
    }
    exact(entry.locale_analysis, new Set([
      "source_locale", "target_locales", "transferability", "risks",
      "verification_requirements"
    ]), `reference grammar ${entry.reference_id}.locale_analysis`);
    requireValue(entry.locale_analysis.source_locale === source.locale,
      `reference grammar ${entry.reference_id} locale source mismatch`, 4);
    uniqueStrings(entry.locale_analysis.target_locales,
      `reference grammar ${entry.reference_id} locale target_locales`);
    requireValue(sameStringSet(entry.locale_analysis.target_locales, state.brief.locales),
      `reference grammar ${entry.reference_id} does not cover every target locale`, 4);
    requireValue(["direct", "adaptation-required", "unsupported"].includes(
      entry.locale_analysis.transferability
    ), `reference grammar ${entry.reference_id} locale transferability is invalid`, 4);
    if (entry.locale_analysis.transferability === "direct") {
      requireValue(state.brief.locales.every((locale) => locale === source.locale),
        `reference grammar ${entry.reference_id} cannot claim direct cross-locale transfer`, 4);
    }
    uniqueStrings(entry.locale_analysis.risks,
      `reference grammar ${entry.reference_id} locale risks`);
    uniqueStrings(entry.locale_analysis.verification_requirements,
      `reference grammar ${entry.reference_id} locale verification_requirements`);
    requireValue(Array.isArray(entry.hierarchy_reasoning) && entry.hierarchy_reasoning.length > 0,
      `reference grammar ${entry.reference_id} requires causal hierarchy reasoning`, 4);
    const entryReasoningIds = new Set();
    for (const reasoning of entry.hierarchy_reasoning) {
      exact(reasoning, new Set([
        "reasoning_id", "observed_priority", "user_decision", "likely_constraint",
        "consequence_if_flattened", "confidence", "observed_ids"
      ]), `reference grammar ${entry.reference_id} hierarchy reasoning`);
      safeId(reasoning.reasoning_id, "reference hierarchy reasoning_id");
      requireValue(!reasoningIds.has(reasoning.reasoning_id),
        `duplicate hierarchy reasoning id: ${reasoning.reasoning_id}`, 4);
      reasoningIds.add(reasoning.reasoning_id);
      entryReasoningIds.add(reasoning.reasoning_id);
      requireValue(["primary", "secondary", "supporting", "ambient"].includes(
        reasoning.observed_priority
      ), `reference hierarchy reasoning ${reasoning.reasoning_id} priority is invalid`, 4);
      for (const field of ["user_decision", "likely_constraint", "consequence_if_flattened"]) {
        string(reasoning[field], `reference hierarchy reasoning ${reasoning.reasoning_id}.${field}`);
      }
      requireValue(!SOURCE_STYLE_LITERAL_PATTERN.test(JSON.stringify(reasoning)) &&
        !SOURCE_PIXEL_MATERIAL_PATTERN.test(JSON.stringify(reasoning)),
      `reference hierarchy reasoning ${reasoning.reasoning_id} contains source-specific copying instructions`, 4);
      requireValue(["low", "medium", "high"].includes(reasoning.confidence),
        `reference hierarchy reasoning ${reasoning.reasoning_id} confidence is invalid`, 4);
      uniqueStrings(reasoning.observed_ids,
        `reference hierarchy reasoning ${reasoning.reasoning_id} observed_ids`);
      requireValue(reasoning.observed_ids.every((id) => observationIds.has(id)),
        `reference hierarchy reasoning ${reasoning.reasoning_id} cites unknown observation`, 4);
      const cited = reasoning.observed_ids.map((id) => observationsById.get(id));
      requireValue(cited.some((item) =>
        ["hierarchy", "structure", "navigation"].includes(item.kind) &&
          item.priority === reasoning.observed_priority),
      `reference hierarchy reasoning ${reasoning.reasoning_id} is not tied to a matching visible priority`, 4);
    }
    requireValue(Array.isArray(entry.grammar) && entry.grammar.length > 0,
      `reference grammar ${entry.reference_id} requires transferable grammar`, 4);
    for (const grammar of entry.grammar) {
      exact(grammar, new Set([
        "grammar_id", "dimension", "principle", "application", "application_conditions",
        "tradeoff", "harmful_when", "requires_live_data", "avoid", "observed_ids",
        "reasoning_ids"
      ]), `reference grammar ${entry.reference_id} principle`);
      safeId(grammar.grammar_id, "reference grammar_id");
      requireValue(!grammarIds.has(grammar.grammar_id), `duplicate grammar id: ${grammar.grammar_id}`, 4);
      grammarIds.add(grammar.grammar_id);
      requireValue(GRAMMAR_DIMENSIONS.has(grammar.dimension),
        `unsupported grammar dimension: ${grammar.dimension}`, 4);
      for (const field of ["principle", "application", "tradeoff", "avoid"]) {
        string(grammar[field], `reference grammar ${grammar.grammar_id}.${field}`);
      }
      uniqueStrings(grammar.application_conditions,
        `reference grammar ${grammar.grammar_id}.application_conditions`);
      uniqueStrings(grammar.harmful_when,
        `reference grammar ${grammar.grammar_id}.harmful_when`);
      requireValue(typeof grammar.requires_live_data === "boolean",
        `reference grammar ${grammar.grammar_id}.requires_live_data must be boolean`, 4);
      uniqueStrings(grammar.reasoning_ids,
        `reference grammar ${grammar.grammar_id}.reasoning_ids`);
      requireValue(grammar.reasoning_ids.every((id) => entryReasoningIds.has(id)),
        `reference grammar ${grammar.grammar_id} cites unknown hierarchy reasoning`, 4);
      const language = `${grammar.principle} ${grammar.application} ` +
        `${grammar.application_conditions.join(" ")} ${grammar.tradeoff} ` +
        `${grammar.harmful_when.join(" ")} ${grammar.avoid}`;
      requireValue(!SOURCE_STYLE_LITERAL_PATTERN.test(language) &&
        !SOURCE_PIXEL_MATERIAL_PATTERN.test(language),
        `reference grammar ${grammar.grammar_id} contains source-specific copying instructions`, 4);
      uniqueStrings(grammar.observed_ids, `reference grammar ${grammar.grammar_id}.observed_ids`);
      requireValue(grammar.observed_ids.every((id) => observationIds.has(id)),
        `reference grammar ${grammar.grammar_id} cites unknown observation`, 4);
      if (OPERATIONAL_GRAMMAR_DIMENSIONS.has(grammar.dimension)) {
        const directObservations = grammar.observed_ids.map((id) => observationsById.get(id));
        const reasoningObservations = grammar.reasoning_ids.flatMap((id) =>
          entry.hierarchy_reasoning.find((item) => item.reasoning_id === id).observed_ids)
          .map((id) => observationsById.get(id));
        requireValue([...directObservations, ...reasoningObservations].every((item) =>
          item.frame_role !== "promotional"),
        `operational grammar ${grammar.grammar_id} cites promotional frame evidence`, 4);
      }
    }
  }
}

function validateReview(state, result, discovery, grammar) {
  requireValue(result.discovery_result_digest === discovery.result_digest &&
    result.grammar_result_digest === grammar.result_digest,
  "reference review subject digest mismatch", 4);
  const priorActors = canonicalIdentitySet([
    discovery.normalized.actor.actor_id,
    grammar.normalized.actor.actor_id
  ]);
  requireValue(!priorActors.has(canonicalIdentityKey(result.actor.actor_id)),
    "reference critic cannot review its own discovery or grammar output", 4);
  requireValue(Array.isArray(result.dispositions) &&
    result.dispositions.length === discovery.normalized.references.length,
  "reference review must disposition every discovered reference", 4);
  const referenceIds = new Set(discovery.normalized.references.map((item) => item.reference_id));
  const grammarByReference = new Map(grammar.normalized.references.map((item) => [item.reference_id, item]));
  const seen = new Set();
  for (const disposition of result.dispositions) {
    exact(disposition, new Set([
      "reference_id", "status", "popularity_verified", "product_fit_verified",
      "source_identity_verified", "sampling_verified", "locale_transferability_verified",
      "verified_component_families", "verified_patterns",
      "verified_evidence_ids", "verified_observation_ids", "verified_inference_ids",
      "verified_hierarchy_reasoning_ids", "verified_grammar_ids",
      "copy_risk", "blockers"
    ]), `reference review disposition ${disposition.reference_id || "unknown"}`);
    requireValue(referenceIds.has(disposition.reference_id),
      `reference review cites unknown reference: ${disposition.reference_id}`, 4);
    requireValue(!seen.has(disposition.reference_id),
      `duplicate review disposition: ${disposition.reference_id}`, 4);
    seen.add(disposition.reference_id);
    requireValue(["eligible", "blocked"].includes(disposition.status),
      `reference review status is invalid: ${disposition.status}`, 4);
    requireValue(typeof disposition.popularity_verified === "boolean" &&
      typeof disposition.product_fit_verified === "boolean" &&
      typeof disposition.source_identity_verified === "boolean" &&
      typeof disposition.sampling_verified === "boolean" &&
      typeof disposition.locale_transferability_verified === "boolean",
    `reference review verification flags must be boolean: ${disposition.reference_id}`, 4);
    requireValue(["low", "medium", "high"].includes(disposition.copy_risk),
      `reference review copy_risk is invalid: ${disposition.reference_id}`, 4);
    uniqueStrings(disposition.verified_component_families,
      `reference review ${disposition.reference_id}.verified_component_families`, { min: 0 });
    uniqueStrings(disposition.verified_patterns,
      `reference review ${disposition.reference_id}.verified_patterns`, { min: 0 });
    uniqueStrings(disposition.verified_evidence_ids,
      `reference review ${disposition.reference_id}.verified_evidence_ids`, { min: 0 });
    uniqueStrings(disposition.verified_observation_ids,
      `reference review ${disposition.reference_id}.verified_observation_ids`, { min: 0 });
    uniqueStrings(disposition.verified_inference_ids,
      `reference review ${disposition.reference_id}.verified_inference_ids`, { min: 0 });
    uniqueStrings(disposition.verified_hierarchy_reasoning_ids,
      `reference review ${disposition.reference_id}.verified_hierarchy_reasoning_ids`, { min: 0 });
    uniqueStrings(disposition.verified_grammar_ids,
      `reference review ${disposition.reference_id}.verified_grammar_ids`, { min: 0 });
    requireValue(Array.isArray(disposition.blockers),
      `reference review ${disposition.reference_id}.blockers must be an array`, 4);
    disposition.blockers.forEach((item) => string(item,
      `reference review ${disposition.reference_id} blocker`));
    const discoveredReference = discovery.normalized.references.find((item) =>
      item.reference_id === disposition.reference_id);
    const grammarEntry = grammarByReference.get(disposition.reference_id);
    const validObserved = new Set(discoveredReference.observed.map((item) => item.observation_id));
    const validEvidence = new Set(discovery.normalized.evidence
      .filter((item) => item.reference_id === disposition.reference_id)
      .map((item) => item.evidence_id));
    const validInferences = new Set(grammarEntry.inferred_rationale.map((item) => item.inference_id));
    const validReasoning = new Set(grammarEntry.hierarchy_reasoning.map((item) => item.reasoning_id));
    const validGrammar = new Set(grammarEntry.grammar.map((item) => item.grammar_id));
    requireValue(disposition.verified_component_families.every((item) =>
      discoveredReference.component_families.includes(item)) &&
      disposition.verified_patterns.every((item) => discoveredReference.patterns.includes(item)),
    `reference review ${disposition.reference_id} verifies an undeclared component or pattern`, 4);
    requireValue(disposition.verified_evidence_ids.every((id) => validEvidence.has(id)) &&
      disposition.verified_observation_ids.every((id) => validObserved.has(id)) &&
      disposition.verified_inference_ids.every((id) => validInferences.has(id)) &&
      disposition.verified_hierarchy_reasoning_ids.every((id) => validReasoning.has(id)) &&
      disposition.verified_grammar_ids.every((id) => validGrammar.has(id)),
    `reference review ${disposition.reference_id} verifies unknown evidence`, 4);
    const verifiedReasoning = new Set(disposition.verified_hierarchy_reasoning_ids);
    const verifiedEvidence = new Set(disposition.verified_evidence_ids);
    const verifiedObserved = new Set(disposition.verified_observation_ids);
    const verifiedInferences = new Set(disposition.verified_inference_ids);
    const verifiedGrammar = grammarEntry.grammar.filter((item) =>
      disposition.verified_grammar_ids.includes(item.grammar_id));
    requireValue(discoveredReference.observed
      .filter((item) => verifiedObserved.has(item.observation_id))
      .every((item) => item.evidence_ids.every((id) => verifiedEvidence.has(id))) &&
      (!disposition.popularity_verified || (
        discoveredReference.popularity.signals.every((item) =>
          item.evidence_ids.every((id) => verifiedEvidence.has(id))) &&
        discoveredReference.popularity.conflicts.every((item) =>
          item.evidence_ids.every((id) => verifiedEvidence.has(id))))),
    `reference review ${disposition.reference_id} leaves source evidence unverified`, 4);
    requireValue(verifiedGrammar.every((item) =>
      item.reasoning_ids.every((id) => verifiedReasoning.has(id))),
    `reference review ${disposition.reference_id} verifies grammar without its hierarchy reasoning`, 4);
    if (disposition.product_fit_verified) {
      requireValue(grammarEntry.product_fit.observed_ids.every((id) => verifiedObserved.has(id)),
        `reference review ${disposition.reference_id} verifies fit without its observations`, 4);
    }
    requireValue(grammarEntry.inferred_rationale
      .filter((item) => verifiedInferences.has(item.inference_id))
      .every((item) => item.observed_ids.every((id) => verifiedObserved.has(id))),
    `reference review ${disposition.reference_id} verifies inference without its observations`, 4);
    requireValue(grammarEntry.hierarchy_reasoning
      .filter((item) => verifiedReasoning.has(item.reasoning_id))
      .every((item) => item.observed_ids.every((id) => verifiedObserved.has(id))),
    `reference review ${disposition.reference_id} verifies hierarchy reasoning without its observations`, 4);
    requireValue(verifiedGrammar.every((item) =>
      item.observed_ids.every((id) => verifiedObserved.has(id))),
    `reference review ${disposition.reference_id} verifies grammar without its observations`, 4);
    if (discoveredReference.popularity.status === "conflicted") {
      requireValue(disposition.popularity_verified === false,
        `reference review ${disposition.reference_id} cannot verify conflicted popularity`, 4);
    }
    if (discoveredReference.screen_role === "promotional" ||
      discoveredReference.evidence_strength === "weak") {
      requireValue(verifiedGrammar.every((item) =>
        !OPERATIONAL_GRAMMAR_DIMENSIONS.has(item.dimension)),
      `weak or promotional reference ${disposition.reference_id} cannot verify operational hierarchy grammar`, 4);
    }
    if (disposition.status === "eligible") {
      requireValue(disposition.product_fit_verified &&
        disposition.source_identity_verified && disposition.sampling_verified &&
        disposition.locale_transferability_verified &&
        grammarEntry.locale_analysis.transferability !== "unsupported" &&
        disposition.copy_risk === "low" && disposition.blockers.length === 0 &&
        disposition.verified_component_families.length > 0 &&
        disposition.verified_patterns.length > 0 &&
        disposition.verified_evidence_ids.length > 0 &&
        disposition.verified_observation_ids.length > 0 &&
        disposition.verified_inference_ids.length > 0 &&
        disposition.verified_hierarchy_reasoning_ids.length > 0 &&
        disposition.verified_grammar_ids.length > 0,
      `eligible reference ${disposition.reference_id} has an unresolved hard gate`, 4);
    }
  }
}

export function validateReferenceResult(state, packet, input) {
  const { result, evidenceIds } = validateBaseResult(state, packet, input);
  if (result.kind === "reference-discovery") validateDiscovery(state, result, evidenceIds);
  if (result.kind === "reference-grammar") {
    validateGrammar(state, result, resultFor(state, "reference-discovery"));
  }
  if (result.kind === "reference-review") {
    validateReview(state, result, resultFor(state, "reference-discovery"),
      resultFor(state, "reference-grammar"));
  }
  return result;
}

function snapshotResultEvidence(result, root, evidenceBoundary = null) {
  return result.evidence.map((item) => {
    const lexicalResolved = path.isAbsolute(item.path)
      ? path.resolve(item.path)
      : path.resolve(evidenceBoundary || process.cwd(), item.path);
    let resolved = lexicalResolved;
    if (evidenceBoundary) {
      let canonicalBoundary;
      try {
        canonicalBoundary = fs.realpathSync.native(path.resolve(evidenceBoundary));
        resolved = fs.realpathSync.native(lexicalResolved);
      } catch (error) {
        throw new RouterError(
          `reference evidence ${item.evidence_id} cannot resolve inside its authorized result directory: ${error.message}`,
          4
        );
      }
      requireValue(inside(resolved, canonicalBoundary),
        `reference evidence ${item.evidence_id} escapes its authorized result directory`, 4);
    }
    let pinned;
    try {
      pinned = readFilePinned(resolved, {
        label: `reference evidence ${item.evidence_id}`
      });
    } catch (error) {
      throw new RouterError(error.message, 4);
    }
    if (result.kind === "reference-discovery" && item.kind === "source-capture") {
      requireValue(path.extname(pinned.path).toLocaleLowerCase("en") === ".png",
        `reference evidence ${item.evidence_id} source capture must use a .png path`, 4);
      validatePngCapture(pinned.source,
        `reference evidence ${item.evidence_id} source capture`);
    }
    return {
      evidence_id: item.evidence_id,
      evidence_kind: item.kind,
      ...(result.kind === "reference-discovery" ? {
        reference_id: item.reference_id,
        product_record_id: item.product_record_id,
        screen_record_id: item.screen_record_id,
        frame_ids: structuredClone(item.frame_ids),
        subject_bindings: structuredClone(item.subject_bindings)
      } : {}),
      ...pinnedSnapshot(pinned, root)
    };
  });
}

function recordResult(
  state,
  packet,
  input,
  sourcePath,
  sourceSnapshot = null,
  evidenceBoundary = null
) {
  requireValue(!resultFor(state, packet.packet_id),
    `reference result already exists for packet: ${packet.packet_id}`, 4);
  const normalized = validateReferenceResult(state, packet, input);
  let boundSource = sourceSnapshot;
  if (!boundSource) {
    const pinned = readPinnedJson(path.resolve(sourcePath), `reference result ${packet.packet_id}`);
    requireValue(canonicalDigest(pinned.input) === canonicalDigest(input),
      `reference result ${packet.packet_id} changed before provenance binding`, 4);
    boundSource = pinnedSnapshot(pinned, state.state_directory);
  }
  const evidence = snapshotResultEvidence(
    normalized,
    state.state_directory,
    evidenceBoundary
  );
  validateManualEvidenceSnapshots(state, normalized, evidence);
  const record = {
    packet_id: packet.packet_id,
    provider_id: packet.provider.id,
    participant: structuredClone(packet.participant),
    result_digest: canonicalDigest(normalized),
    source: boundSource,
    evidence,
    normalized,
    recorded_at: nowIso()
  };
  state.results.push(record);
  return record;
}

function verifyReferencePackSelection(state, pack) {
  requireValue(state.selection?.normalized?.status === "selected",
    "reference intelligence pack requires a persisted selected Owner decision", 4);
  const selection = state.selection.normalized;
  requireValue(state.selection.selection_digest === canonicalDigest(selection),
    "reference Owner selection digest conflicts with its normalized record", 4);
  const expectedSelection = {
    owner_id: selection.owner_id,
    selection_digest: state.selection.selection_digest,
    anchor_reference_id: selection.anchor_reference_id,
    supporting_reference_ids: selection.supporting_reference_ids,
    rationale: selection.rationale
  };
  requireValue(canonicalDigest(pack.selection) === canonicalDigest(expectedSelection),
    "reference intelligence pack selection conflicts with the persisted Owner selection", 4);

  const expectedReferenceIds = [
    selection.anchor_reference_id,
    ...selection.supporting_reference_ids
  ];
  const actualReferenceIds = pack.references.map((item) => item.reference_id);
  const actualRoles = pack.references.map((item) => item.role);
  requireValue(canonicalDigest(actualReferenceIds) === canonicalDigest(expectedReferenceIds) &&
    canonicalDigest(actualRoles) === canonicalDigest([
      "anchor",
      ...selection.supporting_reference_ids.map(() => "support")
    ]),
  "reference intelligence pack reference order or roles conflict with the persisted Owner selection",
  4);

  const actualGrammarIds = pack.verified_grammar.map((item) => item.grammar_id);
  requireValue(canonicalDigest(actualGrammarIds) ===
    canonicalDigest(selection.selected_grammar_ids),
  "reference intelligence pack grammar IDs conflict with the persisted Owner selection", 4);
}

const REFERENCE_STAGE_SEQUENCE = [
  "reference-discovery",
  "reference-grammar",
  "reference-review"
];

function isExactPrefix(actual, expected) {
  return actual.length <= expected.length && actual.every((item, index) =>
    item === expected[index]);
}

function latestRecoveryIsCheckpoint(state) {
  const latest = state.lease_recoveries.at(-1);
  return latest?.outcome === "checkpoint_recovered" && latest.retry_required === false;
}

function validateReferenceLifecycle(state) {
  requireValue(["running", "manual_pending", "blocked", "complete"].includes(state.status),
    `unsupported reference lifecycle status: ${state.status}`, 4);
  requireValue(Array.isArray(state.blockers) && Array.isArray(state.pending) &&
    state.outputs && typeof state.outputs === "object" && !Array.isArray(state.outputs),
  "reference lifecycle control fields are invalid", 4);

  const packetIds = state.packets.map((packet) => packet.packet_id);
  const resultIds = state.results.map((record) => record.packet_id);
  requireValue(isExactPrefix(packetIds, REFERENCE_STAGE_SEQUENCE),
    "reference packet set is not the canonical lifecycle prefix", 4);
  requireValue(isExactPrefix(resultIds, REFERENCE_STAGE_SEQUENCE) &&
    resultIds.every((packetId, index) => packetIds[index] === packetId),
  "reference result set is not the canonical lifecycle prefix", 4);

  const outputKeys = Object.keys(state.outputs);
  requireValue(outputKeys.every((key) => key === "reference_pack") &&
    outputKeys.length <= 1,
  "reference lifecycle contains unsupported outputs", 4);
  requireValue(state.status === "complete" || !state.outputs.reference_pack,
    "reference pack output cannot exist before lifecycle completion", 4);
  requireValue(state.status === "complete" || state.phase !== "complete",
    "reference complete phase requires complete status", 4);

  const allPackets = packetIds.length === REFERENCE_STAGE_SEQUENCE.length;
  const allResults = resultIds.length === REFERENCE_STAGE_SEQUENCE.length;
  const firstMissingResult = REFERENCE_STAGE_SEQUENCE[resultIds.length] || null;
  const coverage = allResults ? coverageAndRanking(state) : null;
  const expectedRanking = coverage && coverage.blockers.length === 0
    ? coverage.ranking : null;
  const rankingBound = expectedRanking !== null &&
    canonicalDigest(state.ranking) === canonicalDigest(expectedRanking) &&
    state.selection_scope_digest === selectionScope(state, expectedRanking);

  if (!allResults) {
    requireValue(Array.isArray(state.ranking) && state.ranking.length === 0 &&
      state.selection_scope_digest === null && state.selection === null,
    "reference ranking or Owner selection cannot precede all canonical results", 4);
  } else if (coverage.blockers.length > 0) {
    requireValue(Array.isArray(state.ranking) && state.ranking.length === 0 &&
      state.selection_scope_digest === null && state.selection === null,
    "blocked reference coverage cannot retain ranking or Owner selection authority", 4);
  } else {
    const pendingRankingCheckpoint = state.status === "running" ||
      (state.status === "manual_pending" && latestRecoveryIsCheckpoint(state));
    requireValue(rankingBound || (pendingRankingCheckpoint &&
      state.ranking.length === 0 && state.selection_scope_digest === null &&
      state.selection === null),
    "reference ranking and selection scope are not canonical for verified results", 4);
  }

  if (state.selection) {
    requireValue(allPackets && allResults && coverage.blockers.length === 0 && rankingBound,
      "reference Owner selection cannot precede canonical verified coverage", 4);
  }

  if (state.status === "complete") {
    requireValue(state.phase === "complete" && allPackets && allResults &&
      coverage.blockers.length === 0 && rankingBound &&
      state.selection?.normalized?.status === "selected" &&
      Boolean(state.outputs.reference_pack) && state.in_flight === null &&
      state.blockers.length === 0 && state.pending.length === 0,
    "reference lifecycle complete state is missing canonical packets, results, Owner authority, or pack output",
    4);
    return;
  }

  if (state.status === "manual_pending" && !latestRecoveryIsCheckpoint(state)) {
    requireValue(state.blockers.length === 0 && state.pending.length > 0,
      "reference manual_pending state requires pending work and no blockers", 4);
    if (firstMissingResult) {
      const attempt = lastAttempt(state, firstMissingResult);
      requireValue(state.phase === firstMissingResult &&
        packetIds.at(-1) === firstMissingResult &&
        attempt?.execution_status === "manual_pending",
      "reference manual_pending packet phase conflicts with its canonical pending attempt", 4);
    } else {
      requireValue(state.phase === "owner-reference-selection" && rankingBound &&
        state.selection === null,
      "reference manual_pending Owner phase lacks canonical coverage or awaits no decision", 4);
    }
  }

  if (state.status === "blocked") {
    requireValue(state.blockers.length > 0,
      "reference blocked state requires an explicit blocker", 4);
    if (state.phase === "reference-recovery") {
      const latest = state.lease_recoveries.at(-1);
      requireValue(latest?.retry_required === true &&
        latest.abandoned_packet && state.in_flight === null,
      "reference recovery blocker lacks an abandoned child receipt", 4);
    } else if (firstMissingResult) {
      const attempt = lastAttempt(state, firstMissingResult);
      requireValue(state.phase === firstMissingResult &&
        packetIds.at(-1) === firstMissingResult &&
        attempt?.execution_status?.startsWith("blocked"),
      "reference blocked packet phase conflicts with its canonical failed attempt", 4);
    } else if (coverage.blockers.length > 0) {
      requireValue(state.phase === "reference-coverage" && state.selection === null,
        "reference coverage blocker conflicts with its lifecycle phase", 4);
    } else {
      requireValue(state.phase === "owner-reference-selection" && rankingBound &&
        state.selection?.normalized?.status === "rejected",
      "reference Owner blocker conflicts with its lifecycle decision", 4);
    }
  }
}

export function readReferenceState(statePath) {
  const absolute = path.resolve(statePath);
  const state = readPinnedJson(absolute, "reference intelligence run").input;
  requireValue(state.reference_intelligence_run_version === 1,
    "reference_intelligence_run_version must be 1", 4);
  const canonicalTarget = fs.realpathSync.native(absolute);
  const recordedStatePath = path.resolve(state.state_path);
  const canonicalRecordedStatePath = fs.realpathSync.native(recordedStatePath);
  requireValue(canonicalRecordedStatePath === canonicalTarget,
    "reference state path does not match the resume target", 4);
  requireValue(typeof state.state_directory === "string" &&
    path.resolve(state.state_directory) === stateDirectory(recordedStatePath),
  "reference state_directory does not match the directory derived from recorded state_path", 4);
  requireValue(canonicalDigest(stateBody(state)) === state.state_digest,
    "reference state digest mismatch", 4);
  verifyJourneyIdentity(state.journey_identity, {
    runId: state.run_id,
    label: "reference intelligence journey_identity"
  });
  verifyReferenceAuthorityGraph(state);
  requireValue(Array.isArray(state.packets) && state.packet_files &&
    typeof state.packet_files === "object" && !Array.isArray(state.packet_files) &&
    Object.keys(state.packet_files).length === state.packets.length,
  "reference packet sidecar set conflicts with the cached packet set", 4);
  for (const packet of state.packets) {
    verifyPacketJourney(packet, state.journey_identity, `reference packet ${packet.packet_id}`);
    requireValue(canonicalDigest(packetBody(packet)) === packet.packet_digest,
      `reference packet digest mismatch: ${packet.packet_id}`, 4);
    const packetSource = state.packet_files[packet.packet_id];
    requireValue(packetSource,
      `reference packet sidecar is missing: ${packet.packet_id}`, 4);
    verifyBoundSnapshot(packetSource, `reference packet file ${packet.packet_id}`);
    const sourcePacket = readPinnedJson(
      packetSource.resolved_path,
      `reference packet file ${packet.packet_id}`
    ).input;
    requireValue(canonicalDigest(sourcePacket) === canonicalDigest(packet),
      `reference packet cached state conflicts with its sidecar: ${packet.packet_id}`, 4);
    verifyReferencePacketStateAuthority(state, packet);
  }
  requireValue(Array.isArray(state.results) && Array.isArray(state.attempts),
    "reference result and attempt ledgers must be arrays", 4);
  const seenResultPackets = new Set();
  for (const record of state.results) {
    requireValue(!seenResultPackets.has(record.packet_id),
      `reference result packet is duplicated: ${record.packet_id}`, 4);
    seenResultPackets.add(record.packet_id);
    verifyBoundSnapshot(record.source, `reference result ${record.packet_id}`);
    requireValue(canonicalDigest(record.normalized) === record.result_digest,
      `reference result digest mismatch: ${record.packet_id}`, 4);
    const sourceResult = readPinnedJson(record.source.resolved_path,
      `reference result ${record.packet_id}`).input;
    requireValue(canonicalDigest(sourceResult) === record.result_digest,
      `reference result source binding mismatch: ${record.packet_id}`, 4);
    const packet = state.packets.find((item) => item.packet_id === record.packet_id);
    requireValue(packet && record.provider_id === packet.provider.id &&
      canonicalDigest(record.participant) === canonicalDigest(packet.participant),
    `reference result execution lineage conflicts with packet: ${record.packet_id}`, 4);
    const normalizedSourceResult = validateReferenceResult(state, packet, sourceResult);
    const freshEvidence = snapshotResultEvidence(
      normalizedSourceResult,
      state.state_directory,
      path.dirname(record.source.resolved_path)
    );
    requireValue(canonicalDigest(freshEvidence) === canonicalDigest(record.evidence),
      `reference result evidence state binding mismatch: ${record.packet_id}`, 4);
    validateManualEvidenceSnapshots(state, normalizedSourceResult, freshEvidence);
    for (const evidence of record.evidence) {
      verifyBoundSnapshot(evidence, `reference evidence ${record.packet_id}/${evidence.evidence_id}`);
    }
  }
  const attemptsByPacket = new Map();
  for (const attempt of state.attempts) {
    const packet = state.packets.find((item) => item.packet_id === attempt.packet_id);
    requireValue(packet && attempt.provider_id === packet.provider.id &&
      attempt.packet_digest === packet.packet_digest &&
      canonicalDigest(attempt.participant) === canonicalDigest(packet.participant) &&
      Number.isInteger(attempt.attempt) && attempt.attempt >= 1 &&
      typeof attempt.execution_status === "string",
    `reference attempt execution lineage conflicts with packet: ${attempt.packet_id || "unknown"}`, 4);
    const previousAttempt = attemptsByPacket.get(attempt.packet_id) || 0;
    requireValue(attempt.attempt === previousAttempt + 1,
      `reference attempt sequence is invalid: ${attempt.packet_id}`, 4);
    attemptsByPacket.set(attempt.packet_id, attempt.attempt);
    const requiresExecutionAuthority = attempt.execution_status === "ran" ||
      attempt.execution_status.startsWith("blocked_") ||
      (attempt.execution_status === "manual_pending" && attempt.adapter !== null);
    if (requiresExecutionAuthority) {
      requireValue(attempt.execution_authority && attempt.execution_authority_source,
        `reference executed attempt lacks immutable execution authority: ${attempt.packet_id}`, 4);
      verifyAttemptExecutionAuthority(state, packet, attempt);
    } else {
      requireValue(attempt.execution_authority === undefined &&
        attempt.execution_authority_source === undefined &&
        (attempt.adapter === null || attempt.adapter === "manual-v1"),
      `reference manual attempt cannot claim execution authority: ${attempt.packet_id}`, 4);
    }
    const acceptedAttempt = ["ran", "manual_recorded"].includes(
      attempt.execution_status
    );
    const carriesResultBinding = attempt.result_digest !== undefined ||
      attempt.result_path !== undefined || attempt.result_file_digest !== undefined;
    requireValue(acceptedAttempt || !carriesResultBinding,
      `reference non-accepted attempt cannot carry result binding: ${attempt.packet_id}`, 4);
    if (attempt.result_digest !== undefined) {
      const record = state.results.find((item) => item.packet_id === attempt.packet_id);
      requireValue(record && attempt.result_digest === record.result_digest,
        `reference attempt result lineage conflicts with packet: ${attempt.packet_id}`, 4);
    }
    if (acceptedAttempt) {
      const record = state.results.find((item) => item.packet_id === attempt.packet_id);
      requireValue(record && attempt.result_digest === record.result_digest &&
        typeof attempt.result_path === "string" &&
        fs.realpathSync.native(path.resolve(attempt.result_path)) ===
          fs.realpathSync.native(path.resolve(record.source.resolved_path)),
      `reference accepted attempt lacks its exact result-file lineage: ${attempt.packet_id}`, 4);
      if (attempt.execution_status === "ran") {
        requireValue(attempt.result_file_digest === record.source.digest &&
          attempt.ingest_status === "recorded",
        `reference ran attempt lacks its exact result-file digest: ${attempt.packet_id}`, 4);
      }
    }
  }
  for (const record of state.results) {
    const acceptedAttempts = state.attempts.filter((attempt) =>
      attempt.packet_id === record.packet_id &&
      attempt.result_digest === record.result_digest &&
      ["ran", "manual_recorded"].includes(attempt.execution_status));
    requireValue(acceptedAttempts.length === 1,
      `reference result requires exactly one accepted attempt lineage: ${record.packet_id}`, 4);
  }
  requireValue(Array.isArray(state.lease_recoveries),
    "reference state lease_recoveries must be an array", 4);
  for (const receipt of state.lease_recoveries) {
    requireValue(receipt.reference_lease_recovery_version === 1 &&
      receipt.run_id === state.run_id &&
      identitiesMatch(receipt.journey_identity, state.journey_identity) &&
      DIGEST_PATTERN.test(receipt.recovery_digest || "") &&
      canonicalDigest(recoveryBody(receipt)) === receipt.recovery_digest,
    "reference lease recovery receipt is invalid", 4);
  }
  if (state.in_flight !== null) {
    object(state.in_flight, "reference in_flight intent");
    requireValue(Object.keys(state.in_flight).sort().join(",") === [
      "attempt", "execution_authority", "execution_authority_source", "packet_digest",
      "packet_id", "provider_id", "started_at"
    ].sort().join(","),
    "reference in_flight intent contains unsupported or missing fields", 4);
    const packet = state.packets.find((item) => item.packet_id === state.in_flight.packet_id);
    requireValue(packet && state.in_flight.provider_id === packet.provider.id &&
      state.in_flight.packet_digest === packet.packet_digest &&
      Number.isInteger(state.in_flight.attempt) && state.in_flight.attempt >= 1 &&
      !Number.isNaN(Date.parse(state.in_flight.started_at || "")),
    "reference in_flight intent conflicts with its packet", 4);
    object(state.in_flight.execution_authority,
      "reference in_flight execution_authority");
    object(state.in_flight.execution_authority.provider,
      "reference in_flight execution_authority.provider");
    verifyAttemptExecutionAuthority(state, packet, {
      ...state.in_flight,
      adapter: state.in_flight.execution_authority.provider.adapter,
      host_manifest_digest: state.in_flight.execution_authority.host_manifest.digest,
      strength: state.in_flight.execution_authority.provider.strength,
      capabilities: state.in_flight.execution_authority.provider.capabilities,
      permission_scopes: state.in_flight.execution_authority.provider.permissions,
      adapter_entrypoint: publicExecutionEntrypoint(
        state.in_flight.execution_authority.adapter_entrypoint
      )
    });
  }
  if (state.selection) {
    exact(state.selection, new Set(["source", "selection_digest", "normalized"]),
      "reference owner selection binding");
    digest(state.selection.selection_digest,
      "reference owner selection binding.selection_digest");
    requireSelectionSourceOutsideStateDirectory(
      state,
      state.selection.source?.resolved_path || state.selection.source?.path
    );
    verifyBoundSnapshot(state.selection.source, "reference owner selection");
    const pinnedSelection = readPinnedJson(
      state.selection.source.resolved_path,
      "reference owner selection"
    );
    const currentSource = pinnedSnapshot(pinnedSelection, state.state_directory);
    const sourceSelection = validateSelectionInput(state, pinnedSelection.input);
    requireValue(canonicalDigest(currentSource) ===
      canonicalDigest(state.selection.source) &&
      canonicalDigest(sourceSelection) === state.selection.selection_digest &&
      canonicalDigest(sourceSelection) === canonicalDigest(state.selection.normalized),
    "reference owner selection state binding mismatch", 4);
  }
  requireValue(state.status === "complete" || !state.outputs.reference_pack,
    "reference pack output cannot exist before lifecycle completion", 4);
  if (state.outputs.reference_pack) {
    const expectedPackPath = path.join(
      stateDirectory(recordedStatePath), "outputs", "reference-pack.json"
    );
    requireValue(
      fs.realpathSync.native(path.resolve(state.outputs.reference_pack.resolved_path)) ===
        fs.realpathSync.native(expectedPackPath),
      "reference intelligence pack output is redirected outside its canonical state path",
      4
    );
    verifyBoundSnapshot(state.outputs.reference_pack, "reference intelligence pack");
    const pack = readPinnedJson(state.outputs.reference_pack.resolved_path,
      "reference intelligence pack").input;
    validateReferencePack(pack);
    verifyReferencePackSelection(state, pack);
    requireValue(pack.run_id === state.run_id &&
      identitiesMatch(pack.journey_identity, state.journey_identity) &&
      pack.project_id === state.brief.project_id && pack.surface === state.brief.surface &&
      pack.planning_target_id === state.brief.planning.target_id &&
      pack.product_frame_digest === canonicalDigest(state.brief.planning.product_frame) &&
      canonicalDigest(pack.ranking_policy.signals) ===
        canonicalDigest(state.brief.popularity_prior.signals),
    "reference intelligence pack conflicts with its producing state", 4);
    const expectedPack = buildExpectedReferencePack(state, pack.compiled_at);
    requireValue(canonicalDigest(pack) === canonicalDigest(expectedPack),
      "reference intelligence pack cannot diverge from immutable producer state", 4);
  }
  validateReferenceLifecycle(state);
  return state;
}

function adapterRun(state, packet) {
  const discovery = resultFor(state, "reference-discovery");
  const grammar = resultFor(state, "reference-grammar");
  return {
    run_id: state.run_id,
    journey_identity: structuredClone(state.journey_identity),
    packets: state.packets,
    creator: {
      provider_id: grammar?.provider_id || discovery?.provider_id || packet.provider.id,
      actor_id: grammar?.normalized.actor.actor_id || discovery?.normalized.actor.actor_id || null,
      participant: grammar?.participant || discovery?.participant || packet.participant
    },
    scope: {
      kind: "reference-intelligence",
      surface: state.brief.surface,
      screen_family: state.brief.planning.product_frame.screen_family
    },
    artifacts: [
      state.brief_source,
      state.authority_sources.activation,
      state.authority_sources.rights,
      state.reasoning_registry.source,
      ...state.authority_sources.planning,
      ...state.authority_sources.exports,
      ...state.authority_sources.export_evidence
    ],
    results: state.results
  };
}

function retrySelectors(retry) {
  if (!retry) return new Set();
  return new Set(String(retry).split(",").map((item) => item.trim()).filter(Boolean));
}

function retryMatches(selectors, packet) {
  return selectors.has("all") || selectors.has(packet.packet_id) ||
    selectors.has(packet.provider.id) || selectors.has(packet.stage_id) ||
    selectors.has(packet.reference_task.kind);
}

function runPacket(state, lease, packet, manifest, selectors, faultInjector = null) {
  if (resultFor(state, packet.packet_id)) return;
  const previous = lastAttempt(state, packet.packet_id);
  const inspection = inspectPacketAdapter(packet, manifest);
  if (previous?.execution_status?.startsWith("blocked") && !retryMatches(selectors, packet)) return;
  if (previous?.execution_status === "manual_pending" &&
    inspection.execution_status === "manual_pending" &&
    previous.host_manifest_digest === inspection.host_manifest_digest &&
    previous.reason === inspection.reason) return;
  const attempt = attemptNumber(state, packet.packet_id);
  if (inspection.execution_status !== "ready") {
    state.attempts.push({
      ...inspection,
      attempt,
      packet_digest: packet.packet_digest,
      attempted_at: nowIso()
    });
    writeState(state, lease, { faultInjector });
    return;
  }
  verifyReferenceAuthorityGraph(state);
  const executionAuthority = captureExecutionAuthority(
    state,
    packet,
    manifest,
    inspection.declaration,
    attempt
  );
  const outputDirectory = path.join(
    state.state_directory, "evidence", packet.packet_id, `attempt-${attempt}`
  );
  state.in_flight = {
    packet_id: packet.packet_id,
    provider_id: packet.provider.id,
    attempt,
    packet_digest: packet.packet_digest,
    started_at: nowIso(),
    execution_authority: executionAuthority.authority,
    execution_authority_source: executionAuthority.source
  };
  writeState(state, lease, { inFlight: true, faultInjector });
  markStateLeaseChildExecution(lease, {
    packetId: packet.packet_id,
    providerId: packet.provider.id,
    attempt,
    timeoutMs: inspection.declaration.timeout_ms
  });
  faultInjector?.("after-child-lease-before-spawn", {
    state_path: state.state_path,
    packet_id: packet.packet_id,
    attempt
  });
  verifyReferenceAuthorityGraph(state);
  const executed = executeAuditPacket({
    run: adapterRun(state, packet),
    packet,
    manifest,
    attempt,
    outputDirectory,
    outputGrantRoot: state.state_directory
  });
  faultInjector?.("after-child-exit-before-authority-revalidation", {
    state_path: state.state_path,
    packet_id: packet.packet_id,
    attempt,
    execution_status: executed.execution_status
  });
  verifyReferenceAuthorityGraph(state);
  const { result, declaration: _declaration, evidence_boundary: _boundary, ...attemptRecord } = executed;
  const stored = {
    ...attemptRecord,
    execution_authority: executionAuthority.authority,
    execution_authority_source: executionAuthority.source,
    packet_digest: packet.packet_digest,
    attempted_at: nowIso()
  };
  if (executed.execution_status === "ran") {
    const resultPath = path.join(outputDirectory, "reference-result.json");
    try {
      const resultSource = writePinnedJson(
        resultPath,
        result,
        `reference result ${packet.packet_id}`,
        state.state_directory
      );
      const record = recordResult(
        state,
        packet,
        result,
        resultPath,
        resultSource,
        outputDirectory
      );
      stored.result_path = resultPath;
      stored.result_digest = record.result_digest;
      stored.result_file_digest = record.source.digest;
      stored.ingest_status = "recorded";
    } catch (error) {
      stored.execution_status = "blocked_result_validation";
      stored.error = error.message;
      stored.ingest_status = "blocked";
    }
  }
  verifyReferenceAuthorityGraph(state);
  state.attempts.push(stored);
  state.in_flight = null;
  writeState(state, lease, { faultInjector });
}

function manualEntries(resultPaths, root) {
  return resultPaths.map((file) => {
    const pinned = readPinnedJson(file, "manual reference result");
    return {
      path: pinned.path,
      input: pinned.input,
      source: pinnedSnapshot(pinned, root),
      consumed: false
    };
  });
}

function ingestManual(state, lease, entries, faultInjector = null) {
  for (const entry of entries) {
    if (entry.consumed) continue;
    const packet = state.packets.find((item) => item.packet_id === entry.input.packet_id);
    if (!packet) continue;
    recordResult(
      state,
      packet,
      entry.input,
      entry.path,
      entry.source,
      path.dirname(entry.path)
    );
    state.attempts.push({
      packet_id: packet.packet_id,
      provider_id: packet.provider.id,
      participant: structuredClone(packet.participant),
      packet_digest: packet.packet_digest,
      adapter: "manual-v1",
      execution_status: "manual_recorded",
      attempt: attemptNumber(state, packet.packet_id),
      result_path: entry.path,
      result_digest: resultFor(state, packet.packet_id).result_digest,
      recorded_at: nowIso()
    });
    entry.consumed = true;
    writeState(state, lease, { faultInjector });
  }
}

function requireNoUnknownManual(entries) {
  const unknown = entries.filter((entry) => !entry.consumed);
  requireValue(unknown.length === 0,
    `manual result does not match a currently dispatched reference packet: ${unknown.map((item) => item.input.packet_id || item.path).join(", ")}`,
    4);
}

function stop(state, lease, status, phase, blockers = [], pending = [], faultInjector = null) {
  state.status = status;
  state.phase = phase;
  state.blockers = [...new Set(blockers)];
  state.pending = [...new Set(pending)];
  writeState(state, lease, { faultInjector });
  return state;
}

function haltForPacket(state, lease, packet, phase, faultInjector = null) {
  if (resultFor(state, packet.packet_id)) return null;
  const attempt = lastAttempt(state, packet.packet_id);
  if (attempt?.execution_status?.startsWith("blocked")) {
    return stop(state, lease, "blocked", phase,
      [`${packet.packet_id}: ${attempt.error || attempt.execution_status}`], [], faultInjector);
  }
  return stop(state, lease, "manual_pending", phase, [],
    [`${packet.packet_id}: ${attempt?.reason || "result is required"}`], faultInjector);
}

function coverageAndRanking(state) {
  const discovery = resultFor(state, "reference-discovery").normalized;
  const grammar = resultFor(state, "reference-grammar").normalized;
  const review = resultFor(state, "reference-review").normalized;
  const dispositions = new Map(review.dispositions.map((item) => [item.reference_id, item]));
  const grammarEntries = new Map(grammar.references.map((item) => [item.reference_id, item]));
  const eligible = discovery.references.filter((reference) => {
    const disposition = dispositions.get(reference.reference_id);
    return disposition?.status === "eligible" && disposition.product_fit_verified &&
      disposition.copy_risk === "low" &&
      disposition.blockers.length === 0;
  });
  const components = new Set(eligible.flatMap((item) =>
    dispositions.get(item.reference_id).verified_component_families));
  const patterns = new Set(eligible.flatMap((item) =>
    dispositions.get(item.reference_id).verified_patterns));
  const verifiedGrammar = new Set(eligible.flatMap((item) =>
    dispositions.get(item.reference_id).verified_grammar_ids));
  const dimensions = new Set(eligible.flatMap((item) =>
    grammarEntries.get(item.reference_id).grammar
      .filter((grammarItem) => verifiedGrammar.has(grammarItem.grammar_id))
      .map((grammarItem) => grammarItem.dimension)));
  const blockers = [];
  if (eligible.length < state.brief.coverage.minimum_verified_references) {
    blockers.push(`verified references ${eligible.length}/${state.brief.coverage.minimum_verified_references}`);
  }
  for (const component of state.brief.coverage.required_component_families) {
    if (!components.has(component)) blockers.push(`missing verified component family: ${component}`);
  }
  for (const pattern of state.brief.coverage.required_patterns) {
    if (!patterns.has(pattern)) blockers.push(`missing verified UI pattern: ${pattern}`);
  }
  for (const dimension of state.brief.coverage.required_grammar_dimensions) {
    if (!dimensions.has(dimension)) blockers.push(`missing verified grammar dimension: ${dimension}`);
  }
  const sampling = state.brief.coverage.sampling_policy;
  const distinctProducts = new Set(eligible.map((item) =>
    item.source.product_record_id.trim().toLocaleLowerCase("en")));
  const distinctCategories = new Set(eligible.map((item) =>
    item.product_category.trim().toLocaleLowerCase("en")));
  if (distinctProducts.size < sampling.minimum_distinct_products) {
    blockers.push(`distinct products ${distinctProducts.size}/${sampling.minimum_distinct_products}`);
  }
  if (distinctCategories.size < sampling.minimum_distinct_product_categories) {
    blockers.push(
      `distinct product categories ${distinctCategories.size}/${sampling.minimum_distinct_product_categories}`
    );
  }
  const productCounts = new Map();
  const ecosystemCounts = new Map();
  const cohorts = new Set();
  for (const reference of eligible) {
    const productIdentity = reference.source.product_record_id.trim().toLocaleLowerCase("en");
    const ecosystemIdentity = reference.sampling.ecosystem_id.trim().toLocaleLowerCase("en");
    productCounts.set(productIdentity, (productCounts.get(productIdentity) || 0) + 1);
    ecosystemCounts.set(ecosystemIdentity,
      (ecosystemCounts.get(ecosystemIdentity) || 0) + 1);
    reference.sampling.cohorts.forEach((cohort) => cohorts.add(cohort));
  }
  for (const [product, count] of productCounts) {
    if (count > sampling.maximum_references_per_product) {
      blockers.push(
        `product ${product} exceeds reference cap ${count}/${sampling.maximum_references_per_product}`
      );
    }
  }
  for (const [ecosystem, count] of ecosystemCounts) {
    if (count > sampling.maximum_references_per_ecosystem) {
      blockers.push(
        `ecosystem ${ecosystem} exceeds reference cap ${count}/${sampling.maximum_references_per_ecosystem}`
      );
    }
  }
  for (const cohort of sampling.required_cohorts) {
    if (!cohorts.has(cohort)) blockers.push(`missing verified sampling cohort: ${cohort}`);
  }
  for (const locale of state.brief.locales) {
    const directLocaleCount = eligible.filter((reference) => reference.locale === locale).length;
    if (directLocaleCount < sampling.minimum_references_per_target_locale) {
      blockers.push(
        `target-locale references ${locale} ${directLocaleCount}/${sampling.minimum_references_per_target_locale}`
      );
    }
  }
  const strongHierarchyReferences = eligible.filter((reference) => {
    if (reference.evidence_strength !== "strong" || reference.screen_role === "promotional") return false;
    const verified = new Set(dispositions.get(reference.reference_id).verified_observation_ids);
    return reference.observed.some((item) =>
      verified.has(item.observation_id) &&
      ["hierarchy", "structure", "navigation"].includes(item.kind));
  }).length;
  if (strongHierarchyReferences < sampling.minimum_strong_hierarchy_references) {
    blockers.push(
      `strong hierarchy references ${strongHierarchyReferences}/${sampling.minimum_strong_hierarchy_references}`
    );
  }
  const multiStateFamilies = eligible.filter((reference) =>
    reference.family.frame_count >= 2 && reference.family.state_frame_count >= 1).length;
  if (multiStateFamilies < sampling.minimum_multi_state_families) {
    blockers.push(
      `multi-state reference families ${multiStateFamilies}/${sampling.minimum_multi_state_families}`
    );
  }
  const eligibleFrameCount = eligible.reduce((sum, reference) =>
    sum + reference.family.frame_count, 0);
  const promotionalFrameCount = eligible.reduce((sum, reference) =>
    sum + reference.family.promotional_frame_count, 0);
  const promotionalRatio = eligibleFrameCount === 0
    ? 0
    : promotionalFrameCount / eligibleFrameCount;
  if (promotionalRatio > sampling.maximum_promotional_reference_ratio) {
    blockers.push(
      `promotional reference ratio ${promotionalRatio.toFixed(3)}/${sampling.maximum_promotional_reference_ratio}`
    );
  }
  const ranking = eligible.map((reference) => {
    const fit = grammarEntries.get(reference.reference_id).product_fit;
    const disposition = dispositions.get(reference.reference_id);
    return {
      reference_id: reference.reference_id,
      product_fit_band: fit.band,
      product_fit_score: fit.score,
      popularity_verified: disposition.popularity_verified,
      popularity_status: reference.popularity.status,
      popularity_score: popularityScore(state, reference, disposition),
      popularity_signals: reference.popularity.signals.map((item) => item.id)
    };
  }).sort((left, right) =>
    FIT_BAND_WEIGHT[right.product_fit_band] - FIT_BAND_WEIGHT[left.product_fit_band] ||
    Number(right.popularity_verified) - Number(left.popularity_verified) ||
    (right.popularity_score ?? -1) - (left.popularity_score ?? -1) ||
    right.product_fit_score - left.product_fit_score ||
    left.reference_id.localeCompare(right.reference_id));
  return { eligible, ranking, blockers };
}

function popularityScore(state, reference, disposition = null) {
  if (reference.popularity.status !== "verified-snapshot" ||
    (disposition && !disposition.popularity_verified)) return null;
  return weightedPopularityScore(
    reference.popularity.signals,
    state.brief.popularity_prior.signals
  );
}

function selectionScope(state, ranking) {
  return canonicalDigest({
    run_id: state.run_id,
    journey_identity: state.journey_identity,
    brief_digest: state.brief_source.digest,
    reasoning_registry_digest: state.reasoning_registry.registry_digest,
    planning_digests: state.authority_sources.planning.map((item) => item.digest),
    source_export_digests: state.authority_sources.exports.map((item) => item.digest),
    result_digests: Object.fromEntries(state.results.map((item) => [item.packet_id, item.result_digest])),
    ranking,
    authority: "discovery-evidence-only"
  });
}

function eligibleGrammarIds(state, referenceIds) {
  const grammar = resultFor(state, "reference-grammar").normalized;
  const review = resultFor(state, "reference-review").normalized;
  const dispositions = new Map(review.dispositions.map((item) => [item.reference_id, item]));
  const ids = new Set();
  for (const entry of grammar.references) {
    if (!referenceIds.has(entry.reference_id)) continue;
    for (const id of dispositions.get(entry.reference_id).verified_grammar_ids) ids.add(id);
  }
  return ids;
}

function validateSelectionInput(state, input) {
  exact(input, new Set([
    "reference_owner_selection_version", "run_id", "journey_identity", "selection_scope_digest",
    "owner_id", "status", "anchor_reference_id", "supporting_reference_ids",
    "selected_grammar_ids", "rationale", "decided_at"
  ]), "reference owner selection");
  requireValue(input.reference_owner_selection_version === 1,
    "reference_owner_selection_version must be 1", 4);
  requireValue(input.run_id === state.run_id, "reference owner selection run_id mismatch", 4);
  requireValue(identitiesMatch(input.journey_identity, state.journey_identity),
    "reference owner selection journey_identity mismatch", 4);
  requireValue(input.selection_scope_digest === state.selection_scope_digest,
    "reference owner selection scope digest mismatch", 4);
  const coverage = coverageAndRanking(state);
  requireValue(coverage.blockers.length === 0 &&
    canonicalDigest(state.ranking) === canonicalDigest(coverage.ranking) &&
    state.selection_scope_digest === selectionScope(state, coverage.ranking),
  "reference owner selection scope is not reproducible from verified results", 4);
  string(input.owner_id, "reference owner selection owner_id");
  requireValue(!/^REPLACE_WITH_/i.test(input.owner_id),
    "reference owner selection still contains an owner placeholder", 4);
  const executionRecipients = referenceSourceRecipientExecutionLineage(state).attempts
    .map((item) => item.provider_id);
  const routedProviders = state.packets.flatMap((packet) => [
    packet.provider.id,
    packet.participant.provider_id
  ]);
  const participantActors = state.results.map((item) => item.normalized.actor.actor_id);
  const disallowedOwners = canonicalIdentitySet([
    state.journey_identity.orchestrator_id,
    ...Object.values(state.brief.providers),
    ...routedProviders,
    ...executionRecipients,
    ...participantActors
  ]);
  requireValue(!disallowedOwners.has(canonicalIdentityKey(input.owner_id)),
  "reference research participant cannot act as owner", 4);
  assertInternalIdentityIsNotOrchestrator(input.owner_id, {
    orchestratorId: state.journey_identity.orchestrator_id,
    label: "reference owner selection owner_id"
  });
  requireValue(["selected", "rejected"].includes(input.status),
    "reference owner selection status must be selected or rejected", 4);
  timestamp(input.decided_at, "reference owner selection decided_at");
  string(input.rationale, "reference owner selection rationale");
  requireValue(!/^REPLACE_WITH_/i.test(input.rationale),
    "reference owner selection still contains a rationale placeholder", 4);
  const eligibleIds = new Set(state.ranking.map((item) => item.reference_id));
  if (input.status === "selected") {
    requireValue(eligibleIds.has(input.anchor_reference_id),
      "reference anchor is not eligible", 4);
    uniqueStrings(input.supporting_reference_ids,
      "reference owner selection supporting_reference_ids", { min: 1 });
    requireValue(input.supporting_reference_ids.length <= 4,
      "reference owner selection supports at most four references", 4);
    requireValue(input.supporting_reference_ids.every((id) =>
      eligibleIds.has(id) && id !== input.anchor_reference_id),
    "reference support must be eligible and distinct from the anchor", 4);
    const discovery = resultFor(state, "reference-discovery").normalized;
    const byId = new Map(discovery.references.map((item) => [item.reference_id, item]));
    requireValue(input.supporting_reference_ids.some((id) =>
      byId.get(id).source.product_record_id.trim().toLocaleLowerCase("en") !==
        byId.get(input.anchor_reference_id).source.product_record_id.trim().toLocaleLowerCase("en")),
    "reference support must include a different product to reduce cloning risk", 4);
    requireValue(input.supporting_reference_ids.some((id) =>
      byId.get(id).product_category.trim().toLocaleLowerCase("en") !==
        byId.get(input.anchor_reference_id).product_category.trim().toLocaleLowerCase("en")),
    "reference support must include a different product category to reduce template bias", 4);
    requireValue(input.supporting_reference_ids.some((id) =>
      byId.get(id).sampling.ecosystem_id.trim().toLocaleLowerCase("en") !==
        byId.get(input.anchor_reference_id).sampling.ecosystem_id.trim().toLocaleLowerCase("en")),
    "reference support must include a different ecosystem to reduce family-style copying", 4);
    uniqueStrings(input.selected_grammar_ids,
      "reference owner selection selected_grammar_ids", { min: 1 });
    const allowedGrammar = eligibleGrammarIds(state,
      new Set([input.anchor_reference_id, ...input.supporting_reference_ids]));
    requireValue(input.selected_grammar_ids.every((id) => allowedGrammar.has(id)),
      "reference owner selection includes unverified grammar", 4);
    const grammar = resultFor(state, "reference-grammar").normalized;
    const selectedDimensions = new Set(grammar.references.flatMap((entry) =>
      entry.grammar.filter((item) => input.selected_grammar_ids.includes(item.grammar_id))
        .map((item) => item.dimension)));
    requireValue(state.brief.coverage.required_grammar_dimensions.every((item) =>
      selectedDimensions.has(item)),
    "reference owner selection does not cover every required grammar dimension", 4);
  } else {
    requireValue(input.anchor_reference_id === null &&
      Array.isArray(input.supporting_reference_ids) && input.supporting_reference_ids.length === 0 &&
      Array.isArray(input.selected_grammar_ids) && input.selected_grammar_ids.length === 0,
    "rejected reference selection cannot retain candidates or grammar", 4);
  }
  return input;
}

function requireSelectionSourceOutsideStateDirectory(state, sourcePath) {
  let sourceRealPath;
  let stateDirectoryRealPath;
  try {
    sourceRealPath = fs.realpathSync.native(path.resolve(sourcePath));
    stateDirectoryRealPath = fs.realpathSync.native(
      stateDirectory(path.resolve(state.state_path))
    );
  } catch (error) {
    throw new RouterError(
      `reference owner selection authority path cannot be resolved: ${error.message}`,
      4
    );
  }
  requireValue(!inside(sourceRealPath, stateDirectoryRealPath),
    "reference owner selection must be supplied from outside the child-writable state directory derived from state_path",
    4);
}

function ingestSelection(state, lease, selectionPath, faultInjector = null) {
  requireValue(!state.selection, "reference owner selection is already digest-bound", 4);
  const pinned = readPinnedJson(selectionPath, "reference owner selection");
  requireSelectionSourceOutsideStateDirectory(state, pinned.path);
  const input = validateSelectionInput(state, pinned.input);
  state.selection = {
    source: pinnedSnapshot(pinned, state.state_directory),
    selection_digest: canonicalDigest(input),
    normalized: structuredClone(input)
  };
  writeState(state, lease, { faultInjector });
}

function writeSelectionTemplate(state, targetDirectory = path.join(state.state_directory, "templates")) {
  const target = path.join(targetDirectory, "reference-owner-selection.json");
  const ids = state.ranking.slice(0, Math.min(3, state.ranking.length)).map((item) => item.reference_id);
  const grammar = resultFor(state, "reference-grammar").normalized;
  const review = resultFor(state, "reference-review").normalized;
  const dispositions = new Map(review.dispositions.map((item) => [item.reference_id, item]));
  const selectedGrammar = grammar.references
    .filter((item) => ids.includes(item.reference_id))
    .flatMap((item) => item.grammar)
    .filter((item) => dispositions.get(
      grammar.references.find((entry) => entry.grammar.some((grammarItem) =>
        grammarItem.grammar_id === item.grammar_id)).reference_id
    ).verified_grammar_ids.includes(item.grammar_id));
  const chosen = [];
  for (const dimension of state.brief.coverage.required_grammar_dimensions) {
    const item = selectedGrammar.find((grammarItem) => grammarItem.dimension === dimension);
    if (item) chosen.push(item.grammar_id);
  }
  writeJsonAtomic(target, {
    reference_owner_selection_version: 1,
    run_id: state.run_id,
    journey_identity: structuredClone(state.journey_identity),
    selection_scope_digest: state.selection_scope_digest,
    owner_id: "REPLACE_WITH_OWNER_ID",
    status: "selected",
    anchor_reference_id: ids[0] || "REPLACE_WITH_ELIGIBLE_REFERENCE",
    supporting_reference_ids: ids.slice(1),
    selected_grammar_ids: chosen,
    rationale: "REPLACE_WITH_OWNER_RATIONALE",
    decided_at: nowIso()
  }, { label: "reference owner selection template" });
  return target;
}

function buildExpectedReferencePack(state, compiledAt) {
  const discoveryRecord = resultFor(state, "reference-discovery");
  const discovery = discoveryRecord.normalized;
  const grammar = resultFor(state, "reference-grammar").normalized;
  const grammarByReference = new Map(grammar.references.map((item) =>
    [item.reference_id, item]));
  const review = resultFor(state, "reference-review").normalized;
  const dispositions = new Map(review.dispositions.map((item) => [item.reference_id, item]));
  const selection = state.selection.normalized;
  const selectedReferenceOrder = [
    selection.anchor_reference_id,
    ...selection.supporting_reference_ids
  ];
  const selectedReferenceIds = new Set(selectedReferenceOrder);
  const discoveryByReference = new Map(discovery.references.map((item) =>
    [item.reference_id, item]));
  const references = selectedReferenceOrder.map((referenceId) =>
    discoveryByReference.get(referenceId)).map((item) => ({
      reference_id: item.reference_id,
      role: item.reference_id === selection.anchor_reference_id ? "anchor" : "support",
      source: {
        provider: item.source.provider,
        uri: item.source.uri,
        record_id: item.source.record_id,
        product_record_id: item.source.product_record_id,
        screen_record_id: item.source.screen_record_id,
        captured_at: item.source.captured_at
      },
      app_name: item.app_name,
      product_category: item.product_category,
      screen_family: item.screen_family,
      platform: item.platform,
      environment_of_use: item.environment_of_use,
      business_model: item.business_model,
      session_shape: item.session_shape,
      locale: item.locale,
      sampled_because: item.sampled_because,
      family: item.family,
      screen_role: item.screen_role,
      evidence_strength: item.evidence_strength,
      sampling: item.sampling,
      component_families: dispositions.get(item.reference_id).verified_component_families,
      patterns: dispositions.get(item.reference_id).verified_patterns,
      product_fit: structuredClone(grammarByReference.get(item.reference_id).product_fit),
      popularity: {
        status: item.popularity.status,
        signals: item.popularity.signals,
        conflicts: item.popularity.conflicts,
        verified: dispositions.get(item.reference_id).popularity_verified,
        computed_score: popularityScore(state, item, dispositions.get(item.reference_id))
      }
    }));
  const grammarById = new Map(grammar.references
    .filter((entry) => selectedReferenceIds.has(entry.reference_id))
    .flatMap((entry) => entry.grammar.map((item) => [
      item.grammar_id,
      { ...item, reference_id: entry.reference_id }
    ])));
  const verifiedGrammar = selection.selected_grammar_ids.map((grammarId) =>
    grammarById.get(grammarId));
  requireValue(verifiedGrammar.every(Boolean),
    "reference Owner selection contains grammar missing from the selected references", 4);
  const selectedReasoningIds = new Set(verifiedGrammar.flatMap((item) => item.reasoning_ids));
  const verifiedObservations = discovery.references
    .filter((entry) => selectedReferenceIds.has(entry.reference_id))
    .flatMap((entry) => entry.observed
      .filter((item) => dispositions.get(entry.reference_id)
        .verified_observation_ids.includes(item.observation_id))
      .map((item) => {
        const { evidence_ids: evidenceIds, ...observation } = item;
        return {
          ...observation,
          evidence_ids: evidenceIds,
          reference_id: entry.reference_id
        };
      }));
  const selectedEvidenceIds = new Set([
    ...verifiedObservations.flatMap((item) => item.evidence_ids),
    ...references.flatMap((item) => [
      ...item.popularity.signals.flatMap((signal) => signal.evidence_ids),
      ...item.popularity.conflicts.flatMap((conflict) => conflict.evidence_ids)
    ])
  ]);
  const criticVerifiedEvidenceIds = new Set([...selectedReferenceIds].flatMap((referenceId) =>
    dispositions.get(referenceId).verified_evidence_ids));
  requireValue([...selectedEvidenceIds].every((id) => criticVerifiedEvidenceIds.has(id)),
    "reference intelligence pack cannot include evidence omitted by the independent critic", 4);
  const evidenceManifest = discoveryRecord.evidence
    .filter((item) => selectedEvidenceIds.has(item.evidence_id))
    .map((item) => ({
      evidence_id: item.evidence_id,
      kind: item.evidence_kind,
      digest: item.digest,
      reference_id: item.reference_id,
      product_record_id: item.product_record_id,
      screen_record_id: item.screen_record_id,
      frame_ids: structuredClone(item.frame_ids),
      subject_bindings: structuredClone(item.subject_bindings)
    }));
  const verifiedHierarchyReasoning = grammar.references
    .filter((entry) => selectedReferenceIds.has(entry.reference_id))
    .flatMap((entry) => entry.hierarchy_reasoning.map((item) => ({
      ...item,
      reference_id: entry.reference_id
    })))
    .filter((item) => selectedReasoningIds.has(item.reasoning_id) &&
      dispositions.get(item.reference_id).verified_hierarchy_reasoning_ids.includes(item.reasoning_id));
  const pack = {
    reference_pack_version: 1,
    run_id: state.run_id,
    journey_identity: structuredClone(state.journey_identity),
    project_id: state.brief.project_id,
    surface: state.brief.surface,
    authority_scope: "discovery-evidence-only",
    planning_target_id: state.brief.planning.target_id,
    product_frame_digest: canonicalDigest(state.brief.planning.product_frame),
    planning_frame: structuredClone(state.brief.planning.product_frame),
    selection: {
      owner_id: selection.owner_id,
      selection_digest: state.selection.selection_digest,
      anchor_reference_id: selection.anchor_reference_id,
      supporting_reference_ids: selection.supporting_reference_ids,
      rationale: selection.rationale
    },
    references,
    evidence_manifest: evidenceManifest,
    reasoning_lenses: structuredClone(state.reasoning_registry.lenses),
    verified_observations: verifiedObservations,
    verified_hierarchy_reasoning: verifiedHierarchyReasoning,
    verified_grammar: verifiedGrammar,
    ranking_policy: {
      primary: "product-fit-band",
      within_band: "popularity-descending",
      unverified_or_conflicted_popularity: "rank-last-within-fit-band",
      popularity_cannot_affect: ["eligibility", "hard-gates", "owner-approval"],
      signals: structuredClone(state.brief.popularity_prior.signals)
    },
    downstream_contract: {
      source_pixels_included: false,
      reasoning_registry_is_visual_authority: false,
      visual_authority_granted: false,
      visual_signature_granted: false,
      design_creation_started: false,
      exact_three_3x3_route_unchanged: true,
      required_design_checks: [...REFERENCE_DESIGN_CHECKS],
      design_check_contracts: structuredClone(state.reasoning_registry.design_checks),
      reviewer_source_capture_readiness: null,
      required_next_gate: "separate KillSlopRouter design exploration with visual authority and owner gates"
    },
    provenance: {
      brief_digest: state.brief_source.digest,
      reasoning_registry_version: state.reasoning_registry.registry_version,
      reasoning_registry_digest: state.reasoning_registry.registry_digest,
      reasoning_registry_source_digest: state.reasoning_registry.source.digest,
      planning_digests: state.authority_sources.planning.map((item) => item.digest),
      source_export_digests: state.authority_sources.exports.map((item) => item.digest),
      rights_digest: state.authority_sources.rights.digest,
      result_digests: Object.fromEntries(state.results.map((item) => [item.packet_id, item.result_digest])),
      selection_scope_digest: state.selection_scope_digest
    },
    compiled_at: compiledAt,
    pack_digest: null
  };
  pack.downstream_contract.reviewer_source_capture_readiness =
    reviewerSourceCaptureReadiness(pack);
  pack.pack_digest = canonicalDigest({ ...pack, pack_digest: undefined });
  validateReferencePack(pack);
  verifyReferencePackSelection(state, pack);
  return pack;
}

function compileReferencePack(state) {
  const pack = buildExpectedReferencePack(state, nowIso());
  const target = path.join(state.state_directory, "outputs", "reference-pack.json");
  state.outputs.reference_pack = writePinnedJson(
    target,
    pack,
    "reference intelligence pack",
    state.state_directory
  );
  return pack;
}

function continueReference(state, lease, {
  hostManifest = null,
  resultPaths = [],
  selectionPath = null,
  retry = null,
  faultInjector = null
} = {}) {
  verifyJourneyIdentity(state.journey_identity, {
    runId: state.run_id,
    label: "active reference intelligence journey_identity"
  });
  if (state.status === "complete") return state;
  requireValue(!selectionPath || !state.selection,
    "reference owner selection is already digest-bound", 4);
  const selectors = retrySelectors(retry);
  const known = new Set([
    "all",
    ...state.packets.flatMap((packet) => [
      packet.packet_id, packet.provider.id, packet.stage_id, packet.reference_task.kind
    ])
  ]);
  for (const selector of selectors) {
    requireValue(known.has(selector),
      `retry selector does not match a current reference packet: ${selector}`);
  }
  state.status = "running";
  state.blockers = [];
  state.pending = [];
  writeState(state, lease, { faultInjector });
  const manual = manualEntries(resultPaths, state.state_directory);

  let packet = state.packets.find((item) => item.packet_id === "reference-discovery");
  ingestManual(state, lease, manual, faultInjector);
  runPacket(state, lease, packet, hostManifest, selectors, faultInjector);
  let halted = haltForPacket(state, lease, packet, "reference-discovery", faultInjector);
  if (halted) {
    requireNoUnknownManual(manual);
    return halted;
  }

  if (!state.packets.some((item) => item.packet_id === "reference-grammar")) {
    addPacket(state, lease, grammarPacket(state, resultFor(state, "reference-discovery")), faultInjector);
  }
  packet = state.packets.find((item) => item.packet_id === "reference-grammar");
  ingestManual(state, lease, manual, faultInjector);
  runPacket(state, lease, packet, hostManifest, selectors, faultInjector);
  halted = haltForPacket(state, lease, packet, "reference-grammar", faultInjector);
  if (halted) {
    requireNoUnknownManual(manual);
    return halted;
  }

  if (!state.packets.some((item) => item.packet_id === "reference-review")) {
    addPacket(state, lease, reviewPacket(
      state,
      resultFor(state, "reference-discovery"),
      resultFor(state, "reference-grammar")
    ), faultInjector);
  }
  packet = state.packets.find((item) => item.packet_id === "reference-review");
  ingestManual(state, lease, manual, faultInjector);
  runPacket(state, lease, packet, hostManifest, selectors, faultInjector);
  halted = haltForPacket(state, lease, packet, "reference-review", faultInjector);
  if (halted) {
    requireNoUnknownManual(manual);
    return halted;
  }
  requireNoUnknownManual(manual);

  const coverage = coverageAndRanking(state);
  if (coverage.blockers.length) {
    return stop(state, lease, "blocked", "reference-coverage", coverage.blockers, [], faultInjector);
  }
  state.ranking = coverage.ranking;
  state.selection_scope_digest = selectionScope(state, coverage.ranking);
  writeState(state, lease, { faultInjector });
  if (!state.selection) {
    if (selectionPath) ingestSelection(state, lease, selectionPath, faultInjector);
    else {
      const template = writeSelectionTemplate(state);
      return stop(state, lease, "manual_pending", "owner-reference-selection", [], [
        `owner must select one anchor, 1-4 supports, and verified grammar for ${state.selection_scope_digest}`,
        `copy and edit template: ${template}`
      ], faultInjector);
    }
  }
  if (state.selection.normalized.status === "rejected") {
    return stop(state, lease, "blocked", "owner-reference-selection",
      ["owner rejected the reference scope"], [], faultInjector);
  }
  compileReferencePack(state);
  return stop(state, lease, "complete", "complete", [], [], faultInjector);
}

function withLease(statePath, operation, callback) {
  const lease = acquireStateLease({ statePath, operation });
  let failure = null;
  try {
    return callback(lease);
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    try {
      releaseStateLease(lease);
    } catch (releaseError) {
      if (!failure) throw releaseError;
    }
  }
}

export function startReferenceIntelligence({
  statePath,
  briefPath,
  hostManifest = null,
  resultPaths = [],
  selectionPath = null,
  retry = null,
  routerId = "kill-slop-router",
  routerVersion = "1.0.0",
  invocation = "explicit",
  root = process.cwd(),
  faultInjector = null
}) {
  const absoluteState = path.resolve(statePath);
  return withLease(absoluteState, "reference-start", (lease) => {
    requireValue(!fs.existsSync(absoluteState),
      `reference state already exists; use --resume ${absoluteState}`);
    requireValue(!fs.existsSync(stateDirectory(absoluteState)),
      `reference state directory already exists; inspect before choosing another --out path`);
    const pinnedBrief = readPinnedJson(briefPath, "reference brief");
    const brief = validateReferenceBrief(pinnedBrief.input, { root });
    const runId = crypto.randomUUID();
    const directory = stateDirectory(absoluteState);
    const reasoningRegistry = bindHumanDesignReasoningRegistry(directory);
    const state = sealState({
      reference_intelligence_run_version: 1,
      run_id: runId,
      journey_identity: createJourneyIdentity({ runId, routerId, routerVersion, invocation }),
      status: "running",
      phase: "reference-discovery",
      created_at: nowIso(),
      updated_at: nowIso(),
      state_path: absoluteState,
      state_directory: directory,
      brief,
      brief_source: pinnedSnapshot(pinnedBrief, root),
      reasoning_registry: reasoningRegistry,
      authority_sources: authoritySources(brief, root),
      packets: [],
      packet_files: {},
      results: [],
      attempts: [],
      lease_recoveries: [],
      in_flight: null,
      ranking: [],
      selection_scope_digest: null,
      selection: null,
      outputs: {},
      blockers: [],
      pending: [],
      state_digest: null
    });
    writeState(state, lease, { faultInjector });
    addPacket(state, lease, discoveryPacket(state), faultInjector);
    return continueReference(state, lease, {
      hostManifest, resultPaths, selectionPath, retry, faultInjector
    });
  });
}

export function resumeReferenceIntelligence(statePath, options = {}) {
  const absolute = path.resolve(statePath);
  return withLease(absolute, "reference-resume", (lease) => {
    const state = readReferenceState(absolute);
    return continueReference(state, lease, options);
  });
}

function recoveryBody(receipt) {
  const { recovery_digest: _digest, ...body } = receipt;
  return body;
}

export function inspectReferenceStateLease(statePath) {
  return inspectStateLease(statePath);
}

export function recoverReferenceStateLease(statePath, {
  ownerToken,
  acquiredAt,
  stateDigest,
  faultInjector = null
} = {}) {
  const absolute = path.resolve(statePath);
  const preflight = inspectStateLease(absolute);
  requireValue(preflight.status === "locked",
    "reference lease recovery requires an active state lease", 5);
  requireValue(preflight.state_digest === stateDigest,
    "reference lease recovery state digest does not match the current state", 5);
  const state = preflight.state_digest === "absent" ? null : readReferenceState(absolute);
  const claimed = claimStaleStateLease({
    statePath: absolute,
    ownerToken,
    acquiredAt,
    stateDigest
  });
  try {
    const origin = claimed.recovery_origin;
    if (!state) {
      completeStateLeaseRecovery(claimed.controller);
      releaseStateLease(claimed.controller);
      return {
        reference_lease_recovery_result_version: 1,
        status: "recovered_absent_state",
        state_path: absolute,
        state_digest: "absent",
        recovered_lease_digest: origin.lease_digest,
        blocker: "inspect any leftover reference state directory before starting a new run"
      };
    }
    requireValue(state.state_digest === preflight.state_digest,
      "reference state changed after recovery preflight", 5);
    const alreadyRecorded = (state.lease_recoveries || []).find((item) =>
      item.recovered_lease_digest === origin.lease_digest);
    if (alreadyRecorded) {
      requireValue(canonicalDigest(recoveryBody(alreadyRecorded)) === alreadyRecorded.recovery_digest &&
        state.in_flight === null,
      "recorded reference recovery is not in a releasable checkpoint state", 4);
      completeStateLeaseRecovery(claimed.controller);
      releaseStateLease(claimed.controller);
      return {
        reference_lease_recovery_result_version: 1,
        status: "recovered",
        state_path: absolute,
        state_digest: state.state_digest,
        recovery: alreadyRecorded
      };
    }
    const active = state.in_flight;
    const originPacket = origin.active_packet;
    const checkpointedAttempt = !active && origin.phase === "child-execution" && originPacket
      ? state.attempts.find((item) =>
        item.packet_id === originPacket.packet_id &&
        item.provider_id === originPacket.provider_id &&
        item.attempt === originPacket.attempt &&
        item.packet_digest === state.packets.find((packet) =>
          packet.packet_id === originPacket.packet_id)?.packet_digest &&
        (item.execution_status === "ran" || item.execution_status?.startsWith("blocked")))
      : null;
    const checkpointedResult = checkpointedAttempt?.execution_status === "ran"
      ? resultFor(state, originPacket.packet_id)
      : null;
    const postChildCheckpoint = Boolean(checkpointedAttempt) &&
      (checkpointedAttempt.execution_status !== "ran" ||
        (checkpointedResult && checkpointedAttempt.result_digest === checkpointedResult.result_digest));
    if (origin.phase === "child-execution" && origin.active_packet) {
      requireValue(postChildCheckpoint || (active &&
        active.packet_id === origin.active_packet.packet_id &&
        active.provider_id === origin.active_packet.provider_id &&
        active.attempt === origin.active_packet.attempt),
      "reference state and lease disagree about the abandoned child", 4);
    }
    if (["child-intent", "child-execution"].includes(origin.phase)) {
      requireValue(active || postChildCheckpoint,
        "reference child-phase recovery requires a matching sealed in-flight intent", 4);
    }
    if (active && !["state-write", "child-intent", "child-execution", "recovery"].includes(origin.phase)) {
      throw new RouterError(
        `reference in-flight intent conflicts with stale lease phase ${origin.phase}`,
        4
      );
    }
    const outcome = postChildCheckpoint || !active
      ? "checkpoint_recovered"
      : origin.phase === "child-execution"
        ? "abandoned_after_crash"
        : "abandoned_before_spawn";
    const receipt = {
      reference_lease_recovery_version: 1,
      run_id: state.run_id,
      journey_identity: structuredClone(state.journey_identity),
      recovered_lease_digest: origin.lease_digest,
      recovered_owner_token_digest: origin.owner_token_digest,
      recovered_owner_pid: origin.owner_pid,
      recovered_owner_process_identity: origin.owner_process_identity,
      recovered_operation: origin.operation,
      recovered_phase: origin.phase,
      previous_state_digest: origin.state_digest,
      observed_state_digest: origin.state_digest,
      outcome,
      abandoned_packet: active ? {
        packet_id: active.packet_id,
        provider_id: active.provider_id,
        attempt: active.attempt,
        packet_digest: active.packet_digest
      } : null,
      retry_required: Boolean(active),
      recovered_at: origin.recovery_started_at,
      recovery_digest: null
    };
    receipt.recovery_digest = canonicalDigest(recoveryBody(receipt));
    completeStateLeaseRecovery(claimed.controller);
    faultInjector?.("after-recovery-complete-before-state-write", {
      state_path: absolute,
      recovered_lease_digest: origin.lease_digest,
      recovery_digest: receipt.recovery_digest
    });
    state.lease_recoveries ||= [];
    state.lease_recoveries.push(receipt);
    if (active) {
      const abandonedPacket = state.packets.find((packet) =>
        packet.packet_id === active.packet_id);
      requireValue(abandonedPacket &&
        abandonedPacket.provider.id === active.provider_id &&
        abandonedPacket.packet_digest === active.packet_digest,
      "reference abandoned attempt conflicts with its packet lineage", 4);
      state.attempts.push({
        packet_id: active.packet_id,
        provider_id: active.provider_id,
        participant: structuredClone(abandonedPacket.participant),
        attempt: active.attempt,
        packet_digest: active.packet_digest,
        adapter: active.execution_authority.provider.adapter,
        adapter_entrypoint: publicExecutionEntrypoint(
          active.execution_authority.adapter_entrypoint
        ),
        host_manifest_digest: active.execution_authority.host_manifest.digest,
        permission_scopes: structuredClone(active.execution_authority.provider.permissions),
        strength: active.execution_authority.provider.strength,
        capabilities: structuredClone(active.execution_authority.provider.capabilities),
        execution_authority: structuredClone(active.execution_authority),
        execution_authority_source: structuredClone(active.execution_authority_source),
        execution_status: outcome === "abandoned_after_crash"
          ? "blocked_abandoned_after_crash"
          : "blocked_abandoned_before_spawn",
        error: "orchestrator crashed before a trustworthy child result was checkpointed",
        retry_required: true,
        recovered_at: receipt.recovered_at
      });
    }
    state.in_flight = null;
    state.status = active ? "blocked" : "manual_pending";
    state.phase = active ? "reference-recovery" : state.phase;
    state.blockers = active
      ? [`${active.packet_id}: unknown child outcome after orchestrator crash; explicit retry required`]
      : [];
    state.pending = active
      ? state.pending
      : ["resume the recovered KillSlopRouter reference journey from its verified checkpoint"];
    writeState(state, claimed.controller, { faultInjector });
    releaseStateLease(claimed.controller);
    return {
      reference_lease_recovery_result_version: 1,
      status: "recovered",
      state_path: absolute,
      state_digest: state.state_digest,
      recovery: receipt
    };
  } catch (error) {
    // Once claimed, any reconciliation failure keeps the recovery lease. It
    // must never be released while a state write or child outcome is unclear.
    throw error;
  }
}

function dryPacket(
  state, packetId, stageId, providerId, role, capabilities, strength,
  permissions, forbiddenPermissions, kind
) {
  return makePacket(state, {
    packetId,
    stageId,
    providerId,
    role,
    capabilities,
    strength,
    permissions,
    forbiddenPermissions,
    task: {
      kind,
      dry_run: true,
      project_id: state.brief.project_id,
      surface: state.brief.surface,
      locales: [...state.brief.locales],
      human_design_reasoning: reasoningTaskContract(state)
    }
  });
}

export function dryRunReferenceIntelligence({
  briefPath,
  hostManifest = null,
  routerId = "kill-slop-router",
  routerVersion = "1.0.0",
  invocation = "explicit",
  root = process.cwd()
}) {
  const pinnedBrief = readPinnedJson(briefPath, "reference brief");
  const brief = validateReferenceBrief(pinnedBrief.input, { root });
  const loadedRegistry = loadHumanDesignReasoningRegistry();
  const state = {
    run_id: "dry-run",
    journey_identity: createJourneyIdentity({
      runId: "dry-run", routerId, routerVersion, invocation
    }),
    brief,
    brief_source: pinnedSnapshot(pinnedBrief, root),
    reasoning_registry: {
      registry_version: loadedRegistry.registry.human_design_reasoning_registry_version,
      authority_scope: loadedRegistry.registry.authority_scope,
      source_pixels_included: false,
      registry_digest: loadedRegistry.digest,
      research_basis: structuredClone(loadedRegistry.registry.research_basis),
      design_checks: structuredClone(loadedRegistry.registry.design_checks),
      lenses: structuredClone(loadedRegistry.registry.lenses)
    }
  };
  const packets = [
    dryPacket(state, "dry-reference-discovery", "reference-discovery",
      brief.providers.discovery, "researcher", DISCOVERY_CAPABILITIES, 3,
      ["artifact:read", "evidence:write",
        ...(brief.source.access_mode === "authorized-read-only-adapter" ? ["network:external"] : [])],
      brief.source.access_mode === "manual-export" ? ["network:external"] : [],
      "reference-discovery"),
    dryPacket(state, "dry-reference-grammar", "reference-grammar",
      brief.providers.grammar_extractor, "researcher", GRAMMAR_CAPABILITIES, 3,
      ["artifact:read", "evidence:write"], ["network:external"], "reference-grammar"),
    dryPacket(state, "dry-reference-review", "reference-review",
      brief.providers.critic, "critic", REVIEW_CAPABILITIES, 4,
      ["artifact:read", "evidence:write"], ["network:external"], "reference-review")
  ];
  const readiness = packets.map((packet) => {
    const inspected = inspectPacketAdapter(packet, hostManifest);
    const { declaration: _declaration, ...safe } = inspected;
    return safe;
  });
  const pending = readiness.filter((item) => item.execution_status !== "ready");
  return {
    reference_intelligence_dry_run_version: 1,
    journey_identity: state.journey_identity,
    status: pending.length ? "manual_pending" : "ready",
    project_id: brief.project_id,
    surface: brief.surface,
    brief: publicSnapshot(state.brief_source),
    reasoning_registry: {
      digest: state.reasoning_registry.registry_digest,
      authority_scope: state.reasoning_registry.authority_scope,
      lens_count: state.reasoning_registry.lenses.length,
      design_check_count: state.reasoning_registry.design_checks.length,
      source_pixels_included: false
    },
    source: {
      provider: "uibowl",
      access_mode: brief.source.access_mode,
      rights_status: brief.source.rights.status
    },
    popularity_policy: {
      primary: "product-fit-band",
      within_band: "popularity-descending",
      can_override_hard_gates: false
    },
    readiness,
    pending: pending.map((item) => `${item.packet_id}: ${item.reason || item.execution_status}`),
    hard_gates: [
      "service-planning-authority", "rights-and-provenance", "product-fit-band",
      "sampling-diversity", "causal-hierarchy-reasoning", "independent-review",
      "anti-copy", "owner-reference-selection",
      "separate-visual-authority", "separate-design-playwright", "separate-owner-approval"
    ],
    downstream: "discovery evidence only; exact-three 3x3 design exploration remains unchanged"
  };
}

const PRIOR_RESULT_STAGES = Object.freeze({
  "reference-discovery": [],
  "reference-grammar": ["reference-discovery"],
  "reference-review": ["reference-discovery", "reference-grammar"]
});

function dispatchAuthoritySnapshot(snapshot, label) {
  verifyBoundSnapshot(snapshot, label);
  return publicSnapshot(snapshot);
}

function dispatchAuthorityArtifacts(state) {
  const sourceEvidenceDescriptorsIncluded =
    state.authority_sources.export_evidence.length > 0;
  const sourcePixelsAvailableToReferenceParticipants =
    state.authority_sources.export_evidence.some((source) =>
      source.evidence_kind === "source-capture");
  return {
    source_evidence_descriptors_included: sourceEvidenceDescriptorsIncluded,
    source_pixels_available_to_reference_participants:
      sourcePixelsAvailableToReferenceParticipants,
    source_pixels_exposed_to_downstream_creator: false,
    brief: dispatchAuthoritySnapshot(state.brief_source, "reference brief"),
    owner_activation: dispatchAuthoritySnapshot(
      state.authority_sources.activation,
      "reference owner activation evidence"
    ),
    rights: dispatchAuthoritySnapshot(
      state.authority_sources.rights,
      "reference rights evidence"
    ),
    reasoning_registry: dispatchAuthoritySnapshot(
      state.reasoning_registry.source,
      "reference reasoning registry source"
    ),
    planning: state.authority_sources.planning.map((source) =>
      dispatchAuthoritySnapshot(source, `service-planning source ${source.id}`)),
    source_exports: state.authority_sources.exports.map((source) =>
      dispatchAuthoritySnapshot(source, `UI Bowl manual export ${source.id}`)),
    source_export_evidence: state.authority_sources.export_evidence.map((source) => ({
      export_id: source.export_id,
      evidence_id: source.evidence_id,
      evidence_kind: source.evidence_kind,
      product_record_id: source.product_record_id,
      screen_record_id: source.screen_record_id,
      frame_ids: structuredClone(source.frame_ids),
      subject_bindings: structuredClone(source.subject_bindings),
      file: dispatchAuthoritySnapshot(
        {
          path: source.path,
          resolved_path: source.resolved_path,
          kind: source.kind,
          bytes: source.bytes,
          digest: source.digest,
          physical_identity_digest: source.physical_identity_digest
        },
        `UI Bowl manual export evidence ${source.evidence_id}`
      )
    }))
  };
}

function dispatchPriorResult(record) {
  requireValue(canonicalDigest(record.normalized) === record.result_digest,
    `reference result digest mismatch before dispatch: ${record.packet_id}`, 4);
  verifyBoundSnapshot(record.source, `reference result ${record.packet_id}`);
  const { evidence: _evidence, ...normalizedResult } = structuredClone(record.normalized);
  const evidenceDigests = record.evidence.map((source) => {
    verifyBoundSnapshot(source,
      `reference evidence ${record.packet_id}/${source.evidence_id}`);
    return {
      evidence_id: source.evidence_id,
      evidence_kind: source.evidence_kind,
      ...(source.reference_id ? {
        reference_id: source.reference_id,
        product_record_id: source.product_record_id,
        screen_record_id: source.screen_record_id,
        frame_ids: structuredClone(source.frame_ids),
        subject_bindings: structuredClone(source.subject_bindings)
      } : {}),
      digest: source.digest
    };
  });
  return {
    packet_id: record.packet_id,
    result_digest: record.result_digest,
    result_source_digest: record.source.digest,
    evidence_digests: evidenceDigests,
    normalized_result: normalizedResult
  };
}

function referenceDispatchRequest(state, packet) {
  verifyPacketJourney(packet, state.journey_identity,
    `dispatched reference packet ${packet.packet_id}`);
  requireValue(canonicalDigest(packetBody(packet)) === packet.packet_digest,
    `reference packet digest mismatch before dispatch: ${packet.packet_id}`, 4);
  const requiredPriorPackets = PRIOR_RESULT_STAGES[packet.stage_id];
  requireValue(Array.isArray(requiredPriorPackets),
    `unsupported reference dispatch stage: ${packet.stage_id}`, 4);
  const priorResults = requiredPriorPackets.map((packetId) => {
    const record = resultFor(state, packetId);
    requireValue(record,
      `reference dispatch ${packet.packet_id} requires prior result ${packetId}`, 4);
    return dispatchPriorResult(record);
  });
  const request = {
    reference_dispatch_request_version: 1,
    run_id: state.run_id,
    journey_identity: structuredClone(state.journey_identity),
    state_digest: state.state_digest,
    stage_id: packet.stage_id,
    packet: structuredClone(packet),
    authority_artifacts: dispatchAuthorityArtifacts(state),
    prior_results: priorResults,
    request_digest: null
  };
  request.request_digest = canonicalDigest({ ...request, request_digest: undefined });
  return request;
}

export function dispatchReferencePackets(state, outputDirectory) {
  const directory = path.resolve(outputDirectory);
  ensureSecureDirectory(directory, "reference dispatch directory");
  const pendingPackets = state.packets.filter((packet) => !resultFor(state, packet.packet_id));
  const requestDigests = {};
  for (const packet of pendingPackets) {
    writePinnedJson(
      path.join(directory, `${packet.packet_id}.json`),
      packet,
      `dispatched reference packet ${packet.packet_id}`,
      directory
    );
    const request = referenceDispatchRequest(state, packet);
    writePinnedJson(
      path.join(directory, `${packet.packet_id}.request.json`),
      request,
      `dispatched reference request ${packet.packet_id}`,
      directory
    );
    requestDigests[packet.packet_id] = request.request_digest;
  }
  let selectionTemplate = null;
  if (state.selection_scope_digest && !state.selection) {
    selectionTemplate = writeSelectionTemplate(state, directory);
  }
  return {
    run_id: state.run_id,
    journey_identity: structuredClone(state.journey_identity),
    status: state.status,
    directory,
    packet_count: pendingPackets.length,
    request_count: pendingPackets.length,
    request_digests: requestDigests,
    packet_digest: hashArtifact(directory),
    selection_template: selectionTemplate
  };
}

export function referenceExitCode(state) {
  if (["complete", "ready"].includes(state.status)) return 0;
  if (state.status === "manual_pending") return 6;
  return 5;
}
