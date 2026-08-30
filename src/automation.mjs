import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  dispatchAuditPackets,
  finalizeAudit,
  initializeAudit,
  rebindLegacyAuditIdentity,
  recordAuditResult,
  recordTriage,
  verifyAuditJourneyIdentity,
  writeJsonAtomic
} from "./audit.mjs";
import {
  createBoundEvidenceSnapshotter,
  executeAuditPacket,
  hostReadiness,
  inspectPacketAdapter,
  prepareExecutionOutputBoundary
} from "./execution.mjs";
import {
  canonicalDigest,
  hashArtifact,
  readFilePinned,
  readJsonPinned,
  snapshotArtifact
} from "./integrity.mjs";
import { PLAYWRIGHT_PROVIDER_TARGET } from "./playwright.mjs";
import {
  baselineLineagesMatch,
  planningAuthoritiesMatch,
  verifyBaselineLineage,
  verifyPlanningGateForAudit
} from "./planning.mjs";
import {
  RouterError,
  planRoute,
  verifyRoutingAuthoritySources
} from "./router.mjs";
import {
  ensureSecureDirectory,
  secureExistingDirectory,
  secureExistingRegularFile,
  secureWritablePath
} from "./path-security.mjs";
import {
  createJourneyIdentity,
  identitiesMatch,
  verifyJourneyIdentity
} from "./identity.mjs";
import {
  ABSENT_STATE_DIGEST,
  acquireStateLease,
  claimStaleStateLease,
  completeStateLeaseRecovery,
  commitStateLeaseWrite,
  inspectStateLease,
  markStateLeaseChildExecution,
  prepareStateLeaseWrite,
  releaseStateLease
} from "./state-lease.mjs";

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
const REQUIRED_OBSERVATION_STEPS = [
  "execution",
  "result-ingest",
  "scanner-triage",
  "conflict-adjudication"
];
const STATE_LEASES = new WeakMap();
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const SUPPORTED_LEGACY_AUTOMATION_SOURCES = new Map([
  ["sha256:13c66a553e5a57f6f21b32275498362bd3cd0ec8fb9e56139041ed6c7c8b9d84", {
    source_commit: "9045fce382dc9ffae65aa492eddaa1d7a7996d4d",
    capture_fingerprints: {
      state: "sha256:ea9c4b30daaeae563bbb205f62f1b8c3aa664ce0e8b0b4baaa7b43dc9768ab76",
      plan: "sha256:e7f707778b4c860f58ed21a787b41b974e887a0cfbd3b18ed141a257e6e733f2",
      audit: "sha256:ed0d84e61e9a41b3a71721b871aa6b07c419584ec96d3dbc54f9019903cf6a7d"
    },
    state_keys: [
      "attempts", "automation_run_version", "baseline_observation", "blockers", "created_at",
      "final_audit_status", "final_receipt_digest", "paths", "pending", "request", "run_id",
      "state_digest", "state_directory", "state_path", "status", "steps", "updated_at"
    ],
    request_keys: [
      "artifacts", "creator_actor_id", "input", "observation_run_path", "profile_digest",
      "profile_path", "root", "router_path", "scope"
    ]
  }]
]);

function requireValue(condition, message, exitCode = 2) {
  if (!condition) throw new RouterError(message, exitCode);
}

function readPinnedAutomationJson(target, label, {
  expectedDigest = null,
  faultInjector = null,
  securePath = null,
  requireCallerOwned = true
} = {}) {
  let pinned;
  try {
    pinned = readJsonPinned(target, {
      label,
      faultInjector,
      securePath,
      requireCallerOwned
    });
  } catch (error) {
    throw new RouterError(error.message, 4);
  }
  if (expectedDigest !== null) {
    requireValue(pinned.digest === expectedDigest, `${label} changed`, 4);
  }
  return pinned;
}

function readPinnedAutomationRouterJson(target, label, options = {}) {
  // Router policy is declarative rather than executable authority. Keep the
  // same packaged-asset exception used by planRoute(): root-owned and
  // content-addressed hard-linked installs are accepted, while the exact bytes
  // and physical identity remain pinned for the complete journey.
  return readPinnedAutomationJson(target, label, {
    ...options,
    requireCallerOwned: false
  });
}

function secureAutomationStatePath(statePath) {
  try {
    secureWritablePath(statePath, "automation state path");
    return path.resolve(statePath);
  } catch (error) {
    throw new RouterError(error.message, 4);
  }
}

function secureAutomationRoot(root) {
  try {
    secureExistingDirectory(root, "automation project root");
    return path.resolve(root);
  } catch (error) {
    throw new RouterError(error.message, 4);
  }
}

function ensureAutomationDirectory(target, label, options = {}) {
  try {
    return ensureSecureDirectory(target, label, options).real_path;
  } catch (error) {
    throw new RouterError(error.message, 4);
  }
}

function nowIso(now = null) {
  return (now ? new Date(now) : new Date()).toISOString();
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function sameStringSet(left = [], right = []) {
  const a = [...new Set(left)].sort();
  const b = [...new Set(right)].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function observationRequired(input, scope) {
  return input?.task === "redesign" && scope === "runtime";
}

function stateManifest(state) {
  const { state_digest: _stateDigest, ...manifest } = state;
  return manifest;
}

function sealState(state) {
  state.state_digest = canonicalDigest(stateManifest(state));
  return state;
}

function bindStateLease(state, lease) {
  STATE_LEASES.set(state, lease);
  return state;
}

function writeState(state) {
  state.updated_at = nowIso();
  sealState(state);
  const lease = STATE_LEASES.get(state);
  if (lease) prepareStateLeaseWrite(lease, state.state_digest);
  writeJsonAtomic(state.state_path, state);
  if (lease) commitStateLeaseWrite(lease, state, { inFlight: Boolean(state.in_flight) });
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

function resumeAuthorityDirectory(statePath) {
  return `${path.resolve(statePath)}.authorities`;
}

function resumeAuthorityReceiptPath(state) {
  return path.join(resumeAuthorityDirectory(state.state_path), `${state.run_id}.json`);
}

function initializationAuthorityReceiptPath(state) {
  return path.join(
    resumeAuthorityDirectory(state.state_path),
    `${state.run_id}.initialization.json`
  );
}

function parentOwnedPathContract(state) {
  const directory = stateDirectory(state.state_path);
  const transactionDirectory = state.identity_migration?.authority?.transaction_directory
    ? path.resolve(state.identity_migration.authority.transaction_directory)
    : null;
  const routeDirectory = transactionDirectory || directory;
  const receiptsDirectory = path.join(directory, "receipts");
  const migrationReceiptsDirectory = transactionDirectory
    ? path.join(transactionDirectory, "receipts")
    : null;
  return {
    automation_parent_path_contract_version: 3,
    state_path: path.resolve(state.state_path),
    state_directory: directory,
    resume_authorities_directory: resumeAuthorityDirectory(state.state_path),
    resume_authority_receipt_path: resumeAuthorityReceiptPath(state),
    initialization_authority_receipt_path: initializationAuthorityReceiptPath(state),
    route_directory: routeDirectory,
    plan_path: path.join(routeDirectory, "plan.json"),
    audit_path: path.join(routeDirectory, "audit-run.json"),
    packets_directory: path.join(routeDirectory, "packets"),
    results_directory: path.join(directory, "results"),
    evidence_directory: path.join(directory, "evidence"),
    receipts_directory: receiptsDirectory,
    step_receipts: Object.fromEntries(Object.entries(STEP_FILES)
      .map(([stepId, filename]) => [stepId, path.join(receiptsDirectory, filename)])),
    migration_receipts_directory: migrationReceiptsDirectory,
    migrated_step_receipts: migrationReceiptsDirectory
      ? Object.fromEntries(Object.entries(STEP_FILES)
        .map(([stepId, filename]) => [stepId, path.join(migrationReceiptsDirectory, filename)]))
      : null,
    identity_migration_receipt_path: migrationReceiptsDirectory
      ? path.join(migrationReceiptsDirectory, "00-identity-migration-receipt.json")
      : null,
    final_receipt_path: path.join(directory, "audit-receipt.json"),
    external_input_policy: {
      approval: "caller-supplied-read-only-final-receipt-bound",
      manual_result: "caller-supplied-read-only-audit-bound",
      triage: "caller-supplied-read-only-audit-bound"
    }
  };
}

function jsonValuesMatch(left, right) {
  return canonicalDigest(left) === canonicalDigest(right);
}

function planAuthorityBody(plan) {
  const authority = structuredClone(plan);
  delete authority.baseline_observation;
  return authority;
}

export function automationPlanAuthorityDigest(plan) {
  return canonicalDigest(planAuthorityBody(plan));
}

function resumeAuthorityBody(state) {
  const artifactDigests = state.request?.artifact_digests || {};
  const artifactPhysicalIdentities = state.request?.artifact_physical_identity_digests || {};
  const body = {
    automation_resume_authority_version: 5,
    state_path: path.resolve(state.state_path),
    run_id: state.run_id,
    journey_identity_digest: state.journey_identity?.identity_digest || null,
    router: {
      path: path.resolve(state.request.router_path),
      digest: state.request.router_digest,
      physical_identity_digest: state.request.router_physical_identity_digest
    },
    profile: state.request.profile_path ? {
      path: path.resolve(state.request.profile_path),
      digest: state.request.profile_digest,
      physical_identity_digest: state.request.profile_physical_identity_digest
    } : null,
    project_root: path.resolve(state.request.root),
    input: state.request.input,
    artifacts: state.request.artifacts.map((artifact) => ({
      path: path.resolve(artifact),
      digest: artifactDigests[path.resolve(artifact)] || null,
      physical_identity_digest: artifactPhysicalIdentities[path.resolve(artifact)] || null
    })),
    scope: state.request.scope,
    creator_actor_id: state.request.creator_actor_id || null,
    initial_plan_authority_digest: state.request.initial_plan_authority_digest,
    observation_run_path: state.request.observation_run_path
      ? path.resolve(state.request.observation_run_path)
      : null,
    parent_owned_path_contract: parentOwnedPathContract(state)
  };
  if (state.identity_migration?.authority) {
    body.identity_migration_authority = state.identity_migration.authority;
  }
  return body;
}

export function automationResumeAuthorityDigest(state, _plan = null) {
  return canonicalDigest(resumeAuthorityBody(state));
}

function issueStartResumeAuthority(state, { faultInjector = null } = {}) {
  requireValue(state.journey_identity?.invocation !== "legacy-migrated",
    "legacy migration issues authority through its migration receipt", 4);
  const authority = resumeAuthorityBody(state);
  state.resume_authority_digest = canonicalDigest(authority);
  const receipt = {
    automation_start_authority_receipt_version: 1,
    run_id: state.run_id,
    journey_identity: state.journey_identity,
    state_path: path.resolve(state.state_path),
    issued_at: nowIso(),
    resume_authority_digest: state.resume_authority_digest,
    authority
  };
  receipt.receipt_digest = canonicalDigest(receipt);
  const receiptPath = resumeAuthorityReceiptPath(state);
  requireValue(!fs.existsSync(receiptPath),
    `start authority receipt already exists: ${receiptPath}`, 4);
  writeJsonAtomic(receiptPath, receipt);
  state.resume_authority_receipt = {
    path: receiptPath,
    digest: hashArtifact(receiptPath),
    receipt_digest: receipt.receipt_digest
  };
  faultInjector?.("after-start-authority-issue", {
    state_path: state.state_path,
    authority_path: receiptPath,
    authority_digest: state.resume_authority_digest,
    authority_receipt_digest: receipt.receipt_digest
  });
  return receipt;
}

function verifyStartResumeAuthority(state, { faultInjector = null } = {}) {
  const migrated = state.journey_identity?.invocation === "legacy-migrated";
  if (migrated) {
    requireValue(state.resume_authority_receipt === undefined,
      "legacy-migrated automation cannot claim a modern start authority receipt", 4);
    return null;
  }
  const snapshot = state.resume_authority_receipt;
  requireValue(snapshot && sameExactKeys(snapshot, ["path", "digest", "receipt_digest"]),
    "modern automation lacks its durable start authority receipt", 4);
  requireValue(path.resolve(snapshot.path) === resumeAuthorityReceiptPath(state),
    "start authority receipt is outside its deterministic caller-visible path", 4);
  let pinned;
  try {
    pinned = readJsonPinned(snapshot.path, {
      label: "automation start authority receipt",
      faultInjector
    });
  } catch (error) {
    throw new RouterError(error.message, 4);
  }
  const canonical = pinned.path;
  requireValue(!inside(canonical, state.state_directory) &&
    canonical !== path.resolve(state.state_path),
  "start authority receipt must remain outside the mutable state and state directory", 4);
  requireValue(pinned.digest === snapshot.digest,
    "automation start authority receipt changed", 4);
  const receipt = pinned.input;
  const receiptBody = { ...receipt };
  delete receiptBody.receipt_digest;
  requireValue(receipt.automation_start_authority_receipt_version === 1 &&
    canonicalDigest(receiptBody) === receipt.receipt_digest &&
    receipt.receipt_digest === snapshot.receipt_digest,
  "automation start authority receipt digest mismatch", 4);
  requireValue(receipt.run_id === state.run_id &&
    path.resolve(receipt.state_path) === path.resolve(state.state_path) &&
    identitiesMatch(receipt.journey_identity, state.journey_identity),
  "automation start authority receipt does not bind the journey", 4);
  const expectedAuthority = resumeAuthorityBody(state);
  requireValue(jsonValuesMatch(receipt.authority, expectedAuthority) &&
    canonicalDigest(receipt.authority) === receipt.resume_authority_digest &&
    receipt.resume_authority_digest === state.resume_authority_digest,
  "automation start authority receipt conflicts with the caller-retained authority", 4);
  return receipt;
}

function routeHasProgressed(state) {
  return (state.attempts || []).length > 0 ||
    Boolean(state.paths?.audit || state.paths?.packets || state.paths?.final) ||
    Object.keys(state.steps || {}).some((stepId) => !["plan"].includes(stepId));
}

const INITIALIZATION_STEP_IDS = [
  "plan",
  "planning-verification",
  "audit-init",
  "dispatch"
];

function initializationReceiptPath(state, stepId) {
  const contract = parentOwnedPathContract(state);
  return state.identity_migration?.authority?.transaction_directory
    ? contract.migrated_step_receipts[stepId]
    : contract.step_receipts[stepId];
}

function initializationAnchorDeclarations(state) {
  const contract = parentOwnedPathContract(state);
  return [
    {
      id: "plan-sidecar",
      kind: "file",
      path: contract.plan_path,
      bound: Boolean(state.paths?.plan)
    },
    {
      id: "plan-receipt",
      kind: "file",
      path: initializationReceiptPath(state, "plan"),
      bound: Boolean(state.steps?.plan)
    },
    {
      id: "planning-verification-receipt",
      kind: "file",
      path: initializationReceiptPath(state, "planning-verification"),
      bound: Boolean(state.steps?.["planning-verification"])
    },
    {
      id: "audit-sidecar",
      kind: "file",
      path: contract.audit_path,
      bound: Boolean(state.paths?.audit)
    },
    {
      id: "audit-init-receipt",
      kind: "file",
      path: initializationReceiptPath(state, "audit-init"),
      bound: Boolean(state.steps?.["audit-init"])
    },
    {
      id: "packets-sidecar",
      kind: "directory",
      path: contract.packets_directory,
      bound: Boolean(state.paths?.packets)
    },
    {
      id: "dispatch-receipt",
      kind: "file",
      path: initializationReceiptPath(state, "dispatch"),
      bound: Boolean(state.steps?.dispatch)
    }
  ];
}

function completedStep(state, stepId) {
  return state.steps?.[stepId]?.status === "completed";
}

function hasPostInitializationProgress(state) {
  const postInitializationSteps = Object.keys(state.steps || {})
    .filter((stepId) => !INITIALIZATION_STEP_IDS.includes(stepId));
  return (state.attempts || []).length > 0 ||
    Boolean(state.in_flight || state.paths?.final || state.paths?.approval) ||
    postInitializationSteps.length > 0;
}

function initializationComplete(state) {
  return Boolean(
    state.paths?.plan && completedStep(state, "plan") &&
    completedStep(state, "planning-verification") &&
    state.paths?.audit && completedStep(state, "audit-init") &&
    state.paths?.packets && completedStep(state, "dispatch")
  );
}

function initializationGraph(state) {
  requireValue(initializationComplete(state),
    "automation initialization authority cannot bind an incomplete initialization graph", 4);
  return {
    initialization_graph_version: 1,
    paths: {
      plan: structuredClone(state.paths.plan),
      audit: { path: state.paths.audit.path },
      packets: structuredClone(state.paths.packets)
    },
    steps: Object.fromEntries(INITIALIZATION_STEP_IDS.map((stepId) => [
      stepId,
      structuredClone(state.steps[stepId])
    ]))
  };
}

function readInitializationAuthorityReceipt(state, {
  allowUnboundGraph = false,
  faultInjector = null
} = {}) {
  const expectedPath = initializationAuthorityReceiptPath(state);
  if (!fs.existsSync(expectedPath)) return null;
  let pinned;
  try {
    pinned = readJsonPinned(expectedPath, {
      label: "automation initialization authority receipt",
      faultInjector
    });
  } catch (error) {
    throw new RouterError(error.message, 4);
  }
  const canonical = pinned.path;
  requireValue(!inside(canonical, state.state_directory) &&
    canonical !== path.resolve(state.state_path),
  "initialization authority receipt must remain outside the mutable state and state directory", 4);
  const receipt = pinned.input;
  requireValue(sameExactKeys(receipt, [
    "automation_initialization_authority_receipt_version", "run_id", "journey_identity",
    "state_path", "issued_at", "resume_authority_digest", "initialization_graph",
    "initialization_graph_digest", "receipt_digest"
  ]), "automation initialization authority receipt is malformed", 4);
  const body = { ...receipt };
  delete body.receipt_digest;
  requireValue(receipt.automation_initialization_authority_receipt_version === 1 &&
    canonicalDigest(body) === receipt.receipt_digest,
  "automation initialization authority receipt digest mismatch", 4);
  requireValue(receipt.run_id === state.run_id &&
    path.resolve(receipt.state_path) === path.resolve(state.state_path) &&
    identitiesMatch(receipt.journey_identity, state.journey_identity) &&
    receipt.resume_authority_digest === state.resume_authority_digest,
  "automation initialization authority receipt does not bind the journey", 4);
  requireValue(canonicalDigest(receipt.initialization_graph) ===
    receipt.initialization_graph_digest,
  "automation initialization authority graph digest mismatch", 4);
  if (initializationComplete(state)) {
    requireValue(jsonValuesMatch(receipt.initialization_graph, initializationGraph(state)),
      "automation state conflicts with its durable initialization authority; rollback is forbidden",
      4);
  } else {
    requireValue(allowUnboundGraph,
      "automation state conflicts with its durable initialization authority; rollback is forbidden",
      4);
  }
  return {
    receipt,
    snapshot: {
      path: expectedPath,
      digest: pinned.digest,
      receipt_digest: receipt.receipt_digest,
      initialization_graph_digest: receipt.initialization_graph_digest
    }
  };
}

function inspectInitializationAuthority(state, {
  allowUnbound = false,
  faultInjector = null
} = {}) {
  const retained = readInitializationAuthorityReceipt(state, {
    allowUnboundGraph: allowUnbound,
    faultInjector
  });
  const snapshot = state.initialization_authority_receipt || null;
  if (!retained) {
    requireValue(!snapshot,
      "automation initialization authority receipt is missing", 4);
    requireValue(!hasPostInitializationProgress(state),
      "automation progressed beyond initialization without its durable initialization authority",
      4);
    return { status: "absent", retained: null };
  }
  if (!snapshot) {
    requireValue(allowUnbound,
      "automation state lost its durable initialization authority binding; explicit stale-lease recovery is required",
      4);
    return { status: "unbound", retained };
  }
  requireValue(sameExactKeys(snapshot, [
    "path", "digest", "receipt_digest", "initialization_graph_digest"
  ]), "automation initialization authority snapshot is malformed", 4);
  requireValue(path.resolve(snapshot.path) === path.resolve(retained.snapshot.path) &&
    snapshot.digest === retained.snapshot.digest &&
    snapshot.receipt_digest === retained.snapshot.receipt_digest &&
    snapshot.initialization_graph_digest === retained.snapshot.initialization_graph_digest,
  "automation initialization authority snapshot changed", 4);
  return { status: "bound", retained };
}

function ensureInitializationAuthority(state, {
  faultInjector = null,
  deferStateWrite = false
} = {}) {
  requireValue(initializationComplete(state),
    "automation cannot cross the child boundary before initialization completes", 4);
  const existing = inspectInitializationAuthority(state, {
    allowUnbound: true,
    faultInjector
  });
  let action = "verified";
  let retained = existing.retained;
  if (!retained) {
    const graph = initializationGraph(state);
    const receipt = {
      automation_initialization_authority_receipt_version: 1,
      run_id: state.run_id,
      journey_identity: state.journey_identity,
      state_path: path.resolve(state.state_path),
      issued_at: nowIso(),
      resume_authority_digest: state.resume_authority_digest,
      initialization_graph: graph,
      initialization_graph_digest: canonicalDigest(graph)
    };
    receipt.receipt_digest = canonicalDigest(receipt);
    const receiptPath = initializationAuthorityReceiptPath(state);
    writeJsonAtomic(receiptPath, receipt);
    faultInjector?.("after-initialization-authority-receipt-write", {
      state_path: state.state_path,
      receipt_path: receiptPath,
      receipt_digest: receipt.receipt_digest,
      initialization_graph_digest: receipt.initialization_graph_digest
    });
    retained = readInitializationAuthorityReceipt(state);
    action = "issued";
  } else if (existing.status === "unbound") {
    action = "adopted";
  }
  if (existing.status !== "bound") {
    state.initialization_authority_receipt = retained.snapshot;
    faultInjector?.("after-initialization-authority-bind-before-state-write", {
      state_path: state.state_path,
      receipt_path: retained.snapshot.path,
      receipt_digest: retained.snapshot.receipt_digest,
      action
    });
    if (!deferStateWrite) writeState(state);
  }
  return { action, snapshot: retained.snapshot };
}

function restoreInitializationFromAuthority(state, retained) {
  requireValue(retained?.receipt?.initialization_graph,
    "stale-lease recovery lacks a retained initialization graph", 4);
  const graph = retained.receipt.initialization_graph;
  const contract = parentOwnedPathContract(state);
  requireValue(path.resolve(graph.paths.plan.path) === path.resolve(contract.plan_path) &&
    path.resolve(graph.paths.audit.path) === path.resolve(contract.audit_path) &&
    path.resolve(graph.paths.packets.path) === path.resolve(contract.packets_directory),
  "retained initialization authority conflicts with canonical parent-owned paths: " +
    `${graph.paths.plan.path} <> ${contract.plan_path}; ` +
    `${graph.paths.audit.path} <> ${contract.audit_path}; ` +
    `${graph.paths.packets.path} <> ${contract.packets_directory}`,
  4);
  const retainedPlan = readPinnedAutomationJson(
    graph.paths.plan.path,
    "retained initialization route plan",
    { expectedDigest: graph.paths.plan.digest }
  );
  requireValue(hashArtifact(graph.paths.packets.path) === graph.paths.packets.digest,
    "retained initialization authority sidecar changed during stale-lease recovery", 4);

  const restoredSteps = {};
  const restoredReceipts = {};
  for (const stepId of INITIALIZATION_STEP_IDS) {
    const step = structuredClone(graph.steps[stepId]);
    requireValue(path.resolve(step.receipt_path) ===
      path.resolve(initializationReceiptPath(state, stepId)),
    `retained initialization authority receipt changed during recovery: ${stepId}`, 4);
    const pinnedReceipt = readPinnedAutomationJson(
      step.receipt_path,
      `retained initialization authority ${stepId} receipt`,
      { expectedDigest: step.file_digest }
    );
    const receipt = pinnedReceipt.input;
    const body = { ...receipt };
    delete body.receipt_digest;
    requireValue(canonicalDigest(body) === receipt.receipt_digest &&
      receipt.receipt_digest === step.receipt_digest &&
      receipt.run_id === state.run_id &&
      identitiesMatch(receipt.journey_identity, state.journey_identity) &&
      receipt.payload?.resume_authority_digest === state.resume_authority_digest,
    `retained initialization authority receipt is invalid: ${stepId}`, 4);
    restoredSteps[stepId] = step;
    restoredReceipts[stepId] = receipt;
  }
  const auditReceipt = restoredReceipts["audit-init"];
  const retainedAudit = readPinnedAutomationJson(
    graph.paths.audit.path,
    "retained initialization audit run"
  );
  const auditDigest = retainedAudit.digest;
  requireValue(auditReceipt.payload?.audit_digest === auditDigest,
    "retained initialization audit changed during stale-lease recovery", 4);
  state.paths.plan = structuredClone(graph.paths.plan);
  state.paths.audit = { path: graph.paths.audit.path, digest: auditDigest };
  state.paths.packets = structuredClone(graph.paths.packets);
  for (const [stepId, step] of Object.entries(restoredSteps)) state.steps[stepId] = step;
  const plan = retainedPlan.input;
  if (plan.baseline_lineage) state.baseline_lineage = plan.baseline_lineage;
  if (plan.baseline_observation) state.baseline_observation = plan.baseline_observation;
  requireValue(jsonValuesMatch(retained.receipt.initialization_graph, initializationGraph(state)),
    "restored initialization graph conflicts with its durable authority", 4);
}

function inspectInitializationAnchors(state, { allowUnbound = false } = {}) {
  requireValue(!state.paths?.plan || completedStep(state, "plan"),
    "automation canonical route plan lacks its completed plan receipt", 4);
  requireValue(!completedStep(state, "plan") || state.paths?.plan,
    "automation completed plan receipt lacks its canonical route plan", 4);
  requireValue(!state.steps?.["planning-verification"] || completedStep(state, "plan"),
    "automation planning verification exists without a completed canonical plan", 4);
  requireValue(!state.paths?.audit || completedStep(state, "audit-init"),
    "automation canonical audit lacks its completed audit-init receipt", 4);
  requireValue(!completedStep(state, "audit-init") || state.paths?.audit,
    "automation completed audit-init receipt lacks its canonical audit", 4);
  requireValue(!state.steps?.["audit-init"] || completedStep(state, "planning-verification"),
    "automation audit initialization exists without completed planning verification", 4);
  requireValue(!state.paths?.packets || completedStep(state, "dispatch"),
    "automation canonical packets lack their completed dispatch receipt", 4);
  requireValue(!completedStep(state, "dispatch") || state.paths?.packets,
    "automation completed dispatch receipt lacks its canonical packets", 4);
  requireValue(!state.steps?.dispatch || completedStep(state, "audit-init"),
    "automation dispatch exists without a completed canonical audit", 4);

  const postInitializationProgress = hasPostInitializationProgress(state);
  requireValue(!postInitializationProgress || completedStep(state, "dispatch"),
    "automation progressed beyond initialization without its canonical dispatch anchors", 4);

  let physicalStateDirectory;
  try {
    physicalStateDirectory = secureExistingDirectory(
      state.state_directory,
      "automation initialization anchor directory"
    );
  } catch (error) {
    throw new RouterError(error.message, 4);
  }
  const unbound = [];
  for (const anchor of initializationAnchorDeclarations(state)) {
    if (anchor.bound || !fs.existsSync(anchor.path)) continue;
    const canonical = secureAutomationGraphTarget(
      anchor.path,
      `unbound automation initialization anchor ${anchor.id}`,
      anchor.kind,
      physicalStateDirectory
    );
    if (anchor.kind === "directory") {
      appendProtectedAutomationEntry([], canonical, `$unbound_initialization:${anchor.id}`);
    }
    unbound.push({
      id: anchor.id,
      kind: anchor.kind,
      path: path.resolve(anchor.path),
      digest: hashArtifact(canonical)
    });
  }
  requireValue(unbound.length === 0 || allowUnbound,
    `automation state has unbound canonical initialization anchors: ${unbound
      .map((anchor) => anchor.id).join(", ")}; explicit stale-lease recovery is required`, 4);
  requireValue(unbound.length === 0 || !postInitializationProgress,
    "automation cannot recover unbound initialization anchors after child or finalization progress",
    4);
  return unbound;
}

function verifyAutomationRouteAuthority(state, migrationReceipt = null, {
  faultInjector = null
} = {}) {
  const expectedDirectory = stateDirectory(state.state_path);
  requireValue(path.resolve(state.state_directory) === path.resolve(expectedDirectory),
    "automation state_directory does not match the canonical state path", 4);

  const expectedPlanPath = state.identity_migration?.authority?.transaction_directory
    ? path.join(state.identity_migration.authority.transaction_directory, "plan.json")
    : path.join(expectedDirectory, "plan.json");
  if (state.identity_migration?.authority?.transaction_directory) {
    requireValue(inside(state.identity_migration.authority.transaction_directory, expectedDirectory),
      "identity migration transaction directory escapes the automation state directory", 4);
  }
  const planSnapshot = state.paths?.plan || null;
  const planFileExists = fs.existsSync(expectedPlanPath);
  if (!planSnapshot) {
    requireValue(!routeHasProgressed(state),
      "automation progressed without its canonical route plan", 4);
  } else {
    requireValue(planFileExists,
      "automation canonical route plan is missing", 4);
    requireValue(path.resolve(planSnapshot.path) === path.resolve(expectedPlanPath),
      "automation route plan is not stored at the canonical state path", 4);
  }

  requireValue(state.request?.router_path && fs.existsSync(state.request.router_path),
    "automation router source is missing", 4);
  let router;
  let profile = null;
  let pinnedRouterAuthority;
  let pinnedProfileAuthority = null;
  try {
    const pinnedRouter = readPinnedAutomationRouterJson(
      state.request.router_path,
      "automation router source",
      {
        expectedDigest: state.request.router_digest,
        faultInjector
      }
    );
    pinnedRouterAuthority = pinnedRouter;
    router = pinnedRouter.input;
    if (state.request.profile_path) {
      requireValue(state.request.profile_digest,
        "automation profile path lacks its digest binding", 4);
      pinnedProfileAuthority = readPinnedAutomationJson(
        state.request.profile_path,
        "automation project profile",
        {
          expectedDigest: state.request.profile_digest,
          faultInjector
        }
      );
      profile = pinnedProfileAuthority.input;
    } else {
      requireValue(state.request.profile_digest == null,
        "automation profile digest exists without a profile path", 4);
    }
  } catch (error) {
    if (error instanceof RouterError) throw error;
    throw new RouterError(`cannot read automation routing authority: ${error.message}`, 4);
  }
  requireValue(router.router_id === state.journey_identity?.orchestrator_id &&
    router.router_version === state.journey_identity?.orchestrator_version,
  "automation router source conflicts with the journey identity", 4);
  const legacyMigrated = state.journey_identity.invocation === "legacy-migrated";
  requireValue(DIGEST_PATTERN.test(state.request.router_digest || ""),
    "automation router source lacks its digest binding", 4);
  requireValue(
    pinnedRouterAuthority.physical_identity_digest === state.request.router_physical_identity_digest,
    "automation router source physical identity changed",
    4
  );
  if (pinnedProfileAuthority) {
    requireValue(
      pinnedProfileAuthority.physical_identity_digest === state.request.profile_physical_identity_digest,
      "automation profile source physical identity changed",
      4
    );
  } else {
    requireValue(state.request.profile_physical_identity_digest == null,
      "automation profile physical identity exists without a profile path", 4);
  }
  const artifactPaths = (state.request.artifacts || []).map((artifact) => path.resolve(artifact));
  const artifactDigests = state.request.artifact_digests || {};
  const artifactPhysicalIdentities = state.request.artifact_physical_identity_digests || {};
  requireValue(sameStringSet(Object.keys(artifactDigests), artifactPaths),
    "automation artifact authority does not match the original request", 4);
  requireValue(sameStringSet(Object.keys(artifactPhysicalIdentities), artifactPaths),
    "automation artifact physical authority does not match the original request", 4);
  for (const artifact of artifactPaths) {
    requireValue(DIGEST_PATTERN.test(artifactDigests[artifact] || ""),
      `automation artifact lacks its start authority digest: ${artifact}`, 4);
    requireValue(DIGEST_PATTERN.test(artifactPhysicalIdentities[artifact] || ""),
      `automation artifact lacks its start physical identity: ${artifact}`, 4);
  }
  if (legacyMigrated) {
    requireValue(Boolean(migrationReceipt),
      "legacy-migrated automation requires a verified identity migration receipt", 4);
    requireValue(
      path.resolve(migrationReceipt.verified.router_path) === path.resolve(state.request.router_path) &&
      migrationReceipt.verified.router_digest === state.request.router_digest &&
      migrationReceipt.verified.router_id === router.router_id &&
      migrationReceipt.verified.router_version === router.router_version,
      "legacy identity migration receipt conflicts with the router authority",
      4
    );
  }

  let replanned;
  try {
    replanned = planRoute({
      router,
      profile,
      routerPath: state.request.router_path,
      profilePath: state.request.profile_path || null,
      input: state.request.input,
      artifacts: state.request.artifacts,
      root: state.request.root
    });
  } catch (error) {
    throw new RouterError(`automation route authority cannot be revalidated: ${error.message}`, 4);
  }

  if (!planSnapshot) {
    requireValue(!legacyMigrated,
      "legacy identity migration requires a canonical replanned route source", 4);
    requireValue(DIGEST_PATTERN.test(state.request.initial_plan_authority_digest || ""),
      "automation start authority lacks its initial plan authority digest", 4);
    requireValue(
      automationPlanAuthorityDigest(replanned) === state.request.initial_plan_authority_digest,
      "automation initial planning authority changed before its canonical route plan was committed",
      4
    );
    for (const artifact of artifactPaths) {
      let actual;
      try {
        actual = snapshotArtifact(artifact, { root: state.request.root });
      } catch (error) {
        throw new RouterError(`cannot verify automation artifact ${artifact}: ${error.message}`, 4);
      }
      requireValue(actual.digest === artifactDigests[artifact] &&
        actual.physical_identity_digest === artifactPhysicalIdentities[artifact],
        `automation artifact changed before its canonical route plan was committed: ${artifact}`, 4);
    }
    requireValue(DIGEST_PATTERN.test(state.resume_authority_digest || "") &&
      automationResumeAuthorityDigest(state) === state.resume_authority_digest,
    "automation resume authority digest conflicts with the original start request", 4);
    verifyAutomationRequestPhysicalBindings(state);
    return { plan: null, replanned, baselineLineage: replanned.baseline_lineage || null };
  }

  const plan = readPinnedAutomationJson(
    planSnapshot.path,
    "automation canonical route plan",
    { expectedDigest: planSnapshot.digest, faultInjector }
  ).input;
  requireValue(DIGEST_PATTERN.test(state.request.initial_plan_authority_digest || ""),
    "automation start authority lacks its initial plan authority digest", 4);
  requireValue(
    automationPlanAuthorityDigest(plan) === state.request.initial_plan_authority_digest,
    "automation canonical route plan conflicts with the initial plan authority",
    4
  );
  requireValue(plan.router_digest === state.request.router_digest,
    "automation route plan router digest conflicts with the request", 4);
  requireValue(plan.router_id === replanned.router_id &&
    plan.router_version === replanned.router_version &&
    plan.route_id === replanned.route_id &&
    plan.project_id === replanned.project_id,
  "automation route plan conflicts with revalidated routing authority", 4);
  requireValue(path.resolve(plan.router_path) === path.resolve(state.request.router_path),
    "automation route plan router source conflicts with the request", 4);
  requireValue((plan.profile_path ? path.resolve(plan.profile_path) : null) ===
    (state.request.profile_path ? path.resolve(state.request.profile_path) : null) &&
    plan.profile_digest === state.request.profile_digest,
  "automation route plan profile authority conflicts with the request", 4);
  requireValue(jsonValuesMatch(plan.input, replanned.input),
    "automation route input conflicts with revalidated routing authority", 4);
  requireValue(state.request.scope === replanned.input?.scope &&
    state.request.scope === plan.input?.scope,
  "automation scope conflicts with the canonical route plan", 4);
  requireValue(planningAuthoritiesMatch(plan.planning_gate, replanned.planning_gate),
    "automation planning authority changed after route planning", 4);
  requireValue(
    baselineLineagesMatch(plan.baseline_lineage || null, replanned.baseline_lineage || null),
    "automation route plan baseline_lineage conflicts with revalidated planning authority",
    4
  );
  requireValue(plan.status === replanned.status,
    "automation route status changed after route planning", 4);
  if (legacyMigrated) {
    requireValue(!state.baseline_lineage && !plan.baseline_lineage && !replanned.baseline_lineage,
      "legacy identity migration cannot introduce baseline_lineage", 4);
    requireValue(
      migrationReceipt.verified.plan_digest === planSnapshot.digest &&
      migrationReceipt.resume_authority_digest === state.resume_authority_digest,
      "legacy identity migration receipt conflicts with the canonical route plan",
      4
    );
  }
  requireValue(DIGEST_PATTERN.test(state.resume_authority_digest || ""),
    "automation state lacks its external resume authority digest", 4);
  requireValue(
    automationResumeAuthorityDigest(state) === state.resume_authority_digest,
    "automation resume authority digest conflicts with the original start request",
    4
  );

  const baselineLineage = replanned.baseline_lineage || null;
  requireValue(
    baselineLineagesMatch(state.baseline_lineage || null, baselineLineage),
    baselineLineage
      ? "automation removed or changed baseline_lineage required by planning authority"
      : "automation added baseline_lineage without planning authority",
    4
  );
  if (baselineLineage) {
    requireValue(plan.status === "planned",
      "baseline_lineage automation cannot continue from a blocked route plan", 4);
  }
  verifyAutomationRequestPhysicalBindings(state, { artifacts: false });
  return { plan, replanned, baselineLineage };
}

function verifyAutomationRequestPhysicalBindings(state, { artifacts = true } = {}) {
  const verifyFile = (target, digest, physicalIdentity, label, {
    requireCallerOwned = true
  } = {}) => {
    const pinned = readFilePinned(target, { label, requireCallerOwned });
    requireValue(
      pinned.digest === digest && pinned.physical_identity_digest === physicalIdentity,
      `${label} changed at the final automation authority boundary`,
      4
    );
  };
  verifyFile(
    state.request.router_path,
    state.request.router_digest,
    state.request.router_physical_identity_digest,
    "automation router source",
    { requireCallerOwned: false }
  );
  if (state.request.profile_path) {
    verifyFile(
      state.request.profile_path,
      state.request.profile_digest,
      state.request.profile_physical_identity_digest,
      "automation project profile"
    );
  }
  for (const artifact of artifacts ? (state.request.artifacts || []) : []) {
    const absolute = path.resolve(artifact);
    const snapshot = snapshotArtifact(absolute, { root: state.request.root });
    requireValue(
      snapshot.digest === state.request.artifact_digests?.[absolute] &&
        snapshot.physical_identity_digest ===
          state.request.artifact_physical_identity_digests?.[absolute],
      `automation artifact changed at the final authority boundary: ${absolute}`,
      4
    );
  }
}

function inside(candidate, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === "" || (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function secureExternalAutomationInput(state, target, label, {
  physicalStateDirectory = null
} = {}) {
  let canonical;
  let stateBoundary = physicalStateDirectory;
  let canonicalStateFile;
  try {
    canonical = secureExistingRegularFile(target, label, { singleLink: true });
    canonicalStateFile = secureExistingRegularFile(
      state.state_path,
      "automation external-input state file",
      { singleLink: true }
    );
    stateBoundary ||= secureExistingDirectory(
      state.state_directory,
      "automation external-input state boundary"
    );
  } catch (error) {
    throw new RouterError(error.message, 4);
  }
  requireValue(!inside(canonical, stateBoundary),
    `${label} must remain outside the parent-owned automation state directory`, 4);
  requireValue(canonical !== canonicalStateFile,
    `${label} must remain outside the parent-owned automation state file`, 4);
  return canonical;
}

function readPinnedExternalJson(target, label, securePath) {
  try {
    return readJsonPinned(target, { label, securePath });
  } catch (error) {
    if (error instanceof RouterError) throw error;
    throw new RouterError(`cannot pin ${label} as read-only evidence: ${error.message}`, 4);
  }
}

function readExternalAutomationJson(state, target, label, options = {}) {
  return readPinnedExternalJson(target, label, (candidate, candidateLabel) =>
    secureExternalAutomationInput(state, candidate, candidateLabel, options));
}

function preflightContinuationInputs(state, {
  resultPaths = [],
  triagePath = null,
  approvalPath = null
} = {}) {
  return {
    resultInputs: resultPaths.map((target, index) => readExternalAutomationJson(
      state,
      target,
      `manual audit result ${index + 1}`
    )),
    triageInput: triagePath
      ? readExternalAutomationJson(state, triagePath, "scanner triage")
      : null,
    approvalInput: approvalPath
      ? readExternalAutomationJson(state, approvalPath, "owner approval")
      : null
  };
}

function preflightInitialExternalInputs(statePath, {
  resultPaths = [],
  triagePath = null,
  approvalPath = null
} = {}) {
  let canonicalStatePath;
  let canonicalStateDirectory;
  try {
    canonicalStatePath = secureWritablePath(statePath, "initial automation state path");
    canonicalStateDirectory = secureWritablePath(
      stateDirectory(statePath),
      "initial automation state directory"
    );
  } catch (error) {
    throw new RouterError(error.message, 4);
  }
  const secure = (target, label) => {
    let canonical;
    try {
      canonical = secureExistingRegularFile(target, label, { singleLink: true });
    } catch (error) {
      throw new RouterError(error.message, 4);
    }
    requireValue(canonical !== canonicalStatePath,
      `${label} must remain outside the parent-owned automation state file`, 4);
    requireValue(!inside(canonical, canonicalStateDirectory),
      `${label} must remain outside the parent-owned automation state directory`, 4);
    return canonical;
  };
  return {
    resultInputs: resultPaths.map((target, index) =>
      readPinnedExternalJson(target, `manual audit result ${index + 1}`, secure)),
    triageInput: triagePath
      ? readPinnedExternalJson(triagePath, "scanner triage", secure)
      : null,
    approvalInput: approvalPath
      ? readPinnedExternalJson(approvalPath, "owner approval", secure)
      : null
  };
}

function requireExactAutomationPath(actual, expected, label) {
  requireValue(typeof actual === "string" && actual.length > 0,
    `${label} path is missing`, 4);
  requireValue(path.resolve(actual) === path.resolve(expected),
    `${label} is outside its canonical parent-owned path: ${expected}`, 4);
}

function secureAutomationGraphTarget(target, label, kind, physicalStateDirectory = null) {
  let canonical;
  try {
    canonical = kind === "directory"
      ? secureExistingDirectory(target, label)
      : secureExistingRegularFile(target, label, { singleLink: true });
  } catch (error) {
    throw new RouterError(error.message, 4);
  }
  if (physicalStateDirectory) {
    requireValue(inside(canonical, physicalStateDirectory),
      `${label} resolves outside the canonical automation state directory`, 4);
  }
  return canonical;
}

function verifyAutomationSnapshot(snapshot, {
  label,
  kind,
  expectedPath = null,
  physicalStateDirectory = null,
  requirePhysicalIdentity = false
}) {
  const expectedKeys = requirePhysicalIdentity
    ? ["path", "digest", "physical_identity_digest"]
    : ["path", "digest"];
  requireValue(snapshot && typeof snapshot === "object" &&
    sameExactKeys(snapshot, expectedKeys),
  `${label} snapshot must contain exactly ${expectedKeys.join(", ")}`, 4);
  requireValue(DIGEST_PATTERN.test(snapshot.digest || ""),
    `${label} snapshot lacks a valid digest`, 4);
  if (requirePhysicalIdentity) {
    requireValue(DIGEST_PATTERN.test(snapshot.physical_identity_digest || ""),
      `${label} snapshot lacks a valid physical identity digest`, 4);
  }
  if (expectedPath) requireExactAutomationPath(snapshot.path, expectedPath, label);
  secureAutomationGraphTarget(
    snapshot.path,
    label,
    kind,
    physicalStateDirectory
  );
  if (kind === "directory" && physicalStateDirectory) {
    appendProtectedAutomationEntry([], snapshot.path, `$${label.replaceAll(" ", "_")}`);
  }
  let actualDigest;
  try {
    actualDigest = hashArtifact(snapshot.path);
  } catch (error) {
    throw new RouterError(`cannot verify ${label}: ${error.message}`, 4);
  }
  requireValue(actualDigest === snapshot.digest,
    `${label} changed outside the orchestrator`, 4);
  if (requirePhysicalIdentity) {
    const current = snapshotArtifact(snapshot.path, { root: path.dirname(snapshot.path) });
    requireValue(current.physical_identity_digest === snapshot.physical_identity_digest,
      `${label} physical identity changed outside the orchestrator`, 4);
  }
}

function verifyAutomationParentPathGraph(state) {
  const contract = parentOwnedPathContract(state);
  requireValue(path.resolve(state.state_directory) === path.resolve(contract.state_directory),
    "automation state_directory conflicts with its parent-owned path contract", 4);
  const physicalStateDirectory = secureAutomationGraphTarget(
    contract.state_directory,
    "automation state directory",
    "directory"
  );

  const transactionDirectory = state.identity_migration?.authority?.transaction_directory
    ? path.resolve(state.identity_migration.authority.transaction_directory)
    : null;
  if (transactionDirectory) {
    requireValue(
      path.dirname(transactionDirectory) === path.join(contract.state_directory, "identity-migrations"),
      "identity migration transaction directory is not a direct child of the canonical migration root",
      4
    );
    secureAutomationGraphTarget(
      transactionDirectory,
      "identity migration transaction directory",
      "directory",
      physicalStateDirectory
    );
  }

  const allowedPathKeys = new Set(["plan", "audit", "packets", "final", "approval"]);
  for (const key of Object.keys(state.paths || {})) {
    requireValue(allowedPathKeys.has(key),
      `automation state contains an unsupported path snapshot: ${key}`, 4);
  }
  const parentSnapshots = {
    plan: { kind: "file", expectedPath: contract.plan_path },
    audit: { kind: "file", expectedPath: contract.audit_path },
    packets: { kind: "directory", expectedPath: contract.packets_directory },
    final: { kind: "file", expectedPath: contract.final_receipt_path }
  };
  for (const [key, declaration] of Object.entries(parentSnapshots)) {
    const snapshot = state.paths?.[key];
    if (!snapshot) continue;
    verifyAutomationSnapshot(snapshot, {
      label: `automation ${key}`,
      ...declaration,
      physicalStateDirectory
    });
  }
  if (state.paths?.approval) {
    verifyAutomationSnapshot(state.paths.approval, {
      label: "automation approval source",
      kind: "file",
      requirePhysicalIdentity: true
    });
    const approvalEvidence = readExternalAutomationJson(
      state,
      state.paths.approval.path,
      "automation approval source",
      { physicalStateDirectory }
    );
    requireValue(approvalEvidence.digest === state.paths.approval.digest,
      "automation approval source changed while it was being pinned", 4);
    requireValue(
      approvalEvidence.physical_identity_digest ===
        state.paths.approval.physical_identity_digest,
      "automation approval source physical identity changed while it was being pinned",
      4
    );
  }

  if (state.identity_migration) {
    requireValue(transactionDirectory,
      "identity migration receipt lacks its transaction directory", 4);
    requireValue(state.identity_migration.path,
      "identity migration receipt path is missing", 4);
    requireExactAutomationPath(
      state.identity_migration.path,
      contract.identity_migration_receipt_path,
      "identity migration receipt"
    );
    secureAutomationGraphTarget(
      state.identity_migration.path,
      "identity migration receipt",
      "file",
      physicalStateDirectory
    );
  }

  for (const [stepId, step] of Object.entries(state.steps || {})) {
    requireValue(Object.hasOwn(STEP_FILES, stepId),
      `automation state contains an unsupported step receipt: ${stepId}`, 4);
    requireValue(typeof step?.receipt_path === "string" && step.receipt_path.length > 0,
      `automation step receipt path is missing: ${stepId}`, 4);
    const allowed = [contract.step_receipts[stepId]];
    if (contract.migrated_step_receipts) {
      allowed.push(contract.migrated_step_receipts[stepId]);
    }
    requireValue(allowed.some((candidate) =>
      path.resolve(candidate) === path.resolve(step.receipt_path)),
    `automation step receipt is outside its canonical parent-owned path: ${stepId}`, 4);
    secureAutomationGraphTarget(
      step.receipt_path,
      `automation ${stepId} receipt`,
      "file",
      physicalStateDirectory
    );
  }

  for (const [index, snapshot] of (state.lease_recoveries || []).entries()) {
    requireValue(typeof snapshot?.path === "string" &&
      path.dirname(path.resolve(snapshot.path)) === path.resolve(contract.receipts_directory),
    `state lease recovery receipt is outside the canonical receipts directory: ${index + 1}`, 4);
    secureAutomationGraphTarget(
      snapshot.path,
      `state lease recovery receipt ${index + 1}`,
      "file",
      physicalStateDirectory
    );
  }

  if (!state.journey_identity) {
    requireValue((state.attempts || []).length === 0,
      "legacy automation contains adapter attempts; start a new KillSlopRouter run so child evidence is identity-bound",
      4);
  }
  const attemptSequence = new Map();
  for (const [index, attempt] of (state.attempts || []).entries()) {
    const expectedAttempt = (attemptSequence.get(attempt?.packet_id) || 0) + 1;
    requireValue(Number.isInteger(attempt?.attempt) && attempt.attempt === expectedAttempt,
      `automation attempt ${index + 1} is out of sequence for ${attempt?.packet_id || "unknown packet"}`,
      4);
    attemptSequence.set(attempt.packet_id, attempt.attempt);
    if (!attempt?.result_path) {
      requireValue(attempt?.result_digest == null,
        `automation attempt ${index + 1} has a result digest without a result path`, 4);
      continue;
    }
    requireValue(DIGEST_PATTERN.test(attempt.result_digest || ""),
      `automation attempt ${index + 1} lacks a valid result digest`, 4);
    const parentOwned = attempt.adapter !== "manual-v1";
    if (parentOwned) {
      const expectedResultPath = path.join(
        contract.results_directory,
        `${attempt.packet_id}.attempt-${attempt.attempt}.json`
      );
      requireExactAutomationPath(
        attempt.result_path,
        expectedResultPath,
        `automation attempt ${index + 1} result`
      );
    }
    secureAutomationGraphTarget(
      attempt.result_path,
      `automation attempt ${index + 1} result`,
      "file",
      parentOwned ? physicalStateDirectory : null
    );
    if (!parentOwned) {
      const manualEvidence = readExternalAutomationJson(
        state,
        attempt.result_path,
        `automation attempt ${index + 1} manual result`,
        { physicalStateDirectory }
      );
      requireValue(manualEvidence.digest === attempt.result_digest,
        `automation attempt ${index + 1} manual result changed while it was being pinned`, 4);
    }
    requireValue(hashArtifact(attempt.result_path) === attempt.result_digest,
      `automation attempt ${index + 1} result changed outside the orchestrator`, 4);
    if (parentOwned) {
      requireValue(attempt.evidence_boundary,
        `automation attempt ${index + 1} lost its child evidence boundary`, 4);
      verifyPersistedExecutionBoundary(state, attempt, contract, physicalStateDirectory, index);
    } else {
      requireValue(!attempt.evidence_boundary,
        `automation attempt ${index + 1} manual result cannot claim a child evidence boundary`, 4);
    }
  }

  if (state.in_flight?.output_directory) {
    const expectedOutputDirectory = path.join(
      contract.evidence_directory,
      state.in_flight.packet_id,
      `attempt-${state.in_flight.attempt}`
    );
    requireExactAutomationPath(
      state.in_flight.output_directory,
      expectedOutputDirectory,
      "automation in-flight child output"
    );
  }
  return contract;
}

function sameExactKeys(value, expected, optional = []) {
  const allowed = new Set([...expected, ...optional]);
  const actual = Object.keys(value || {}).sort();
  return actual.every((key) => allowed.has(key)) &&
    expected.every((key) => Object.hasOwn(value || {}, key));
}

function normalizeLegacyCapturePaths(value, state) {
  const bindings = new Map();
  const bind = (candidate, token) => {
    if (typeof candidate === "string" && candidate.length > 0) {
      bindings.set(path.resolve(candidate), token);
    }
  };
  bind(state.state_path, "<STATE_PATH>");
  bind(state.state_directory, "<STATE_DIRECTORY>");
  bind(state.request?.router_path, "<ROUTER_PATH>");
  bind(state.request?.profile_path, "<PROFILE_PATH>");
  for (const [index, artifact] of (state.request?.artifacts || []).entries()) {
    bind(artifact, `<ARTIFACT:${index}>`);
  }
  for (const [key, snapshot] of Object.entries(state.paths || {})) {
    bind(snapshot?.path, `<STATE_SIDECAR:${key}>`);
  }
  for (const [stepId, step] of Object.entries(state.steps || {})) {
    bind(step?.receipt_path, `<STEP_RECEIPT:${stepId}>`);
  }
  bind(state.request?.root, "<PROJECT_ROOT>");
  const replacements = [...bindings.entries()].sort((left, right) => right[0].length - left[0].length);
  function normalize(candidate) {
    if (Array.isArray(candidate)) return candidate.map(normalize);
    if (candidate && typeof candidate === "object") {
      return Object.fromEntries(Object.entries(candidate).map(([key, item]) => [key, normalize(item)]));
    }
    if (typeof candidate !== "string") return candidate;
    let normalized = candidate;
    for (const [absolute, token] of replacements) normalized = normalized.replaceAll(absolute, token);
    return normalized;
  }
  return normalize(value);
}

export function legacyCaptureFingerprints(state, plan, audit) {
  const stateProjection = normalizeLegacyCapturePaths(structuredClone(state), state);
  delete stateProjection.state_digest;
  delete stateProjection.lease_recoveries;
  stateProjection.updated_at = "<MUTABLE_STATE_UPDATED_AT>";
  for (const [key, snapshot] of Object.entries(stateProjection.paths || {})) {
    if (snapshot) snapshot.digest = `<STATE_SIDECAR_DIGEST:${key}>`;
  }
  for (const [stepId, step] of Object.entries(stateProjection.steps || {})) {
    step.receipt_digest = `<STEP_RECEIPT_DIGEST:${stepId}>`;
    step.file_digest = `<STEP_FILE_DIGEST:${stepId}>`;
  }

  const planProjection = normalizeLegacyCapturePaths(structuredClone(plan), state);
  const auditProjection = normalizeLegacyCapturePaths(structuredClone(audit), state);
  auditProjection.route.plan_digest = "<LEGACY_PLAN_CANONICAL_DIGEST>";
  auditProjection.route.plan_source.bytes = "<LEGACY_PLAN_BYTES>";
  auditProjection.route.plan_source.digest = "<LEGACY_PLAN_FILE_DIGEST>";
  auditProjection.approval_scope_digest = "<LEGACY_APPROVAL_SCOPE_DIGEST>";
  auditProjection.manifest_digest = "<LEGACY_AUDIT_MANIFEST_DIGEST>";
  return {
    state: canonicalDigest(stateProjection),
    plan: canonicalDigest(planProjection),
    audit: canonicalDigest(auditProjection)
  };
}

function verifyLegacyHistoricalCapture(state, plan, audit, source) {
  const actual = legacyCaptureFingerprints(state, plan, audit);
  requireValue(source.capture_fingerprints &&
    jsonValuesMatch(actual, source.capture_fingerprints),
  `legacy state/plan/audit provenance does not match the verified ${source.source_commit} capture`, 4);
  return actual;
}

function supportedLegacySource(state) {
  requireValue(state.request?.router_path && fs.existsSync(state.request.router_path),
    "legacy automation router source is missing", 4);
  const routerDigest = readPinnedAutomationRouterJson(
    state.request.router_path,
    "legacy automation router source"
  ).digest;
  const source = SUPPORTED_LEGACY_AUTOMATION_SOURCES.get(routerDigest);
  requireValue(source,
    `legacy automation router digest is not a positively supported historical source: ${routerDigest}`, 4);
  requireValue(sameExactKeys(state, source.state_keys, ["lease_recoveries"]),
    `legacy automation state provenance does not match the verified ${source.source_commit} capture top-level shape`, 4);
  requireValue(sameExactKeys(state.request, source.request_keys),
    `legacy automation request provenance does not match the verified ${source.source_commit} capture shape`, 4);
  return { ...source, router_digest: routerDigest };
}

function verifyLegacyBackupAuthority(statePath, state, legacyBackupPath, authorityDigest) {
  requireValue(typeof legacyBackupPath === "string" && legacyBackupPath.length > 0,
    "legacy identity migration requires --legacy-backup outside the automation state directory", 4);
  requireValue(DIGEST_PATTERN.test(authorityDigest || ""),
    "legacy identity migration requires --authority-digest for the byte-identical legacy backup", 4);
  const absoluteState = path.resolve(statePath);
  const absoluteBackup = path.resolve(legacyBackupPath);
  requireValue(absoluteBackup !== absoluteState && fs.existsSync(absoluteBackup),
    "legacy identity migration backup is missing or aliases the active state", 4);
  const backupStat = fs.lstatSync(absoluteBackup);
  requireValue(backupStat.isFile() && !backupStat.isSymbolicLink() && backupStat.nlink === 1,
    "legacy identity migration backup must be a single-link regular non-symlink file", 4);
  let realBackup;
  try {
    realBackup = secureExistingRegularFile(
      absoluteBackup,
      "legacy identity migration backup",
      { singleLink: true }
    );
  } catch (error) {
    throw new RouterError(error.message, 4);
  }
  const realStateDirectory = fs.realpathSync.native(stateDirectory(absoluteState));
  requireValue(!inside(realBackup, realStateDirectory),
    "legacy identity migration backup must remain outside the mutable state directory", 4);
  const pinnedBackup = readPinnedAutomationJson(
    absoluteBackup,
    "legacy automation backup"
  );
  const pinnedState = readPinnedAutomationJson(
    absoluteState,
    "pre-migration automation state"
  );
  const backupDigest = pinnedBackup.digest;
  requireValue(backupDigest === authorityDigest,
    "legacy migration authority digest does not match the external legacy backup", 4);
  requireValue(pinnedState.digest === backupDigest,
    "legacy migration backup is not byte-identical to the pre-mutation automation state", 4);
  const backup = pinnedBackup.input;
  requireValue(jsonValuesMatch(pinnedState.input, state),
    "active legacy automation state changed during migration preflight", 4);
  requireValue(backup.state_digest === state.state_digest &&
    canonicalDigest(stateManifest(backup)) === backup.state_digest,
  "legacy automation backup state digest is invalid or differs from the active state", 4);
  const source = supportedLegacySource(state);
  return {
    path: pinnedBackup.path,
    digest: backupDigest,
    physical_identity_digest: pinnedBackup.physical_identity_digest,
    state_digest: backup.state_digest,
    source_commit: source.source_commit,
    router_digest: source.router_digest
  };
}

function validateStateArtifactSeparation(statePath, artifacts, root) {
  const stateTargets = [
    statePath,
    stateDirectory(statePath),
    resumeAuthorityDirectory(statePath)
  ].map((target) => {
    try {
      return secureWritablePath(target, "automation state/artifact separation path");
    } catch (error) {
      throw new RouterError(error.message, 4);
    }
  });
  for (const artifact of artifacts) {
    const absoluteArtifact = path.resolve(root, artifact);
    if (!fs.existsSync(absoluteArtifact) || !fs.lstatSync(absoluteArtifact).isDirectory()) continue;
    const physicalArtifact = fs.realpathSync.native(absoluteArtifact);
    for (const target of stateTargets) {
      if (!inside(target, physicalArtifact)) continue;
      const relative = path.relative(physicalArtifact, target);
      const first = relative.split(path.sep)[0];
      requireValue(first === ".killsloprouter",
        "automation state must be outside directory artifacts or under their ignored .killsloprouter directory",
        2);
    }
  }
}

function receiptBody(
  journeyIdentity,
  runId,
  stepId,
  status,
  attempt,
  payload,
  generatedAt = null
) {
  const receipt = {
    automation_step_receipt_version: 1,
    run_id: runId,
    journey_identity: journeyIdentity,
    step_id: stepId,
    status,
    attempt,
    generated_at: nowIso(generatedAt),
    payload
  };
  receipt.receipt_digest = canonicalDigest(receipt);
  return receipt;
}

function recordStep(state, stepId, status, payload, {
  faultInjector = null,
  deferStateWrite = false,
  adoptExisting = false,
  generatedAt = null
} = {}) {
  const previous = state.steps[stepId];
  const attempt = (previous?.attempt || 0) + 1;
  const boundPayload = {
    ...payload,
    ...(state.resume_authority_digest
      ? { resume_authority_digest: state.resume_authority_digest }
      : {}),
    ...(state.baseline_lineage
      ? { baseline_lineage_digest: state.baseline_lineage.lineage_digest }
      : {})
  };
  const receiptPath = INITIALIZATION_STEP_IDS.includes(stepId)
    ? initializationReceiptPath(state, stepId)
    : path.join(state.state_directory, "receipts", STEP_FILES[stepId]);
  let receipt;
  let fileDigest;
  if (adoptExisting && fs.existsSync(receiptPath)) {
    let retained;
    try {
      retained = readJsonPinned(receiptPath, {
        label: `orphan automation ${stepId} receipt`
      });
    } catch (error) {
      throw new RouterError(error.message, 4);
    }
    requireValue(typeof retained.input.generated_at === "string" &&
      !Number.isNaN(Date.parse(retained.input.generated_at)),
    `orphan automation ${stepId} receipt has an invalid generated_at`, 4);
    receipt = receiptBody(
      state.journey_identity,
      state.run_id,
      stepId,
      status,
      attempt,
      boundPayload,
      retained.input.generated_at
    );
    requireValue(jsonValuesMatch(retained.input, receipt),
      `orphan automation ${stepId} receipt conflicts with reconstructed authority`, 4);
    fileDigest = retained.digest;
  } else {
    receipt = receiptBody(
      state.journey_identity,
      state.run_id,
      stepId,
      status,
      attempt,
      boundPayload,
      generatedAt
    );
    writeJsonAtomic(receiptPath, receipt);
    faultInjector?.(`after-${stepId}-receipt-write`, {
      state_path: state.state_path,
      step_id: stepId,
      receipt_path: receiptPath,
      receipt_digest: receipt.receipt_digest
    });
    fileDigest = hashArtifact(receiptPath);
  }
  state.steps[stepId] = {
    status,
    attempt,
    receipt_path: receiptPath,
    receipt_digest: receipt.receipt_digest,
    file_digest: fileDigest
  };
  if (!deferStateWrite) writeState(state);
  return receipt;
}

function verifyStepReceipt(state, stepId, step, migrationReceipt = null, {
  faultInjector = null
} = {}) {
  requireValue(fs.existsSync(step.receipt_path), `automation step receipt is missing: ${stepId}`, 4);
  const receipt = readPinnedAutomationJson(
    step.receipt_path,
    `automation ${stepId} receipt`,
    { expectedDigest: step.file_digest, faultInjector }
  ).input;
  const expected = receipt.receipt_digest;
  const copy = { ...receipt };
  delete copy.receipt_digest;
  requireValue(canonicalDigest(copy) === expected && expected === step.receipt_digest,
    `automation step receipt digest mismatch: ${stepId}`, 4);
  if (receipt.journey_identity) {
    requireValue(identitiesMatch(receipt.journey_identity, state.journey_identity),
      `automation step receipt journey identity mismatch: ${stepId}`, 4);
  } else {
    requireValue(
      state.journey_identity?.invocation === "legacy-migrated" &&
      migrationReceipt?.legacy_step_receipts?.[stepId] === step.receipt_digest,
      `automation step receipt lacks the KillSlopRouter journey identity: ${stepId}`,
      4
    );
  }
  if (state.baseline_lineage) {
    requireValue(
      receipt.payload?.baseline_lineage_digest === state.baseline_lineage.lineage_digest,
      `automation step receipt baseline_lineage mismatch: ${stepId}`,
      4
    );
  }
  if (state.resume_authority_digest) {
    requireValue(
      receipt.payload?.resume_authority_digest === state.resume_authority_digest,
      `automation step receipt resume authority mismatch: ${stepId}`,
      4
    );
  }
}

function verifyIdentityMigration(state, { faultInjector = null } = {}) {
  if (!state.identity_migration) return null;
  const snapshot = state.identity_migration;
  requireValue(fs.existsSync(snapshot.path), "identity migration receipt is missing", 4);
  const pinnedReceipt = readPinnedAutomationJson(
    snapshot.path,
    "identity migration receipt",
    { expectedDigest: snapshot.digest, faultInjector }
  );
  requireValue(
    pinnedReceipt.physical_identity_digest === snapshot.physical_identity_digest,
    "identity migration receipt physical identity changed",
    4
  );
  const receipt = pinnedReceipt.input;
  const copy = { ...receipt };
  delete copy.receipt_digest;
  requireValue(canonicalDigest(copy) === receipt.receipt_digest &&
    receipt.receipt_digest === snapshot.receipt_digest,
  "identity migration receipt digest mismatch", 4);
  requireValue(receipt.run_id === state.run_id &&
    identitiesMatch(receipt.journey_identity, state.journey_identity),
  "identity migration receipt does not bind the automation run", 4);
  const authority = snapshot.authority;
  requireValue(authority?.identity_migration_authority_version === 1 &&
    DIGEST_PATTERN.test(authority.authority_digest || ""),
  "identity migration state lacks its migration authority", 4);
  const authorityBody = { ...authority };
  delete authorityBody.authority_digest;
  requireValue(canonicalDigest(authorityBody) === authority.authority_digest &&
    jsonValuesMatch(receipt.migration_authority, authority),
  "identity migration authority digest or receipt binding is invalid", 4);
  requireValue(path.resolve(snapshot.path) === path.join(
    path.resolve(authority.transaction_directory),
    "receipts",
    "00-identity-migration-receipt.json"
  ), "identity migration receipt is outside its bound transaction directory", 4);
  requireValue(
    receipt.previous_state_digest &&
    receipt.resume_authority_digest === state.resume_authority_digest &&
    receipt.verified?.router_digest === state.request?.router_digest &&
    receipt.verified?.plan_digest === (state.paths?.plan?.digest || null),
    "identity migration receipt does not bind the migrated route authority",
    4
  );
  requireValue(receipt.legacy_backup?.path &&
    DIGEST_PATTERN.test(receipt.legacy_backup.digest || "") &&
    DIGEST_PATTERN.test(receipt.legacy_backup.physical_identity_digest || "") &&
    receipt.legacy_backup.state_digest === receipt.previous_state_digest &&
    receipt.legacy_backup.router_digest === receipt.verified?.router_digest &&
    receipt.legacy_backup.source_commit === receipt.verified?.source_commit,
  "identity migration receipt does not bind its historical backup provenance", 4);
  requireValue(jsonValuesMatch(receipt.legacy_backup, authority.legacy_backup) &&
    receipt.previous_state_digest === authority.previous.state_digest &&
    receipt.verified?.previous_plan_digest === authority.previous.plan_digest &&
    receipt.verified?.previous_audit_digest === authority.previous.audit_digest &&
    receipt.verified?.previous_packets_digest === authority.previous.packets_digest,
  "identity migration authority does not bind the legacy backup and prior sidecars", 4);
  const backupPath = path.resolve(receipt.legacy_backup.path);
  requireValue(fs.existsSync(backupPath),
    "identity migration legacy backup changed or is missing", 4);
  const backupStat = fs.lstatSync(backupPath);
  requireValue(backupStat.isFile() && !backupStat.isSymbolicLink() && backupStat.nlink === 1,
    "identity migration legacy backup must remain a single-link regular non-symlink file", 4);
  let realBackup;
  try {
    realBackup = secureExistingRegularFile(
      backupPath,
      "identity migration legacy backup",
      { singleLink: true }
    );
  } catch (error) {
    throw new RouterError(error.message, 4);
  }
  requireValue(!inside(realBackup, fs.realpathSync.native(stateDirectory(state.state_path))),
  "identity migration legacy backup must remain outside the mutable state directory", 4);
  const pinnedBackup = readPinnedAutomationJson(
    backupPath,
    "identity migration legacy backup",
    { expectedDigest: receipt.legacy_backup.digest, faultInjector }
  );
  requireValue(
    pinnedBackup.physical_identity_digest === receipt.legacy_backup.physical_identity_digest,
    "identity migration legacy backup physical identity changed",
    4
  );
  const backup = pinnedBackup.input;
  requireValue(backup.state_digest === receipt.previous_state_digest &&
    canonicalDigest(stateManifest(backup)) === backup.state_digest,
  "identity migration legacy backup state digest is invalid", 4);
  const source = supportedLegacySource(backup);
  const physicalStateDirectory = secureAutomationGraphTarget(
    state.state_directory,
    "identity migration retained state directory",
    "directory"
  );
  const retainedLegacyJson = {};
  for (const [label, sidecar] of Object.entries(authority.legacy_sources || {})) {
    if (!sidecar) continue;
    requireValue(DIGEST_PATTERN.test(sidecar.physical_identity_digest || ""),
      `identity migration legacy ${label} lacks physical identity authority`, 4);
    secureAutomationGraphTarget(
      sidecar.path,
      `identity migration legacy ${label} provenance`,
      label === "packets" ? "directory" : "file",
      physicalStateDirectory
    );
    requireValue(fs.existsSync(sidecar.path),
      `identity migration legacy ${label} provenance changed or is missing`, 4);
    if (label === "packets") {
      const retained = snapshotArtifact(sidecar.path, { root: state.state_directory });
      requireValue(retained.digest === sidecar.digest &&
        retained.physical_identity_digest === sidecar.physical_identity_digest,
        `identity migration legacy ${label} provenance changed or is missing`, 4);
    } else {
      const retained = readPinnedAutomationJson(
        sidecar.path,
        `identity migration legacy ${label}`,
        { expectedDigest: sidecar.digest, faultInjector }
      );
      requireValue(
        retained.physical_identity_digest === sidecar.physical_identity_digest,
        `identity migration legacy ${label} physical identity changed`,
        4
      );
      retainedLegacyJson[label] = retained.input;
    }
  }
  requireValue(
    fs.realpathSync.native(authority.legacy_sources?.plan?.path || "") ===
      fs.realpathSync.native(backup.paths?.plan?.path || "") &&
    fs.realpathSync.native(authority.legacy_sources?.audit?.path || "") ===
      fs.realpathSync.native(backup.paths?.audit?.path || ""),
    "identity migration legacy sidecar paths conflict with the retained backup",
    4
  );
  const retainedFingerprints = verifyLegacyHistoricalCapture(
    backup,
    retainedLegacyJson.plan,
    retainedLegacyJson.audit,
    source
  );
  requireValue(source.source_commit === receipt.verified.source_commit &&
    source.router_digest === receipt.verified.router_digest &&
    jsonValuesMatch(source.capture_fingerprints, authority.historical_source.capture_fingerprints) &&
    jsonValuesMatch(retainedFingerprints, authority.historical_source.capture_fingerprints),
  "identity migration legacy backup historical source changed", 4);
  requireValue(
    automationResumeAuthorityDigest(
      state,
      readPinnedAutomationJson(
        state.paths.plan.path,
        "identity migration route plan",
        { expectedDigest: state.paths.plan.digest, faultInjector }
      ).input
    ) === state.resume_authority_digest,
    "identity migration authority is not bound into resume authority",
    4
  );
  return receipt;
}

function verifyFinalReceiptAndApproval(state, audit, baselineLineage, {
  faultInjector = null
} = {}) {
  const finalSnapshot = state.paths?.final || null;
  const approvalSnapshot = state.paths?.approval || null;
  if (!finalSnapshot) {
    requireValue(!state.final_receipt_digest && !state.final_audit_status,
      "automation final state exists without a final receipt snapshot", 4);
    requireValue(state.status !== "complete",
      "completed automation is missing its final receipt", 4);
    requireValue(!approvalSnapshot,
      "automation owner approval exists without a final receipt", 4);
    return;
  }

  requireValue(audit, "automation final receipt exists without its audit run", 4);
  const receipt = readPinnedAutomationJson(
    finalSnapshot.path,
    "automation final audit receipt",
    { expectedDigest: finalSnapshot.digest, faultInjector }
  ).input;
  const receiptDigest = receipt.receipt_digest;
  const receiptBody = { ...receipt };
  delete receiptBody.receipt_digest;
  requireValue(canonicalDigest(receiptBody) === receiptDigest &&
    receiptDigest === state.final_receipt_digest,
  "automation final receipt digest mismatch", 4);
  requireValue(receipt.run_id === state.run_id &&
    identitiesMatch(receipt.journey_identity, state.journey_identity),
  "automation final receipt does not bind the journey", 4);
  requireValue(receipt.status === state.final_audit_status,
    "automation final audit status conflicts with its receipt", 4);
  requireValue(receipt.owner_approval?.scope_digest === audit.approval_scope_digest &&
    identitiesMatch(receipt.owner_approval?.journey_identity, state.journey_identity),
  "automation final owner approval scope conflicts with the audit run", 4);
  requireValue(
    baselineLineagesMatch(receipt.baseline_lineage || null, baselineLineage || null),
    "automation final receipt baseline_lineage conflicts with the audit run",
    4
  );
  if (baselineLineage) {
    requireValue(
      receipt.owner_approval.baseline_lineage_digest === baselineLineage.lineage_digest,
      "automation final owner approval removed or changed baseline_lineage",
      4
    );
  } else {
    requireValue(receipt.owner_approval.baseline_lineage_digest === undefined,
      "automation final owner approval added baseline_lineage without authority", 4);
  }

  if (!approvalSnapshot) {
    requireValue(!["approved", "rejected"].includes(receipt.owner_approval.status),
      "automation final receipt claims an owner decision without approval evidence", 4);
    requireValue(state.status !== "complete" || receipt.owner_approval.status === "not-required",
      "completed automation lacks required owner approval evidence", 4);
    return;
  }

  const approvalEvidence = readExternalAutomationJson(
    state,
    approvalSnapshot.path,
    "automation owner approval"
  );
  requireValue(approvalEvidence.digest === approvalSnapshot.digest,
    "automation owner approval changed while it was being pinned", 4);
  const approval = approvalEvidence.input;
  requireValue(approval.approval_version === 1 && approval.run_id === state.run_id,
    "automation owner approval does not bind the run", 4);
  requireValue(identitiesMatch(approval.journey_identity, state.journey_identity) &&
    approval.scope_digest === audit.approval_scope_digest,
  "automation owner approval authority conflicts with the audit run", 4);
  if (baselineLineage) {
    requireValue(approval.baseline_lineage_digest === baselineLineage.lineage_digest,
      "automation owner approval baseline_lineage conflicts with the audit run", 4);
  } else {
    requireValue(approval.baseline_lineage_digest === undefined,
      "automation owner approval added baseline_lineage without authority", 4);
  }
  requireValue(receipt.owner_approval.status === approval.status &&
    receipt.owner_approval.owner_id === approval.owner_id &&
    receipt.owner_approval.note === approval.note &&
    receipt.owner_approval.decided_at === approval.decided_at,
  "automation final receipt owner decision conflicts with approval evidence", 4);
  requireValue(receipt.owner_approval.source?.digest === approvalSnapshot.digest,
    "automation final receipt owner approval source digest mismatch", 4);
  requireValue(
    receipt.owner_approval.source?.physical_identity_digest ===
      approvalEvidence.physical_identity_digest &&
      approvalEvidence.physical_identity_digest === approvalSnapshot.physical_identity_digest,
    "automation final receipt owner approval physical identity mismatch",
    4
  );
  const normalized = {
    status: approval.status,
    owner_id: approval.owner_id,
    note: approval.note,
    decided_at: approval.decided_at,
    journey_identity: approval.journey_identity,
    scope_digest: approval.scope_digest
  };
  if (baselineLineage) normalized.baseline_lineage_digest = approval.baseline_lineage_digest;
  requireValue(receipt.owner_approval.normalized_digest === canonicalDigest(normalized),
    "automation final receipt owner approval normalized digest mismatch", 4);
}

function verifyLeaseRecoveries(state, migrationReceipt = null, { allowLegacyIdentity = false } = {}) {
  for (const [index, snapshot] of (state.lease_recoveries || []).entries()) {
    requireValue(fs.existsSync(snapshot.path),
      `state lease recovery receipt is missing: ${index + 1}`, 4);
    const pinned = readPinnedRecoveryReceipt(
      snapshot.path,
      `state lease recovery receipt ${index + 1}`
    );
    requireValue(pinned.digest === snapshot.digest,
      `state lease recovery receipt changed: ${index + 1}`, 4);
    const receipt = pinned.input;
    const copy = { ...receipt };
    delete copy.receipt_digest;
    requireValue(canonicalDigest(copy) === receipt.receipt_digest &&
      receipt.receipt_digest === snapshot.receipt_digest,
    `state lease recovery receipt digest mismatch: ${index + 1}`, 4);
    requireValue(receipt.run_id === state.run_id &&
      path.resolve(receipt.state_path) === path.resolve(state.state_path),
    `state lease recovery receipt does not bind the automation state: ${index + 1}`, 4);
    const capturedLegacyReceipt = !receipt.journey_identity && (
      !state.journey_identity || (
        state.journey_identity?.invocation === "legacy-migrated" &&
        (migrationReceipt?.legacy_lease_recoveries || []).includes(receipt.receipt_digest)
      )
    );
    requireValue(
      receipt.state_lease_recovery_receipt_version === 3 || (
        receipt.state_lease_recovery_receipt_version === 1 && capturedLegacyReceipt
      ),
      `modern state lease recovery receipt ${index + 1} predates initialization-anchor binding; restart the run`,
      4
    );
    if (receipt.state_lease_recovery_receipt_version === 3) {
      requireValue(DIGEST_PATTERN.test(receipt.recovered_lease?.lease_digest || ""),
        `state lease recovery receipt root lease digest is invalid: ${index + 1}`, 4);
      requireValue(
        path.resolve(snapshot.path) === path.resolve(leaseRecoveryReceiptPath(
          state.state_path,
          state,
          receipt.recovered_lease?.lease_digest
        )),
        `state lease recovery receipt is outside its deterministic transaction path: ${index + 1}`,
        4
      );
      const reconciliation = receipt.initialization_reconciliation;
      if (reconciliation !== null) {
        requireValue(reconciliation?.initialization_reconciliation_version === 3 &&
          DIGEST_PATTERN.test(reconciliation.previous_state_digest || "") &&
          DIGEST_PATTERN.test(reconciliation.reconciled_initialization_graph_digest || "") &&
          Array.isArray(reconciliation.reconciled_anchor_ids) &&
          Array.isArray(reconciliation.reconciled_steps) &&
          reconciliation.initialization_authority &&
          reconciliation.initialization_authority.status === "bound",
        `state lease recovery initialization reconciliation is malformed: ${index + 1}`, 4);
        requireValue(reconciliation.previous_state_digest === receipt.recovered_lease?.state_digest,
          `state lease recovery reconciliation does not bind its recovered state: ${index + 1}`, 4);
        requireValue(receipt.abandoned_attempt === null,
          `state lease recovery cannot reconcile initialization while abandoning a child: ${index + 1}`, 4);
        const declarations = new Map(initializationAnchorDeclarations(state)
          .map((anchor) => [anchor.id, anchor]));
        const anchorIds = new Set();
        for (const anchorId of reconciliation.reconciled_anchor_ids) {
          const declaration = declarations.get(anchorId);
          requireValue(declaration && !anchorIds.has(anchorId),
          `state lease recovery reconciliation anchor is invalid: ${index + 1}`, 4);
          anchorIds.add(anchorId);
        }
        requireValue(new Set(reconciliation.reconciled_steps).size ===
          reconciliation.reconciled_steps.length &&
          reconciliation.reconciled_steps.every((stepId) =>
            INITIALIZATION_STEP_IDS.includes(stepId)),
        `state lease recovery reconciliation steps are invalid: ${index + 1}`, 4);
        const authoritySnapshot = reconciliation.initialization_authority.snapshot;
        requireValue(authoritySnapshot && sameExactKeys(authoritySnapshot, [
          "path", "digest", "receipt_digest", "initialization_graph_digest"
        ]) && state.initialization_authority_receipt &&
          jsonValuesMatch(authoritySnapshot, state.initialization_authority_receipt),
        `state lease recovery initialization authority is invalid: ${index + 1}`, 4);
        requireValue(
          reconciliation.reconciled_initialization_graph_digest ===
            authoritySnapshot.initialization_graph_digest,
          `state lease recovery reconciliation graph digest is invalid: ${index + 1}`,
          4
        );
      }
    }
    if (!state.journey_identity) {
      requireValue(allowLegacyIdentity && receipt.journey_identity === null,
        `legacy state lease recovery receipt has unexpected identity: ${index + 1}`, 4);
    } else if (receipt.journey_identity) {
      requireValue(identitiesMatch(receipt.journey_identity, state.journey_identity),
        `state lease recovery receipt journey identity mismatch: ${index + 1}`, 4);
      requireValue(receipt.resume_authority_digest === state.resume_authority_digest,
        `state lease recovery receipt resume authority mismatch: ${index + 1}`, 4);
    } else {
      requireValue(capturedLegacyReceipt,
      `state lease recovery receipt lacks the KillSlopRouter journey identity: ${index + 1}`, 4);
    }
  }
}

function readAutomationStateCore(statePath, {
  allowMissingIdentity = false,
  allowInFlight = false,
  authorityDigest = null,
  legacyBackupPath = null,
  requireResumeAuthority = false,
  allowUnboundCrashSidecars = false,
  authorityFaultInjector = null,
  expectedStateFileDigest = null
} = {}) {
  const absolute = secureAutomationStatePath(statePath);
  const pinnedState = readPinnedAutomationJson(
    absolute,
    "automation run",
    {
      expectedDigest: expectedStateFileDigest,
      faultInjector: authorityFaultInjector
    }
  );
  const state = pinnedState.input;
  requireValue(state?.automation_run_version === 1, "automation_run_version must be 1");
  requireValue(path.resolve(state.state_path) === absolute,
    "automation state path does not match the resume target", 4);
  const expected = state.state_digest;
  requireValue(canonicalDigest(stateManifest(state)) === expected,
    "automation state digest mismatch", 4);
  if (state.journey_identity) {
    verifyJourneyIdentity(state.journey_identity, {
      runId: state.run_id,
      label: "automation journey_identity"
    });
  } else {
    requireValue(allowMissingIdentity,
      "legacy automation state lacks journey_identity; rerun with --migrate-identity", 4);
    verifyLegacyBackupAuthority(absolute, state, legacyBackupPath, authorityDigest);
  }
  if (state.journey_identity && (requireResumeAuthority || authorityDigest !== null)) {
    requireValue(DIGEST_PATTERN.test(authorityDigest || ""),
      "resume requires --authority-digest from the original KillSlopRouter start receipt", 4);
    requireValue(
      DIGEST_PATTERN.test(state.resume_authority_digest || "") &&
      state.resume_authority_digest === authorityDigest,
      "resume authority digest does not match the original KillSlopRouter journey",
      4
    );
  }
  requireValue(path.resolve(state.state_directory) === path.resolve(stateDirectory(absolute)),
    "automation state_directory does not match the resume target", 4);
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
  if (state.journey_identity) {
    verifyStartResumeAuthority(state, { faultInjector: authorityFaultInjector });
  }
  verifyAutomationParentPathGraph(state);
  if (state.journey_identity && state.journey_identity.invocation !== "legacy-migrated") {
    inspectInitializationAnchors(state, { allowUnbound: allowUnboundCrashSidecars });
  }
  if (state.journey_identity) {
    inspectInitializationAuthority(state, {
      allowUnbound: allowUnboundCrashSidecars,
      faultInjector: authorityFaultInjector
    });
  }
  const migrationReceipt = state.journey_identity
    ? verifyIdentityMigration(state, { faultInjector: authorityFaultInjector })
    : null;
  if (state.journey_identity?.invocation === "legacy-migrated") {
    requireValue(Boolean(migrationReceipt),
      "legacy-migrated automation requires a verified identity migration receipt", 4);
  } else if (state.journey_identity) {
    requireValue(!migrationReceipt,
      "non-legacy automation cannot carry an identity migration receipt", 4);
  }
  const routeAuthority = state.journey_identity
    ? verifyAutomationRouteAuthority(state, migrationReceipt, {
      faultInjector: authorityFaultInjector
    })
    : { plan: state.paths?.plan ? readPinnedAutomationJson(
      state.paths.plan.path,
      "legacy route plan",
      { expectedDigest: state.paths.plan.digest, faultInjector: authorityFaultInjector }
    ).input : null,
      baselineLineage: state.baseline_lineage || null };
  verifyLeaseRecoveries(state, migrationReceipt, { allowLegacyIdentity: allowMissingIdentity });
  for (const [stepId, step] of Object.entries(state.steps || {})) {
    if (state.journey_identity) {
      verifyStepReceipt(state, stepId, step, migrationReceipt, {
        faultInjector: authorityFaultInjector
      });
    }
    else {
      requireValue(fs.existsSync(step.receipt_path), `automation step receipt is missing: ${stepId}`, 4);
      const receipt = readPinnedAutomationJson(
        step.receipt_path,
        `legacy automation ${stepId} receipt`,
        { expectedDigest: step.file_digest, faultInjector: authorityFaultInjector }
      ).input;
      const copy = { ...receipt };
      delete copy.receipt_digest;
      requireValue(canonicalDigest(copy) === receipt.receipt_digest &&
        receipt.receipt_digest === step.receipt_digest,
      `automation step receipt digest mismatch: ${stepId}`, 4);
    }
  }
  if (state.baseline_lineage) {
    try {
      verifyBaselineLineage(state.baseline_lineage, "automation baseline_lineage");
    } catch (error) {
      throw new RouterError(error.message, 4);
    }
  }
  if (routeAuthority.plan) {
    requireValue(
      baselineLineagesMatch(
        routeAuthority.plan.baseline_lineage || null,
        state.baseline_lineage || null
      ),
      "automation and route plan baseline_lineage conflict",
      4
    );
  }
  if (state.baseline_observation) {
    requireValue(state.journey_identity,
      "legacy observation-bound automation cannot be identity-migrated; start a new run", 4);
    verifyObservationBinding(state.baseline_observation, absolute);
  }
  let audit = null;
  if (state.paths?.audit && state.journey_identity) {
    audit = readPinnedAutomationJson(
      state.paths.audit.path,
      "automation audit run",
      { expectedDigest: state.paths.audit.digest, faultInjector: authorityFaultInjector }
    ).input;
    verifyAuditJourneyIdentity(audit, { faultInjector: authorityFaultInjector });
    requireValue(identitiesMatch(audit.journey_identity, state.journey_identity),
      "automation and audit journey identities conflict", 4);
    requireValue(
      baselineLineagesMatch(audit.baseline_lineage || null, state.baseline_lineage || null),
      "automation and audit baseline_lineage conflict",
      4
    );
    requireValue(
      (audit.creator?.actor_id || null) === (state.request.creator_actor_id || null),
      "automation creator actor conflicts with the digest-bound audit run",
      4
    );
  }
  verifyAutomationResultGraph(state, audit);
  verifyFinalReceiptAndApproval(state, audit, routeAuthority.baselineLineage, {
    faultInjector: authorityFaultInjector
  });
  requireValue(allowInFlight || !state.in_flight,
    "automation state has an unresolved in-flight child; inspect and explicitly recover its state lease before resume",
    5);
  return state;
}

export function readAutomationState(statePath) {
  return readAutomationStateCore(statePath);
}

function assertLegacyMigrationShape(state, plan, audit) {
  const source = supportedLegacySource(state);
  requireValue(sameExactKeys(plan, [
    "adjudication", "completion_eligible", "creator", "design_system", "evidence_contract",
    "execution_status", "input", "invariants", "next_required_command", "planning_gate",
    "profile_digest", "profile_path", "project_id", "receipt_version", "required_stage_ids",
    "route_id", "router_id", "router_path", "router_version", "stages", "status",
    "surface_resolution", "unresolved", "visual_intent", "visual_signature", "warnings"
  ]), `legacy route plan does not match the supported ${source.source_commit} shape`, 4);
  requireValue(sameExactKeys(audit, [
    "approval_scope_digest", "artifacts", "audit_run_version", "baseline_observation",
    "created_at", "creator", "evidence_contract", "hard_blockers", "invariants",
    "manifest_digest", "owner_approval_required", "packets", "planning_gate", "results",
    "root", "route", "run_id", "scope", "stages", "status", "triage", "updated_at",
    "visual_intent", "visual_intent_sources", "visual_signature", "visual_signature_sources"
  ]), `legacy audit does not match the supported ${source.source_commit} shape`, 4);
  const unsupported = [];
  if (Object.hasOwn(state, "resume_authority_digest")) unsupported.push("resume_authority_digest");
  if (Object.hasOwn(state, "resume_authority_receipt")) unsupported.push("resume_authority_receipt");
  if (Object.hasOwn(state, "in_flight")) unsupported.push("in_flight");
  if (Object.hasOwn(state, "identity_migration")) unsupported.push("identity_migration");
  if (Object.hasOwn(state, "baseline_lineage")) unsupported.push("baseline_lineage");
  if (Object.hasOwn(state.request || {}, "router_digest")) unsupported.push("request.router_digest");
  if (Object.hasOwn(state.request || {}, "artifact_digests")) unsupported.push("request.artifact_digests");
  if (Object.hasOwn(plan || {}, "router_digest")) unsupported.push("plan.router_digest");
  if (Object.hasOwn(plan || {}, "baseline_lineage")) unsupported.push("plan.baseline_lineage");
  if (Object.hasOwn(audit || {}, "journey_identity")) unsupported.push("audit.journey_identity");
  if (Object.hasOwn(audit || {}, "baseline_lineage")) unsupported.push("audit.baseline_lineage");
  for (const packet of audit?.packets || []) {
    if (Object.hasOwn(packet, "run_id") || Object.hasOwn(packet, "journey_identity") ||
      Object.hasOwn(packet, "participant") || Object.hasOwn(packet, "baseline_lineage")) {
      unsupported.push(`audit.packet:${packet.packet_id}`);
    }
  }
  for (const [stepId, step] of Object.entries(state.steps || {})) {
    const receipt = readPinnedAutomationJson(
      step.receipt_path,
      `legacy automation ${stepId} receipt`,
      { expectedDigest: step.file_digest }
    ).input;
    if (Object.hasOwn(receipt, "journey_identity") ||
      Object.hasOwn(receipt.payload || {}, "resume_authority_digest") ||
      Object.hasOwn(receipt.payload || {}, "baseline_lineage_digest")) {
      unsupported.push(`step:${stepId}`);
    }
  }
  requireValue(unsupported.length === 0,
    `identity migration accepts only a genuine pre-identity state; modern markers found: ${unsupported.join(", ")}`,
    4);
  return verifyLegacyHistoricalCapture(state, plan, audit, source);
}

function legacyComparablePlan(plan) {
  const comparable = structuredClone(plan);
  delete comparable.router_digest;
  if (comparable.planning_gate) {
    delete comparable.planning_gate.planning_authority_version;
    delete comparable.planning_gate.authority_sources;
  }
  return comparable;
}

function rebindLegacyStepReceipts(state, journeyIdentity, legacySteps, legacyStepReceipts, {
  plan,
  audit,
  receiptsDirectory
}) {
  const reboundSteps = {};
  for (const [stepId, step] of Object.entries(legacySteps || {})) {
    const receipt = readPinnedAutomationJson(
      step.receipt_path,
      `legacy automation ${stepId} receipt`,
      { expectedDigest: step.file_digest }
    ).input;
    requireValue(legacyStepReceipts[stepId] === receipt.receipt_digest,
      `legacy automation step receipt changed during migration: ${stepId}`, 4);
    const payload = { ...(receipt.payload || {}) };
    if (stepId === "plan") {
      payload.plan_path = state.paths.plan.path;
      payload.plan_digest = canonicalDigest(plan);
    }
    if (stepId === "audit-init") {
      payload.audit_path = state.paths.audit.path;
      payload.audit_digest = state.paths.audit.digest;
      payload.audit_manifest_digest = audit.manifest_digest;
      payload.audit_authority_digest = audit.audit_authority_digest;
    }
    if (stepId === "dispatch" && state.paths.packets) {
      payload.packets_directory = state.paths.packets.path;
      payload.packets_digest = state.paths.packets.digest;
    }
    payload.resume_authority_digest = state.resume_authority_digest;
    const rebound = {
      ...receipt,
      journey_identity: journeyIdentity,
      payload
    };
    delete rebound.receipt_digest;
    rebound.receipt_digest = canonicalDigest(rebound);
    const receiptPath = path.join(receiptsDirectory, STEP_FILES[stepId] || `${stepId}.json`);
    writeJsonAtomic(receiptPath, rebound);
    reboundSteps[stepId] = {
      ...step,
      receipt_path: receiptPath,
      receipt_digest: rebound.receipt_digest,
      file_digest: hashArtifact(receiptPath)
    };
  }
  state.steps = reboundSteps;
}

function migrateAutomationStateIdentityWithLease(
  statePath,
  lease,
  authorityDigest,
  legacyBackupPath,
  faultInjector = null
) {
  const state = bindStateLease(
    readAutomationStateCore(statePath, {
      allowMissingIdentity: true,
      authorityDigest,
      legacyBackupPath,
      authorityFaultInjector: faultInjector
    }),
    lease
  );
  const legacyBackup = verifyLegacyBackupAuthority(
    statePath,
    state,
    legacyBackupPath,
    authorityDigest
  );
  requireValue(!state.journey_identity, "automation state already has journey_identity", 4);
  requireValue((state.attempts || []).length === 0,
    "legacy automation contains adapter attempts; start a new KillSlopRouter run so child evidence is identity-bound",
    4);
  requireValue(!state.final_receipt_digest && !state.paths?.final && !state.paths?.approval,
    "legacy automation contains final or approval evidence; start a new KillSlopRouter run", 4);
  requireValue(!state.baseline_observation,
    "legacy automation contains an observation binding; start a new KillSlopRouter run", 4);
  requireValue(state.paths?.plan && state.paths?.audit,
    "legacy migration requires an evidence-free state with canonical plan and audit sources; start a new run otherwise",
    4);
  requireValue(state.request?.router_path && fs.existsSync(state.request.router_path),
    "legacy automation router source is missing", 4);
  const pinnedRouter = readPinnedAutomationRouterJson(
    state.request.router_path,
    "legacy automation router",
    { expectedDigest: legacyBackup.router_digest, faultInjector }
  );
  const router = pinnedRouter.input;
  const pinnedLegacyPlan = readPinnedAutomationJson(
    state.paths.plan.path,
    "legacy automation plan",
    { expectedDigest: state.paths.plan.digest, faultInjector }
  );
  const legacyPlan = pinnedLegacyPlan.input;
  const pinnedLegacyAudit = readPinnedAutomationJson(
    state.paths.audit.path,
    "legacy automation audit run",
    { expectedDigest: state.paths.audit.digest, faultInjector }
  );
  const legacyAudit = pinnedLegacyAudit.input;
  const captureFingerprints = assertLegacyMigrationShape(state, legacyPlan, legacyAudit);
  requireValue(
    legacyPlan.router_id === router.router_id && legacyPlan.router_version === router.router_version,
    "legacy automation plan conflicts with its router source", 4);
  let projectProfile = null;
  if (state.request.profile_path) {
    projectProfile = readPinnedAutomationJson(
      state.request.profile_path,
      "legacy automation project profile",
      { expectedDigest: state.request.profile_digest, faultInjector }
    ).input;
  }
  let plan;
  try {
    plan = planRoute({
      router,
      profile: projectProfile,
      routerPath: state.request.router_path,
      profilePath: state.request.profile_path || null,
      input: state.request.input,
      artifacts: state.request.artifacts,
      root: state.request.root
    });
  } catch (error) {
    throw new RouterError(`legacy automation cannot be replanned: ${error.message}`, 4);
  }
  requireValue(!plan.baseline_lineage,
    "legacy identity migration cannot introduce baseline_lineage", 4);
  requireValue(
    canonicalDigest(legacyComparablePlan(plan)) === canonicalDigest(legacyPlan),
    "legacy automation plan conflicts with current router replanning; start a new journey",
    4
  );

  const previous = {
    state_digest: state.state_digest,
    plan_digest: state.paths.plan.digest,
    audit_digest: state.paths?.audit?.digest || null,
    packets_digest: state.paths?.packets?.digest || null
  };
  const legacySources = {
    plan: {
      path: pinnedLegacyPlan.path,
      digest: pinnedLegacyPlan.digest,
      physical_identity_digest: pinnedLegacyPlan.physical_identity_digest
    },
    audit: state.paths?.audit ? {
      path: pinnedLegacyAudit.path,
      digest: pinnedLegacyAudit.digest,
      physical_identity_digest: pinnedLegacyAudit.physical_identity_digest
    } : null,
    packets: state.paths?.packets ? (() => {
      const snapshot = snapshotArtifact(state.paths.packets.path, { root: state.state_directory });
      return {
        path: snapshot.resolved_path,
        digest: snapshot.digest,
        physical_identity_digest: snapshot.physical_identity_digest
      };
    })() : null
  };
  const journeyIdentity = createJourneyIdentity({
    runId: state.run_id,
    routerId: router.router_id,
    routerVersion: router.router_version,
    invocation: "legacy-migrated"
  });
  const legacyStepReceipts = Object.fromEntries(Object.entries(state.steps || {})
    .map(([stepId, step]) => [stepId, step.receipt_digest]));
  const legacySteps = structuredClone(state.steps || {});
  const legacyLeaseRecoveries = (state.lease_recoveries || [])
    .map((snapshot) => snapshot.receipt_digest);
  const transactionCandidate = path.join(
    state.state_directory,
    "identity-migrations",
    crypto.randomUUID()
  );
  let transactionDirectory;
  try {
    secureWritablePath(
      transactionCandidate,
      "identity migration transaction directory",
      { boundary: state.state_directory }
    );
    transactionDirectory = path.resolve(transactionCandidate);
  } catch (error) {
    throw new RouterError(error.message, 4);
  }
  const transactionReceiptsDirectory = path.join(transactionDirectory, "receipts");
  ensureAutomationDirectory(
    transactionDirectory,
    "identity migration transaction directory",
    { boundary: state.state_directory, faultInjector }
  );
  ensureAutomationDirectory(
    transactionReceiptsDirectory,
    "identity migration receipt directory",
    { boundary: transactionDirectory, faultInjector }
  );
  secureAutomationGraphTarget(
    transactionDirectory,
    "identity migration transaction directory",
    "directory",
    secureAutomationGraphTarget(
      state.state_directory,
      "identity migration state directory",
      "directory"
    )
  );
  state.journey_identity = journeyIdentity;
  const migratedRouterSnapshot = snapshotArtifact(state.request.router_path, {
    root: state.request.root
  });
  requireValue(
    migratedRouterSnapshot.digest === pinnedRouter.digest &&
      migratedRouterSnapshot.physical_identity_digest === pinnedRouter.physical_identity_digest,
    "legacy automation router physical authority changed during migration",
    4
  );
  state.request.router_digest = migratedRouterSnapshot.digest;
  state.request.router_physical_identity_digest =
    migratedRouterSnapshot.physical_identity_digest;
  const migratedProfileSnapshot = state.request.profile_path
    ? snapshotArtifact(state.request.profile_path, { root: state.request.root })
    : null;
  state.request.profile_physical_identity_digest =
    migratedProfileSnapshot?.physical_identity_digest || null;
  const migratedArtifactSnapshots = state.request.artifacts.map((artifact) =>
    snapshotArtifact(artifact, { root: state.request.root }));
  state.request.artifact_digests = Object.fromEntries(
    migratedArtifactSnapshots.map((snapshot) => [snapshot.resolved_path, snapshot.digest])
  );
  state.request.artifact_physical_identity_digests = Object.fromEntries(
    migratedArtifactSnapshots.map((snapshot) => [
      snapshot.resolved_path,
      snapshot.physical_identity_digest
    ])
  );
  state.request.initial_plan_authority_digest = automationPlanAuthorityDigest(plan);
  state.in_flight = null;
  state.lease_recoveries = state.lease_recoveries || [];
  const planPath = path.join(transactionDirectory, "plan.json");
  writeJsonAtomic(planPath, plan);
  state.paths.plan = snapshotPath(planPath);

  requireValue(legacyAudit.run_id === state.run_id,
    "legacy automation audit run_id conflicts with the state", 4);
  const audit = rebindLegacyAuditIdentity(legacyAudit, journeyIdentity, { plan, planPath });
  const auditPath = path.join(transactionDirectory, "audit-run.json");
  writeJsonAtomic(auditPath, audit);
  state.paths.audit = snapshotPath(auditPath);
  const packetsPath = path.join(transactionDirectory, "packets");
  const migratedDispatch = dispatchAuditPackets(audit, packetsPath, {
    authorityDigest: audit.audit_authority_digest
  });
  state.paths.packets = { path: packetsPath, digest: hashArtifact(packetsPath) };

  const migrationAuthorityBody = {
    identity_migration_authority_version: 1,
    transaction_directory: transactionDirectory,
    legacy_backup: legacyBackup,
    historical_source: {
      source_commit: legacyBackup.source_commit,
      router_digest: legacyBackup.router_digest,
      capture_fingerprints: captureFingerprints
    },
    previous,
    legacy_sources: legacySources,
    legacy_step_receipts: legacyStepReceipts,
    legacy_lease_recoveries: legacyLeaseRecoveries
  };
  const migrationAuthority = {
    ...migrationAuthorityBody,
    authority_digest: canonicalDigest(migrationAuthorityBody)
  };
  state.identity_migration = { authority: migrationAuthority };
  state.resume_authority_digest = automationResumeAuthorityDigest(state, plan);
  rebindLegacyStepReceipts(
    state,
    journeyIdentity,
    legacySteps,
    legacyStepReceipts,
    { plan, audit, receiptsDirectory: transactionReceiptsDirectory }
  );
  if (!state.steps.dispatch) {
    recordStep(state, "dispatch", "completed", {
      packet_directory: packetsPath,
      packet_directory_digest: state.paths.packets.digest,
      packet_count: migratedDispatch.packets.length,
      packets: audit.packets.map((packet) => ({
        packet_id: packet.packet_id,
        provider_id: packet.provider.id,
        participant: packet.participant,
        packet_digest: packet.packet_digest
      }))
    }, { deferStateWrite: true });
  }
  faultInjector?.("after-sidecar-staging", {
    state_path: state.state_path,
    transaction_directory: transactionDirectory
  });

  const receipt = {
    identity_migration_receipt_version: 1,
    run_id: state.run_id,
    status: "migrated",
    migrated_at: nowIso(),
    journey_identity: journeyIdentity,
    previous_state_digest: previous.state_digest,
    legacy_backup: legacyBackup,
    migration_authority: migrationAuthority,
    resume_authority_digest: state.resume_authority_digest,
    verified: {
      source_commit: legacyBackup.source_commit,
      router_path: path.resolve(state.request.router_path),
      router_digest: hashArtifact(state.request.router_path),
      router_id: router.router_id,
      router_version: router.router_version,
      previous_plan_digest: previous.plan_digest,
      plan_digest: state.paths.plan.digest,
      previous_audit_digest: previous.audit_digest,
      previous_packets_digest: previous.packets_digest,
      prior_attempt_count: 0,
      prior_result_count: 0,
      prior_approval_present: false
    },
    legacy_step_receipts: legacyStepReceipts,
    legacy_lease_recoveries: legacyLeaseRecoveries
  };
  receipt.receipt_digest = canonicalDigest(receipt);
  const receiptPath = path.join(
    transactionReceiptsDirectory,
    "00-identity-migration-receipt.json"
  );
  writeJsonAtomic(receiptPath, receipt);
  const migrationReceiptSnapshot = snapshotArtifact(receiptPath, {
    root: transactionReceiptsDirectory
  });
  state.identity_migration = {
    authority: migrationAuthority,
    path: receiptPath,
    digest: migrationReceiptSnapshot.digest,
    physical_identity_digest: migrationReceiptSnapshot.physical_identity_digest,
    receipt_digest: receipt.receipt_digest
  };
  faultInjector?.("before-state-commit", {
    state_path: state.state_path,
    transaction_directory: transactionDirectory
  });
  writeState(state);
  return bindStateLease(readAutomationStateCore(state.state_path), lease);
}

export function migrateAutomationStateIdentity(statePath, {
  authorityDigest = null,
  legacyBackupPath = null,
  faultInjector = null
} = {}) {
  const lease = acquireStateLease({ statePath, operation: "migrate" });
  let failure = null;
  try {
    return migrateAutomationStateIdentityWithLease(
      lease.state_path,
      lease,
      authorityDigest,
      legacyBackupPath,
      faultInjector
    );
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

function newState({
  statePath,
  routerPath,
  profilePath,
  input,
  artifacts,
  scope,
  creatorActorId,
  observationRunPath,
  router,
  initialPlanAuthorityDigest,
  invocation,
  root
}) {
  const absoluteStatePath = path.resolve(statePath);
  const directory = stateDirectory(absoluteStatePath);
  const runId = crypto.randomUUID();
  const artifactPaths = artifacts.map((artifact) => path.resolve(root, artifact));
  const routerSnapshot = snapshotArtifact(routerPath, { root });
  const profileSnapshot = profilePath ? snapshotArtifact(profilePath, { root }) : null;
  const artifactSnapshots = artifactPaths.map((artifact) =>
    snapshotArtifact(artifact, { root }));
  return sealState({
    automation_run_version: 1,
    run_id: runId,
    journey_identity: createJourneyIdentity({
      runId,
      routerId: router.router_id,
      routerVersion: router.router_version,
      invocation
    }),
    status: "running",
    created_at: nowIso(),
    updated_at: nowIso(),
    state_path: absoluteStatePath,
    state_directory: directory,
    request: {
      router_path: path.resolve(routerPath),
      router_digest: routerSnapshot.digest,
      router_physical_identity_digest: routerSnapshot.physical_identity_digest,
      profile_path: profilePath ? path.resolve(profilePath) : null,
      profile_digest: profileSnapshot?.digest || null,
      profile_physical_identity_digest: profileSnapshot?.physical_identity_digest || null,
      root: path.resolve(root),
      input,
      artifacts: artifactPaths,
      artifact_digests: Object.fromEntries(artifactSnapshots.map((snapshot) => [
        snapshot.resolved_path,
        snapshot.digest
      ])),
      artifact_physical_identity_digests: Object.fromEntries(
        artifactSnapshots.map((snapshot) => [
          snapshot.resolved_path,
          snapshot.physical_identity_digest
        ])
      ),
      scope,
      creator_actor_id: creatorActorId || null,
      initial_plan_authority_digest: initialPlanAuthorityDigest,
      observation_run_path: observationRunPath ? path.resolve(observationRunPath) : null
    },
    paths: {},
    steps: {},
    attempts: [],
    in_flight: null,
    lease_recoveries: [],
    blockers: [],
    pending: [],
    identity_migration: null,
    baseline_observation: null,
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
  const payload = {
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
    visual_signature: plan.visual_signature ? {
      status: plan.visual_signature.status,
      authority_status: plan.visual_signature.authority_status,
      primary: plan.visual_signature.palette?.primary?.[0]?.value || null,
      typography_family: plan.visual_signature.typography?.families?.[0]?.family || null,
      density: plan.visual_signature.density?.mode || null,
      elevation: plan.visual_signature.elevation?.strategy || null,
      imagery: plan.visual_signature.imagery?.strategy || null,
      motion: plan.visual_signature.motion?.intensity || null,
      contract_digest: plan.visual_signature.contract_digest
    } : null,
    unresolved: plan.unresolved,
    warnings: plan.warnings,
    baseline_observation: plan.baseline_observation ? {
      run_id: plan.baseline_observation.run_id,
      state_digest: plan.baseline_observation.state_digest,
      browser_result_digest: plan.baseline_observation.browser_result_digest,
      required_scenarios: plan.baseline_observation.required_scenarios
    } : null,
    plan_path: planPath,
    plan_digest: canonicalDigest(plan),
    routing: plan.stages.map((stage) => ({
      stage_id: stage.id,
      status: stage.routing_status,
      selected_providers: stage.selected_actors.map((actor) => actor.id),
      missing_capabilities: stage.missing_capabilities
    }))
  };
  if (plan.baseline_lineage) {
    payload.baseline_lineage = {
      lineage_id: plan.baseline_lineage.lineage_id,
      relationship: plan.baseline_lineage.relationship,
      parent_baseline_id: plan.baseline_lineage.parent_baseline.id,
      parent_baseline_version: plan.baseline_lineage.parent_baseline.version,
      slice_id: plan.baseline_lineage.candidate.slice_id,
      candidate_version: plan.baseline_lineage.candidate.version,
      promotion_authority: plan.baseline_lineage.promotion.authority,
      supersedes_parent: plan.baseline_lineage.promotion.supersedes_parent,
      lineage_digest: plan.baseline_lineage.lineage_digest
    };
  }
  return payload;
}

function observationBody(value) {
  const { observation_digest: _digest, ...body } = value;
  return body;
}

function verifyObservationBinding(observation, currentStatePath = null) {
  requireValue(observation?.ui_observation_version === 1,
    "baseline observation version must be 1", 4);
  requireValue(canonicalDigest(observationBody(observation)) === observation.observation_digest,
    "baseline observation digest mismatch", 4);
  requireValue(path.resolve(observation.state_path) !== path.resolve(currentStatePath || ""),
    "automation state cannot observe itself", 4);
  requireValue(fs.existsSync(observation.state_path), "baseline observation state is missing", 4);
  const state = readAutomationStateCore(observation.state_path, {
    expectedStateFileDigest: observation.state_file_digest
  });
  requireValue(state.state_digest === observation.state_digest,
    "baseline observation state digest changed", 4);
  requireValue(state.run_id === observation.run_id,
    "baseline observation run id changed", 4);
  requireValue(identitiesMatch(state.journey_identity, observation.journey_identity),
    "baseline observation journey identity changed", 4);
  requireValue(state.paths.audit?.digest === observation.audit_digest,
    "baseline observation audit digest changed", 4);
  requireValue(state.paths.final?.digest === observation.final_file_digest,
    "baseline observation final receipt changed", 4);
  requireValue(state.final_receipt_digest === observation.final_receipt_digest,
    "baseline observation final receipt digest changed", 4);
}

function bindObservationRun(observationRunPath, { plan, artifacts, root, currentStatePath = null }) {
  requireValue(observationRunPath,
    "runtime redesign requires --observation-run from the completed pre-change UI audit", 5);
  const absolute = path.resolve(observationRunPath);
  requireValue(!currentStatePath || absolute !== path.resolve(currentStatePath),
    "automation state cannot use itself as --observation-run", 4);
  const state = readAutomationState(absolute);
  requireValue(state.request?.input?.task === "audit",
    "--observation-run must come from a task audit run", 5);
  requireValue(state.request?.scope === "runtime",
    "--observation-run must be a runtime audit", 5);
  for (const stepId of REQUIRED_OBSERVATION_STEPS) {
    requireValue(state.steps?.[stepId]?.status === "completed",
      `--observation-run is incomplete at ${stepId}`, 5);
  }
  requireValue(state.paths?.final && state.final_receipt_digest,
    "--observation-run must reach finalization after critic and browser collection", 5);

  const observedPlan = readPinnedAutomationJson(
    state.paths.plan.path,
    "observation route plan",
    { expectedDigest: state.paths.plan.digest }
  ).input;
  const audit = readPinnedAutomationJson(
    state.paths.audit.path,
    "observation audit run",
    { expectedDigest: state.paths.audit.digest }
  ).input;
  requireValue(observedPlan.project_id === plan.project_id,
    "--observation-run project does not match the redesign run", 5);
  requireValue(observedPlan.profile_digest === plan.profile_digest,
    "--observation-run routed profile does not match the redesign run", 5);
  requireValue(observedPlan.surface_resolution?.resolved_surface ===
    plan.surface_resolution?.resolved_surface,
  "--observation-run surface does not match the redesign run", 5);
  const requestedArtifacts = artifacts.map((artifact) => path.resolve(root, artifact)).sort();
  const observedArtifacts = audit.artifacts.map((artifact) => artifact.resolved_path).sort();
  requireValue(sameStringSet(requestedArtifacts, observedArtifacts),
    "--observation-run artifact paths do not match the redesign run", 5);
  const requiredScenarios = plan.evidence_contract?.required_scenarios || [];
  requireValue(sameStringSet(
    requiredScenarios,
    observedPlan.evidence_contract?.required_scenarios || []
  ), "--observation-run required scenario inventory does not match the redesign run", 5);

  const redesignBrowserActor = plan.stages
    .find((stage) => stage.id === "browser-evidence")
    ?.selected_actors.find((actor) => actor.id === "browser-evidence");
  requireValue(redesignBrowserActor?.resolved_to === PLAYWRIGHT_PROVIDER_TARGET,
    "runtime redesign did not route the official Playwright adapter", 5);
  const browserPacket = audit.packets.find((packet) => packet.stage_id === "browser-evidence");
  requireValue(browserPacket, "--observation-run has no browser-evidence packet", 5);
  requireValue(browserPacket.provider.resolved_to === PLAYWRIGHT_PROVIDER_TARGET,
    "--observation-run did not route the official Playwright adapter", 5);
  const browserResult = audit.results.find((result) => result.packet_id === browserPacket.packet_id);
  requireValue(browserResult, "--observation-run has no ingested browser result", 5);
  const browserAttempt = [...state.attempts].reverse().find((attempt) =>
    attempt.packet_id === browserPacket.packet_id &&
    attempt.execution_status === "ran" &&
    attempt.ingest_status === "recorded"
  );
  requireValue(
    browserAttempt?.adapter === "browser-json-v1" &&
    browserAttempt.child_pid &&
    browserAttempt.metadata?.transport === "official-playwright-json-v1",
    "--observation-run browser evidence was not executed by the official Playwright child adapter",
    5
  );
  const coveredScenarios = new Set(browserResult.normalized.evidence
    .flatMap((item) => item.scenarios || []));
  for (const scenario of requiredScenarios) {
    requireValue(coveredScenarios.has(scenario),
      `--observation-run browser evidence is missing required scenario: ${scenario}`, 5);
  }

  const observation = {
    ui_observation_version: 1,
    state_path: absolute,
    state_file_digest: hashArtifact(absolute),
    state_digest: state.state_digest,
    run_id: state.run_id,
    journey_identity: state.journey_identity,
    audit_digest: state.paths.audit.digest,
    final_file_digest: state.paths.final.digest,
    final_receipt_digest: state.final_receipt_digest,
    browser_packet_id: browserPacket.packet_id,
    browser_result_digest: browserResult.normalized_digest,
    project_id: plan.project_id,
    profile_digest: plan.profile_digest,
    surface: plan.surface_resolution.resolved_surface,
    artifact_digests: Object.fromEntries(audit.artifacts.map((artifact) => [artifact.path, artifact.digest])),
    required_scenarios: [...requiredScenarios],
    observed_at: state.updated_at
  };
  observation.observation_digest = canonicalDigest(observation);
  verifyObservationBinding(observation, currentStatePath);
  return observation;
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
  observationRunPath = null,
  hostManifest = null,
  invocation = "explicit",
  root = process.cwd()
}) {
  const journeyIdentity = createJourneyIdentity({
    runId: "dry-run",
    routerId: router.router_id,
    routerVersion: router.router_version,
    invocation
  });
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
    run_id: "dry-run",
    journey_identity: journeyIdentity,
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
    if (observationRequired(input, scope)) {
      plan.baseline_observation = bindObservationRun(observationRunPath, {
        plan,
        artifacts,
        root
      });
      report.baseline_observation = plan.baseline_observation;
      report.plan = planPayload(plan);
    }
    const planning = verifyPlanningGateForAudit(plan, scope, { artifacts, root });
    report.planning_verification = {
      status: "verified",
      receipt_digest: planning?.receipt_digest || null,
      requirements: planning?.requirements || []
    };
    if (planning?.baseline_lineage) {
      report.planning_verification.baseline_lineage_digest =
        planning.baseline_lineage.lineage_digest;
    }
    const previewDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-dry-run-"));
    try {
      const previewPlanPath = path.join(previewDirectory, "plan.json");
      writeJsonAtomic(previewPlanPath, plan);
      const audit = initializeAudit({
        plan,
        planPath: previewPlanPath,
        artifacts,
        scope,
        creatorActorId,
        journeyIdentity,
        root,
        runId: "dry-run"
      });
      report.host_readiness = hostReadiness(audit, hostManifest);
    } finally {
      fs.rmSync(previewDirectory, { recursive: true, force: true });
    }
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
  verifyAuditJourneyIdentity(audit);
  requireValue(identitiesMatch(audit.journey_identity, state.journey_identity),
    "automation and audit journey identities conflict", 4);
  requireValue(
    baselineLineagesMatch(audit.baseline_lineage || null, state.baseline_lineage || null),
    "automation and audit baseline_lineage conflict",
    4
  );
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
  if (["blocked_execution_error", "abandoned_after_crash"].includes(last.execution_status)) {
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

function pathInsideBoundary(candidate, boundary) {
  const relative = path.relative(path.resolve(boundary), path.resolve(candidate));
  return relative === "" || (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function appendProtectedAutomationEntry(entries, target, label, mutableOutput = null) {
  const absolute = path.resolve(target);
  requireValue(fs.existsSync(absolute),
    `parent-owned automation path is missing at the child boundary: ${absolute}`, 4);
  const lexical = fs.lstatSync(absolute, { bigint: true });
  requireValue(!lexical.isSymbolicLink(),
    `parent-owned automation path contains a symlink at the child boundary: ${absolute}`, 4);
  const physical = fs.statSync(absolute, { bigint: true });
  const entry = {
    path: label,
    real_path: fs.realpathSync.native(absolute),
    device: String(physical.dev),
    inode: String(physical.ino),
    type: lexical.isDirectory() ? "directory" : lexical.isFile() ? "file" : "other"
  };
  requireValue(entry.type !== "other",
    `parent-owned automation path must be a regular file or directory: ${absolute}`, 4);
  if (entry.type === "file") {
    requireValue(physical.nlink === 1n,
      `parent-owned automation file must not be hard-linked: ${absolute}`, 4);
    entry.digest = hashArtifact(absolute);
  }
  const isMutableOutput = mutableOutput && path.resolve(mutableOutput) === absolute;
  if (isMutableOutput) entry.child_write_grant = true;
  entries.push(entry);
  if (entry.type !== "directory" || isMutableOutput) return;
  for (const child of fs.readdirSync(absolute).sort()) {
    appendProtectedAutomationEntry(
      entries,
      path.join(absolute, child),
      `${label}/${child}`,
      mutableOutput
    );
  }
}

function verifyPersistedDirectoryIdentity(identity, expectedPath, label, physicalStateDirectory) {
  requireValue(identity && typeof identity === "object" &&
    sameExactKeys(identity, ["lexical_path", "real_path", "device", "inode"]),
  `${label} physical identity is malformed`, 4);
  const parseIdentityMarker = (value, field) => {
    if (typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value)) {
      return BigInt(value);
    }
    if (Number.isSafeInteger(value) && value >= 0) {
      return BigInt(value);
    }
    throw new RouterError(
      `${label} physical identity requires a lossless ${field} marker`,
      4
    );
  };
  const expectedDevice = parseIdentityMarker(identity.device, "device");
  const expectedInode = parseIdentityMarker(identity.inode, "inode");
  requireExactAutomationPath(identity.lexical_path, expectedPath, label);
  const canonical = secureAutomationGraphTarget(
    identity.lexical_path,
    label,
    "directory",
    physicalStateDirectory
  );
  const stat = fs.statSync(canonical, { bigint: true });
  requireValue(
    identity.real_path === canonical &&
    expectedDevice === stat.dev &&
    expectedInode === stat.ino,
    `${label} physical identity changed after child execution`,
    4
  );
  return canonical;
}

function verifyPersistedExecutionBoundary(
  state,
  attempt,
  contract,
  physicalStateDirectory,
  index = null
) {
  const label = index === null
    ? `automation ${attempt.packet_id} attempt ${attempt.attempt}`
    : `automation attempt ${index + 1}`;
  const boundary = attempt.evidence_boundary;
  requireValue(boundary && typeof boundary === "object" &&
    sameExactKeys(boundary, ["lexical_path", "real_path", "device", "inode", "grant"]),
  `${label} child evidence boundary is malformed`, 4);
  const expectedOutputDirectory = path.join(
    contract.evidence_directory,
    attempt.packet_id,
    `attempt-${attempt.attempt}`
  );
  const evidenceDirectory = verifyPersistedDirectoryIdentity(
    boundary.grant,
    contract.evidence_directory,
    `${label} evidence grant`,
    physicalStateDirectory
  );
  const outputDirectory = verifyPersistedDirectoryIdentity(
    {
      lexical_path: boundary.lexical_path,
      real_path: boundary.real_path,
      device: boundary.device,
      inode: boundary.inode
    },
    expectedOutputDirectory,
    `${label} child output`,
    physicalStateDirectory
  );
  requireValue(inside(outputDirectory, evidenceDirectory),
    `${label} child output resolves outside its retained evidence grant`, 4);
  appendProtectedAutomationEntry([], outputDirectory, `$attempt_output:${attempt.packet_id}`);
  return createBoundEvidenceSnapshotter(boundary);
}

function verifyAutomationResultGraph(state, audit) {
  if (!audit) {
    requireValue((state.attempts || []).every((attempt) => attempt.ingest_status !== "recorded"),
      "automation has recorded results without an audit ledger", 4);
    return;
  }
  const contract = parentOwnedPathContract(state);
  const physicalStateDirectory = secureAutomationGraphTarget(
    contract.state_directory,
    "automation result-graph state directory",
    "directory"
  );

  for (const [index, attempt] of (state.attempts || []).entries()) {
    const packet = (audit.packets || []).find((candidate) =>
      candidate.packet_id === attempt.packet_id);
    requireValue(packet && packet.provider?.id === attempt.provider_id &&
      jsonValuesMatch(packet.participant, attempt.participant),
    `automation attempt ${index + 1} conflicts with its dispatched packet provenance`, 4);
  }

  const resultPacketIds = (audit.results || []).map((result) => result.packet_id);
  requireValue(new Set(resultPacketIds).size === resultPacketIds.length,
    "automation audit contains duplicate packet results", 4);
  const recordedPacketIds = new Set((state.attempts || [])
    .filter((attempt) => attempt.ingest_status === "recorded")
    .map((attempt) => attempt.packet_id));
  requireValue(recordedPacketIds.size === resultPacketIds.length &&
    resultPacketIds.every((packetId) => recordedPacketIds.has(packetId)),
  "automation audit result set conflicts with its recorded attempts", 4);

  for (const [index, result] of (audit.results || []).entries()) {
    const recordedAttempts = (state.attempts || []).filter((attempt) =>
      attempt.packet_id === result.packet_id && attempt.ingest_status === "recorded");
    requireValue(recordedAttempts.length > 0,
      `automation audit result ${result.packet_id} lacks a recorded attempt`, 4);
    const attempt = recordedAttempts.reduce((latest, candidate) =>
      !latest || candidate.attempt > latest.attempt ? candidate : latest, null);
    requireValue(
      typeof result.source?.resolved_path === "string" &&
      path.resolve(result.source.resolved_path) === path.resolve(attempt.result_path) &&
      result.source.digest === attempt.result_digest,
      `automation audit result ${result.packet_id} source conflicts with its latest recorded attempt`,
      4
    );
    requireValue(
      result.normalized?.provider_id === attempt.provider_id &&
      jsonValuesMatch(result.normalized?.participant, attempt.participant),
      `automation audit result ${result.packet_id} participant provenance conflicts with its attempt`,
      4
    );
    requireValue(result.source.kind === "file" &&
      result.source.bytes === fs.statSync(attempt.result_path).size,
    `automation audit result ${result.packet_id} source snapshot is malformed`, 4);

    if (attempt.adapter === "manual-v1") {
      requireValue(attempt.execution_status === "manual_recorded",
        `automation audit result ${result.packet_id} has invalid manual provenance`, 4);
      const manualEvidence = readExternalAutomationJson(
        state,
        attempt.result_path,
        `automation audit result ${result.packet_id} manual source`,
        { physicalStateDirectory }
      );
      requireValue(manualEvidence.digest === attempt.result_digest,
        `automation audit result ${result.packet_id} manual source changed while it was being pinned`,
        4);
      continue;
    }

    requireValue(attempt.execution_status === "ran" && attempt.evidence_boundary,
      `automation audit result ${result.packet_id} lacks retained child execution provenance`, 4);
    const snapshotEvidence = verifyPersistedExecutionBoundary(
      state,
      attempt,
      contract,
      physicalStateDirectory,
      state.attempts.indexOf(attempt)
    );
    for (const [evidenceIndex, evidence] of (result.normalized?.evidence || []).entries()) {
      let reconstructed;
      try {
        reconstructed = snapshotEvidence(evidence.resolved_path, {
          root: audit.root,
          label: evidence.path
        });
      } catch (error) {
        if (error instanceof RouterError) throw error;
        throw new RouterError(error.message, 4);
      }
      requireValue(
        reconstructed.path === evidence.path &&
        reconstructed.resolved_path === evidence.resolved_path &&
        reconstructed.bytes === evidence.bytes &&
        reconstructed.digest === evidence.digest,
        `automation audit result ${result.packet_id} evidence ${evidenceIndex + 1} conflicts with its retained child boundary`,
        4
      );
    }
  }

  for (const [index, triage] of (audit.triage || []).entries()) {
    const sourcePath = triage.source?.resolved_path;
    requireValue(typeof sourcePath === "string" &&
      DIGEST_PATTERN.test(triage.source?.digest || ""),
    `automation scanner triage ${index + 1} source snapshot is malformed`, 4);
    const triageEvidence = readExternalAutomationJson(
      state,
      sourcePath,
      `automation scanner triage ${index + 1} source`,
      { physicalStateDirectory }
    );
    requireValue(triageEvidence.digest === triage.source.digest,
      `automation scanner triage ${index + 1} source changed`, 4);
  }
}

function captureParentWriteBoundary(state, outputDirectory) {
  requireValue(pathInsideBoundary(outputDirectory, state.state_directory),
    "child output directory escapes the automation state boundary", 4);
  const entries = [];
  appendProtectedAutomationEntry(entries, state.state_path, "$state");
  appendProtectedAutomationEntry(
    entries,
    parentOwnedPathContract(state).resume_authorities_directory,
    "$resume_authorities_directory"
  );
  appendProtectedAutomationEntry(
    entries,
    state.state_directory,
    "$state_directory",
    outputDirectory
  );
  if (state.paths?.audit) {
    appendProtectedAutomationEntry(
      entries,
      state.paths.audit.path,
      "$active_audit"
    );
  }
  return {
    output_directory: path.resolve(outputDirectory),
    digest: canonicalDigest(entries)
  };
}

function verifyParentWriteBoundary(state, boundary) {
  const current = captureParentWriteBoundary(state, boundary.output_directory);
  requireValue(current.digest === boundary.digest,
    "parent-owned automation paths changed across the child process boundary; state lease remains held for explicit recovery",
    4);
}

function runPackets(state, audit, packets, hostManifest, selectors) {
  const evidenceRoot = path.join(state.state_directory, "evidence");
  const resultsRoot = path.join(state.state_directory, "results");
  ensureAutomationDirectory(evidenceRoot, "automation evidence root", {
    boundary: state.state_directory
  });
  ensureAutomationDirectory(resultsRoot, "automation results root", {
    boundary: state.state_directory
  });
  let nextAudit = audit;

  for (const packet of packets) {
    if (!shouldAttemptPacket(state, nextAudit, packet, selectors, hostManifest)) continue;
    const attempt = attemptNumber(state, packet.packet_id);
    const outputDirectory = path.join(evidenceRoot, packet.packet_id, `attempt-${attempt}`);
    const inspection = inspectPacketAdapter(packet, hostManifest);
    let executed = inspection;
    let evidenceBoundary = null;
    if (inspection.execution_status === "ready") {
      const outputBoundary = prepareExecutionOutputBoundary(outputDirectory, evidenceRoot);
      evidenceBoundary = outputBoundary;
      state.in_flight = {
        automation_in_flight_version: 1,
        packet_id: packet.packet_id,
        packet_digest: packet.packet_digest,
        provider_id: packet.provider.id,
        participant: packet.participant,
        adapter: inspection.adapter,
        host_manifest_digest: inspection.host_manifest_digest,
        permission_scopes: inspection.declaration.permissions,
        strength: inspection.declaration.strength,
        capabilities: inspection.declaration.capabilities,
        attempt,
        output_directory: outputDirectory,
        started_at: nowIso()
      };
      writeState(state);
      const parentWriteBoundary = captureParentWriteBoundary(state, outputDirectory);
      const lease = STATE_LEASES.get(state);
      requireValue(lease,
        "executable automation packets require an active state lease", 5);
      markStateLeaseChildExecution(lease, {
        packetId: packet.packet_id,
        providerId: packet.provider.id,
        attempt,
        timeoutMs: inspection.declaration.timeout_ms
      });
      executed = executeAuditPacket({
        run: nextAudit,
        packet,
        manifest: hostManifest,
        attempt,
        outputDirectory,
        outputGrantRoot: evidenceRoot,
        outputBoundary
      });
      verifyParentWriteBoundary(state, parentWriteBoundary);
    }
    const record = {
      ...executionAttemptSummary(executed),
      packet_id: packet.packet_id,
      provider_id: packet.provider.id,
      participant: packet.participant,
      attempt,
      ...(evidenceBoundary ? { evidence_boundary: evidenceBoundary } : {}),
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
        nextAudit = recordAuditResult(nextAudit, executed.result, resultPath, {
          replace,
          authorityDigest: nextAudit.audit_authority_digest,
          evidenceSnapshotter: executed.evidence_boundary
            ? createBoundEvidenceSnapshotter(executed.evidence_boundary)
            : null
        });
        record.ingest_status = "recorded";
      } catch (error) {
        record.execution_status = "blocked_execution_error";
        record.ingest_status = "rejected";
        record.error = error.message;
      }
    }
    state.in_flight = null;
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
  return packets.some((packet) => ["blocked_execution_error", "abandoned_after_crash"]
    .includes(lastAttempt(state, packet.packet_id)?.execution_status));
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
      participant: result.normalized.participant,
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

function applyScannerTriage(state, audit, triageEvidence) {
  let nextAudit = audit;
  let pending = scannerFindingRefs(nextAudit).filter((ref) => !triagedRefs(nextAudit).has(ref));
  if (pending.length && triageEvidence) {
    nextAudit = recordTriage(nextAudit, triageEvidence.input, triageEvidence.path, {
      authorityDigest: nextAudit.audit_authority_digest,
      sourceSnapshot: triageEvidence.source_snapshot
    });
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
  const preflight = finalizeAudit(audit, {
    authorityDigest: audit.audit_authority_digest
  });
  return preflight.blockers.filter((blocker) =>
    blocker.startsWith("integrity failure:") || blocker.startsWith("planning gate verification failed:"));
}

function partitionManualResults(audit, resultInputs = []) {
  const partitioned = { review: [], adjudication: [] };
  for (const evidence of resultInputs) {
    const resultPath = evidence.path;
    const input = evidence.input;
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
    target.push({
      resultPath,
      input,
      sourceSnapshot: evidence.source_snapshot,
      sourceDigest: evidence.digest
    });
  }
  return partitioned;
}

function ingestManualResults(state, audit, entries = []) {
  let nextAudit = audit;
  for (const { resultPath, input, sourceSnapshot, sourceDigest } of entries) {
    const before = new Set(nextAudit.results.map((result) => result.packet_id));
    nextAudit = recordAuditResult(nextAudit, input, resultPath, {
      authorityDigest: nextAudit.audit_authority_digest,
      sourceSnapshot
    });
    const added = nextAudit.results.find((result) => !before.has(result.packet_id));
    requireValue(added, `manual result did not add a packet: ${resultPath}`, 4);
    state.attempts.push({
      packet_id: added.packet_id,
      provider_id: added.normalized.provider_id,
      participant: added.normalized.participant,
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
      result_digest: sourceDigest,
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

function stopInitialization(state, status, blockers, pending, deferStateWrite) {
  if (!deferStateWrite) return stop(state, status, blockers, pending);
  throw new RouterError(
    `stale-lease initialization reconciliation ${status}: ${unique([
      ...(blockers || []),
      ...(pending || [])
    ]).join("; ") || "initialization did not complete"}`,
    4
  );
}

function finalizeAutomation(state, audit, approvalEvidence) {
  let approval = null;
  let absoluteApprovalPath = null;
  if (approvalEvidence) {
    absoluteApprovalPath = approvalEvidence.path;
    approval = approvalEvidence.input;
  }
  const receipt = finalizeAudit(audit, {
    approval,
    approvalPath: absoluteApprovalPath,
    approvalSourceSnapshot: approvalEvidence?.source_snapshot || null,
    authorityDigest: audit.audit_authority_digest
  });
  if (absoluteApprovalPath) {
    state.paths.approval = {
      path: approvalEvidence.source_snapshot.resolved_path,
      digest: approvalEvidence.source_snapshot.digest,
      physical_identity_digest: approvalEvidence.source_snapshot.physical_identity_digest
    };
  }
  else delete state.paths.approval;
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

function continueAutomationWithLease(state, {
  hostManifest = null,
  resultPaths = [],
  triagePath = null,
  approvalPath = null,
  preflightedExternalInputs = null,
  retry = null,
  faultInjector = null
} = {}) {
  requireValue(STATE_LEASES.has(state),
    "automation continuation requires an active state lease", 5);
  ensureInitializationAuthority(state, { faultInjector });
  const externalInputs = preflightedExternalInputs || preflightContinuationInputs(state, {
    resultPaths,
    triagePath,
    approvalPath
  });
  faultInjector?.("after-external-input-preflight", {
    state_path: state.state_path,
    result_digests: externalInputs.resultInputs.map((input) => input.digest),
    triage_digest: externalInputs.triageInput?.digest || null,
    approval_digest: externalInputs.approvalInput?.digest || null
  });
  let audit = readPinnedAutomationJson(
    state.paths.audit.path,
    "automation audit run",
    { expectedDigest: state.paths.audit.digest, faultInjector }
  ).input;
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
    manualResults = partitionManualResults(audit, externalInputs.resultInputs);
    audit = ingestManualResults(state, audit, manualResults.review);
  } catch (error) {
    recordStep(state, "result-ingest", "blocked", { error: error.message });
    return stop(state, "blocked", [error.message]);
  }
  if (state.status === "complete" && !retry && !externalInputs.triageInput &&
    !externalInputs.approvalInput && externalInputs.resultInputs.length === 0) {
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
    triage = applyScannerTriage(state, nextAudit, externalInputs.triageInput);
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
    verifyAutomationResultGraph(state, nextAudit);
    return finalizeAutomation(state, nextAudit, externalInputs.approvalInput);
  } catch (error) {
    recordStep(state, "finalize", "blocked", { error: error.message });
    return stop(state, "blocked", [error.message]);
  }
}

function initializeAutomationRouteWithLease(state, {
  router,
  profile,
  routerPath,
  profilePath = null,
  input,
  artifacts,
  scope,
  creatorActorId = null,
  observationRunPath = null,
  hostManifest = null,
  resultPaths = [],
  triagePath = null,
  approvalPath = null,
  preflightedExternalInputs = null,
  retry = null,
  faultInjector = null,
  preplannedPlan = null,
  stopAfterDispatch = false,
  deferInitializationStateWrites = false,
  adoptExistingInitialization = false,
  initializationGeneratedAt = null,
  root = process.cwd()
}) {
  const initializationReceiptOptions = {
    faultInjector,
    deferStateWrite: deferInitializationStateWrites,
    adoptExisting: adoptExistingInitialization,
    generatedAt: initializationGeneratedAt
  };
  let plan;
  const planPath = path.join(state.state_directory, "plan.json");
  if (!state.paths.plan) {
    try {
      plan = preplannedPlan ? structuredClone(preplannedPlan) : planRoute({
          router,
          profile,
          routerPath,
          profilePath,
          input,
          artifacts,
          root
        });
    } catch (error) {
      recordStep(state, "plan", "blocked", { error: error.message }, initializationReceiptOptions);
      return stopInitialization(
        state,
        "blocked",
        [error.message],
        [],
        deferInitializationStateWrites
      );
    }
    requireValue(
      automationPlanAuthorityDigest(plan) === state.request.initial_plan_authority_digest,
      "automation initial planning authority changed before its canonical route plan was committed",
      4
    );
    if (state.request.profile_digest !== plan.profile_digest) {
      const error = "profile changed while surface routing was being planned";
      recordStep(state, "plan", "blocked", { error }, initializationReceiptOptions);
      return stopInitialization(state, "blocked", [error], [], deferInitializationStateWrites);
    }
    if (state.request.router_digest !== plan.router_digest) {
      const error = "router changed while routing was being planned";
      recordStep(state, "plan", "blocked", { error }, initializationReceiptOptions);
      return stopInitialization(state, "blocked", [error], [], deferInitializationStateWrites);
    }
    if (plan.baseline_lineage) state.baseline_lineage = plan.baseline_lineage;
    if (observationRequired(input, scope)) {
      try {
        plan.baseline_observation = bindObservationRun(observationRunPath, {
          plan,
          artifacts,
          root,
          currentStatePath: state.state_path
        });
        state.baseline_observation = plan.baseline_observation;
      } catch (error) {
        recordStep(state, "plan", "blocked", { error: error.message }, initializationReceiptOptions);
        return stopInitialization(
          state,
          "blocked",
          [error.message],
          [],
          deferInitializationStateWrites
        );
      }
    }
    if (adoptExistingInitialization && fs.existsSync(planPath)) {
      let retainedPlan;
      try {
        retainedPlan = readJsonPinned(planPath, {
          label: "orphan automation route plan"
        });
      } catch (error) {
        throw new RouterError(error.message, 4);
      }
      requireValue(jsonValuesMatch(retainedPlan.input, plan),
        "orphan automation route plan conflicts with reconstructed planning authority", 4);
      plan = retainedPlan.input;
      state.paths.plan = { path: planPath, digest: retainedPlan.digest };
    } else {
      writeJsonAtomic(planPath, plan);
      faultInjector?.("after-plan-sidecar-write", {
        state_path: state.state_path,
        plan_path: planPath,
        plan_digest: hashArtifact(planPath)
      });
      state.paths.plan = snapshotPath(planPath);
    }
    recordStep(state, "plan", plan.status === "planned" ? "completed" : "blocked",
      planPayload(plan, planPath), initializationReceiptOptions);
  } else {
    plan = readPinnedAutomationJson(
      state.paths.plan.path,
      "automation canonical route plan",
      { expectedDigest: state.paths.plan.digest, faultInjector }
    ).input;
  }
  if (plan.status !== "planned") {
    return stopInitialization(
      state,
      "blocked",
      plan.unresolved,
      [],
      deferInitializationStateWrites
    );
  }

  if (!state.steps["planning-verification"] ||
    state.steps["planning-verification"].status !== "completed") {
    let planningVerification;
    try {
      planningVerification = verifyPlanningGateForAudit(plan, scope, { artifacts, root });
      const planningVerificationPayload = {
        status: planningVerification?.status || "not-configured",
        planning_receipt_path: planningVerification?.receipt_path || null,
        planning_receipt_digest: planningVerification?.receipt_digest || null,
        requirements: planningVerification?.requirements || []
      };
      if (planningVerification?.baseline_lineage) {
        planningVerificationPayload.baseline_lineage_digest =
          planningVerification.baseline_lineage.lineage_digest;
      }
      recordStep(state, "planning-verification", "completed", planningVerificationPayload,
        initializationReceiptOptions);
    } catch (error) {
      recordStep(
        state,
        "planning-verification",
        "blocked",
        { error: error.message },
        initializationReceiptOptions
      );
      return stopInitialization(
        state,
        "blocked",
        [error.message],
        [],
        deferInitializationStateWrites
      );
    }
  }

  let audit;
  if (!state.paths.audit) {
    const auditPath = path.join(state.state_directory, "audit-run.json");
    let retainedAudit = null;
    if (adoptExistingInitialization && fs.existsSync(auditPath)) {
      try {
        retainedAudit = readJsonPinned(auditPath, {
          label: "orphan automation audit run"
        });
      } catch (error) {
        throw new RouterError(error.message, 4);
      }
      requireValue(typeof retainedAudit.input.created_at === "string" &&
        !Number.isNaN(Date.parse(retainedAudit.input.created_at)),
      "orphan automation audit run has an invalid created_at", 4);
    }
    try {
      const expectedAudit = initializeAudit({
        plan,
        planPath,
        artifacts,
        scope,
        creatorActorId,
        journeyIdentity: state.journey_identity,
        root,
        runId: state.run_id,
        now: retainedAudit?.input.created_at || initializationGeneratedAt
      });
      if (retainedAudit) {
        requireValue(jsonValuesMatch(retainedAudit.input, expectedAudit),
          "orphan automation audit run conflicts with reconstructed authority", 4);
        audit = retainedAudit.input;
      } else {
        audit = expectedAudit;
      }
    } catch (error) {
      recordStep(state, "audit-init", "blocked", { error: error.message }, initializationReceiptOptions);
      return stopInitialization(
        state,
        "blocked",
        [error.message],
        [],
        deferInitializationStateWrites
      );
    }
    if (retainedAudit) {
      state.paths.audit = { path: auditPath, digest: retainedAudit.digest };
    } else {
      writeJsonAtomic(auditPath, audit);
      faultInjector?.("after-audit-sidecar-write", {
        state_path: state.state_path,
        audit_path: auditPath,
        audit_digest: hashArtifact(auditPath)
      });
      state.paths.audit = snapshotPath(auditPath);
    }
    recordStep(state, "audit-init", "completed", {
      audit_path: auditPath,
      audit_digest: state.paths.audit.digest,
      audit_manifest_digest: audit.manifest_digest,
      audit_authority_digest: audit.audit_authority_digest,
      approval_scope_digest: audit.approval_scope_digest,
      artifact_digests: Object.fromEntries(audit.artifacts.map((artifact) => [artifact.path, artifact.digest]))
    }, initializationReceiptOptions);
  } else {
    audit = readPinnedAutomationJson(
      state.paths.audit.path,
      "automation audit run",
      { expectedDigest: state.paths.audit.digest, faultInjector }
    ).input;
  }

  if (!state.paths.packets) {
    const packetDirectory = path.join(state.state_directory, "packets");
    let dispatch;
    let packetDirectoryDigest;
    let adoptedPacketDirectory = false;
    if (adoptExistingInitialization && fs.existsSync(packetDirectory)) {
      const previewRoot = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-recovery-packets-"));
      const previewDirectory = path.join(previewRoot, "packets");
      try {
        const expectedDispatch = dispatchAuditPackets(audit, previewDirectory, {
          authorityDigest: audit.audit_authority_digest
        });
        const expectedDigest = hashArtifact(expectedDispatch.directory);
        packetDirectoryDigest = hashArtifact(packetDirectory);
        requireValue(packetDirectoryDigest === expectedDigest,
          "orphan automation packet directory conflicts with reconstructed dispatch authority", 4);
        dispatch = {
          directory: path.resolve(packetDirectory),
          packets: audit.packets.map((packet) =>
            path.join(packetDirectory, `${packet.packet_id}.json`))
        };
        adoptedPacketDirectory = true;
      } finally {
        fs.rmSync(previewRoot, { recursive: true, force: true });
      }
    } else {
      dispatch = dispatchAuditPackets(audit, packetDirectory, {
        authorityDigest: audit.audit_authority_digest
      });
      packetDirectoryDigest = hashArtifact(packetDirectory);
    }
    const expectedPacketFiles = [
      ...audit.packets.map((packet) => `${packet.packet_id}.json`),
      "owner-approval.template.json"
    ].sort();
    const actualPacketFiles = fs.readdirSync(packetDirectory).sort();
    requireValue(jsonValuesMatch(actualPacketFiles, expectedPacketFiles),
      "automation packet directory contains files outside the dispatched packet contract", 4);
    if (!adoptedPacketDirectory) {
      faultInjector?.("after-packets-sidecar-write", {
        state_path: state.state_path,
        packets_directory: packetDirectory,
        packets_digest: packetDirectoryDigest
      });
    }
    state.paths.packets = {
      path: packetDirectory,
      digest: packetDirectoryDigest
    };
    recordStep(state, "dispatch", "completed", {
      packet_directory: packetDirectory,
      packet_directory_digest: state.paths.packets.digest,
      packet_count: dispatch.packets.length,
      packets: audit.packets.map((packet) => ({
        packet_id: packet.packet_id,
        provider_id: packet.provider.id,
        participant: packet.participant,
        packet_digest: packet.packet_digest
      }))
    }, initializationReceiptOptions);
  }
  if (stopAfterDispatch) return state;
  return continueAutomationWithLease(state, {
    hostManifest,
    resultPaths,
    triagePath,
    approvalPath,
    preflightedExternalInputs,
    retry,
    faultInjector
  });
}

function startAutomationWithLease({
  statePath,
  lease,
  router,
  profile,
  routerPath,
  profilePath = null,
  input,
  artifacts,
  scope,
  creatorActorId = null,
  observationRunPath = null,
  faultInjector = null,
  invocation = "explicit",
  root = process.cwd(),
  ...continuation
}) {
  const absoluteStatePath = path.resolve(statePath);
  requireValue(!fs.existsSync(absoluteStatePath),
    `automation state already exists; use --resume ${absoluteStatePath}`, 2);
  requireValue(!fs.existsSync(stateDirectory(absoluteStatePath)),
    `automation state directory already exists; recover it or choose a different --out path`, 2);
  requireValue(Array.isArray(artifacts) && artifacts.length > 0,
    "run requires at least one --artifact");
  requireValue(scope, "run requires --scope");
  if (observationRequired(input, scope)) {
    requireValue(observationRunPath,
      "runtime redesign requires --observation-run from the completed pre-change UI audit", 5);
  }
  validateStateArtifactSeparation(absoluteStatePath, artifacts, root);
  let initialPlan;
  try {
    initialPlan = planRoute({
      router,
      profile,
      routerPath,
      profilePath,
      input,
      artifacts,
      root
    });
  } catch (error) {
    if (error instanceof RouterError) throw error;
    throw new RouterError(`automation route authority cannot be established: ${error.message}`, 4);
  }
  const initialPlanAuthorityDigest = automationPlanAuthorityDigest(initialPlan);
  const state = bindStateLease(newState({
    statePath: absoluteStatePath,
    routerPath,
    profilePath,
    input,
    artifacts,
    scope,
    creatorActorId,
    observationRunPath,
    router,
    initialPlanAuthorityDigest,
    invocation,
    root
  }), lease);
  issueStartResumeAuthority(state, { faultInjector });
  ensureAutomationDirectory(state.state_directory, "automation state directory");
  writeState(state);
  faultInjector?.("after-initial-state-write", {
    state_path: state.state_path,
    state_digest: state.state_digest,
    resume_authority_digest: state.resume_authority_digest
  });
  return initializeAutomationRouteWithLease(state, {
    router,
    profile,
    routerPath,
    profilePath,
    input,
    artifacts,
    scope,
    creatorActorId,
    observationRunPath,
    faultInjector,
    preplannedPlan: initialPlan,
    root,
    ...continuation
  });
}

export function startAutomation(options) {
  const externalInputs = preflightInitialExternalInputs(options.statePath, options);
  let securedOptions = options.root
    ? { ...options, preflightedExternalInputs: externalInputs, root: secureAutomationRoot(options.root) }
    : { ...options, preflightedExternalInputs: externalInputs };
  if (options.routerPath || options.profilePath) {
    const authoritySources = verifyRoutingAuthoritySources({
      router: options.router,
      profile: options.profile || null,
      routerPath: options.routerPath || null,
      profilePath: options.profilePath || null
    });
    securedOptions = {
      ...securedOptions,
      routerPath: authoritySources.router.path || options.routerPath,
      profilePath: authoritySources.profile.path || options.profilePath || null
    };
  }
  const lease = acquireStateLease({ statePath: securedOptions.statePath, operation: "start" });
  let failure = null;
  try {
    return startAutomationWithLease({ ...securedOptions, statePath: lease.state_path, lease });
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

export function resumeAutomation(statePath, options = {}) {
  const operation = options.migrateIdentity ? "migrate-resume" : "resume";
  const lease = acquireStateLease({ statePath, operation });
  let failure = null;
  try {
    const state = options.migrateIdentity
      ? migrateAutomationStateIdentityWithLease(
        lease.state_path,
        lease,
        options.authorityDigest || null,
        options.legacyBackupPath || null,
        options.faultInjector || null
      )
      : bindStateLease(readAutomationStateCore(lease.state_path, {
        authorityDigest: options.authorityDigest || null,
        requireResumeAuthority: true,
        authorityFaultInjector: options.faultInjector || null
      }), lease);
    const {
      migrateIdentity: _migrateIdentity,
      authorityDigest: _authorityDigest,
      legacyBackupPath: _legacyBackupPath,
      ...continueOptions
    } = options;
    if (!state.paths?.plan || !state.paths?.audit || !state.paths?.packets) {
      const router = readPinnedAutomationRouterJson(
        state.request.router_path,
        "automation router source",
        { expectedDigest: state.request.router_digest, faultInjector: options.faultInjector || null }
      ).input;
      const profile = state.request.profile_path
        ? readPinnedAutomationJson(
          state.request.profile_path,
          "automation project profile",
          {
            expectedDigest: state.request.profile_digest,
            faultInjector: options.faultInjector || null
          }
        ).input
        : null;
      return initializeAutomationRouteWithLease(state, {
        router,
        profile,
        routerPath: state.request.router_path,
        profilePath: state.request.profile_path || null,
        input: state.request.input,
        artifacts: state.request.artifacts,
        scope: state.request.scope,
        creatorActorId: state.request.creator_actor_id || null,
        observationRunPath: state.request.observation_run_path || null,
        root: state.request.root,
        ...continueOptions
      });
    }
    return continueAutomationWithLease(state, continueOptions);
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

export function continueAutomation(state, options = {}) {
  requireValue(state?.state_path,
    "automation continuation requires a state with state_path", 2);
  const lease = acquireStateLease({
    statePath: state.state_path,
    operation: "continue"
  });
  let failure = null;
  try {
    const current = bindStateLease(readAutomationStateCore(state.state_path, {
      authorityDigest: options.authorityDigest || null,
      requireResumeAuthority: true,
      authorityFaultInjector: options.faultInjector || null
    }), lease);
    requireValue(current.state_digest === state.state_digest,
      "automation continuation input is stale or changed; read the current state before continuing",
      4);
    const { authorityDigest: _authorityDigest, ...continueOptions } = options;
    if (!current.paths?.plan || !current.paths?.audit || !current.paths?.packets) {
      const router = readPinnedAutomationRouterJson(
        current.request.router_path,
        "automation router source",
        { expectedDigest: current.request.router_digest, faultInjector: options.faultInjector || null }
      ).input;
      const profile = current.request.profile_path
        ? readPinnedAutomationJson(
          current.request.profile_path,
          "automation project profile",
          {
            expectedDigest: current.request.profile_digest,
            faultInjector: options.faultInjector || null
          }
        ).input
        : null;
      return initializeAutomationRouteWithLease(current, {
        router,
        profile,
        routerPath: current.request.router_path,
        profilePath: current.request.profile_path || null,
        input: current.request.input,
        artifacts: current.request.artifacts,
        scope: current.request.scope,
        creatorActorId: current.request.creator_actor_id || null,
        observationRunPath: current.request.observation_run_path || null,
        root: current.request.root,
        ...continueOptions
      });
    }
    return continueAutomationWithLease(current, continueOptions);
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

export function inspectAutomationStateLease(statePath) {
  return inspectStateLease(statePath);
}

function leaseRecoveryReceiptPath(statePath, state, recoveredLeaseDigest) {
  requireValue(DIGEST_PATTERN.test(recoveredLeaseDigest || ""),
    "lease recovery receipt requires the root recovered lease digest", 5);
  const directory = state
    ? path.join(state.state_directory, "receipts")
    : `${path.resolve(statePath)}.recoveries`;
  return path.join(
    directory,
    `state-lease-recovery-${recoveredLeaseDigest.slice("sha256:".length)}.json`
  );
}

function readPinnedRecoveryReceipt(receiptPath, label = "state lease recovery receipt") {
  try {
    return readJsonPinned(receiptPath, { label });
  } catch (error) {
    throw new RouterError(error.message, 4);
  }
}

function reconcileInitializationAfterCrash(state, { faultInjector = null } = {}) {
  const reconciliationAnchorIds = initializationAnchorDeclarations(state)
    .filter((anchor) => !anchor.bound)
    .map((anchor) => anchor.id);
  const unboundAnchors = inspectInitializationAnchors(state, { allowUnbound: true });
  const authorityBefore = inspectInitializationAuthority(state, { allowUnbound: true });
  if (unboundAnchors.length === 0 && (
    !initializationComplete(state) || authorityBefore.status === "bound"
  )) return null;
  requireValue(unboundAnchors.length === 0 ||
    state.journey_identity?.invocation !== "legacy-migrated",
    "legacy-migrated automation cannot rebuild unbound initialization anchors", 4);
  const previousStateDigest = state.state_digest;
  const previousSteps = new Set(Object.keys(state.steps || {}));
  const router = readPinnedAutomationRouterJson(
    state.request.router_path,
    "automation recovery router source",
    { expectedDigest: state.request.router_digest, faultInjector }
  ).input;
  const profile = state.request.profile_path
    ? readPinnedAutomationJson(
      state.request.profile_path,
      "automation recovery project profile",
      { expectedDigest: state.request.profile_digest, faultInjector }
    ).input
    : null;
  if (authorityBefore.retained && !initializationComplete(state)) {
    restoreInitializationFromAuthority(state, authorityBefore.retained);
  } else if (unboundAnchors.length > 0) {
    initializeAutomationRouteWithLease(state, {
      router,
      profile,
      routerPath: state.request.router_path,
      profilePath: state.request.profile_path || null,
      input: state.request.input,
      artifacts: state.request.artifacts,
      scope: state.request.scope,
      creatorActorId: state.request.creator_actor_id || null,
      observationRunPath: state.request.observation_run_path || null,
      faultInjector,
      stopAfterDispatch: true,
      deferInitializationStateWrites: true,
      adoptExistingInitialization: true,
      initializationGeneratedAt: state.created_at,
      root: state.request.root
    });
  }
  requireValue(initializationComplete(state),
    "stale-lease recovery could not seal the complete initialization graph", 4);
  inspectInitializationAnchors(state);
  const initializationAuthority = ensureInitializationAuthority(state, {
    faultInjector,
    deferStateWrite: true
  });
  const reconciledSteps = INITIALIZATION_STEP_IDS.filter((stepId) =>
    !previousSteps.has(stepId) && Object.hasOwn(state.steps || {}, stepId));
  const reconciliation = {
    initialization_reconciliation_version: 3,
    previous_state_digest: previousStateDigest,
    reconciled_anchor_ids: reconciliationAnchorIds,
    reconciled_steps: reconciledSteps,
    initialization_authority: {
      status: "bound",
      snapshot: initializationAuthority.snapshot
    },
    reconciled_initialization_graph_digest:
      initializationAuthority.snapshot.initialization_graph_digest
  };
  faultInjector?.("after-recovery-initialization-reconciliation", {
    state_path: state.state_path,
    previous_state_digest: previousStateDigest,
    reconciled_initialization_graph_digest:
      reconciliation.reconciled_initialization_graph_digest,
    reconciled_anchor_ids: reconciliationAnchorIds,
    reconciled_steps: reconciledSteps
  });
  return reconciliation;
}

export function recoverAutomationStateLease(statePath, {
  ownerToken,
  acquiredAt,
  stateDigest,
  authorityDigest = null,
  legacyBackupPath = null,
  faultInjector = null
}) {
  const requestedStatePath = path.resolve(statePath);
  const recoveryPreflight = inspectStateLease(requestedStatePath);
  requireValue(recoveryPreflight.status === "locked",
    "lease recovery requires an active automation state lease", 5);
  requireValue(recoveryPreflight.state_digest === stateDigest,
    "lease recovery state digest does not match the current state", 5);
  const stateExists = recoveryPreflight.state_digest !== ABSENT_STATE_DIGEST;
  const preflightState = stateExists
    ? readAutomationStateCore(requestedStatePath, {
      allowMissingIdentity: true,
      allowInFlight: true,
      authorityDigest,
      legacyBackupPath,
      requireResumeAuthority: true,
      allowUnboundCrashSidecars: true,
      authorityFaultInjector: faultInjector
    })
    : null;
  if (preflightState) {
    requireValue(preflightState.state_digest === stateDigest,
      "lease recovery authority was verified for a different automation state digest", 5);
  }
  const claimed = claimStaleStateLease({
    statePath,
    ownerToken,
    acquiredAt,
    stateDigest,
    faultInjector
  });
  const absolute = claimed.controller.state_path;
  const recoveryOrigin = claimed.recovery_origin;
  requireValue(recoveryOrigin && DIGEST_PATTERN.test(recoveryOrigin.lease_digest || ""),
    "lease recovery lacks its durable root lease origin", 5);
  faultInjector?.("after-recovery-claim", {
    state_path: absolute,
    previous_lease_digest: claimed.previous.lease_digest,
    recovery_origin_lease_digest: recoveryOrigin.lease_digest
  });
  let failure = null;
  let recoveryCommitted = false;
  try {
    const state = stateExists
      ? bindStateLease(readAutomationStateCore(absolute, {
        allowMissingIdentity: true,
        allowInFlight: true,
        authorityDigest,
        legacyBackupPath,
        requireResumeAuthority: true,
        allowUnboundCrashSidecars: true,
        authorityFaultInjector: faultInjector
      }), claimed.controller)
      : null;
    if (state && preflightState) {
      requireValue(state.state_digest === preflightState.state_digest,
        "automation state changed after lease recovery authority preflight", 5);
    }
    const receiptPath = leaseRecoveryReceiptPath(
      absolute,
      state,
      recoveryOrigin.lease_digest
    );
    const alreadyCommitted = state?.lease_recoveries?.find((snapshot) =>
      path.resolve(snapshot.path) === path.resolve(receiptPath));
    if (alreadyCommitted) {
      const retained = readPinnedRecoveryReceipt(
        receiptPath,
        "committed state lease recovery receipt"
      );
      requireValue(retained.digest === alreadyCommitted.digest &&
        retained.input.receipt_digest === alreadyCommitted.receipt_digest &&
        retained.input.recovered_lease?.lease_digest === recoveryOrigin.lease_digest,
      "committed state lease recovery receipt conflicts with its recovery transaction", 4);
      completeStateLeaseRecovery(claimed.controller);
      recoveryCommitted = true;
      return {
        state_lease_recovery_result_version: 1,
        status: "recovered",
        state_path: absolute,
        previous_state_digest: retained.input.recovered_lease.state_digest,
        state_digest: state.state_digest,
        abandoned_packet: retained.input.abandoned_attempt ? {
          packet_id: retained.input.abandoned_attempt.packet_id,
          provider_id: retained.input.abandoned_attempt.provider_id,
          attempt: retained.input.abandoned_attempt.attempt
        } : null,
        receipt_path: receiptPath,
        receipt_digest: retained.input.receipt_digest
      };
    }
    requireValue(recoveryOrigin.state_digest === stateDigest,
      "lease recovery origin does not bind the requested automation state digest", 5);
    const inFlight = state?.in_flight || null;
    if (inFlight && recoveryOrigin.active_packet) {
      requireValue(inFlight.packet_id === recoveryOrigin.active_packet.packet_id &&
        inFlight.provider_id === recoveryOrigin.active_packet.provider_id &&
        inFlight.attempt === recoveryOrigin.active_packet.attempt,
      "state lease and automation in-flight child bindings conflict", 4);
    }
    const initializationReconciliation = state && !inFlight
      ? reconcileInitializationAfterCrash(state, { faultInjector })
      : null;

    const recoveredAt = recoveryOrigin.recovery_started_at;
    const abandoned = inFlight ? {
      packet_id: inFlight.packet_id,
      provider_id: inFlight.provider_id,
      participant: inFlight.participant,
      adapter: inFlight.adapter,
      host_manifest_digest: inFlight.host_manifest_digest,
      permission_scopes: inFlight.permission_scopes,
      strength: inFlight.strength,
      capabilities: inFlight.capabilities,
      attempt: inFlight.attempt,
      execution_status: "abandoned_after_crash",
      started_at: inFlight.started_at,
      finished_at: recoveredAt,
      child_pid: null,
      exit_code: null,
      signal: null,
      recorded_at: recoveredAt,
      result_path: null,
      result_digest: null,
      ingest_status: "not-recorded",
      reason: "child outcome is unknown after orchestrator termination; explicit retry is required"
    } : null;
    const receipt = {
      state_lease_recovery_receipt_version: 3,
      status: "recovered",
      run_id: state?.run_id || null,
      journey_identity: state?.journey_identity || null,
      resume_authority_digest: state?.resume_authority_digest || null,
      state_path: absolute,
      recovered_at: recoveredAt,
      recovered_lease: {
        lease_digest: recoveryOrigin.lease_digest,
        owner_token_digest: recoveryOrigin.owner_token_digest,
        owner_pid: recoveryOrigin.owner_pid,
        owner_process_identity: recoveryOrigin.owner_process_identity,
        acquired_at: recoveryOrigin.acquired_at,
        operation: recoveryOrigin.operation,
        phase: recoveryOrigin.phase,
        state_digest: recoveryOrigin.state_digest,
        recover_after: recoveryOrigin.recover_after,
        active_packet: recoveryOrigin.active_packet
      },
      abandoned_attempt: abandoned,
      initialization_reconciliation: initializationReconciliation,
      receipt_digest: null
    };
    const receiptBody = { ...receipt };
    delete receiptBody.receipt_digest;
    receipt.receipt_digest = canonicalDigest(receiptBody);
    faultInjector?.("before-recovery-receipt", {
      state_path: absolute,
      receipt_path: receiptPath
    });
    let receiptFileDigest;
    if (fs.existsSync(receiptPath)) {
      const retained = readPinnedRecoveryReceipt(
        receiptPath,
        "orphan state lease recovery receipt"
      );
      requireValue(jsonValuesMatch(retained.input, receipt),
        "orphan state lease recovery receipt conflicts with reconstructed recovery authority", 4);
      receiptFileDigest = retained.digest;
    } else {
      writeJsonAtomic(receiptPath, receipt);
      receiptFileDigest = hashArtifact(receiptPath);
    }
    faultInjector?.("after-recovery-receipt", {
      state_path: absolute,
      receipt_path: receiptPath,
      receipt_digest: receipt.receipt_digest
    });

    let nextStateDigest = stateDigest;
    if (state) {
      state.lease_recoveries ||= [];
      state.lease_recoveries.push({
        path: receiptPath,
        digest: receiptFileDigest,
        receipt_digest: receipt.receipt_digest
      });
      if (abandoned) {
        state.in_flight = null;
        state.attempts.push({
          ...abandoned,
          recovery_receipt_digest: receipt.receipt_digest
        });
        state.status = "blocked";
        state.blockers = unique([
          ...(state.blockers || []),
          `${abandoned.packet_id} has an unknown crash outcome; retry requires an explicit selector`
        ]);
        state.pending = [];
      }
      faultInjector?.("before-recovery-state-write", {
        state_path: absolute,
        receipt_path: receiptPath,
        receipt_digest: receipt.receipt_digest
      });
      writeState(state);
      nextStateDigest = state.state_digest;
      faultInjector?.("after-recovery-state-write", {
        state_path: absolute,
        receipt_path: receiptPath,
        receipt_digest: receipt.receipt_digest,
        state_digest: nextStateDigest
      });
    } else {
      completeStateLeaseRecovery(claimed.controller);
    }
    recoveryCommitted = true;
    return {
      state_lease_recovery_result_version: 1,
      status: "recovered",
      state_path: absolute,
      previous_state_digest: stateDigest,
      state_digest: nextStateDigest,
      abandoned_packet: abandoned ? {
        packet_id: abandoned.packet_id,
        provider_id: abandoned.provider_id,
        attempt: abandoned.attempt
      } : null,
      receipt_path: receiptPath,
      receipt_digest: receipt.receipt_digest
    };
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    if (recoveryCommitted) {
      try {
        releaseStateLease(claimed.controller);
      } catch (releaseError) {
        if (!failure) throw releaseError;
      }
    }
  }
}

export function automationExitCode(state) {
  if (state.status === "complete" || (
    state.status === "dry_run" && !(state.pending || []).length
  )) return 0;
  if (state.status === "dry_run" && (state.pending || []).length) return 6;
  if (state.status === "manual_pending") return 6;
  return 5;
}
