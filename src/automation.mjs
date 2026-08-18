import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  dispatchAuditPackets,
  finalizeAudit,
  initializeAudit,
  recordAuditResult,
  recordTriage,
  writeJsonAtomic
} from "./audit.mjs";
import { executeAuditPacket, hostReadiness, inspectPacketAdapter } from "./execution.mjs";
import { canonicalDigest, hashArtifact } from "./integrity.mjs";
import { verifyPlanningGateForAudit } from "./planning.mjs";
import { RouterError, planRoute, readJson } from "./router.mjs";

const STEP_FILES = {
  plan: "01-plan-receipt.json",
  "planning-verification": "02-planning-verification-receipt.json",
  "audit-init": "03-audit-init-receipt.json",
  dispatch: "04-dispatch-receipt.json",
  execution: "05-execution-receipt.json",
  "result-ingest": "06-result-ingest-receipt.json",
  "scanner-triage": "07-scanner-triage-receipt.json",
  "conflict-adjudication": "08-conflict-adjudication-receipt.json",
  finalize: "09-finalize-receipt.json"
};

const COMPLETED_AUDIT_STATUSES = new Set(["approved", "critic_pass"]);

function requireValue(condition, message, exitCode = 2) {
  if (!condition) throw new RouterError(message, exitCode);
}

function nowIso(now = null) {
  return (now ? new Date(now) : new Date()).toISOString();
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function stateManifest(state) {
  const { state_digest: _stateDigest, ...manifest } = state;
  return manifest;
}

function sealState(state) {
  state.state_digest = canonicalDigest(stateManifest(state));
  return state;
}

function writeState(state) {
  state.updated_at = nowIso();
  sealState(state);
  writeJsonAtomic(state.state_path, state);
}

function snapshotPath(filePath) {
  return { path: path.resolve(filePath), digest: hashArtifact(filePath) };
}

function stateDirectory(statePath) {
  const absolute = path.resolve(statePath);
  const extension = path.extname(absolute);
  const stem = extension ? absolute.slice(0, -extension.length) : absolute;
  return `${stem}.d`;
}

function inside(candidate, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === "" || (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function validateStateArtifactSeparation(statePath, artifacts, root) {
  const stateTargets = [path.resolve(statePath), stateDirectory(statePath)];
  for (const artifact of artifacts) {
    const absoluteArtifact = path.resolve(root, artifact);
    if (!fs.existsSync(absoluteArtifact) || !fs.lstatSync(absoluteArtifact).isDirectory()) continue;
    for (const target of stateTargets) {
      if (!inside(target, absoluteArtifact)) continue;
      const relative = path.relative(absoluteArtifact, target);
      const first = relative.split(path.sep)[0];
      requireValue(first === ".killsloprouter",
        "automation state must be outside directory artifacts or under their ignored .killsloprouter directory",
        2);
    }
  }
}

function receiptBody(runId, stepId, status, attempt, payload) {
  const receipt = {
    automation_step_receipt_version: 1,
    run_id: runId,
    step_id: stepId,
    status,
    attempt,
    generated_at: nowIso(),
    payload
  };
  receipt.receipt_digest = canonicalDigest(receipt);
  return receipt;
}

function recordStep(state, stepId, status, payload) {
  const previous = state.steps[stepId];
  const attempt = (previous?.attempt || 0) + 1;
  const receipt = receiptBody(state.run_id, stepId, status, attempt, payload);
  const receiptPath = path.join(state.state_directory, "receipts", STEP_FILES[stepId]);
  writeJsonAtomic(receiptPath, receipt);
  state.steps[stepId] = {
    status,
    attempt,
    receipt_path: receiptPath,
    receipt_digest: receipt.receipt_digest,
    file_digest: hashArtifact(receiptPath)
  };
  writeState(state);
  return receipt;
}

function verifyStepReceipt(stepId, step) {
  requireValue(fs.existsSync(step.receipt_path), `automation step receipt is missing: ${stepId}`, 4);
  requireValue(hashArtifact(step.receipt_path) === step.file_digest,
    `automation step receipt changed: ${stepId}`, 4);
  const receipt = readJson(step.receipt_path, `automation ${stepId} receipt`);
  const expected = receipt.receipt_digest;
  const copy = { ...receipt };
  delete copy.receipt_digest;
  requireValue(canonicalDigest(copy) === expected && expected === step.receipt_digest,
    `automation step receipt digest mismatch: ${stepId}`, 4);
}

export function readAutomationState(statePath) {
  const absolute = path.resolve(statePath);
  const state = readJson(absolute, "automation run");
  requireValue(state?.automation_run_version === 1, "automation_run_version must be 1");
  requireValue(path.resolve(state.state_path) === absolute,
    "automation state path does not match the resume target", 4);
  const expected = state.state_digest;
  requireValue(canonicalDigest(stateManifest(state)) === expected,
    "automation state digest mismatch", 4);
  if (state.request?.profile_path && state.request.profile_digest) {
    try {
      requireValue(fs.existsSync(state.request.profile_path), "automation profile is missing", 4);
      requireValue(hashArtifact(state.request.profile_path) === state.request.profile_digest,
        "automation profile changed after surface routing", 4);
    } catch (error) {
      if (error instanceof RouterError) throw error;
      throw new RouterError(`cannot verify automation profile: ${error.message}`, 4);
    }
  }
  for (const [stepId, step] of Object.entries(state.steps || {})) verifyStepReceipt(stepId, step);
  for (const [key, snapshot] of Object.entries(state.paths || {})) {
    if (!snapshot) continue;
    requireValue(fs.existsSync(snapshot.path), `automation ${key} file is missing`, 4);
    requireValue(hashArtifact(snapshot.path) === snapshot.digest,
      `automation ${key} file changed outside the orchestrator`, 4);
  }
  return state;
}

function newState({ statePath, routerPath, profilePath, input, artifacts, scope, creatorActorId, root }) {
  const absoluteStatePath = path.resolve(statePath);
  const directory = stateDirectory(absoluteStatePath);
  return sealState({
    automation_run_version: 1,
    run_id: crypto.randomUUID(),
    status: "running",
    created_at: nowIso(),
    updated_at: nowIso(),
    state_path: absoluteStatePath,
    state_directory: directory,
    request: {
      router_path: path.resolve(routerPath),
      profile_path: profilePath ? path.resolve(profilePath) : null,
      profile_digest: profilePath ? profileDigest(path.resolve(profilePath)) : null,
      root: path.resolve(root),
      input,
      artifacts: artifacts.map((artifact) => path.resolve(root, artifact)),
      scope,
      creator_actor_id: creatorActorId || null
    },
    paths: {},
    steps: {},
    attempts: [],
    blockers: [],
    pending: [],
    final_audit_status: null,
    final_receipt_digest: null,
    state_digest: null
  });
}

function profileDigest(profilePath) {
  try {
    return hashArtifact(profilePath);
  } catch (error) {
    throw new RouterError(`cannot bind automation profile: ${error.message}`, 4);
  }
}

function planPayload(plan, planPath = null) {
  return {
    status: plan.status,
    route_id: plan.route_id,
    creator: plan.creator,
    visual_intent: plan.visual_intent ? {
      status: plan.visual_intent.status,
      mode: plan.visual_intent.mode || null,
      editorial_treatment: plan.visual_intent.editorial_treatment || null,
      authority_status: plan.visual_intent.authority_status,
      contract_digest: plan.visual_intent.contract_digest
    } : null,
    unresolved: plan.unresolved,
    warnings: plan.warnings,
    plan_path: planPath,
    plan_digest: canonicalDigest(plan),
    routing: plan.stages.map((stage) => ({
      stage_id: stage.id,
      status: stage.routing_status,
      selected_providers: stage.selected_actors.map((actor) => actor.id),
      missing_capabilities: stage.missing_capabilities
    }))
  };
}

export function dryRunAutomation({
  router,
  profile,
  routerPath,
  profilePath = null,
  input,
  artifacts,
  scope,
  creatorActorId = null,
  hostManifest = null,
  root = process.cwd()
}) {
  const plan = planRoute({
    router,
    profile,
    routerPath,
    profilePath,
    input,
    artifacts,
    root
  });
  const report = {
    automation_dry_run_version: 1,
    status: plan.status === "planned" ? "dry_run" : "blocked",
    generated_at: nowIso(),
    plan: planPayload(plan),
    planning_verification: null,
    host_readiness: [],
    blockers: [...plan.unresolved]
  };
  if (plan.status !== "planned") {
    report.receipt_digest = canonicalDigest(report);
    return report;
  }
  try {
    const planning = verifyPlanningGateForAudit(plan, scope);
    report.planning_verification = {
      status: "verified",
      receipt_digest: planning?.receipt_digest || null,
      requirements: planning?.requirements || []
    };
    const audit = initializeAudit({
      plan,
      artifacts,
      scope,
      creatorActorId,
      root,
      runId: "dry-run"
    });
    report.host_readiness = hostReadiness(audit, hostManifest);
    report.pending = report.host_readiness
      .filter((item) => item.execution_status !== "ready")
      .map((item) => `${item.packet_id}: ${item.reason}`);
  } catch (error) {
    report.status = "blocked";
    report.blockers.push(error.message);
  }
  report.receipt_digest = canonicalDigest(report);
  return report;
}

function updateAudit(state, audit) {
  writeJsonAtomic(state.paths.audit.path, audit);
  state.paths.audit = snapshotPath(state.paths.audit.path);
  writeState(state);
}

function lastAttempt(state, packetId) {
  return [...state.attempts].reverse().find((attempt) => attempt.packet_id === packetId) || null;
}

function retrySelection(value) {
  if (!value) return new Set();
  const values = Array.isArray(value) ? value : String(value).split(",");
  return new Set(values.map((item) => item.trim()).filter(Boolean));
}

function explicitlySelected(packet, selectors) {
  return selectors.has(packet.packet_id) ||
    selectors.has(packet.provider.id) ||
    selectors.has(packet.stage_id);
}

function shouldAttemptPacket(state, audit, packet, selectors, manifest) {
  const recorded = audit.results.some((result) => result.packet_id === packet.packet_id);
  const last = lastAttempt(state, packet.packet_id);
  if (recorded) return explicitlySelected(packet, selectors);
  if (!last) return true;
  if (last.execution_status === "blocked_execution_error") {
    return selectors.has("all") || explicitlySelected(packet, selectors);
  }
  if (last.execution_status === "manual_pending") {
    const inspection = inspectPacketAdapter(packet, manifest);
    return inspection.execution_status === "ready" ||
      inspection.reason !== last.reason ||
      inspection.host_manifest_digest !== last.host_manifest_digest;
  }
  return true;
}

function attemptNumber(state, packetId) {
  return state.attempts.filter((attempt) => attempt.packet_id === packetId).length + 1;
}

function executionAttemptSummary(attempt) {
  const { result: _result, ...summary } = attempt;
  return summary;
}

function runPackets(state, audit, packets, hostManifest, selectors) {
  const evidenceRoot = path.join(state.state_directory, "evidence");
  const resultsRoot = path.join(state.state_directory, "results");
  fs.mkdirSync(evidenceRoot, { recursive: true });
  fs.mkdirSync(resultsRoot, { recursive: true });
  let nextAudit = audit;

  for (const packet of packets) {
    if (!shouldAttemptPacket(state, nextAudit, packet, selectors, hostManifest)) continue;
    const attempt = attemptNumber(state, packet.packet_id);
    const outputDirectory = path.join(evidenceRoot, packet.packet_id, `attempt-${attempt}`);
    const executed = executeAuditPacket({
      run: nextAudit,
      packet,
      manifest: hostManifest,
      attempt,
      outputDirectory
    });
    const record = {
      ...executionAttemptSummary(executed),
      recorded_at: nowIso(),
      result_path: null,
      result_digest: null,
      ingest_status: executed.execution_status === "ran" ? "pending" : "not-recorded"
    };

    if (executed.execution_status === "ran") {
      const resultPath = path.join(resultsRoot, `${packet.packet_id}.attempt-${attempt}.json`);
      writeJsonAtomic(resultPath, executed.result);
      record.result_path = resultPath;
      record.result_digest = hashArtifact(resultPath);
      try {
        const replace = nextAudit.results.some((result) => result.packet_id === packet.packet_id);
        nextAudit = recordAuditResult(nextAudit, executed.result, resultPath, { replace });
        record.ingest_status = "recorded";
      } catch (error) {
        record.execution_status = "blocked_execution_error";
        record.ingest_status = "rejected";
        record.error = error.message;
      }
    }
    state.attempts.push(record);
    updateAudit(state, nextAudit);
  }
  return nextAudit;
}

function missingRequiredPackets(audit, packets) {
  const recorded = new Set(audit.results.map((result) => result.packet_id));
  return packets.filter((packet) => packet.required && !recorded.has(packet.packet_id));
}

function pendingForPackets(state, packets) {
  return packets.map((packet) => {
    const last = lastAttempt(state, packet.packet_id);
    return `${packet.packet_id}: ${last?.reason || last?.error || "result not recorded"}`;
  });
}

function hasExecutionError(state, packets) {
  return packets.some((packet) => lastAttempt(state, packet.packet_id)?.execution_status === "blocked_execution_error");
}

function checkpointExecution(state, audit, consideredPackets) {
  const missing = missingRequiredPackets(audit, consideredPackets);
  const status = missing.length
    ? hasExecutionError(state, missing) ? "blocked" : "manual_pending"
    : "completed";
  recordStep(state, "execution", status, {
    attempts: state.attempts.map(executionAttemptSummary),
    host_manifest_digests: unique(state.attempts.map((attempt) => attempt.host_manifest_digest))
  });
  recordStep(state, "result-ingest", status, {
    audit_path: state.paths.audit.path,
    audit_digest: state.paths.audit.digest,
    result_count: audit.results.length,
    missing_packets: missing.map((packet) => packet.packet_id),
    results: audit.results.map((result) => ({
      packet_id: result.packet_id,
      provider_id: result.normalized.provider_id,
      normalized_digest: result.normalized_digest,
      source_digest: result.source.digest
    }))
  });
}

function scannerFindingRefs(audit) {
  return audit.results
    .filter((result) => result.normalized.stage_id === "static-discovery")
    .flatMap((result) => result.normalized.findings.map((finding) =>
      `${result.packet_id}/${finding.id}`));
}

function triagedRefs(audit) {
  return new Set(audit.triage.flatMap((entry) => entry.decisions.map((decision) => decision.finding_ref)));
}

function applyScannerTriage(state, audit, triagePath) {
  let nextAudit = audit;
  let pending = scannerFindingRefs(nextAudit).filter((ref) => !triagedRefs(nextAudit).has(ref));
  if (pending.length && triagePath) {
    const absolute = path.resolve(triagePath);
    nextAudit = recordTriage(nextAudit, readJson(absolute, "scanner triage"), absolute);
    updateAudit(state, nextAudit);
    pending = scannerFindingRefs(nextAudit).filter((ref) => !triagedRefs(nextAudit).has(ref));
  }
  recordStep(state, "scanner-triage", pending.length ? "manual_pending" : "completed", {
    scanner_findings: scannerFindingRefs(nextAudit),
    triaged_findings: [...triagedRefs(nextAudit)],
    pending_findings: pending,
    audit_digest: state.paths.audit.digest
  });
  return { audit: nextAudit, pending };
}

function conflictPairs(audit) {
  const refs = new Set();
  const pairs = [];
  for (const result of audit.results) {
    for (const finding of result.normalized.findings) {
      refs.add(`${result.packet_id}/${finding.id}`);
    }
  }
  for (const result of audit.results) {
    for (const finding of result.normalized.findings) {
      const own = `${result.packet_id}/${finding.id}`;
      for (const value of finding.conflicts_with || []) {
        const other = value.includes("/") ? value : `${result.packet_id}/${value}`;
        if (!refs.has(other)) continue;
        const pair = [own, other].sort();
        if (!pairs.some((candidate) => candidate[0] === pair[0] && candidate[1] === pair[1])) {
          pairs.push(pair);
        }
      }
    }
  }
  return pairs;
}

function unresolvedConflictPairs(audit) {
  const resolutions = audit.results
    .filter((result) => result.normalized.stage_id === "adjudication")
    .flatMap((result) => result.normalized.resolutions);
  return conflictPairs(audit).filter((pair) =>
    !resolutions.some((resolution) => pair.every((ref) => resolution.finding_refs.includes(ref))));
}

function tamperBlockers(audit) {
  const preflight = finalizeAudit(audit);
  return preflight.blockers.filter((blocker) =>
    blocker.startsWith("integrity failure:") || blocker.startsWith("planning gate verification failed:"));
}

function partitionManualResults(audit, resultPaths = []) {
  const partitioned = { review: [], adjudication: [] };
  for (const value of resultPaths) {
    const resultPath = path.resolve(value);
    const input = readJson(resultPath, "manual audit result");
    let packet;
    if (input.audit_result_version === 1) {
      packet = audit.packets.find((candidate) => candidate.packet_id === input.packet_id);
    } else if (input.adapter_receipt_version === 1) {
      const candidates = audit.packets.filter((candidate) =>
        candidate.stage_id === input.stage && candidate.provider.id === input.tool_id);
      requireValue(candidates.length === 1,
        `manual adapter result must resolve to exactly one packet: ${resultPath}`);
      [packet] = candidates;
    }
    requireValue(packet, `manual result references an unknown packet: ${resultPath}`);
    const target = packet.stage_id === "adjudication" ? partitioned.adjudication : partitioned.review;
    target.push({ resultPath, input });
  }
  return partitioned;
}

function ingestManualResults(state, audit, entries = []) {
  let nextAudit = audit;
  for (const { resultPath, input } of entries) {
    const before = new Set(nextAudit.results.map((result) => result.packet_id));
    nextAudit = recordAuditResult(nextAudit, input, resultPath);
    const added = nextAudit.results.find((result) => !before.has(result.packet_id));
    requireValue(added, `manual result did not add a packet: ${resultPath}`, 4);
    state.attempts.push({
      packet_id: added.packet_id,
      provider_id: added.normalized.provider_id,
      adapter: "manual-v1",
      host_manifest_digest: null,
      permission_scopes: [],
      strength: null,
      capabilities: added.normalized.capabilities_checked,
      attempt: attemptNumber(state, added.packet_id),
      execution_status: "manual_recorded",
      started_at: added.normalized.started_at,
      finished_at: added.normalized.finished_at,
      child_pid: null,
      exit_code: null,
      signal: null,
      recorded_at: nowIso(),
      result_path: resultPath,
      result_digest: hashArtifact(resultPath),
      ingest_status: "recorded"
    });
    updateAudit(state, nextAudit);
  }
  return nextAudit;
}

function stop(state, status, blockers, pending = []) {
  state.status = status;
  state.blockers = unique(blockers);
  state.pending = unique(pending);
  writeState(state);
  return state;
}

function finalizeAutomation(state, audit, approvalPath) {
  let approval = null;
  let absoluteApprovalPath = null;
  if (approvalPath) {
    absoluteApprovalPath = path.resolve(approvalPath);
    approval = readJson(absoluteApprovalPath, "owner approval");
  }
  const receipt = finalizeAudit(audit, { approval, approvalPath: absoluteApprovalPath });
  if (absoluteApprovalPath) state.paths.approval = snapshotPath(absoluteApprovalPath);
  const receiptPath = path.join(state.state_directory, "audit-receipt.json");
  writeJsonAtomic(receiptPath, receipt);
  state.paths.final = snapshotPath(receiptPath);
  state.final_audit_status = receipt.status;
  state.final_receipt_digest = receipt.receipt_digest;
  recordStep(state, "finalize", COMPLETED_AUDIT_STATUSES.has(receipt.status)
    ? "completed"
    : receipt.status === "critic_pass_owner_review_pending"
      ? "manual_pending"
      : "blocked", {
    audit_receipt_path: receiptPath,
    audit_receipt_file_digest: state.paths.final.digest,
    audit_receipt_digest: receipt.receipt_digest,
    status: receipt.status,
    technical_status: receipt.technical_status,
    blockers: receipt.blockers,
    missing: receipt.missing,
    owner_approval: receipt.owner_approval
  });
  if (COMPLETED_AUDIT_STATUSES.has(receipt.status)) {
    return stop(state, "complete", [], []);
  }
  if (receipt.status === "critic_pass_owner_review_pending") {
    return stop(state, "manual_pending", [], [
      `owner approval required for scope ${audit.approval_scope_digest}`
    ]);
  }
  return stop(state, "blocked", receipt.blockers, receipt.missing);
}

export function continueAutomation(state, {
  hostManifest = null,
  resultPaths = [],
  triagePath = null,
  approvalPath = null,
  retry = null
} = {}) {
  let audit = readJson(state.paths.audit.path, "automation audit run");
  const tamper = tamperBlockers(audit);
  if (tamper.length) {
    recordStep(state, "finalize", "blocked", {
      status: "blocked",
      technical_status: "blocked",
      blockers: tamper,
      missing: []
    });
    return stop(state, "blocked", tamper);
  }
  const selectors = retrySelection(retry);
  const knownSelectors = new Set([
    "all",
    ...audit.packets.map((packet) => packet.packet_id),
    ...audit.packets.map((packet) => packet.provider.id),
    ...audit.packets.map((packet) => packet.stage_id)
  ]);
  for (const selector of selectors) {
    requireValue(knownSelectors.has(selector), `retry selector does not match a packet, provider, or stage: ${selector}`);
  }
  let manualResults;
  try {
    manualResults = partitionManualResults(audit, resultPaths);
    audit = ingestManualResults(state, audit, manualResults.review);
  } catch (error) {
    recordStep(state, "result-ingest", "blocked", { error: error.message });
    return stop(state, "blocked", [error.message]);
  }
  if (state.status === "complete" && !retry && !triagePath && !approvalPath && resultPaths.length === 0) {
    return state;
  }

  const preAdjudication = audit.packets.filter((packet) => packet.stage_id !== "adjudication");
  let nextAudit = runPackets(state, audit, preAdjudication, hostManifest, selectors);
  checkpointExecution(state, nextAudit, preAdjudication);
  const missingPreAdjudication = missingRequiredPackets(nextAudit, preAdjudication);
  if (missingPreAdjudication.length) {
    const pending = pendingForPackets(state, missingPreAdjudication);
    const blocked = hasExecutionError(state, missingPreAdjudication);
    return stop(state, blocked ? "blocked" : "manual_pending", blocked ? pending : [], pending);
  }

  let triage;
  try {
    triage = applyScannerTriage(state, nextAudit, triagePath);
    nextAudit = triage.audit;
  } catch (error) {
    recordStep(state, "scanner-triage", "blocked", { error: error.message });
    return stop(state, "blocked", [error.message]);
  }
  if (triage.pending.length) {
    return stop(state, "manual_pending", [], triage.pending.map((ref) =>
      `scanner finding requires explicit triage: ${ref}`));
  }

  try {
    nextAudit = ingestManualResults(state, nextAudit, manualResults.adjudication);
  } catch (error) {
    recordStep(state, "result-ingest", "blocked", { error: error.message });
    return stop(state, "blocked", [error.message]);
  }
  const adjudicationPackets = nextAudit.packets.filter((packet) => packet.stage_id === "adjudication");
  nextAudit = runPackets(state, nextAudit, adjudicationPackets, hostManifest, selectors);
  checkpointExecution(state, nextAudit, [...preAdjudication, ...adjudicationPackets]);
  const missingAdjudication = missingRequiredPackets(nextAudit, adjudicationPackets);
  if (missingAdjudication.length) {
    const pending = pendingForPackets(state, missingAdjudication);
    const blocked = hasExecutionError(state, missingAdjudication);
    recordStep(state, "conflict-adjudication", blocked ? "blocked" : "manual_pending", {
      conflicts: conflictPairs(nextAudit),
      unresolved_conflicts: unresolvedConflictPairs(nextAudit),
      missing_packets: missingAdjudication.map((packet) => packet.packet_id)
    });
    return stop(state, blocked ? "blocked" : "manual_pending", blocked ? pending : [], pending);
  }
  const unresolvedConflicts = unresolvedConflictPairs(nextAudit);
  recordStep(state, "conflict-adjudication", unresolvedConflicts.length ? "blocked" : "completed", {
    conflicts: conflictPairs(nextAudit),
    unresolved_conflicts: unresolvedConflicts,
    adjudication_packets: adjudicationPackets.map((packet) => packet.packet_id),
    audit_digest: state.paths.audit.digest
  });
  if (unresolvedConflicts.length) {
    return stop(state, "blocked", unresolvedConflicts.map((pair) =>
      `reviewer conflict lacks adjudication: ${pair.join(" <> ")}`));
  }

  try {
    return finalizeAutomation(state, nextAudit, approvalPath);
  } catch (error) {
    recordStep(state, "finalize", "blocked", { error: error.message });
    return stop(state, "blocked", [error.message]);
  }
}

export function startAutomation({
  statePath,
  router,
  profile,
  routerPath,
  profilePath = null,
  input,
  artifacts,
  scope,
  creatorActorId = null,
  hostManifest = null,
  resultPaths = [],
  triagePath = null,
  approvalPath = null,
  retry = null,
  root = process.cwd()
}) {
  const absoluteStatePath = path.resolve(statePath);
  requireValue(!fs.existsSync(absoluteStatePath),
    `automation state already exists; use --resume ${absoluteStatePath}`, 2);
  requireValue(!fs.existsSync(stateDirectory(absoluteStatePath)),
    `automation state directory already exists; recover it or choose a different --out path`, 2);
  requireValue(Array.isArray(artifacts) && artifacts.length > 0,
    "run requires at least one --artifact");
  requireValue(scope, "run requires --scope");
  validateStateArtifactSeparation(absoluteStatePath, artifacts, root);
  const state = newState({
    statePath: absoluteStatePath,
    routerPath,
    profilePath,
    input,
    artifacts,
    scope,
    creatorActorId,
    root
  });
  fs.mkdirSync(state.state_directory, { recursive: true });
  writeState(state);

  let plan;
  try {
    plan = planRoute({
      router,
      profile,
      routerPath,
      profilePath,
      input,
      artifacts,
      root
    });
  } catch (error) {
    recordStep(state, "plan", "blocked", { error: error.message });
    return stop(state, "blocked", [error.message]);
  }
  if (state.request.profile_digest !== plan.profile_digest) {
    recordStep(state, "plan", "blocked", { error: "profile changed while surface routing was being planned" });
    return stop(state, "blocked", ["profile changed while surface routing was being planned"]);
  }
  const planPath = path.join(state.state_directory, "plan.json");
  writeJsonAtomic(planPath, plan);
  state.paths.plan = snapshotPath(planPath);
  recordStep(state, "plan", plan.status === "planned" ? "completed" : "blocked",
    planPayload(plan, planPath));
  if (plan.status !== "planned") return stop(state, "blocked", plan.unresolved);

  let planningVerification;
  try {
    planningVerification = verifyPlanningGateForAudit(plan, scope);
    recordStep(state, "planning-verification", "completed", {
      status: planningVerification?.status || "not-configured",
      planning_receipt_path: planningVerification?.receipt_path || null,
      planning_receipt_digest: planningVerification?.receipt_digest || null,
      requirements: planningVerification?.requirements || []
    });
  } catch (error) {
    recordStep(state, "planning-verification", "blocked", { error: error.message });
    return stop(state, "blocked", [error.message]);
  }

  let audit;
  try {
    audit = initializeAudit({
      plan,
      planPath,
      artifacts,
      scope,
      creatorActorId,
      root,
      runId: state.run_id
    });
  } catch (error) {
    recordStep(state, "audit-init", "blocked", { error: error.message });
    return stop(state, "blocked", [error.message]);
  }
  const auditPath = path.join(state.state_directory, "audit-run.json");
  writeJsonAtomic(auditPath, audit);
  state.paths.audit = snapshotPath(auditPath);
  recordStep(state, "audit-init", "completed", {
    audit_path: auditPath,
    audit_digest: state.paths.audit.digest,
    audit_manifest_digest: audit.manifest_digest,
    approval_scope_digest: audit.approval_scope_digest,
    artifact_digests: Object.fromEntries(audit.artifacts.map((artifact) => [artifact.path, artifact.digest]))
  });

  const packetDirectory = path.join(state.state_directory, "packets");
  const dispatch = dispatchAuditPackets(audit, packetDirectory);
  state.paths.packets = {
    path: packetDirectory,
    digest: hashArtifact(packetDirectory)
  };
  recordStep(state, "dispatch", "completed", {
    packet_directory: packetDirectory,
    packet_directory_digest: state.paths.packets.digest,
    packet_count: dispatch.packets.length,
    packets: audit.packets.map((packet) => ({
      packet_id: packet.packet_id,
      provider_id: packet.provider.id,
      packet_digest: packet.packet_digest
    }))
  });
  return continueAutomation(state, { hostManifest, resultPaths, triagePath, approvalPath, retry });
}

export function resumeAutomation(statePath, options = {}) {
  const state = readAutomationState(statePath);
  return continueAutomation(state, options);
}

export function automationExitCode(state) {
  if (state.status === "complete") return 0;
  if (state.status === "manual_pending") return 6;
  return 5;
}
