import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  RouterError,
  resolveVisualIntent,
  resolveVisualSignature,
  visualIntentRequired
} from "./router.mjs";
import {
  canonicalDigest,
  physicalIdentityDigest,
  publicSnapshot,
  readFilePinned,
  readJsonPinned,
  sha256,
  snapshotArtifact,
  verifySnapshot,
  writeJsonAtomic
} from "./integrity.mjs";
import {
  baselineLineagesMatch,
  planningAuthoritiesMatch,
  verifyBaselineLineage,
  verifyPlanningGateForAudit
} from "./planning.mjs";
import {
  createJourneyIdentity,
  createParticipant,
  identitiesMatch,
  verifyJourneyIdentity,
  verifyPacketJourney,
  verifyParticipant
} from "./identity.mjs";
import {
  ensureSecureDirectory,
  secureExistingRegularFile,
  secureWritablePath
} from "./path-security.mjs";

const VALID_SCOPES = new Set(["mockup", "runtime", "source", "document"]);
const VALID_VERDICTS = new Set(["pass", "pass_with_findings", "block"]);
const VALID_SEVERITIES = new Set(["blocker", "major", "minor", "note", "candidate"]);
const VALID_DISPOSITIONS = new Set([
  "open",
  "fixed",
  "false-positive",
  "accepted-risk",
  "informational",
  "deferred"
]);
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;

function readPinnedAuditJson(target, label, faultInjector = null) {
  try {
    return readJsonPinned(target, { label, faultInjector });
  } catch (error) {
    throw new RouterError(error.message, 4);
  }
}

function pinnedAuditSnapshot(pinned, sourcePath, root) {
  const absoluteRoot = path.resolve(root || process.cwd());
  const absoluteSource = path.resolve(sourcePath);
  const relative = path.relative(absoluteRoot, absoluteSource);
  const display = relative && !relative.startsWith("..") && !path.isAbsolute(relative)
    ? relative.split(path.sep).join("/")
    : (!relative ? "." : absoluteSource);
  return {
    path: display,
    resolved_path: absoluteSource,
    kind: "file",
    bytes: pinned.bytes,
    digest: pinned.digest,
    physical_identity_digest: pinned.physical_identity_digest
  };
}

function verifyPinnedAuditFileSnapshot(snapshot, label, faultInjector = null) {
  requireValue(snapshot?.kind === "file" && typeof snapshot.resolved_path === "string",
    `${label} requires a canonical file snapshot`, 4);
  requireValue(DIGEST_PATTERN.test(snapshot.physical_identity_digest || ""),
    `${label} lacks a physical identity binding`, 4);
  let pinned;
  try {
    pinned = readFilePinned(snapshot.resolved_path, { label, faultInjector });
  } catch (error) {
    throw new RouterError(error.message, 4);
  }
  requireValue(pinned.digest === snapshot.digest,
    `${label} changed before child execution: digest-mismatch`, 4);
  requireValue(snapshot.bytes === null || snapshot.bytes === pinned.bytes,
    `${label} changed before child execution: size-mismatch`, 4);
  requireValue(pinned.physical_identity_digest === snapshot.physical_identity_digest,
    `${label} changed before child execution: physical-identity-mismatch`, 4);
  return pinned;
}

function verifyAuditExternalAuthoritiesOnce(run, sourcePlan, faultInjector = null) {
  if (run.route.profile_source) {
    const pinnedProfile = readPinnedAuditJson(
      run.route.profile_source.resolved_path,
      "routed project profile before child execution",
      faultInjector
    );
    requireValue(pinnedProfile.digest === run.route.profile_source.digest &&
      pinnedProfile.digest === sourcePlan.profile_digest,
    "routed project profile changed before child execution", 4);
    requireValue(
      pinnedProfile.physical_identity_digest === run.route.profile_source.physical_identity_digest,
      "routed project profile physical identity changed before child execution",
      4
    );
  }
  for (const source of run.visual_intent_sources || []) {
    verifyPinnedAuditFileSnapshot(
      source,
      `visual-intent authority ${source.authority_kind || source.path} before child execution`,
      faultInjector
    );
  }
  for (const source of run.visual_signature_sources || []) {
    verifyPinnedAuditFileSnapshot(
      source,
      `visual-signature authority ${source.authority_kind || source.path} before child execution`,
      faultInjector
    );
  }
  for (const artifact of run.artifacts || []) {
    if (artifact.kind === "file") {
      verifyPinnedAuditFileSnapshot(
        artifact,
        `audit artifact ${artifact.path} before child execution`,
        faultInjector
      );
      continue;
    }
    const verification = verifySnapshot(artifact);
    requireValue(verification.ok,
      `audit artifact ${artifact.path} changed before child execution: ${verification.reason}`, 4);
  }
}

function verifyAuditExternalAuthorities(run, sourcePlan, faultInjector = null) {
  verifyAuditExternalAuthoritiesOnce(run, sourcePlan, faultInjector);
  faultInjector?.("after-audit-authority-preflight-before-final-confirmation", {
    run_id: run.run_id,
    artifact_paths: (run.artifacts || []).map((artifact) => artifact.resolved_path)
  });
  verifyPinnedAuditFileSnapshot(
    run.route.plan_source,
    "route plan authority at final child boundary"
  );
  verifyAuditExternalAuthoritiesOnce(run, sourcePlan);
}

function finalPlanSourceSnapshot(snapshot) {
  requireValue(typeof snapshot?.resolved_path === "string" && snapshot.resolved_path.length > 0,
    "final audit receipt requires the canonical route plan resolved_path");
  return {
    ...publicSnapshot(snapshot),
    resolved_path: path.resolve(snapshot.resolved_path)
  };
}

function requireValue(condition, message, exitCode = 2) {
  if (!condition) throw new RouterError(message, exitCode);
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function nowIso(now) {
  return (now ? new Date(now) : new Date()).toISOString();
}

function receiptTimestamp(run, approval, now) {
  if (now) return nowIso(now);
  const candidates = [run.updated_at, run.created_at, approval?.decided_at]
    .filter(Boolean)
    .map((value) => Date.parse(value));
  return new Date(Math.max(...candidates)).toISOString();
}

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "actor";
}

function scopeClaim(scope) {
  return {
    mockup: "mockup-only-no-runtime-parity-claim",
    runtime: "runtime-artifacts-reviewed",
    source: "source-only-no-rendered-parity-claim",
    document: "document-only"
  }[scope];
}

function artifactDigestMap(artifacts) {
  return Object.fromEntries(artifacts.map((artifact) => [artifact.path, artifact.digest]));
}

function auditStagesFromPlan(plan) {
  return (plan.stages || []).map((stage) => ({
    id: stage.id,
    question: stage.question,
    optional: Boolean(stage.optional),
    required_capabilities: stage.required_capabilities || [],
    evidence_required: Boolean(stage.evidence_required),
    required_evidence_kinds: stage.required_evidence_kinds || []
  }));
}

function ownerApprovalRequiredFromPlan(plan) {
  return (plan.stages || []).some((stage) => stage.id === "approval" && !stage.optional);
}

function sameJson(left, right) {
  return canonicalDigest(left) === canonicalDigest(right);
}

function auditManifest(run) {
  const manifest = {
    audit_run_version: run.audit_run_version,
    run_id: run.run_id,
    journey_identity: run.journey_identity,
    scope: run.scope,
    route: run.route,
    planning_gate: run.planning_gate,
    visual_intent: run.visual_intent,
    visual_intent_sources: run.visual_intent_sources,
    visual_signature: run.visual_signature,
    visual_signature_sources: run.visual_signature_sources,
    creator: run.creator,
    artifacts: run.artifacts,
    evidence_contract: run.evidence_contract,
    baseline_observation: run.baseline_observation,
    hard_blockers: run.hard_blockers,
    invariants: run.invariants,
    owner_approval_required: run.owner_approval_required,
    stages: run.stages,
    packets: run.packets,
    audit_authority_digest: run.audit_authority_digest,
    approval_scope_digest: run.approval_scope_digest
  };
  if (Object.hasOwn(run, "baseline_lineage")) manifest.baseline_lineage = run.baseline_lineage;
  return manifest;
}

function sameDigestMap(actual, expected) {
  if (!actual || typeof actual !== "object" || Array.isArray(actual)) return false;
  const actualKeys = Object.keys(actual).sort();
  const expectedKeys = Object.keys(expected).sort();
  return actualKeys.length === expectedKeys.length &&
    actualKeys.every((key, index) => key === expectedKeys[index] && actual[key] === expected[key]);
}

function packetBody(packet) {
  const { packet_digest: _digest, ...body } = packet;
  return body;
}

function auditAuthorityForRun(run) {
  return canonicalDigest({
    audit_authority_version: 1,
    run_id: run.run_id,
    journey_identity: run.journey_identity,
    route: {
      router_id: run.route.router_id,
      router_version: run.route.router_version,
      route_id: run.route.route_id,
      project_id: run.route.project_id,
      plan_digest: run.route.plan_digest,
      plan_source_digest: run.route.plan_source?.digest || null
    },
    scope: run.scope.kind,
    creator: run.creator,
    artifact_digests: artifactDigestMap(run.artifacts || []),
    baseline_lineage_digest: run.baseline_lineage?.lineage_digest || null
  });
}

export function auditAuthorityDigestForRun(run) {
  return auditAuthorityForRun(run);
}

export function verifyAuditAuthority(run, authorityDigest, label = "audit operation") {
  requireValue(DIGEST_PATTERN.test(authorityDigest || ""),
    `${label} requires the caller-retained audit authority digest`, 4);
  requireValue(DIGEST_PATTERN.test(run?.audit_authority_digest || ""),
    "audit run lacks its external audit authority digest", 4);
  requireValue(auditAuthorityForRun(run) === run.audit_authority_digest,
    "audit authority no longer binds the creator actor and canonical run scope", 4);
  requireValue(authorityDigest === run.audit_authority_digest,
    `${label} authority digest does not match the original audit initialization`, 4);
  return run.audit_authority_digest;
}

function approvalScopeForRun(run) {
  const scope = {
    run_id: run.run_id,
    journey_identity: run.journey_identity,
    plan_digest: run.route.plan_digest,
    scope: run.scope.kind,
    planning_gate: run.planning_gate,
    visual_intent: run.visual_intent || null,
    visual_intent_sources: (run.visual_intent_sources || []).map((source) => source.digest),
    visual_signature: run.visual_signature || null,
    visual_signature_sources: (run.visual_signature_sources || []).map((source) => source.digest),
    baseline_observation: run.baseline_observation || null,
    creator: run.creator,
    artifacts: artifactDigestMap(run.artifacts),
    evidence_contract: run.evidence_contract || null,
    hard_blockers: run.hard_blockers || [],
    invariants: run.invariants || {},
    owner_approval_required: Boolean(run.owner_approval_required),
    stages: run.stages || [],
    packets: run.packets.map((packet) => packet.packet_digest),
    audit_authority_digest: run.audit_authority_digest
  };
  if (Object.hasOwn(run, "baseline_lineage")) scope.baseline_lineage = run.baseline_lineage;
  return canonicalDigest(scope);
}

function verifyPlanEnforcementGraph(run, sourcePlan) {
  requireValue(sourcePlan.creator === run.creator?.provider_id,
    "audit creator conflicts with the digest-bound route plan", 4);
  requireValue(sameJson(sourcePlan.surface_resolution || null, run.route.surface_resolution || null),
    "audit surface resolution conflicts with the digest-bound route plan", 4);
  requireValue(sameJson(sourcePlan.visual_intent || null, run.visual_intent || null),
    "audit visual-intent contract conflicts with the digest-bound route plan", 4);
  requireValue(sameJson(sourcePlan.visual_signature || null, run.visual_signature || null),
    "audit visual-signature contract conflicts with the digest-bound route plan", 4);
  requireValue(sameJson(sourcePlan.evidence_contract || null, run.evidence_contract || null),
    "audit evidence contract conflicts with the digest-bound route plan", 4);
  requireValue(sameJson(sourcePlan.baseline_observation || null, run.baseline_observation || null),
    "audit baseline observation conflicts with the digest-bound route plan", 4);
  requireValue(sameJson(sourcePlan.adjudication?.hard_blockers || [], run.hard_blockers || []),
    "audit hard-blocker policy conflicts with the digest-bound route plan", 4);
  requireValue(sameJson(sourcePlan.invariants || {}, run.invariants || {}),
    "audit invariant policy conflicts with the digest-bound route plan", 4);
  requireValue(
    ownerApprovalRequiredFromPlan(sourcePlan) === Boolean(run.owner_approval_required),
    "audit owner approval requirement conflicts with the digest-bound route plan",
    4
  );
  requireValue(sameJson(auditStagesFromPlan(sourcePlan), run.stages || []),
    "audit stage enforcement graph conflicts with the digest-bound route plan", 4);
  const expectedPackets = makePackets(sourcePlan, run.artifacts || [], run.journey_identity);
  requireValue(sameJson(expectedPackets, run.packets || []),
    "audit packet enforcement graph conflicts with the digest-bound route plan", 4);
  if (sourcePlan.profile_path || sourcePlan.profile_digest) {
    requireValue(
      run.route.profile_source &&
      path.resolve(run.route.profile_source.resolved_path) === path.resolve(sourcePlan.profile_path) &&
      run.route.profile_source.digest === sourcePlan.profile_digest,
      "audit profile authority conflicts with the digest-bound route plan",
      4
    );
  } else {
    requireValue(run.route.profile_source === null,
      "audit added a profile authority absent from the digest-bound route plan", 4);
  }
}

export function verifyAuditJourneyIdentity(run, {
  faultInjector = null,
  verifyExternalAuthorities = false
} = {}) {
  verifyJourneyIdentity(run?.journey_identity, {
    runId: run?.run_id,
    routerId: run?.route?.router_id,
    routerVersion: run?.route?.router_version,
    label: "audit journey_identity"
  });
  if (run.creator?.provider_id) {
    verifyParticipant(run.creator.participant, {
      providerId: run.creator.provider_id,
      role: "creator",
      label: "audit creator participant"
    });
  } else {
    requireValue(run.creator?.participant === null,
      "audit creator participant must be null when no creator is routed", 4);
  }
  if (run.baseline_lineage) {
    try {
      verifyBaselineLineage(run.baseline_lineage, "audit baseline_lineage");
    } catch (error) {
      throw new RouterError(error.message, 4);
    }
  }
  requireValue(
    baselineLineagesMatch(
      run.planning_gate?.baseline_lineage || null,
      run.baseline_lineage || null
    ),
    "audit baseline_lineage conflicts with verified planning authority",
    4
  );
  if (run.planning_gate?.lineage_required) {
    requireValue(Boolean(run.baseline_lineage),
      "audit removed baseline_lineage required by planning authority", 4);
  }
  requireValue(run.scope?.claim === scopeClaim(run.scope?.kind),
    "audit scope claim conflicts with its scope kind", 4);
  requireValue(Boolean(run.route?.plan_source),
    "audit requires a digest-bound canonical route plan source", 4);
  const pinnedPlan = readPinnedAuditJson(
    run.route.plan_source.resolved_path,
    "route plan authority",
    faultInjector
  );
  requireValue(pinnedPlan.digest === run.route.plan_source.digest,
    "route plan authority changed: digest-mismatch", 4);
  requireValue(
    pinnedPlan.physical_identity_digest === run.route.plan_source.physical_identity_digest,
    "route plan authority changed: physical-identity-mismatch",
    4
  );
  const sourcePlan = pinnedPlan.input;
  requireValue(canonicalDigest(sourcePlan) === run.route.plan_digest,
    "route plan digest no longer matches its authority source", 4);
  requireValue(
    sourcePlan.router_id === run.route.router_id &&
    sourcePlan.router_version === run.route.router_version &&
    sourcePlan.route_id === run.route.route_id &&
    sourcePlan.project_id === run.route.project_id,
    "audit route identity conflicts with the digest-bound route plan",
    4
  );
  requireValue(canonicalDigest(sourcePlan.input) === canonicalDigest(run.route.input),
    "audit route input conflicts with the digest-bound route plan", 4);
  if (sourcePlan.input?.scope) {
    requireValue(sourcePlan.input.scope === run.scope.kind,
      "audit scope conflicts with the digest-bound route plan", 4);
  }
  requireValue(
    baselineLineagesMatch(sourcePlan.baseline_lineage || null, run.baseline_lineage || null),
    "audit baseline_lineage conflicts with the digest-bound route plan",
    4
  );
  requireValue(
    baselineLineagesMatch(
      sourcePlan.planning_gate?.baseline_lineage || null,
      run.planning_gate?.baseline_lineage || null
    ),
    "audit planning baseline_lineage conflicts with the digest-bound route plan",
    4
  );
  requireValue(
    (sourcePlan.planning_gate?.receipt_digest || null) ===
      (run.planning_gate?.receipt_digest || null),
    "audit planning receipt conflicts with the digest-bound route plan",
    4
  );
  requireValue(
    planningAuthoritiesMatch(sourcePlan.planning_gate || null, run.planning_gate || null),
    "audit planning authority conflicts with the digest-bound route plan",
    4
  );
  verifyPlanEnforcementGraph(run, sourcePlan);
  if (verifyExternalAuthorities) {
    verifyAuditExternalAuthorities(run, sourcePlan, faultInjector);
  }
  for (const packet of run.packets || []) {
    verifyPacketJourney(packet, run.journey_identity, `packet ${packet.packet_id}`);
    requireValue(canonicalDigest(packetBody(packet)) === packet.packet_digest,
      `packet ${packet.packet_id} digest mismatch`, 4);
    requireValue(
      baselineLineagesMatch(packet.baseline_lineage || null, run.baseline_lineage || null),
      `packet ${packet.packet_id} baseline_lineage conflicts with the audit run`,
      4
    );
  }
  requireValue(DIGEST_PATTERN.test(run.audit_authority_digest || ""),
    "audit run requires an external audit authority digest", 4);
  requireValue(auditAuthorityForRun(run) === run.audit_authority_digest,
    "audit authority no longer binds the creator actor and canonical run scope", 4);
  return run;
}

export function rebindLegacyAuditIdentity(run, journeyIdentity, {
  plan = null,
  planPath = null
} = {}) {
  requireValue(run?.audit_run_version === 1, "legacy audit migration requires audit_run_version 1", 4);
  requireValue(!run.journey_identity, "audit run already has journey_identity", 4);
  requireValue((run.results || []).length === 0 && (run.triage || []).length === 0,
    "legacy audit already contains review evidence; start a new KillSlopRouter run", 4);
  requireValue(canonicalDigest(auditManifest(run)) === run.manifest_digest,
    "legacy audit manifest digest mismatch", 4);
  verifyJourneyIdentity(journeyIdentity, {
    runId: run.run_id,
    routerId: run.route?.router_id,
    routerVersion: run.route?.router_version
  });
  const next = structuredClone(run);
  next.journey_identity = journeyIdentity;
  const refreshLegacySnapshot = (snapshot, label) => {
    requireValue(snapshot?.resolved_path && DIGEST_PATTERN.test(snapshot.digest || ""),
      `legacy ${label} requires a canonical digest-bound source`, 4);
    const refreshed = snapshotArtifact(snapshot.resolved_path, {
      root: next.root || process.cwd(),
      label: snapshot.path
    });
    requireValue(refreshed.digest === snapshot.digest,
      `legacy ${label} changed before identity migration`, 4);
    return {
      ...snapshot,
      ...refreshed,
      path: snapshot.path,
      resolved_path: snapshot.resolved_path
    };
  };
  if (plan || planPath) {
    requireValue(plan && planPath,
      "legacy audit migration requires both the canonical plan and its source path", 4);
    const pinnedPlan = readPinnedAuditJson(planPath, "legacy audit migration plan");
    const planSource = pinnedAuditSnapshot(
      pinnedPlan,
      planPath,
      next.root || process.cwd()
    );
    requireValue(
      canonicalDigest(pinnedPlan.input) === canonicalDigest(plan),
      "legacy audit migration plan does not match its canonical source", 4);
    next.route.plan_digest = canonicalDigest(plan);
    next.route.plan_source = planSource;
    next.planning_gate = structuredClone(plan.planning_gate || null);
  } else {
    next.route.plan_source = refreshLegacySnapshot(next.route.plan_source, "route plan");
  }
  if (next.route.profile_source) {
    next.route.profile_source = refreshLegacySnapshot(
      next.route.profile_source,
      "route profile"
    );
  }
  next.visual_intent_sources = (next.visual_intent_sources || []).map((source) =>
    refreshLegacySnapshot(source, `visual-intent authority ${source.authority_kind || source.path}`));
  next.visual_signature_sources = (next.visual_signature_sources || []).map((source) =>
    refreshLegacySnapshot(source, `visual-signature authority ${source.authority_kind || source.path}`));
  next.artifacts = (next.artifacts || []).map((artifact) =>
    refreshLegacySnapshot(artifact, `artifact ${artifact.path}`));
  next.creator = {
    ...next.creator,
    participant: next.creator?.provider_id
      ? createParticipant({ providerId: next.creator.provider_id, role: "creator" })
      : null
  };
  next.packets = next.packets.map((packet) => {
    requireValue(canonicalDigest(packetBody(packet)) === packet.packet_digest,
      `legacy packet digest mismatch: ${packet.packet_id}`, 4);
    const rebound = {
      ...packet,
      run_id: journeyIdentity.run_id,
      journey_identity: journeyIdentity,
      participant: createParticipant({
        providerId: packet.provider.id,
        stageId: packet.stage_id,
        designTaskKind: packet.design_task?.kind || null
      })
    };
    rebound.packet_digest = canonicalDigest(packetBody(rebound));
    return rebound;
  });
  next.audit_authority_digest = auditAuthorityForRun(next);
  next.approval_scope_digest = approvalScopeForRun(next);
  next.manifest_digest = canonicalDigest(auditManifest(next));
  verifyAuditJourneyIdentity(next);
  return next;
}

function makePackets(plan, artifacts, journeyIdentity) {
  const artifactDigests = artifactDigestMap(artifacts);
  const packets = [];

  for (const stage of plan.stages) {
    if (stage.id === "approval") continue;
    for (const [index, actor] of (stage.selected_actors || []).entries()) {
      const assignedCapabilities = (stage.required_capabilities || []).filter((capability) =>
        (actor.capabilities || []).includes(capability)
      );
      const packet = {
        dispatch_packet_version: 1,
        packet_id: `${slug(stage.id)}--${slug(actor.id)}--${index + 1}`,
        run_id: journeyIdentity.run_id,
        stage_id: stage.id,
        stage_question: stage.question,
        journey_identity: journeyIdentity,
        required: !stage.optional && !actor.optional,
        provider: {
          id: actor.id,
          kind: actor.kind,
          version: actor.version || null,
          executor: actor.executor || null,
          fallback_for: actor.fallback_for || null,
          resolved_to: actor.resolved_to || null
        },
        participant: createParticipant({
          providerId: actor.id,
          stageId: stage.id
        }),
        assigned_capabilities: assignedCapabilities,
        minimum_strength: stage.minimum_strength || 1,
        reviewer_independence_required: Boolean(stage.requires_independent_critic),
        evidence_required: Boolean(stage.evidence_required),
        required_evidence_kinds: stage.required_evidence_kinds || [],
        evidence_contract: stage.id === "browser-evidence" ? plan.evidence_contract || null : null,
        visual_intent_contract: publicVisualIntent(plan.visual_intent),
        visual_signature_contract: publicVisualSignature(plan.visual_signature),
        artifact_digests: artifactDigests
      };
      if (plan.baseline_lineage) packet.baseline_lineage = plan.baseline_lineage;
      packet.packet_digest = canonicalDigest(packet);
      packets.push(packet);
    }
  }
  return packets;
}

export function initializeAudit({
  plan,
  planPath,
  artifacts,
  scope,
  creatorActorId = null,
  root = process.cwd(),
  runId = crypto.randomUUID(),
  journeyIdentity = null,
  invocation = "explicit",
  now = null,
  authorityFaultInjector = null
}) {
  requireValue(plan?.receipt_version === 1, "audit init requires a route receipt_version of 1");
  requireValue(plan.status === "planned", `cannot initialize audit from route status: ${plan.status}`);
  requireValue(planPath,
    "audit init requires a persisted canonical route plan source via planPath");
  requireValue(VALID_SCOPES.has(scope), "audit scope must be mockup, runtime, source, or document");
  const requiredBrowserStage = plan.stages?.find((stage) =>
    stage.id === "browser-evidence" && !stage.optional
  );
  if (requiredBrowserStage && ["mockup", "runtime"].includes(scope)) {
    requireValue((plan.evidence_contract?.required_scenarios || []).length > 0,
      "scoped UI audit requires a non-empty evidence.required_scenarios inventory", 3);
  }
  if (plan.input?.task === "runtime-handoff") {
    requireValue(scope === "runtime", "runtime-handoff audits require --scope runtime");
  }
  if (visualIntentRequired(plan.input)) {
    requireValue(
      plan.visual_intent?.status === "approved" &&
      plan.visual_intent?.authority_status === "verified" &&
      Array.isArray(plan.visual_intent?.sources) &&
      plan.visual_intent.sources.length > 0,
      "visual work requires a verified, digest-bound visual-intent contract",
      3
    );
    requireValue(
      plan.visual_signature?.status === "approved" &&
      plan.visual_signature?.authority_status === "verified" &&
      Array.isArray(plan.visual_signature?.sources) &&
      plan.visual_signature.sources.length > 0,
      "visual work requires a verified, digest-bound visual-signature contract",
      3
    );
  }
  requireValue(Array.isArray(artifacts) && artifacts.length > 0, "audit init requires at least one artifact");
  if (plan.creator) requireValue(creatorActorId, "--creator-id is required when the route has a creator");

  const absoluteRoot = path.resolve(root);
  let artifactSnapshots;
  try {
    artifactSnapshots = artifacts.map((artifact) => snapshotArtifact(artifact, { root: absoluteRoot }));
  } catch (error) {
    throw new RouterError(error.message, 4);
  }
  const duplicatePath = artifactSnapshots.find((artifact, index) =>
    artifactSnapshots.findIndex((candidate) => candidate.path === artifact.path) !== index
  );
  requireValue(!duplicatePath, `duplicate artifact: ${duplicatePath?.path}`);
  let planningGate = null;
  try {
    planningGate = verifyPlanningGateForAudit(plan, scope, {
      artifacts: artifactSnapshots,
      root: absoluteRoot
    });
  } catch (error) {
    throw new RouterError(error.message, 3);
  }
  const baselineLineage = planningGate?.baseline_lineage || null;
  requireValue(
    baselineLineagesMatch(plan.baseline_lineage || null, baselineLineage),
    "route plan baseline_lineage does not match verified planning authority",
    4
  );
  if (baselineLineage) {
    try {
      verifyBaselineLineage(baselineLineage, "verified planning baseline_lineage");
    } catch (error) {
      throw new RouterError(error.message, 4);
    }
  }

  const pinnedPlan = readPinnedAuditJson(
    planPath,
    "canonical route plan source",
    authorityFaultInjector
  );
  authorityFaultInjector?.("after-route-plan-pin-before-authority-bind", {
    path: path.resolve(planPath),
    digest: pinnedPlan.digest,
    physical_identity_digest: pinnedPlan.physical_identity_digest
  });
  const planSource = pinnedAuditSnapshot(pinnedPlan, planPath, absoluteRoot);
  requireValue(
    canonicalDigest(pinnedPlan.input) === canonicalDigest(plan),
    "route plan object does not match its canonical source", 4);
  let profileSource = null;
  let pinnedProfile = null;
  if (plan.profile_path && plan.profile_digest) {
    try {
      pinnedProfile = readJsonPinned(plan.profile_path, {
        label: "routed project profile",
        faultInjector: authorityFaultInjector
      });
      authorityFaultInjector?.("after-profile-pin-before-authority-bind", {
        path: path.resolve(plan.profile_path),
        digest: pinnedProfile.digest,
        physical_identity_digest: pinnedProfile.physical_identity_digest
      });
      profileSource = pinnedAuditSnapshot(
        pinnedProfile,
        plan.profile_path,
        absoluteRoot
      );
    } catch (error) {
      throw new RouterError(`cannot snapshot routed project profile: ${error.message}`, 4);
    }
    requireValue(profileSource.digest === plan.profile_digest,
      "project profile changed after route planning", 4);
  }
  if (visualIntentRequired(plan.input)) {
    requireValue(plan.profile_path && profileSource,
      "visual-contract verification requires a digest-bound project profile", 3);
    const verifiedIntent = resolveVisualIntent(
      pinnedProfile.input,
      plan.profile_path,
      plan.input.surface
    );
    requireValue(
      verifiedIntent.status === "approved" && verifiedIntent.authority_status === "verified",
      `visual-intent authority cannot be reverified: ${verifiedIntent.issues.join("; ")}`,
      4
    );
    requireValue(canonicalDigest(verifiedIntent) === canonicalDigest(plan.visual_intent),
      "visual-intent contract does not match the digest-bound project profile", 4);
    const verifiedSignature = resolveVisualSignature(
      pinnedProfile.input,
      plan.profile_path,
      plan.input.surface
    );
    requireValue(
      verifiedSignature.status === "approved" && verifiedSignature.authority_status === "verified",
      `visual-signature authority cannot be reverified: ${verifiedSignature.issues.join("; ")}`,
      4
    );
    requireValue(canonicalDigest(verifiedSignature) === canonicalDigest(plan.visual_signature),
      "visual-signature contract does not match the digest-bound project profile", 4);
  }
  let visualIntentSources = [];
  try {
    visualIntentSources = (plan.visual_intent?.sources || []).map((source) => {
      const snapshot = snapshotArtifact(source.path, { root: absoluteRoot });
      requireValue(snapshot.digest === source.digest,
        `visual-intent authority changed after route planning: ${source.path}`, 4);
      return { ...snapshot, authority_kind: source.kind };
    });
  } catch (error) {
    if (error instanceof RouterError) throw error;
    throw new RouterError(`cannot snapshot visual-intent authority: ${error.message}`, 4);
  }
  let visualSignatureSources = [];
  try {
    visualSignatureSources = (plan.visual_signature?.sources || []).map((source) => {
      const snapshot = snapshotArtifact(source.path, { root: absoluteRoot });
      requireValue(snapshot.digest === source.digest,
        `visual-signature authority changed after route planning: ${source.path}`, 4);
      return { ...snapshot, authority_kind: source.kind };
    });
  } catch (error) {
    if (error instanceof RouterError) throw error;
    throw new RouterError(`cannot snapshot visual-signature authority: ${error.message}`, 4);
  }
  const identity = journeyIdentity || createJourneyIdentity({
    runId,
    routerId: plan.router_id,
    routerVersion: plan.router_version,
    invocation
  });
  verifyJourneyIdentity(identity, {
    runId,
    routerId: plan.router_id,
    routerVersion: plan.router_version
  });
  const creator = {
    provider_id: plan.creator || null,
    actor_id: creatorActorId || null,
    participant: plan.creator
      ? createParticipant({ providerId: plan.creator, role: "creator" })
      : null
  };
  const packets = makePackets(plan, artifactSnapshots, identity);
  const requiredStagesWithoutPackets = plan.stages
    .filter((stage) => !stage.optional && stage.id !== "approval")
    .filter((stage) => !(stage.selected_actors || []).length)
    .map((stage) => stage.id);
  requireValue(
    requiredStagesWithoutPackets.length === 0,
    `required stages have no dispatchable actors: ${requiredStagesWithoutPackets.join(", ")}`,
    3
  );

  const evidenceContract = plan.evidence_contract || null;
  const hardBlockers = plan.adjudication?.hard_blockers || [];
  const invariants = plan.invariants || {};
  const ownerApprovalRequired = ownerApprovalRequiredFromPlan(plan);
  const auditStages = auditStagesFromPlan(plan);

  const createdAt = nowIso(now);
  const auditAuthorityDigest = auditAuthorityForRun({
    run_id: runId,
    journey_identity: identity,
    route: {
      router_id: plan.router_id,
      router_version: plan.router_version,
      route_id: plan.route_id,
      project_id: plan.project_id,
      plan_digest: canonicalDigest(plan),
      plan_source: planSource
    },
    scope: { kind: scope },
    creator,
    artifacts: artifactSnapshots,
    ...(baselineLineage ? { baseline_lineage: baselineLineage } : {})
  });
  const approvalScope = {
    run_id: runId,
    journey_identity: identity,
    plan_digest: canonicalDigest(plan),
    scope,
    planning_gate: planningGate,
    visual_intent: plan.visual_intent || null,
    visual_intent_sources: visualIntentSources.map((source) => source.digest),
    visual_signature: plan.visual_signature || null,
    visual_signature_sources: visualSignatureSources.map((source) => source.digest),
    baseline_observation: plan.baseline_observation || null,
    creator,
    artifacts: artifactDigestMap(artifactSnapshots),
    evidence_contract: evidenceContract,
    hard_blockers: hardBlockers,
    invariants,
    owner_approval_required: ownerApprovalRequired,
    stages: auditStages,
    packets: packets.map((packet) => packet.packet_digest),
    audit_authority_digest: auditAuthorityDigest
  };
  if (baselineLineage) approvalScope.baseline_lineage = baselineLineage;
  const approvalScopeDigest = canonicalDigest(approvalScope);

  const run = {
    audit_run_version: 1,
    run_id: runId,
    journey_identity: identity,
    status: "collecting",
    created_at: createdAt,
    updated_at: createdAt,
    root: absoluteRoot,
    scope: { kind: scope, claim: scopeClaim(scope) },
    route: {
      router_id: plan.router_id,
      router_version: plan.router_version,
      route_id: plan.route_id,
      project_id: plan.project_id,
      plan_digest: canonicalDigest(plan),
      plan_source: planSource,
      profile_source: profileSource,
      surface_resolution: plan.surface_resolution || null,
      input: plan.input
    },
    planning_gate: planningGate,
    visual_intent: plan.visual_intent || null,
    visual_intent_sources: visualIntentSources,
    visual_signature: plan.visual_signature || null,
    visual_signature_sources: visualSignatureSources,
    creator,
    artifacts: artifactSnapshots,
    evidence_contract: evidenceContract,
    baseline_observation: plan.baseline_observation || null,
    hard_blockers: hardBlockers,
    invariants,
    owner_approval_required: ownerApprovalRequired,
    stages: auditStages,
    packets,
    results: [],
    triage: [],
    audit_authority_digest: auditAuthorityDigest,
    approval_scope_digest: approvalScopeDigest
  };
  if (baselineLineage) run.baseline_lineage = baselineLineage;
  run.manifest_digest = canonicalDigest(auditManifest(run));
  verifyAuditJourneyIdentity(run, {
    faultInjector: authorityFaultInjector,
    verifyExternalAuthorities: true
  });
  requireValue(approvalScopeForRun(run) === run.approval_scope_digest,
    "approval scope failed to bind the KillSlopRouter journey identity", 4);
  return run;
}

function resultTemplate(run, packet) {
  const browserEvidence = packet.stage_id === "browser-evidence";
  const requiredViewports = packet.evidence_contract?.required_viewports || [];
  const requiredChecks = packet.evidence_contract?.required_checks || [];
  const requiredScenarios = packet.evidence_contract?.required_scenarios || [];
  const scenarioTemplates = requiredScenarios.length ? requiredScenarios : [null];
  const screenshotTemplates = requiredViewports.length ? scenarioTemplates.flatMap((scenario) =>
    requiredViewports.map((viewport) => ({
      path: `replace-with-${scenario ? `${scenario}-` : ""}${viewport}-screenshot-file`,
      kind: "screenshot",
      covers: packet.assigned_capabilities,
      viewports: [viewport],
      checks: [],
      scenarios: scenario ? [scenario] : []
    }))) : [{
    path: "replace-with-screenshot-file",
    kind: "screenshot",
    covers: packet.assigned_capabilities,
    viewports: [],
    checks: [],
    scenarios: requiredScenarios
  }];
  return {
    audit_result_version: 1,
    run_id: run.run_id,
    packet_id: packet.packet_id,
    packet_digest: packet.packet_digest,
    journey_identity: run.journey_identity,
    provider_id: packet.provider.id,
    participant: packet.participant,
    ...(run.baseline_lineage
      ? { baseline_lineage_digest: run.baseline_lineage.lineage_digest }
      : {}),
    reviewer: {
      actor_id: "replace-with-reviewer-identity",
      kind: packet.provider.kind || "agent"
    },
    verdict: "pass",
    capabilities_checked: packet.assigned_capabilities,
    artifact_digests: packet.artifact_digests,
    findings: [],
    evidence: browserEvidence ? [
      ...screenshotTemplates,
      {
        path: "replace-with-test-report-file",
        kind: "test-report",
        covers: packet.assigned_capabilities,
        viewports: requiredViewports,
        checks: requiredChecks,
        scenarios: requiredScenarios
      }
    ] : [],
    resolutions: [],
    started_at: run.created_at,
    finished_at: run.created_at
  };
}

export function dispatchAuditPackets(run, outDir, { authorityDigest = null } = {}) {
  requireValue(run?.audit_run_version === 1, "dispatch requires an audit run_version of 1");
  verifyAuditJourneyIdentity(run);
  verifyAuditAuthority(run, authorityDigest, "audit dispatch");
  let absoluteOut;
  try {
    absoluteOut = secureWritablePath(outDir, "audit packet output directory");
  } catch (error) {
    throw new RouterError(error.message, 4);
  }
  try {
    absoluteOut = ensureSecureDirectory(absoluteOut, "audit packet output directory").real_path;
  } catch (error) {
    throw new RouterError(error.message, 4);
  }
  const written = [];
  for (const packet of run.packets) {
    let target;
    try {
      target = secureWritablePath(
        path.join(absoluteOut, `${packet.packet_id}.json`),
        `audit packet output ${packet.packet_id}`,
        { boundary: absoluteOut }
      );
    } catch (error) {
      throw new RouterError(error.message, 4);
    }
    writeJsonAtomic(target, {
      ...packet,
      run_id: run.run_id,
      scope: run.scope,
      creator: run.creator,
      artifacts: run.artifacts.map(publicSnapshot),
      result_template: resultTemplate(run, packet)
    });
    written.push(target);
  }
  let approvalTemplate;
  try {
    approvalTemplate = secureWritablePath(
      path.join(absoluteOut, "owner-approval.template.json"),
      "audit owner approval template",
      { boundary: absoluteOut }
    );
  } catch (error) {
    throw new RouterError(error.message, 4);
  }
  const approvalBody = {
    approval_version: 1,
    run_id: run.run_id,
    journey_identity: run.journey_identity,
    scope_digest: run.approval_scope_digest,
    owner_id: "replace-with-owner-identity",
    status: "approved",
    note: "replace-with-explicit-owner-decision",
    decided_at: run.created_at
  };
  if (run.baseline_lineage) {
    approvalBody.baseline_lineage_digest = run.baseline_lineage.lineage_digest;
  }
  writeJsonAtomic(approvalTemplate, approvalBody);
  return { directory: absoluteOut, packets: written, approval_template: approvalTemplate };
}

function normalizeFinding(finding, index) {
  requireValue(finding && typeof finding === "object", `finding ${index + 1} must be an object`);
  requireValue(finding.id, `finding ${index + 1} requires id`);
  requireValue(VALID_SEVERITIES.has(finding.severity), `finding ${finding.id} has invalid severity`);
  requireValue(finding.category, `finding ${finding.id} requires category`);
  requireValue(finding.claim, `finding ${finding.id} requires claim`);
  requireValue(finding.evidence, `finding ${finding.id} requires evidence`);
  const disposition = finding.disposition || "open";
  requireValue(VALID_DISPOSITIONS.has(disposition), `finding ${finding.id} has invalid disposition`);
  return {
    id: String(finding.id),
    rule_id: finding.rule_id || null,
    severity: finding.severity,
    category: finding.category,
    location: finding.location || null,
    claim: finding.claim,
    evidence: finding.evidence,
    suggested_fix: finding.suggested_fix || null,
    disposition,
    rationale: finding.rationale || null,
    conflicts_with: unique(finding.conflicts_with || [])
  };
}

function snapshotEvidence(items, sourcePath, root, evidenceSnapshotter = null) {
  const sourceDirectory = path.dirname(path.resolve(sourcePath));
  return (items || []).map((item, index) => {
    requireValue(item?.path, `evidence ${index + 1} requires path`);
    requireValue(item.kind, `evidence ${index + 1} requires kind`);
    const resolved = path.isAbsolute(item.path) ? item.path : path.resolve(sourceDirectory, item.path);
    let snapshot;
    try {
      snapshot = evidenceSnapshotter
        ? evidenceSnapshotter(resolved, { root, label: item.path })
        : snapshotArtifact(resolved, { root, label: item.path });
    } catch (error) {
      throw new RouterError(`cannot snapshot evidence ${item.path}: ${error.message}`, 4);
    }
    return {
      ...snapshot,
      kind: item.kind,
      covers: unique(item.covers || []),
      viewports: unique(item.viewports || []),
      checks: unique(item.checks || []),
      scenarios: unique(item.scenarios || [])
    };
  });
}

function validateEvidenceCoverage(packet, evidence) {
  if (!packet.evidence_required) return;
  requireValue(evidence.length > 0, `${packet.packet_id} requires evidence`);
  const kinds = new Set(evidence.map((item) => item.kind));
  const covers = new Set(evidence.flatMap((item) => item.covers));
  const viewports = new Set(evidence.flatMap((item) => item.viewports));
  const checks = new Set(evidence.flatMap((item) => item.checks));
  const scenarios = new Set(evidence.flatMap((item) => item.scenarios));

  for (const kind of packet.required_evidence_kinds || []) {
    requireValue(kinds.has(kind), `${packet.packet_id} is missing ${kind} evidence`);
  }
  for (const capability of packet.assigned_capabilities) {
    requireValue(covers.has(capability), `${packet.packet_id} evidence does not cover ${capability}`);
  }
  for (const viewport of packet.evidence_contract?.required_viewports || []) {
    requireValue(viewports.has(viewport), `${packet.packet_id} is missing viewport evidence: ${viewport}`);
    requireValue(evidence.some((item) => item.kind === "screenshot" && item.viewports.includes(viewport)),
      `${packet.packet_id} is missing a screenshot for viewport: ${viewport}`);
  }
  for (const check of packet.evidence_contract?.required_checks || []) {
    requireValue(checks.has(check), `${packet.packet_id} is missing browser check: ${check}`);
    requireValue(evidence.some((item) => item.kind !== "screenshot" && item.checks.includes(check)),
      `${packet.packet_id} browser check lacks non-screenshot proof: ${check}`);
  }
  for (const scenario of packet.evidence_contract?.required_scenarios || []) {
    requireValue(scenarios.has(scenario), `${packet.packet_id} is missing scenario evidence: ${scenario}`);
    requireValue(evidence.some((item) => item.kind !== "screenshot" && item.scenarios.includes(scenario)),
      `${packet.packet_id} scenario lacks non-screenshot proof: ${scenario}`);
    for (const viewport of packet.evidence_contract?.required_viewports || []) {
      requireValue(evidence.some((item) => item.kind === "screenshot" &&
        item.scenarios.includes(scenario) && item.viewports.includes(viewport)),
      `${packet.packet_id} is missing a screenshot for scenario ${scenario} at viewport ${viewport}`);
    }
  }
}

function normalizeResolution(resolution, index) {
  requireValue(Array.isArray(resolution?.finding_refs) && resolution.finding_refs.length >= 2,
    `resolution ${index + 1} requires at least two finding_refs`);
  requireValue(resolution.decision, `resolution ${index + 1} requires decision`);
  requireValue(resolution.basis, `resolution ${index + 1} requires basis`);
  requireValue(resolution.rationale, `resolution ${index + 1} requires rationale`);
  return {
    finding_refs: unique(resolution.finding_refs),
    decision: resolution.decision,
    basis: resolution.basis,
    rationale: resolution.rationale
  };
}

function sourceSnapshot(sourcePath, root, pinnedSnapshot = null) {
  if (pinnedSnapshot) {
    requireValue(path.resolve(pinnedSnapshot.resolved_path || "") === path.resolve(sourcePath),
      "pinned source snapshot path does not match the supplied source", 4);
    requireValue(typeof pinnedSnapshot.path === "string" && pinnedSnapshot.path.length > 0 &&
      pinnedSnapshot.kind === "file" &&
      Number.isInteger(pinnedSnapshot.bytes) && pinnedSnapshot.bytes >= 0 &&
      DIGEST_PATTERN.test(pinnedSnapshot.digest || "") &&
      DIGEST_PATTERN.test(pinnedSnapshot.physical_identity_digest || ""),
    "pinned source snapshot is incomplete", 4);
    return structuredClone(pinnedSnapshot);
  }
  try {
    return snapshotArtifact(sourcePath, { root });
  } catch (error) {
    throw new RouterError(`cannot snapshot result source: ${error.message}`, 4);
  }
}

function samePinnedFileIdentity(left, right) {
  return left.dev === right.dev &&
    left.ino === right.ino &&
    left.nlink === right.nlink &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs;
}

function readSnapshotJson(snapshot, label) {
  requireValue(snapshot?.kind === "file" && DIGEST_PATTERN.test(snapshot?.digest || "") &&
    DIGEST_PATTERN.test(snapshot?.physical_identity_digest || ""),
    `${label} requires a digest-bound file snapshot`, 4);
  let canonical;
  try {
    canonical = secureExistingRegularFile(snapshot.resolved_path, label, { singleLink: true });
  } catch (error) {
    throw new RouterError(`${label} source is unavailable: ${error.message}`, 4);
  }
  const recordedPhysical = fs.realpathSync.native(path.resolve(snapshot.resolved_path));
  requireValue(canonical === recordedPhysical,
    `${label} source path no longer resolves to its recorded location`, 4);
  const descriptor = fs.openSync(
    canonical,
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0)
  );
  try {
    const before = fs.fstatSync(descriptor, { bigint: true });
    const lexicalBefore = fs.lstatSync(canonical, { bigint: true });
    requireValue(before.isFile() && lexicalBefore.isFile() &&
      samePinnedFileIdentity(before, lexicalBefore),
    `${label} source changed while its descriptor was being pinned`, 4);
    const source = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor, { bigint: true });
    const lexicalAfter = fs.lstatSync(canonical, { bigint: true });
    requireValue(samePinnedFileIdentity(before, after) &&
      samePinnedFileIdentity(after, lexicalAfter),
    `${label} source changed while it was being verified`, 4);
    requireValue(sha256(source) === snapshot.digest,
      `${label} source digest no longer matches the normalized authority`, 4);
    const identity = {
      type: "file",
      identity: {
        device: String(after.dev),
        inode: String(after.ino),
        links: String(after.nlink),
        owner_uid: String(after.uid),
        mode: Number(after.mode & 0o777n),
        size: String(after.size),
        mtime_ns: String(after.mtimeNs),
        ctime_ns: String(after.ctimeNs)
      }
    };
    requireValue(
      physicalIdentityDigest(identity) === snapshot.physical_identity_digest,
      `${label} source physical identity no longer matches the normalized authority`,
      4
    );
    try {
      return JSON.parse(source.toString("utf8"));
    } catch (error) {
      throw new RouterError(`cannot parse ${label} source: ${error.message}`, 4);
    }
  } finally {
    fs.closeSync(descriptor);
  }
}

function verifyResultBinding(run, packet, input, label = "audit result") {
  requireValue(input.run_id === run.run_id,
    `${label} run_id does not match the audit run`, 4);
  verifyJourneyIdentity(input.journey_identity, {
    runId: run.run_id,
    routerId: run.route.router_id,
    routerVersion: run.route.router_version,
    label: `${label} journey_identity`
  });
  requireValue(identitiesMatch(input.journey_identity, run.journey_identity),
    `${label} journey_identity does not match the audit run`, 4);
  requireValue(input.packet_digest === packet.packet_digest,
    `${label} packet_digest does not match ${packet.packet_id}`, 4);
  verifyParticipant(input.participant, {
    providerId: packet.provider.id,
    stageId: packet.stage_id,
    label: `${label} participant`
  });
  requireValue(sameJson(input.participant, packet.participant),
    `${label} participant does not match ${packet.packet_id}`, 4);
  if (run.baseline_lineage) {
    requireValue(
      input.baseline_lineage_digest === run.baseline_lineage.lineage_digest,
      `${label} baseline_lineage_digest does not match the audit run`,
      4
    );
  } else {
    requireValue(input.baseline_lineage_digest === undefined,
      `${label} cannot add baseline lineage to an unbound audit run`, 4);
  }
}

function standardResult(run, input, sourcePath, evidenceSnapshotter = null, sourceSnapshotOverride = null) {
  requireValue(input.audit_result_version === 1, "result audit_result_version must be 1");
  const packet = run.packets.find((candidate) => candidate.packet_id === input.packet_id);
  requireValue(packet, `unknown packet_id: ${input.packet_id}`);
  verifyResultBinding(run, packet, input, `result ${packet.packet_id}`);
  requireValue(input.provider_id === packet.provider.id,
    `provider mismatch for ${packet.packet_id}: expected ${packet.provider.id}`);
  requireValue(input.reviewer?.actor_id, `${packet.packet_id} requires reviewer.actor_id`);
  requireValue(input.reviewer?.kind, `${packet.packet_id} requires reviewer.kind`);
  if (packet.reviewer_independence_required && run.creator.actor_id) {
    requireValue(input.reviewer.actor_id !== run.creator.actor_id,
      `${packet.packet_id} reviewer cannot be the creator`);
  }
  if (packet.reviewer_independence_required && run.creator.provider_id) {
    requireValue(input.provider_id !== run.creator.provider_id,
      `${packet.packet_id} provider cannot self-review its own artifact`);
  }
  requireValue(VALID_VERDICTS.has(input.verdict), `${packet.packet_id} has invalid verdict`);
  requireValue(input.started_at && !Number.isNaN(Date.parse(input.started_at)),
    `${packet.packet_id} requires a valid started_at timestamp`);
  requireValue(input.finished_at && !Number.isNaN(Date.parse(input.finished_at)),
    `${packet.packet_id} requires a valid finished_at timestamp`);
  requireValue(Date.parse(input.finished_at) >= Date.parse(input.started_at),
    `${packet.packet_id} finished_at cannot precede started_at`);
  requireValue(sameDigestMap(input.artifact_digests, packet.artifact_digests),
    `${packet.packet_id} artifact digests do not match the dispatch packet`);
  const checked = unique(input.capabilities_checked || []);
  for (const capability of packet.assigned_capabilities) {
    requireValue(checked.includes(capability), `${packet.packet_id} did not check ${capability}`);
  }

  const findings = (input.findings || []).map(normalizeFinding);
  requireValue(new Set(findings.map((finding) => finding.id)).size === findings.length,
    `${packet.packet_id} has duplicate finding ids`);
  if (input.verdict === "block") {
    requireValue(findings.some((finding) => finding.severity === "blocker" || finding.disposition === "open"),
      `${packet.packet_id} block verdict requires an open or blocker finding`);
  }
  const evidence = snapshotEvidence(
    input.evidence || [],
    sourcePath,
    run.root,
    evidenceSnapshotter
  );
  validateEvidenceCoverage(packet, evidence);
  const resolutions = (input.resolutions || []).map(normalizeResolution);
  const normalized = {
    run_id: run.run_id,
    packet_id: packet.packet_id,
    packet_digest: packet.packet_digest,
    stage_id: packet.stage_id,
    journey_identity: run.journey_identity,
    provider_id: packet.provider.id,
    participant: packet.participant,
    provider_version: packet.provider.version,
    reviewer: { actor_id: input.reviewer.actor_id, kind: input.reviewer.kind },
    verdict: input.verdict,
    capabilities_checked: checked,
    artifact_digests: input.artifact_digests,
    findings,
    evidence,
    resolutions,
    started_at: input.started_at || null,
    finished_at: input.finished_at || null
  };
  if (run.baseline_lineage) {
    normalized.baseline_lineage_digest = run.baseline_lineage.lineage_digest;
  }
  return {
    packet_id: packet.packet_id,
    source: sourceSnapshot(sourcePath, run.root, sourceSnapshotOverride),
    normalized,
    normalized_digest: canonicalDigest(normalized),
    recorded_at: nowIso()
  };
}

function adapterResult(run, input, sourcePath, sourceSnapshotOverride = null) {
  requireValue(input.adapter_receipt_version === 1, "adapter receipt version must be 1");
  const candidates = run.packets.filter((packet) =>
    packet.stage_id === input.stage && packet.provider.id === input.tool_id
  );
  requireValue(candidates.length === 1,
    `adapter receipt must resolve to exactly one packet; found ${candidates.length}`);
  const packet = candidates[0];
  requireValue(run.artifacts.length === 1,
    "single adapter receipts require an audit run with one root artifact; aggregate multi-artifact scans first");
  const bindingFields = [
    "run_id",
    "packet_digest",
    "journey_identity",
    "participant",
    "baseline_lineage_digest"
  ];
  const suppliedBindingFields = bindingFields.filter((field) => Object.hasOwn(input, field));
  const standaloneCompatibility = suppliedBindingFields.length === 0;
  if (standaloneCompatibility) {
    requireValue(
      input.tool_id === "kill-ai-slop" &&
        input.stage === "static-discovery" &&
        input.mode === "read-only-json",
      "unbound adapter receipts are accepted only from the standalone kill-ai-slop scanner",
      4
    );
    requireValue(typeof input.artifact === "string" && input.artifact.length > 0,
      "standalone kill-ai-slop receipt requires its scanned artifact path", 4);
    let receiptArtifact;
    let auditArtifact;
    try {
      receiptArtifact = fs.realpathSync.native(path.resolve(input.artifact));
      auditArtifact = fs.realpathSync.native(path.resolve(run.artifacts[0].resolved_path));
    } catch (error) {
      throw new RouterError(`cannot verify standalone scanner artifact authority: ${error.message}`, 4);
    }
    requireValue(receiptArtifact === auditArtifact,
      "standalone kill-ai-slop receipt artifact does not match the audit root artifact", 4);
  } else {
    verifyResultBinding(run, packet, input, `adapter result ${packet.packet_id}`);
  }
  requireValue(input.artifact_digest === run.artifacts[0].digest,
    `${packet.packet_id} adapter artifact digest does not match the audit run`);
  const blocked = String(input.status || "").startsWith("blocked");
  const findings = (input.findings || []).map((finding, index) => normalizeFinding({
    ...finding,
    id: finding.id || `candidate-${index + 1}`,
    severity: finding.severity === "review" ? "candidate" : finding.severity || "candidate",
    category: finding.category || "static-discovery",
    claim: finding.claim || "static scanner candidate",
    evidence: finding.evidence || "adapter candidate",
    disposition: finding.disposition || "open"
  }, index));
  const normalized = {
    run_id: run.run_id,
    packet_id: packet.packet_id,
    packet_digest: packet.packet_digest,
    stage_id: packet.stage_id,
    journey_identity: run.journey_identity,
    provider_id: packet.provider.id,
    participant: packet.participant,
    receipt_binding: standaloneCompatibility
      ? "standalone-compatibility-bound-at-ingest"
      : "packet-bound",
    provider_version: input.version || packet.provider.version,
    reviewer: { actor_id: `${input.tool_id}@${input.version || "unversioned"}`, kind: "tool" },
    verdict: blocked ? "block" : findings.length ? "pass_with_findings" : "pass",
    capabilities_checked: packet.assigned_capabilities,
    artifact_digests: packet.artifact_digests,
    findings,
    evidence: [],
    resolutions: [],
    started_at: input.started_at || null,
    finished_at: input.finished_at || null
  };
  if (run.baseline_lineage) {
    normalized.baseline_lineage_digest = run.baseline_lineage.lineage_digest;
  }
  return {
    packet_id: packet.packet_id,
    source: sourceSnapshot(sourcePath, run.root, sourceSnapshotOverride),
    normalized,
    normalized_digest: canonicalDigest(normalized),
    recorded_at: nowIso()
  };
}

export function recordAuditResult(run, input, sourcePath, {
  replace = false,
  now = null,
  authorityDigest = null,
  evidenceSnapshotter = null,
  sourceSnapshot: sourceSnapshotOverride = null
} = {}) {
  requireValue(run?.audit_run_version === 1, "record requires an audit run_version of 1");
  verifyAuditJourneyIdentity(run);
  verifyAuditAuthority(run, authorityDigest, "audit result recording");
  requireValue(sourcePath, "record requires a result source path");
  const record = input.adapter_receipt_version
    ? adapterResult(run, input, sourcePath, sourceSnapshotOverride)
    : standardResult(run, input, sourcePath, evidenceSnapshotter, sourceSnapshotOverride);
  const existing = run.results.find((result) => result.packet_id === record.packet_id);
  requireValue(!existing || replace, `result already recorded for ${record.packet_id}; use --replace`);
  const next = structuredClone(run);
  next.results = next.results.filter((result) => result.packet_id !== record.packet_id);
  next.results.push(record);
  if (replace) {
    const prefix = `${record.packet_id}/`;
    next.triage = next.triage.map((entry) => ({
      ...entry,
      decisions: entry.decisions.filter((decision) => !decision.finding_ref.startsWith(prefix))
    })).filter((entry) => entry.decisions.length);
  }
  next.updated_at = nowIso(now);
  return next;
}

function findingIndex(run) {
  const index = new Map();
  for (const result of run.results) {
    for (const finding of result.normalized.findings) {
      index.set(`${result.packet_id}/${finding.id}`, { result, finding });
    }
  }
  return index;
}

export function recordTriage(run, input, sourcePath, {
  replace = false,
  now = null,
  authorityDigest = null,
  sourceSnapshot: sourceSnapshotOverride = null
} = {}) {
  requireValue(run?.audit_run_version === 1, "triage requires an audit run_version of 1");
  verifyAuditJourneyIdentity(run);
  verifyAuditAuthority(run, authorityDigest, "audit triage recording");
  requireValue(sourcePath, "triage requires a source path");
  const decisions = normalizeTriageDecisions(run, input, sourcePath);
  const existingRefs = new Set(run.triage.flatMap((entry) => entry.decisions.map((item) => item.finding_ref)));
  for (const decision of decisions) {
    requireValue(!existingRefs.has(decision.finding_ref) || replace,
      `triage already recorded for ${decision.finding_ref}; use --replace`);
  }
  const normalized = { decisions };
  const entry = {
    source: sourceSnapshot(sourcePath, run.root, sourceSnapshotOverride),
    decisions,
    normalized_digest: canonicalDigest(normalized),
    recorded_at: nowIso(now)
  };
  const next = structuredClone(run);
  if (replace) {
    const replacing = new Set(decisions.map((decision) => decision.finding_ref));
    next.triage = next.triage.map((candidate) => ({
      ...candidate,
      decisions: candidate.decisions.filter((decision) => !replacing.has(decision.finding_ref))
    })).filter((candidate) => candidate.decisions.length);
  }
  next.triage.push(entry);
  next.updated_at = nowIso(now);
  return next;
}

function normalizeTriageDecisions(run, input, sourcePath) {
  requireValue(input?.triage_version === 1, "triage_version must be 1");
  requireValue(Array.isArray(input.decisions) && input.decisions.length > 0,
    "triage requires at least one decision");
  const findings = findingIndex(run);
  return input.decisions.map((decision, index) => {
    requireValue(findings.has(decision.finding_ref),
      `triage decision ${index + 1} references unknown finding: ${decision.finding_ref}`);
    requireValue(VALID_DISPOSITIONS.has(decision.disposition) && decision.disposition !== "open",
      `triage decision ${decision.finding_ref} requires a non-open disposition`);
    requireValue(decision.rationale, `triage decision ${decision.finding_ref} requires rationale`);
    return {
      finding_ref: decision.finding_ref,
      disposition: decision.disposition,
      rationale: decision.rationale,
      decided_by: decision.decided_by || null,
      evidence: snapshotEvidence(decision.evidence || [], sourcePath, run.root)
    };
  });
}

function verifyIntegrity(run, approval) {
  let identityFailure = null;
  try {
    verifyAuditJourneyIdentity(run);
    requireValue(approvalScopeForRun(run) === run.approval_scope_digest,
      "approval scope digest no longer binds the journey identity", 4);
  } catch (error) {
    identityFailure = error.message;
  }
  const manifestDigest = canonicalDigest(auditManifest(run));
  const checks = [{
    label: "journey-identity",
    path: null,
    ok: identityFailure === null,
    reason: identityFailure,
    expected: run.journey_identity?.identity_digest || null,
    actual: identityFailure === null ? run.journey_identity.identity_digest : null
  }, {
    label: "audit-manifest",
    path: null,
    ok: manifestDigest === run.manifest_digest,
    reason: manifestDigest === run.manifest_digest ? null : "digest-mismatch",
    expected: run.manifest_digest,
    actual: manifestDigest
  }];
  const check = (label, snapshot) => {
    if (!snapshot) return;
    const verification = verifySnapshot(snapshot);
    checks.push({ label, path: publicSnapshot(snapshot).path, ...verification });
  };
  check("route-plan", run.route.plan_source);
  check("route-profile", run.route.profile_source);
  for (const source of run.visual_intent_sources || []) {
    check(`visual-intent:${source.authority_kind || source.path}`, source);
  }
  for (const source of run.visual_signature_sources || []) {
    check(`visual-signature:${source.authority_kind || source.path}`, source);
  }
  for (const artifact of run.artifacts) check(`artifact:${artifact.path}`, artifact);
  for (const result of run.results) {
    check(`result:${result.packet_id}`, result.source);
    const actualDigest = canonicalDigest(result.normalized);
    checks.push({
      label: `normalized-result:${result.packet_id}`,
      path: null,
      ok: actualDigest === result.normalized_digest,
      reason: actualDigest === result.normalized_digest ? null : "digest-mismatch",
      expected: result.normalized_digest,
      actual: actualDigest
    });
    let authorityFailure = null;
    try {
      const source = readSnapshotJson(result.source, `recorded result ${result.packet_id}`);
      const reconstructed = source.adapter_receipt_version
        ? adapterResult(run, source, result.source.resolved_path, result.source)
        : standardResult(run, source, result.source.resolved_path, null, result.source);
      const packet = run.packets.find((candidate) => candidate.packet_id === result.packet_id);
      requireValue(packet, `recorded result references an unknown packet: ${result.packet_id}`, 4);
      requireValue(reconstructed.packet_id === result.packet_id,
        `recorded result packet changed: ${result.packet_id}`, 4);
      requireValue(reconstructed.normalized_digest === result.normalized_digest,
        `recorded result normalization changed: ${result.packet_id}`, 4);
      if (packet.reviewer_independence_required) {
        requireValue(result.normalized.reviewer?.actor_id !== run.creator?.actor_id,
          `recorded reviewer became the creator: ${result.packet_id}`, 4);
        requireValue(
          !run.creator?.provider_id || result.normalized.provider_id !== run.creator.provider_id,
          `recorded provider became the creator provider: ${result.packet_id}`,
          4
        );
      }
    } catch (error) {
      authorityFailure = error.message;
    }
    checks.push({
      label: `result-authority:${result.packet_id}`,
      path: publicSnapshot(result.source).path,
      ok: authorityFailure === null,
      reason: authorityFailure,
      expected: result.normalized_digest,
      actual: authorityFailure === null ? result.normalized_digest : null
    });
    for (const evidence of result.normalized.evidence) check(`evidence:${result.packet_id}`, evidence);
  }
  for (const [index, triage] of run.triage.entries()) {
    check(`triage:${index + 1}`, triage.source);
    const actualDigest = canonicalDigest({ decisions: triage.decisions });
    checks.push({
      label: `normalized-triage:${index + 1}`,
      path: null,
      ok: actualDigest === triage.normalized_digest,
      reason: actualDigest === triage.normalized_digest ? null : "digest-mismatch",
      expected: triage.normalized_digest,
      actual: actualDigest
    });
    let authorityFailure = null;
    try {
      const source = readSnapshotJson(triage.source, `recorded triage ${index + 1}`);
      const reconstructed = normalizeTriageDecisions(
        run,
        source,
        triage.source.resolved_path
      );
      requireValue(canonicalDigest({ decisions: reconstructed }) === triage.normalized_digest,
        `recorded triage normalization changed: ${index + 1}`, 4);
    } catch (error) {
      authorityFailure = error.message;
    }
    checks.push({
      label: `triage-authority:${index + 1}`,
      path: publicSnapshot(triage.source).path,
      ok: authorityFailure === null,
      reason: authorityFailure,
      expected: triage.normalized_digest,
      actual: authorityFailure === null ? triage.normalized_digest : null
    });
    for (const decision of triage.decisions) {
      for (const evidence of decision.evidence) check(`triage-evidence:${decision.finding_ref}`, evidence);
    }
  }
  if (approval?.source) {
    check("owner-approval", approval.source);
    let authorityFailure = null;
    try {
      const source = readSnapshotJson(approval.source, "owner approval");
      const reconstructed = normalizeApproval(
        run,
        source,
        approval.source.resolved_path,
        approval.source
      );
      requireValue(reconstructed.normalized_digest === approval.normalized_digest,
        "owner approval normalization changed", 4);
    } catch (error) {
      authorityFailure = error.message;
    }
    checks.push({
      label: "owner-approval-authority",
      path: publicSnapshot(approval.source).path,
      ok: authorityFailure === null,
      reason: authorityFailure,
      expected: approval.normalized_digest,
      actual: authorityFailure === null ? approval.normalized_digest : null
    });
  }
  return checks;
}

function normalizeApproval(run, input, sourcePath, sourceSnapshotOverride = null) {
  if (!input) return null;
  requireValue(input.approval_version === 1, "approval_version must be 1");
  requireValue(input.run_id === run.run_id, "approval run_id does not match the audit run");
  verifyJourneyIdentity(input.journey_identity, {
    runId: run.run_id,
    routerId: run.route.router_id,
    routerVersion: run.route.router_version,
    label: "owner approval journey_identity"
  });
  requireValue(identitiesMatch(input.journey_identity, run.journey_identity),
    "approval journey_identity does not match the audit run");
  requireValue(input.scope_digest === run.approval_scope_digest,
    "approval scope_digest does not match the audit run");
  if (run.baseline_lineage) {
    requireValue(
      input.baseline_lineage_digest === run.baseline_lineage.lineage_digest,
      "approval baseline_lineage_digest does not match the audit run"
    );
  } else {
    requireValue(input.baseline_lineage_digest === undefined,
      "approval cannot add baseline_lineage to an unbound audit run");
  }
  requireValue(["approved", "rejected"].includes(input.status),
    "approval status must be approved or rejected");
  requireValue(input.owner_id, "approval requires owner_id");
  requireValue(input.note, "approval requires an explicit note");
  requireValue(input.decided_at && !Number.isNaN(Date.parse(input.decided_at)),
    "approval requires a valid decided_at timestamp");
  if (run.creator.actor_id) {
    requireValue(input.owner_id !== run.creator.actor_id, "the artifact creator cannot approve the run");
  }
  const normalized = {
    status: input.status,
    owner_id: input.owner_id,
    note: input.note,
    decided_at: input.decided_at,
    journey_identity: input.journey_identity,
    scope_digest: input.scope_digest
  };
  if (run.baseline_lineage) {
    normalized.baseline_lineage_digest = input.baseline_lineage_digest;
  }
  return {
    ...normalized,
    source: sourcePath ? sourceSnapshot(sourcePath, run.root, sourceSnapshotOverride) : null,
    normalized_digest: canonicalDigest(normalized)
  };
}

function publicEvidence(evidence) {
  return { ...publicSnapshot(evidence), kind: evidence.kind, covers: evidence.covers,
    viewports: evidence.viewports, checks: evidence.checks };
}

function publicVisualIntent(intent) {
  if (!intent) return null;
  const { sources = [], authority = null, ...contract } = intent;
  return {
    ...contract,
    authority: authority ? {
      kind: authority.kind,
      authority_id: authority.authority_id,
      basis: authority.basis,
      decided_at: authority.decided_at,
      receipt_digest: authority.receipt_digest,
      evidence: (authority.evidence || []).map((item) => ({
        kind: item.kind,
        digest: item.digest
      }))
    } : null,
    sources: sources.map((source) => ({ kind: source.kind, digest: source.digest }))
  };
}

function publicVisualSignature(signature) {
  if (!signature) return null;
  const { sources = [], authority = null, ...contract } = signature;
  return {
    ...contract,
    authority: authority ? {
      kind: authority.kind,
      authority_id: authority.authority_id,
      basis: authority.basis,
      decided_at: authority.decided_at,
      receipt_digest: authority.receipt_digest,
      evidence: (authority.evidence || []).map((item) => ({
        kind: item.kind,
        digest: item.digest
      })),
      coverage: (authority.coverage || []).map((item) => ({
        aspect: item.aspect,
        evidence: item.evidence.map((evidence) => ({ ...evidence }))
      }))
    } : null,
    sources: sources.map((source) => ({ kind: source.kind, digest: source.digest }))
  };
}

function applyTriage(run) {
  const decisions = new Map();
  for (const entry of run.triage) {
    for (const decision of entry.decisions) decisions.set(decision.finding_ref, decision);
  }
  return decisions;
}

function stageEvaluation(run, resultByPacket) {
  return run.stages.filter((stage) => stage.id !== "approval").map((stage) => {
    const packets = run.packets.filter((packet) => packet.stage_id === stage.id);
    const requiredPackets = packets.filter((packet) => packet.required);
    const results = packets.map((packet) => resultByPacket.get(packet.packet_id)).filter(Boolean);
    if (stage.optional && results.length === 0) {
      return {
        stage_id: stage.id,
        required: false,
        status: "skipped_optional",
        packet_ids: packets.map((packet) => packet.packet_id),
        missing_packet_ids: [],
        checked_capabilities: [],
        missing_capabilities: [],
        blocked_packet_ids: []
      };
    }
    const missing = requiredPackets
      .filter((packet) => !resultByPacket.has(packet.packet_id))
      .map((packet) => packet.packet_id);
    const checked = new Set(results
      .filter((result) => result.normalized.verdict !== "block")
      .flatMap((result) => result.normalized.capabilities_checked));
    const missingCapabilities = stage.required_capabilities.filter((capability) => !checked.has(capability));
    const blockedResults = results
      .filter((result) => result.normalized.verdict === "block")
      .map((result) => result.packet_id);
    return {
      stage_id: stage.id,
      required: !stage.optional,
      status: blockedResults.length ? "blocked" : missing.length || missingCapabilities.length ? "incomplete" : "pass",
      packet_ids: packets.map((packet) => packet.packet_id),
      missing_packet_ids: missing,
      checked_capabilities: [...checked],
      missing_capabilities: missingCapabilities,
      blocked_packet_ids: blockedResults
    };
  });
}

export function finalizeAudit(run, {
  approval: approvalInput = null,
  approvalPath = null,
  approvalSourceSnapshot = null,
  now = null,
  authorityDigest = null
} = {}) {
  requireValue(run?.audit_run_version === 1, "finalize requires an audit run_version of 1");
  verifyAuditAuthority(run, authorityDigest, "audit finalization");
  const approval = normalizeApproval(run, approvalInput, approvalPath, approvalSourceSnapshot);
  const integrityChecks = verifyIntegrity(run, approval);
  const integrityFailures = integrityChecks.filter((check) => !check.ok);
  const resultByPacket = new Map(run.results.map((result) => [result.packet_id, result]));
  const stages = stageEvaluation(run, resultByPacket);
  const missing = stages.flatMap((stage) => [
    ...stage.missing_packet_ids.map((packet) => `missing result: ${packet}`),
    ...stage.missing_capabilities.map((capability) =>
      `${stage.stage_id} missing checked capability: ${capability}`)
  ]);
  const blockers = [
    ...integrityFailures.map((failure) => `integrity failure: ${failure.label} (${failure.reason})`),
    ...stages.flatMap((stage) => stage.blocked_packet_ids.map((packet) => `blocking verdict: ${packet}`))
  ];
  if (run.planning_gate) {
    try {
      const verifiedPlanning = verifyPlanningGateForAudit({
        project_id: run.route.project_id,
        input: run.route.input,
        planning_gate: run.planning_gate
      }, run.scope.kind, { artifacts: run.artifacts, root: run.root });
      if (!baselineLineagesMatch(
        verifiedPlanning?.baseline_lineage || null,
        run.baseline_lineage || null
      )) {
        throw new Error("audit baseline_lineage no longer matches verified planning authority");
      }
    } catch (error) {
      blockers.push(`planning gate verification failed: ${error.message}`);
    }
  }
  const triage = applyTriage(run);
  const hardBlockers = new Set(run.hard_blockers);
  const findings = [];

  for (const result of run.results) {
    for (const finding of result.normalized.findings) {
      const ref = `${result.packet_id}/${finding.id}`;
      const decision = triage.get(ref);
      const disposition = decision?.disposition || finding.disposition;
      const rationale = decision?.rationale || finding.rationale;
      const evidence = decision?.evidence || [];
      const hard = finding.severity === "blocker" ||
        hardBlockers.has(finding.rule_id) || hardBlockers.has(finding.category);
      if (result.normalized.stage_id === "static-discovery" && !decision) {
        blockers.push(`scanner candidate lacks explicit triage: ${ref}`);
      }
      if (["open", "deferred"].includes(disposition)) blockers.push(`unresolved finding: ${ref}`);
      if (hard && disposition === "accepted-risk") blockers.push(`hard blocker cannot be accepted: ${ref}`);
      if (["fixed", "false-positive", "accepted-risk", "informational"].includes(disposition) && !rationale) {
        blockers.push(`finding disposition lacks rationale: ${ref}`);
      }
      if (disposition === "fixed" && !evidence.length && !result.normalized.evidence.length) {
        blockers.push(`fixed finding lacks evidence: ${ref}`);
      }
      findings.push({
        ref,
        stage_id: result.normalized.stage_id,
        provider_id: result.normalized.provider_id,
        ...finding,
        disposition,
        rationale,
        triage_evidence: evidence.map(publicEvidence)
      });
    }
  }

  const findingRefs = new Set(findings.map((finding) => finding.ref));
  const resolutions = run.results
    .filter((result) => result.normalized.stage_id === "adjudication")
    .flatMap((result) => result.normalized.resolutions);
  const conflictPairs = [];
  for (const finding of findings) {
    for (const conflicting of finding.conflicts_with) {
      const conflictRef = conflicting.includes("/") ? conflicting : `${finding.ref.split("/")[0]}/${conflicting}`;
      if (!findingRefs.has(conflictRef)) {
        blockers.push(`conflict references unknown finding: ${finding.ref} -> ${conflictRef}`);
        continue;
      }
      const pair = [finding.ref, conflictRef].sort();
      if (!conflictPairs.some((candidate) => candidate[0] === pair[0] && candidate[1] === pair[1])) {
        conflictPairs.push(pair);
      }
    }
  }
  for (const pair of conflictPairs) {
    const resolved = resolutions.some((resolution) => pair.every((ref) => resolution.finding_refs.includes(ref)));
    if (!resolved) blockers.push(`reviewer conflict lacks adjudication: ${pair.join(" <> ")}`);
  }

  const uniqueBlockers = unique(blockers);
  const uniqueMissing = unique(missing);
  let status;
  if (uniqueBlockers.length) status = "blocked";
  else if (uniqueMissing.length) status = "incomplete";
  else if (approval?.status === "rejected") status = "rejected";
  else if (approval?.status === "approved") status = "approved";
  else if (!run.owner_approval_required) status = "critic_pass";
  else status = "critic_pass_owner_review_pending";

  const receipt = {
    audit_receipt_version: 1,
    run_id: run.run_id,
    journey_identity: run.journey_identity,
    generated_at: receiptTimestamp(run, approval, now),
    status,
    technical_status: uniqueBlockers.length ? "blocked" : uniqueMissing.length ? "incomplete" : "pass",
    scope: run.scope,
    route: {
      router_id: run.route.router_id,
      router_version: run.route.router_version,
      route_id: run.route.route_id,
      project_id: run.route.project_id,
      input: run.route.input,
      surface_resolution: run.route.surface_resolution || null,
      visual_intent: publicVisualIntent(run.visual_intent),
      visual_intent_sources: (run.visual_intent_sources || []).map(publicSnapshot),
      visual_signature: publicVisualSignature(run.visual_signature),
      visual_signature_sources: (run.visual_signature_sources || []).map(publicSnapshot),
      plan_digest: run.route.plan_digest,
      plan_source: finalPlanSourceSnapshot(run.route.plan_source),
      profile_source: publicSnapshot(run.route.profile_source)
    },
    manifest_digest: run.manifest_digest,
    audit_authority_digest: run.audit_authority_digest,
    creator: run.creator,
    artifacts: run.artifacts.map(publicSnapshot),
    stages,
    results: run.results.map((result) => ({
      run_id: result.normalized.run_id,
      packet_id: result.packet_id,
      packet_digest: result.normalized.packet_digest,
      journey_identity: result.normalized.journey_identity,
      ...(result.normalized.baseline_lineage_digest
        ? { baseline_lineage_digest: result.normalized.baseline_lineage_digest }
        : {}),
      source: publicSnapshot(result.source),
      normalized_digest: result.normalized_digest,
      provider_id: result.normalized.provider_id,
      participant: result.normalized.participant,
      ...(result.normalized.receipt_binding
        ? { receipt_binding: result.normalized.receipt_binding }
        : {}),
      provider_version: result.normalized.provider_version,
      reviewer: result.normalized.reviewer,
      verdict: result.normalized.verdict,
      evidence: result.normalized.evidence.map(publicEvidence)
    })),
    findings,
    conflict_resolutions: resolutions,
    integrity: {
      status: integrityFailures.length ? "failed" : "pass",
      checks: integrityChecks
    },
    blockers: uniqueBlockers,
    missing: uniqueMissing,
    owner_approval: approval ? {
      status: approval.status,
      owner_id: approval.owner_id,
      note: approval.note,
      decided_at: approval.decided_at,
      scope_digest: approval.scope_digest,
      journey_identity: approval.journey_identity,
      source: publicSnapshot(approval.source),
      normalized_digest: approval.normalized_digest
    } : {
      status: run.owner_approval_required ? "pending" : "not-required",
      journey_identity: run.journey_identity,
      scope_digest: run.approval_scope_digest
    },
    boundaries: [
      run.scope.claim,
      "scanner-candidates-require-explicit-triage",
      "scanner-zero-hits-is-not-design-approval",
      "surface-is-not-a-visual-style-preset",
      "editorial-treatment-requires-verified-visual-intent",
      "visual-signature-is-evidence-bound",
      "palette-frequency-is-not-style-authority",
      "external-review-results-are-provenance-not-project-authority",
      ...(run.baseline_lineage ? [
        "latest-version-never-promotes-a-parent-baseline",
        "slice-candidates-inherit-a-digest-bound-parent-baseline"
      ] : []),
      "KillSlopRouter-is-the-parent-and-provider-names-are-internal-roles",
      "owner-approval-is-explicit-and-never-inferred"
    ]
  };
  if (run.baseline_lineage) {
    receipt.baseline_lineage = run.baseline_lineage;
    receipt.owner_approval.baseline_lineage_digest = run.baseline_lineage.lineage_digest;
  }
  receipt.receipt_digest = canonicalDigest(receipt);
  return receipt;
}

export function formatAuditReceipt(receipt) {
  const lines = [
    `KillSlopRouter audit ${receipt.run_id}`,
    `orchestrator: ${receipt.journey_identity?.display_name || "identity-missing"}`,
    `status: ${receipt.status}`,
    `technical: ${receipt.technical_status}`,
    `scope: ${receipt.scope.kind} (${receipt.scope.claim})`,
    `artifacts: ${receipt.artifacts.length}`,
    ...(receipt.baseline_lineage ? [
      `baseline lineage: ${receipt.baseline_lineage.parent_baseline.id}@${receipt.baseline_lineage.parent_baseline.version} -> ` +
        `${receipt.baseline_lineage.candidate.slice_id}@${receipt.baseline_lineage.candidate.version}`,
      `lineage digest: ${receipt.baseline_lineage.lineage_digest}`
    ] : []),
    `stages: ${receipt.stages.filter((stage) => stage.status === "pass").length}/${receipt.stages.length} pass`,
    `findings: ${receipt.findings.length}`,
    `integrity: ${receipt.integrity.status}`,
    `owner: ${receipt.owner_approval.status}`,
    `receipt: ${receipt.receipt_digest}`
  ];
  for (const result of receipt.results || []) {
    lines.push(`internal ${result.participant?.role || "participant"}: ${result.provider_id}`);
  }
  for (const blocker of receipt.blockers) lines.push(`blocker: ${blocker}`);
  for (const missing of receipt.missing) lines.push(`missing: ${missing}`);
  return `${lines.join("\n")}\n`;
}

export function auditExitCode(receipt, { requireOwner = false } = {}) {
  if (receipt.status === "approved") return 0;
  if (receipt.status === "critic_pass") return 0;
  if (receipt.status === "critic_pass_owner_review_pending") return requireOwner ? 6 : 0;
  return 5;
}

export { writeJsonAtomic };
