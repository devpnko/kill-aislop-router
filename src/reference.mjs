import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { executeAuditPacket, inspectPacketAdapter } from "./execution.mjs";
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
const FIT_BANDS = ["exact", "adjacent", "weak"];
const FIT_BAND_WEIGHT = { exact: 3, adjacent: 2, weak: 1 };
const GRAMMAR_DIMENSIONS = new Set([
  "information-hierarchy", "navigation", "component-composition", "data-comparison",
  "evidence-presentation", "typography", "color-roles", "density", "interaction", "responsive"
]);
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

function timestamp(value, label) {
  string(value, label);
  requireValue(!Number.isNaN(Date.parse(value)), `${label} must be an ISO date-time`);
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
    "product_frame", "sources", "required_gate_ids"
  ]), "reference brief planning");
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

  exact(input.source, new Set(["provider", "access_mode", "rights", "queries"]),
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

  exact(input.coverage, new Set([
    "minimum_verified_references", "maximum_references", "required_component_families",
    "required_patterns", "required_grammar_dimensions"
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
  for (const [index, signal] of input.popularity_prior.signals.entries()) {
    exact(signal, new Set(["id", "metric", "weight"]),
      `reference brief popularity_prior.signals[${index}]`);
    safeId(signal.id, `reference brief popularity_prior.signals[${index}].id`);
    requireValue(["mau", "popular-rank", "curation-popularity"].includes(signal.metric),
      `unsupported popularity metric: ${signal.metric}`);
    requireValue(typeof signal.weight === "number" && signal.weight > 0,
      `reference brief popularity_prior.signals[${index}].weight must be positive`);
  }
  const requiredCannotAffect = ["eligibility", "hard-gates", "owner-approval"];
  uniqueStrings(input.popularity_prior.cannot_affect,
    "reference brief popularity_prior.cannot_affect");
  requireValue(requiredCannotAffect.every((item) => input.popularity_prior.cannot_affect.includes(item)),
    "popularity prior cannot affect eligibility, hard gates, or owner approval");

  exact(input.providers, new Set(["discovery", "grammar_extractor", "critic"]),
    "reference brief providers");
  for (const key of ["discovery", "grammar_extractor", "critic"]) {
    safeId(input.providers[key], `reference brief providers.${key}`);
  }
  requireValue(new Set(Object.values(input.providers)).size === 3,
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
  }
  return input;
}

function authoritySources(brief, root) {
  return {
    activation: resolveEvidence(root, brief.activation.evidence,
      "reference owner activation evidence").snapshot,
    rights: resolveEvidence(root, brief.source.rights.evidence,
      "reference rights evidence").snapshot,
    planning: brief.planning.sources.map((source) => ({
      id: source.id,
      ...resolveEvidence(root, source, `service-planning source ${source.id}`, { json: true }).snapshot
    }))
  };
}

function makePacket(state, { packetId, stageId, providerId, role, capabilities, strength, permissions, task }) {
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
    evidence_contract: { required_viewports: [], required_checks: [] },
    reference_task: task
  };
  packet.packet_digest = canonicalDigest(packet);
  return packet;
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
    task: {
      kind: "reference-discovery",
      brief_digest: state.brief_source.digest,
      product_frame: structuredClone(state.brief.planning.product_frame),
      source: structuredClone(state.brief.source),
      popularity_prior: structuredClone(state.brief.popularity_prior),
      maximum_references: state.brief.coverage.maximum_references,
      rule: "collect observations and popularity provenance; do not infer visual authority"
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
    task: {
      kind: "reference-grammar",
      subject_result_digest: discovery.result_digest,
      product_frame: structuredClone(state.brief.planning.product_frame),
      required_dimensions: [...state.brief.coverage.required_grammar_dimensions],
      rule: "separate source-linked observations from confidence-labelled inference"
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
    task: {
      kind: "reference-review",
      discovery_result_digest: discovery.result_digest,
      grammar_result_digest: grammar.result_digest,
      product_frame: structuredClone(state.brief.planning.product_frame),
      coverage: structuredClone(state.brief.coverage),
      popularity_rule: structuredClone(state.brief.popularity_prior),
      rule: "verify provenance, fit, and anti-copy safety without selecting for the owner"
    }
  });
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

function validateEvidence(result) {
  requireValue(Array.isArray(result.evidence) && result.evidence.length > 0,
    "reference result requires evidence", 4);
  const ids = new Set();
  for (const [index, evidence] of result.evidence.entries()) {
    exact(evidence, new Set(["evidence_id", "kind", "path"]),
      `reference result evidence[${index}]`);
    safeId(evidence.evidence_id, `reference result evidence[${index}].evidence_id`);
    requireValue(!ids.has(evidence.evidence_id),
      `duplicate reference evidence id: ${evidence.evidence_id}`, 4);
    ids.add(evidence.evidence_id);
    requireValue(["source-capture", "source-metadata", "analysis-report", "review-report"].includes(evidence.kind),
      `unsupported reference evidence kind: ${evidence.kind}`, 4);
    string(evidence.path, `reference result evidence[${index}].path`);
  }
  return ids;
}

function validateActor(result) {
  exact(result.actor, new Set(["actor_id", "kind"]), "reference result actor");
  string(result.actor.actor_id, "reference result actor.actor_id");
  requireValue(["agent", "skill", "human"].includes(result.actor.kind),
    "reference result actor.kind is invalid", 4);
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
  for (const [index, reference] of result.references.entries()) {
    exact(reference, new Set([
      "reference_id", "source", "app_name", "product_category", "screen_family",
      "component_families", "patterns", "observed", "popularity", "rights"
    ]), `reference discovery references[${index}]`);
    safeId(reference.reference_id, `reference discovery references[${index}].reference_id`);
    requireValue(!ids.has(reference.reference_id),
      `duplicate reference id: ${reference.reference_id}`, 4);
    ids.add(reference.reference_id);
    exact(reference.source, new Set(["provider", "uri", "record_id", "captured_at"]),
      `reference ${reference.reference_id}.source`);
    requireValue(reference.source.provider === "uibowl", "discovered source provider must be uibowl", 4);
    validateSourceUri(reference.source.uri);
    string(reference.source.record_id, `reference ${reference.reference_id}.source.record_id`);
    timestamp(reference.source.captured_at, `reference ${reference.reference_id}.source.captured_at`);
    for (const field of ["app_name", "product_category", "screen_family"]) {
      string(reference[field], `reference ${reference.reference_id}.${field}`);
    }
    uniqueStrings(reference.component_families,
      `reference ${reference.reference_id}.component_families`);
    uniqueStrings(reference.patterns, `reference ${reference.reference_id}.patterns`);
    requireValue(Array.isArray(reference.observed) && reference.observed.length > 0,
      `reference ${reference.reference_id} requires observations`, 4);
    const observationIds = new Set();
    for (const observation of reference.observed) {
      exact(observation, new Set(["observation_id", "kind", "statement", "evidence_ids"]),
        `reference ${reference.reference_id} observation`);
      safeId(observation.observation_id, "reference observation_id");
      requireValue(!observationIds.has(observation.observation_id),
        `duplicate observation id: ${observation.observation_id}`, 4);
      observationIds.add(observation.observation_id);
      requireValue(["structure", "hierarchy", "component", "navigation", "type", "color", "state"].includes(observation.kind),
        `unsupported observation kind: ${observation.kind}`, 4);
      string(observation.statement, "reference observation statement");
      uniqueStrings(observation.evidence_ids, "reference observation evidence_ids");
      requireValue(observation.evidence_ids.every((id) => evidenceIds.has(id)),
        `reference observation ${observation.observation_id} cites unknown evidence`, 4);
    }
    exact(reference.popularity, new Set(["signals"]),
      `reference ${reference.reference_id}.popularity`);
    requireValue(Array.isArray(reference.popularity.signals) &&
      reference.popularity.signals.length === state.brief.popularity_prior.signals.length,
    `reference ${reference.reference_id} must report every configured popularity signal`, 4);
    const expectedSignals = new Map(state.brief.popularity_prior.signals.map((item) => [item.id, item]));
    const seenSignals = new Set();
    for (const signal of reference.popularity.signals) {
      exact(signal, new Set([
        "id", "metric", "raw_value", "normalized_score", "scope", "category", "as_of", "evidence_ids"
      ]), `reference ${reference.reference_id} popularity signal`);
      const expected = expectedSignals.get(signal.id);
      requireValue(expected && expected.metric === signal.metric,
        `reference ${reference.reference_id} popularity signal is not configured: ${signal.id}`, 4);
      requireValue(!seenSignals.has(signal.id),
        `reference ${reference.reference_id} repeats popularity signal: ${signal.id}`, 4);
      seenSignals.add(signal.id);
      requireValue(typeof signal.raw_value === "number" && Number.isFinite(signal.raw_value),
        `reference ${reference.reference_id} popularity raw_value must be numeric`, 4);
      requireValue(typeof signal.normalized_score === "number" &&
        signal.normalized_score >= 0 && signal.normalized_score <= 100,
      `reference ${reference.reference_id} popularity normalized_score must be 0-100`, 4);
      string(signal.scope, `reference ${reference.reference_id} popularity.scope`);
      string(signal.category, `reference ${reference.reference_id} popularity.category`);
      timestamp(signal.as_of, `reference ${reference.reference_id} popularity.as_of`);
      uniqueStrings(signal.evidence_ids,
        `reference ${reference.reference_id} popularity.evidence_ids`);
      requireValue(signal.evidence_ids.every((id) => evidenceIds.has(id)),
        `reference ${reference.reference_id} popularity cites unknown evidence`, 4);
    }
    exact(reference.rights, new Set(["status", "redistribution", "creator_pixel_access"]),
      `reference ${reference.reference_id}.rights`);
    requireValue(reference.rights.status === state.brief.source.rights.status &&
      reference.rights.redistribution === false && reference.rights.creator_pixel_access === false,
    `reference ${reference.reference_id} weakens the source rights boundary`, 4);
  }
}

function validateGrammar(state, result, discovery) {
  requireValue(result.subject_result_digest === discovery.result_digest,
    "reference grammar subject digest mismatch", 4);
  requireValue(result.actor.actor_id !== discovery.normalized.actor.actor_id,
    "reference grammar researcher must use a distinct actor from discovery", 4);
  requireValue(Array.isArray(result.references) &&
    result.references.length === discovery.normalized.references.length,
  "reference grammar must cover every discovered reference", 4);
  const discovered = new Map(discovery.normalized.references.map((item) => [item.reference_id, item]));
  const grammarIds = new Set();
  const coveredReferences = new Set();
  for (const entry of result.references) {
    exact(entry, new Set([
      "reference_id", "product_fit", "inferred_rationale", "grammar"
    ]), `reference grammar ${entry.reference_id || "unknown"}`);
    const source = discovered.get(entry.reference_id);
    requireValue(source, `reference grammar cites unknown reference: ${entry.reference_id}`, 4);
    requireValue(!coveredReferences.has(entry.reference_id),
      `reference grammar repeats reference: ${entry.reference_id}`, 4);
    coveredReferences.add(entry.reference_id);
    const observationIds = new Set(source.observed.map((item) => item.observation_id));
    exact(entry.product_fit, new Set(["band", "score", "dimensions", "rationale", "observed_ids"]),
      `reference grammar ${entry.reference_id}.product_fit`);
    requireValue(FIT_BANDS.includes(entry.product_fit.band),
      `reference grammar ${entry.reference_id} fit band is invalid`, 4);
    requireValue(Number.isInteger(entry.product_fit.score) && entry.product_fit.score >= 0 &&
      entry.product_fit.score <= 100,
    `reference grammar ${entry.reference_id} fit score must be 0-100`, 4);
    object(entry.product_fit.dimensions, `reference grammar ${entry.reference_id} fit dimensions`);
    for (const dimension of ["user", "task", "screen", "trust", "density"]) {
      requireValue(Number.isInteger(entry.product_fit.dimensions[dimension]) &&
        entry.product_fit.dimensions[dimension] >= 0 && entry.product_fit.dimensions[dimension] <= 5,
      `reference grammar ${entry.reference_id} fit dimension ${dimension} must be 0-5`, 4);
    }
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
    requireValue(Array.isArray(entry.grammar) && entry.grammar.length > 0,
      `reference grammar ${entry.reference_id} requires transferable grammar`, 4);
    for (const grammar of entry.grammar) {
      exact(grammar, new Set([
        "grammar_id", "dimension", "principle", "application", "avoid", "observed_ids"
      ]), `reference grammar ${entry.reference_id} principle`);
      safeId(grammar.grammar_id, "reference grammar_id");
      requireValue(!grammarIds.has(grammar.grammar_id), `duplicate grammar id: ${grammar.grammar_id}`, 4);
      grammarIds.add(grammar.grammar_id);
      requireValue(GRAMMAR_DIMENSIONS.has(grammar.dimension),
        `unsupported grammar dimension: ${grammar.dimension}`, 4);
      for (const field of ["principle", "application", "avoid"]) {
        string(grammar[field], `reference grammar ${grammar.grammar_id}.${field}`);
      }
      const language = `${grammar.principle} ${grammar.application} ${grammar.avoid}`;
      requireValue(!/#[0-9a-f]{3,8}\b|\b\d+(?:\.\d+)?px\b|\b(?:clone|pixel[- ]?copy)\b/i.test(language),
        `reference grammar ${grammar.grammar_id} contains source-specific copying instructions`, 4);
      uniqueStrings(grammar.observed_ids, `reference grammar ${grammar.grammar_id}.observed_ids`);
      requireValue(grammar.observed_ids.every((id) => observationIds.has(id)),
        `reference grammar ${grammar.grammar_id} cites unknown observation`, 4);
    }
  }
}

function validateReview(state, result, discovery, grammar) {
  requireValue(result.discovery_result_digest === discovery.result_digest &&
    result.grammar_result_digest === grammar.result_digest,
  "reference review subject digest mismatch", 4);
  const priorActors = new Set([discovery.normalized.actor.actor_id, grammar.normalized.actor.actor_id]);
  requireValue(!priorActors.has(result.actor.actor_id),
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
      "verified_component_families", "verified_patterns",
      "verified_observation_ids", "verified_inference_ids", "verified_grammar_ids",
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
      typeof disposition.product_fit_verified === "boolean",
    `reference review verification flags must be boolean: ${disposition.reference_id}`, 4);
    requireValue(["low", "medium", "high"].includes(disposition.copy_risk),
      `reference review copy_risk is invalid: ${disposition.reference_id}`, 4);
    uniqueStrings(disposition.verified_component_families,
      `reference review ${disposition.reference_id}.verified_component_families`, { min: 0 });
    uniqueStrings(disposition.verified_patterns,
      `reference review ${disposition.reference_id}.verified_patterns`, { min: 0 });
    uniqueStrings(disposition.verified_observation_ids,
      `reference review ${disposition.reference_id}.verified_observation_ids`, { min: 0 });
    uniqueStrings(disposition.verified_inference_ids,
      `reference review ${disposition.reference_id}.verified_inference_ids`, { min: 0 });
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
    const validInferences = new Set(grammarEntry.inferred_rationale.map((item) => item.inference_id));
    const validGrammar = new Set(grammarEntry.grammar.map((item) => item.grammar_id));
    requireValue(disposition.verified_component_families.every((item) =>
      discoveredReference.component_families.includes(item)) &&
      disposition.verified_patterns.every((item) => discoveredReference.patterns.includes(item)),
    `reference review ${disposition.reference_id} verifies an undeclared component or pattern`, 4);
    requireValue(disposition.verified_observation_ids.every((id) => validObserved.has(id)) &&
      disposition.verified_inference_ids.every((id) => validInferences.has(id)) &&
      disposition.verified_grammar_ids.every((id) => validGrammar.has(id)),
    `reference review ${disposition.reference_id} verifies unknown evidence`, 4);
    if (disposition.status === "eligible") {
      requireValue(disposition.popularity_verified && disposition.product_fit_verified &&
        disposition.copy_risk !== "high" && disposition.blockers.length === 0 &&
        disposition.verified_component_families.length > 0 &&
        disposition.verified_patterns.length > 0 &&
        disposition.verified_observation_ids.length > 0 &&
        disposition.verified_inference_ids.length > 0 &&
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
    const resolved = path.isAbsolute(item.path)
      ? path.resolve(item.path)
      : path.resolve(evidenceBoundary || process.cwd(), item.path);
    if (evidenceBoundary) {
      requireValue(inside(resolved, evidenceBoundary),
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
    return {
      evidence_id: item.evidence_id,
      evidence_kind: item.kind,
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
  const record = {
    packet_id: packet.packet_id,
    provider_id: packet.provider.id,
    participant: structuredClone(packet.participant),
    result_digest: canonicalDigest(normalized),
    source: boundSource,
    evidence: snapshotResultEvidence(normalized, state.state_directory, evidenceBoundary),
    normalized,
    recorded_at: nowIso()
  };
  state.results.push(record);
  return record;
}

export function readReferenceState(statePath) {
  const absolute = path.resolve(statePath);
  const state = readPinnedJson(absolute, "reference intelligence run").input;
  requireValue(state.reference_intelligence_run_version === 1,
    "reference_intelligence_run_version must be 1", 4);
  requireValue(path.resolve(state.state_path) === absolute,
    "reference state path does not match the resume target", 4);
  requireValue(canonicalDigest(stateBody(state)) === state.state_digest,
    "reference state digest mismatch", 4);
  verifyJourneyIdentity(state.journey_identity, {
    runId: state.run_id,
    label: "reference intelligence journey_identity"
  });
  validateReferenceBrief(state.brief, { verifyEvidence: false });
  verifyBoundSnapshot(state.brief_source, "reference brief");
  const sourceBrief = readPinnedJson(state.brief_source.resolved_path, "reference brief").input;
  requireValue(canonicalDigest(sourceBrief) === canonicalDigest(state.brief),
    "reference brief state binding mismatch", 4);
  verifyBoundSnapshot(state.authority_sources.activation, "reference owner activation evidence");
  verifyBoundSnapshot(state.authority_sources.rights, "reference rights evidence");
  for (const source of state.authority_sources.planning) {
    verifyBoundSnapshot(source, `service-planning source ${source.id}`);
  }
  for (const packet of state.packets) {
    verifyPacketJourney(packet, state.journey_identity, `reference packet ${packet.packet_id}`);
    requireValue(canonicalDigest(packetBody(packet)) === packet.packet_digest,
      `reference packet digest mismatch: ${packet.packet_id}`, 4);
    verifyBoundSnapshot(state.packet_files[packet.packet_id],
      `reference packet file ${packet.packet_id}`);
  }
  for (const record of state.results) {
    verifyBoundSnapshot(record.source, `reference result ${record.packet_id}`);
    requireValue(canonicalDigest(record.normalized) === record.result_digest,
      `reference result digest mismatch: ${record.packet_id}`, 4);
    const sourceResult = readPinnedJson(record.source.resolved_path,
      `reference result ${record.packet_id}`).input;
    requireValue(canonicalDigest(sourceResult) === record.result_digest,
      `reference result source binding mismatch: ${record.packet_id}`, 4);
    const packet = state.packets.find((item) => item.packet_id === record.packet_id);
    validateReferenceResult(state, packet, sourceResult);
    for (const evidence of record.evidence) {
      verifyBoundSnapshot(evidence, `reference evidence ${record.packet_id}/${evidence.evidence_id}`);
    }
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
  if (state.selection) {
    verifyBoundSnapshot(state.selection.source, "reference owner selection");
    const sourceSelection = readPinnedJson(state.selection.source.resolved_path,
      "reference owner selection").input;
    requireValue(canonicalDigest(sourceSelection) === state.selection.selection_digest &&
      canonicalDigest(sourceSelection) === canonicalDigest(state.selection.normalized),
    "reference owner selection state binding mismatch", 4);
  }
  if (state.outputs.reference_pack) {
    verifyBoundSnapshot(state.outputs.reference_pack, "reference intelligence pack");
    const pack = readPinnedJson(state.outputs.reference_pack.resolved_path,
      "reference intelligence pack").input;
    const { pack_digest: packDigest, ...packBody } = pack;
    requireValue(canonicalDigest(packBody) === packDigest,
      "reference intelligence pack digest mismatch", 4);
  }
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
      ...state.authority_sources.planning
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
      attempted_at: nowIso()
    });
    writeState(state, lease, { faultInjector });
    return;
  }
  const outputDirectory = path.join(
    state.state_directory, "evidence", packet.packet_id, `attempt-${attempt}`
  );
  state.in_flight = {
    packet_id: packet.packet_id,
    provider_id: packet.provider.id,
    attempt,
    packet_digest: packet.packet_digest,
    started_at: nowIso()
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
  const executed = executeAuditPacket({
    run: adapterRun(state, packet),
    packet,
    manifest,
    attempt,
    outputDirectory,
    outputGrantRoot: state.state_directory
  });
  const { result, declaration: _declaration, evidence_boundary: _boundary, ...attemptRecord } = executed;
  const stored = {
    ...attemptRecord,
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
    return disposition?.status === "eligible" && disposition.popularity_verified &&
      disposition.product_fit_verified && disposition.copy_risk !== "high" &&
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
  const ranking = eligible.map((reference) => {
    const fit = grammarEntries.get(reference.reference_id).product_fit;
    return {
      reference_id: reference.reference_id,
      product_fit_band: fit.band,
      product_fit_score: fit.score,
      popularity_score: popularityScore(state, reference),
      popularity_signals: reference.popularity.signals.map((item) => item.id)
    };
  }).sort((left, right) =>
    FIT_BAND_WEIGHT[right.product_fit_band] - FIT_BAND_WEIGHT[left.product_fit_band] ||
    right.popularity_score - left.popularity_score ||
    right.product_fit_score - left.product_fit_score ||
    left.reference_id.localeCompare(right.reference_id));
  return { eligible, ranking, blockers };
}

function popularityScore(state, reference) {
  const weights = new Map(state.brief.popularity_prior.signals.map((item) => [item.id, item.weight]));
  let numerator = 0;
  let denominator = 0;
  for (const signal of reference.popularity.signals) {
    const weight = weights.get(signal.id);
    numerator += signal.normalized_score * weight;
    denominator += weight;
  }
  return Number((numerator / denominator).toFixed(6));
}

function selectionScope(state, ranking) {
  return canonicalDigest({
    run_id: state.run_id,
    journey_identity: state.journey_identity,
    brief_digest: state.brief_source.digest,
    planning_digests: state.authority_sources.planning.map((item) => item.digest),
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

function ingestSelection(state, lease, selectionPath, faultInjector = null) {
  requireValue(!state.selection, "reference owner selection is already digest-bound", 4);
  requireValue(!inside(selectionPath, state.state_directory),
    "reference owner selection must be supplied from outside the child-writable state directory", 4);
  const pinned = readPinnedJson(selectionPath, "reference owner selection");
  const input = pinned.input;
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
  string(input.owner_id, "reference owner selection owner_id");
  requireValue(!/^REPLACE_WITH_/i.test(input.owner_id),
    "reference owner selection still contains an owner placeholder", 4);
  const participantActors = state.results.map((item) => item.normalized.actor.actor_id);
  requireValue(!Object.values(state.brief.providers).includes(input.owner_id) &&
    !participantActors.includes(input.owner_id),
  "reference research participant cannot act as owner", 4);
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
      byId.get(id).app_name !== byId.get(input.anchor_reference_id).app_name),
    "reference support must include a different product to reduce cloning risk", 4);
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

function compileReferencePack(state) {
  const discovery = resultFor(state, "reference-discovery").normalized;
  const grammar = resultFor(state, "reference-grammar").normalized;
  const selection = state.selection.normalized;
  const selectedReferenceIds = new Set([
    selection.anchor_reference_id,
    ...selection.supporting_reference_ids
  ]);
  const references = discovery.references.filter((item) => selectedReferenceIds.has(item.reference_id))
    .map((item) => ({
      reference_id: item.reference_id,
      role: item.reference_id === selection.anchor_reference_id ? "anchor" : "support",
      source: {
        provider: item.source.provider,
        uri: item.source.uri,
        record_id: item.source.record_id,
        captured_at: item.source.captured_at
      },
      app_name: item.app_name,
      product_category: item.product_category,
      screen_family: item.screen_family,
      component_families: item.component_families,
      patterns: item.patterns,
      popularity: {
        signals: item.popularity.signals,
        computed_score: popularityScore(state, item)
      }
    }));
  const verifiedGrammar = grammar.references.filter((entry) => selectedReferenceIds.has(entry.reference_id))
    .flatMap((entry) => entry.grammar.map((item) => ({ ...item, reference_id: entry.reference_id })))
    .filter((item) => selection.selected_grammar_ids.includes(item.grammar_id));
  const pack = {
    reference_pack_version: 1,
    run_id: state.run_id,
    journey_identity: structuredClone(state.journey_identity),
    project_id: state.brief.project_id,
    surface: state.brief.surface,
    authority_scope: "discovery-evidence-only",
    planning_frame: structuredClone(state.brief.planning.product_frame),
    selection: {
      owner_id: selection.owner_id,
      selection_digest: state.selection.selection_digest,
      anchor_reference_id: selection.anchor_reference_id,
      supporting_reference_ids: selection.supporting_reference_ids,
      rationale: selection.rationale
    },
    references,
    verified_grammar: verifiedGrammar,
    ranking_policy: {
      primary: "product-fit-band",
      within_band: "popularity-descending",
      popularity_cannot_affect: ["eligibility", "hard-gates", "owner-approval"]
    },
    downstream_contract: {
      source_pixels_included: false,
      visual_authority_granted: false,
      visual_signature_granted: false,
      design_creation_started: false,
      exact_three_3x3_route_unchanged: true,
      required_next_gate: "separate KillSlopRouter design exploration with visual authority and owner gates"
    },
    provenance: {
      brief_digest: state.brief_source.digest,
      planning_digests: state.authority_sources.planning.map((item) => item.digest),
      rights_digest: state.authority_sources.rights.digest,
      result_digests: Object.fromEntries(state.results.map((item) => [item.packet_id, item.result_digest])),
      selection_scope_digest: state.selection_scope_digest
    },
    compiled_at: nowIso(),
    pack_digest: null
  };
  pack.pack_digest = canonicalDigest({ ...pack, pack_digest: undefined });
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
    const state = sealState({
      reference_intelligence_run_version: 1,
      run_id: runId,
      journey_identity: createJourneyIdentity({ runId, routerId, routerVersion, invocation }),
      status: "running",
      phase: "reference-discovery",
      created_at: nowIso(),
      updated_at: nowIso(),
      state_path: absoluteState,
      state_directory: stateDirectory(absoluteState),
      brief,
      brief_source: pinnedSnapshot(pinnedBrief, root),
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
      state.attempts.push({
        packet_id: active.packet_id,
        provider_id: active.provider_id,
        attempt: active.attempt,
        packet_digest: active.packet_digest,
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

function dryPacket(state, packetId, stageId, providerId, role, capabilities, strength, permissions, kind) {
  return makePacket(state, {
    packetId,
    stageId,
    providerId,
    role,
    capabilities,
    strength,
    permissions,
    task: { kind, dry_run: true }
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
  const state = {
    run_id: "dry-run",
    journey_identity: createJourneyIdentity({
      runId: "dry-run", routerId, routerVersion, invocation
    }),
    brief,
    brief_source: pinnedSnapshot(pinnedBrief, root)
  };
  const packets = [
    dryPacket(state, "dry-reference-discovery", "reference-discovery",
      brief.providers.discovery, "researcher", DISCOVERY_CAPABILITIES, 3,
      ["artifact:read", "evidence:write",
        ...(brief.source.access_mode === "authorized-read-only-adapter" ? ["network:external"] : [])],
      "reference-discovery"),
    dryPacket(state, "dry-reference-grammar", "reference-grammar",
      brief.providers.grammar_extractor, "researcher", GRAMMAR_CAPABILITIES, 3,
      ["artifact:read", "evidence:write"], "reference-grammar"),
    dryPacket(state, "dry-reference-review", "reference-review",
      brief.providers.critic, "critic", REVIEW_CAPABILITIES, 4,
      ["artifact:read", "evidence:write"], "reference-review")
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
      "independent-review", "anti-copy", "owner-reference-selection",
      "separate-visual-authority", "separate-design-playwright", "separate-owner-approval"
    ],
    downstream: "discovery evidence only; exact-three 3x3 design exploration remains unchanged"
  };
}

export function dispatchReferencePackets(state, outputDirectory) {
  const directory = path.resolve(outputDirectory);
  ensureSecureDirectory(directory, "reference dispatch directory");
  const pendingPackets = state.packets.filter((packet) => !resultFor(state, packet.packet_id));
  for (const packet of pendingPackets) {
    writePinnedJson(
      path.join(directory, `${packet.packet_id}.json`),
      packet,
      `dispatched reference packet ${packet.packet_id}`,
      directory
    );
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
    packet_digest: hashArtifact(directory),
    selection_template: selectionTemplate
  };
}

export function referenceExitCode(state) {
  if (["complete", "ready"].includes(state.status)) return 0;
  if (state.status === "manual_pending") return 6;
  return 5;
}
