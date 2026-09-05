import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  executeAuditPacket,
  inspectPacketAdapter,
  loadHostManifest
} from "./execution.mjs";
import {
  canonicalDigest,
  hashArtifact,
  publicSnapshot,
  readJsonPinned,
  snapshotArtifact,
  verifySnapshot,
  writeJsonAtomic
} from "./integrity.mjs";
import {
  RouterError,
  VALID_EDITORIAL_TREATMENTS,
  VALID_SURFACES,
  VALID_VISUAL_DEPTH,
  VALID_VISUAL_ENERGY,
  resolveVisualIntent,
  resolveVisualSignature,
  validateVisualIntentContract,
  validateVisualSignatureContract,
  visualIntentBody,
  visualSignatureBody
} from "./router.mjs";
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
import {
  readReferenceState,
  referenceSourceRecipientExecutionLineage,
  validateReferencePack
} from "./reference.mjs";
import {
  PLAYWRIGHT_ADAPTER_CONTRACT,
  PLAYWRIGHT_PROVIDER_TARGET
} from "./playwright.mjs";
import { claimsSourceCompositionCopy } from "./source-composition.mjs";
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

export const DESIGN_DEPTHS = ["refine", "evolve", "reimagine"];
export const DESIGN_RESULT_KINDS = new Set([
  "direction-candidate",
  "browser-evidence",
  "direction-review",
  "color-candidate",
  "color-review"
]);

const ZERO_DIGEST = `sha256:${"0".repeat(64)}`;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
function stringLeaves(value) {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap((item) => stringLeaves(item));
  if (value && typeof value === "object") {
    return Object.values(value).flatMap((item) => stringLeaves(item));
  }
  return [];
}

function readPinnedDesignJson(target, label) {
  try {
    return readJsonPinned(target, { label });
  } catch (error) {
    throw new RouterError(error.message, 4);
  }
}

function pinnedDesignSnapshot(pinned, root) {
  const absoluteRoot = path.resolve(root || process.cwd());
  const relative = path.relative(absoluteRoot, pinned.path);
  const display = relative && !relative.startsWith("..") && !path.isAbsolute(relative)
    ? relative.split(path.sep).join("/")
    : (!relative ? "." : pinned.path);
  return {
    path: display,
    resolved_path: pinned.path,
    kind: "file",
    bytes: pinned.bytes,
    digest: pinned.digest,
    physical_identity_digest: pinned.physical_identity_digest
  };
}
const HEX_PATTERN = /^#[0-9A-F]{6}$/;
const CSS_TOKEN_PATTERN = /^--[a-z0-9][a-z0-9-]*$/;
const DESIGN_EVIDENCE_KINDS = new Set([
  "prototype", "screenshot", "test-report", "review-report", "token-spec", "font-report",
  "design-contract", "source-composition-analysis"
]);
const REFERENCE_TRACE_DISPOSITIONS = new Set(["applied", "not-applicable"]);
const RESERVED_DESIGN_EVIDENCE_ROLES = new Map([
  ["candidate-rationale", ["candidate-field", "rationale"]],
  ["reference-reasoning-trace", ["candidate-field", "reference-reasoning-trace"]],
  ["prototype", ["candidate-evidence", "prototype"]],
  ["review-report", ["review-evidence", "review-report"]],
  ["browser-evidence", ["browser-result", "result"]],
  ["state-evidence", ["browser-evidence", "test-report"]],
  ["playwright-evidence", ["browser-evidence", "test-report"]],
  ["contrast-report", ["browser-evidence", "test-report"]],
  ["color-role-map", ["candidate-evidence", "token-spec"]],
  ["reference-capture-set", ["reference-authority", "source-capture-set"]],
  ["source-composition-analysis", ["review-evidence", "source-composition-analysis"]]
]);
const FONT_AVAILABILITY = new Set(["embedded", "bundled", "installed", "licensed"]);
const PLAYWRIGHT_CHECKS = new Set([
  "keyboard", "state", "overflow", "contrast", "zoom-200", "visual-regression",
  "screen-reader", "aria-semantics", "console", "network"
]);
const REQUIRED_BROWSER_CAPABILITIES = [
  "responsive-evidence",
  "keyboard-evidence",
  "state-evidence",
  "overflow-evidence",
  "contrast-evidence",
  "zoom-evidence"
];
const DIRECTION_CAPABILITIES = [
  "design-direction-generation",
  "baseline-preservation",
  "responsive-prototype",
  "locale-prototype"
];
const DIRECTION_REVIEW_CAPABILITIES = [
  "product-fit-review",
  "visual-distinctiveness-review",
  "baseline-preservation-review",
  "responsive-review"
];
const COLOR_CAPABILITIES = [
  "color-system-generation",
  "semantic-color-roles",
  "contrast-aware-palette",
  "responsive-prototype"
];
const COLOR_REVIEW_CAPABILITIES = [
  "color-harmony-review",
  "semantic-role-review",
  "contrast-review",
  "brand-fit-review"
];
const REQUIRED_COLOR_ROLES = [
  "canvas", "surface", "surface_raised",
  "text_primary", "text_secondary", "text_muted", "text_inverse",
  "border_subtle", "border_default", "border_strong", "focus_ring",
  "action_primary", "action_primary_hover", "action_primary_pressed", "action_disabled", "on_action",
  "accent", "accent_hover", "on_accent",
  "success", "on_success", "warning", "on_warning", "danger", "on_danger", "info", "on_info"
];
const DIRECTION_CRITERIA = [
  "beauty_lift", "product_fit", "trust_clarity", "density_fit",
  "responsiveness", "implementation", "distinctiveness", "redesign_depth_fidelity", "typography_fit"
];
const COLOR_CRITERIA = [
  "project_fit", "harmony", "role_clarity", "contrast",
  "semantic_separation", "locale_resilience", "distinctiveness"
];

function requireValue(condition, message, exitCode = 2) {
  if (!condition) throw new RouterError(message, exitCode);
}

function object(value, label) {
  requireValue(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  return value;
}

function exact(value, allowed, label) {
  object(value, label);
  for (const key of Object.keys(value)) {
    requireValue(allowed.has(key), `${label} contains unsupported field: ${key}`);
  }
}

function string(value, label) {
  requireValue(typeof value === "string" && value.trim(), `${label} must be a non-empty string`);
  return value;
}

function uniqueStrings(value, label, { empty = false } = {}) {
  requireValue(Array.isArray(value) && (empty || value.length > 0),
    `${label} must contain ${empty ? "unique" : "one or more unique"} strings`);
  value.forEach((item, index) => string(item, `${label}[${index}]`));
  requireValue(new Set(value).size === value.length, `${label} contains duplicates`);
  return value;
}

function safeId(value, label) {
  string(value, label);
  requireValue(ID_PATTERN.test(value), `${label} must use letters, numbers, dot, underscore, or hyphen`);
  return value;
}

function sameSet(left, right) {
  return left.length === right.length && left.every((item) => right.includes(item));
}

function containsAll(actual, required) {
  return required.every((item) => actual.includes(item));
}

function stateBody(state) {
  const { state_digest: _digest, ...body } = state;
  return body;
}

function sealState(state) {
  state.state_digest = canonicalDigest(stateBody(state));
  return state;
}

function nowIso(now = null) {
  return (now ? new Date(now) : new Date()).toISOString();
}

function stateDirectory(statePath) {
  const absolute = path.resolve(statePath);
  const extension = path.extname(absolute);
  return `${extension ? absolute.slice(0, -extension.length) : absolute}.design`;
}

function inside(candidate, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function validateStateLocation(statePath, baselinePath) {
  const baseline = path.resolve(baselinePath);
  if (!fs.existsSync(baseline) || !fs.lstatSync(baseline).isDirectory()) return;
  for (const target of [path.resolve(statePath), stateDirectory(statePath)]) {
    if (!inside(target, baseline)) continue;
    const first = path.relative(baseline, target).split(path.sep)[0];
    requireValue(first === ".killsloprouter",
      "design state inside a directory baseline must live under its ignored .killsloprouter directory");
  }
}

function writeState(state, lease, { inFlight = false, faultInjector = null } = {}) {
  state.updated_at = nowIso();
  sealState(state);
  prepareStateLeaseWrite(lease, state.state_digest);
  writeJsonAtomic(state.state_path, state, {
    label: "design exploration state",
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

function packetBody(packet) {
  const { packet_digest: _digest, ...body } = packet;
  return body;
}

function makePacket(state, {
  packetId,
  stageId,
  providerId,
  resolvedTo = null,
  capabilities,
  strength,
  permissions,
  forbiddenPermissions = [],
  task,
  viewports = [],
  checks = []
}) {
  const packet = {
    design_packet_version: 1,
    packet_id: packetId,
    run_id: state.run_id,
    journey_identity: structuredClone(state.journey_identity),
    participant: createParticipant({
      providerId,
      stageId,
      designTaskKind: task.kind
    }),
    stage_id: stageId,
    provider: {
      id: providerId,
      kind: "external",
      version: null,
      ...(resolvedTo ? { resolved_to: resolvedTo } : {})
    },
    assigned_capabilities: [...capabilities],
    minimum_strength: strength,
    required_permissions: [...permissions],
    ...(forbiddenPermissions.length ? {
      forbidden_permissions: [...forbiddenPermissions]
    } : {}),
    evidence_contract: {
      required_viewports: [...viewports],
      required_checks: [...checks]
    },
    design_task: task
  };
  packet.packet_digest = canonicalDigest(packet);
  return packet;
}

function directionCandidateId(directionId, depth) {
  return `${directionId}--${depth}`;
}

function colorCandidateId(designId, strategyId) {
  return `${designId}--${strategyId}`;
}

function referenceForbiddenPermissions(state, { reviewer = false } = {}) {
  if (!state.reference_pack) return [];
  return reviewer
    ? ["network:external"]
    : ["network:external", "reference-evidence:read"];
}

function directionPackets(state) {
  return state.brief.directions.flatMap((direction) => DESIGN_DEPTHS.map((depth) => {
    const candidateId = directionCandidateId(direction.id, depth);
    return makePacket(state, {
      packetId: `direction-${candidateId}`,
      stageId: "design-direction-generation",
      providerId: direction.creator_provider_id,
      capabilities: DIRECTION_CAPABILITIES,
      strength: 3,
      permissions: ["artifact:read", "evidence:write"],
      forbiddenPermissions: referenceForbiddenPermissions(state),
      task: {
        kind: "direction-candidate",
        candidate_id: candidateId,
        direction,
        redesign_depth: depth,
        project: state.brief.product,
        baseline_policy: state.brief.baseline_policy,
        editorial_boundary: state.brief.editorial_boundary,
        locales: state.brief.locales,
        required_states: state.brief.evidence.required_states,
        baseline_digest: state.baseline.digest,
        brief_digest: state.brief_source.digest,
        ...(state.reference_pack ? {
          reference_intelligence: referenceDesignContract(
            state, "direction-review", "creator"
          )
        } : {})
      }
    });
  }));
}

function browserPacket(state, subjectRecord) {
  const result = subjectRecord.normalized;
  const prototypePaths = result.evidence.filter((item) => item.kind === "prototype").map((item) => item.path);
  const prototypes = prototypePaths.map((prototypePath) => {
    const snapshot = subjectRecord.evidence.find((item) => item.resolved_path === path.resolve(prototypePath));
    requireValue(snapshot, `prototype snapshot is missing for ${prototypePath}`, 4);
    return { path: snapshot.resolved_path, digest: snapshot.digest };
  });
  return makePacket(state, {
    packetId: `browser-${result.candidate_id}`,
    stageId: "browser-evidence",
    providerId: state.brief.providers.browser_evidence,
    resolvedTo: state.reference_pack ? PLAYWRIGHT_PROVIDER_TARGET : null,
    capabilities: REQUIRED_BROWSER_CAPABILITIES,
    strength: 3,
    permissions: ["artifact:read", "evidence:write", "browser:control"],
    forbiddenPermissions: referenceForbiddenPermissions(state),
    viewports: state.brief.evidence.required_viewports,
    checks: state.brief.evidence.required_checks,
    task: {
      kind: "browser-evidence",
      subject_kind: result.kind,
      subject_id: result.candidate_id,
      subject_result_digest: subjectRecord.result_digest,
      prototype_paths: prototypePaths,
      prototypes,
      locales: state.brief.locales,
      required_states: state.brief.evidence.required_states
    }
  });
}

function reviewPacket(state, kind, records) {
  const direction = kind === "direction-review";
  const providerId = direction
    ? state.brief.providers.direction_reviewer
    : state.brief.providers.color_reviewer;
  return makePacket(state, {
    packetId: direction ? "direction-review" : "color-review",
    stageId: kind,
    providerId,
    capabilities: [
      ...(direction ? DIRECTION_REVIEW_CAPABILITIES : COLOR_REVIEW_CAPABILITIES),
      ...(state.reference_pack ? ["reference-source-composition-review"] : [])
    ],
    strength: 4,
    permissions: [
      "artifact:read", "evidence:write",
      ...(state.reference_pack ? ["reference-evidence:read"] : [])
    ],
    forbiddenPermissions: referenceForbiddenPermissions(state, { reviewer: true }),
    task: {
      kind,
      candidate_ids: records.map((record) => record.normalized.candidate_id),
      result_digests: Object.fromEntries(records.map((record) => [
        record.normalized.candidate_id,
        record.result_digest
      ])),
      candidate_bindings: Object.fromEntries(records.map((record) => [
        record.normalized.candidate_id,
        resultBinding(state, record)
      ])),
      browser_result_digests: Object.fromEntries(records.map((record) => {
        const browser = resultForCandidate(state, record.normalized.candidate_id, "browser-evidence");
        requireValue(browser, `browser evidence is missing for ${record.normalized.candidate_id}`, 4);
        return [record.normalized.candidate_id, browser.result_digest];
      })),
      browser_bindings: Object.fromEntries(records.map((record) => {
        const browser = resultForCandidate(state, record.normalized.candidate_id, "browser-evidence");
        requireValue(browser, `browser evidence is missing for ${record.normalized.candidate_id}`, 4);
        return [record.normalized.candidate_id, resultBinding(state, browser)];
      })),
      criteria: direction ? DIRECTION_CRITERIA : COLOR_CRITERIA,
      project: state.brief.product,
      baseline_policy: state.brief.baseline_policy,
      ...(state.reference_pack ? {
        reference_intelligence: referenceDesignContract(
          state, kind, "independent-reviewer"
        )
      } : {})
    }
  });
}

function colorPackets(state) {
  return state.shortlist.normalized.candidate_ids.flatMap((designId) =>
    state.brief.color_strategies.map((strategy) => {
      const source = resultForCandidate(state, designId, "direction-candidate");
      const candidateId = colorCandidateId(designId, strategy.id);
      return makePacket(state, {
        packetId: `color-${candidateId}`,
        stageId: "color-system-generation",
        providerId: strategy.creator_provider_id,
        capabilities: COLOR_CAPABILITIES,
        strength: 3,
        permissions: ["artifact:read", "evidence:write"],
        forbiddenPermissions: referenceForbiddenPermissions(state),
        task: {
          kind: "color-candidate",
          candidate_id: candidateId,
          design_candidate_id: designId,
          color_strategy: strategy,
          source_design_digest: source.result_digest,
          source_design_binding: resultBinding(state, source),
          project: state.brief.product,
          locales: state.brief.locales,
          required_states: state.brief.evidence.required_states,
          ...(state.reference_pack ? {
            reference_intelligence: referenceDesignContract(
              state, "color-review", "creator"
            )
          } : {})
        }
      });
    }));
}

function validateProduct(product) {
  exact(product, new Set([
    "primary_user", "user_job", "screen_family", "main_object", "core_task",
    "trust_risk", "density", "required_states", "success_metric"
  ]), "design brief product");
  for (const key of ["primary_user", "user_job", "screen_family", "main_object", "core_task", "success_metric"]) {
    string(product[key], `design brief product.${key}`);
  }
  requireValue(["standard", "high"].includes(product.trust_risk),
    "design brief product.trust_risk must be standard or high");
  requireValue(["low", "medium", "high"].includes(product.density),
    "design brief product.density must be low, medium, or high");
  uniqueStrings(product.required_states, "design brief product.required_states");
}

function referenceDensityMatches(referenceDensity, designDensity) {
  return {
    sparse: "low",
    balanced: "medium",
    compact: "high",
    dense: "high"
  }[referenceDensity] === designDensity;
}

function referenceTrustMatches(referenceTrust, designTrust) {
  return (referenceTrust === "high" ? "high" : "standard") === designTrust;
}

function referenceProductMatches(pack, brief) {
  const reference = pack.planning_frame;
  const design = brief.product;
  return pack.planning_target_id === brief.screen_id &&
    [
      "primary_user", "user_job", "screen_family", "main_object", "core_task", "success_metric"
    ].every((field) => reference[field] === design[field]) &&
    referenceTrustMatches(reference.trust_risk, design.trust_risk) &&
    referenceDensityMatches(reference.density, design.density) &&
    sameSet(reference.required_states, design.required_states);
}

function reviewSourceAuthority(pack, producer) {
  const discovery = producer.results.find((record) =>
    record.packet_id === "reference-discovery");
  requireValue(discovery, "reference producer is missing discovery evidence", 4);
  const discovered = new Map(discovery.evidence.map((item) => [item.evidence_id, item]));
  const exported = new Map((producer.authority_sources?.export_evidence || [])
    .map((item) => [item.evidence_id, item]));
  const manualExport = producer.brief.source.access_mode === "manual-export";
  const references = [...pack.references]
    .sort((left, right) => left.reference_id.localeCompare(right.reference_id));
  const referenceAliases = new Map(references.map((item, index) => [
    item.reference_id, `reference-${String(index + 1).padStart(3, "0")}`
  ]));
  const frames = references.flatMap((reference) => reference.family.frames.map((frame) => ({
    reference_id: reference.reference_id,
    frame
  }))).sort((left, right) =>
    `${left.reference_id}/${left.frame.frame_id}`.localeCompare(
      `${right.reference_id}/${right.frame.frame_id}`
    ));
  const frameAliases = new Map(frames.map((item, index) => [
    `${item.reference_id}/${item.frame.frame_id}`,
    `frame-${String(index + 1).padStart(3, "0")}`
  ]));
  const captures = pack.evidence_manifest.filter((item) => item.kind === "source-capture")
    .sort((left, right) => left.evidence_id.localeCompare(right.evidence_id));
  requireValue(captures.length > 0,
    "reference-backed review requires at least one source capture", 4);
  const artifacts = [];
  const summaryCaptures = captures.map((manifest, index) => {
    const discoveryEvidence = discovered.get(manifest.evidence_id);
    const exportEvidence = exported.get(manifest.evidence_id);
    const sourceEvidence = manualExport ? exportEvidence : discoveryEvidence;
    requireValue(discoveryEvidence && sourceEvidence &&
      discoveryEvidence.evidence_kind === "source-capture" &&
      sourceEvidence.evidence_kind === "source-capture" &&
      discoveryEvidence.digest === manifest.digest &&
      sourceEvidence.digest === manifest.digest &&
      discoveryEvidence.product_record_id === manifest.product_record_id &&
      discoveryEvidence.screen_record_id === manifest.screen_record_id &&
      canonicalDigest(discoveryEvidence.frame_ids) === canonicalDigest(manifest.frame_ids) &&
      canonicalDigest(discoveryEvidence.subject_bindings) ===
        canonicalDigest(manifest.subject_bindings) &&
      sourceEvidence.product_record_id === manifest.product_record_id &&
      sourceEvidence.screen_record_id === manifest.screen_record_id &&
      canonicalDigest(sourceEvidence.frame_ids) === canonicalDigest(manifest.frame_ids) &&
      canonicalDigest(sourceEvidence.subject_bindings) ===
        canonicalDigest(manifest.subject_bindings),
    `reference source capture ${manifest.evidence_id} conflicts with producer authority`, 4);
    verifyBoundSnapshot(discoveryEvidence,
      `reference reviewer source capture ${manifest.evidence_id}`);
    verifyBoundSnapshot(sourceEvidence,
      `reference source authority capture ${manifest.evidence_id}`);
    const captureBytes = fs.readFileSync(sourceEvidence.resolved_path);
    requireValue(captureBytes.length >= 20 &&
      captureBytes.subarray(0, 8).equals(Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
      ])) && captureBytes.subarray(-8, -4).toString("ascii") === "IEND",
    `reference reviewer source capture ${manifest.evidence_id} must be a complete PNG`, 4);
    const captureAlias = `capture-${String(index + 1).padStart(3, "0")}`;
    const reference = pack.references.find((item) =>
      item.reference_id === manifest.reference_id);
    requireValue(reference, `reference source capture ${manifest.evidence_id} is unselected`, 4);
    const aliasedFrames = manifest.frame_ids.map((frameId) => {
      const frame = reference.family.frames.find((item) => item.frame_id === frameId);
      requireValue(frame, `reference source capture frame is unknown: ${frameId}`, 4);
      return {
        frame_alias: frameAliases.get(`${reference.reference_id}/${frameId}`),
        role: frame.role,
        core_task: frame.core_task,
        state: frame.state
      };
    });
    artifacts.push({
      ...structuredClone(sourceEvidence),
      path: `review-source/${captureAlias}.png`,
      artifact_role: "reference-capture",
      evidence_kind: "source-capture",
      capture_alias: captureAlias,
      reference_alias: referenceAliases.get(reference.reference_id)
    });
    return {
      capture_alias: captureAlias,
      reference_alias: referenceAliases.get(reference.reference_id),
      evidence_digest: manifest.digest,
      frames: aliasedFrames
    };
  });
  for (const reference of references) {
    requireValue(summaryCaptures.some((capture) =>
      capture.reference_alias === referenceAliases.get(reference.reference_id)),
    `selected reference lacks an actual reviewer source capture: ${reference.reference_id}`, 4);
  }
  for (const observation of pack.verified_observations) {
    const frameAlias = frameAliases.get(`${observation.reference_id}/${observation.frame_id}`);
    requireValue(frameAlias && summaryCaptures.some((capture) =>
      capture.reference_alias === referenceAliases.get(observation.reference_id) &&
      capture.frames.some((frame) => frame.frame_alias === frameAlias)),
    `verified visual observation lacks reviewer source capture coverage: ${observation.observation_id}`, 4);
  }
  const sourceRecipientExecutionLineage =
    referenceSourceRecipientExecutionLineage(producer);
  const body = {
    review_source_authority_version: 1,
    pack_digest: pack.pack_digest,
    producer_state_digest: producer.state_digest,
    source_recipient_provider_ids: [...new Set([
      ...producer.results.map((record) => record.provider_id),
      ...sourceRecipientExecutionLineage.attempts.map((attempt) =>
        attempt.provider_id)
    ])].sort(),
    source_recipient_actor_ids: [...new Set(producer.results
      .map((record) => record.normalized.actor.actor_id))].sort(),
    source_recipient_execution_lineage: sourceRecipientExecutionLineage,
    captures: summaryCaptures
  };
  return {
    summary: { ...body, capture_set_digest: canonicalDigest(body) },
    artifacts
  };
}

function matchingExecutableAuthority(left, right) {
  if (!left || !right) return null;
  if (left.graph_digest && right.graph_digest &&
    left.graph_digest === right.graph_digest) return "module graph digest";
  if (left.digest && right.digest && left.digest === right.digest) {
    return "entrypoint content digest";
  }
  if (left.physical_identity_digest && right.physical_identity_digest &&
    left.physical_identity_digest === right.physical_identity_digest) {
    return "entrypoint physical identity";
  }
  return null;
}

function designProviderExecutionAuthority(hostManifest, providerId) {
  const declaration = hostManifest.providers?.[providerId];
  if (!declaration) return null;
  const pinnedManifest = readPinnedDesignJson(
    hostManifest.manifest_path,
    `design executable-isolation host manifest for ${providerId}`
  );
  requireValue(pinnedManifest.digest === hostManifest.manifest_digest &&
    pinnedManifest.physical_identity_digest ===
      hostManifest.manifest_physical_identity_digest,
  "design host manifest changed before source-recipient executable isolation", 4);
  const rawDeclaration = pinnedManifest.input.providers?.[providerId];
  requireValue(rawDeclaration,
    `design host manifest lost provider ${providerId} before executable isolation`, 4);
  return {
    adapter: declaration.adapter,
    provider_declaration_digest: canonicalDigest(rawDeclaration),
    adapter_entrypoint: declaration.entrypoint_authority
      ? {
          digest: declaration.entrypoint_authority.digest,
          physical_identity_digest:
            declaration.entrypoint_authority.physical_identity_digest,
          graph_digest: declaration.entrypoint_authority.graph_digest
        }
      : null
  };
}

function assertReferenceSourceExecutableIsolation(referencePack, brief, hostManifest) {
  if (!referencePack || !hostManifest) return;
  const lineage = referencePack.producer_state.review_source_authority
    .source_recipient_execution_lineage;
  object(lineage, "reference source recipient execution lineage");
  const sourceAttempts = lineage.attempts;
  if (!sourceAttempts.length) return;

  const restrictedProviders = [
    ...brief.directions.map((direction) => ({
      provider_id: direction.creator_provider_id,
      role: "direction creator"
    })),
    ...brief.color_strategies.map((strategy) => ({
      provider_id: strategy.creator_provider_id,
      role: "color creator"
    })),
    {
      provider_id: brief.providers.browser_evidence,
      role: "browser provider"
    }
  ];
  const checked = new Set();
  for (const restricted of restrictedProviders) {
    if (checked.has(restricted.provider_id)) continue;
    checked.add(restricted.provider_id);
    const designAuthority = designProviderExecutionAuthority(
      hostManifest,
      restricted.provider_id
    );
    if (!designAuthority) continue;
    for (const sourceAttempt of sourceAttempts) {
      let matchedBy = matchingExecutableAuthority(
        designAuthority.adapter_entrypoint,
        sourceAttempt.adapter_entrypoint
      );
      if (!matchedBy && designAuthority.provider_declaration_digest ===
        sourceAttempt.provider_declaration_digest) {
        matchedBy = "provider declaration digest";
      }
      if (!matchedBy && designAuthority.adapter_entrypoint === null &&
        sourceAttempt.adapter_entrypoint === null &&
        designAuthority.adapter === sourceAttempt.adapter) {
        matchedBy = "builtin adapter identity";
      }
      requireValue(!matchedBy,
        `reference source recipient executable cannot serve as a design ${restricted.role}: ` +
        `${restricted.provider_id} aliases ${sourceAttempt.provider_id} ` +
        `(${sourceAttempt.packet_id} attempt ${sourceAttempt.attempt}) by ${matchedBy}`,
      4);
    }
  }
}

function validateReferenceProducer(brief, pinnedPack, root, pack) {
  const specification = brief.reference_pack.producer_state;
  const target = path.resolve(root, specification.path);
  const pinnedState = readPinnedDesignJson(target, "reference producer state");
  requireValue(pinnedState.digest === specification.digest,
    "reference producer state file digest mismatch", 4);
  const stateSource = pinnedDesignSnapshot(pinnedState, root);
  verifyBoundSnapshot(stateSource, "reference producer state");
  // Use the pinned descriptor's canonical path so root-owned platform aliases
  // such as macOS /var -> /private/var retain one state identity.
  const producer = readReferenceState(pinnedState.path);
  requireValue(producer.status === "complete" && producer.phase === "complete",
    "reference producer state must be complete", 4);
  requireValue(producer.state_digest === pinnedState.input.state_digest,
    "reference producer state changed between pin and validation", 4);
  const output = producer.outputs?.reference_pack;
  requireValue(output && path.resolve(output.resolved_path) === pinnedPack.path &&
    output.digest === pinnedPack.digest && output.bytes === pinnedPack.bytes &&
    output.physical_identity_digest === pinnedPack.physical_identity_digest,
  "reference pack is not the exact digest-bound output of its producer state", 4);
  requireValue(producer.selection &&
    producer.selection.selection_digest === pinnedPack.input.selection.selection_digest &&
    producer.selection_scope_digest === pinnedPack.input.provenance.selection_scope_digest,
  "reference pack selection provenance conflicts with its producer state", 4);
  const resultDigests = Object.fromEntries(producer.results.map((record) => [
    record.packet_id,
    record.result_digest
  ]));
  requireValue(canonicalDigest(resultDigests) ===
    canonicalDigest(pinnedPack.input.provenance.result_digests),
  "reference pack result provenance conflicts with its producer state", 4);
  requireValue(producer.brief_source.digest === pinnedPack.input.provenance.brief_digest &&
    producer.reasoning_registry.registry_digest ===
      pinnedPack.input.provenance.reasoning_registry_digest &&
    producer.reasoning_registry.source.digest ===
      pinnedPack.input.provenance.reasoning_registry_source_digest &&
    producer.authority_sources.rights.digest === pinnedPack.input.provenance.rights_digest &&
    sameSet(producer.authority_sources.planning.map((item) => item.digest),
      pinnedPack.input.provenance.planning_digests) &&
    sameSet(producer.authority_sources.exports.map((item) => item.digest),
      pinnedPack.input.provenance.source_export_digests),
  "reference pack authority provenance conflicts with its producer state", 4);
  requireValue(producer.run_id === pinnedPack.input.run_id &&
    identitiesMatch(producer.journey_identity, pinnedPack.input.journey_identity),
  "reference pack journey conflicts with its producer state", 4);
  const sourceAuthority = reviewSourceAuthority(pack, producer);
  const sourceRecipients = canonicalIdentitySet(
    sourceAuthority.summary.source_recipient_provider_ids
  );
  const creatorAndBrowserProviders = [
    ...brief.directions.map((direction) => direction.creator_provider_id),
    ...brief.color_strategies.map((strategy) => strategy.creator_provider_id),
    brief.providers.browser_evidence
  ];
  requireValue(creatorAndBrowserProviders.every((providerId) =>
    !sourceRecipients.has(canonicalIdentityKey(providerId))),
  "reference source recipient provider cannot serve as a design creator or browser provider", 4);
  return {
    source: stateSource,
    state_digest: producer.state_digest,
    run_id: producer.run_id,
    selection_digest: producer.selection.selection_digest,
    result_digests: resultDigests,
    review_source_authority: sourceAuthority.summary
  };
}

function validatePinnedReferencePack(brief, pinned, root) {
  requireValue(pinned.digest === brief.reference_pack.digest,
    "reference intelligence pack file digest mismatch", 4);
  const pack = validateReferencePack(pinned.input);
  requireValue(pack.project_id === brief.project_id && pack.surface === brief.surface,
    "reference intelligence pack conflicts with the design project or surface", 4);
  requireValue(referenceProductMatches(pack, brief),
    "reference intelligence pack conflicts with the design screen or product frame", 4);
  const sourceReadiness =
    pack.downstream_contract.reviewer_source_capture_readiness;
  if (sourceReadiness.status !== "ready_at_compilation") {
    throw new RouterError(
      `reference intelligence pack is research-complete but design-review source captures are manual_pending (references: ${sourceReadiness.uncovered_reference_ids.join(", ") || "none"}; observations: ${sourceReadiness.uncovered_observation_ids.join(", ") || "none"})`,
      6
    );
  }
  const producerState = validateReferenceProducer(brief, pinned, root, pack);
  return {
    source: pinnedDesignSnapshot(pinned, root),
    pack_digest: pack.pack_digest,
    normalized: structuredClone(pack),
    producer_state: producerState
  };
}

function resolveReferencePack(brief, root) {
  if (!brief.reference_pack) return null;
  const target = path.resolve(root, brief.reference_pack.path);
  const pinned = readPinnedDesignJson(target, "reference intelligence pack");
  return validatePinnedReferencePack(brief, pinned, root);
}

function resolveReviewerSourceArtifacts(state) {
  requireValue(state.reference_pack,
    "reviewer source artifacts require a reference-backed design run", 4);
  const producer = readReferenceState(
    state.reference_pack.producer_state.source.resolved_path
  );
  const authority = reviewSourceAuthority(state.reference_pack.normalized, producer);
  requireValue(canonicalDigest(authority.summary) === canonicalDigest(
    state.reference_pack.producer_state.review_source_authority
  ), "reference reviewer source authority changed after it was bound", 4);
  return authority.artifacts;
}

function referenceProjection(pack) {
  const reasoning = [...pack.verified_hierarchy_reasoning]
    .sort((left, right) => left.reasoning_id.localeCompare(right.reasoning_id));
  const reasoningAliases = new Map(reasoning.map((item, index) => [
    item.reasoning_id,
    `causal-${String(index + 1).padStart(3, "0")}`
  ]));
  const grammar = [...pack.verified_grammar]
    .sort((left, right) => left.grammar_id.localeCompare(right.grammar_id));
  const grammarAliases = new Map(grammar.map((item, index) => [
    item.grammar_id,
    `grammar-${String(index + 1).padStart(3, "0")}`
  ]));
  const causalReasoning = reasoning.map((item) => ({
    reasoning_id: reasoningAliases.get(item.reasoning_id),
    user_decision: item.user_decision,
    likely_constraint: item.likely_constraint,
    consequence_if_flattened: item.consequence_if_flattened,
    confidence: item.confidence
  }));
  const transferableGrammar = grammar.map((item) => ({
    grammar_id: grammarAliases.get(item.grammar_id),
    dimension: item.dimension,
    principle: item.principle,
    application: item.application,
    application_conditions: structuredClone(item.application_conditions),
    tradeoff: item.tradeoff,
    harmful_when: structuredClone(item.harmful_when),
    requires_live_data: item.requires_live_data,
    avoid: item.avoid,
    reasoning_ids: item.reasoning_ids.map((id) => reasoningAliases.get(id))
  }));
  return {
    causal_reasoning: causalReasoning,
    transferable_grammar: transferableGrammar,
    reasoning_aliases: reasoningAliases,
    grammar_aliases: grammarAliases
  };
}

function referenceChecksForStage(pack, stage) {
  return pack.downstream_contract.design_check_contracts.filter((check) =>
    check.stages.includes(stage));
}

function creatorContractRoles(checks) {
  return [...new Set(checks.flatMap((check) => check.required_evidence)
    .filter((role) => !RESERVED_DESIGN_EVIDENCE_ROLES.has(role)))].sort();
}

function assertCreatorSafeProjection(pack, projection) {
  const serialized = JSON.stringify(projection).toLocaleLowerCase("en");
  const sourceIdentities = pack.references.flatMap((reference) => [
    reference.reference_id,
    reference.app_name,
    reference.source.uri,
    reference.source.record_id,
    reference.source.product_record_id,
    reference.source.screen_record_id
  ]).filter((value) => typeof value === "string" && value.trim().length >= 3);
  requireValue(sourceIdentities.every((identity) =>
    !serialized.includes(identity.trim().toLocaleLowerCase("en"))),
  "reference intelligence cannot project source identities to a design participant", 4);
}

function referenceDesignContract(state, stage, audience) {
  if (!state.reference_pack) return null;
  requireValue(["creator", "independent-reviewer"].includes(audience),
    "reference design contract requires an explicit participant audience", 4);
  const pack = state.reference_pack.normalized;
  const projection = referenceProjection(pack);
  const checks = referenceChecksForStage(pack, stage);
  const body = {
    audience,
    pack_digest: state.reference_pack.pack_digest,
    authority_scope: pack.authority_scope,
    reasoning_registry_digest: pack.provenance.reasoning_registry_digest,
    source_pixels_included: false,
    source_identities_included: false,
    source_evidence_descriptors_included: audience === "independent-reviewer",
    source_pixels_available_to_participant: audience === "independent-reviewer",
    source_pixels_exposed_to_downstream_creator: false,
    ...(audience === "independent-reviewer" ? {
      review_source_authority: structuredClone(
        state.reference_pack.producer_state.review_source_authority
      )
    } : {}),
    causal_reasoning: projection.causal_reasoning,
    transferable_grammar: projection.transferable_grammar,
    trace_dimensions: [...new Set(projection.transferable_grammar
      .filter((item) => stage === "color-review"
        ? item.dimension === "color-roles" : item.dimension !== "color-roles")
      .map((item) => item.dimension))].sort(),
    required_contract_roles: creatorContractRoles(checks),
    required_design_checks: checks.map((check) => check.check_id),
    design_check_contracts: structuredClone(checks),
    rules: [
      "Use the reasoning as constraints and questions, not as visual authority.",
      "Do not reproduce source pixels, assets, copy, exact color values, or source composition.",
      "Do not reconstruct a reference screen from remembered brand identity, component order, or spatial composition.",
      "Every visible hierarchy must trace to a target user decision, constraint, and failure consequence."
    ]
  };
  assertCreatorSafeProjection(pack, body);
  return { ...body, projection_digest: canonicalDigest(body) };
}

export function validateDesignBrief(brief) {
  exact(brief, new Set([
    "design_brief_version", "project_id", "surface", "screen_id", "locales", "product",
    "baseline_policy", "editorial_boundary", "directions", "color_strategies", "providers",
    "evidence", "reference_pack"
  ]), "design brief");
  requireValue(brief.design_brief_version === 1, "design_brief_version must be 1");
  string(brief.project_id, "design brief project_id");
  requireValue(VALID_SURFACES.has(brief.surface), "design brief surface is invalid");
  safeId(brief.screen_id, "design brief screen_id");
  uniqueStrings(brief.locales, "design brief locales");
  validateProduct(brief.product);
  if (brief.reference_pack !== undefined) {
    exact(brief.reference_pack, new Set([
      "path", "digest", "producer_state", "reviewer_source_access"
    ]),
      "design brief reference_pack");
    string(brief.reference_pack.path, "design brief reference_pack.path");
    requireValue(SHA256_PATTERN.test(brief.reference_pack.digest || ""),
      "design brief reference_pack.digest must be a sha256 digest");
    exact(brief.reference_pack.producer_state, new Set(["path", "digest"]),
      "design brief reference_pack.producer_state");
    string(brief.reference_pack.producer_state.path,
      "design brief reference_pack.producer_state.path");
    requireValue(SHA256_PATTERN.test(brief.reference_pack.producer_state.digest || ""),
      "design brief reference_pack.producer_state.digest must be a sha256 digest");
    const access = brief.reference_pack.reviewer_source_access;
    exact(access, new Set([
      "reviewer_source_access_version", "mode", "purposes", "allowed_evidence_kinds",
      "redistribution", "creator_access", "browser_provider_access", "external_network"
    ]), "design brief reference_pack.reviewer_source_access");
    requireValue(access.reviewer_source_access_version === 1 &&
      access.mode === "digest-bound-internal-critic",
    "reference-backed design review requires digest-bound internal critic source access");
    uniqueStrings(access.purposes,
      "design brief reference_pack.reviewer_source_access.purposes");
    requireValue(sameSet(access.purposes, [
      "promotional-citation-firewall", "source-composition-independence"
    ]), "reviewer source access purposes must be the exact bounded review purposes");
    uniqueStrings(access.allowed_evidence_kinds,
      "design brief reference_pack.reviewer_source_access.allowed_evidence_kinds");
    requireValue(sameSet(access.allowed_evidence_kinds, ["source-capture"]),
      "reviewer source access may expose only digest-bound source captures");
    requireValue(access.redistribution === false && access.creator_access === false &&
      access.browser_provider_access === false && access.external_network === false,
    "reviewer source access must forbid redistribution, creator/browser access, and external network");
  }

  exact(brief.baseline_policy, new Set(["preserve", "may_change", "forbid"]), "design brief baseline_policy");
  uniqueStrings(brief.baseline_policy.preserve, "design brief baseline_policy.preserve");
  uniqueStrings(brief.baseline_policy.may_change, "design brief baseline_policy.may_change", { empty: true });
  uniqueStrings(brief.baseline_policy.forbid, "design brief baseline_policy.forbid");

  exact(brief.editorial_boundary, new Set(["treatment", "scope"]), "design brief editorial_boundary");
  requireValue(VALID_EDITORIAL_TREATMENTS.has(brief.editorial_boundary.treatment),
    "design brief editorial_boundary.treatment is invalid");
  uniqueStrings(brief.editorial_boundary.scope, "design brief editorial_boundary.scope", { empty: true });
  requireValue(brief.editorial_boundary.treatment !== "bounded" || brief.editorial_boundary.scope.length > 0,
    "bounded editorial treatment requires scope");
  requireValue(brief.editorial_boundary.treatment !== "forbidden" || brief.editorial_boundary.scope.length === 0,
    "forbidden editorial treatment requires empty scope");

  requireValue(Array.isArray(brief.directions) && brief.directions.length === 3,
    "design brief requires exactly three project-specific directions");
  const directionIds = [];
  const directionCreators = [];
  for (const [index, direction] of brief.directions.entries()) {
    const label = `design brief directions[${index}]`;
    exact(direction, new Set([
      "id", "name", "thesis", "subject_world", "dominant_influence", "supporting_influence",
      "signature_element", "aesthetic_sources", "anti_references", "allowed_energy", "allowed_depth",
      "creator_provider_id"
    ]), label);
    directionIds.push(safeId(direction.id, `${label}.id`));
    requireValue(!direction.id.includes("--"), `${label}.id cannot contain the reserved -- delimiter`);
    for (const key of ["name", "thesis", "dominant_influence", "signature_element", "creator_provider_id"]) {
      string(direction[key], `${label}.${key}`);
    }
    assertInternalIdentityIsNotOrchestrator(direction.creator_provider_id, {
      label: `${label}.creator_provider_id`
    });
    if (direction.supporting_influence !== undefined) string(direction.supporting_influence, `${label}.supporting_influence`);
    for (const key of ["subject_world", "aesthetic_sources", "anti_references", "allowed_energy", "allowed_depth"]) {
      uniqueStrings(direction[key], `${label}.${key}`);
    }
    requireValue(direction.allowed_energy.every((item) => VALID_VISUAL_ENERGY.has(item) && item !== "preserve"),
      `${label}.allowed_energy contains an invalid value`);
    requireValue(direction.allowed_depth.every((item) => VALID_VISUAL_DEPTH.has(item) && item !== "preserve"),
      `${label}.allowed_depth contains an invalid value`);
    directionCreators.push(direction.creator_provider_id);
  }
  requireValue(new Set(directionIds).size === 3, "design direction ids must be unique");

  requireValue(Array.isArray(brief.color_strategies) && brief.color_strategies.length === 3,
    "design brief requires exactly three color strategies");
  const strategyIds = [];
  const colorCreators = [];
  for (const [index, strategy] of brief.color_strategies.entries()) {
    const label = `design brief color_strategies[${index}]`;
    exact(strategy, new Set([
      "id", "name", "color_space", "harmony_strategy", "seed_sources", "role_intent",
      "anti_patterns", "creator_provider_id"
    ]), label);
    strategyIds.push(safeId(strategy.id, `${label}.id`));
    requireValue(!strategy.id.includes("--"), `${label}.id cannot contain the reserved -- delimiter`);
    for (const key of ["name", "harmony_strategy", "creator_provider_id"]) string(strategy[key], `${label}.${key}`);
    assertInternalIdentityIsNotOrchestrator(strategy.creator_provider_id, {
      label: `${label}.creator_provider_id`
    });
    requireValue(["oklch", "hct"].includes(strategy.color_space), `${label}.color_space must be oklch or hct`);
    for (const key of ["seed_sources", "role_intent", "anti_patterns"]) uniqueStrings(strategy[key], `${label}.${key}`);
    colorCreators.push(strategy.creator_provider_id);
  }
  requireValue(new Set(strategyIds).size === 3, "color strategy ids must be unique");

  exact(brief.providers, new Set(["direction_reviewer", "color_reviewer", "browser_evidence"]),
    "design brief providers");
  for (const key of ["direction_reviewer", "color_reviewer", "browser_evidence"]) {
    string(brief.providers[key], `design brief providers.${key}`);
    assertInternalIdentityIsNotOrchestrator(brief.providers[key], {
      label: `design brief providers.${key}`
    });
  }
  const allCreators = canonicalIdentitySet([...directionCreators, ...colorCreators]);
  requireValue(!allCreators.has(canonicalIdentityKey(brief.providers.direction_reviewer)),
    "direction reviewer provider must be independent from every direction and color creator");
  requireValue(!allCreators.has(canonicalIdentityKey(brief.providers.color_reviewer)),
    "color reviewer provider must be independent from every direction and color creator");
  requireValue(!allCreators.has(canonicalIdentityKey(brief.providers.browser_evidence)),
    "browser evidence provider must be independent from design creators");
  if (brief.reference_pack) {
    const sourcePrivileged = [
      brief.providers.direction_reviewer, brief.providers.color_reviewer
    ];
    const prohibited = canonicalIdentitySet([
      ...directionCreators, ...colorCreators, brief.providers.browser_evidence
    ]);
    requireValue(sourcePrivileged.every((providerId) =>
      !prohibited.has(canonicalIdentityKey(providerId))),
      "reference source reviewers must be independent from every creator and browser provider");
  }

  exact(brief.evidence, new Set(["required_viewports", "required_checks", "required_states"]),
    "design brief evidence");
  uniqueStrings(brief.evidence.required_viewports, "design brief evidence.required_viewports");
  requireValue(brief.evidence.required_viewports.length >= 2,
    "design exploration requires at least two browser viewports");
  uniqueStrings(brief.evidence.required_checks, "design brief evidence.required_checks");
  requireValue(brief.evidence.required_checks.every((item) => PLAYWRIGHT_CHECKS.has(item)),
    "design brief evidence.required_checks contains an unsupported Playwright check");
  for (const check of [
    "keyboard", "state", "overflow", "contrast", "zoom-200", "aria-semantics", "console", "network"
  ]) {
    requireValue(brief.evidence.required_checks.includes(check), `design exploration requires Playwright check: ${check}`);
  }
  uniqueStrings(brief.evidence.required_states, "design brief evidence.required_states");
  requireValue(containsAll(brief.evidence.required_states, brief.product.required_states),
    "design evidence states must cover all product required states");
  return brief;
}

function approvedIntent(body) {
  return {
    visual_intent_version: 1,
    status: "approved",
    ...body,
    authority_receipt: "pending-owner-direction.json",
    authority_digest: ZERO_DIGEST
  };
}

function approvedSignature(body) {
  return {
    visual_signature_version: 1,
    status: "approved",
    ...body,
    authority_receipt: "pending-owner-direction.json",
    authority_digest: ZERO_DIGEST
  };
}

function evidenceItems(input, sourcePath) {
  requireValue(Array.isArray(input) && input.length > 0, "design result requires evidence", 4);
  const seen = new Set();
  return input.map((item, index) => {
    const label = `design result evidence[${index}]`;
    exact(item, new Set([
      "kind", "path", "viewport", "state", "checks", "contract_roles"
    ]), label);
    string(item.kind, `${label}.kind`);
    requireValue(DESIGN_EVIDENCE_KINDS.has(item.kind), `${label}.kind is unsupported`, 4);
    string(item.path, `${label}.path`);
    if (item.viewport !== undefined) string(item.viewport, `${label}.viewport`);
    if (item.state !== undefined) string(item.state, `${label}.state`);
    if (item.checks !== undefined) uniqueStrings(item.checks, `${label}.checks`, { empty: true });
    if (item.contract_roles !== undefined) {
      uniqueStrings(item.contract_roles, `${label}.contract_roles`);
      requireValue(item.kind === "design-contract",
        `${label}.contract_roles is allowed only for design-contract evidence`, 4);
    }
    requireValue(item.kind !== "design-contract" || Array.isArray(item.contract_roles),
      `${label} design-contract evidence requires contract_roles`, 4);
    const resolved = path.isAbsolute(item.path)
      ? path.resolve(item.path)
      : path.resolve(path.dirname(sourcePath), item.path);
    requireValue(fs.existsSync(resolved), `${label} is missing: ${resolved}`, 4);
    const stat = fs.lstatSync(resolved);
    requireValue(stat.isFile() && !stat.isSymbolicLink(),
      `${label} must be a regular non-symlink file: ${resolved}`, 4);
    requireValue(!seen.has(resolved), `${label} duplicates an evidence path`, 4);
    seen.add(resolved);
    return { ...item, path: resolved };
  });
}

function designCheckContracts(state, stage) {
  if (!state.reference_pack) return [];
  return referenceChecksForStage(state.reference_pack.normalized, stage);
}

function requiredContractRoles(state, stage) {
  return creatorContractRoles(designCheckContracts(state, stage));
}

function validateDesignContractEvidence(state, result, stage) {
  if (!state.reference_pack) {
    requireValue(!result.evidence.some((item) => item.kind === "design-contract"),
      `${result.kind} cannot submit an unbound reference design contract`, 4);
    return;
  }
  const required = requiredContractRoles(state, stage);
  const evidence = result.evidence.filter((item) => item.kind === "design-contract");
  if (required.length === 0) {
    requireValue(evidence.length === 0,
      `${result.kind} cannot submit an empty reference design contract`, 4);
    return;
  }
  requireValue(evidence.length === 1,
    `${result.kind} ${result.candidate_id} requires one design-contract evidence artifact`, 4);
  const document = readEvidenceJson(evidence[0],
    `${result.kind} ${result.candidate_id} design contract`);
  exact(document, new Set([
    "design_contract_evidence_version", "candidate_id", "contract_roles", "claims"
  ]), "design contract evidence");
  requireValue(document.design_contract_evidence_version === 1,
    "design_contract_evidence_version must be 1", 4);
  requireValue(document.candidate_id === result.candidate_id,
    "design contract evidence candidate_id mismatch", 4);
  uniqueStrings(document.contract_roles, "design contract evidence contract_roles");
  requireValue(sameSet(document.contract_roles, evidence[0].contract_roles),
    "design contract evidence roles disagree with the result manifest", 4);
  exact(document.claims, new Set(document.contract_roles), "design contract evidence claims");
  for (const role of document.contract_roles) {
    string(document.claims[role], `design contract evidence claims.${role}`);
  }
  requireValue(containsAll(document.contract_roles, required),
    `${result.kind} ${result.candidate_id} design contract omits required roles: ${required
      .filter((role) => !document.contract_roles.includes(role)).join(", ")}`, 4);
}

function readEvidenceJson(item, label) {
  try {
    return JSON.parse(fs.readFileSync(item.path, "utf8"));
  } catch (error) {
    throw new RouterError(`${label} must be valid JSON: ${error.message}`, 4);
  }
}

function validateFontReport(state, result, signature) {
  const evidence = result.evidence.filter((item) => item.kind === "font-report");
  requireValue(evidence.length === 1,
    `direction ${result.candidate_id} requires one font availability, locale, and license report`, 4);
  const report = readEvidenceJson(evidence[0], `direction ${result.candidate_id} font report`);
  exact(report, new Set([
    "font_report_version", "required_locales", "all_required_locales_covered", "families"
  ]), "font report");
  requireValue(report.font_report_version === 1, "font_report_version must be 1", 4);
  uniqueStrings(report.required_locales, "font report required_locales");
  requireValue(sameSet(report.required_locales, state.brief.locales),
    "font report required_locales must exactly match the design brief", 4);
  requireValue(report.all_required_locales_covered === true,
    "font report must confirm all required locales are covered", 4);
  requireValue(Array.isArray(report.families) && report.families.length > 0,
    "font report requires families", 4);
  const signatureFamilies = new Map(signature.typography.families.map((item) => [item.family, item.role]));
  requireValue(report.families.length === signatureFamilies.size,
    "font report must cover every and only the signature families", 4);
  const reportedFamilies = new Set();
  const coveredLocales = new Set();
  for (const [index, family] of report.families.entries()) {
    const label = `font report families[${index}]`;
    exact(family, new Set([
      "family", "role", "source", "availability", "locales", "fallback", "license"
    ]), label);
    for (const key of ["family", "role", "source", "fallback"]) string(family[key], `${label}.${key}`);
    requireValue(signatureFamilies.get(family.family) === family.role,
      `${label} does not match the signature family and role`, 4);
    requireValue(!reportedFamilies.has(family.family), `${label}.family must be unique`, 4);
    reportedFamilies.add(family.family);
    requireValue(FONT_AVAILABILITY.has(family.availability),
      `${label}.availability must be embedded, bundled, installed, or licensed`, 4);
    uniqueStrings(family.locales, `${label}.locales`);
    family.locales.forEach((locale) => coveredLocales.add(locale));
    exact(family.license, new Set(["status", "identifier", "basis"]), `${label}.license`);
    requireValue(family.license.status === "cleared", `${label}.license.status must be cleared`, 4);
    string(family.license.identifier, `${label}.license.identifier`);
    string(family.license.basis, `${label}.license.basis`);
  }
  requireValue([...signatureFamilies.keys()].every((family) => reportedFamilies.has(family)),
    "font report is missing a signature family", 4);
  requireValue(state.brief.locales.every((locale) => coveredLocales.has(locale)),
    "font report family coverage does not include every required locale", 4);
}

function validateTokenSpec(result) {
  const evidence = result.evidence.filter((item) => item.kind === "token-spec");
  requireValue(evidence.length === 1,
    `color ${result.candidate_id} requires one token specification`, 4);
  const spec = readEvidenceJson(evidence[0], `color ${result.candidate_id} token specification`);
  exact(spec, new Set([
    "design_token_spec_version", "color_space", "harmony_strategy", "tokens", "tone_scales", "gamut_targets"
  ]), "design token specification");
  requireValue(spec.design_token_spec_version === 1, "design_token_spec_version must be 1", 4);
  requireValue(spec.color_space === result.color_system.color_space,
    "token specification color_space mismatch", 4);
  requireValue(spec.harmony_strategy === result.color_system.harmony_strategy,
    "token specification harmony_strategy mismatch", 4);
  exact(spec.tokens, new Set(REQUIRED_COLOR_ROLES), "design token specification tokens");
  const tokenNames = new Set();
  for (const role of REQUIRED_COLOR_ROLES) {
    const item = spec.tokens[role];
    exact(item, new Set(["token", "value"]), `design token specification tokens.${role}`);
    requireValue(CSS_TOKEN_PATTERN.test(item.token || ""),
      `design token specification tokens.${role}.token must be a CSS custom property`, 4);
    requireValue(!tokenNames.has(item.token),
      `design token specification token is reused: ${item.token}`, 4);
    tokenNames.add(item.token);
    hex(item.value, `design token specification tokens.${role}.value`);
    requireValue(item.value === result.color_system.roles[role],
      `design token specification value mismatch for role: ${role}`, 4);
  }
  requireValue(canonicalDigest(spec.tone_scales) === canonicalDigest(result.color_system.tone_scales),
    "token specification tone_scales mismatch", 4);
  uniqueStrings(spec.gamut_targets, "design token specification gamut_targets");
  requireValue(sameSet(spec.gamut_targets, result.color_system.gamut_targets),
    "token specification gamut_targets mismatch", 4);
}

function actor(input, journeyIdentity) {
  exact(input, new Set(["actor_id", "kind"]), "design result actor");
  string(input.actor_id, "design result actor.actor_id");
  assertInternalIdentityIsNotOrchestrator(input.actor_id, {
    orchestratorId: journeyIdentity?.orchestrator_id,
    label: "design result actor.actor_id"
  });
  requireValue(["agent", "skill", "human"].includes(input.kind),
    "design result actor.kind must be agent, skill, or human", 4);
  return input;
}

function baseResult(state, packet, input, sourcePath) {
  exact(input, new Set([
    "design_result_version", "kind", "packet_id", "provider_id", "actor", "status",
    "packet_digest", "candidate_id", "baseline_digest", "intent", "signature", "rationale",
    "subject_kind", "subject_id", "subject_result_digest", "browser_engine", "browser_engine_version",
    "checks", "locales_tested", "states_tested", "scores", "ranking", "blockers",
    "design_candidate_id", "color_strategy_id", "source_design_digest", "palette", "color_system",
    "reference_reasoning_trace", "reference_checks", "evidence"
  ]), "design result");
  requireValue(input.design_result_version === 1, "design_result_version must be 1", 4);
  requireValue(DESIGN_RESULT_KINDS.has(input.kind), "design result kind is invalid", 4);
  requireValue(input.kind === packet.design_task.kind, "design result kind does not match its packet", 4);
  requireValue(input.packet_id === packet.packet_id, "design result packet_id mismatch", 4);
  requireValue(input.provider_id === packet.provider.id, "design result provider_id mismatch", 4);
  requireValue(input.packet_digest === packet.packet_digest, "design result packet digest mismatch", 4);
  requireValue(input.status === "completed", "design result must be completed", 4);
  actor(input.actor, state.journey_identity);
  if (state.reference_pack && [
    "direction-candidate", "color-candidate", "browser-evidence"
  ].includes(input.kind)) {
    requireValue(!canonicalIdentitySet(state.reference_pack.producer_state.review_source_authority
      .source_recipient_actor_ids).has(canonicalIdentityKey(input.actor.actor_id)),
    "reference source recipient actor cannot serve as a design creator or browser participant",
    4);
  }
  return { ...structuredClone(input), evidence: evidenceItems(input.evidence, sourcePath) };
}

function directionForCandidate(state, candidateId) {
  return state.brief.directions.find((direction) =>
    DESIGN_DEPTHS.some((depth) => directionCandidateId(direction.id, depth) === candidateId));
}

function resultForCandidate(state, candidateId, kind) {
  return state.results.find((record) =>
    record.normalized.kind === kind && record.normalized.candidate_id === candidateId);
}

function resultForPacket(state, packetId) {
  return state.results.find((record) => record.packet_id === packetId);
}

function acceptedAttemptFor(state, record, packet, verificationContext = null) {
  const cached = verificationContext?.acceptedAttempts.get(record);
  if (cached) return cached;
  const attempts = state.attempts.filter((item) =>
    item.packet_id === packet.packet_id &&
    item.provider_id === packet.provider.id &&
    canonicalDigest(item.participant) === canonicalDigest(packet.participant) &&
    item.packet_digest === packet.packet_digest &&
    item.result_digest === record.result_digest &&
    item.result_file_digest === record.source.digest &&
    path.resolve(item.result_path || "") === path.resolve(record.source.resolved_path) &&
    ["ran", "manual_recorded"].includes(item.execution_status));
  requireValue(attempts.length === 1,
    `design result requires exactly one packet-bound accepted attempt: ${record.packet_id}`, 4);
  const attempt = attempts[0];
  requireValue(Number.isInteger(attempt.attempt) && attempt.attempt >= 1,
    `design result accepted attempt number is invalid: ${record.packet_id}`, 4);
  if (packet.stage_id === "browser-evidence") {
    requireValue(attempt.execution_status === "ran",
    `design browser result requires KSR-run sealed Playwright adapter execution: ${record.packet_id}`, 4);
    requireValue(!state.reference_pack ||
      packet.provider.resolved_to === PLAYWRIGHT_PROVIDER_TARGET,
    `reference-backed design browser result requires official Playwright routing: ${record.packet_id}`, 4);
  }
  if (attempt.execution_status === "ran") {
    verifyAttemptExecutionAuthority(state, packet, attempt, verificationContext);
  } else {
    requireValue(attempt.execution_status === "manual_recorded" &&
      attempt.execution_authority === undefined,
    `design result accepted attempt has unsupported authority: ${record.packet_id}`, 4);
  }
  verificationContext?.acceptedAttempts.set(record, attempt);
  return attempt;
}

function resultBinding(state, record, verificationContext = null) {
  requireValue(record, "design result binding requires a recorded result", 4);
  const packet = state.packets.find((item) => item.packet_id === record.packet_id);
  requireValue(packet, `design result packet is missing: ${record.packet_id}`, 4);
  requireValue(record.provider_id === packet.provider.id,
    `design result provider conflicts with its packet: ${record.packet_id}`, 4);
  requireValue(canonicalDigest(record.participant) === canonicalDigest(packet.participant),
    `design result participant conflicts with its packet: ${record.packet_id}`, 4);
  const attempt = acceptedAttemptFor(state, record, packet, verificationContext);
  return {
    provider_id: packet.provider.id,
    participant: structuredClone(packet.participant),
    actor_id: record.normalized.actor.actor_id,
    packet_digest: packet.packet_digest,
    result_digest: record.result_digest,
    result_source_digest: record.source.digest,
    fields: {
      ...(typeof record.normalized.rationale === "string" ? {
        rationale: canonicalDigest({
          candidate_id: record.normalized.candidate_id,
          field: "rationale",
          value: record.normalized.rationale
        })
      } : {}),
      ...(Array.isArray(record.normalized.reference_reasoning_trace) ? {
        reference_reasoning_trace: canonicalDigest({
          candidate_id: record.normalized.candidate_id,
          field: "reference_reasoning_trace",
          value: record.normalized.reference_reasoning_trace
        })
      } : {})
    },
    evidence: record.evidence.map((item) => ({
      kind: item.evidence_kind,
      digest: item.digest,
      viewport: item.viewport,
      state: item.state,
      checks: [...(item.checks || [])],
      contract_roles: [...(item.contract_roles || [])]
    })),
    execution: {
      adapter: attempt.adapter,
      attempt: attempt.attempt,
      execution_status: attempt.execution_status,
      strength: attempt.strength || null,
      capabilities: [...(attempt.capabilities || [])],
      permission_scopes: [...(attempt.permission_scopes || [])],
      host_manifest_digest: attempt.host_manifest_digest || null,
      adapter_entrypoint_digest: attempt.adapter_entrypoint?.digest || null
    }
  };
}

function validateReferenceReasoningTrace(state, result, label, { color = false } = {}) {
  if (state.reference_pack) {
    requireValue(Array.isArray(result.reference_reasoning_trace) &&
      result.reference_reasoning_trace.length > 0,
    `${label} requires a reference reasoning trace`, 4);
    const projection = referenceProjection(state.reference_pack.normalized);
    const grammarById = new Map(projection.transferable_grammar
      .map((item) => [item.grammar_id, item]));
    const reasoningById = new Map(projection.causal_reasoning
      .map((item) => [item.reasoning_id, item]));
    const requiredDimensions = [...new Set(projection.transferable_grammar
      .filter((item) => color
        ? item.dimension === "color-roles" : item.dimension !== "color-roles")
      .map((item) => item.dimension))].sort();
    requireValue(requiredDimensions.length > 0,
      `${label} has no applicable reference grammar dimensions`, 4);
    requireValue(result.reference_reasoning_trace.length === requiredDimensions.length,
      `${label} must disposition every applicable reference grammar dimension`, 4);
    const coveredDimensions = new Set();
    for (const [index, trace] of result.reference_reasoning_trace.entries()) {
      const traceLabel = `${label} reference reasoning trace[${index}]`;
      exact(trace, new Set([
        "dimension", "disposition", "target_rationale", "design_choice", "user_decision",
        "target_constraint", "consequence_if_flattened", "grammar_ids", "reasoning_ids"
      ]), traceLabel);
      string(trace.dimension, `${traceLabel}.dimension`);
      requireValue(requiredDimensions.includes(trace.dimension) &&
        !coveredDimensions.has(trace.dimension),
      `${traceLabel}.dimension must be a unique applicable grammar dimension`, 4);
      coveredDimensions.add(trace.dimension);
      requireValue(REFERENCE_TRACE_DISPOSITIONS.has(trace.disposition),
        `${traceLabel}.disposition must be applied or not-applicable`, 4);
      string(trace.target_rationale, `${traceLabel}.target_rationale`);
      if (trace.disposition === "applied") {
        for (const field of [
          "design_choice", "user_decision", "target_constraint", "consequence_if_flattened"
        ]) string(trace[field], `${traceLabel}.${field}`);
      } else {
        for (const field of [
          "design_choice", "user_decision", "target_constraint", "consequence_if_flattened"
        ]) {
          requireValue(trace[field] === undefined,
            `${traceLabel}.${field} is forbidden for a not-applicable disposition`, 4);
        }
      }
      uniqueStrings(trace.grammar_ids, `${traceLabel}.grammar_ids`);
      uniqueStrings(trace.reasoning_ids, `${traceLabel}.reasoning_ids`);
      requireValue(trace.grammar_ids.every((id) => grammarById.has(id)) &&
        trace.reasoning_ids.every((id) => reasoningById.has(id)),
      `${traceLabel} cites reasoning outside the digest-bound reference pack`, 4);
      const selectedGrammar = trace.grammar_ids.map((id) => grammarById.get(id));
      requireValue(selectedGrammar.every((item) => item.dimension === trace.dimension),
        `${traceLabel} cites grammar from a different dimension`, 4);
      const requiredReasoning = new Set(selectedGrammar.flatMap((item) => item.reasoning_ids));
      requireValue(sameSet(trace.reasoning_ids, [...requiredReasoning]),
        `${traceLabel} does not preserve the selected grammar-to-reasoning edges`, 4);
    }
    requireValue(sameSet([...coveredDimensions], requiredDimensions),
      `${label} reference trace dimension coverage is incomplete`, 4);
  } else {
    requireValue(result.reference_reasoning_trace === undefined,
      `${label} cannot claim an unbound reference reasoning trace`, 4);
  }
}

function validateCandidateSourceIndependence(state, result, label) {
  if (!state.reference_pack) return;
  const sourceIdentities = state.reference_pack.normalized.references.flatMap((reference) => [
    reference.reference_id,
    reference.app_name,
    reference.source.uri,
    reference.source.record_id,
    reference.source.product_record_id,
    reference.source.screen_record_id
  ]).filter((value) => typeof value === "string" && value.trim().length >= 3)
    .map((value) => value.trim().toLocaleLowerCase("en"));
  const prototypes = result.evidence.filter((item) => item.kind === "prototype")
    .map((item) => fs.readFileSync(item.path, "utf8"));
  const contractClaims = result.evidence.filter((item) => item.kind === "design-contract")
    .map((item) => Object.values(readEvidenceJson(item,
      `${label} source-composition contract`).claims || {}));
  const candidateContent = {
    rationale: result.rationale,
    intent: result.intent,
    signature: result.signature,
    palette: result.palette,
    color_system: result.color_system,
    reference_reasoning_trace: result.reference_reasoning_trace,
    prototypes,
    contract_claims: contractClaims
  };
  const candidateExpression = JSON.stringify(candidateContent);
  const normalized = candidateExpression.toLocaleLowerCase("en");
  requireValue(sourceIdentities.every((identity) => !normalized.includes(identity)),
    `${label} contains a source brand, URI, or record identity`, 4);
  requireValue(!stringLeaves(candidateContent).some((value) =>
    claimsSourceCompositionCopy(value)),
    `${label} claims or embeds source-composition copying`, 4);
}

function validateDirectionCandidate(state, packet, result) {
  const candidateId = packet.design_task.candidate_id;
  requireValue(result.candidate_id === candidateId, "direction candidate_id mismatch", 4);
  requireValue(result.baseline_digest === state.baseline.digest, "direction baseline digest mismatch", 4);
  string(result.rationale, "direction result rationale");
  validateReferenceReasoningTrace(state, result, `direction ${candidateId}`);
  const intentContract = approvedIntent(result.intent);
  const signatureContract = approvedSignature(result.signature);
  validateVisualIntentContract(intentContract, `direction ${candidateId} intent`);
  validateVisualSignatureContract(signatureContract, `direction ${candidateId} signature`);
  const intent = visualIntentBody(intentContract);
  const signature = visualSignatureBody(signatureContract);
  const direction = directionForCandidate(state, candidateId);
  requireValue(direction, `unknown direction candidate: ${candidateId}`, 4);
  requireValue(intent.editorial_treatment === state.brief.editorial_boundary.treatment &&
    sameSet(intent.editorial_scope, state.brief.editorial_boundary.scope),
  `direction ${candidateId} violates the editorial boundary`, 4);
  requireValue(direction.allowed_energy.includes(intent.energy),
    `direction ${candidateId} uses unapproved energy: ${intent.energy}`, 4);
  requireValue(direction.allowed_depth.includes(intent.depth),
    `direction ${candidateId} uses unapproved depth: ${intent.depth}`, 4);
  requireValue(containsAll(intent.preserve, state.brief.baseline_policy.preserve),
    `direction ${candidateId} drops required baseline preservation`, 4);
  requireValue(containsAll(intent.avoid, state.brief.baseline_policy.forbid),
    `direction ${candidateId} drops forbidden transformations`, 4);
  requireValue(containsAll(signature.forbidden_transformations, state.brief.baseline_policy.forbid),
    `direction ${candidateId} signature drops forbidden transformations`, 4);
  const anti = new Set(direction.anti_references.map((item) => item.toLocaleLowerCase("en")));
  requireValue(!signature.style_keywords.some((item) => anti.has(item.toLocaleLowerCase("en"))),
    `direction ${candidateId} promotes an explicit anti-reference`, 4);
  requireValue(result.evidence.filter((item) => item.kind === "prototype").length === 1,
    `direction ${candidateId} requires exactly one prototype`, 4);
  validateFontReport(state, result, signature);
  validateDesignContractEvidence(state, result, "direction-review");
  validateCandidateSourceIndependence(state, result, `direction ${candidateId}`);
  result.intent = intent;
  result.signature = signature;
}

function validateBrowserResult(state, packet, result) {
  requireValue(result.candidate_id === packet.design_task.subject_id &&
    result.subject_id === packet.design_task.subject_id,
  "browser subject id mismatch", 4);
  requireValue(result.subject_kind === packet.design_task.subject_kind,
    "browser subject kind mismatch", 4);
  requireValue(result.subject_result_digest === packet.design_task.subject_result_digest,
    "browser subject digest mismatch", 4);
  requireValue(result.browser_engine === "playwright", "browser evidence must be produced by Playwright", 4);
  string(result.browser_engine_version, "browser result browser_engine_version");
  object(result.checks, "browser result checks");
  for (const check of state.brief.evidence.required_checks) {
    requireValue(result.checks[check] === true, `browser evidence failed or omitted check: ${check}`, 4);
  }
  uniqueStrings(result.locales_tested, "browser result locales_tested");
  uniqueStrings(result.states_tested, "browser result states_tested");
  requireValue(containsAll(result.locales_tested, state.brief.locales),
    "browser evidence does not cover every required locale", 4);
  requireValue(containsAll(result.states_tested, state.brief.evidence.required_states),
    "browser evidence does not cover every required state", 4);
  for (const viewport of state.brief.evidence.required_viewports) {
    requireValue(result.evidence.some((item) => item.kind === "screenshot" && item.viewport === viewport),
      `browser evidence is missing screenshot viewport: ${viewport}`, 4);
  }
  const reports = result.evidence.filter((item) => item.kind === "test-report");
  requireValue(reports.some((item) => containsAll(item.checks || [], state.brief.evidence.required_checks)),
    "browser evidence requires a test report covering every requested check", 4);
  const subject = resultForCandidate(state, result.subject_id, result.subject_kind);
  requireValue(subject, "browser evidence subject result is missing", 4);
  requireValue(canonicalIdentityKey(result.actor.actor_id) !==
    canonicalIdentityKey(subject.normalized.actor.actor_id),
    "creator cannot provide browser evidence for its own candidate", 4);
}

function candidateFieldEvidenceDigest(candidate, field) {
  return canonicalDigest({
    candidate_id: candidate.normalized.candidate_id,
    field,
    value: candidate.normalized[field]
  });
}

function validateSourceCompositionAnalysis(state, result, kind, records) {
  const evidence = result.evidence.filter((item) =>
    item.kind === "source-composition-analysis");
  requireValue(evidence.length === 1,
    `${kind} requires exactly one source-composition-analysis artifact`, 4);
  const report = readEvidenceJson(evidence[0], `${kind} source composition analysis`);
  exact(report, new Set([
    "design_source_composition_analysis_version", "stage", "packet_digest",
    "pack_digest", "producer_state_digest", "capture_set_digest", "captures",
    "candidates"
  ]), `${kind} source composition analysis`);
  requireValue(report.design_source_composition_analysis_version === 1 &&
    report.stage === kind && report.packet_digest === result.packet_digest &&
    report.pack_digest === state.reference_pack.pack_digest &&
    report.producer_state_digest === state.reference_pack.producer_state.state_digest &&
    report.capture_set_digest ===
      state.reference_pack.producer_state.review_source_authority.capture_set_digest,
  `${kind} source composition analysis authority binding mismatch`, 4);
  uniqueStrings(report.captures, `${kind} source composition analysis captures`);
  const expectedCaptures = state.reference_pack.producer_state
    .review_source_authority.captures.map((item) => item.capture_alias);
  requireValue(sameSet(report.captures, expectedCaptures),
    `${kind} source composition analysis must cover the exact capture set`, 4);
  requireValue(Array.isArray(report.candidates) &&
    report.candidates.length === records.length,
  `${kind} source composition analysis must cover every candidate`, 4);
  const packet = state.packets.find((item) => item.packet_id === result.packet_id);
  const expectedDimensions = packet.design_task.reference_intelligence.trace_dimensions;
  const byCandidate = new Map();
  for (const [index, item] of report.candidates.entries()) {
    const label = `${kind} source composition candidates[${index}]`;
    exact(item, new Set([
      "candidate_id", "candidate_result_digest", "browser_result_digest",
      "capture_aliases", "dimensions", "source_composition_independence",
      "promotional_citation_firewall", "rationale", "structural_differences"
    ]), label);
    const candidate = records.find((record) =>
      record.normalized.candidate_id === item.candidate_id);
    const browser = resultForCandidate(
      state, item.candidate_id, "browser-evidence"
    );
    requireValue(candidate && browser && !byCandidate.has(item.candidate_id) &&
      item.candidate_result_digest === candidate.result_digest &&
      item.browser_result_digest === browser.result_digest,
    `${label} candidate or browser digest binding mismatch`, 4);
    uniqueStrings(item.capture_aliases, `${label}.capture_aliases`);
    requireValue(sameSet(item.capture_aliases, expectedCaptures),
      `${label}.capture_aliases must cover the exact authorized capture set`, 4);
    uniqueStrings(item.dimensions, `${label}.dimensions`);
    requireValue(sameSet(item.dimensions, expectedDimensions),
      `${label}.dimensions must cover the stage reference dimensions`, 4);
    for (const field of [
      "source_composition_independence", "promotional_citation_firewall"
    ]) {
      requireValue(["pass", "fail", "inconclusive"].includes(item[field]),
        `${label}.${field} has an invalid verdict`, 4);
    }
    string(item.rationale, `${label}.rationale`);
    uniqueStrings(item.structural_differences, `${label}.structural_differences`);
    const verdictCodes = {
      source_composition_independence:
        "reference-check-failed:source-composition-independence",
      promotional_citation_firewall:
        "reference-check-failed:promotional-citation-firewall"
    };
    for (const [field, code] of Object.entries(verdictCodes)) {
      if (item[field] !== "pass") {
        requireValue(result.blockers.some((blocker) =>
          blocker.candidate_id === item.candidate_id && blocker.hard &&
          blocker.code === code),
        `${label}.${field} ${item[field]} requires a matching hard blocker`, 4);
      }
    }
    byCandidate.set(item.candidate_id, item);
  }
  return {
    evidence_digest: hashArtifact(evidence[0].path),
    candidates: byCandidate
  };
}

function validateReferenceEvidenceBinding(state, reviewResult, candidate, browser, binding, label) {
  exact(binding, new Set([
    "evidence_role", "source_kind", "evidence_kind", "subject_id", "digest"
  ]), label);
  string(binding.evidence_role, `${label}.evidence_role`);
  requireValue([
    "candidate-field", "candidate-evidence", "browser-result", "browser-evidence",
    "review-evidence", "reference-authority"
  ].includes(binding.source_kind), `${label}.source_kind is unsupported`, 4);
  string(binding.evidence_kind, `${label}.evidence_kind`);
  requireValue(binding.subject_id === candidate.normalized.candidate_id,
    `${label}.subject_id does not bind the reviewed candidate`, 4);
  requireValue(SHA256_PATTERN.test(binding.digest || ""),
    `${label}.digest must be a sha256 digest`, 4);
  const reserved = RESERVED_DESIGN_EVIDENCE_ROLES.get(binding.evidence_role);
  if (reserved) {
    requireValue(binding.source_kind === reserved[0] && binding.evidence_kind === reserved[1],
      `${label} uses the wrong typed source for ${binding.evidence_role}`, 4);
  } else {
    requireValue(binding.source_kind === "candidate-evidence" &&
      binding.evidence_kind === "design-contract",
    `${label} custom evidence role must come from a candidate design-contract`, 4);
  }
  let resolved = false;
  if (binding.source_kind === "candidate-field") {
    const field = binding.evidence_kind === "rationale"
      ? "rationale" : "reference_reasoning_trace";
    resolved = binding.digest === candidateFieldEvidenceDigest(candidate, field);
  }
  if (binding.source_kind === "candidate-evidence") {
    resolved = candidate.evidence.some((item) =>
      item.evidence_kind === binding.evidence_kind && item.digest === binding.digest &&
      (binding.evidence_kind !== "design-contract" ||
        item.contract_roles.includes(binding.evidence_role)));
  }
  if (binding.source_kind === "browser-result") {
    resolved = binding.evidence_kind === "result" && binding.digest === browser.result_digest;
  }
  if (binding.source_kind === "browser-evidence") {
    resolved = browser.evidence.some((item) => {
      if (item.evidence_kind !== binding.evidence_kind || item.digest !== binding.digest) return false;
      if (binding.evidence_role === "contrast-report") return item.checks.includes("contrast");
      if (binding.evidence_role === "state-evidence") return item.checks.includes("state");
      if (binding.evidence_role === "playwright-evidence") {
        return containsAll(item.checks, state.brief.evidence.required_checks);
      }
      return true;
    });
  }
  if (binding.source_kind === "review-evidence") {
    resolved = reviewResult.evidence.some((item) =>
      item.kind === binding.evidence_kind && hashArtifact(item.path) === binding.digest);
  }
  if (binding.source_kind === "reference-authority") {
    resolved = binding.evidence_kind === "source-capture-set" &&
      binding.digest === state.reference_pack?.producer_state
        ?.review_source_authority?.capture_set_digest;
  }
  requireValue(resolved,
    `${label} does not resolve to digest-bound evidence for ${candidate.normalized.candidate_id}`, 4);
}

function validateScoreSet(state, result, kind) {
  const direction = kind === "direction-review";
  const records = state.results.filter((record) => record.normalized.kind ===
    (direction ? "direction-candidate" : "color-candidate"));
  const candidateIds = records.map((record) => record.normalized.candidate_id);
  requireValue(Array.isArray(result.scores) && result.scores.length === candidateIds.length,
    `${kind} must score every candidate`, 4);
  const seen = new Set();
  const criteria = direction ? DIRECTION_CRITERIA : COLOR_CRITERIA;
  for (const [index, score] of result.scores.entries()) {
    const label = `${kind} scores[${index}]`;
    exact(score, new Set(["candidate_id", "criteria", "rationale"]), label);
    requireValue(candidateIds.includes(score.candidate_id) && !seen.has(score.candidate_id),
      `${label}.candidate_id must be unique and known`, 4);
    seen.add(score.candidate_id);
    string(score.rationale, `${label}.rationale`);
    exact(score.criteria, new Set(criteria), `${label}.criteria`);
    for (const criterion of criteria) {
      requireValue(Number.isInteger(score.criteria[criterion]) &&
        score.criteria[criterion] >= 1 && score.criteria[criterion] <= 5,
      `${label}.criteria.${criterion} must be an integer from 1 to 5`, 4);
    }
  }
  uniqueStrings(result.ranking, `${kind} ranking`);
  requireValue(sameSet(result.ranking, candidateIds), `${kind} ranking must contain every candidate exactly once`, 4);
  requireValue(Array.isArray(result.blockers), `${kind} blockers must be an array`, 4);
  for (const [index, blocker] of result.blockers.entries()) {
    const label = `${kind} blockers[${index}]`;
    exact(blocker, new Set(["candidate_id", "code", "message", "hard"]), label);
    requireValue(candidateIds.includes(blocker.candidate_id), `${label}.candidate_id is unknown`, 4);
    string(blocker.code, `${label}.code`);
    string(blocker.message, `${label}.message`);
    requireValue(typeof blocker.hard === "boolean", `${label}.hard must be boolean`, 4);
  }
  if (state.reference_pack) {
    const sourceAnalysis = validateSourceCompositionAnalysis(
      state, result, kind, records
    );
    const contracts = designCheckContracts(state, kind);
    const requiredChecks = contracts.map((contract) => contract.check_id);
    requireValue(Array.isArray(result.reference_checks) &&
      result.reference_checks.length === candidateIds.length,
    `${kind} must report reference checks for every candidate`, 4);
    const checked = new Set();
    for (const [index, item] of result.reference_checks.entries()) {
      const label = `${kind} reference_checks[${index}]`;
      exact(item, new Set(["candidate_id", "checks", "rationale"]), label);
      requireValue(candidateIds.includes(item.candidate_id) && !checked.has(item.candidate_id),
        `${label}.candidate_id must be unique and known`, 4);
      checked.add(item.candidate_id);
      string(item.rationale, `${label}.rationale`);
      requireValue(Array.isArray(item.checks) && item.checks.length === contracts.length,
        `${label}.checks must cover every stage-scoped design check`, 4);
      const candidate = records.find((record) =>
        record.normalized.candidate_id === item.candidate_id);
      const browser = resultForCandidate(state, item.candidate_id, "browser-evidence");
      requireValue(candidate && browser,
        `${label} cannot resolve its candidate or browser evidence`, 4);
      const seenChecks = new Set();
      for (const [checkIndex, check] of item.checks.entries()) {
        const checkLabel = `${label}.checks[${checkIndex}]`;
        exact(check, new Set([
          "check_id", "passed", "evidence_bindings"
        ]), checkLabel);
        const contract = contracts.find((entry) => entry.check_id === check.check_id);
        requireValue(contract && !seenChecks.has(check.check_id),
          `${checkLabel}.check_id must be unique and stage-scoped`, 4);
        seenChecks.add(check.check_id);
        requireValue(typeof check.passed === "boolean",
          `${checkLabel}.passed must be boolean`, 4);
        requireValue(Array.isArray(check.evidence_bindings) &&
          check.evidence_bindings.length === contract.required_evidence.length,
        `${checkLabel}.evidence_bindings must cover every required evidence role`, 4);
        const roles = new Set();
        for (const [bindingIndex, binding] of check.evidence_bindings.entries()) {
          validateReferenceEvidenceBinding(state, result, candidate, browser, binding,
            `${checkLabel}.evidence_bindings[${bindingIndex}]`);
          requireValue(contract.required_evidence.includes(binding.evidence_role) &&
            !roles.has(binding.evidence_role),
          `${checkLabel} has an unknown or duplicate required evidence role`, 4);
          roles.add(binding.evidence_role);
        }
        requireValue(sameSet([...roles], contract.required_evidence),
          `${checkLabel} required evidence roles are incomplete`, 4);
        if (check.check_id === "source-composition-independence") {
          requireValue(check.passed === (sourceAnalysis.candidates.get(
            item.candidate_id
          ).source_composition_independence === "pass"),
          `${checkLabel} conflicts with the typed source-composition verdict`, 4);
        }
        if (check.check_id === "promotional-citation-firewall") {
          requireValue(check.passed === (sourceAnalysis.candidates.get(
            item.candidate_id
          ).promotional_citation_firewall === "pass"),
          `${checkLabel} conflicts with the typed promotional-firewall verdict`, 4);
        }
        if (!check.passed) {
          requireValue(result.blockers.some((blocker) =>
            blocker.candidate_id === item.candidate_id && blocker.hard &&
            blocker.code === contract.failure_code),
          `${checkLabel} failure requires a matching hard blocker`, 4);
        }
      }
      requireValue(sameSet([...seenChecks], requiredChecks),
        `${label}.checks does not match the required stage-scoped set`, 4);
    }
  } else {
    requireValue(result.reference_checks === undefined,
      `${kind} cannot claim checks from an unbound reference pack`, 4);
  }
  requireValue(result.evidence.some((item) => item.kind === "review-report"),
    `${kind} requires review-report evidence`, 4);
  const creatorActorIds = canonicalIdentitySet(
    records.map((record) => record.normalized.actor.actor_id)
  );
  if (!direction) {
    for (const record of records) {
      const sourceDirection = resultForCandidate(
        state,
        record.normalized.design_candidate_id,
        "direction-candidate"
      );
      requireValue(sourceDirection,
        `color review cannot resolve source direction creator: ${record.normalized.candidate_id}`, 4);
      creatorActorIds.add(canonicalIdentityKey(sourceDirection.normalized.actor.actor_id));
    }
  }
  requireValue(!creatorActorIds.has(canonicalIdentityKey(result.actor.actor_id)),
    "creator cannot review a candidate it created or a downstream candidate derived from its work", 4);
}

function hex(value, label) {
  string(value, label);
  requireValue(HEX_PATTERN.test(value), `${label} must be normalized #RRGGBB`, 4);
  return value;
}

function linearChannel(channel) {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function luminance(value) {
  const [r, g, b] = [1, 3, 5].map((offset) => parseInt(value.slice(offset, offset + 2), 16));
  return 0.2126 * linearChannel(r) + 0.7152 * linearChannel(g) + 0.0722 * linearChannel(b);
}

export function contrastRatio(left, right) {
  const values = [luminance(left), luminance(right)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

function requireContrast(roles, foreground, background, ratio) {
  requireValue(contrastRatio(roles[foreground], roles[background]) >= ratio,
    `color roles ${foreground}/${background} must reach ${ratio}:1 contrast`, 4);
}

function validateColorCandidate(state, packet, result) {
  requireValue(result.candidate_id === packet.design_task.candidate_id,
    "color candidate_id mismatch", 4);
  requireValue(result.design_candidate_id === packet.design_task.design_candidate_id,
    "color design_candidate_id mismatch", 4);
  requireValue(result.color_strategy_id === packet.design_task.color_strategy.id,
    "color strategy id mismatch", 4);
  requireValue(result.source_design_digest === packet.design_task.source_design_digest,
    "color source design digest mismatch", 4);
  string(result.rationale, "color result rationale");
  validateReferenceReasoningTrace(state, result, `color ${result.candidate_id}`, { color: true });
  const source = resultForCandidate(state, result.design_candidate_id, "direction-candidate");
  requireValue(source, "color candidate source direction is missing", 4);
  const signature = structuredClone(source.normalized.signature);
  signature.palette = result.palette;
  const contract = approvedSignature(signature);
  validateVisualSignatureContract(contract, `color ${result.candidate_id} signature`);
  result.palette = visualSignatureBody(contract).palette;

  exact(result.color_system, new Set([
    "color_space", "harmony_strategy", "neutral_temperature", "roles", "tone_scales",
    "color_only_meaning", "gamut_targets"
  ]), "color result color_system");
  requireValue(result.color_system.color_space === packet.design_task.color_strategy.color_space,
    "color result color_space does not match the selected strategy", 4);
  requireValue(result.color_system.harmony_strategy === packet.design_task.color_strategy.harmony_strategy,
    "color result harmony_strategy does not match the selected strategy", 4);
  string(result.color_system.neutral_temperature, "color result neutral_temperature");
  exact(result.color_system.roles, new Set(REQUIRED_COLOR_ROLES), "color result roles");
  for (const role of REQUIRED_COLOR_ROLES) hex(result.color_system.roles[role], `color result roles.${role}`);
  requireValue(result.color_system.color_only_meaning === false,
    "color system must not encode meaning through color alone", 4);
  uniqueStrings(result.color_system.gamut_targets, "color result gamut_targets");
  requireValue(result.color_system.gamut_targets.includes("srgb"), "color system must include an sRGB target", 4);
  requireValue(Array.isArray(result.color_system.tone_scales) && result.color_system.tone_scales.length >= 3,
    "color system requires at least three tone scales", 4);
  const toneRoles = new Set();
  for (const [index, scale] of result.color_system.tone_scales.entries()) {
    const label = `color result tone_scales[${index}]`;
    exact(scale, new Set(["role", "stops"]), label);
    string(scale.role, `${label}.role`);
    requireValue(!toneRoles.has(scale.role), `${label}.role must be unique`, 4);
    toneRoles.add(scale.role);
    uniqueStrings(scale.stops, `${label}.stops`);
    requireValue(scale.stops.length >= 5, `${label}.stops requires at least five tones`, 4);
    scale.stops.forEach((value, stop) => hex(value, `${label}.stops[${stop}]`));
  }
  const roleValues = new Set(Object.values(result.color_system.roles));
  for (const group of Object.values(result.palette)) {
    for (const reference of group) {
      hex(reference.value, "color palette reference value");
      requireValue(roleValues.has(reference.value),
        `color palette value is not bound to a semantic role: ${reference.value}`, 4);
    }
  }
  const roles = result.color_system.roles;
  for (const foreground of ["text_primary", "text_secondary", "text_muted"]) {
    requireContrast(roles, foreground, "canvas", 4.5);
  }
  requireContrast(roles, "text_primary", "surface", 4.5);
  requireContrast(roles, "text_primary", "surface_raised", 4.5);
  for (const background of ["action_primary", "action_primary_hover", "action_primary_pressed"]) {
    requireContrast(roles, "on_action", background, 4.5);
  }
  for (const background of ["accent", "accent_hover"]) {
    requireContrast(roles, "on_accent", background, 4.5);
  }
  for (const semantic of ["success", "warning", "danger", "info"]) {
    requireContrast(roles, `on_${semantic}`, semantic, 4.5);
  }
  requireContrast(roles, "focus_ring", "canvas", 3);
  requireContrast(roles, "focus_ring", "surface", 3);
  requireContrast(roles, "focus_ring", "surface_raised", 3);
  requireContrast(roles, "border_default", "canvas", 3);
  requireValue(result.evidence.filter((item) => item.kind === "prototype").length === 1,
    `color ${result.candidate_id} requires exactly one prototype`, 4);
  validateTokenSpec(result);
  validateDesignContractEvidence(state, result, "color-review");
  validateCandidateSourceIndependence(state, result, `color ${result.candidate_id}`);
}

export function validateDesignResult(state, packet, input, sourcePath) {
  const result = baseResult(state, packet, input, sourcePath);
  const candidate = result.kind === "direction-candidate" || result.kind === "color-candidate";
  const review = result.kind === "direction-review" || result.kind === "color-review";
  if (!candidate) {
    requireValue(result.reference_reasoning_trace === undefined,
      `${result.kind} cannot return a creator reference reasoning trace`, 4);
  }
  if (!review) {
    requireValue(result.reference_checks === undefined,
      `${result.kind} cannot return independent reference checks`, 4);
  }
  if (result.kind === "direction-candidate") validateDirectionCandidate(state, packet, result);
  if (result.kind === "browser-evidence") validateBrowserResult(state, packet, result);
  if (result.kind === "direction-review" || result.kind === "color-review") {
    validateScoreSet(state, result, result.kind);
  }
  if (result.kind === "color-candidate") validateColorCandidate(state, packet, result);
  return result;
}

function snapshotResultEvidence(result, root) {
  return result.evidence.map((item) => ({
    ...publicSnapshot(snapshotArtifact(item.path, { root })),
    resolved_path: path.resolve(item.path),
    evidence_kind: item.kind,
    viewport: item.viewport || null,
    state: item.state || null,
    checks: [...(item.checks || [])],
    contract_roles: [...(item.contract_roles || [])]
  }));
}

function recordResult(state, packet, input, sourcePath, sourceSnapshotOverride = null) {
  requireValue(!resultForPacket(state, packet.packet_id),
    `design result already exists for packet: ${packet.packet_id}`, 4);
  const absoluteSource = path.resolve(sourcePath);
  const normalized = validateDesignResult(state, packet, input, absoluteSource);
  const record = {
    packet_id: packet.packet_id,
    provider_id: packet.provider.id,
    participant: structuredClone(packet.participant),
    result_digest: canonicalDigest(normalized),
    source: sourceSnapshotOverride || snapshotArtifact(absoluteSource, { root: state.state_directory }),
    evidence: snapshotResultEvidence(normalized, state.state_directory),
    normalized,
    recorded_at: nowIso()
  };
  state.results.push(record);
  return record;
}

function verifyBoundSnapshot(snapshot, label) {
  const verification = verifySnapshot(snapshot);
  requireValue(verification.ok,
    `${label} changed after it was digest-bound (${verification.reason})`, 4);
}

function readBoundDesignJson(snapshot, label, root) {
  verifyBoundSnapshot(snapshot, label);
  const pinned = readPinnedDesignJson(snapshot.resolved_path, label);
  const current = pinnedDesignSnapshot(pinned, root);
  requireValue(
    fs.realpathSync(current.resolved_path) === fs.realpathSync(snapshot.resolved_path) &&
      current.digest === snapshot.digest &&
      current.bytes === snapshot.bytes &&
      current.physical_identity_digest === snapshot.physical_identity_digest,
    `${label} physical identity changed before parse`,
    4
  );
  return pinned.input;
}

function requireExternalOwnerSource(state, resolvedPath, label) {
  requireValue(typeof resolvedPath === "string" && resolvedPath.trim(),
    `${label} source path is missing`, 4);
  const physicalSource = fs.realpathSync(resolvedPath);
  const physicalStateDirectory = fs.realpathSync(state.state_directory);
  requireValue(!inside(physicalSource, physicalStateDirectory),
    `${label} must be copied outside the design run state directory before ingest`, 4);
}

export function readDesignState(statePath, { faultInjector = null } = {}) {
  const absolute = path.resolve(statePath);
  const state = readPinnedDesignJson(absolute, "design exploration run").input;
  requireValue(state.design_exploration_run_version === 1,
    "design_exploration_run_version must be 1");
  requireValue(fs.realpathSync(state.state_path) === fs.realpathSync(absolute),
    "design state path does not match the resume target", 4);
  requireValue(fs.realpathSync(state.state_directory) ===
    fs.realpathSync(stateDirectory(absolute)),
    "design state directory does not match the derived resume directory", 4);
  requireValue(canonicalDigest(stateBody(state)) === state.state_digest,
    "design state digest mismatch", 4);
  const verificationContext = {
    hostAuthorities: new Map(),
    verifiedEntrypointSnapshots: new Map(),
    verifiedAttemptAuthorities: new WeakSet(),
    acceptedAttempts: new WeakMap()
  };
  verifyJourneyIdentity(state.journey_identity, {
    runId: state.run_id,
    label: "design exploration journey_identity"
  });
  validateDesignBrief(state.brief);
  const sourceBrief = validateDesignBrief(readBoundDesignJson(
    state.brief_source,
    "design brief",
    path.dirname(state.brief_source.resolved_path)
  ));
  requireValue(canonicalDigest(sourceBrief) === canonicalDigest(state.brief),
    "design brief state binding mismatch", 4);
  verifyBoundSnapshot(state.baseline, "design baseline");
  if (state.reference_pack) {
    verifyBoundSnapshot(state.reference_pack.source, "reference intelligence pack");
    const pinnedPack = readPinnedDesignJson(
      state.reference_pack.source.resolved_path,
      "reference intelligence pack"
    );
    const currentPack = pinnedDesignSnapshot(pinnedPack, "/");
    requireValue(currentPack.digest === state.reference_pack.source.digest &&
      currentPack.physical_identity_digest ===
        state.reference_pack.source.physical_identity_digest &&
      currentPack.bytes === state.reference_pack.source.bytes,
    "reference intelligence pack physical identity changed before parse", 4);
    const resolved = validatePinnedReferencePack({
      ...state.brief,
      reference_pack: {
        path: pinnedPack.path,
        digest: pinnedPack.digest,
        producer_state: {
          path: state.reference_pack.producer_state.source.resolved_path,
          digest: state.reference_pack.producer_state.source.digest
        }
      }
    }, pinnedPack, "/");
    requireValue(resolved.pack_digest === state.reference_pack.pack_digest &&
      canonicalDigest(resolved.normalized) === canonicalDigest(state.reference_pack.normalized) &&
      resolved.producer_state.run_id === state.reference_pack.producer_state.run_id &&
      resolved.producer_state.state_digest ===
        state.reference_pack.producer_state.state_digest &&
      resolved.producer_state.selection_digest ===
        state.reference_pack.producer_state.selection_digest &&
      resolved.producer_state.source.resolved_path ===
        state.reference_pack.producer_state.source.resolved_path &&
      resolved.producer_state.source.digest ===
        state.reference_pack.producer_state.source.digest &&
      resolved.producer_state.source.bytes ===
        state.reference_pack.producer_state.source.bytes &&
      resolved.producer_state.source.physical_identity_digest ===
        state.reference_pack.producer_state.source.physical_identity_digest &&
      canonicalDigest(resolved.producer_state.result_digests) ===
        canonicalDigest(state.reference_pack.producer_state.result_digests) &&
      canonicalDigest(resolved.producer_state.review_source_authority) ===
        canonicalDigest(state.reference_pack.producer_state.review_source_authority),
    "reference intelligence pack state binding mismatch", 4);
  }
  for (const packet of state.packets || []) {
    verifyPacketJourney(packet, state.journey_identity, `design packet ${packet.packet_id}`);
    requireValue(canonicalDigest(packetBody(packet)) === packet.packet_digest,
      `design packet digest mismatch: ${packet.packet_id}`, 4);
    requireValue(state.packet_files?.[packet.packet_id],
      `design packet file binding is missing: ${packet.packet_id}`, 4);
    const packetSnapshot = state.packet_files[packet.packet_id];
    verifyBoundSnapshot(packetSnapshot, `design packet ${packet.packet_id}`);
    const pinnedPacket = readPinnedDesignJson(
      packetSnapshot.resolved_path,
      `design packet source ${packet.packet_id}`
    );
    const currentPacketSnapshot = pinnedDesignSnapshot(pinnedPacket, state.state_directory);
    requireValue(currentPacketSnapshot.digest === packetSnapshot.digest &&
      currentPacketSnapshot.physical_identity_digest ===
        packetSnapshot.physical_identity_digest &&
      currentPacketSnapshot.bytes === packetSnapshot.bytes,
    `design packet source physical identity changed before parse: ${packet.packet_id}`, 4);
    verifyPacketJourney(
      pinnedPacket.input,
      state.journey_identity,
      `design packet source ${packet.packet_id}`
    );
    requireValue(canonicalDigest(packetBody(pinnedPacket.input)) ===
      pinnedPacket.input.packet_digest,
    `design packet source digest mismatch: ${packet.packet_id}`, 4);
    requireValue(canonicalDigest(pinnedPacket.input) === canonicalDigest(packet),
      `design packet source conflicts with cached packet: ${packet.packet_id}`, 4);
    if (packet.stage_id === "design-direction-generation") {
      requireValue(packet.design_task?.kind === "direction-candidate" &&
        packet.design_task.baseline_digest === state.baseline.digest,
      `design packet baseline authority conflicts with state: ${packet.packet_id}`, 4);
      requireValue(packet.design_task.brief_digest === state.brief_source.digest,
        `design packet brief authority conflicts with state: ${packet.packet_id}`, 4);
    }
  }
  requireValue(Array.isArray(state.results) && Array.isArray(state.attempts),
    "design result and attempt ledgers must be arrays", 4);
  const attemptsByPacket = new Map();
  for (const attempt of state.attempts) {
    const packet = state.packets.find((item) => item.packet_id === attempt.packet_id);
    requireValue(packet && attempt.provider_id === packet.provider.id &&
      attempt.packet_digest === packet.packet_digest &&
      canonicalDigest(attempt.participant) === canonicalDigest(packet.participant) &&
      Number.isInteger(attempt.attempt) && attempt.attempt >= 1 &&
      typeof attempt.execution_status === "string" &&
      (["ran", "manual_recorded", "manual_pending"].includes(attempt.execution_status) ||
        attempt.execution_status.startsWith("blocked")),
    `design attempt execution lineage conflicts with packet: ${attempt.packet_id || "unknown"}`, 4);
    const previous = attemptsByPacket.get(attempt.packet_id) || 0;
    requireValue(attempt.attempt === previous + 1,
      `design attempt sequence is invalid: ${attempt.packet_id}`, 4);
    attemptsByPacket.set(attempt.packet_id, attempt.attempt);
    if (attempt.execution_authority !== undefined) {
      verifyAttemptExecutionAuthority(state, packet, attempt, verificationContext);
    } else {
      const recovery = state.lease_recoveries?.find((receipt) =>
        receipt.recovery_digest === attempt.recovery_digest &&
        receipt.retry_required === true &&
        receipt.abandoned_packet?.packet_id === attempt.packet_id &&
        receipt.abandoned_packet?.provider_id === attempt.provider_id &&
        receipt.abandoned_packet?.attempt === attempt.attempt &&
        receipt.abandoned_packet?.packet_digest === attempt.packet_digest);
      const recoveredWithoutSpawnAuthority =
        ["blocked_abandoned_after_crash", "blocked_abandoned_before_spawn"]
          .includes(attempt.execution_status) && Boolean(recovery);
      requireValue(attempt.adapter === null || attempt.adapter === "manual-v1" ||
        recoveredWithoutSpawnAuthority,
      `design executed attempt lacks immutable execution authority: ${attempt.packet_id}`, 4);
    }
    if (attempt.result_digest !== undefined) {
      const record = state.results.find((item) => item.packet_id === attempt.packet_id);
      requireValue(record && attempt.result_digest === record.result_digest &&
        attempt.result_file_digest === record.source.digest,
      `design attempt result lineage conflicts with packet: ${attempt.packet_id}`, 4);
    }
  }
  for (const record of state.results || []) {
    verifyBoundSnapshot(record.source, `design result ${record.packet_id}`);
    requireValue(canonicalDigest(record.normalized) === record.result_digest,
      `design result digest mismatch: ${record.packet_id}`, 4);
    const pinnedResult = readPinnedDesignJson(
      record.source.resolved_path,
      `design result ${record.packet_id}`
    );
    const currentResultSnapshot = pinnedDesignSnapshot(pinnedResult, state.state_directory);
    requireValue(currentResultSnapshot.digest === record.source.digest &&
      currentResultSnapshot.physical_identity_digest === record.source.physical_identity_digest &&
      currentResultSnapshot.bytes === record.source.bytes,
    `design result source physical identity changed before parse: ${record.packet_id}`, 4);
    const packet = state.packets.find((item) => item.packet_id === record.packet_id);
    requireValue(packet, `design result packet is missing: ${record.packet_id}`, 4);
    requireValue(record.provider_id === packet.provider.id,
      `design result provider conflicts with its packet: ${record.packet_id}`, 4);
    requireValue(canonicalDigest(record.participant) === canonicalDigest(packet.participant),
      `design result participant conflicts with its packet: ${record.packet_id}`, 4);
    const sourceResult = validateDesignResult(
      state,
      packet,
      pinnedResult.input,
      pinnedResult.path
    );
    requireValue(canonicalDigest(sourceResult) === record.result_digest &&
      canonicalDigest(sourceResult) === canonicalDigest(record.normalized),
    `design result source binding mismatch: ${record.packet_id}`, 4);
    const freshEvidence = snapshotResultEvidence(sourceResult, state.state_directory);
    requireValue(canonicalDigest(freshEvidence) === canonicalDigest(record.evidence),
      `design result evidence state binding mismatch: ${record.packet_id}`, 4);
    for (const evidence of record.evidence || []) {
      verifyBoundSnapshot(evidence, `design evidence ${record.packet_id}/${evidence.path}`);
    }
    acceptedAttemptFor(state, record, packet, verificationContext);
  }
  requireValue(Array.isArray(state.lease_recoveries),
    "design state lease_recoveries must be an array", 4);
  for (const receipt of state.lease_recoveries) {
    requireValue(receipt.design_lease_recovery_version === 1 &&
      receipt.run_id === state.run_id &&
      identitiesMatch(receipt.journey_identity, state.journey_identity) &&
      SHA256_PATTERN.test(receipt.recovery_digest || "") &&
      canonicalDigest(recoveryBody(receipt)) === receipt.recovery_digest,
    "design lease recovery receipt is invalid", 4);
  }
  if (state.in_flight !== null) {
    object(state.in_flight, "design in_flight intent");
    requireValue(Object.keys(state.in_flight).sort().join(",") ===
      ["attempt", "packet_digest", "packet_id", "provider_id", "started_at"].sort().join(","),
    "design in_flight intent contains unsupported or missing fields", 4);
    const packet = state.packets.find((item) => item.packet_id === state.in_flight.packet_id);
    requireValue(packet && state.in_flight.provider_id === packet.provider.id &&
      state.in_flight.packet_digest === packet.packet_digest &&
      Number.isInteger(state.in_flight.attempt) && state.in_flight.attempt >= 1 &&
      !Number.isNaN(Date.parse(state.in_flight.started_at || "")),
    "design in_flight intent conflicts with its packet", 4);
  }
  validateDesignDecisionState(state, verificationContext);
  validatePendingFinalization(state);
  for (const [label, snapshot] of Object.entries(state.outputs || {})) {
    verifyBoundSnapshot(snapshot, `design output ${label}`);
  }
  validateDesignLifecycleState(state, verificationContext);
  faultInjector?.("before-final-read-authority-cache-verification", {
    state_path: state.state_path,
    state_digest: state.state_digest,
    cached_host_manifest_count: verificationContext.hostAuthorities.size,
    cached_entrypoint_count:
      verificationContext.verifiedEntrypointSnapshots.size
  });
  verifyDesignReadAuthorityCache(verificationContext);
  return state;
}

function scoreFor(review, candidateId) {
  return review.normalized.scores.find((item) => item.candidate_id === candidateId);
}

function hasHardBlocker(review, candidateId) {
  return review.normalized.blockers.some((item) => item.candidate_id === candidateId && item.hard);
}

function eligibleDirectionIds(state) {
  const review = resultForPacket(state, "direction-review");
  if (!review) return [];
  const trustMinimum = state.brief.product.trust_risk === "high" ? 4 : 3;
  return review.normalized.ranking.filter((candidateId) => {
    const score = scoreFor(review, candidateId)?.criteria;
    return score && !hasHardBlocker(review, candidateId) &&
      score.beauty_lift >= 3 && score.product_fit >= 3 &&
      score.trust_clarity >= trustMinimum && score.density_fit >= 3 &&
      score.responsiveness >= 3 && score.implementation >= 3 &&
      score.distinctiveness >= 3 && score.redesign_depth_fidelity >= 3 &&
      score.typography_fit >= 3 &&
      resultForCandidate(state, candidateId, "browser-evidence");
  });
}

function eligibleColorIds(state) {
  const review = resultForPacket(state, "color-review");
  if (!review) return [];
  return review.normalized.ranking.filter((candidateId) => {
    const score = scoreFor(review, candidateId)?.criteria;
    return score && !hasHardBlocker(review, candidateId) &&
      score.project_fit >= 3 && score.harmony >= 3 && score.role_clarity >= 3 &&
      score.contrast >= 4 && score.semantic_separation >= 3 &&
      score.locale_resilience >= 3 && score.distinctiveness >= 3 &&
      resultForCandidate(state, candidateId, "browser-evidence");
  });
}

function selectionScope(state, verificationContext = null) {
  const candidates = state.results.filter((record) => record.normalized.kind === "direction-candidate");
  const browsers = state.results.filter((record) =>
    record.normalized.kind === "browser-evidence" && record.normalized.subject_kind === "direction-candidate");
  const review = resultForPacket(state, "direction-review");
  return canonicalDigest({
    run_id: state.run_id,
    journey_identity: state.journey_identity,
    brief_digest: state.brief_source.digest,
    baseline_digest: state.baseline.digest,
    candidates: Object.fromEntries(candidates.map((record) => [
      record.normalized.candidate_id,
      resultBinding(state, record, verificationContext)
    ])),
    browser_evidence: Object.fromEntries(browsers.map((record) => [
      record.normalized.candidate_id,
      resultBinding(state, record, verificationContext)
    ])),
    review: review ? resultBinding(state, review, verificationContext) : null
  });
}

function approvalScope(state, verificationContext = null) {
  const colors = state.results.filter((record) => record.normalized.kind === "color-candidate");
  const browsers = state.results.filter((record) =>
    record.normalized.kind === "browser-evidence" && record.normalized.subject_kind === "color-candidate");
  const review = resultForPacket(state, "color-review");
  return canonicalDigest({
    run_id: state.run_id,
    journey_identity: state.journey_identity,
    selection_scope_digest: state.selection_scope_digest,
    shortlist_digest: state.shortlist?.shortlist_digest || null,
    colors: Object.fromEntries(colors.map((record) => [
      record.normalized.candidate_id,
      resultBinding(state, record, verificationContext)
    ])),
    browser_evidence: Object.fromEntries(browsers.map((record) => [
      record.normalized.candidate_id,
      resultBinding(state, record, verificationContext)
    ])),
    review: review ? resultBinding(state, review, verificationContext) : null
  });
}

function validateShortlistInput(state, input, label = "design shortlist") {
  exact(input, new Set([
    "design_shortlist_version", "run_id", "journey_identity", "selection_scope_digest", "owner_id",
    "candidate_ids", "rationale", "decided_at"
  ]), label);
  requireValue(input.design_shortlist_version === 1, "design_shortlist_version must be 1", 4);
  requireValue(input.run_id === state.run_id, "design shortlist run_id mismatch", 4);
  requireValue(identitiesMatch(input.journey_identity, state.journey_identity),
    "design shortlist journey_identity mismatch", 4);
  requireValue(input.selection_scope_digest === state.selection_scope_digest,
    "design shortlist scope digest mismatch", 4);
  string(input.owner_id, "design shortlist owner_id");
  uniqueStrings(input.candidate_ids, "design shortlist candidate_ids");
  requireValue(input.candidate_ids.length === 3,
    "owner shortlist must contain exactly three directions", 4);
  const eligible = eligibleDirectionIds(state);
  requireValue(input.candidate_ids.every((candidateId) => eligible.includes(candidateId)),
    "owner shortlist contains an ineligible or hard-blocked direction", 4);
  string(input.rationale, "design shortlist rationale");
  requireValue(!Number.isNaN(Date.parse(input.decided_at)),
    "design shortlist decided_at is invalid", 4);
  const creators = input.candidate_ids.map((candidateId) =>
    resultForCandidate(state, candidateId, "direction-candidate").normalized.actor.actor_id);
  requireValue(!canonicalIdentitySet(creators).has(canonicalIdentityKey(input.owner_id)),
    "candidate creator cannot make the owner shortlist", 4);
  requireIndependentDesignOwner(state, input.owner_id, "design shortlist owner");
  return input;
}

function designParticipantAuthorityIds(state) {
  const providerIds = [
    ...state.packets.map((packet) => packet.provider.id),
    ...state.brief.directions.map((direction) => direction.creator_provider_id),
    ...state.brief.color_strategies.map((strategy) => strategy.creator_provider_id),
    ...Object.values(state.brief.providers)
  ];
  const actorIds = state.results.map((record) => record.normalized.actor.actor_id);
  const sourceAuthority = state.reference_pack?.producer_state?.review_source_authority;
  return canonicalIdentitySet([
    state.journey_identity.orchestrator_id,
    state.journey_identity.display_name,
    state.journey_identity.canonical_entrypoint,
    ...providerIds,
    ...actorIds,
    ...(sourceAuthority?.source_recipient_provider_ids || []),
    ...(sourceAuthority?.source_recipient_actor_ids || [])
  ]);
}

function requireIndependentDesignOwner(state, ownerId, label) {
  assertInternalIdentityIsNotOrchestrator(ownerId, {
    orchestratorId: state.journey_identity.orchestrator_id,
    label
  });
  requireValue(!designParticipantAuthorityIds(state).has(canonicalIdentityKey(ownerId)),
    `${label} must be external to the KillSlopRouter parent and every routed participant`, 4);
}

function validateApprovalInput(state, input, label = "design owner decision") {
  exact(input, new Set([
    "design_owner_decision_version", "run_id", "journey_identity", "approval_scope_digest", "owner_id", "status",
    "selected_design_candidate_id", "selected_color_candidate_id", "note", "decided_at"
  ]), label);
  requireValue(input.design_owner_decision_version === 1,
    "design_owner_decision_version must be 1", 4);
  requireValue(input.run_id === state.run_id, "design owner decision run_id mismatch", 4);
  requireValue(identitiesMatch(input.journey_identity, state.journey_identity),
    "design owner decision journey_identity mismatch", 4);
  requireValue(input.approval_scope_digest === state.approval_scope_digest,
    "design owner decision scope digest mismatch", 4);
  string(input.owner_id, "design owner decision owner_id");
  requireValue(["approved", "rejected"].includes(input.status),
    "design owner decision status must be approved or rejected", 4);
  string(input.selected_design_candidate_id,
    "design owner decision selected_design_candidate_id");
  string(input.selected_color_candidate_id,
    "design owner decision selected_color_candidate_id");
  string(input.note, "design owner decision note");
  requireValue(!Number.isNaN(Date.parse(input.decided_at)),
    "design owner decision decided_at is invalid", 4);
  if (input.status === "approved") {
    requireValue(state.shortlist.normalized.candidate_ids.includes(
      input.selected_design_candidate_id),
    "owner decision selected design is outside the shortlist", 4);
    requireValue(eligibleColorIds(state).includes(input.selected_color_candidate_id),
      "owner decision selected color is ineligible or hard-blocked", 4);
    const color = resultForCandidate(state, input.selected_color_candidate_id, "color-candidate");
    requireValue(color?.normalized.design_candidate_id === input.selected_design_candidate_id,
      "selected color does not belong to the selected design", 4);
    const creators = [
      resultForCandidate(
        state, input.selected_design_candidate_id, "direction-candidate"
      ).normalized.actor.actor_id,
      color.normalized.actor.actor_id
    ];
    requireValue(!canonicalIdentitySet(creators).has(canonicalIdentityKey(input.owner_id)),
      "candidate creator cannot approve its own design", 4);
  }
  requireIndependentDesignOwner(state, input.owner_id, "design approval owner");
  return input;
}

function requireCompleteGateResults(state, {
  stage,
  kind,
  subjectKind = null,
  expected,
  label
}) {
  const packets = packetsOfStage(state, stage)
    .filter((packet) => (!kind || packet.design_task.kind === kind) &&
      (!subjectKind || packet.design_task.subject_kind === subjectKind));
  requireValue(packets.length === expected &&
    packets.every((packet) => Boolean(resultForPacket(state, packet.packet_id))),
  `${label} requires complete packet results`, 4);
}

function validateDesignDecisionState(state, verificationContext) {
  if (state.selection_scope_digest !== null) {
    requireCompleteGateResults(state, {
      stage: "design-direction-generation",
      kind: "direction-candidate",
      expected: state.brief.directions.length * DESIGN_DEPTHS.length,
      label: "design selection scope"
    });
    requireCompleteGateResults(state, {
      stage: "browser-evidence",
      kind: "browser-evidence",
      subjectKind: "direction-candidate",
      expected: state.brief.directions.length * DESIGN_DEPTHS.length,
      label: "design selection scope"
    });
    requireValue(Boolean(resultForPacket(state, "direction-review")),
      "design selection scope requires a direction review result", 4);
    requireValue(eligibleDirectionIds(state).length >= 3,
      "design selection scope requires three eligible directions", 4);
    requireValue(state.selection_scope_digest ===
      selectionScope(state, verificationContext),
    "design selection scope digest mismatch", 4);
  }

  if (state.shortlist) {
    requireValue(state.selection_scope_digest !== null,
      "design shortlist cannot exist before the selection scope", 4);
    requireValue(state.status === "running" || [
      "direction-selection", "color-generation", "color-browser-evidence",
      "color-diversity", "color-review", "owner-approval", "complete"
    ].includes(state.phase),
    "design shortlist conflicts with the persisted phase", 4);
    requireExternalOwnerSource(
      state,
      state.shortlist.source?.resolved_path,
      "design shortlist"
    );
    const source = readBoundDesignJson(
      state.shortlist.source,
      "design shortlist",
      state.state_directory
    );
    const sourceShortlist = validateShortlistInput(state, source);
    const cachedShortlist = validateShortlistInput(
      state,
      state.shortlist.normalized,
      "cached design shortlist"
    );
    requireValue(canonicalDigest(sourceShortlist) === state.shortlist.shortlist_digest &&
      canonicalDigest(cachedShortlist) === state.shortlist.shortlist_digest,
    "design shortlist state binding mismatch", 4);
  } else {
    requireValue(state.approval === null,
      "design owner decision cannot exist before the shortlist", 4);
  }

  if (state.approval_scope_digest !== null) {
    requireValue(Boolean(state.shortlist),
      "design approval scope cannot exist before the shortlist", 4);
    const expectedColors = state.shortlist.normalized.candidate_ids.length *
      state.brief.color_strategies.length;
    requireCompleteGateResults(state, {
      stage: "color-system-generation",
      kind: "color-candidate",
      expected: expectedColors,
      label: "design approval scope"
    });
    const colorBrowserPackets = state.packets.filter((packet) =>
      packet.stage_id === "browser-evidence" &&
      packet.design_task.subject_kind === "color-candidate");
    requireValue(colorBrowserPackets.length === expectedColors &&
      colorBrowserPackets.every((packet) =>
        Boolean(resultForPacket(state, packet.packet_id))),
    "design approval scope requires complete color browser results", 4);
    requireValue(Boolean(resultForPacket(state, "color-review")),
      "design approval scope requires a color review result", 4);
    const eligibleColors = eligibleColorIds(state);
    requireValue(state.shortlist.normalized.candidate_ids.every((designId) =>
      eligibleColors.some((candidateId) =>
        resultForCandidate(state, candidateId, "color-candidate")
          ?.normalized.design_candidate_id === designId)),
    "design approval scope requires an eligible color for every shortlisted direction", 4);
    requireValue(state.approval_scope_digest ===
      approvalScope(state, verificationContext),
    "design approval scope digest mismatch", 4);
  }

  if (state.approval) {
    requireValue(state.approval_scope_digest !== null,
      "design owner decision cannot exist before the approval scope", 4);
    requireValue(state.status === "running" ||
      ["owner-approval", "complete"].includes(state.phase),
    "design owner decision conflicts with the persisted phase", 4);
    requireExternalOwnerSource(
      state,
      state.approval.source?.resolved_path,
      "design owner decision"
    );
    const source = readBoundDesignJson(
      state.approval.source,
      "design owner decision",
      state.state_directory
    );
    const sourceApproval = validateApprovalInput(state, source);
    const cachedApproval = validateApprovalInput(
      state,
      state.approval.normalized,
      "cached design owner decision"
    );
    requireValue(canonicalDigest(sourceApproval) === state.approval.approval_digest &&
      canonicalDigest(cachedApproval) === state.approval.approval_digest,
    "design owner decision state binding mismatch", 4);
  }
}

function ingestShortlist(state, lease, shortlistPath, faultInjector = null) {
  requireValue(!state.shortlist, "design shortlist is already recorded", 4);
  const absolute = path.resolve(shortlistPath);
  const pinned = readPinnedDesignJson(absolute, "design shortlist");
  requireExternalOwnerSource(state, pinned.path, "design shortlist");
  const input = validateShortlistInput(state, pinned.input);
  state.shortlist = {
    normalized: structuredClone(input),
    shortlist_digest: canonicalDigest(input),
    source: pinnedDesignSnapshot(pinned, state.state_directory)
  };
  writeState(state, lease, { faultInjector });
}

function ingestApproval(state, lease, approvalPath, faultInjector = null) {
  requireValue(!state.approval, "design owner decision is already recorded", 4);
  const absolute = path.resolve(approvalPath);
  const pinned = readPinnedDesignJson(absolute, "design owner decision");
  requireExternalOwnerSource(state, pinned.path, "design owner decision");
  const input = validateApprovalInput(state, pinned.input);
  state.approval = {
    normalized: structuredClone(input),
    approval_digest: canonicalDigest(input),
    source: pinnedDesignSnapshot(pinned, state.state_directory)
  };
  writeState(state, lease, { faultInjector });
}

function receiptEvidence(kind, source, publishedPath = null) {
  if (source && typeof source === "object") {
    verifyBoundSnapshot(source, `${kind} receipt evidence`);
    return {
      kind,
      path: path.resolve(publishedPath || source.resolved_path),
      digest: source.digest
    };
  }
  return {
    kind,
    path: path.resolve(publishedPath || source),
    digest: hashArtifact(source)
  };
}

function selectedReferenceTraceBinding(record) {
  const traces = record.normalized.reference_reasoning_trace;
  requireValue(Array.isArray(traces) && traces.length > 0,
    `selected reference-backed candidate is missing its reasoning trace: ${record.packet_id}`, 4);
  return {
    candidate_id: record.normalized.candidate_id,
    trace_ids: traces.map((trace, index) => canonicalDigest({
      candidate_id: record.normalized.candidate_id,
      index,
      trace
    })),
    trace_digest: canonicalDigest(traces),
    grammar_ids: [...new Set(traces.flatMap((trace) => trace.grammar_ids))].sort(),
    reasoning_ids: [...new Set(traces.flatMap((trace) => trace.reasoning_ids))].sort()
  };
}

function compiledReferenceIntelligenceBinding(state, {
  direction,
  color,
  directionReview,
  colorReview
}) {
  if (!state.reference_pack) return null;
  const pack = state.reference_pack.normalized;
  const directionAnalysis = directionReview.evidence.find((item) =>
    item.evidence_kind === "source-composition-analysis");
  const colorAnalysis = colorReview.evidence.find((item) =>
    item.evidence_kind === "source-composition-analysis");
  requireValue(directionAnalysis && colorAnalysis,
    "approved reference-backed design is missing source composition analysis", 4);
  const body = {
    reference_intelligence_binding_version: 1,
    authority_scope: pack.authority_scope,
    visual_authority_granted: false,
    planning_target_id: pack.planning_target_id,
    product_frame_digest: pack.product_frame_digest,
    pack_digest: state.reference_pack.pack_digest,
    reference_pack_source_digest: state.reference_pack.source.digest,
    producer_run_id: state.reference_pack.producer_state.run_id,
    producer_state_digest: state.reference_pack.producer_state.state_digest,
    producer_state_file_digest: state.reference_pack.producer_state.source.digest,
    producer_selection_digest: state.reference_pack.producer_state.selection_digest,
    producer_result_digests: structuredClone(
      state.reference_pack.producer_state.result_digests
    ),
    review_source_capture_set_digest: state.reference_pack.producer_state
      .review_source_authority.capture_set_digest,
    reasoning_registry_digest: pack.provenance.reasoning_registry_digest,
    selected_direction_trace: selectedReferenceTraceBinding(direction),
    selected_color_trace: selectedReferenceTraceBinding(color),
    direction_review_result_digest: directionReview.result_digest,
    color_review_result_digest: colorReview.result_digest,
    direction_source_composition_analysis_digest: directionAnalysis.digest,
    color_source_composition_analysis_digest: colorAnalysis.digest
  };
  return { ...body, binding_digest: canonicalDigest(body) };
}

const FINAL_OUTPUT_NAMES = Object.freeze({
  decision: "design-direction-decision.json",
  visual_intent_receipt: "visual-intent-approval.json",
  visual_signature_receipt: "visual-signature-approval.json",
  profile_bindings: "profile-bindings.json"
});

function finalOutputLocations(state) {
  const directory = path.join(state.state_directory, "approved");
  const stagingDirectory = path.join(state.state_directory, "approved.staging");
  return {
    directory,
    staging_directory: stagingDirectory,
    files: Object.fromEntries(Object.entries(FINAL_OUTPUT_NAMES).map(([key, name]) => [
      key,
      {
        name,
        published_path: path.join(directory, name),
        staging_path: path.join(stagingDirectory, name)
      }
    ]))
  };
}

function pendingFinalization(state, locations, finalReceiptDigests) {
  const files = Object.fromEntries(Object.entries(locations.files).map(([key, item]) => {
    const snapshot = snapshotArtifact(item.staging_path, { root: state.state_directory });
    return [key, { name: item.name, digest: snapshot.digest, bytes: snapshot.bytes }];
  }));
  const body = {
    design_finalization_transaction_version: 1,
    directory: locations.directory,
    staging_directory: locations.staging_directory,
    files,
    final_receipt_digests: structuredClone(finalReceiptDigests)
  };
  return { ...body, transaction_digest: canonicalDigest(body) };
}

function validatePendingFinalization(state) {
  const pending = state.pending_finalization;
  if (pending === null || pending === undefined) return null;
  object(pending, "design pending finalization");
  exact(pending, new Set([
    "design_finalization_transaction_version", "directory", "staging_directory",
    "files", "final_receipt_digests", "transaction_digest"
  ]), "design pending finalization");
  requireValue(pending.design_finalization_transaction_version === 1,
    "design pending finalization version is invalid", 4);
  const locations = finalOutputLocations(state);
  requireValue(path.resolve(pending.directory) === path.resolve(locations.directory) &&
    path.resolve(pending.staging_directory) === path.resolve(locations.staging_directory),
  "design pending finalization paths conflict with the state directory", 4);
  exact(pending.files, new Set(Object.keys(FINAL_OUTPUT_NAMES)),
    "design pending finalization files");
  for (const [key, name] of Object.entries(FINAL_OUTPUT_NAMES)) {
    const item = pending.files[key];
    exact(item, new Set(["name", "digest", "bytes"]),
      `design pending finalization files.${key}`);
    requireValue(item.name === name && SHA256_PATTERN.test(item.digest || "") &&
      Number.isInteger(item.bytes) && item.bytes >= 0,
    `design pending finalization file binding is invalid: ${key}`, 4);
  }
  exact(pending.final_receipt_digests,
    new Set(["visual_intent", "visual_signature", "decision"]),
    "design pending finalization receipt digests");
  for (const digest of Object.values(pending.final_receipt_digests)) {
    requireValue(SHA256_PATTERN.test(digest || ""),
      "design pending finalization receipt digest is invalid", 4);
  }
  const body = { ...pending };
  delete body.transaction_digest;
  requireValue(SHA256_PATTERN.test(pending.transaction_digest || "") &&
    canonicalDigest(body) === pending.transaction_digest,
  "design pending finalization transaction digest mismatch", 4);
  requireValue(Object.keys(state.outputs || {}).length === 0,
    "design pending finalization cannot coexist with published output bindings", 4);

  const hasPublished = fs.existsSync(locations.directory);
  const hasStaging = fs.existsSync(locations.staging_directory);
  requireValue(hasPublished !== hasStaging,
    "design pending finalization requires exactly one staged or published output directory", 4);
  const sourceDirectory = hasPublished ? locations.directory : locations.staging_directory;
  const directoryStat = fs.lstatSync(sourceDirectory);
  requireValue(directoryStat.isDirectory() && !directoryStat.isSymbolicLink(),
    "design pending finalization output must be a regular directory", 4);
  requireValue(sameSet(fs.readdirSync(sourceDirectory), Object.values(FINAL_OUTPUT_NAMES)),
    "design pending finalization output file set mismatch", 4);
  for (const [key, item] of Object.entries(pending.files)) {
    const target = path.join(sourceDirectory, item.name);
    const stat = fs.lstatSync(target);
    requireValue(stat.isFile() && !stat.isSymbolicLink(),
      `design pending finalization output is not a regular file: ${key}`, 4);
    const snapshot = snapshotArtifact(target, { root: state.state_directory });
    requireValue(snapshot.digest === item.digest && snapshot.bytes === item.bytes,
      `design pending finalization output changed: ${key}`, 4);
  }
  return { pending, locations, source_directory: sourceDirectory };
}

function serializedJsonDigest(value) {
  return `sha256:${crypto.createHash("sha256")
    .update(`${JSON.stringify(value, null, 2)}\n`)
    .digest("hex")}`;
}

function deriveFinalOutputDocuments(state, locations, verificationContext = null) {
  const approval = state.approval?.normalized;
  requireValue(approval?.status === "approved",
    "design final outputs require an external approved Owner decision", 4);
  const direction = resultForCandidate(
    state, approval.selected_design_candidate_id, "direction-candidate"
  );
  const color = resultForCandidate(
    state, approval.selected_color_candidate_id, "color-candidate"
  );
  const directionBrowser = resultForCandidate(
    state, approval.selected_design_candidate_id, "browser-evidence"
  );
  const colorBrowser = resultForCandidate(
    state, approval.selected_color_candidate_id, "browser-evidence"
  );
  const directionReview = resultForPacket(state, "direction-review");
  const colorReview = resultForPacket(state, "color-review");
  for (const [label, record] of Object.entries({
    direction, color, directionBrowser, colorBrowser, directionReview, colorReview
  })) {
    requireValue(record, `design final outputs are missing canonical ${label} result`, 4);
  }

  const signature = structuredClone(direction.normalized.signature);
  signature.palette = structuredClone(color.normalized.palette);
  const referenceIntelligenceBinding = compiledReferenceIntelligenceBinding(state, {
    direction,
    color,
    directionReview,
    colorReview
  });
  const decisionPath = locations.files.decision.published_path;
  const decisionBody = {
    design_direction_decision_version: 1,
    run_id: state.run_id,
    journey_identity: structuredClone(state.journey_identity),
    project_id: state.brief.project_id,
    surface: state.brief.surface,
    screen_id: state.brief.screen_id,
    status: "approved",
    selected_design_candidate_id: approval.selected_design_candidate_id,
    selected_color_candidate_id: approval.selected_color_candidate_id,
    source_digests: {
      brief: state.brief_source.digest,
      baseline: state.baseline.digest,
      direction_result: direction.result_digest,
      direction_browser: directionBrowser.result_digest,
      direction_review: directionReview.result_digest,
      color_result: color.result_digest,
      color_browser: colorBrowser.result_digest,
      color_review: colorReview.result_digest,
      shortlist: state.shortlist.shortlist_digest,
      owner_decision: state.approval.approval_digest,
      approval_scope: state.approval_scope_digest,
      ...(state.reference_pack ? {
        reference_pack: state.reference_pack.source.digest
      } : {})
    },
    source_bindings: {
      direction_candidate: resultBinding(state, direction, verificationContext),
      direction_browser: resultBinding(state, directionBrowser, verificationContext),
      direction_review: resultBinding(state, directionReview, verificationContext),
      color_candidate: resultBinding(state, color, verificationContext),
      color_browser: resultBinding(state, colorBrowser, verificationContext),
      color_review: resultBinding(state, colorReview, verificationContext)
    },
    ...(referenceIntelligenceBinding ? {
      reference_intelligence_binding: referenceIntelligenceBinding
    } : {}),
    intent: structuredClone(direction.normalized.intent),
    signature,
    color_system: structuredClone(color.normalized.color_system),
    authority: {
      kind: "owner-direction",
      authority_id: approval.owner_id,
      basis: approval.note,
      decided_at: approval.decided_at
    }
  };
  const decision = { ...decisionBody, decision_digest: canonicalDigest(decisionBody) };

  const prototype = direction.evidence.find((item) => item.evidence_kind === "prototype");
  const colorPrototype = color.evidence.find((item) => item.evidence_kind === "prototype");
  const fontReports = direction.evidence.filter((item) => item.evidence_kind === "font-report");
  const tokenSpecs = color.evidence.filter((item) => item.evidence_kind === "token-spec");
  const directionBrowserArtifacts = directionBrowser.evidence
    .filter((item) => ["screenshot", "test-report"].includes(item.evidence_kind));
  const colorBrowserArtifacts = colorBrowser.evidence
    .filter((item) => ["screenshot", "test-report"].includes(item.evidence_kind));
  for (const snapshot of [
    state.approval.source,
    direction.source,
    color.source,
    directionBrowser.source,
    colorBrowser.source,
    directionReview.source,
    colorReview.source,
    prototype,
    colorPrototype,
    ...fontReports,
    ...tokenSpecs,
    ...directionBrowserArtifacts,
    ...colorBrowserArtifacts
  ]) {
    requireValue(snapshot, "final approval evidence binding is missing", 4);
    verifyBoundSnapshot(snapshot, "final approval evidence");
  }

  const decisionEvidence = {
    kind: "owner-direction",
    path: path.resolve(decisionPath),
    digest: serializedJsonDigest(decision)
  };
  const approvalEvidence = receiptEvidence("owner-approval", state.approval.source);
  const prototypeEvidence = receiptEvidence("approved-artifact", prototype);
  const colorPrototypeEvidence = receiptEvidence("approved-artifact", colorPrototype);
  const colorResultEvidence = receiptEvidence("design-tokens", color.source);
  const fontEvidence = fontReports
    .map((snapshot) => receiptEvidence("approved-artifact", snapshot));
  const tokenSpecEvidence = tokenSpecs
    .map((snapshot) => receiptEvidence("design-tokens", snapshot));
  const directionBrowserEvidence = directionBrowserArtifacts
    .map((snapshot) => receiptEvidence("approved-artifact", snapshot));
  const colorBrowserEvidence = colorBrowserArtifacts
    .map((snapshot) => receiptEvidence("approved-artifact", snapshot));
  const intentReceipt = {
    visual_intent_receipt_version: 1,
    journey_identity: structuredClone(state.journey_identity),
    project_id: state.brief.project_id,
    surface: state.brief.surface,
    status: "approved",
    intent: structuredClone(direction.normalized.intent),
    authority: structuredClone(decision.authority),
    evidence: [
      decisionEvidence,
      approvalEvidence,
      prototypeEvidence,
      ...directionBrowserEvidence
    ]
  };
  const signatureEvidence = [
    decisionEvidence,
    approvalEvidence,
    prototypeEvidence,
    colorPrototypeEvidence,
    colorResultEvidence,
    ...fontEvidence,
    ...tokenSpecEvidence,
    ...directionBrowserEvidence,
    ...colorBrowserEvidence
  ];
  const commonCoverage = [
    decisionEvidence.path,
    approvalEvidence.path,
    prototypeEvidence.path,
    ...directionBrowserEvidence.map((item) => item.path)
  ];
  const signatureReceipt = {
    visual_signature_receipt_version: 1,
    journey_identity: structuredClone(state.journey_identity),
    project_id: state.brief.project_id,
    surface: state.brief.surface,
    status: "approved",
    signature,
    authority: structuredClone(decision.authority),
    evidence: signatureEvidence,
    coverage: [
      { aspect: "palette", evidence_paths: [
        decisionEvidence.path,
        approvalEvidence.path,
        colorPrototypeEvidence.path,
        colorResultEvidence.path,
        ...tokenSpecEvidence.map((item) => item.path),
        ...colorBrowserEvidence.map((item) => item.path)
      ] },
      { aspect: "typography", evidence_paths: [
        ...commonCoverage,
        ...fontEvidence.map((item) => item.path)
      ] },
      ...[
        "density", "shape", "elevation", "imagery", "motion",
        "style_keywords", "forbidden_transformations"
      ].map((aspect) => ({ aspect, evidence_paths: commonCoverage }))
    ]
  };
  const intentContract = approvedIntent(direction.normalized.intent);
  intentContract.authority_receipt =
    locations.files.visual_intent_receipt.published_path;
  intentContract.authority_digest = serializedJsonDigest(intentReceipt);
  const signatureContract = approvedSignature(signature);
  signatureContract.authority_receipt =
    locations.files.visual_signature_receipt.published_path;
  signatureContract.authority_digest = serializedJsonDigest(signatureReceipt);
  validateVisualIntentContract(intentContract);
  validateVisualSignatureContract(signatureContract);
  const bindings = {
    profile_bindings_version: 1,
    journey_identity: structuredClone(state.journey_identity),
    project_id: state.brief.project_id,
    surface: state.brief.surface,
    generated_at: approval.decided_at,
    visual_intent: intentContract,
    visual_signature: signatureContract,
    decision: { path: decisionPath, digest: decisionEvidence.digest },
    ...(referenceIntelligenceBinding ? {
      reference_intelligence_binding: structuredClone(referenceIntelligenceBinding)
    } : {})
  };
  return {
    documents: {
      decision,
      visual_intent_receipt: intentReceipt,
      visual_signature_receipt: signatureReceipt,
      profile_bindings: bindings
    },
    final_receipt_digests: {
      visual_intent: intentContract.authority_digest,
      visual_signature: signatureContract.authority_digest,
      decision: bindings.decision.digest
    }
  };
}

function verifyPublishedFinalOutputs(
  state,
  locations,
  expected = null,
  verificationContext = null
) {
  requireValue(fs.existsSync(locations.directory) &&
    !fs.existsSync(locations.staging_directory),
  "design final output publication is incomplete", 4);
  const directoryStat = fs.lstatSync(locations.directory);
  requireValue(directoryStat.isDirectory() && !directoryStat.isSymbolicLink(),
    "design final output must be a regular directory", 4);
  requireValue(sameSet(fs.readdirSync(locations.directory), Object.values(FINAL_OUTPUT_NAMES)),
    "design final output file set mismatch", 4);
  const derived = deriveFinalOutputDocuments(state, locations, verificationContext);
  const snapshots = Object.fromEntries(Object.entries(locations.files).map(([key, item]) => {
    const stat = fs.lstatSync(item.published_path);
    requireValue(stat.isFile() && !stat.isSymbolicLink(),
      `design final output is not a regular file: ${key}`, 4);
    const snapshot = snapshotArtifact(item.published_path, { root: state.state_directory });
    const persisted = readPinnedDesignJson(
      item.published_path,
      `design final output ${key}`
    ).input;
    requireValue(canonicalDigest(persisted) ===
      canonicalDigest(derived.documents[key]),
    `design final output content conflicts with canonical state: ${key}`, 4);
    requireValue(snapshot.digest === serializedJsonDigest(derived.documents[key]),
      `design final output bytes conflict with canonical state: ${key}`, 4);
    if (expected) {
      requireValue(snapshot.digest === expected.files[key].digest &&
        snapshot.bytes === expected.files[key].bytes,
      `design published output conflicts with pending transaction: ${key}`, 4);
    }
    return [key, snapshot];
  }));
  const bindings = readPinnedDesignJson(
    locations.files.profile_bindings.published_path,
    "design final profile bindings"
  ).input;
  const verificationProfile = {
    project_id: state.brief.project_id,
    visual_intents: { [state.brief.surface]: bindings.visual_intent },
    visual_signatures: { [state.brief.surface]: bindings.visual_signature }
  };
  const verifiedIntent = resolveVisualIntent(
    verificationProfile,
    locations.files.profile_bindings.published_path,
    state.brief.surface
  );
  const verifiedSignature = resolveVisualSignature(
    verificationProfile,
    locations.files.profile_bindings.published_path,
    state.brief.surface
  );
  requireValue(verifiedIntent.authority_status === "verified",
    `compiled visual intent receipt is invalid: ${verifiedIntent.issues.join("; ")}`, 4);
  requireValue(verifiedSignature.authority_status === "verified",
    `compiled visual signature receipt is invalid: ${verifiedSignature.issues.join("; ")}`, 4);
  const finalReceiptDigests = {
    visual_intent: bindings.visual_intent.authority_digest,
    visual_signature: bindings.visual_signature.authority_digest,
    decision: bindings.decision.digest
  };
  requireValue(canonicalDigest(finalReceiptDigests) ===
    canonicalDigest(derived.final_receipt_digests),
  "design published receipt digests conflict with canonical state", 4);
  if (expected) {
    requireValue(canonicalDigest(finalReceiptDigests) ===
      canonicalDigest(expected.final_receipt_digests),
    "design published receipt digests conflict with pending transaction", 4);
  }
  return { snapshots, final_receipt_digests: finalReceiptDigests };
}

function expectedCompletePackets(state, verificationContext = null) {
  const directionCandidates = directionPackets(state);
  const directionRecords = directionCandidates.map((packet) => {
    const record = resultForPacket(state, packet.packet_id);
    requireValue(record,
      `complete design state is missing canonical result: ${packet.packet_id}`, 4);
    return record;
  });
  const directionBrowsers = directionRecords.map((record) =>
    browserPacket(state, record));
  const directionReview = reviewPacket(state, "direction-review", directionRecords);
  const colors = colorPackets(state);
  const colorRecords = colors.map((packet) => {
    const record = resultForPacket(state, packet.packet_id);
    requireValue(record,
      `complete design state is missing canonical result: ${packet.packet_id}`, 4);
    return record;
  });
  const colorBrowsers = colorRecords.map((record) => browserPacket(state, record));
  const colorReview = reviewPacket(state, "color-review", colorRecords);
  // Force every result binding used by the two canonical review packets through
  // the same accepted-attempt authority cache used by state reads.
  for (const record of [...directionRecords, ...colorRecords]) {
    resultBinding(state, record, verificationContext);
  }
  return [
    ...directionCandidates,
    ...directionBrowsers,
    directionReview,
    ...colors,
    ...colorBrowsers,
    colorReview
  ];
}

function validateDesignLifecycleState(state, verificationContext = null) {
  const statusComplete = state.status === "complete";
  const phaseComplete = state.phase === "complete";
  requireValue(statusComplete === phaseComplete,
    "design complete status and phase must advance together", 4);
  if (!statusComplete) return;

  requireValue(Array.isArray(state.blockers) && state.blockers.length === 0 &&
    Array.isArray(state.pending) && state.pending.length === 0,
  "complete design state cannot retain blockers or pending work", 4);
  requireValue(state.in_flight === null && state.pending_finalization === null,
    "complete design state cannot retain an unresolved execution or finalization", 4);
  requireValue(state.approval?.normalized?.status === "approved",
    "complete design state requires an external approved Owner decision", 4);

  const expectedPackets = expectedCompletePackets(state, verificationContext);
  const expectedIds = expectedPackets.map((packet) => packet.packet_id);
  const packetIds = (state.packets || []).map((packet) => packet.packet_id);
  const resultIds = (state.results || []).map((record) => record.packet_id);
  requireValue(new Set(packetIds).size === packetIds.length &&
    sameSet(packetIds, expectedIds),
  "complete design state packet set is not the exact canonical route", 4);
  requireValue(new Set(resultIds).size === resultIds.length &&
    sameSet(resultIds, expectedIds),
  "complete design state result set is not the exact canonical route", 4);
  exact(state.packet_files, new Set(expectedIds),
    "complete design state packet_files");
  for (const expected of expectedPackets) {
    const actual = state.packets.find((packet) => packet.packet_id === expected.packet_id);
    requireValue(actual && canonicalDigest(actual) === canonicalDigest(expected),
      `complete design packet conflicts with canonical route: ${expected.packet_id}`, 4);
  }

  const locations = finalOutputLocations(state);
  exact(state.outputs, new Set(Object.keys(FINAL_OUTPUT_NAMES)),
    "complete design outputs");
  for (const [key, item] of Object.entries(locations.files)) {
    const output = state.outputs[key];
    requireValue(output?.kind === "file" &&
      path.resolve(output.resolved_path) === path.resolve(item.published_path) &&
      fs.realpathSync(output.resolved_path) === fs.realpathSync(item.published_path),
    `complete design output path is not canonical: ${key}`, 4);
  }
  exact(state.final_receipt_digests,
    new Set(["visual_intent", "visual_signature", "decision"]),
    "complete design final_receipt_digests");
  const published = verifyPublishedFinalOutputs(
    state,
    locations,
    null,
    verificationContext
  );
  requireValue(canonicalDigest(published.snapshots) === canonicalDigest(state.outputs) &&
    canonicalDigest(published.final_receipt_digests) ===
      canonicalDigest(state.final_receipt_digests),
  "complete design final output state binding mismatch", 4);
}

function adoptPendingFinalization(state, lease, faultInjector = null) {
  const verified = validatePendingFinalization(state);
  requireValue(verified, "design pending finalization is missing", 4);
  verifyDesignAuthorityGraph(state, "before pending finalization recovery");
  if (verified.source_directory === verified.locations.staging_directory) {
    fs.renameSync(verified.locations.staging_directory, verified.locations.directory);
  }
  verifyDesignAuthorityGraph(state, "after pending finalization publish");
  const published = verifyPublishedFinalOutputs(
    state, verified.locations, verified.pending
  );
  state.outputs = published.snapshots;
  state.final_receipt_digests = published.final_receipt_digests;
  state.pending_finalization = null;
  writeState(state, lease, { faultInjector });
}

function compileApprovedDirection(state, lease, faultInjector = null) {
  const locations = finalOutputLocations(state);
  if (Object.keys(state.outputs || {}).length > 0) {
    const published = verifyPublishedFinalOutputs(state, locations);
    requireValue(canonicalDigest(published.snapshots) === canonicalDigest(state.outputs) &&
      canonicalDigest(published.final_receipt_digests) ===
        canonicalDigest(state.final_receipt_digests),
    "design final output state binding mismatch", 4);
    return;
  }
  if (state.pending_finalization) {
    adoptPendingFinalization(state, lease, faultInjector);
    return;
  }
  verifyDesignAuthorityGraph(state, "before final approval compilation");
  faultInjector?.("before-final-approval-output", {
    state_path: state.state_path,
    state_digest: state.state_digest
  });
  verifyDesignAuthorityGraph(state, "immediately before final approval output");
  const approval = state.approval.normalized;
  const direction = resultForCandidate(state, approval.selected_design_candidate_id, "direction-candidate");
  const color = resultForCandidate(state, approval.selected_color_candidate_id, "color-candidate");
  const directionBrowser = resultForCandidate(state, approval.selected_design_candidate_id, "browser-evidence");
  const colorBrowser = resultForCandidate(state, approval.selected_color_candidate_id, "browser-evidence");
  const directionReview = resultForPacket(state, "direction-review");
  const colorReview = resultForPacket(state, "color-review");
  const signature = structuredClone(direction.normalized.signature);
  signature.palette = structuredClone(color.normalized.palette);
  const referenceIntelligenceBinding = compiledReferenceIntelligenceBinding(state, {
    direction,
    color,
    directionReview,
    colorReview
  });
  const { directory, staging_directory: stagingDirectory } = locations;
  if (fs.existsSync(stagingDirectory)) {
    const recoveredStateWrite = state.lease_recoveries.some((receipt) =>
      receipt.recovered_phase === "state-write");
    const stat = fs.lstatSync(stagingDirectory);
    requireValue(recoveredStateWrite && stat.isDirectory() && !stat.isSymbolicLink(),
      "unbound design approval staging output requires verified state-write recovery", 4);
    fs.rmSync(stagingDirectory, { recursive: true, force: true });
  }
  requireValue(!fs.existsSync(directory),
    "design approval output directory already exists without a sealed state binding", 4);
  const decisionPath = locations.files.decision.published_path;
  const stagedDecisionPath = locations.files.decision.staging_path;
  const decisionBody = {
    design_direction_decision_version: 1,
    run_id: state.run_id,
    journey_identity: structuredClone(state.journey_identity),
    project_id: state.brief.project_id,
    surface: state.brief.surface,
    screen_id: state.brief.screen_id,
    status: "approved",
    selected_design_candidate_id: approval.selected_design_candidate_id,
    selected_color_candidate_id: approval.selected_color_candidate_id,
    source_digests: {
      brief: state.brief_source.digest,
      baseline: state.baseline.digest,
      direction_result: direction.result_digest,
      direction_browser: directionBrowser.result_digest,
      direction_review: directionReview.result_digest,
      color_result: color.result_digest,
      color_browser: colorBrowser.result_digest,
      color_review: colorReview.result_digest,
      shortlist: state.shortlist.shortlist_digest,
      owner_decision: state.approval.approval_digest,
      approval_scope: state.approval_scope_digest,
      ...(state.reference_pack ? {
        reference_pack: state.reference_pack.source.digest
      } : {})
    },
    source_bindings: {
      direction_candidate: resultBinding(state, direction),
      direction_browser: resultBinding(state, directionBrowser),
      direction_review: resultBinding(state, directionReview),
      color_candidate: resultBinding(state, color),
      color_browser: resultBinding(state, colorBrowser),
      color_review: resultBinding(state, colorReview)
    },
    ...(referenceIntelligenceBinding ? {
      reference_intelligence_binding: referenceIntelligenceBinding
    } : {}),
    intent: structuredClone(direction.normalized.intent),
    signature,
    color_system: structuredClone(color.normalized.color_system),
    authority: {
      kind: "owner-direction",
      authority_id: approval.owner_id,
      basis: approval.note,
      decided_at: approval.decided_at
    }
  };
  const decision = { ...decisionBody, decision_digest: canonicalDigest(decisionBody) };
  const prototype = direction.evidence.find((item) => item.evidence_kind === "prototype");
  const colorPrototype = color.evidence.find((item) => item.evidence_kind === "prototype");
  const fontReports = direction.evidence.filter((item) => item.evidence_kind === "font-report");
  const tokenSpecs = color.evidence.filter((item) => item.evidence_kind === "token-spec");
  const directionBrowserArtifacts = directionBrowser.evidence
    .filter((item) => ["screenshot", "test-report"].includes(item.evidence_kind));
  const colorBrowserArtifacts = colorBrowser.evidence
    .filter((item) => ["screenshot", "test-report"].includes(item.evidence_kind));
  for (const snapshot of [
    state.approval.source,
    direction.source,
    color.source,
    directionBrowser.source,
    colorBrowser.source,
    directionReview.source,
    colorReview.source,
    prototype,
    colorPrototype,
    ...fontReports,
    ...tokenSpecs,
    ...directionBrowserArtifacts,
    ...colorBrowserArtifacts
  ]) {
    requireValue(snapshot, "final approval evidence binding is missing", 4);
    verifyBoundSnapshot(snapshot, "final approval evidence");
  }
  const intentReceiptPath = locations.files.visual_intent_receipt.published_path;
  const stagedIntentReceiptPath = locations.files.visual_intent_receipt.staging_path;
  const approvalEvidence = receiptEvidence("owner-approval", state.approval.source);
  const prototypeEvidence = receiptEvidence("approved-artifact", prototype);
  const colorPrototypeEvidence = receiptEvidence("approved-artifact", colorPrototype);
  const colorResultEvidence = receiptEvidence("design-tokens", color.source);
  const fontEvidence = fontReports
    .map((snapshot) => receiptEvidence("approved-artifact", snapshot));
  const tokenSpecEvidence = tokenSpecs
    .map((snapshot) => receiptEvidence("design-tokens", snapshot));
  const directionBrowserEvidence = directionBrowserArtifacts
    .map((snapshot) => receiptEvidence("approved-artifact", snapshot));
  const colorBrowserEvidence = colorBrowserArtifacts
    .map((snapshot) => receiptEvidence("approved-artifact", snapshot));
  let published = false;
  let pendingWriteStarted = false;
  try {
    fs.mkdirSync(stagingDirectory, { recursive: false });
    writeJsonAtomic(stagedDecisionPath, decision);
    // Recreate the decision evidence only after the staged bytes exist. Its
    // published path is final, while its digest is taken from the staged file.
    const stagedDecisionEvidence = receiptEvidence(
      "owner-direction", stagedDecisionPath, decisionPath
    );
  const intentReceipt = {
    visual_intent_receipt_version: 1,
    journey_identity: structuredClone(state.journey_identity),
    project_id: state.brief.project_id,
    surface: state.brief.surface,
    status: "approved",
    intent: structuredClone(direction.normalized.intent),
    authority: structuredClone(decision.authority),
    evidence: [
      stagedDecisionEvidence,
      approvalEvidence,
      prototypeEvidence,
      ...directionBrowserEvidence
    ]
  };
    writeJsonAtomic(stagedIntentReceiptPath, intentReceipt);

  const signatureReceiptPath = locations.files.visual_signature_receipt.published_path;
    const stagedSignatureReceiptPath =
      locations.files.visual_signature_receipt.staging_path;
  const signatureEvidence = [
    stagedDecisionEvidence,
    approvalEvidence,
    prototypeEvidence,
    colorPrototypeEvidence,
    colorResultEvidence,
    ...fontEvidence,
    ...tokenSpecEvidence,
    ...directionBrowserEvidence,
    ...colorBrowserEvidence
  ];
  const commonCoverage = [
    stagedDecisionEvidence.path,
    approvalEvidence.path,
    prototypeEvidence.path,
    ...directionBrowserEvidence.map((item) => item.path)
  ];
  const signatureReceipt = {
    visual_signature_receipt_version: 1,
    journey_identity: structuredClone(state.journey_identity),
    project_id: state.brief.project_id,
    surface: state.brief.surface,
    status: "approved",
    signature,
    authority: structuredClone(decision.authority),
    evidence: signatureEvidence,
    coverage: [
      { aspect: "palette", evidence_paths: [
        stagedDecisionEvidence.path,
        approvalEvidence.path,
        colorPrototypeEvidence.path,
        colorResultEvidence.path,
        ...tokenSpecEvidence.map((item) => item.path),
        ...colorBrowserEvidence.map((item) => item.path)
      ] },
      { aspect: "typography", evidence_paths: [
        ...commonCoverage,
        ...fontEvidence.map((item) => item.path)
      ] },
      ...[
        "density", "shape", "elevation", "imagery", "motion",
        "style_keywords", "forbidden_transformations"
      ].map((aspect) => ({ aspect, evidence_paths: commonCoverage }))
    ]
  };
    writeJsonAtomic(stagedSignatureReceiptPath, signatureReceipt);

  const intentContract = approvedIntent(direction.normalized.intent);
  intentContract.authority_receipt = intentReceiptPath;
    intentContract.authority_digest = hashArtifact(stagedIntentReceiptPath);
  const signatureContract = approvedSignature(signature);
  signatureContract.authority_receipt = signatureReceiptPath;
    signatureContract.authority_digest = hashArtifact(stagedSignatureReceiptPath);
  validateVisualIntentContract(intentContract);
  validateVisualSignatureContract(signatureContract);

  const bindingsPath = locations.files.profile_bindings.published_path;
    const stagedBindingsPath = locations.files.profile_bindings.staging_path;
  const bindings = {
    profile_bindings_version: 1,
    journey_identity: structuredClone(state.journey_identity),
    project_id: state.brief.project_id,
    surface: state.brief.surface,
    generated_at: approval.decided_at,
    visual_intent: intentContract,
    visual_signature: signatureContract,
      decision: { path: decisionPath, digest: hashArtifact(stagedDecisionPath) },
    ...(referenceIntelligenceBinding ? {
      reference_intelligence_binding: structuredClone(referenceIntelligenceBinding)
    } : {})
  };
    writeJsonAtomic(stagedBindingsPath, bindings);
    verifyDesignAuthorityGraph(state, "before final approval publish");
    faultInjector?.("before-final-approval-publish", {
      state_path: state.state_path,
      state_digest: state.state_digest
    });
    verifyDesignAuthorityGraph(state, "immediately before final approval publish");
    const finalReceiptDigests = {
      visual_intent: intentContract.authority_digest,
      visual_signature: signatureContract.authority_digest,
      decision: bindings.decision.digest
    };
    state.pending_finalization = pendingFinalization(
      state, locations, finalReceiptDigests
    );
    pendingWriteStarted = true;
    writeState(state, lease, { faultInjector });
    fs.renameSync(stagingDirectory, directory);
    published = true;
    verifyDesignAuthorityGraph(state, "after final approval publish before state binding");
    faultInjector?.("after-final-approval-publish-before-state-write", {
      state_path: state.state_path,
      state_digest: state.state_digest,
      pending_finalization_digest: state.pending_finalization.transaction_digest
    });
    verifyDesignAuthorityGraph(state,
      "immediately before published final approval state binding");
    const finalization = verifyPublishedFinalOutputs(
      state, locations, state.pending_finalization
    );
    state.outputs = finalization.snapshots;
    state.final_receipt_digests = finalization.final_receipt_digests;
    state.pending_finalization = null;
    writeState(state, lease, { faultInjector });
  } catch (error) {
    if (!pendingWriteStarted && fs.existsSync(stagingDirectory)) {
      fs.rmSync(stagingDirectory, { recursive: true, force: true });
    }
    if (published && !pendingWriteStarted && fs.existsSync(directory)) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
    throw error;
  }
}

function addPackets(state, lease, packets, faultInjector = null) {
  const existing = new Set(state.packets.map((packet) => packet.packet_id));
  const directory = path.join(state.state_directory, "packets");
  for (const packet of packets) {
    if (existing.has(packet.packet_id)) continue;
    const target = path.join(directory, `${packet.packet_id}.json`);
    writeJsonAtomic(target, packet);
    state.packets.push(packet);
    state.packet_files[packet.packet_id] = snapshotArtifact(target, { root: state.state_directory });
    existing.add(packet.packet_id);
  }
  writeState(state, lease, { faultInjector });
}

function recordsOfKind(state, kind) {
  return state.results.filter((record) => record.normalized.kind === kind);
}

function duplicatePrototypeGroups(state, kind) {
  const byDigest = new Map();
  for (const record of recordsOfKind(state, kind)) {
    const prototype = record.evidence.find((item) => item.evidence_kind === "prototype");
    if (!prototype) continue;
    const ids = byDigest.get(prototype.digest) || [];
    ids.push(record.normalized.candidate_id);
    byDigest.set(prototype.digest, ids);
  }
  return [...byDigest.values()].filter((ids) => ids.length > 1);
}

function duplicatePaletteGroups(state) {
  const byDesign = new Map();
  for (const record of recordsOfKind(state, "color-candidate")) {
    const designId = record.normalized.design_candidate_id;
    const digest = canonicalDigest(record.normalized.palette);
    const palettes = byDesign.get(designId) || new Map();
    const ids = palettes.get(digest) || [];
    ids.push(record.normalized.candidate_id);
    palettes.set(digest, ids);
    byDesign.set(designId, palettes);
  }
  return [...byDesign.entries()].flatMap(([designId, palettes]) =>
    [...palettes.values()].filter((ids) => ids.length > 1).map((ids) => ({ designId, ids })));
}

function packetsOfStage(state, stage) {
  return state.packets.filter((packet) => packet.stage_id === stage);
}

function attemptNumber(state, packetId) {
  return state.attempts.filter((attempt) => attempt.packet_id === packetId).length + 1;
}

function lastAttempt(state, packetId) {
  return [...state.attempts].reverse().find((attempt) => attempt.packet_id === packetId) || null;
}

function executionAuthoritySnapshot(state, packet, manifest, declaration) {
  requireValue(manifest?.manifest_path && declaration,
    "ready design execution requires a loaded host authority", 4);
  const hostManifest = snapshotArtifact(manifest.manifest_path, {
    root: state.state_directory
  });
  requireValue(hostManifest.digest === manifest.manifest_digest &&
    hostManifest.physical_identity_digest === manifest.manifest_physical_identity_digest,
  "design host manifest changed before execution authority capture", 4);
  const raw = readPinnedDesignJson(manifest.manifest_path,
    "design execution host manifest").input;
  const rawDeclaration = raw.providers?.[packet.provider.id];
  requireValue(rawDeclaration,
    `design host manifest lost provider ${packet.provider.id}`, 4);
  const adapterEntrypoint = declaration.entrypoint
    ? {
        ...snapshotArtifact(declaration.entrypoint, { root: state.state_directory }),
        graph_digest: declaration.entrypoint_authority?.graph_digest || null
      }
    : null;
  const body = {
    design_execution_authority_version: 1,
    host_manifest: hostManifest,
    provider_declaration_digest: canonicalDigest(rawDeclaration),
    adapter_entrypoint: adapterEntrypoint
  };
  return { ...body, authority_digest: canonicalDigest(body) };
}

function verifyAttemptExecutionAuthority(
  state,
  packet,
  attempt,
  verificationContext = null
) {
  if (verificationContext?.verifiedAttemptAuthorities.has(attempt)) return;
  const authority = attempt.execution_authority;
  object(authority, `design attempt ${packet.packet_id} execution_authority`);
  exact(authority, new Set([
    "design_execution_authority_version", "host_manifest",
    "provider_declaration_digest", "adapter_entrypoint", "authority_digest"
  ]), `design attempt ${packet.packet_id} execution_authority`);
  requireValue(authority.design_execution_authority_version === 1,
    `design attempt ${packet.packet_id} execution authority version is invalid`, 4);
  const body = { ...authority };
  delete body.authority_digest;
  requireValue(canonicalDigest(body) === authority.authority_digest,
    `design attempt ${packet.packet_id} execution authority digest mismatch`, 4);

  const hostAuthorityKey = canonicalDigest(authority.host_manifest);
  let hostAuthority = verificationContext?.hostAuthorities.get(hostAuthorityKey);
  if (!hostAuthority) {
    verifyBoundSnapshot(authority.host_manifest,
      `design attempt ${packet.packet_id} host manifest`);
    const raw = readPinnedDesignJson(authority.host_manifest.resolved_path,
      `design attempt ${packet.packet_id} host manifest`).input;
    const loaded = loadHostManifest(authority.host_manifest.resolved_path);
    hostAuthority = {
      raw,
      loaded,
      snapshot: authority.host_manifest,
      loaded_authority_digest: loadedDesignHostAuthorityDigest(loaded)
    };
    verificationContext?.hostAuthorities.set(hostAuthorityKey, hostAuthority);
  }
  const { raw, loaded } = hostAuthority;
  const declaration = loaded.providers?.[packet.provider.id];
  const rawDeclaration = raw.providers?.[packet.provider.id];
  requireValue(declaration &&
    rawDeclaration &&
    loaded.manifest_digest === authority.host_manifest.digest &&
    loaded.manifest_physical_identity_digest ===
      authority.host_manifest.physical_identity_digest &&
    canonicalDigest(rawDeclaration) === authority.provider_declaration_digest &&
    authority.host_manifest.digest === attempt.host_manifest_digest &&
    declaration.adapter === attempt.adapter &&
    declaration.strength === attempt.strength &&
    sameSet(declaration.capabilities, attempt.capabilities) &&
    sameSet(declaration.permissions, attempt.permission_scopes),
  `design attempt ${packet.packet_id} execution authority conflicts with its host manifest`, 4);
  if (packet.stage_id === "browser-evidence") {
    requireValue(declaration.adapter === "browser-json-v1",
      `design browser attempt ${packet.packet_id} lacks browser-json-v1 execution authority`, 4);
    if (state.reference_pack) {
      requireValue(packet.provider.resolved_to === PLAYWRIGHT_PROVIDER_TARGET &&
        declaration.settings?.contract === PLAYWRIGHT_ADAPTER_CONTRACT &&
        Boolean(declaration.official_playwright),
      `reference-backed design browser attempt ${packet.packet_id} lacks official Playwright authority`, 4);
    }
  }
  if (declaration.entrypoint) {
    object(authority.adapter_entrypoint,
      `design attempt ${packet.packet_id} adapter entrypoint authority`);
    const entrypointSnapshotKey = canonicalDigest(authority.adapter_entrypoint);
    if (!verificationContext?.verifiedEntrypointSnapshots.has(entrypointSnapshotKey)) {
      verifyBoundSnapshot(authority.adapter_entrypoint,
        `design attempt ${packet.packet_id} adapter entrypoint`);
      verificationContext?.verifiedEntrypointSnapshots.set(
        entrypointSnapshotKey,
        authority.adapter_entrypoint
      );
    }
    const target = path.isAbsolute(declaration.entrypoint)
      ? path.resolve(declaration.entrypoint)
      : path.resolve(path.dirname(authority.host_manifest.resolved_path),
        declaration.entrypoint);
    requireValue(path.resolve(authority.adapter_entrypoint.resolved_path) === target &&
      authority.adapter_entrypoint.digest === declaration.entrypoint_digest &&
      authority.adapter_entrypoint.digest === attempt.adapter_entrypoint?.digest &&
      authority.adapter_entrypoint.physical_identity_digest ===
        declaration.entrypoint_authority?.physical_identity_digest &&
      authority.adapter_entrypoint.graph_digest ===
        declaration.entrypoint_authority?.graph_digest,
    `design attempt ${packet.packet_id} adapter entrypoint conflicts with its host manifest`, 4);
  } else {
    requireValue(authority.adapter_entrypoint === null &&
      attempt.adapter_entrypoint === null,
    `design attempt ${packet.packet_id} has unexpected adapter entrypoint authority`, 4);
  }
  requireValue(attempt.strength >= packet.minimum_strength &&
    containsAll(attempt.capabilities, packet.assigned_capabilities) &&
    containsAll(attempt.permission_scopes, packet.required_permissions) &&
    !attempt.permission_scopes.some((scope) =>
      (packet.forbidden_permissions || []).includes(scope)),
  `design attempt ${packet.packet_id} does not satisfy its packet authority`, 4);
  verificationContext?.verifiedAttemptAuthorities.add(attempt);
}

function loadedDesignHostAuthorityDigest(hostManifest) {
  const providers = Object.fromEntries(Object.keys(hostManifest.providers || {})
    .sort()
    .map((providerId) => {
      const declaration = hostManifest.providers[providerId];
      return [providerId, {
        adapter: declaration.adapter,
        entrypoint: declaration.entrypoint || null,
        adapter_root: declaration.adapter_root || null,
        capabilities: [...declaration.capabilities],
        strength: declaration.strength,
        permissions: [...declaration.permissions],
        timeout_ms: declaration.timeout_ms,
        settings_digest: canonicalDigest(declaration.settings || {}),
        entrypoint_authority_digest:
          declaration.entrypoint_authority?.authority_digest || null,
        entrypoint_graph_digest:
          declaration.entrypoint_authority?.graph_digest || null,
        official_playwright_digest: declaration.official_playwright
          ? canonicalDigest(declaration.official_playwright)
          : null,
        official_codex_digest: declaration.official_codex
          ? canonicalDigest(declaration.official_codex)
          : null
      }];
    }));
  return canonicalDigest({
    host_adapter_version: hostManifest.host_adapter_version,
    manifest_path: hostManifest.manifest_path,
    manifest_digest: hostManifest.manifest_digest,
    manifest_physical_identity_digest:
      hostManifest.manifest_physical_identity_digest,
    allowed_providers: [...hostManifest.allowed_providers],
    granted_permissions: [...hostManifest.granted_permissions],
    providers
  });
}

function verifyDesignReadAuthorityCache(verificationContext) {
  for (const authority of verificationContext.hostAuthorities.values()) {
    verifyBoundSnapshot(authority.snapshot,
      "design read cached host manifest at final boundary");
    const finalLoaded = loadHostManifest(authority.snapshot.resolved_path);
    requireValue(finalLoaded.manifest_digest === authority.snapshot.digest &&
      finalLoaded.manifest_physical_identity_digest ===
        authority.snapshot.physical_identity_digest &&
      loadedDesignHostAuthorityDigest(finalLoaded) ===
        authority.loaded_authority_digest,
    "design read cached host manifest or module graph changed before final boundary",
    4);
  }
  for (const snapshot of verificationContext.verifiedEntrypointSnapshots.values()) {
    verifyBoundSnapshot(snapshot,
      "design read cached adapter entrypoint at final boundary");
  }
}

function retrySelectors(retry) {
  if (!retry) return new Set();
  return new Set(String(retry).split(",").map((item) => item.trim()).filter(Boolean));
}

function retryMatches(selectors, packet) {
  return selectors.has("all") || selectors.has(packet.packet_id) ||
    selectors.has(packet.provider.id) || selectors.has(packet.stage_id) ||
    selectors.has(packet.design_task.kind);
}

function adapterRun(state, packet) {
  const subject = packet.design_task.subject_id
    ? resultForCandidate(state, packet.design_task.subject_id, packet.design_task.subject_kind)
    : null;
  if (!state.reference_pack) {
    return {
      run_id: state.run_id,
      journey_identity: structuredClone(state.journey_identity),
      packets: state.packets,
      creator: {
        provider_id: subject?.provider_id || packet.provider.id,
        actor_id: subject?.normalized.actor.actor_id || null,
        participant: subject?.participant || createParticipant({
          providerId: packet.provider.id,
          stageId: packet.stage_id,
          designTaskKind: packet.design_task.kind
        })
      },
      scope: {
        kind: "design-exploration",
        surface: state.brief.surface,
        screen_id: state.brief.screen_id
      },
      artifacts: [state.baseline],
      results: state.results
    };
  }
  const kind = packet.design_task.kind;
  let results = [];
  if (kind === "browser-evidence" && subject) results = [subject];
  if (kind === "direction-review") {
    results = state.results.filter((record) =>
      record.normalized.kind === "direction-candidate" ||
      (record.normalized.kind === "browser-evidence" &&
        record.normalized.subject_kind === "direction-candidate"));
  }
  if (kind === "color-candidate") {
    const source = resultForCandidate(
      state, packet.design_task.design_candidate_id, "direction-candidate"
    );
    results = source ? [source] : [];
  }
  if (kind === "color-review") {
    results = state.results.filter((record) =>
      record.normalized.kind === "color-candidate" ||
      (record.normalized.kind === "browser-evidence" &&
        record.normalized.subject_kind === "color-candidate"));
  }
  const reviewer = kind === "direction-review" || kind === "color-review";
  return {
    run_id: state.run_id,
    journey_identity: structuredClone(state.journey_identity),
    packets: [packet],
    creator: {
      provider_id: subject?.provider_id || packet.provider.id,
      actor_id: subject?.normalized.actor.actor_id || null,
      participant: subject?.participant || createParticipant({
        providerId: packet.provider.id,
        stageId: packet.stage_id,
        designTaskKind: packet.design_task.kind
      })
    },
    scope: {
      kind: "design-exploration",
      surface: state.brief.surface,
      screen_id: state.brief.screen_id
    },
    artifacts: [
      state.baseline,
      ...(reviewer ? resolveReviewerSourceArtifacts(state) : [])
    ],
    results
  };
}

function verifyDesignAuthorityGraph(state, phase) {
  const current = readDesignState(state.state_path);
  requireValue(current.state_digest === state.state_digest,
    `design authority graph changed ${phase}`, 4);
}

function runPacket(state, lease, packet, manifest, selectors, faultInjector = null) {
  if (resultForPacket(state, packet.packet_id)) return;
  const previous = lastAttempt(state, packet.packet_id);
  if (previous?.execution_status?.startsWith("blocked") && !retryMatches(selectors, packet)) return;
  const inspection = inspectPacketAdapter(packet, manifest);
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
  assertReferenceSourceExecutableIsolation(
    state.reference_pack,
    state.brief,
    manifest
  );
  verifyDesignAuthorityGraph(state, "before child intent");
  const executionAuthority = executionAuthoritySnapshot(
    state, packet, manifest, inspection.declaration
  );
  const outputDirectory = path.join(state.state_directory, "evidence", packet.packet_id, `attempt-${attempt}`);
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
  verifyDesignAuthorityGraph(state, "immediately before child spawn");
  const executed = executeAuditPacket({
    run: adapterRun(state, packet),
    packet,
    manifest,
    attempt,
    outputDirectory,
    outputGrantRoot: state.state_directory
  });
  verifyDesignAuthorityGraph(state, "after child execution before result ingest");
  const {
    result,
    declaration: _declaration,
    evidence_boundary: _evidenceBoundary,
    ...attemptRecord
  } = executed;
  const stored = {
    ...attemptRecord,
    execution_authority: executionAuthority,
    packet_digest: packet.packet_digest,
    attempted_at: nowIso()
  };
  if (executed.execution_status === "ran") {
    const resultPath = path.join(outputDirectory, "design-result.json");
    try {
      writeJsonAtomic(resultPath, result);
      const record = recordResult(state, packet, result, resultPath);
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

function runPackets(state, lease, packets, manifest, selectors, faultInjector = null) {
  for (const packet of packets) {
    runPacket(state, lease, packet, manifest, selectors, faultInjector);
  }
}

function stop(state, lease, status, phase, blockers = [], pending = [], faultInjector = null) {
  state.status = status;
  state.phase = phase;
  state.blockers = [...new Set(blockers)];
  state.pending = [...new Set(pending)];
  writeState(state, lease, { faultInjector });
  return state;
}

function haltForPackets(state, lease, phase, packets, faultInjector = null) {
  const missing = packets.filter((packet) => !resultForPacket(state, packet.packet_id));
  if (!missing.length) return null;
  const failures = missing.map((packet) => ({ packet, attempt: lastAttempt(state, packet.packet_id) }))
    .filter(({ attempt }) => attempt?.execution_status?.startsWith("blocked"));
  if (failures.length) {
    return stop(state, lease, "blocked", phase, failures.map(({ packet, attempt }) =>
      `${packet.packet_id}: ${attempt.error || attempt.execution_status}`), [], faultInjector);
  }
  return stop(state, lease, "manual_pending", phase, [], missing.map((packet) => {
    const attempt = lastAttempt(state, packet.packet_id);
    return `${packet.packet_id}: ${attempt?.reason || "result is required"}`;
  }), faultInjector);
}

function manualEntries(resultPaths, snapshotRoot) {
  return resultPaths.map((file) => {
    const absolute = path.resolve(file);
    const pinned = readPinnedDesignJson(absolute, "manual design result");
    return {
      path: absolute,
      input: pinned.input,
      source: pinnedDesignSnapshot(pinned, snapshotRoot),
      consumed: false
    };
  });
}

function ingestKnownManual(state, lease, entries, faultInjector = null) {
  for (const entry of entries) {
    if (entry.consumed) continue;
    const packet = state.packets.find((item) => item.packet_id === entry.input.packet_id);
    if (!packet) continue;
    requireValue(packet.stage_id !== "browser-evidence",
      `design browser result cannot be manually recorded; KSR must run a digest-locked Playwright adapter: ${packet.packet_id}`,
    4);
    requireValue(!resultForPacket(state, packet.packet_id),
      `manual design result duplicates an existing packet: ${packet.packet_id}`, 4);
    recordResult(state, packet, entry.input, entry.path, entry.source);
    state.attempts.push({
      packet_id: packet.packet_id,
      provider_id: packet.provider.id,
      participant: structuredClone(packet.participant),
      adapter: "manual-v1",
      execution_status: "manual_recorded",
      attempt: attemptNumber(state, packet.packet_id),
      packet_digest: packet.packet_digest,
      result_path: entry.path,
      result_digest: resultForPacket(state, packet.packet_id).result_digest,
      result_file_digest: resultForPacket(state, packet.packet_id).source.digest,
      recorded_at: nowIso()
    });
    entry.consumed = true;
    writeState(state, lease, { faultInjector });
  }
}

function requireNoUnknownManual(entries) {
  const unknown = entries.filter((entry) => !entry.consumed);
  requireValue(unknown.length === 0,
    `manual result references a packet that is not currently dispatched: ${unknown.map((item) => item.input.packet_id || item.path).join(", ")}`,
    4);
}

function ensureDirectionBrowserPackets(state, lease, faultInjector = null) {
  addPackets(state, lease,
    recordsOfKind(state, "direction-candidate").map((record) => browserPacket(state, record)),
    faultInjector);
}

function ensureColorBrowserPackets(state, lease, faultInjector = null) {
  addPackets(state, lease,
    recordsOfKind(state, "color-candidate").map((record) => browserPacket(state, record)),
    faultInjector);
}

function writeSelectionTemplate(state) {
  const target = path.join(state.state_directory, "templates", "design-shortlist.json");
  writeJsonAtomic(target, {
    design_shortlist_version: 1,
    run_id: state.run_id,
    journey_identity: structuredClone(state.journey_identity),
    selection_scope_digest: state.selection_scope_digest,
    owner_id: "REPLACE_WITH_OWNER_ID",
    candidate_ids: eligibleDirectionIds(state).slice(0, 3),
    rationale: "REPLACE_WITH_OWNER_RATIONALE",
    decided_at: nowIso()
  });
  return target;
}

function writeApprovalTemplate(state) {
  const target = path.join(state.state_directory, "templates", "design-owner-decision.json");
  const designId = state.shortlist.normalized.candidate_ids[0];
  const colorId = eligibleColorIds(state).find((candidateId) =>
    resultForCandidate(state, candidateId, "color-candidate")?.normalized.design_candidate_id === designId) || "REPLACE";
  writeJsonAtomic(target, {
    design_owner_decision_version: 1,
    run_id: state.run_id,
    journey_identity: structuredClone(state.journey_identity),
    approval_scope_digest: state.approval_scope_digest,
    owner_id: "REPLACE_WITH_OWNER_ID",
    status: "approved",
    selected_design_candidate_id: designId,
    selected_color_candidate_id: colorId,
    note: "REPLACE_WITH_EXPLICIT_OWNER_DECISION",
    decided_at: nowIso()
  });
  return target;
}

function continueDesignExplorationWithLease(state, lease, {
  hostManifest = null,
  resultPaths = [],
  shortlistPath = null,
  approvalPath = null,
  retry = null,
  faultInjector = null
} = {}) {
  verifyJourneyIdentity(state.journey_identity, {
    runId: state.run_id,
    label: "active design journey_identity"
  });
  for (const packet of state.packets || []) {
    verifyPacketJourney(packet, state.journey_identity, `active design packet ${packet.packet_id}`);
  }
  if (state.status === "complete") {
    validateDesignLifecycleState(state);
    return state;
  }
  assertReferenceSourceExecutableIsolation(
    state.reference_pack,
    state.brief,
    hostManifest
  );
  requireValue(!shortlistPath || !state.shortlist,
    "design shortlist is already digest-bound and cannot be replaced", 4);
  requireValue(!approvalPath || !state.approval,
    "design owner decision is already digest-bound and cannot be replaced", 4);
  const selectors = retrySelectors(retry);
  const knownSelectors = new Set([
    "all",
    ...state.packets.map((packet) => packet.packet_id),
    ...state.packets.map((packet) => packet.provider.id),
    ...state.packets.map((packet) => packet.stage_id),
    ...state.packets.map((packet) => packet.design_task.kind)
  ]);
  for (const selector of selectors) {
    requireValue(knownSelectors.has(selector), `retry selector does not match a current design packet: ${selector}`);
  }
  state.status = "running";
  state.blockers = [];
  state.pending = [];
  writeState(state, lease, { faultInjector });
  const manual = manualEntries(resultPaths, state.state_directory);

  ingestKnownManual(state, lease, manual, faultInjector);
  const directionCreation = packetsOfStage(state, "design-direction-generation");
  runPackets(state, lease, directionCreation, hostManifest, selectors, faultInjector);
  let halted = haltForPackets(state, lease, "direction-generation", directionCreation, faultInjector);
  if (halted) {
    requireNoUnknownManual(manual);
    return halted;
  }
  const duplicateDirections = duplicatePrototypeGroups(state, "direction-candidate");
  if (duplicateDirections.length) {
    requireNoUnknownManual(manual);
    return stop(state, lease, "blocked", "direction-diversity", duplicateDirections.map((ids) =>
      `direction candidates reuse a byte-identical self-contained prototype: ${ids.join(", ")}`), [],
    faultInjector);
  }

  ensureDirectionBrowserPackets(state, lease, faultInjector);
  ingestKnownManual(state, lease, manual, faultInjector);
  const directionBrowser = packetsOfStage(state, "browser-evidence")
    .filter((packet) => packet.design_task.subject_kind === "direction-candidate");
  runPackets(state, lease, directionBrowser, hostManifest, selectors, faultInjector);
  halted = haltForPackets(state, lease, "direction-browser-evidence", directionBrowser, faultInjector);
  if (halted) {
    requireNoUnknownManual(manual);
    return halted;
  }

  if (!state.packets.some((packet) => packet.packet_id === "direction-review")) {
    addPackets(state, lease,
      [reviewPacket(state, "direction-review", recordsOfKind(state, "direction-candidate"))],
      faultInjector);
  }
  ingestKnownManual(state, lease, manual, faultInjector);
  const directionReview = [state.packets.find((packet) => packet.packet_id === "direction-review")];
  runPackets(state, lease, directionReview, hostManifest, selectors, faultInjector);
  halted = haltForPackets(state, lease, "direction-review", directionReview, faultInjector);
  if (halted) {
    requireNoUnknownManual(manual);
    return halted;
  }
  const eligibleDirections = eligibleDirectionIds(state);
  if (eligibleDirections.length < 3) {
    requireNoUnknownManual(manual);
    return stop(state, lease, "blocked", "direction-review", [
      `fewer than three directions passed project-fit, beauty, trust, density, implementation, distinctiveness, redesign-depth, typography, responsiveness, and browser gates (${eligibleDirections.length}/3)`
    ], [], faultInjector);
  }
  state.phase = "direction-selection";
  state.selection_scope_digest = selectionScope(state);
  writeState(state, lease, { faultInjector });
  if (!state.shortlist) {
    if (shortlistPath) ingestShortlist(state, lease, shortlistPath, faultInjector);
    else {
      requireNoUnknownManual(manual);
      const template = writeSelectionTemplate(state);
      return stop(state, lease, "manual_pending", "direction-selection", [], [
        `owner must shortlist exactly three eligible directions for ${state.selection_scope_digest}`,
        `copy template outside ${state.state_directory}, then edit and ingest the external copy: ${template}`
      ], faultInjector);
    }
  }

  state.phase = "color-generation";
  if (!state.packets.some((packet) => packet.stage_id === "color-system-generation")) {
    addPackets(state, lease, colorPackets(state), faultInjector);
  }
  ingestKnownManual(state, lease, manual, faultInjector);
  const colors = packetsOfStage(state, "color-system-generation");
  runPackets(state, lease, colors, hostManifest, selectors, faultInjector);
  halted = haltForPackets(state, lease, "color-generation", colors, faultInjector);
  if (halted) {
    requireNoUnknownManual(manual);
    return halted;
  }
  const duplicateColorPrototypes = duplicatePrototypeGroups(state, "color-candidate");
  const duplicatePalettes = duplicatePaletteGroups(state);
  if (duplicateColorPrototypes.length || duplicatePalettes.length) {
    requireNoUnknownManual(manual);
    return stop(state, lease, "blocked", "color-diversity", [
      ...duplicateColorPrototypes.map((ids) =>
        `color candidates reuse a byte-identical self-contained prototype: ${ids.join(", ")}`),
      ...duplicatePalettes.map(({ designId, ids }) =>
        `color strategies emitted an identical palette for ${designId}: ${ids.join(", ")}`)
    ], [], faultInjector);
  }

  ensureColorBrowserPackets(state, lease, faultInjector);
  ingestKnownManual(state, lease, manual, faultInjector);
  const colorBrowser = packetsOfStage(state, "browser-evidence")
    .filter((packet) => packet.design_task.subject_kind === "color-candidate");
  runPackets(state, lease, colorBrowser, hostManifest, selectors, faultInjector);
  halted = haltForPackets(state, lease, "color-browser-evidence", colorBrowser, faultInjector);
  if (halted) {
    requireNoUnknownManual(manual);
    return halted;
  }

  if (!state.packets.some((packet) => packet.packet_id === "color-review")) {
    addPackets(state, lease,
      [reviewPacket(state, "color-review", recordsOfKind(state, "color-candidate"))],
      faultInjector);
  }
  ingestKnownManual(state, lease, manual, faultInjector);
  const colorReview = [state.packets.find((packet) => packet.packet_id === "color-review")];
  runPackets(state, lease, colorReview, hostManifest, selectors, faultInjector);
  halted = haltForPackets(state, lease, "color-review", colorReview, faultInjector);
  if (halted) {
    requireNoUnknownManual(manual);
    return halted;
  }
  const eligibleColors = eligibleColorIds(state);
  const missingColorDirection = state.shortlist.normalized.candidate_ids.filter((designId) =>
    !eligibleColors.some((candidateId) =>
      resultForCandidate(state, candidateId, "color-candidate").normalized.design_candidate_id === designId));
  if (missingColorDirection.length) {
    requireNoUnknownManual(manual);
    return stop(state, lease, "blocked", "color-review", [
      `shortlisted directions lack an eligible accessible color system: ${missingColorDirection.join(", ")}`
    ], [], faultInjector);
  }
  state.phase = "owner-approval";
  state.approval_scope_digest = approvalScope(state);
  writeState(state, lease, { faultInjector });
  if (!state.approval) {
    if (approvalPath) ingestApproval(state, lease, approvalPath, faultInjector);
    else {
      requireNoUnknownManual(manual);
      const template = writeApprovalTemplate(state);
      return stop(state, lease, "manual_pending", "owner-approval", [], [
        `owner approval is required for ${state.approval_scope_digest}`,
        `copy template outside ${state.state_directory}, then edit and ingest the external copy: ${template}`
      ], faultInjector);
    }
  }
  requireNoUnknownManual(manual);
  if (state.approval.normalized.status === "rejected") {
    return stop(state, lease, "blocked", "owner-approval",
      ["owner rejected the design exploration scope"], [], faultInjector);
  }
  compileApprovedDirection(state, lease, faultInjector);
  return stop(state, lease, "complete", "complete", [], [], faultInjector);
}

function withDesignLease(statePath, operation, faultInjector, callback) {
  const lease = acquireStateLease({ statePath, operation, faultInjector });
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

export function continueDesignExploration(state, options = {}) {
  object(state, "design exploration state");
  string(state.state_path, "design exploration state.state_path");
  const absolute = path.resolve(state.state_path);
  return withDesignLease(absolute, "design-continue", options.faultInjector || null, (lease) => {
    const current = readDesignState(absolute);
    requireValue(current.state_digest === state.state_digest,
      "design state changed before guarded continuation", 5);
    return continueDesignExplorationWithLease(current, lease, options);
  });
}

export function startDesignExploration({
  statePath,
  briefPath,
  baselinePath,
  hostManifest = null,
  resultPaths = [],
  shortlistPath = null,
  approvalPath = null,
  retry = null,
  routerId = "kill-slop-router",
  routerVersion = "1.0.0",
  invocation = "explicit",
  root = process.cwd(),
  faultInjector = null
}) {
  const absoluteState = path.resolve(statePath);
  return withDesignLease(absoluteState, "design-start", faultInjector, (lease) => {
    requireValue(!fs.existsSync(absoluteState),
      `design state already exists; use --resume ${absoluteState}`);
    requireValue(!fs.existsSync(stateDirectory(absoluteState)),
      `design state directory already exists; recover it or choose another --out path`);
    const absoluteBrief = path.resolve(briefPath);
    const absoluteBaseline = path.resolve(baselinePath);
    validateStateLocation(absoluteState, absoluteBaseline);
    const pinnedBrief = readPinnedDesignJson(absoluteBrief, "design brief");
    const brief = validateDesignBrief(pinnedBrief.input);
    const referencePack = resolveReferencePack(brief, root);
    assertReferenceSourceExecutableIsolation(referencePack, brief, hostManifest);
    const runId = crypto.randomUUID();
    const state = sealState({
      design_exploration_run_version: 1,
      run_id: runId,
      journey_identity: createJourneyIdentity({ runId, routerId, routerVersion, invocation }),
      status: "running",
      phase: "direction-generation",
      created_at: nowIso(),
      updated_at: nowIso(),
      state_path: absoluteState,
      state_directory: stateDirectory(absoluteState),
      brief,
      brief_source: pinnedDesignSnapshot(pinnedBrief, root),
      reference_pack: referencePack,
      baseline: snapshotArtifact(absoluteBaseline, { root }),
      packets: [],
      packet_files: {},
      results: [],
      attempts: [],
      lease_recoveries: [],
      in_flight: null,
      shortlist: null,
      approval: null,
      selection_scope_digest: null,
      approval_scope_digest: null,
      pending_finalization: null,
      outputs: {},
      final_receipt_digests: null,
      blockers: [],
      pending: [],
      state_digest: null
    });
    fs.mkdirSync(state.state_directory, { recursive: true });
    writeState(state, lease, { faultInjector });
    addPackets(state, lease, directionPackets(state), faultInjector);
    return continueDesignExplorationWithLease(state, lease, {
      hostManifest, resultPaths, shortlistPath, approvalPath, retry, faultInjector
    });
  });
}

export function resumeDesignExploration(statePath, options = {}) {
  const absolute = path.resolve(statePath);
  return withDesignLease(absolute, "design-resume", options.faultInjector || null, (lease) => {
    const state = readDesignState(absolute);
    return continueDesignExplorationWithLease(state, lease, options);
  });
}

function recoveryBody(receipt) {
  const { recovery_digest: _digest, ...body } = receipt;
  return body;
}

export function inspectDesignStateLease(statePath) {
  return inspectStateLease(statePath);
}

export function recoverDesignStateLease(statePath, {
  ownerToken,
  acquiredAt,
  stateDigest,
  faultInjector = null
} = {}) {
  const absolute = path.resolve(statePath);
  const preflight = inspectStateLease(absolute);
  requireValue(preflight.status === "locked",
    "design lease recovery requires an active state lease", 5);
  requireValue(preflight.state_digest === stateDigest,
    "design lease recovery state digest does not match the current state", 5);
  const state = preflight.state_digest === "absent" ? null : readDesignState(absolute);
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
        design_lease_recovery_result_version: 1,
        status: "recovered_absent_state",
        state_path: absolute,
        state_digest: "absent",
        recovered_lease_digest: origin.lease_digest,
        blocker: "inspect any leftover design state directory before starting a new run"
      };
    }
    requireValue(state.state_digest === preflight.state_digest,
      "design state changed after recovery preflight", 5);
    const alreadyRecorded = (state.lease_recoveries || []).find((item) =>
      item.recovered_lease_digest === origin.lease_digest);
    if (alreadyRecorded) {
      requireValue(canonicalDigest(recoveryBody(alreadyRecorded)) ===
        alreadyRecorded.recovery_digest && state.in_flight === null,
      "recorded design recovery is not in a releasable checkpoint state", 4);
      completeStateLeaseRecovery(claimed.controller);
      releaseStateLease(claimed.controller);
      return {
        design_lease_recovery_result_version: 1,
        status: "recovered",
        state_path: absolute,
        state_digest: state.state_digest,
        recovery: alreadyRecorded
      };
    }

    const active = state.in_flight;
    const originPacket = origin.active_packet;
    const packet = originPacket
      ? state.packets.find((item) => item.packet_id === originPacket.packet_id)
      : null;
    const checkpointedAttempt = !active && origin.phase === "child-execution" && originPacket && packet
      ? state.attempts.find((item) =>
        item.packet_id === originPacket.packet_id &&
        item.provider_id === originPacket.provider_id &&
        item.attempt === originPacket.attempt &&
        item.packet_digest === packet.packet_digest &&
        (item.execution_status === "ran" || item.execution_status?.startsWith("blocked")))
      : null;
    const checkpointedResult = checkpointedAttempt?.execution_status === "ran"
      ? resultForPacket(state, originPacket.packet_id)
      : null;
    const postChildCheckpoint = Boolean(checkpointedAttempt) &&
      (checkpointedAttempt.execution_status !== "ran" ||
        (checkpointedResult &&
          checkpointedAttempt.result_digest === checkpointedResult.result_digest &&
          acceptedAttemptFor(state, checkpointedResult, packet) === checkpointedAttempt));
    if (origin.phase === "child-execution" && origin.active_packet) {
      requireValue(postChildCheckpoint || (active &&
        active.packet_id === origin.active_packet.packet_id &&
        active.provider_id === origin.active_packet.provider_id &&
        active.attempt === origin.active_packet.attempt),
      "design state and lease disagree about the abandoned child", 4);
    }
    if (["child-intent", "child-execution"].includes(origin.phase)) {
      requireValue(active || postChildCheckpoint,
        "design child-phase recovery requires a matching sealed in-flight intent", 4);
    }
    if (active && !["state-write", "child-intent", "child-execution", "recovery"].includes(origin.phase)) {
      throw new RouterError(
        `design in-flight intent conflicts with stale lease phase ${origin.phase}`,
        4
      );
    }
    const outcome = postChildCheckpoint || !active
      ? "checkpoint_recovered"
      : origin.phase === "child-execution"
        ? "abandoned_after_crash"
        : "abandoned_before_spawn";
    const receipt = {
      design_lease_recovery_version: 1,
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
    state.lease_recoveries.push(receipt);
    if (active) {
      state.attempts.push({
        packet_id: active.packet_id,
        provider_id: active.provider_id,
        participant: structuredClone(packet?.participant),
        attempt: active.attempt,
        packet_digest: active.packet_digest,
        execution_status: outcome === "abandoned_after_crash"
          ? "blocked_abandoned_after_crash"
          : "blocked_abandoned_before_spawn",
        recovery_digest: receipt.recovery_digest,
        error: "orchestrator crashed before a trustworthy child result was checkpointed",
        retry_required: true,
        recovered_at: receipt.recovered_at
      });
    }
    state.in_flight = null;
    state.status = active ? "blocked" : "manual_pending";
    state.phase = active ? "design-recovery" : state.phase;
    state.blockers = active
      ? [`${active.packet_id}: unknown child outcome after orchestrator crash; explicit retry required`]
      : [];
    state.pending = active
      ? state.pending
      : ["resume the recovered KillSlopRouter design journey from its verified checkpoint"];
    writeState(state, claimed.controller, { faultInjector });
    releaseStateLease(claimed.controller);
    return {
      design_lease_recovery_result_version: 1,
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

function dryPacket(state, kind, providerId, capabilities, strength, permissions, suffix = "") {
  const referenceStage = kind === "color-candidate" || kind === "color-review"
    ? "color-review"
    : kind === "direction-review" ? "direction-review" : null;
  const reviewer = kind === "direction-review" || kind === "color-review";
  return makePacket(state, {
    packetId: `dry-${kind}-${providerId}${suffix}`.replace(/[^A-Za-z0-9._-]/g, "-"),
    stageId: kind === "color-candidate" ? "color-system-generation" : kind,
    providerId,
    capabilities: [
      ...capabilities,
      ...(state.reference_pack && reviewer
        ? ["reference-source-composition-review"] : [])
    ],
    strength,
    permissions: [
      ...permissions,
      ...(state.reference_pack && reviewer ? ["reference-evidence:read"] : [])
    ],
    forbiddenPermissions: referenceForbiddenPermissions(state, { reviewer }),
    viewports: kind === "browser-evidence" ? state.brief.evidence.required_viewports : [],
    checks: kind === "browser-evidence" ? state.brief.evidence.required_checks : [],
    task: {
      kind,
      ...(state.reference_pack && referenceStage ? {
        reference_intelligence: referenceDesignContract(
          state,
          referenceStage,
          reviewer ? "independent-reviewer" : "creator"
        )
      } : {})
    }
  });
}

export function dryRunDesignExploration({
  briefPath,
  baselinePath,
  hostManifest = null,
  routerId = "kill-slop-router",
  routerVersion = "1.0.0",
  invocation = "explicit",
  root = process.cwd()
}) {
  const absoluteBrief = path.resolve(briefPath);
  const absoluteBaseline = path.resolve(baselinePath);
  const pinnedBrief = readPinnedDesignJson(absoluteBrief, "design brief");
  const brief = validateDesignBrief(pinnedBrief.input);
  const referencePack = resolveReferencePack(brief, root);
  assertReferenceSourceExecutableIsolation(referencePack, brief, hostManifest);
  const state = {
    run_id: "dry-run",
    journey_identity: createJourneyIdentity({
      runId: "dry-run", routerId, routerVersion, invocation
    }),
    brief,
    brief_source: pinnedDesignSnapshot(pinnedBrief, root),
    reference_pack: referencePack,
    baseline: snapshotArtifact(absoluteBaseline, { root })
  };
  const packets = [
    ...directionPackets(state),
    dryPacket(state, "browser-evidence", brief.providers.browser_evidence,
      REQUIRED_BROWSER_CAPABILITIES, 3, ["artifact:read", "evidence:write", "browser:control"]),
    dryPacket(state, "direction-review", brief.providers.direction_reviewer,
      DIRECTION_REVIEW_CAPABILITIES, 4, ["artifact:read", "evidence:write"]),
    ...brief.color_strategies.map((strategy) => dryPacket(state, "color-candidate",
      strategy.creator_provider_id, COLOR_CAPABILITIES, 3, ["artifact:read", "evidence:write"], `-${strategy.id}`)),
    dryPacket(state, "color-review", brief.providers.color_reviewer,
      COLOR_REVIEW_CAPABILITIES, 4, ["artifact:read", "evidence:write"])
  ];
  const readiness = packets.map((packet) => {
    const inspected = inspectPacketAdapter(packet, hostManifest);
    const { declaration: _declaration, ...safe } = inspected;
    return safe;
  });
  const pending = readiness.filter((item) => item.execution_status !== "ready");
  return {
    design_exploration_dry_run_version: 1,
    journey_identity: state.journey_identity,
    status: pending.length ? "manual_pending" : "ready",
    project_id: brief.project_id,
    surface: brief.surface,
    baseline: publicSnapshot(state.baseline),
    brief: publicSnapshot(state.brief_source),
    ...(state.reference_pack ? {
      reference_intelligence: {
        pack_digest: state.reference_pack.pack_digest,
        file: publicSnapshot(state.reference_pack.source),
        authority_scope: state.reference_pack.normalized.authority_scope,
        reviewer_source_capture_readiness: structuredClone(
          state.reference_pack.normalized.downstream_contract
            .reviewer_source_capture_readiness
        ),
        source_pixels_included: false,
        exact_three_3x3_route_unchanged: true
      }
    } : {}),
    direction_matrix: brief.directions.flatMap((direction) => DESIGN_DEPTHS.map((depth) => ({
      candidate_id: directionCandidateId(direction.id, depth),
      direction_id: direction.id,
      redesign_depth: depth,
      thesis: direction.thesis
    }))),
    color_matrix: {
      shortlisted_directions: 3,
      strategies_per_direction: brief.color_strategies.length,
      total_candidates: 9,
      strategies: brief.color_strategies.map((strategy) => ({
        id: strategy.id,
        color_space: strategy.color_space,
        harmony_strategy: strategy.harmony_strategy
      }))
    },
    readiness,
    pending: pending.map((item) => `${item.packet_id}: ${item.reason || item.execution_status}`),
    hard_gates: [
      "independent-review", "playwright-evidence", "owner-shortlist", "computed-contrast",
      "owner-approval", "artifact-digest", "locale", "network-privacy",
      "downstream-domain-review", "downstream-privacy-review"
    ]
  };
}

export function dispatchDesignPackets(state, outputDirectory) {
  const directory = path.resolve(outputDirectory);
  fs.mkdirSync(directory, { recursive: true });
  for (const packet of state.packets) writeJsonAtomic(path.join(directory, `${packet.packet_id}.json`), packet);
  let shortlistTemplate = null;
  let approvalTemplate = null;
  if (state.selection_scope_digest && !state.shortlist) {
    shortlistTemplate = path.join(directory, "design-shortlist.template.json");
    writeJsonAtomic(shortlistTemplate, {
      design_shortlist_version: 1,
      run_id: state.run_id,
      journey_identity: structuredClone(state.journey_identity),
      selection_scope_digest: state.selection_scope_digest,
      owner_id: "REPLACE_WITH_OWNER_ID",
      candidate_ids: eligibleDirectionIds(state).slice(0, 3),
      rationale: "REPLACE_WITH_OWNER_RATIONALE",
      decided_at: nowIso()
    });
  }
  if (state.approval_scope_digest && !state.approval) {
    approvalTemplate = path.join(directory, "design-owner-decision.template.json");
    writeJsonAtomic(approvalTemplate, {
      design_owner_decision_version: 1,
      run_id: state.run_id,
      journey_identity: structuredClone(state.journey_identity),
      approval_scope_digest: state.approval_scope_digest,
      owner_id: "REPLACE_WITH_OWNER_ID",
      status: "approved",
      selected_design_candidate_id: "REPLACE_WITH_SHORTLISTED_DIRECTION",
      selected_color_candidate_id: "REPLACE_WITH_ELIGIBLE_COLOR",
      note: "REPLACE_WITH_EXPLICIT_OWNER_DECISION",
      decided_at: nowIso()
    });
  }
  return {
    run_id: state.run_id,
    journey_identity: structuredClone(state.journey_identity),
    status: state.status,
    directory,
    packet_count: state.packets.length,
    packet_digest: hashArtifact(directory),
    shortlist_template: shortlistTemplate,
    approval_template: approvalTemplate
  };
}

export function designExitCode(state) {
  if (["complete", "ready"].includes(state.status)) return 0;
  if (state.status === "manual_pending") return 6;
  return 5;
}
