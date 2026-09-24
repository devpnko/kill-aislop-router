import fs from "node:fs";
import path from "node:path";
import {
  canonicalDigest,
  DEFAULT_HASH_IGNORES,
  hashArtifact,
  readJsonPinned,
  snapshotArtifact
} from "./integrity.mjs";
import { isReservedParentIdentityAlias } from "./parent-identity.mjs";

const VALID_PHASES = new Set(["phase_1", "phase_2"]);
const VALID_GATE_STATUSES = new Set([
  "not_started",
  "in_progress",
  "pending",
  "passed",
  "approved",
  "blocked",
  "locked"
]);
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const BASELINE_LINEAGE_KEYS = new Set([
  "baseline_lineage_version",
  "lineage_id",
  "relationship",
  "parent_baseline",
  "candidate",
  "inheritance",
  "promotion",
  "lineage_digest"
]);
const PARENT_BASELINE_KEYS = new Set(["id", "version", "artifacts"]);
const SLICE_CANDIDATE_KEYS = new Set(["id", "version", "slice_id", "artifacts"]);
const LINEAGE_ARTIFACT_KEYS = new Set(["path", "digest"]);
const INHERITANCE_KEYS = new Set(["inherits", "slice_owned", "forbidden_parent_changes"]);
const PROMOTION_KEYS = new Set(["authority", "supersedes_parent"]);
const LINEAGE_OWNER_APPROVAL_KEYS = new Set([
  "status",
  "owner_id",
  "lineage_id",
  "baseline_lineage_digest",
  "decision_scope",
  "parent_promotion",
  "candidate",
  "decided_at",
  "note"
]);
const RFC3339_DATE_TIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const PLANNING_AUTHORITY_SOURCE_KEYS = new Set([
  "role",
  "gate",
  "evidence_kind",
  "declared_path",
  "resolved_path",
  "kind",
  "bytes",
  "digest",
  "physical_identity_digest"
]);

const GATE_CONTRACTS = {
  G6: {
    statuses: ["passed", "approved"],
    evidence_kinds: ["mockup"],
    purpose: "versioned all-scope mockup exists"
  },
  G6T: {
    statuses: ["passed", "approved"],
    evidence_kinds: ["audit-receipt"],
    purpose: "task, accessibility, and anti-slop checks passed"
  },
  G7: {
    statuses: ["approved"],
    evidence_kinds: ["approved-artifact", "owner-approval"],
    purpose: "the owner approved an exact artifact version"
  },
  G8: {
    statuses: ["passed", "approved"],
    evidence_kinds: ["implementation-contract"],
    purpose: "final data, API, event, migration, and system contracts are fixed"
  },
  G9A: {
    statuses: ["passed", "approved"],
    evidence_kinds: ["implementation"],
    purpose: "the runtime implementation exists"
  }
};

function uniqueRequirements(requirements) {
  const seen = new Set();
  return requirements.filter((requirement) => {
    if (seen.has(requirement.gate)) return false;
    seen.add(requirement.gate);
    return true;
  });
}

function requirementsForReceipt(requirements, receipt) {
  return uniqueRequirements([
    ...requirements,
    ...(receipt?.baseline_lineage !== undefined
      ? [{ gate: "G7", ...GATE_CONTRACTS.G7 }]
      : [])
  ]);
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, allowed, label, errors) {
  if (!objectValue(value)) {
    errors.push(`${label} must be an object`);
    return false;
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) errors.push(`${label} contains unsupported field: ${key}`);
  }
  return true;
}

function requiredString(value, label, errors) {
  if (typeof value !== "string" || value.length === 0) errors.push(`${label} must be a non-empty string`);
}

function uniqueStringArray(value, label, errors) {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push(`${label} must be a non-empty array`);
    return;
  }
  if (value.some((item) => typeof item !== "string" || item.length === 0)) {
    errors.push(`${label} must contain only non-empty strings`);
  }
  if (new Set(value).size !== value.length) errors.push(`${label} contains duplicate values`);
}

function validateArtifactSet(value, label, allowedKeys, { slice = false } = {}, errors) {
  if (!exactKeys(value, allowedKeys, label, errors)) return;
  requiredString(value.id, `${label}.id`, errors);
  requiredString(value.version, `${label}.version`, errors);
  if (slice) requiredString(value.slice_id, `${label}.slice_id`, errors);
  if (!Array.isArray(value.artifacts) || value.artifacts.length === 0) {
    errors.push(`${label}.artifacts must be a non-empty array`);
    return;
  }
  const paths = new Set();
  for (const [index, artifact] of value.artifacts.entries()) {
    const artifactLabel = `${label}.artifacts[${index}]`;
    if (!exactKeys(artifact, LINEAGE_ARTIFACT_KEYS, artifactLabel, errors)) continue;
    requiredString(artifact.path, `${artifactLabel}.path`, errors);
    if (!DIGEST_PATTERN.test(artifact.digest || "")) {
      errors.push(`${artifactLabel}.digest must be a sha256 digest`);
    }
    if (paths.has(artifact.path)) errors.push(`${label}.artifacts contains duplicate path: ${artifact.path}`);
    paths.add(artifact.path);
  }
}

function baselineLineageBody(lineage) {
  const { lineage_digest: _digest, ...body } = lineage;
  return body;
}

function baselineLineageShapeErrors(lineage, { requireDigest = false } = {}) {
  const errors = [];
  if (!exactKeys(lineage, BASELINE_LINEAGE_KEYS, "baseline_lineage", errors)) return errors;
  if (lineage.baseline_lineage_version !== 1) errors.push("baseline_lineage_version must be 1");
  requiredString(lineage.lineage_id, "baseline_lineage.lineage_id", errors);
  if (lineage.relationship !== "slice-of") {
    errors.push("baseline_lineage.relationship must be slice-of");
  }
  validateArtifactSet(
    lineage.parent_baseline,
    "baseline_lineage.parent_baseline",
    PARENT_BASELINE_KEYS,
    {},
    errors
  );
  validateArtifactSet(
    lineage.candidate,
    "baseline_lineage.candidate",
    SLICE_CANDIDATE_KEYS,
    { slice: true },
    errors
  );
  if (lineage.parent_baseline?.id && lineage.parent_baseline.id === lineage.candidate?.id) {
    errors.push("baseline_lineage parent and candidate ids must be distinct");
  }
  if (exactKeys(lineage.inheritance, INHERITANCE_KEYS, "baseline_lineage.inheritance", errors)) {
    uniqueStringArray(lineage.inheritance.inherits, "baseline_lineage.inheritance.inherits", errors);
    uniqueStringArray(lineage.inheritance.slice_owned, "baseline_lineage.inheritance.slice_owned", errors);
    uniqueStringArray(
      lineage.inheritance.forbidden_parent_changes,
      "baseline_lineage.inheritance.forbidden_parent_changes",
      errors
    );
    const inherited = new Set(lineage.inheritance.inherits || []);
    const ambiguous = (lineage.inheritance.slice_owned || []).filter((item) => inherited.has(item));
    if (ambiguous.length) {
      errors.push(`baseline_lineage cannot both inherit and own: ${ambiguous.join(", ")}`);
    }
  }
  if (exactKeys(lineage.promotion, PROMOTION_KEYS, "baseline_lineage.promotion", errors)) {
    if (lineage.promotion.authority !== "explicit-owner-only") {
      errors.push("baseline_lineage.promotion.authority must be explicit-owner-only");
    }
    if (lineage.promotion.supersedes_parent !== false) {
      errors.push("baseline_lineage slice candidates cannot supersede the parent baseline");
    }
  }
  if (requireDigest && !DIGEST_PATTERN.test(lineage.lineage_digest || "")) {
    errors.push("baseline_lineage.lineage_digest must be a sha256 digest");
  }
  if (Object.hasOwn(lineage, "lineage_digest")) {
    if (!DIGEST_PATTERN.test(lineage.lineage_digest || "")) {
      errors.push("baseline_lineage.lineage_digest must be a sha256 digest when supplied");
    } else if (canonicalDigest(baselineLineageBody(lineage)) !== lineage.lineage_digest) {
      errors.push("baseline_lineage.lineage_digest mismatch");
    }
  }
  return errors;
}

export function verifyBaselineLineage(lineage, label = "baseline_lineage") {
  const errors = baselineLineageShapeErrors(lineage, { requireDigest: true });
  if (errors.length) throw new Error(`${label} verification failed: ${errors.join("; ")}`);
  return lineage;
}

export function baselineLineagesMatch(left, right) {
  if (!left || !right) return left === right;
  return left.lineage_digest === right.lineage_digest &&
    canonicalDigest(left) === canonicalDigest(right);
}

function planningAuthorityProjection(planning) {
  if (!planning) return null;
  const projected = {
    enabled: planning.enabled === true,
    policy_required: planning.policy_required === true,
    enforced: planning.enforced === true,
    status: planning.status || null,
    protocol: planning.protocol || null,
    phase: planning.phase || null,
    scope_id: planning.scope_id || null,
    receipt_path: planning.receipt_path || null,
    receipt_digest: planning.receipt_digest || null,
    planning_authority_version: planning.planning_authority_version || null,
    authority_sources: planning.authority_sources || [],
    gate_statuses: planning.gate_statuses || {},
    requirements: planning.requirements || []
  };
  if (planning.lineage_required === true) projected.lineage_required = true;
  if (planning.baseline_lineage) projected.baseline_lineage = planning.baseline_lineage;
  return projected;
}

function planningAuthoritySource({
  role,
  snapshot,
  declaredPath,
  gate = null,
  evidenceKind = null
}) {
  return {
    role,
    gate,
    evidence_kind: evidenceKind,
    declared_path: declaredPath,
    resolved_path: path.resolve(snapshot.resolved_path),
    kind: snapshot.kind,
    bytes: snapshot.bytes ?? null,
    digest: snapshot.digest,
    physical_identity_digest: snapshot.physical_identity_digest
  };
}

function sortedPlanningAuthoritySources(sources) {
  return [...sources].sort((left, right) => canonicalDigest({
    role: left.role,
    gate: left.gate,
    evidence_kind: left.evidence_kind,
    declared_path: left.declared_path,
    resolved_path: left.resolved_path
  }).localeCompare(canonicalDigest({
    role: right.role,
    gate: right.gate,
    evidence_kind: right.evidence_kind,
    declared_path: right.declared_path,
    resolved_path: right.resolved_path
  })));
}

function planningAuthoritySourceErrors(source, label) {
  const errors = [];
  if (!objectValue(source)) return [`${label} must be an object`];
  for (const key of Object.keys(source)) {
    if (!PLANNING_AUTHORITY_SOURCE_KEYS.has(key)) {
      errors.push(`${label} contains unsupported field: ${key}`);
    }
  }
  if (!["planning-receipt", "gate-evidence", "parent-baseline", "candidate-slice"].includes(source.role)) {
    errors.push(`${label}.role is invalid`);
  }
  if (source.gate !== null && (typeof source.gate !== "string" || source.gate.length === 0)) {
    errors.push(`${label}.gate must be null or a non-empty string`);
  }
  if (source.evidence_kind !== null &&
    (typeof source.evidence_kind !== "string" || source.evidence_kind.length === 0)) {
    errors.push(`${label}.evidence_kind must be null or a non-empty string`);
  }
  for (const key of ["declared_path", "resolved_path"]) {
    if (typeof source[key] !== "string" || source[key].length === 0) {
      errors.push(`${label}.${key} must be a non-empty string`);
    }
  }
  if (!path.isAbsolute(source.resolved_path || "")) {
    errors.push(`${label}.resolved_path must be absolute`);
  }
  if (!["file", "directory"].includes(source.kind)) errors.push(`${label}.kind is invalid`);
  if (source.kind === "file" && (!Number.isInteger(source.bytes) || source.bytes < 0)) {
    errors.push(`${label}.bytes must be a non-negative integer for a file`);
  }
  if (source.kind === "directory" && source.bytes !== null) {
    errors.push(`${label}.bytes must be null for a directory`);
  }
  if (!DIGEST_PATTERN.test(source.digest || "")) errors.push(`${label}.digest is invalid`);
  if (!DIGEST_PATTERN.test(source.physical_identity_digest || "")) {
    errors.push(`${label}.physical_identity_digest is invalid`);
  }
  return errors;
}

function comparePlanningAuthoritySources(planning, evaluated, errors) {
  if (planning.planning_authority_version !== 1) {
    errors.push("planning authority is missing its physical source contract; generate a new route plan");
    return;
  }
  if (!Array.isArray(planning.authority_sources) || !Array.isArray(evaluated.authoritySources)) {
    errors.push("planning authority source inventory is missing; generate a new route plan");
    return;
  }
  const expected = sortedPlanningAuthoritySources(planning.authority_sources);
  const actual = sortedPlanningAuthoritySources(evaluated.authoritySources);
  expected.forEach((source, index) => errors.push(
    ...planningAuthoritySourceErrors(source, `planning authority source[${index}]`)
  ));
  if (expected.length !== actual.length) {
    errors.push("planning authority source set changed after route planning");
    return;
  }
  for (let index = 0; index < expected.length; index += 1) {
    const left = expected[index];
    const right = actual[index];
    const identity = ["role", "gate", "evidence_kind", "declared_path", "resolved_path", "kind", "bytes"];
    if (identity.some((key) => left[key] !== right[key])) {
      errors.push("planning authority source identity or path changed after route planning");
      continue;
    }
    if (left.digest !== right.digest) {
      errors.push(`planning authority source content changed after route planning: ${left.declared_path}`);
      continue;
    }
    if (left.physical_identity_digest !== right.physical_identity_digest) {
      errors.push(`planning authority source physical identity changed after route planning: ${left.declared_path}`);
    }
  }
}

export function planningAuthoritiesMatch(left, right) {
  return canonicalDigest(planningAuthorityProjection(left)) ===
    canonicalDigest(planningAuthorityProjection(right));
}

function pathIsInside(candidate, boundary) {
  const relative = path.relative(path.resolve(boundary), path.resolve(candidate));
  return relative === "" || (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function rejectControlledSymlinkComponents(absolute, boundary, label) {
  const resolvedBoundary = path.resolve(boundary);
  const resolvedAbsolute = path.resolve(absolute);
  const boundaryStat = fs.lstatSync(resolvedBoundary);
  if (boundaryStat.isSymbolicLink()) {
    throw new Error(`${label} project authority root must not be a symlink: ${resolvedBoundary}`);
  }
  const canonicalBoundary = fs.realpathSync.native(resolvedBoundary);
  const canonicalAbsolute = fs.realpathSync.native(resolvedAbsolute);
  if (!pathIsInside(canonicalAbsolute, canonicalBoundary)) {
    throw new Error(`${label} escapes the project authority root: ${canonicalBoundary}`);
  }
  let cursor = resolvedAbsolute;
  while (true) {
    if (fs.lstatSync(cursor).isSymbolicLink()) {
      throw new Error(`${label} contains an unsupported symlink component: ${cursor}`);
    }
    if (fs.realpathSync.native(cursor) === canonicalBoundary) break;
    const parent = path.dirname(cursor);
    if (parent === cursor) {
      throw new Error(`${label} cannot be traced to the project authority root: ${canonicalBoundary}`);
    }
    cursor = parent;
  }
}

function physicalIdentitySet(absolute) {
  const identities = new Set();
  const visit = (current) => {
    const lstat = fs.lstatSync(current);
    if (lstat.isSymbolicLink()) {
      throw new Error(`symlink artifacts are unsupported: ${current}`);
    }
    const stat = fs.statSync(current, { bigint: true });
    if (!lstat.isDirectory() && stat.nlink > 1n) {
      throw new Error(`hard-linked artifacts are unsupported: ${current}`);
    }
    identities.add(`${stat.dev}:${stat.ino}`);
    if (!lstat.isDirectory()) return;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (DEFAULT_HASH_IGNORES.has(entry.name)) continue;
      visit(path.join(current, entry.name));
    }
  };
  visit(absolute);
  return identities;
}

function identitiesOverlap(left, right) {
  for (const identity of left) {
    if (right.has(identity)) return true;
  }
  return false;
}

function resolvePhysicalArtifact(absolute, boundary, label) {
  if (fs.lstatSync(absolute).isSymbolicLink()) {
    throw new Error(`${label} must not be a symlink`);
  }
  rejectControlledSymlinkComponents(absolute, boundary, label);
  const canonical = fs.realpathSync.native(absolute);
  const snapshot = snapshotArtifact(canonical, { root: boundary });
  return {
    absolute: canonical,
    digest: snapshot.digest,
    physical_identity_digest: snapshot.physical_identity_digest,
    identities: physicalIdentitySet(canonical),
    snapshot
  };
}

function readPinnedPlanningJson(absolute, boundary, label, faultInjector = null) {
  return readJsonPinned(absolute, {
    label,
    faultInjector,
    securePath(target, secureLabel) {
      const resolved = path.resolve(target);
      rejectControlledSymlinkComponents(resolved, boundary, secureLabel);
      const canonicalBoundary = fs.realpathSync.native(path.resolve(boundary));
      const canonical = fs.realpathSync.native(resolved);
      if (!pathIsInside(canonical, canonicalBoundary)) {
        throw new Error(`${secureLabel} escapes the project authority root: ${canonicalBoundary}`);
      }
      return canonical;
    }
  });
}

function resolveLineageArtifacts(artifactSet, receiptPath, authorityRoot, label, errors) {
  const resolved = [];
  for (const artifact of artifactSet?.artifacts || []) {
    const absolute = path.isAbsolute(artifact.path)
      ? path.resolve(artifact.path)
      : path.resolve(path.dirname(receiptPath), artifact.path);
    if (!fs.existsSync(absolute)) {
      errors.push(`${label} artifact is missing: ${artifact.path}`);
      continue;
    }
    try {
      const physical = resolvePhysicalArtifact(
        absolute,
        authorityRoot,
        `${label} artifact ${artifact.path}`
      );
      if (physical.digest !== artifact.digest) {
        errors.push(`${label} artifact digest changed: ${artifact.path}`);
      }
      for (const previous of resolved) {
        if (pathsOverlap(previous.absolute, physical.absolute) ||
          pathsOverlap(physical.absolute, previous.absolute) ||
          identitiesOverlap(previous.identities, physical.identities)) {
          errors.push(`${label} contains physically overlapping artifacts: ${previous.path} <> ${artifact.path}`);
        }
      }
      resolved.push({
        absolute: physical.absolute,
        digest: artifact.digest,
        physical_identity_digest: physical.physical_identity_digest,
        identities: physical.identities,
        path: artifact.path,
        snapshot: physical.snapshot
      });
    } catch (error) {
      errors.push(`${label} artifact cannot be verified: ${artifact.path} (${error.message})`);
    }
  }
  return resolved;
}

function pathsOverlap(left, right) {
  const relative = path.relative(left, right);
  return relative === "" || (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function routeArtifactSet(artifacts, root, errors) {
  const resolved = [];
  for (const [index, artifact] of (artifacts || []).entries()) {
    const snapshot = artifact?.resolved_path && artifact?.digest ? artifact : null;
    if (!snapshot && (typeof artifact !== "string" || artifact.length === 0)) {
      errors.push(`route artifact ${index + 1} is invalid`);
      continue;
    }
    const declared = snapshot ? snapshot.resolved_path : artifact;
    const absolute = snapshot
      ? path.resolve(snapshot.resolved_path)
      : path.resolve(root, artifact);
    if (!fs.existsSync(absolute)) {
      errors.push(`route artifact is missing: ${declared}`);
      continue;
    }
    try {
      const physical = resolvePhysicalArtifact(absolute, root, `route artifact ${declared}`);
      for (const previous of resolved) {
        if (pathsOverlap(previous.absolute, physical.absolute) ||
          pathsOverlap(physical.absolute, previous.absolute) ||
          identitiesOverlap(previous.identities, physical.identities)) {
          errors.push(`route contains physically overlapping artifacts: ${previous.declared} <> ${declared}`);
        }
      }
      resolved.push({
        absolute: physical.absolute,
        digest: snapshot ? snapshot.digest : physical.digest,
        physical_identity_digest: physical.physical_identity_digest,
        identities: physical.identities,
        declared
      });
      if (snapshot?.physical_identity_digest &&
        snapshot.physical_identity_digest !== physical.physical_identity_digest) {
        errors.push(`route artifact physical identity changed: ${declared}`);
      }
    } catch (error) {
      errors.push(`route artifact cannot be verified: ${declared} (${error.message})`);
    }
  }
  return resolved;
}

function evaluateBaselineLineage(receipt, receiptPath, { artifacts = null, root = process.cwd() } = {}) {
  if (receipt?.baseline_lineage === undefined) {
    return { lineage: null, parentArtifacts: [], candidateArtifacts: [], errors: [] };
  }
  const source = receipt.baseline_lineage;
  const errors = baselineLineageShapeErrors(source);
  if (errors.length) return { lineage: null, parentArtifacts: [], candidateArtifacts: [], errors };

  const authorityRoot = path.resolve(root);
  try {
    rejectControlledSymlinkComponents(
      path.resolve(receiptPath),
      authorityRoot,
      "baseline_lineage planning receipt"
    );
  } catch (error) {
    errors.push(error.message);
  }

  const normalized = structuredClone(baselineLineageBody(source));
  normalized.lineage_digest = canonicalDigest(normalized);
  if (Object.hasOwn(source, "lineage_digest") &&
    source.lineage_digest !== normalized.lineage_digest) {
    errors.push("baseline_lineage.lineage_digest mismatch");
  }
  if (source.candidate?.slice_id && receipt.scope_id &&
    source.candidate.slice_id !== receipt.scope_id) {
    errors.push("baseline_lineage.candidate.slice_id must match the planning receipt scope_id");
  }
  const parent = resolveLineageArtifacts(
    source.parent_baseline,
    receiptPath,
    authorityRoot,
    "baseline_lineage.parent_baseline",
    errors
  );
  const candidate = resolveLineageArtifacts(
    source.candidate,
    receiptPath,
    authorityRoot,
    "baseline_lineage.candidate",
    errors
  );
  for (const parentArtifact of parent) {
    for (const candidateArtifact of candidate) {
      if (pathsOverlap(parentArtifact.absolute, candidateArtifact.absolute) ||
        pathsOverlap(candidateArtifact.absolute, parentArtifact.absolute) ||
        identitiesOverlap(parentArtifact.identities, candidateArtifact.identities)) {
        errors.push(
          "baseline_lineage parent and candidate artifacts must be physically separate, non-nested paths: " +
          `${parentArtifact.path} <> ${candidateArtifact.path}`
        );
      }
    }
  }

  if (artifacts !== null) {
    const routed = routeArtifactSet(artifacts, root, errors);
    if (!routed.length) {
      errors.push("baseline_lineage requires the exact slice candidate artifacts in the route");
    } else {
      const expected = new Map(candidate.map((item) => [item.absolute, item.digest]));
      const actual = new Map(routed.map((item) => [item.absolute, item.digest]));
      for (const [absolute, digest] of expected) {
        if (!actual.has(absolute)) {
          errors.push(`route is missing baseline_lineage candidate artifact: ${absolute}`);
        } else if (actual.get(absolute) !== digest) {
          errors.push(`route candidate artifact digest conflicts with baseline_lineage: ${absolute}`);
        }
      }
      for (const absolute of actual.keys()) {
        if (!expected.has(absolute)) {
          errors.push(`route contains artifact outside baseline_lineage candidate scope: ${absolute}`);
        }
      }
    }
  }
  return {
    lineage: errors.length ? null : normalized,
    parentArtifacts: parent,
    candidateArtifacts: candidate,
    errors
  };
}

export function planningRequirements(input, scope = input?.scope || null) {
  if (input?.task === "systemize") {
    return ["G6T", "G7"].map((gate) => ({ gate, ...GATE_CONTRACTS[gate] }));
  }
  if (input?.task === "runtime-handoff") {
    return ["G7", "G8"].map((gate) => ({ gate, ...GATE_CONTRACTS[gate] }));
  }
  if (input?.task === "audit" && scope === "mockup") {
    return [{ gate: "G6", ...GATE_CONTRACTS.G6 }];
  }
  if (input?.task === "audit" && scope === "runtime") {
    return ["G7", "G8", "G9A"].map((gate) => ({ gate, ...GATE_CONTRACTS[gate] }));
  }
  return [];
}

function validateReceipt(receipt, expectedProjectId, expectedSurface) {
  const errors = [];
  if (receipt?.planning_gate_version !== 1) errors.push("planning_gate_version must be 1");
  if (!receipt?.protocol?.id || !receipt?.protocol?.version || !receipt?.protocol?.authority) {
    errors.push("protocol id, version, and authority are required");
  }
  if (!receipt?.project_id) errors.push("project_id is required");
  if (expectedProjectId && receipt?.project_id !== expectedProjectId) {
    errors.push(`project_id mismatch: expected ${expectedProjectId}, received ${receipt?.project_id || "missing"}`);
  }
  if (!receipt?.surface) errors.push("surface is required");
  if (expectedSurface && receipt?.surface !== expectedSurface) {
    errors.push(`surface mismatch: expected ${expectedSurface}, received ${receipt?.surface || "missing"}`);
  }
  if (!receipt?.scope_id) errors.push("scope_id is required");
  if (!VALID_PHASES.has(receipt?.phase)) errors.push("phase must be phase_1 or phase_2");
  if (!receipt?.updated_at || Number.isNaN(Date.parse(receipt.updated_at))) {
    errors.push("updated_at must be a valid timestamp");
  }
  if (!receipt?.gates || typeof receipt.gates !== "object" || Array.isArray(receipt.gates)) {
    errors.push("gates must be an object");
    return errors;
  }
  for (const [gateId, gate] of Object.entries(receipt.gates)) {
    if (!gate || typeof gate !== "object" || Array.isArray(gate)) {
      errors.push(`${gateId} must be an object`);
      continue;
    }
    if (!VALID_GATE_STATUSES.has(gate.status)) errors.push(`${gateId} has an invalid status`);
    if (gate.evidence !== undefined && !Array.isArray(gate.evidence)) {
      errors.push(`${gateId}.evidence must be an array`);
      continue;
    }
    for (const [index, evidence] of (gate.evidence || []).entries()) {
      if (!evidence?.kind || !evidence?.path || !DIGEST_PATTERN.test(evidence?.digest || "")) {
        errors.push(`${gateId}.evidence[${index}] requires kind, path, and a sha256 digest`);
      }
    }
  }
  return errors;
}

function sameArtifactSet(left, right) {
  if (left.length !== right.length) return false;
  const expected = new Map(left.map((item) => [item.absolute, item.digest]));
  const actual = new Map(right.map((item) => [item.absolute, item.digest]));
  return expected.size === left.length && actual.size === right.length &&
    [...expected].every(([absolute, digest]) => actual.get(absolute) === digest);
}

function verifyLineageOwnerApproval(approval, lineage) {
  const errors = [];
  if (!exactKeys(
    approval,
    LINEAGE_OWNER_APPROVAL_KEYS,
    "G7 owner-approval evidence",
    errors
  )) return errors;
  if (approval.status !== "approved") {
    errors.push("G7 owner-approval evidence is not an explicit approved owner decision");
  }
  requiredString(approval.owner_id, "G7 owner-approval evidence.owner_id", errors);
  if (isReservedParentIdentityAlias(approval.owner_id)) {
    errors.push("G7 owner-approval evidence.owner_id cannot use the KillSlopRouter parent identity");
  }
  requiredString(approval.lineage_id, "G7 owner-approval evidence.lineage_id", errors);
  if (!DIGEST_PATTERN.test(approval.baseline_lineage_digest || "")) {
    errors.push("G7 owner-approval evidence.baseline_lineage_digest must be a sha256 digest");
  }
  if (typeof approval.decided_at !== "string" ||
    !RFC3339_DATE_TIME.test(approval.decided_at) ||
    Number.isNaN(Date.parse(approval.decided_at))) {
    errors.push("G7 owner-approval evidence.decided_at must be an RFC3339 date-time");
  }
  if (approval.note !== undefined && typeof approval.note !== "string") {
    errors.push("G7 owner-approval evidence.note must be a string");
  }
  validateArtifactSet(
    approval.candidate,
    "G7 owner-approval evidence.candidate",
    SLICE_CANDIDATE_KEYS,
    { slice: true },
    errors
  );
  if (approval.lineage_id !== lineage.lineage_id) {
    errors.push("G7 owner-approval evidence does not bind the baseline_lineage lineage_id");
  }
  if (approval.baseline_lineage_digest !== lineage.lineage_digest) {
    errors.push("G7 owner-approval evidence does not bind the exact baseline_lineage digest");
  }
  if (approval.decision_scope !== "candidate-slice-binding") {
    errors.push("G7 owner-approval evidence must be limited to candidate-slice-binding");
  }
  if (approval.parent_promotion !== false) {
    errors.push("G7 owner-approval evidence cannot promote or replace the parent baseline");
  }
  if (canonicalDigest(approval.candidate || null) !== canonicalDigest(lineage.candidate)) {
    errors.push("G7 owner-approval evidence does not bind the exact lineage candidate");
  }
  return errors;
}

function verifyLineageG7({
  evidence,
  receiptPath,
  authorityRoot,
  lineage,
  candidateArtifacts,
  pinnedJsonEvidence,
  faultInjector = null
}) {
  if (!lineage) return [];
  const errors = [];
  const approvedArtifacts = [];
  const ownerApprovals = [];
  for (const item of evidence) {
    if (!["approved-artifact", "owner-approval"].includes(item.kind)) continue;
    const evidencePath = path.isAbsolute(item.path)
      ? path.resolve(item.path)
      : path.resolve(path.dirname(receiptPath), item.path);
    try {
      if (item.kind === "owner-approval") {
        const cacheKey = path.resolve(evidencePath);
        const pinned = pinnedJsonEvidence.get(cacheKey) || readPinnedPlanningJson(
          evidencePath,
          authorityRoot,
          `G7 owner-approval evidence ${item.path}`,
          faultInjector
        );
        pinnedJsonEvidence.set(cacheKey, pinned);
        pinnedJsonEvidence.set(pinned.path, pinned);
        if (pinned.digest === item.digest) ownerApprovals.push(pinned.input);
        continue;
      }
      const physical = resolvePhysicalArtifact(
        evidencePath,
        authorityRoot,
        `G7 ${item.kind} evidence ${item.path}`
      );
      if (physical.digest !== item.digest) continue;
      approvedArtifacts.push({ absolute: physical.absolute, digest: item.digest });
    } catch (error) {
      errors.push(`G7 ${item.kind} evidence cannot bind the lineage candidate: ${item.path} (${error.message})`);
    }
  }
  if (!sameArtifactSet(candidateArtifacts, approvedArtifacts)) {
    errors.push("G7 approved-artifact evidence must exactly match the baseline_lineage candidate artifact set");
  }
  if (!ownerApprovals.length) {
    errors.push("G7 requires owner-approval evidence bound to the exact baseline_lineage candidate");
  }
  for (const approval of ownerApprovals) {
    errors.push(...verifyLineageOwnerApproval(approval, lineage));
  }
  return errors;
}

function verifyRequiredGate(
  receipt,
  receiptPath,
  requirement,
  {
    lineage = null,
    candidateArtifacts = [],
    root = process.cwd(),
    pinnedJsonEvidence = new Map(),
    authoritySources = [],
    faultInjector = null
  } = {}
) {
  const errors = [];
  const gate = receipt.gates?.[requirement.gate];
  if (!gate) return [`${requirement.gate} is missing (${requirement.purpose})`];
  if (!requirement.statuses.includes(gate.status)) {
    errors.push(
      `${requirement.gate} must be ${requirement.statuses.join(" or ")}; current status is ${gate.status}`
    );
  }
  const evidence = gate.evidence || [];
  const evidenceKinds = new Set(evidence.map((item) => item.kind));
  for (const kind of requirement.evidence_kinds) {
    if (!evidenceKinds.has(kind)) errors.push(`${requirement.gate} is missing ${kind} evidence`);
  }
  for (const item of evidence) {
    const evidencePath = path.isAbsolute(item.path)
      ? item.path
      : path.resolve(path.dirname(receiptPath), item.path);
    if (!fs.existsSync(evidencePath)) {
      errors.push(`${requirement.gate} evidence is missing: ${item.path}`);
      continue;
    }
    try {
      let digest;
      let pinnedOwnerApproval = null;
      let physicalEvidence = null;
      if (item.kind === "owner-approval") {
        const authorityRoot = path.resolve(root);
        pinnedOwnerApproval = readPinnedPlanningJson(
          evidencePath,
          authorityRoot,
          `${requirement.gate} owner-approval evidence ${item.path}`,
          faultInjector
        );
        pinnedJsonEvidence.set(path.resolve(evidencePath), pinnedOwnerApproval);
        pinnedJsonEvidence.set(pinnedOwnerApproval.path, pinnedOwnerApproval);
        digest = pinnedOwnerApproval.digest;
      } else {
        physicalEvidence = resolvePhysicalArtifact(
          evidencePath,
          path.resolve(root),
          `${requirement.gate} ${item.kind} evidence ${item.path}`
        );
        digest = physicalEvidence.digest;
      }
      if (digest !== item.digest) {
        errors.push(`${requirement.gate} evidence digest changed: ${item.path}`);
        continue;
      }
      authoritySources.push(planningAuthoritySource({
        role: "gate-evidence",
        snapshot: pinnedOwnerApproval?.source_snapshot || physicalEvidence.snapshot,
        declaredPath: item.path,
        gate: requirement.gate,
        evidenceKind: item.kind
      }));
      if (item.kind === "owner-approval") {
        try {
          const approval = pinnedOwnerApproval.input;
          const ownerId = approval.owner_id || approval.owner_approval?.owner_id;
          if (approval.status !== "approved" || !ownerId) {
            errors.push(`${requirement.gate} owner-approval evidence is not an explicit approved owner decision`);
          } else if (isReservedParentIdentityAlias(ownerId)) {
            errors.push(`${requirement.gate} owner-approval evidence.owner_id cannot use the KillSlopRouter parent identity`);
          }
        } catch (error) {
          errors.push(
            `${requirement.gate} owner-approval evidence cannot be verified: ` +
            `${item.path} (${error.message})`
          );
        }
      }
    } catch (error) {
      errors.push(`${requirement.gate} evidence cannot be verified: ${item.path} (${error.message})`);
    }
  }
  if (requirement.gate === "G7" && lineage) {
    errors.push(...verifyLineageG7({
      evidence,
      receiptPath,
      authorityRoot: path.resolve(root),
      lineage,
      candidateArtifacts,
      pinnedJsonEvidence,
      faultInjector
    }));
  }
  return errors;
}

function evaluateReceipt({
  receiptPath,
  expectedDigest = null,
  projectId,
  surface,
  requirements,
  artifacts = null,
  root = process.cwd(),
  faultInjector = null
}) {
  const errors = [];
  const authoritySources = [];
  if (!fs.existsSync(receiptPath)) {
    return {
      receipt: null,
      digest: null,
      baselineLineage: null,
      authoritySources,
      requirements,
      errors: [`planning receipt not found: ${receiptPath}`]
    };
  }
  let digest;
  let receipt;
  try {
    const pinned = readJsonPinned(receiptPath, {
      label: "planning receipt",
      faultInjector
    });
    digest = pinned.digest;
    receipt = pinned.input;
    authoritySources.push(planningAuthoritySource({
      role: "planning-receipt",
      snapshot: pinned.source_snapshot,
      declaredPath: receiptPath
    }));
  } catch (error) {
    return {
      receipt: null,
      digest: null,
      baselineLineage: null,
      authoritySources,
      requirements,
      errors: [`cannot read planning receipt: ${error.message}`]
    };
  }
  if (expectedDigest && digest !== expectedDigest) {
    errors.push("planning receipt changed after route planning; generate a new route plan");
  }
  errors.push(...validateReceipt(receipt, projectId, surface));
  const lineage = evaluateBaselineLineage(receipt, receiptPath, { artifacts, root });
  errors.push(...lineage.errors);
  for (const artifact of lineage.parentArtifacts) {
    authoritySources.push(planningAuthoritySource({
      role: "parent-baseline",
      snapshot: artifact.snapshot,
      declaredPath: artifact.path
    }));
  }
  for (const artifact of lineage.candidateArtifacts) {
    authoritySources.push(planningAuthoritySource({
      role: "candidate-slice",
      snapshot: artifact.snapshot,
      declaredPath: artifact.path
    }));
  }
  const effectiveRequirements = requirementsForReceipt(requirements, receipt);
  if (!errors.length) {
    const pinnedJsonEvidence = new Map();
    for (const requirement of effectiveRequirements) {
      errors.push(...verifyRequiredGate(receipt, receiptPath, requirement, {
        lineage: lineage.lineage,
        candidateArtifacts: lineage.candidateArtifacts,
        root,
        pinnedJsonEvidence,
        authoritySources,
        faultInjector
      }));
    }
  }
  return {
    receipt,
    digest,
    baselineLineage: lineage.lineage,
    authoritySources: sortedPlanningAuthoritySources(authoritySources),
    requirements: effectiveRequirements,
    errors
  };
}

function selectReceipt(profile, profilePath, surface) {
  const planning = profile?.planning;
  if (!planning) return null;
  const configured = planning.surface_receipts?.[surface] || planning.receipt || null;
  if (!configured) return null;
  const base = profilePath ? path.dirname(path.resolve(profilePath)) : process.cwd();
  return path.isAbsolute(configured) ? configured : path.resolve(base, configured);
}

export function resolvePlanningGate({
  profile,
  profilePath = null,
  input,
  artifacts = [],
  root = process.cwd(),
  faultInjector = null
}) {
  const configured = Boolean(profile?.planning);
  const intrinsicallyRequired = input.task === "systemize";
  const requestedRequirements = planningRequirements(input);
  const policyRequired = profile?.planning?.required === true;
  const enforced = intrinsicallyRequired || (policyRequired && requestedRequirements.length > 0);

  if (!configured && !intrinsicallyRequired) {
    return {
      enabled: false,
      policy_required: false,
      enforced: false,
      status: "not-configured",
      requirements: [],
      unresolved: [],
      warnings: []
    };
  }

  const receiptPath = selectReceipt(profile, profilePath, input.surface);
  if (!receiptPath) {
    const message = `no planning receipt is configured for ${input.surface}`;
    return {
      enabled: configured,
      policy_required: policyRequired,
      enforced,
      status: enforced ? "blocked" : "not-configured",
      requirements: requestedRequirements,
      receipt_path: null,
      receipt_digest: null,
      gate_statuses: {},
      unresolved: enforced ? [message] : [],
      warnings: enforced ? [] : [message]
    };
  }

  const evaluated = evaluateReceipt({
    receiptPath,
    projectId: profile?.project_id || null,
    surface: input.surface,
    requirements: requestedRequirements,
    artifacts,
    root,
    faultInjector
  });
  const requirements = evaluated.requirements;
  const failures = evaluated.errors;
  const lineageRequired = evaluated.receipt?.baseline_lineage !== undefined;
  const effectiveEnforced = enforced || lineageRequired;
  const gateStatuses = Object.fromEntries(
    Object.entries(evaluated.receipt?.gates || {}).map(([gate, value]) => [gate, value.status])
  );
  const resolved = {
    enabled: true,
    policy_required: policyRequired,
    enforced: effectiveEnforced,
    status: failures.length ? (effectiveEnforced ? "blocked" : "observed_with_findings") : "ready",
    protocol: evaluated.receipt?.protocol || null,
    phase: evaluated.receipt?.phase || null,
    scope_id: evaluated.receipt?.scope_id || null,
    receipt_path: receiptPath,
    receipt_digest: evaluated.digest,
    planning_authority_version: 1,
    authority_sources: evaluated.authoritySources,
    gate_statuses: gateStatuses,
    requirements,
    unresolved: effectiveEnforced ? failures : [],
    warnings: effectiveEnforced ? [] : failures
  };
  if (lineageRequired) resolved.lineage_required = true;
  if (!failures.length && evaluated.baselineLineage) {
    resolved.baseline_lineage = evaluated.baselineLineage;
  }
  return resolved;
}

export function verifyPlanningGateForAudit(plan, scope, {
  artifacts = null,
  root = process.cwd()
} = {}) {
  const planning = plan?.planning_gate;
  const requestedRequirements = uniqueRequirements([
    ...(planning?.requirements || []),
    ...planningRequirements(plan.input, scope)
  ]);
  const enforced = Boolean(planning?.baseline_lineage || planning?.lineage_required) ||
    plan?.input?.task === "systemize" || (
    planning?.policy_required === true && requestedRequirements.length > 0
  );
  if (!planning?.enabled && !enforced) return planning || null;
  const canVerifyConfiguredReceipt = Boolean(planning?.receipt_path && planning?.receipt_digest);
  if (!enforced && !canVerifyConfiguredReceipt) return planning || null;
  if (!planning?.receipt_path || !planning.receipt_digest) {
    throw new Error("the route plan has no verifiable planning receipt");
  }
  const evaluated = evaluateReceipt({
    receiptPath: planning.receipt_path,
    expectedDigest: planning.receipt_digest,
    projectId: plan.project_id,
    surface: plan.input?.surface,
    requirements: requestedRequirements,
    artifacts,
    root
  });
  const requirements = evaluated.requirements;
  const receiptDeclaresLineage = evaluated.receipt?.baseline_lineage !== undefined;
  const authorityErrors = [];
  comparePlanningAuthoritySources(planning, evaluated, authorityErrors);
  if (!enforced && !receiptDeclaresLineage) {
    if (authorityErrors.length) {
      throw new Error(`planning gate verification failed: ${authorityErrors.join("; ")}`);
    }
    return planning;
  }
  if (!baselineLineagesMatch(planning.baseline_lineage || null, evaluated.baselineLineage || null)) {
    evaluated.errors.push("planning baseline_lineage changed after route planning");
  }
  if (evaluated.baselineLineage && artifacts === null) {
    evaluated.errors.push("baseline_lineage verification requires the exact routed artifacts");
  }
  const verificationErrors = [...evaluated.errors, ...authorityErrors];
  if (verificationErrors.length) {
    throw new Error(`planning gate verification failed: ${verificationErrors.join("; ")}`);
  }
  const verified = {
    enabled: true,
    policy_required: planning.policy_required === true,
    enforced: true,
    status: "ready",
    receipt_path: planning.receipt_path,
    receipt_digest: planning.receipt_digest,
    planning_authority_version: 1,
    authority_sources: evaluated.authoritySources,
    protocol: planning.protocol,
    phase: planning.phase,
    scope_id: planning.scope_id,
    requirements,
    gate_statuses: planning.gate_statuses
  };
  if (planning.baseline_lineage || planning.lineage_required || receiptDeclaresLineage) {
    verified.lineage_required = true;
  }
  if (evaluated.baselineLineage) verified.baseline_lineage = evaluated.baselineLineage;
  return verified;
}
