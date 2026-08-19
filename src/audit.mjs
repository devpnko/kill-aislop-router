import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  RouterError,
  readJson,
  resolveVisualIntent,
  resolveVisualSignature,
  visualIntentRequired
} from "./router.mjs";
import {
  canonicalDigest,
  publicSnapshot,
  snapshotArtifact,
  verifySnapshot,
  writeJsonAtomic
} from "./integrity.mjs";
import { verifyPlanningGateForAudit } from "./planning.mjs";

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

function auditManifest(run) {
  return {
    audit_run_version: run.audit_run_version,
    run_id: run.run_id,
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
    hard_blockers: run.hard_blockers,
    invariants: run.invariants,
    owner_approval_required: run.owner_approval_required,
    stages: run.stages,
    packets: run.packets,
    approval_scope_digest: run.approval_scope_digest
  };
}

function sameDigestMap(actual, expected) {
  if (!actual || typeof actual !== "object" || Array.isArray(actual)) return false;
  const actualKeys = Object.keys(actual).sort();
  const expectedKeys = Object.keys(expected).sort();
  return actualKeys.length === expectedKeys.length &&
    actualKeys.every((key, index) => key === expectedKeys[index] && actual[key] === expected[key]);
}

function makePackets(plan, artifacts) {
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
        stage_id: stage.id,
        stage_question: stage.question,
        required: !stage.optional && !actor.optional,
        provider: {
          id: actor.id,
          kind: actor.kind,
          version: actor.version || null,
          executor: actor.executor || null,
          fallback_for: actor.fallback_for || null,
          resolved_to: actor.resolved_to || null
        },
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
      packet.packet_digest = canonicalDigest(packet);
      packets.push(packet);
    }
  }
  return packets;
}

export function initializeAudit({
  plan,
  planPath = null,
  artifacts,
  scope,
  creatorActorId = null,
  root = process.cwd(),
  runId = crypto.randomUUID(),
  now = null
}) {
  requireValue(plan?.receipt_version === 1, "audit init requires a route receipt_version of 1");
  requireValue(plan.status === "planned", `cannot initialize audit from route status: ${plan.status}`);
  requireValue(VALID_SCOPES.has(scope), "audit scope must be mockup, runtime, source, or document");
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
  let planningGate = null;
  try {
    planningGate = verifyPlanningGateForAudit(plan, scope);
  } catch (error) {
    throw new RouterError(error.message, 3);
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

  const planSource = planPath
    ? snapshotArtifact(path.resolve(planPath), { root: absoluteRoot })
    : null;
  let profileSource = null;
  if (plan.profile_path && plan.profile_digest) {
    try {
      profileSource = snapshotArtifact(path.resolve(plan.profile_path), { root: absoluteRoot });
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
      readJson(plan.profile_path, "routed project profile"),
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
      readJson(plan.profile_path, "routed project profile"),
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
  const packets = makePackets(plan, artifactSnapshots);
  const requiredStagesWithoutPackets = plan.stages
    .filter((stage) => !stage.optional && stage.id !== "approval")
    .filter((stage) => !(stage.selected_actors || []).length)
    .map((stage) => stage.id);
  requireValue(
    requiredStagesWithoutPackets.length === 0,
    `required stages have no dispatchable actors: ${requiredStagesWithoutPackets.join(", ")}`,
    3
  );

  const createdAt = nowIso(now);
  const approvalScopeDigest = canonicalDigest({
    run_id: runId,
    plan_digest: canonicalDigest(plan),
    scope,
    planning_gate: planningGate,
    visual_intent: plan.visual_intent || null,
    visual_intent_sources: visualIntentSources.map((source) => source.digest),
    visual_signature: plan.visual_signature || null,
    visual_signature_sources: visualSignatureSources.map((source) => source.digest),
    creator: { provider_id: plan.creator || null, actor_id: creatorActorId || null },
    artifacts: artifactDigestMap(artifactSnapshots),
    packets: packets.map((packet) => packet.packet_digest)
  });

  const run = {
    audit_run_version: 1,
    run_id: runId,
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
    creator: { provider_id: plan.creator || null, actor_id: creatorActorId || null },
    artifacts: artifactSnapshots,
    evidence_contract: plan.evidence_contract || null,
    hard_blockers: plan.adjudication?.hard_blockers || [],
    invariants: plan.invariants || {},
    owner_approval_required: plan.stages.some((stage) => stage.id === "approval" && !stage.optional),
    stages: plan.stages.map((stage) => ({
      id: stage.id,
      question: stage.question,
      optional: Boolean(stage.optional),
      required_capabilities: stage.required_capabilities || [],
      evidence_required: Boolean(stage.evidence_required),
      required_evidence_kinds: stage.required_evidence_kinds || []
    })),
    packets,
    results: [],
    triage: [],
    approval_scope_digest: approvalScopeDigest
  };
  run.manifest_digest = canonicalDigest(auditManifest(run));
  return run;
}

function resultTemplate(run, packet) {
  const browserEvidence = packet.stage_id === "browser-evidence";
  const requiredViewports = packet.evidence_contract?.required_viewports || [];
  const requiredChecks = packet.evidence_contract?.required_checks || [];
  const screenshotTemplates = requiredViewports.length ? requiredViewports.map((viewport) => ({
    path: `replace-with-${viewport}-screenshot-file`,
    kind: "screenshot",
    covers: packet.assigned_capabilities,
    viewports: [viewport],
    checks: []
  })) : [{
    path: "replace-with-screenshot-file",
    kind: "screenshot",
    covers: packet.assigned_capabilities,
    viewports: [],
    checks: []
  }];
  return {
    audit_result_version: 1,
    packet_id: packet.packet_id,
    provider_id: packet.provider.id,
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
        checks: requiredChecks
      }
    ] : [],
    resolutions: [],
    started_at: run.created_at,
    finished_at: run.created_at
  };
}

export function dispatchAuditPackets(run, outDir) {
  requireValue(run?.audit_run_version === 1, "dispatch requires an audit run_version of 1");
  const absoluteOut = path.resolve(outDir);
  fs.mkdirSync(absoluteOut, { recursive: true });
  const written = [];
  for (const packet of run.packets) {
    const target = path.join(absoluteOut, `${packet.packet_id}.json`);
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
  const approvalTemplate = path.join(absoluteOut, "owner-approval.template.json");
  writeJsonAtomic(approvalTemplate, {
    approval_version: 1,
    run_id: run.run_id,
    scope_digest: run.approval_scope_digest,
    owner_id: "replace-with-owner-identity",
    status: "approved",
    note: "replace-with-explicit-owner-decision",
    decided_at: run.created_at
  });
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

function snapshotEvidence(items, sourcePath, root) {
  const sourceDirectory = path.dirname(path.resolve(sourcePath));
  return (items || []).map((item, index) => {
    requireValue(item?.path, `evidence ${index + 1} requires path`);
    requireValue(item.kind, `evidence ${index + 1} requires kind`);
    const resolved = path.isAbsolute(item.path) ? item.path : path.resolve(sourceDirectory, item.path);
    let snapshot;
    try {
      snapshot = snapshotArtifact(resolved, { root, label: item.path });
    } catch (error) {
      throw new RouterError(`cannot snapshot evidence ${item.path}: ${error.message}`, 4);
    }
    return {
      ...snapshot,
      kind: item.kind,
      covers: unique(item.covers || []),
      viewports: unique(item.viewports || []),
      checks: unique(item.checks || [])
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

function sourceSnapshot(sourcePath, root) {
  try {
    return snapshotArtifact(sourcePath, { root });
  } catch (error) {
    throw new RouterError(`cannot snapshot result source: ${error.message}`, 4);
  }
}

function standardResult(run, input, sourcePath) {
  requireValue(input.audit_result_version === 1, "result audit_result_version must be 1");
  const packet = run.packets.find((candidate) => candidate.packet_id === input.packet_id);
  requireValue(packet, `unknown packet_id: ${input.packet_id}`);
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
  const evidence = snapshotEvidence(input.evidence || [], sourcePath, run.root);
  validateEvidenceCoverage(packet, evidence);
  const resolutions = (input.resolutions || []).map(normalizeResolution);
  const normalized = {
    packet_id: packet.packet_id,
    stage_id: packet.stage_id,
    provider_id: packet.provider.id,
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
  return {
    packet_id: packet.packet_id,
    source: sourceSnapshot(sourcePath, run.root),
    normalized,
    normalized_digest: canonicalDigest(normalized),
    recorded_at: nowIso()
  };
}

function adapterResult(run, input, sourcePath) {
  requireValue(input.adapter_receipt_version === 1, "adapter receipt version must be 1");
  const candidates = run.packets.filter((packet) =>
    packet.stage_id === input.stage && packet.provider.id === input.tool_id
  );
  requireValue(candidates.length === 1,
    `adapter receipt must resolve to exactly one packet; found ${candidates.length}`);
  const packet = candidates[0];
  requireValue(run.artifacts.length === 1,
    "single adapter receipts require an audit run with one root artifact; aggregate multi-artifact scans first");
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
    packet_id: packet.packet_id,
    stage_id: packet.stage_id,
    provider_id: packet.provider.id,
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
  return {
    packet_id: packet.packet_id,
    source: sourceSnapshot(sourcePath, run.root),
    normalized,
    normalized_digest: canonicalDigest(normalized),
    recorded_at: nowIso()
  };
}

export function recordAuditResult(run, input, sourcePath, { replace = false, now = null } = {}) {
  requireValue(run?.audit_run_version === 1, "record requires an audit run_version of 1");
  requireValue(sourcePath, "record requires a result source path");
  const record = input.adapter_receipt_version
    ? adapterResult(run, input, sourcePath)
    : standardResult(run, input, sourcePath);
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

export function recordTriage(run, input, sourcePath, { replace = false, now = null } = {}) {
  requireValue(input?.triage_version === 1, "triage_version must be 1");
  requireValue(Array.isArray(input.decisions) && input.decisions.length > 0,
    "triage requires at least one decision");
  const findings = findingIndex(run);
  const existingRefs = new Set(run.triage.flatMap((entry) => entry.decisions.map((item) => item.finding_ref)));
  const decisions = input.decisions.map((decision, index) => {
    requireValue(findings.has(decision.finding_ref),
      `triage decision ${index + 1} references unknown finding: ${decision.finding_ref}`);
    requireValue(VALID_DISPOSITIONS.has(decision.disposition) && decision.disposition !== "open",
      `triage decision ${decision.finding_ref} requires a non-open disposition`);
    requireValue(decision.rationale, `triage decision ${decision.finding_ref} requires rationale`);
    requireValue(!existingRefs.has(decision.finding_ref) || replace,
      `triage already recorded for ${decision.finding_ref}; use --replace`);
    return {
      finding_ref: decision.finding_ref,
      disposition: decision.disposition,
      rationale: decision.rationale,
      decided_by: decision.decided_by || null,
      evidence: snapshotEvidence(decision.evidence || [], sourcePath, run.root)
    };
  });
  const normalized = { decisions };
  const entry = {
    source: sourceSnapshot(sourcePath, run.root),
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

function verifyIntegrity(run, approval) {
  const manifestDigest = canonicalDigest(auditManifest(run));
  const checks = [{
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
    for (const decision of triage.decisions) {
      for (const evidence of decision.evidence) check(`triage-evidence:${decision.finding_ref}`, evidence);
    }
  }
  if (approval?.source) check("owner-approval", approval.source);
  return checks;
}

function normalizeApproval(run, input, sourcePath) {
  if (!input) return null;
  requireValue(input.approval_version === 1, "approval_version must be 1");
  requireValue(input.run_id === run.run_id, "approval run_id does not match the audit run");
  requireValue(input.scope_digest === run.approval_scope_digest,
    "approval scope_digest does not match the audit run");
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
    scope_digest: input.scope_digest
  };
  return {
    ...normalized,
    source: sourcePath ? sourceSnapshot(sourcePath, run.root) : null,
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

export function finalizeAudit(run, { approval: approvalInput = null, approvalPath = null, now = null } = {}) {
  requireValue(run?.audit_run_version === 1, "finalize requires an audit run_version of 1");
  const approval = normalizeApproval(run, approvalInput, approvalPath);
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
      verifyPlanningGateForAudit({
        project_id: run.route.project_id,
        input: run.route.input,
        planning_gate: run.planning_gate
      }, run.scope.kind);
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
      plan_source: publicSnapshot(run.route.plan_source),
      profile_source: publicSnapshot(run.route.profile_source)
    },
    manifest_digest: run.manifest_digest,
    creator: run.creator,
    artifacts: run.artifacts.map(publicSnapshot),
    stages,
    results: run.results.map((result) => ({
      packet_id: result.packet_id,
      source: publicSnapshot(result.source),
      normalized_digest: result.normalized_digest,
      provider_id: result.normalized.provider_id,
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
      source: publicSnapshot(approval.source),
      normalized_digest: approval.normalized_digest
    } : {
      status: run.owner_approval_required ? "pending" : "not-required",
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
      "owner-approval-is-explicit-and-never-inferred"
    ]
  };
  receipt.receipt_digest = canonicalDigest(receipt);
  return receipt;
}

export function formatAuditReceipt(receipt) {
  const lines = [
    `KillSlopRouter audit ${receipt.run_id}`,
    `status: ${receipt.status}`,
    `technical: ${receipt.technical_status}`,
    `scope: ${receipt.scope.kind} (${receipt.scope.claim})`,
    `artifacts: ${receipt.artifacts.length}`,
    `stages: ${receipt.stages.filter((stage) => stage.status === "pass").length}/${receipt.stages.length} pass`,
    `findings: ${receipt.findings.length}`,
    `integrity: ${receipt.integrity.status}`,
    `owner: ${receipt.owner_approval.status}`,
    `receipt: ${receipt.receipt_digest}`
  ];
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
