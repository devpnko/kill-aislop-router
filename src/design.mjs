import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { executeAuditPacket, inspectPacketAdapter } from "./execution.mjs";
import {
  canonicalDigest,
  hashArtifact,
  publicSnapshot,
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
  readJson,
  resolveVisualIntent,
  resolveVisualSignature,
  validateVisualIntentContract,
  validateVisualSignatureContract,
  visualIntentBody,
  visualSignatureBody
} from "./router.mjs";
import {
  createJourneyIdentity,
  createParticipant,
  identitiesMatch,
  verifyJourneyIdentity,
  verifyPacketJourney
} from "./identity.mjs";

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
const HEX_PATTERN = /^#[0-9A-F]{6}$/;
const CSS_TOKEN_PATTERN = /^--[a-z0-9][a-z0-9-]*$/;
const DESIGN_EVIDENCE_KINDS = new Set([
  "prototype", "screenshot", "test-report", "review-report", "token-spec", "font-report"
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

function writeState(state) {
  state.updated_at = nowIso();
  sealState(state);
  writeJsonAtomic(state.state_path, state);
}

function packetBody(packet) {
  const { packet_digest: _digest, ...body } = packet;
  return body;
}

function makePacket(state, {
  packetId,
  stageId,
  providerId,
  capabilities,
  strength,
  permissions,
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
    provider: { id: providerId, kind: "external", version: null },
    assigned_capabilities: [...capabilities],
    minimum_strength: strength,
    required_permissions: [...permissions],
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
        brief_digest: state.brief_source.digest
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
    capabilities: REQUIRED_BROWSER_CAPABILITIES,
    strength: 3,
    permissions: ["artifact:read", "evidence:write", "browser:control"],
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
    capabilities: direction ? DIRECTION_REVIEW_CAPABILITIES : COLOR_REVIEW_CAPABILITIES,
    strength: 4,
    permissions: ["artifact:read", "evidence:write"],
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
      baseline_policy: state.brief.baseline_policy
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
        task: {
          kind: "color-candidate",
          candidate_id: candidateId,
          design_candidate_id: designId,
          color_strategy: strategy,
          source_design_digest: source.result_digest,
          source_design_binding: resultBinding(state, source),
          project: state.brief.product,
          locales: state.brief.locales,
          required_states: state.brief.evidence.required_states
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

export function validateDesignBrief(brief) {
  exact(brief, new Set([
    "design_brief_version", "project_id", "surface", "screen_id", "locales", "product",
    "baseline_policy", "editorial_boundary", "directions", "color_strategies", "providers", "evidence"
  ]), "design brief");
  requireValue(brief.design_brief_version === 1, "design_brief_version must be 1");
  string(brief.project_id, "design brief project_id");
  requireValue(VALID_SURFACES.has(brief.surface), "design brief surface is invalid");
  safeId(brief.screen_id, "design brief screen_id");
  uniqueStrings(brief.locales, "design brief locales");
  validateProduct(brief.product);

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
    requireValue(["oklch", "hct"].includes(strategy.color_space), `${label}.color_space must be oklch or hct`);
    for (const key of ["seed_sources", "role_intent", "anti_patterns"]) uniqueStrings(strategy[key], `${label}.${key}`);
    colorCreators.push(strategy.creator_provider_id);
  }
  requireValue(new Set(strategyIds).size === 3, "color strategy ids must be unique");

  exact(brief.providers, new Set(["direction_reviewer", "color_reviewer", "browser_evidence"]),
    "design brief providers");
  for (const key of ["direction_reviewer", "color_reviewer", "browser_evidence"]) {
    string(brief.providers[key], `design brief providers.${key}`);
  }
  requireValue(!directionCreators.includes(brief.providers.direction_reviewer),
    "direction reviewer provider must be independent from direction creators");
  requireValue(!colorCreators.includes(brief.providers.color_reviewer),
    "color reviewer provider must be independent from color creators");
  requireValue(![...directionCreators, ...colorCreators].includes(brief.providers.browser_evidence),
    "browser evidence provider must be independent from design creators");

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
    exact(item, new Set(["kind", "path", "viewport", "state", "checks"]), label);
    string(item.kind, `${label}.kind`);
    requireValue(DESIGN_EVIDENCE_KINDS.has(item.kind), `${label}.kind is unsupported`, 4);
    string(item.path, `${label}.path`);
    if (item.viewport !== undefined) string(item.viewport, `${label}.viewport`);
    if (item.state !== undefined) string(item.state, `${label}.state`);
    if (item.checks !== undefined) uniqueStrings(item.checks, `${label}.checks`, { empty: true });
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

function actor(input) {
  exact(input, new Set(["actor_id", "kind"]), "design result actor");
  string(input.actor_id, "design result actor.actor_id");
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
    "evidence"
  ]), "design result");
  requireValue(input.design_result_version === 1, "design_result_version must be 1", 4);
  requireValue(DESIGN_RESULT_KINDS.has(input.kind), "design result kind is invalid", 4);
  requireValue(input.kind === packet.design_task.kind, "design result kind does not match its packet", 4);
  requireValue(input.packet_id === packet.packet_id, "design result packet_id mismatch", 4);
  requireValue(input.provider_id === packet.provider.id, "design result provider_id mismatch", 4);
  requireValue(input.packet_digest === packet.packet_digest, "design result packet digest mismatch", 4);
  requireValue(input.status === "completed", "design result must be completed", 4);
  actor(input.actor);
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

function resultBinding(state, record) {
  requireValue(record, "design result binding requires a recorded result", 4);
  const packet = state.packets.find((item) => item.packet_id === record.packet_id);
  requireValue(packet, `design result packet is missing: ${record.packet_id}`, 4);
  const attempt = [...state.attempts].reverse().find((item) =>
    item.packet_id === record.packet_id && item.result_digest === record.result_digest);
  requireValue(attempt, `design result execution provenance is missing: ${record.packet_id}`, 4);
  return {
    provider_id: record.provider_id,
    participant: structuredClone(record.participant),
    actor_id: record.normalized.actor.actor_id,
    packet_digest: packet.packet_digest,
    result_digest: record.result_digest,
    result_source_digest: record.source.digest,
    evidence: record.evidence.map((item) => ({
      kind: item.evidence_kind,
      digest: item.digest,
      viewport: item.viewport,
      state: item.state
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

function validateDirectionCandidate(state, packet, result) {
  const candidateId = packet.design_task.candidate_id;
  requireValue(result.candidate_id === candidateId, "direction candidate_id mismatch", 4);
  requireValue(result.baseline_digest === state.baseline.digest, "direction baseline digest mismatch", 4);
  string(result.rationale, "direction result rationale");
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
  requireValue(result.actor.actor_id !== subject.normalized.actor.actor_id,
    "creator cannot provide browser evidence for its own candidate", 4);
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
  requireValue(result.evidence.some((item) => item.kind === "review-report"),
    `${kind} requires review-report evidence`, 4);
  const creatorActorIds = new Set(records.map((record) => record.normalized.actor.actor_id));
  requireValue(!creatorActorIds.has(result.actor.actor_id), "creator cannot review a candidate it created", 4);
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
}

export function validateDesignResult(state, packet, input, sourcePath) {
  const result = baseResult(state, packet, input, sourcePath);
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
    state: item.state || null
  }));
}

function recordResult(state, packet, input, sourcePath) {
  requireValue(!resultForPacket(state, packet.packet_id),
    `design result already exists for packet: ${packet.packet_id}`, 4);
  const absoluteSource = path.resolve(sourcePath);
  const normalized = validateDesignResult(state, packet, input, absoluteSource);
  const record = {
    packet_id: packet.packet_id,
    provider_id: packet.provider.id,
    participant: structuredClone(packet.participant),
    result_digest: canonicalDigest(normalized),
    source: snapshotArtifact(absoluteSource, { root: state.state_directory }),
    evidence: snapshotResultEvidence(normalized, state.state_directory),
    normalized,
    recorded_at: nowIso()
  };
  state.results.push(record);
  writeState(state);
  return record;
}

function verifyBoundSnapshot(snapshot, label) {
  const verification = verifySnapshot(snapshot);
  requireValue(verification.ok,
    `${label} changed after it was digest-bound (${verification.reason})`, 4);
}

export function readDesignState(statePath) {
  const absolute = path.resolve(statePath);
  const state = readJson(absolute, "design exploration run");
  requireValue(state.design_exploration_run_version === 1,
    "design_exploration_run_version must be 1");
  requireValue(path.resolve(state.state_path) === absolute,
    "design state path does not match the resume target", 4);
  requireValue(canonicalDigest(stateBody(state)) === state.state_digest,
    "design state digest mismatch", 4);
  verifyJourneyIdentity(state.journey_identity, {
    runId: state.run_id,
    label: "design exploration journey_identity"
  });
  validateDesignBrief(state.brief);
  verifyBoundSnapshot(state.brief_source, "design brief");
  verifyBoundSnapshot(state.baseline, "design baseline");
  for (const packet of state.packets || []) {
    verifyPacketJourney(packet, state.journey_identity, `design packet ${packet.packet_id}`);
    requireValue(canonicalDigest(packetBody(packet)) === packet.packet_digest,
      `design packet digest mismatch: ${packet.packet_id}`, 4);
    requireValue(state.packet_files?.[packet.packet_id],
      `design packet file binding is missing: ${packet.packet_id}`, 4);
    verifyBoundSnapshot(state.packet_files[packet.packet_id], `design packet ${packet.packet_id}`);
  }
  for (const record of state.results || []) {
    verifyBoundSnapshot(record.source, `design result ${record.packet_id}`);
    requireValue(canonicalDigest(record.normalized) === record.result_digest,
      `design result digest mismatch: ${record.packet_id}`, 4);
    for (const evidence of record.evidence || []) {
      verifyBoundSnapshot(evidence, `design evidence ${record.packet_id}/${evidence.path}`);
    }
  }
  if (state.shortlist) verifyBoundSnapshot(state.shortlist.source, "design shortlist");
  if (state.approval) verifyBoundSnapshot(state.approval.source, "design owner decision");
  for (const [label, snapshot] of Object.entries(state.outputs || {})) {
    verifyBoundSnapshot(snapshot, `design output ${label}`);
  }
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

function selectionScope(state) {
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
      resultBinding(state, record)
    ])),
    browser_evidence: Object.fromEntries(browsers.map((record) => [
      record.normalized.candidate_id,
      resultBinding(state, record)
    ])),
    review: review ? resultBinding(state, review) : null
  });
}

function approvalScope(state) {
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
      resultBinding(state, record)
    ])),
    browser_evidence: Object.fromEntries(browsers.map((record) => [
      record.normalized.candidate_id,
      resultBinding(state, record)
    ])),
    review: review ? resultBinding(state, review) : null
  });
}

function ingestShortlist(state, shortlistPath) {
  requireValue(!state.shortlist, "design shortlist is already recorded", 4);
  const absolute = path.resolve(shortlistPath);
  const input = readJson(absolute, "design shortlist");
  exact(input, new Set([
    "design_shortlist_version", "run_id", "journey_identity", "selection_scope_digest", "owner_id",
    "candidate_ids", "rationale", "decided_at"
  ]), "design shortlist");
  requireValue(input.design_shortlist_version === 1, "design_shortlist_version must be 1", 4);
  requireValue(input.run_id === state.run_id, "design shortlist run_id mismatch", 4);
  requireValue(identitiesMatch(input.journey_identity, state.journey_identity),
    "design shortlist journey_identity mismatch", 4);
  requireValue(input.selection_scope_digest === state.selection_scope_digest,
    "design shortlist scope digest mismatch", 4);
  string(input.owner_id, "design shortlist owner_id");
  uniqueStrings(input.candidate_ids, "design shortlist candidate_ids");
  requireValue(input.candidate_ids.length === 3, "owner shortlist must contain exactly three directions", 4);
  const eligible = eligibleDirectionIds(state);
  requireValue(input.candidate_ids.every((candidateId) => eligible.includes(candidateId)),
    "owner shortlist contains an ineligible or hard-blocked direction", 4);
  string(input.rationale, "design shortlist rationale");
  requireValue(!Number.isNaN(Date.parse(input.decided_at)), "design shortlist decided_at is invalid", 4);
  const creators = input.candidate_ids.map((candidateId) =>
    resultForCandidate(state, candidateId, "direction-candidate").normalized.actor.actor_id);
  requireValue(!creators.includes(input.owner_id), "candidate creator cannot make the owner shortlist", 4);
  state.shortlist = {
    normalized: structuredClone(input),
    shortlist_digest: canonicalDigest(input),
    source: snapshotArtifact(absolute, { root: state.state_directory })
  };
  writeState(state);
}

function ingestApproval(state, approvalPath) {
  requireValue(!state.approval, "design owner decision is already recorded", 4);
  const absolute = path.resolve(approvalPath);
  const input = readJson(absolute, "design owner decision");
  exact(input, new Set([
    "design_owner_decision_version", "run_id", "journey_identity", "approval_scope_digest", "owner_id", "status",
    "selected_design_candidate_id", "selected_color_candidate_id", "note", "decided_at"
  ]), "design owner decision");
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
  string(input.selected_design_candidate_id, "design owner decision selected_design_candidate_id");
  string(input.selected_color_candidate_id, "design owner decision selected_color_candidate_id");
  string(input.note, "design owner decision note");
  requireValue(!Number.isNaN(Date.parse(input.decided_at)), "design owner decision decided_at is invalid", 4);
  if (input.status === "approved") {
    requireValue(state.shortlist.normalized.candidate_ids.includes(input.selected_design_candidate_id),
      "owner decision selected design is outside the shortlist", 4);
    requireValue(eligibleColorIds(state).includes(input.selected_color_candidate_id),
      "owner decision selected color is ineligible or hard-blocked", 4);
    const color = resultForCandidate(state, input.selected_color_candidate_id, "color-candidate");
    requireValue(color?.normalized.design_candidate_id === input.selected_design_candidate_id,
      "selected color does not belong to the selected design", 4);
    const creators = [
      resultForCandidate(state, input.selected_design_candidate_id, "direction-candidate").normalized.actor.actor_id,
      color.normalized.actor.actor_id
    ];
    requireValue(!creators.includes(input.owner_id), "candidate creator cannot approve its own design", 4);
  }
  state.approval = {
    normalized: structuredClone(input),
    approval_digest: canonicalDigest(input),
    source: snapshotArtifact(absolute, { root: state.state_directory })
  };
  writeState(state);
}

function receiptEvidence(kind, filePath) {
  return { kind, path: path.resolve(filePath), digest: hashArtifact(filePath) };
}

function compileApprovedDirection(state) {
  const approval = state.approval.normalized;
  const direction = resultForCandidate(state, approval.selected_design_candidate_id, "direction-candidate");
  const color = resultForCandidate(state, approval.selected_color_candidate_id, "color-candidate");
  const directionBrowser = resultForCandidate(state, approval.selected_design_candidate_id, "browser-evidence");
  const colorBrowser = resultForCandidate(state, approval.selected_color_candidate_id, "browser-evidence");
  const directionReview = resultForPacket(state, "direction-review");
  const colorReview = resultForPacket(state, "color-review");
  const signature = structuredClone(direction.normalized.signature);
  signature.palette = structuredClone(color.normalized.palette);
  const directory = path.join(state.state_directory, "approved");
  fs.mkdirSync(directory, { recursive: true });
  const decisionPath = path.join(directory, "design-direction-decision.json");
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
      approval_scope: state.approval_scope_digest
    },
    source_bindings: {
      direction_candidate: resultBinding(state, direction),
      direction_browser: resultBinding(state, directionBrowser),
      direction_review: resultBinding(state, directionReview),
      color_candidate: resultBinding(state, color),
      color_browser: resultBinding(state, colorBrowser),
      color_review: resultBinding(state, colorReview)
    },
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
  writeJsonAtomic(decisionPath, decision);

  const approvalPath = state.approval.source.resolved_path;
  const prototypePath = direction.normalized.evidence.find((item) => item.kind === "prototype").path;
  const colorPrototypePath = color.normalized.evidence.find((item) => item.kind === "prototype").path;
  const fontReportPaths = direction.normalized.evidence
    .filter((item) => item.kind === "font-report").map((item) => item.path);
  const tokenSpecPaths = color.normalized.evidence
    .filter((item) => item.kind === "token-spec").map((item) => item.path);
  const directionBrowserPaths = directionBrowser.normalized.evidence
    .filter((item) => ["screenshot", "test-report"].includes(item.kind))
    .map((item) => item.path);
  const colorBrowserPaths = colorBrowser.normalized.evidence
    .filter((item) => ["screenshot", "test-report"].includes(item.kind))
    .map((item) => item.path);
  const colorResultPath = color.source.resolved_path;
  const intentReceiptPath = path.join(directory, "visual-intent-approval.json");
  const intentReceipt = {
    visual_intent_receipt_version: 1,
    journey_identity: structuredClone(state.journey_identity),
    project_id: state.brief.project_id,
    surface: state.brief.surface,
    status: "approved",
    intent: structuredClone(direction.normalized.intent),
    authority: structuredClone(decision.authority),
    evidence: [
      receiptEvidence("owner-direction", decisionPath),
      receiptEvidence("owner-approval", approvalPath),
      receiptEvidence("approved-artifact", prototypePath),
      ...directionBrowserPaths.map((file) => receiptEvidence("approved-artifact", file))
    ]
  };
  writeJsonAtomic(intentReceiptPath, intentReceipt);

  const signatureReceiptPath = path.join(directory, "visual-signature-approval.json");
  const decisionEvidence = receiptEvidence("owner-direction", decisionPath);
  const approvalEvidence = receiptEvidence("owner-approval", approvalPath);
  const prototypeEvidence = receiptEvidence("approved-artifact", prototypePath);
  const colorPrototypeEvidence = receiptEvidence("approved-artifact", colorPrototypePath);
  const colorResultEvidence = receiptEvidence("design-tokens", colorResultPath);
  const fontEvidence = fontReportPaths.map((file) => receiptEvidence("approved-artifact", file));
  const tokenSpecEvidence = tokenSpecPaths.map((file) => receiptEvidence("design-tokens", file));
  const directionBrowserEvidence = directionBrowserPaths
    .map((file) => receiptEvidence("approved-artifact", file));
  const colorBrowserEvidence = colorBrowserPaths
    .map((file) => receiptEvidence("approved-artifact", file));
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
  writeJsonAtomic(signatureReceiptPath, signatureReceipt);

  const intentContract = approvedIntent(direction.normalized.intent);
  intentContract.authority_receipt = intentReceiptPath;
  intentContract.authority_digest = hashArtifact(intentReceiptPath);
  const signatureContract = approvedSignature(signature);
  signatureContract.authority_receipt = signatureReceiptPath;
  signatureContract.authority_digest = hashArtifact(signatureReceiptPath);
  validateVisualIntentContract(intentContract);
  validateVisualSignatureContract(signatureContract);

  const bindingsPath = path.join(directory, "profile-bindings.json");
  const bindings = {
    profile_bindings_version: 1,
    journey_identity: structuredClone(state.journey_identity),
    project_id: state.brief.project_id,
    surface: state.brief.surface,
    generated_at: nowIso(),
    visual_intent: intentContract,
    visual_signature: signatureContract,
    decision: { path: decisionPath, digest: hashArtifact(decisionPath) }
  };
  writeJsonAtomic(bindingsPath, bindings);
  const verificationProfile = {
    project_id: state.brief.project_id,
    visual_intents: { [state.brief.surface]: intentContract },
    visual_signatures: { [state.brief.surface]: signatureContract }
  };
  const verifiedIntent = resolveVisualIntent(verificationProfile, bindingsPath, state.brief.surface);
  const verifiedSignature = resolveVisualSignature(verificationProfile, bindingsPath, state.brief.surface);
  requireValue(verifiedIntent.authority_status === "verified",
    `compiled visual intent receipt is invalid: ${verifiedIntent.issues.join("; ")}`, 4);
  requireValue(verifiedSignature.authority_status === "verified",
    `compiled visual signature receipt is invalid: ${verifiedSignature.issues.join("; ")}`, 4);

  state.outputs = Object.fromEntries(Object.entries({
    decision: decisionPath,
    visual_intent_receipt: intentReceiptPath,
    visual_signature_receipt: signatureReceiptPath,
    profile_bindings: bindingsPath
  }).map(([key, file]) => [key, snapshotArtifact(file, { root: state.state_directory })]));
  state.final_receipt_digests = {
    visual_intent: intentContract.authority_digest,
    visual_signature: signatureContract.authority_digest,
    decision: bindings.decision.digest
  };
  writeState(state);
}

function addPackets(state, packets) {
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
  writeState(state);
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

function runPacket(state, packet, manifest, selectors) {
  if (resultForPacket(state, packet.packet_id)) return;
  const previous = lastAttempt(state, packet.packet_id);
  if (previous?.execution_status?.startsWith("blocked") && !retryMatches(selectors, packet)) return;
  const inspection = inspectPacketAdapter(packet, manifest);
  if (previous?.execution_status === "manual_pending" &&
    inspection.execution_status === "manual_pending" &&
    previous.host_manifest_digest === inspection.host_manifest_digest &&
    previous.reason === inspection.reason) return;

  const attempt = attemptNumber(state, packet.packet_id);
  const outputDirectory = path.join(state.state_directory, "evidence", packet.packet_id, `attempt-${attempt}`);
  const executed = executeAuditPacket({
    run: adapterRun(state, packet),
    packet,
    manifest,
    attempt,
    outputDirectory
  });
  const { result, declaration: _declaration, ...attemptRecord } = executed;
  const stored = { ...attemptRecord, attempted_at: nowIso() };
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
  writeState(state);
}

function runPackets(state, packets, manifest, selectors) {
  for (const packet of packets) runPacket(state, packet, manifest, selectors);
}

function stop(state, status, phase, blockers = [], pending = []) {
  state.status = status;
  state.phase = phase;
  state.blockers = [...new Set(blockers)];
  state.pending = [...new Set(pending)];
  writeState(state);
  return state;
}

function haltForPackets(state, phase, packets) {
  const missing = packets.filter((packet) => !resultForPacket(state, packet.packet_id));
  if (!missing.length) return null;
  const failures = missing.map((packet) => ({ packet, attempt: lastAttempt(state, packet.packet_id) }))
    .filter(({ attempt }) => attempt?.execution_status?.startsWith("blocked"));
  if (failures.length) {
    return stop(state, "blocked", phase, failures.map(({ packet, attempt }) =>
      `${packet.packet_id}: ${attempt.error || attempt.execution_status}`));
  }
  return stop(state, "manual_pending", phase, [], missing.map((packet) => {
    const attempt = lastAttempt(state, packet.packet_id);
    return `${packet.packet_id}: ${attempt?.reason || "result is required"}`;
  }));
}

function manualEntries(resultPaths) {
  return resultPaths.map((file) => {
    const absolute = path.resolve(file);
    return { path: absolute, input: readJson(absolute, "manual design result"), consumed: false };
  });
}

function ingestKnownManual(state, entries) {
  for (const entry of entries) {
    if (entry.consumed) continue;
    const packet = state.packets.find((item) => item.packet_id === entry.input.packet_id);
    if (!packet) continue;
    requireValue(!resultForPacket(state, packet.packet_id),
      `manual design result duplicates an existing packet: ${packet.packet_id}`, 4);
    recordResult(state, packet, entry.input, entry.path);
    state.attempts.push({
      packet_id: packet.packet_id,
      provider_id: packet.provider.id,
      participant: structuredClone(packet.participant),
      adapter: "manual-v1",
      execution_status: "manual_recorded",
      attempt: attemptNumber(state, packet.packet_id),
      result_path: entry.path,
      result_digest: resultForPacket(state, packet.packet_id).result_digest,
      recorded_at: nowIso()
    });
    entry.consumed = true;
    writeState(state);
  }
}

function requireNoUnknownManual(entries) {
  const unknown = entries.filter((entry) => !entry.consumed);
  requireValue(unknown.length === 0,
    `manual result references a packet that is not currently dispatched: ${unknown.map((item) => item.input.packet_id || item.path).join(", ")}`,
    4);
}

function ensureDirectionBrowserPackets(state) {
  addPackets(state, recordsOfKind(state, "direction-candidate").map((record) => browserPacket(state, record)));
}

function ensureColorBrowserPackets(state) {
  addPackets(state, recordsOfKind(state, "color-candidate").map((record) => browserPacket(state, record)));
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

export function continueDesignExploration(state, {
  hostManifest = null,
  resultPaths = [],
  shortlistPath = null,
  approvalPath = null,
  retry = null
} = {}) {
  verifyJourneyIdentity(state.journey_identity, {
    runId: state.run_id,
    label: "active design journey_identity"
  });
  for (const packet of state.packets || []) {
    verifyPacketJourney(packet, state.journey_identity, `active design packet ${packet.packet_id}`);
  }
  if (state.status === "complete") return state;
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
  writeState(state);
  const manual = manualEntries(resultPaths);

  ingestKnownManual(state, manual);
  const directionCreation = packetsOfStage(state, "design-direction-generation");
  runPackets(state, directionCreation, hostManifest, selectors);
  let halted = haltForPackets(state, "direction-generation", directionCreation);
  if (halted) {
    requireNoUnknownManual(manual);
    return halted;
  }
  const duplicateDirections = duplicatePrototypeGroups(state, "direction-candidate");
  if (duplicateDirections.length) {
    requireNoUnknownManual(manual);
    return stop(state, "blocked", "direction-diversity", duplicateDirections.map((ids) =>
      `direction candidates reuse a byte-identical self-contained prototype: ${ids.join(", ")}`));
  }

  ensureDirectionBrowserPackets(state);
  ingestKnownManual(state, manual);
  const directionBrowser = packetsOfStage(state, "browser-evidence")
    .filter((packet) => packet.design_task.subject_kind === "direction-candidate");
  runPackets(state, directionBrowser, hostManifest, selectors);
  halted = haltForPackets(state, "direction-browser-evidence", directionBrowser);
  if (halted) {
    requireNoUnknownManual(manual);
    return halted;
  }

  if (!state.packets.some((packet) => packet.packet_id === "direction-review")) {
    addPackets(state, [reviewPacket(state, "direction-review", recordsOfKind(state, "direction-candidate"))]);
  }
  ingestKnownManual(state, manual);
  const directionReview = [state.packets.find((packet) => packet.packet_id === "direction-review")];
  runPackets(state, directionReview, hostManifest, selectors);
  halted = haltForPackets(state, "direction-review", directionReview);
  if (halted) {
    requireNoUnknownManual(manual);
    return halted;
  }
  const eligibleDirections = eligibleDirectionIds(state);
  if (eligibleDirections.length < 3) {
    requireNoUnknownManual(manual);
    return stop(state, "blocked", "direction-review", [
      `fewer than three directions passed project-fit, beauty, trust, density, implementation, distinctiveness, redesign-depth, typography, responsiveness, and browser gates (${eligibleDirections.length}/3)`
    ]);
  }
  state.selection_scope_digest = selectionScope(state);
  writeState(state);
  if (!state.shortlist) {
    if (shortlistPath) ingestShortlist(state, shortlistPath);
    else {
      requireNoUnknownManual(manual);
      const template = writeSelectionTemplate(state);
      return stop(state, "manual_pending", "direction-selection", [], [
        `owner must shortlist exactly three eligible directions for ${state.selection_scope_digest}`,
        `copy and edit template: ${template}`
      ]);
    }
  }

  if (!state.packets.some((packet) => packet.stage_id === "color-system-generation")) {
    addPackets(state, colorPackets(state));
  }
  ingestKnownManual(state, manual);
  const colors = packetsOfStage(state, "color-system-generation");
  runPackets(state, colors, hostManifest, selectors);
  halted = haltForPackets(state, "color-generation", colors);
  if (halted) {
    requireNoUnknownManual(manual);
    return halted;
  }
  const duplicateColorPrototypes = duplicatePrototypeGroups(state, "color-candidate");
  const duplicatePalettes = duplicatePaletteGroups(state);
  if (duplicateColorPrototypes.length || duplicatePalettes.length) {
    requireNoUnknownManual(manual);
    return stop(state, "blocked", "color-diversity", [
      ...duplicateColorPrototypes.map((ids) =>
        `color candidates reuse a byte-identical self-contained prototype: ${ids.join(", ")}`),
      ...duplicatePalettes.map(({ designId, ids }) =>
        `color strategies emitted an identical palette for ${designId}: ${ids.join(", ")}`)
    ]);
  }

  ensureColorBrowserPackets(state);
  ingestKnownManual(state, manual);
  const colorBrowser = packetsOfStage(state, "browser-evidence")
    .filter((packet) => packet.design_task.subject_kind === "color-candidate");
  runPackets(state, colorBrowser, hostManifest, selectors);
  halted = haltForPackets(state, "color-browser-evidence", colorBrowser);
  if (halted) {
    requireNoUnknownManual(manual);
    return halted;
  }

  if (!state.packets.some((packet) => packet.packet_id === "color-review")) {
    addPackets(state, [reviewPacket(state, "color-review", recordsOfKind(state, "color-candidate"))]);
  }
  ingestKnownManual(state, manual);
  const colorReview = [state.packets.find((packet) => packet.packet_id === "color-review")];
  runPackets(state, colorReview, hostManifest, selectors);
  halted = haltForPackets(state, "color-review", colorReview);
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
    return stop(state, "blocked", "color-review", [
      `shortlisted directions lack an eligible accessible color system: ${missingColorDirection.join(", ")}`
    ]);
  }
  state.approval_scope_digest = approvalScope(state);
  writeState(state);
  if (!state.approval) {
    if (approvalPath) ingestApproval(state, approvalPath);
    else {
      requireNoUnknownManual(manual);
      const template = writeApprovalTemplate(state);
      return stop(state, "manual_pending", "owner-approval", [], [
        `owner approval is required for ${state.approval_scope_digest}`,
        `copy and edit template: ${template}`
      ]);
    }
  }
  requireNoUnknownManual(manual);
  if (state.approval.normalized.status === "rejected") {
    return stop(state, "blocked", "owner-approval", ["owner rejected the design exploration scope"]);
  }
  compileApprovedDirection(state);
  return stop(state, "complete", "complete", [], []);
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
  root = process.cwd()
}) {
  const absoluteState = path.resolve(statePath);
  requireValue(!fs.existsSync(absoluteState),
    `design state already exists; use --resume ${absoluteState}`);
  requireValue(!fs.existsSync(stateDirectory(absoluteState)),
    `design state directory already exists; recover it or choose another --out path`);
  const absoluteBrief = path.resolve(briefPath);
  const absoluteBaseline = path.resolve(baselinePath);
  validateStateLocation(absoluteState, absoluteBaseline);
  const brief = validateDesignBrief(readJson(absoluteBrief, "design brief"));
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
    brief_source: snapshotArtifact(absoluteBrief, { root }),
    baseline: snapshotArtifact(absoluteBaseline, { root }),
    packets: [],
    packet_files: {},
    results: [],
    attempts: [],
    shortlist: null,
    approval: null,
    selection_scope_digest: null,
    approval_scope_digest: null,
    outputs: {},
    final_receipt_digests: null,
    blockers: [],
    pending: [],
    state_digest: null
  });
  fs.mkdirSync(state.state_directory, { recursive: true });
  writeState(state);
  addPackets(state, directionPackets(state));
  return continueDesignExploration(state, {
    hostManifest, resultPaths, shortlistPath, approvalPath, retry
  });
}

export function resumeDesignExploration(statePath, options = {}) {
  const state = readDesignState(statePath);
  return continueDesignExploration(state, options);
}

function dryPacket(state, kind, providerId, capabilities, strength, permissions, suffix = "") {
  return makePacket(state, {
    packetId: `dry-${kind}-${providerId}${suffix}`.replace(/[^A-Za-z0-9._-]/g, "-"),
    stageId: kind === "color-candidate" ? "color-system-generation" : kind,
    providerId,
    capabilities,
    strength,
    permissions,
    viewports: kind === "browser-evidence" ? state.brief.evidence.required_viewports : [],
    checks: kind === "browser-evidence" ? state.brief.evidence.required_checks : [],
    task: { kind }
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
  const brief = validateDesignBrief(readJson(absoluteBrief, "design brief"));
  const state = {
    run_id: "dry-run",
    journey_identity: createJourneyIdentity({
      runId: "dry-run", routerId, routerVersion, invocation
    }),
    brief,
    brief_source: snapshotArtifact(absoluteBrief, { root }),
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
