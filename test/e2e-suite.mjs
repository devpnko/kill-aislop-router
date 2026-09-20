import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import nodeTest from "node:test";
import { fileURLToPath } from "node:url";
import { automationPlanAuthorityDigest, resumeAutomation } from "../src/automation.mjs";
import { loadHostManifest } from "../src/execution.mjs";
import { canonicalDigest, hashArtifact, snapshotArtifact } from "../src/integrity.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "bin", "killsloprouter.mjs");
const profile = path.join(root, "examples", "project-profile.example.json");
const adapterEntrypoint = path.join(root, "test", "fixtures", "host-adapter.mjs");
const scannerRoot = path.join(root, "test", "fixtures", "kill-ai-slop");
const scannerEntrypoint = path.join(scannerRoot, "skill", "scripts", "scan.mjs");
const recoveryCrashHolder = path.join(root, "test", "fixtures", "recovery-crash-holder.mjs");
const startCrashHolder = path.join(root, "test", "fixtures", "start-crash-holder.mjs");
const defaultRouter = path.join(root, "router", "default-router.json");
const suiteUrl = new URL(import.meta.url);
const e2eShard = Number.parseInt(suiteUrl.searchParams.get("shard") || "0", 10);
const e2eShardCount = Number.parseInt(suiteUrl.searchParams.get("shards") || "1", 10);
let e2eTestOrdinal = 0;

if (!Number.isInteger(e2eShard) || !Number.isInteger(e2eShardCount) ||
  e2eShard < 0 || e2eShardCount < 1 || e2eShard >= e2eShardCount) {
  throw new Error("invalid KillSlopRouter E2E shard selection");
}

function test(...args) {
  const assignedShard = e2eTestOrdinal % e2eShardCount;
  e2eTestOrdinal += 1;
  if (assignedShard !== e2eShard) return undefined;
  return nodeTest(...args);
}

const PROVIDERS = {
  "project-contract": {
    adapter: "agent-json-v1",
    strength: 4,
    capabilities: ["task-contract", "object-model", "state-authority"]
  },
  "visual-intent-review": {
    adapter: "agent-json-v1",
    strength: 4,
    capabilities: [
      "visual-intent-fidelity",
      "editorial-boundary",
      "character-preservation",
      "energy-preservation",
      "depth-preservation",
      "palette-fidelity",
      "typography-fidelity",
      "density-fidelity",
      "shape-fidelity",
      "elevation-fidelity",
      "imagery-fidelity",
      "motion-fidelity",
      "transformation-boundary"
    ]
  },
  "anti-slop": {
    adapter: "skill-json-v1",
    strength: 3,
    capabilities: ["task-fit", "state-completeness", "responsive-review", "accessibility-review", "interaction-review"]
  },
  "kill-ai-slop": {
    adapter: "kill-ai-slop-v1",
    strength: 2,
    capabilities: ["source-pattern-detection"]
  },
  "independent-rendered-craft-agent": {
    adapter: "agent-json-v1",
    strength: 3,
    capabilities: ["rendered-hierarchy", "visual-specificity", "visual-restraint", "component-coherence"]
  },
  "independent-copy-agent": {
    adapter: "agent-json-v1",
    strength: 3,
    capabilities: ["copy-specificity", "copy-honesty", "copy-concision"]
  },
  "locale-copy-review": {
    adapter: "agent-json-v1",
    strength: 4,
    capabilities: ["locale-domain-copy"]
  },
  "browser-evidence": {
    adapter: "browser-json-v1",
    strength: 3,
    capabilities: ["responsive-evidence", "keyboard-evidence", "state-evidence", "overflow-evidence", "contrast-evidence", "zoom-evidence"]
  },
  "domain-authority-review": {
    adapter: "agent-json-v1",
    strength: 4,
    capabilities: ["domain-authority"]
  }
};

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function makeFixture({
  artifactText = "<!doctype html><button>Save</button>\n",
  omit = [],
  settings = {},
  capabilities = {},
  timeouts = {}
} = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-e2e-"));
  const artifact = path.join(directory, "artifact.html");
  const state = path.join(directory, "automation.json");
  const host = path.join(directory, "host.json");
  fs.writeFileSync(artifact, artifactText);
  const providers = {};
  for (const [providerId, source] of Object.entries(PROVIDERS)) {
    if (omit.includes(providerId)) continue;
    const declaration = {
      ...source,
      capabilities: capabilities[providerId] || source.capabilities,
      permissions: source.adapter === "browser-json-v1"
        ? ["artifact:read", "evidence:write", "browser:control"]
        : ["artifact:read"],
      settings: settings[providerId] || {},
      ...(timeouts[providerId] ? { timeout_ms: timeouts[providerId] } : {})
    };
    if (source.adapter === "kill-ai-slop-v1") {
      declaration.adapter_root = scannerRoot;
      declaration.entrypoint_digest = hashArtifact(scannerEntrypoint);
    } else {
      declaration.entrypoint = adapterEntrypoint;
      declaration.entrypoint_digest = hashArtifact(adapterEntrypoint);
    }
    providers[providerId] = declaration;
  }
  writeJson(host, {
    host_adapter_version: 1,
    allowed_providers: Object.keys(providers),
    granted_permissions: ["artifact:read", "evidence:write", "browser:control"],
    providers
  });
  return { directory, artifact, state, host };
}

function runCli(args, cwd, { injectAuthority = true } = {}) {
  const commandArgs = [...args];
  const resumeIndex = commandArgs.indexOf("--resume");
  if (injectAuthority && resumeIndex >= 0 &&
    !commandArgs.includes("--migrate-identity") &&
    !commandArgs.includes("--authority-digest")) {
    const statePath = path.resolve(cwd, commandArgs[resumeIndex + 1]);
    if (fs.existsSync(statePath)) {
      const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
      if (state.resume_authority_digest) {
        commandArgs.push("--authority-digest", state.resume_authority_digest);
      }
    }
  }
  return spawnSync(process.execPath, [cli, ...commandArgs], {
    cwd,
    encoding: "utf8",
    timeout: 30_000
  });
}

function startArgs(fixture) {
  return [
    "run",
    "--profile", profile,
    "--surface", "operator-product-ui",
    "--task", "redesign",
    "--direction", "approved",
    "--changes", "source,copy,layout,interaction",
    "--artifact", fixture.artifact,
    "--scope", "mockup",
    "--creator-id", "creator-agent-1",
    "--host-config", fixture.host,
    "--out", fixture.state,
    "--json"
  ];
}

function writeStartCrashConfiguration(fixture, filename = "start-crash-configuration.json") {
  const configurationPath = path.join(fixture.directory, filename);
  writeJson(configurationPath, {
    statePath: fixture.state,
    routerPath: defaultRouter,
    profilePath: profile,
    input: {
      surface: "operator-product-ui",
      task: "redesign",
      direction: "approved",
      changes: ["source", "copy", "layout", "interaction"],
      risk: "standard",
      scope: "mockup"
    },
    artifacts: [fixture.artifact],
    scope: "mockup",
    creatorActorId: "creator-agent-1",
    invocation: "explicit",
    root: fixture.directory
  });
  return configurationPath;
}

function writeStandaloneAuditPlan(fixture) {
  const planPath = path.join(fixture.directory, "standalone-route-plan.json");
  const planned = runCli([
    "plan",
    "--profile", profile,
    "--surface", "operator-product-ui",
    "--task", "redesign",
    "--direction", "approved",
    "--changes", "source,copy,layout,interaction",
    "--artifact", fixture.artifact,
    "--scope", "mockup",
    "--out", planPath,
    "--json"
  ], fixture.directory);
  assert.equal(planned.status, 0, planned.stderr || planned.stdout);
  assert.equal(JSON.parse(fs.readFileSync(planPath, "utf8")).status, "planned");
  return planPath;
}

function standaloneAuditInitArgs(fixture, planPath, auditPath, packetsPath = null) {
  return [
    "audit", "init",
    "--plan", planPath,
    "--artifact", fixture.artifact,
    "--scope", "mockup",
    "--creator-id", "creator-agent-1",
    "--out", auditPath,
    ...(packetsPath ? ["--packets-dir", packetsPath] : []),
    "--json"
  ];
}

function readState(fixture) {
  return JSON.parse(fs.readFileSync(fixture.state, "utf8"));
}

function auditManifestForTest(run) {
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
  if (Object.hasOwn(run, "baseline_lineage")) {
    manifest.baseline_lineage = run.baseline_lineage;
  }
  return manifest;
}

function approvalScopeForTest(run) {
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
    artifacts: Object.fromEntries(run.artifacts.map((item) => [item.path, item.digest])),
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

function writeApproval(fixture, ownerId = "release-owner-1") {
  const state = readState(fixture);
  const audit = JSON.parse(fs.readFileSync(state.paths.audit.path, "utf8"));
  const approval = path.join(fixture.directory, "approval.json");
  const body = {
    approval_version: 1,
    run_id: audit.run_id,
    journey_identity: audit.journey_identity,
    scope_digest: audit.approval_scope_digest,
    owner_id: ownerId,
    status: "approved",
    note: "Approved the exact E2E fixture scope.",
    decided_at: new Date().toISOString()
  };
  if (audit.baseline_lineage) {
    body.baseline_lineage_digest = audit.baseline_lineage.lineage_digest;
  }
  writeJson(approval, body);
  return approval;
}

function manualResultForPacket(audit, packet, actorId = "manual-reviewer-1") {
  return {
    audit_result_version: 1,
    run_id: audit.run_id,
    packet_id: packet.packet_id,
    packet_digest: packet.packet_digest,
    journey_identity: audit.journey_identity,
    provider_id: packet.provider.id,
    participant: packet.participant,
    ...(audit.baseline_lineage
      ? { baseline_lineage_digest: audit.baseline_lineage.lineage_digest }
      : {}),
    reviewer: { actor_id: actorId, kind: "human" },
    verdict: "pass",
    capabilities_checked: packet.assigned_capabilities,
    artifact_digests: packet.artifact_digests,
    findings: [],
    evidence: [],
    resolutions: [],
    started_at: new Date().toISOString(),
    finished_at: new Date().toISOString()
  };
}

function cleanup(fixture) {
  fs.rmSync(fixture.directory, { recursive: true, force: true });
}

function writeOfficialTargetProfile(fixture) {
  const source = JSON.parse(fs.readFileSync(profile, "utf8"));
  const profileDirectory = path.dirname(profile);
  for (const contract of Object.values(source.visual_intents || {})) {
    contract.authority_receipt = path.resolve(profileDirectory, contract.authority_receipt);
  }
  for (const contract of Object.values(source.visual_signatures || {})) {
    contract.authority_receipt = path.resolve(profileDirectory, contract.authority_receipt);
  }
  for (const [surface, receipt] of Object.entries(source.planning?.surface_receipts || {})) {
    source.planning.surface_receipts[surface] = path.resolve(profileDirectory, receipt);
  }
  source.local_adapters["browser-evidence"] = {
    target: "official:playwright-browser-v1",
    status: "available",
    version: "playwright-core@1.62.1",
    executor: "browser-json-v1",
    strength: PROVIDERS["browser-evidence"].strength,
    capabilities: PROVIDERS["browser-evidence"].capabilities,
    independent_from_creator: true
  };
  const target = path.join(fixture.directory, "runtime-profile.json");
  writeJson(target, source);
  return target;
}

function writeLineageProfile(fixture, { candidateVersion = "99.0.0" } = {}) {
  const source = JSON.parse(fs.readFileSync(profile, "utf8"));
  const profileDirectory = path.dirname(profile);
  if (source.design_system?.authority_receipt) {
    source.design_system.authority_receipt = path.resolve(
      profileDirectory,
      source.design_system.authority_receipt
    );
  }
  for (const contract of Object.values(source.visual_intents || {})) {
    contract.authority_receipt = path.resolve(profileDirectory, contract.authority_receipt);
  }
  for (const contract of Object.values(source.visual_signatures || {})) {
    contract.authority_receipt = path.resolve(profileDirectory, contract.authority_receipt);
  }
  const parent = path.join(fixture.directory, "parent-v2.2.39.html");
  fs.writeFileSync(parent, "<!doctype html><main>all-menu parent baseline</main>\n");
  const planning = path.join(fixture.directory, "planning-lineage.json");
  writeJson(planning, {
    planning_gate_version: 1,
    protocol: { id: "fixture-planning", version: "1", authority: "fixture-owner" },
    project_id: source.project_id,
    surface: "operator-product-ui",
    scope_id: "policy-source-to-setting",
    phase: "phase_2",
    baseline_lineage: {
      baseline_lineage_version: 1,
      lineage_id: "store-operator/policy",
      relationship: "slice-of",
      parent_baseline: {
        id: "store-parent",
        version: "2.2.39",
        artifacts: [{ path: path.basename(parent), digest: hashArtifact(parent) }]
      },
      candidate: {
        id: "store-policy-slice",
        version: candidateVersion,
        slice_id: "policy-source-to-setting",
        artifacts: [{ path: path.basename(fixture.artifact), digest: hashArtifact(fixture.artifact) }]
      },
      inheritance: {
        inherits: ["global shell", "navigation", "visual language"],
        slice_owned: ["policy workflow", "policy states"],
        forbidden_parent_changes: ["silent global token replacement"]
      },
      promotion: { authority: "explicit-owner-only", supersedes_parent: false }
    },
    gates: {
      G6: {
        status: "passed",
        evidence: [{
          kind: "mockup",
          path: path.basename(fixture.artifact),
          digest: hashArtifact(fixture.artifact)
        }]
      }
    },
    updated_at: new Date().toISOString()
  });
  const planningReceipt = JSON.parse(fs.readFileSync(planning, "utf8"));
  const candidateScopeApproval = path.join(
    fixture.directory,
    "lineage-candidate-scope-owner-approval.json"
  );
  writeJson(candidateScopeApproval, {
    status: "approved",
    owner_id: "fixture-owner",
    lineage_id: planningReceipt.baseline_lineage.lineage_id,
    baseline_lineage_digest: canonicalDigest(planningReceipt.baseline_lineage),
    decision_scope: "candidate-slice-binding",
    parent_promotion: false,
    candidate: planningReceipt.baseline_lineage.candidate,
    decided_at: new Date().toISOString(),
    note: "Bind this candidate as a slice without changing the parent baseline."
  });
  planningReceipt.gates.G7 = {
    status: "approved",
    evidence: [{
      kind: "approved-artifact",
      path: path.basename(fixture.artifact),
      digest: hashArtifact(fixture.artifact)
    }, {
      kind: "owner-approval",
      path: path.basename(candidateScopeApproval),
      digest: hashArtifact(candidateScopeApproval)
    }]
  };
  writeJson(planning, planningReceipt);
  source.planning = { required: true, receipt: planning };
  const target = path.join(fixture.directory, "lineage-profile.json");
  writeJson(target, source);
  return { profile: target, parent, planning };
}

async function waitForPath(filePath, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(filePath)) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`timed out waiting for ${filePath}`);
}

async function waitForMatchingFiles(directory, pattern, count = 1, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const files = fs.existsSync(directory)
      ? fs.readdirSync(directory).filter((name) => pattern.test(name))
      : [];
    if (files.length >= count) return files;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`timed out waiting for ${count} matching files in ${directory}`);
}

test("integrated run executes allowlisted child adapters, resumes for owner approval, and completes", () => {
  const fixture = makeFixture();
  try {
    const first = runCli(startArgs(fixture), fixture.directory);
    assert.equal(first.status, 6, first.stderr || first.stdout);
    let state = readState(fixture);
    const journeyDigest = state.journey_identity.identity_digest;
    assert.equal(state.journey_identity.orchestrator_id, "kill-slop-router");
    assert.equal(state.journey_identity.display_name, "KillSlopRouter");
    assert.equal(state.journey_identity.canonical_entrypoint, "killsloprouter:kill-slop-router");
    assert.equal(state.journey_identity.presentation.participant_rule, "internal-role-only");
    assert.equal(state.status, "manual_pending");
    assert.equal(state.final_audit_status, "critic_pass_owner_review_pending");
    const firstLeaseStatus = runCli([
      "lease", "status", "--state", fixture.state, "--json"
    ], fixture.directory);
    assert.equal(firstLeaseStatus.status, 0, firstLeaseStatus.stderr || firstLeaseStatus.stdout);
    assert.equal(JSON.parse(firstLeaseStatus.stdout).status, "unlocked");
    assert.equal(state.steps.plan.status, "completed");
    assert.equal(state.steps.dispatch.status, "completed");
    assert.equal(state.steps.execution.status, "completed");
    assert.equal(state.steps["scanner-triage"].status, "completed");
    assert.equal(state.steps["conflict-adjudication"].status, "completed");
    const childAttempts = state.attempts.filter((attempt) => attempt.child_pid);
    assert.ok(childAttempts.length > 0);
    assert.ok(childAttempts.every((attempt) => attempt.child_pid !== process.pid));
    assert.ok(childAttempts.every((attempt) =>
      attempt.participant.visibility === "internal" &&
      attempt.metadata.observed_journey_identity_digest === journeyDigest &&
      attempt.metadata.observed_participant.provider_id === attempt.provider_id
    ));
    const visualIntentAttempt = state.attempts.find((attempt) =>
      attempt.provider_id === "visual-intent-review"
    );
    assert.equal(visualIntentAttempt.execution_status, "ran");
    assert.notEqual(visualIntentAttempt.child_pid, process.pid);
    assert.match(visualIntentAttempt.metadata.observed_visual_signature_digest, /^sha256:[a-f0-9]{64}$/);
    assert.equal(visualIntentAttempt.metadata.observed_primary_color, "#175CD3");
    const preApprovalAudit = JSON.parse(fs.readFileSync(state.paths.audit.path, "utf8"));
    const noLineagePlan = JSON.parse(fs.readFileSync(state.paths.plan.path, "utf8"));
    assert.equal(Object.hasOwn(noLineagePlan.planning_gate, "lineage_required"), false,
      "no-lineage route plans must omit lineage-only fields");
    assert.equal(Object.hasOwn(preApprovalAudit.planning_gate, "lineage_required"), false,
      "no-lineage audit runs must omit lineage-only fields");
    assert.equal(preApprovalAudit.journey_identity.identity_digest, journeyDigest);
    assert.equal(preApprovalAudit.creator.participant.role, "creator");
    assert.ok(preApprovalAudit.packets.every((packet) =>
      packet.journey_identity.identity_digest === journeyDigest &&
      packet.participant.provider_id === packet.provider.id &&
      packet.participant.visibility === "internal"
    ));
    assert.ok(preApprovalAudit.results.every((result) =>
      result.normalized.participant.provider_id === result.normalized.provider_id &&
      result.normalized.participant.visibility === "internal"
    ));
    assert.equal(
      preApprovalAudit.packets.find((packet) => packet.provider.id === "anti-slop").participant.role,
      "critic"
    );
    const signaturePacket = preApprovalAudit.packets.find((item) =>
      item.provider.id === "visual-intent-review"
    );
    assert.equal(signaturePacket.visual_signature_contract.authority_status, "verified");
    assert.deepEqual(signaturePacket.visual_signature_contract.palette.primary, [
      {value: "#175CD3", token: "--color-brand-600", usage: "primary actions and active selection"}
    ]);
    assert.equal(signaturePacket.visual_signature_contract.density.mode, "compact");
    assert.equal("path" in signaturePacket.visual_signature_contract.sources[0], false);
    const scannerResult = preApprovalAudit.results.find((item) =>
      item.normalized.stage_id === "static-discovery"
    );
    assert.equal(scannerResult.normalized.verdict, "pass");
    assert.equal(scannerResult.normalized.findings.length, 0);
    assert.equal(state.final_audit_status, "critic_pass_owner_review_pending");

    const approval = writeApproval(fixture);
    assert.equal(JSON.parse(fs.readFileSync(approval, "utf8")).journey_identity.identity_digest,
      journeyDigest);
    const approvalBefore = fs.readFileSync(approval);
    const approvalStatBefore = fs.statSync(approval, { bigint: true });
    const resumed = runCli([
      "run", "--resume", fixture.state,
      "--host-config", fixture.host,
      "--approval", approval,
      "--json"
    ], fixture.directory);
    assert.equal(resumed.status, 0, resumed.stderr || resumed.stdout);
    const approvalStatAfter = fs.statSync(approval, { bigint: true });
    assert.ok(fs.readFileSync(approval).equals(approvalBefore),
      "the Router must consume owner authority through a read-only descriptor");
    assert.equal(approvalStatAfter.dev, approvalStatBefore.dev);
    assert.equal(approvalStatAfter.ino, approvalStatBefore.ino);
    assert.equal(approvalStatAfter.mode, approvalStatBefore.mode);
    assert.equal(approvalStatAfter.mtimeNs, approvalStatBefore.mtimeNs);
    state = readState(fixture);
    assert.equal(state.status, "complete");
    assert.equal(state.journey_identity.identity_digest, journeyDigest,
      "compaction/resume must preserve the original journey identity");
    assert.equal(state.final_audit_status, "approved");
    assert.match(state.final_receipt_digest, /^sha256:[a-f0-9]{64}$/);
    assert.deepEqual(Object.keys(state.steps).sort(), [
      "audit-init",
      "conflict-adjudication",
      "dispatch",
      "execution",
      "finalize",
      "plan",
      "planning-verification",
      "result-ingest",
      "scanner-triage"
    ]);
    assert.ok(Object.values(state.steps).every((step) =>
      /^sha256:[a-f0-9]{64}$/.test(step.receipt_digest) &&
      /^sha256:[a-f0-9]{64}$/.test(step.file_digest)));
    assert.ok(Object.values(state.steps).every((step) =>
      JSON.parse(fs.readFileSync(step.receipt_path, "utf8")).journey_identity.identity_digest === journeyDigest
    ));
    assert.ok(Object.values(state.steps).every((step) =>
      !Object.hasOwn(JSON.parse(fs.readFileSync(step.receipt_path, "utf8")).payload,
        "baseline_lineage_digest")
    ), "no-lineage V1 step receipts must omit lineage-only fields");
    const finalReceipt = JSON.parse(fs.readFileSync(state.paths.final.path, "utf8"));
    assert.equal(finalReceipt.journey_identity.identity_digest, journeyDigest);
    assert.equal(finalReceipt.owner_approval.journey_identity.identity_digest, journeyDigest);
    assert.equal(Object.hasOwn(finalReceipt, "baseline_lineage"), false);
    assert.equal(finalReceipt.boundaries.includes("latest-version-never-promotes-a-parent-baseline"), false);
    const resumedLeaseStatus = runCli([
      "lease", "status", "--state", fixture.state, "--json"
    ], fixture.directory);
    assert.equal(resumedLeaseStatus.status, 0, resumedLeaseStatus.stderr || resumedLeaseStatus.stdout);
    assert.equal(JSON.parse(resumedLeaseStatus.stdout).status, "unlocked");
  } finally {
    cleanup(fixture);
  }
});

test("integrated run binds a newer slice to its parent across state, packets, children, receipts, and approval", () => {
  const fixture = makeFixture();
  try {
    const lineage = writeLineageProfile(fixture, { candidateVersion: "999.0.0" });
    const args = startArgs(fixture);
    args[args.indexOf("--profile") + 1] = lineage.profile;
    const first = runCli(args, fixture.directory);
    assert.equal(first.status, 6, first.stderr || first.stdout);
    let state = readState(fixture);
    const lineageDigest = state.baseline_lineage.lineage_digest;
    assert.equal(state.baseline_lineage.relationship, "slice-of");
    assert.equal(state.baseline_lineage.parent_baseline.version, "2.2.39");
    assert.equal(state.baseline_lineage.candidate.version, "999.0.0");
    assert.equal(state.baseline_lineage.promotion.supersedes_parent, false);
    assert.ok(Object.values(state.steps).every((step) => {
      const receipt = JSON.parse(fs.readFileSync(step.receipt_path, "utf8"));
      return receipt.payload.baseline_lineage_digest === lineageDigest;
    }));
    const jsonChildren = state.attempts.filter((attempt) =>
      ["agent-json-v1", "skill-json-v1", "browser-json-v1"].includes(attempt.adapter));
    assert.ok(jsonChildren.length > 0);
    assert.ok(jsonChildren.every((attempt) =>
      attempt.metadata?.observed_baseline_lineage_digest === lineageDigest));

    const plan = JSON.parse(fs.readFileSync(state.paths.plan.path, "utf8"));
    const audit = JSON.parse(fs.readFileSync(state.paths.audit.path, "utf8"));
    assert.equal(plan.baseline_lineage.lineage_digest, lineageDigest);
    assert.equal(audit.baseline_lineage.lineage_digest, lineageDigest);
    assert.ok(audit.packets.every((packet) =>
      packet.baseline_lineage.lineage_digest === lineageDigest));
    const approvalTemplate = JSON.parse(fs.readFileSync(
      path.join(state.paths.packets.path, "owner-approval.template.json"),
      "utf8"
    ));
    assert.equal(approvalTemplate.baseline_lineage_digest, lineageDigest);

    const approval = writeApproval(fixture);
    assert.equal(
      JSON.parse(fs.readFileSync(approval, "utf8")).baseline_lineage_digest,
      lineageDigest
    );
    const resumed = runCli([
      "run", "--resume", fixture.state,
      "--host-config", fixture.host,
      "--approval", approval,
      "--json"
    ], fixture.directory);
    assert.equal(resumed.status, 0, resumed.stderr || resumed.stdout);
    state = readState(fixture);
    assert.equal(state.status, "complete");
    assert.equal(state.baseline_lineage.lineage_digest, lineageDigest);
    const finalReceipt = JSON.parse(fs.readFileSync(state.paths.final.path, "utf8"));
    assert.equal(finalReceipt.baseline_lineage.lineage_digest, lineageDigest);
    assert.equal(finalReceipt.owner_approval.baseline_lineage_digest, lineageDigest);
    assert.equal(
      path.resolve(finalReceipt.route.plan_source.resolved_path),
      path.resolve(state.paths.plan.path)
    );
    assert.equal(
      hashArtifact(finalReceipt.route.plan_source.resolved_path),
      finalReceipt.route.plan_source.digest
    );
  } finally {
    cleanup(fixture);
  }
});

test("modern resume requires the authority digest emitted by the original start", () => {
  const fixture = makeFixture();
  try {
    const first = runCli(startArgs(fixture), fixture.directory);
    assert.equal(first.status, 6, first.stderr || first.stdout);
    const state = readState(fixture);
    assert.match(state.resume_authority_digest, /^sha256:[a-f0-9]{64}$/);
    const resumed = runCli([
      "run", "--resume", fixture.state,
      "--host-config", fixture.host,
      "--json"
    ], fixture.directory, { injectAuthority: false });
    assert.equal(resumed.status, 4, resumed.stderr || resumed.stdout);
    assert.match(resumed.stderr, /requires --authority-digest/);
  } finally {
    cleanup(fixture);
  }
});

test("external resume authority rejects a coordinated state-selected profile redirect", () => {
  const fixture = makeFixture();
  try {
    const lineage = writeLineageProfile(fixture);
    const args = startArgs(fixture);
    args[args.indexOf("--profile") + 1] = lineage.profile;
    const first = runCli(args, fixture.directory);
    assert.equal(first.status, 6, first.stderr || first.stdout);
    const state = readState(fixture);
    const originalAuthority = state.resume_authority_digest;
    const redirectedProfile = path.join(fixture.directory, "redirected-profile.json");
    fs.copyFileSync(lineage.profile, redirectedProfile);
    state.request.profile_path = redirectedProfile;
    state.request.profile_digest = hashArtifact(redirectedProfile);
    state.resume_authority_digest = canonicalDigest({ attacker_selected_authority: redirectedProfile });
    delete state.state_digest;
    state.state_digest = canonicalDigest(state);
    writeJson(fixture.state, state);

    const resumed = runCli([
      "run", "--resume", fixture.state,
      "--authority-digest", originalAuthority,
      "--host-config", fixture.host,
      "--json"
    ], fixture.directory, { injectAuthority: false });
    assert.equal(resumed.status, 4, resumed.stderr || resumed.stdout);
    assert.match(resumed.stderr, /resume authority digest does not match/);
  } finally {
    cleanup(fixture);
  }
});

test("resume rejects re-signed parent sidecar redirects before any child or ledger write", () => {
  const fixture = makeFixture();
  try {
    const first = runCli(startArgs(fixture), fixture.directory);
    assert.equal(first.status, 6, first.stderr || first.stdout);
    const originalStateSource = fs.readFileSync(fixture.state, "utf8");
    const originalState = JSON.parse(originalStateSource);
    const originalAuthority = originalState.resume_authority_digest;
    const originalAttempts = originalState.attempts.length;
    const executionReceipt = originalState.steps.execution;
    assert.ok(originalState.paths.final, "owner-pending runs must already have a final receipt");

    const attacks = [
      { id: "plan", kind: "file", source: originalState.paths.plan.path },
      { id: "audit", kind: "file", source: originalState.paths.audit.path },
      { id: "packets", kind: "directory", source: originalState.paths.packets.path },
      { id: "final", kind: "file", source: originalState.paths.final.path },
      { id: "step-execution", kind: "file", source: executionReceipt.receipt_path }
    ];

    for (const attack of attacks) {
      fs.writeFileSync(fixture.state, originalStateSource);
      const redirectedRoot = path.join(fixture.directory, `redirected-${attack.id}`);
      const redirected = path.join(
        redirectedRoot,
        attack.kind === "directory" ? "packets" : path.basename(attack.source)
      );
      fs.mkdirSync(redirectedRoot, { recursive: true });
      if (attack.kind === "directory") {
        fs.cpSync(attack.source, redirected, { recursive: true });
      } else {
        fs.copyFileSync(attack.source, redirected);
      }
      const redirectedDigest = hashArtifact(redirected);
      const forged = JSON.parse(originalStateSource);
      if (attack.id === "step-execution") {
        forged.steps.execution.receipt_path = redirected;
      } else {
        forged.paths[attack.id].path = redirected;
      }
      delete forged.state_digest;
      forged.state_digest = canonicalDigest(forged);
      writeJson(fixture.state, forged);
      const forgedStateFileDigest = hashArtifact(fixture.state);

      const resumed = runCli([
        "run", "--resume", fixture.state,
        "--authority-digest", originalAuthority,
        "--host-config", fixture.host,
        "--json"
      ], fixture.directory, { injectAuthority: false });
      assert.equal(resumed.status, 4, `${attack.id}: ${resumed.stderr || resumed.stdout}`);
      assert.match(
        resumed.stderr,
        /outside its canonical parent-owned path/,
        attack.id
      );
      assert.equal(hashArtifact(fixture.state), forgedStateFileDigest,
        `${attack.id} redirect must fail before the state ledger is rewritten`);
      assert.equal(hashArtifact(redirected), redirectedDigest,
        `${attack.id} redirect target must remain byte-identical`);
      assert.equal(JSON.parse(fs.readFileSync(fixture.state, "utf8")).attempts.length,
        originalAttempts, `${attack.id} redirect must fail before another child starts`);
    }
  } finally {
    cleanup(fixture);
  }
});

test("integrated resume rejects owner, triage, and manual-review authority from inside its state", () => {
  const cases = [{
    id: "owner approval",
    fixture: () => makeFixture(),
    prepare(fixture, state, audit) {
      const external = writeApproval(fixture);
      const internal = path.join(state.state_directory, "untrusted-owner-approval.json");
      fs.copyFileSync(external, internal);
      return ["--approval", internal];
    }
  }, {
    id: "scanner triage",
    fixture: () => makeFixture({ artifactText: "<!doctype html><!-- SCANNER_FINDING -->\n" }),
    prepare(fixture, state, audit) {
      const scanner = audit.results.find((result) =>
        result.normalized.stage_id === "static-discovery");
      const finding = scanner.normalized.findings[0];
      const internal = path.join(state.state_directory, "untrusted-scanner-triage.json");
      writeJson(internal, {
        triage_version: 1,
        decisions: [{
          finding_ref: `${scanner.packet_id}/${finding.id}`,
          disposition: "accepted-risk",
          rationale: "Fixture decision must remain outside mutable automation state.",
          decided_by: "fixture-owner",
          evidence: []
        }]
      });
      return ["--triage", internal];
    }
  }, {
    id: "manual review",
    fixture: () => makeFixture({ omit: ["anti-slop"] }),
    prepare(fixture, state, audit) {
      const packet = audit.packets.find((candidate) => candidate.provider.id === "anti-slop");
      const internal = path.join(state.state_directory, "untrusted-manual-result.json");
      writeJson(internal, manualResultForPacket(audit, packet));
      return ["--result", internal];
    }
  }];

  for (const fixtureCase of cases) {
    const fixture = fixtureCase.fixture();
    try {
      const first = runCli(startArgs(fixture), fixture.directory);
      assert.equal(first.status, 6, `${fixtureCase.id}: ${first.stderr || first.stdout}`);
      const state = readState(fixture);
      const audit = JSON.parse(fs.readFileSync(state.paths.audit.path, "utf8"));
      const option = fixtureCase.prepare(fixture, state, audit);
      const inputPath = option[1];
      const stateBefore = fs.readFileSync(fixture.state);
      const inputBefore = fs.readFileSync(inputPath);
      const attemptsBefore = state.attempts.length;

      const resumed = runCli([
        "run", "--resume", fixture.state,
        "--host-config", fixture.host,
        ...option,
        "--json"
      ], fixture.directory);
      assert.equal(resumed.status, 4,
        `${fixtureCase.id}: ${resumed.stderr || resumed.stdout}`);
      assert.match(resumed.stderr, /must remain outside the parent-owned automation state directory/);
      assert.ok(fs.readFileSync(fixture.state).equals(stateBefore),
        `${fixtureCase.id} rejection must not rewrite the state ledger`);
      assert.ok(fs.readFileSync(inputPath).equals(inputBefore),
        `${fixtureCase.id} rejection must not rewrite the supplied input`);
      assert.equal(readState(fixture).attempts.length, attemptsBefore,
        `${fixtureCase.id} rejection must happen before another child starts`);
    } finally {
      cleanup(fixture);
    }
  }
});

test("integrated resume rejects an external authority path with a symlink ancestor", {
  skip: process.platform === "win32"
}, () => {
  const fixture = makeFixture();
  try {
    const first = runCli(startArgs(fixture), fixture.directory);
    assert.equal(first.status, 6, first.stderr || first.stdout);
    const realDirectory = path.join(fixture.directory, "real-owner-authority");
    const aliasDirectory = path.join(fixture.directory, "owner-authority-alias");
    fs.mkdirSync(realDirectory);
    const realApproval = path.join(realDirectory, "approval.json");
    fs.copyFileSync(writeApproval(fixture), realApproval);
    fs.symlinkSync(realDirectory, aliasDirectory, "dir");
    const stateBefore = fs.readFileSync(fixture.state);

    const resumed = runCli([
      "run", "--resume", fixture.state,
      "--host-config", fixture.host,
      "--approval", path.join(aliasDirectory, "approval.json"),
      "--json"
    ], fixture.directory);
    assert.equal(resumed.status, 4, resumed.stderr || resumed.stdout);
    assert.match(resumed.stderr, /owner approval contains a symlink ancestor/);
    assert.ok(fs.readFileSync(fixture.state).equals(stateBefore));
  } finally {
    cleanup(fixture);
  }
});

test("integrated resume cannot reuse its parent state file as external authority", () => {
  const fixture = makeFixture();
  try {
    const first = runCli(startArgs(fixture), fixture.directory);
    assert.equal(first.status, 6, first.stderr || first.stdout);
    const stateBefore = fs.readFileSync(fixture.state);
    const resumed = runCli([
      "run", "--resume", fixture.state,
      "--host-config", fixture.host,
      "--approval", fixture.state,
      "--json"
    ], fixture.directory);
    assert.equal(resumed.status, 4, resumed.stderr || resumed.stdout);
    assert.match(resumed.stderr, /must remain outside the parent-owned automation state file/);
    assert.ok(fs.readFileSync(fixture.state).equals(stateBefore));
  } finally {
    cleanup(fixture);
  }
});

test("initial integrated run preflights external inputs before creating state or a lease", () => {
  const fixture = makeFixture();
  try {
    const started = runCli([
      ...startArgs(fixture),
      "--approval", fixture.state
    ], fixture.directory);
    assert.equal(started.status, 4, started.stderr || started.stdout);
    assert.match(started.stderr, /owner approval is missing/);
    assert.equal(fs.existsSync(fixture.state), false);
    assert.equal(fs.existsSync(`${fixture.state}.lease`), false);
    assert.equal(fs.existsSync(fixture.state.replace(/\.json$/, ".d")), false);
  } finally {
    cleanup(fixture);
  }
});

test("external integrated authority must be caller-owned and not group- or world-writable", {
  skip: typeof process.getuid !== "function"
}, () => {
  const fixture = makeFixture();
  try {
    const approval = path.join(fixture.directory, "untrusted-writable-approval.json");
    writeJson(approval, {});
    fs.chmodSync(approval, 0o666);
    const approvalBefore = fs.readFileSync(approval);
    const started = runCli([
      ...startArgs(fixture),
      "--approval", approval
    ], fixture.directory);
    assert.equal(started.status, 4, started.stderr || started.stdout);
    assert.match(started.stderr, /must not be group- or world-writable/);
    assert.ok(fs.readFileSync(approval).equals(approvalBefore));
    assert.equal(fs.existsSync(fixture.state), false);
    assert.equal(fs.existsSync(`${fixture.state}.lease`), false);
    assert.equal(fs.existsSync(fixture.state.replace(/\.json$/, ".d")), false);
  } finally {
    cleanup(fixture);
  }
});

test("integrated owner approval stays bound to the bytes pinned before path replacement", () => {
  const fixture = makeFixture();
  try {
    const first = runCli(startArgs(fixture), fixture.directory);
    assert.equal(first.status, 6, first.stderr || first.stdout);
    const before = readState(fixture);
    const approval = writeApproval(fixture);
    const retained = path.join(fixture.directory, "approval-pinned-original.json");
    const originalDigest = hashArtifact(approval);
    const replacement = JSON.parse(fs.readFileSync(approval, "utf8"));
    replacement.status = "rejected";
    replacement.note = "Replacement path content must never be rebound as the pinned owner decision.";

    const resumed = resumeAutomation(fixture.state, {
      authorityDigest: before.resume_authority_digest,
      hostManifest: loadHostManifest(fixture.host),
      approvalPath: approval,
      faultInjector(checkpoint) {
        if (checkpoint !== "after-external-input-preflight") return;
        fs.renameSync(approval, retained);
        writeJson(approval, replacement);
      }
    });
    assert.equal(resumed.status, "blocked");
    const state = readState(fixture);
    const receipt = JSON.parse(fs.readFileSync(state.paths.final.path, "utf8"));
    assert.equal(receipt.owner_approval.status, "approved",
      "normalization must use the descriptor-pinned approval bytes");
    assert.equal(receipt.owner_approval.source.digest, originalDigest,
      "source provenance must use the same descriptor-pinned bytes");
    assert.equal(receipt.status, "blocked",
      "a replaced approval path must never complete the journey");
    assert.ok(receipt.integrity.checks.some((check) =>
      check.label === "owner-approval-authority" && check.ok === false));
    assert.notEqual(hashArtifact(approval), originalDigest);
  } finally {
    cleanup(fixture);
  }
});

test("completed resume rejects a same-byte owner approval inode replacement", () => {
  const fixture = makeFixture();
  try {
    const first = runCli(startArgs(fixture), fixture.directory);
    assert.equal(first.status, 6, first.stderr || first.stdout);
    const before = readState(fixture);
    const approval = writeApproval(fixture);
    const completed = runCli([
      "run", "--resume", fixture.state,
      "--authority-digest", before.resume_authority_digest,
      "--host-config", fixture.host,
      "--approval", approval,
      "--json"
    ], fixture.directory, { injectAuthority: false });
    assert.equal(completed.status, 0, completed.stderr || completed.stdout);
    const completedState = readState(fixture);
    const attemptCount = completedState.attempts.length;

    const replacement = `${approval}.same-bytes`;
    const displaced = `${approval}.displaced`;
    fs.copyFileSync(approval, replacement);
    fs.renameSync(approval, displaced);
    fs.renameSync(replacement, approval);

    const resumed = runCli([
      "run", "--resume", fixture.state,
      "--authority-digest", completedState.resume_authority_digest,
      "--json"
    ], fixture.directory, { injectAuthority: false });
    assert.equal(resumed.status, 4, resumed.stderr || resumed.stdout);
    assert.match(resumed.stderr, /approval source physical identity changed/i);
    assert.equal(readState(fixture).attempts.length, attemptCount,
      "approval inode tamper must fail before any child replay");
  } finally {
    cleanup(fixture);
  }
});

test("integrated scanner triage stays bound to the bytes pinned before path replacement", () => {
  const fixture = makeFixture({ artifactText: "<!doctype html><!-- SCANNER_FINDING -->\n" });
  try {
    const first = runCli(startArgs(fixture), fixture.directory);
    assert.equal(first.status, 6, first.stderr || first.stdout);
    const before = readState(fixture);
    const audit = JSON.parse(fs.readFileSync(before.paths.audit.path, "utf8"));
    const scanner = audit.results.find((result) => result.normalized.stage_id === "static-discovery");
    const findingRef = `${scanner.packet_id}/${scanner.normalized.findings[0].id}`;
    const triage = path.join(fixture.directory, "scanner-triage.json");
    writeJson(triage, {
      triage_version: 1,
      decisions: [{
        finding_ref: findingRef,
        disposition: "accepted-risk",
        rationale: "Original descriptor-pinned triage decision.",
        decided_by: "fixture-owner",
        evidence: []
      }]
    });
    const retained = path.join(fixture.directory, "scanner-triage-pinned-original.json");
    const originalDigest = hashArtifact(triage);
    const replacement = {
      triage_version: 1,
      decisions: [{
        finding_ref: findingRef,
        disposition: "false-positive",
        rationale: "Replacement path content must not become the recorded source.",
        decided_by: "path-replacer",
        evidence: []
      }]
    };

    const resumed = resumeAutomation(fixture.state, {
      authorityDigest: before.resume_authority_digest,
      hostManifest: loadHostManifest(fixture.host),
      triagePath: triage,
      faultInjector(checkpoint) {
        if (checkpoint !== "after-external-input-preflight") return;
        fs.renameSync(triage, retained);
        writeJson(triage, replacement);
      }
    });
    assert.equal(resumed.status, "blocked");
    const state = readState(fixture);
    const recordedAudit = JSON.parse(fs.readFileSync(state.paths.audit.path, "utf8"));
    assert.equal(recordedAudit.triage[0].decisions[0].disposition, "accepted-risk");
    assert.equal(recordedAudit.triage[0].source.digest, originalDigest);
    assert.equal(state.paths.final, undefined,
      "triage path replacement must stop before final receipt creation");
    assert.match(state.blockers.join("\n"), /scanner triage 1 source changed/);
    assert.notEqual(hashArtifact(triage), originalDigest);
  } finally {
    cleanup(fixture);
  }
});

test("resume rejects re-signed automated result and evidence redirects outside the child boundary", () => {
  const fixture = makeFixture();
  try {
    const first = runCli(startArgs(fixture), fixture.directory);
    assert.equal(first.status, 6, first.stderr || first.stdout);
    const originalStateSource = fs.readFileSync(fixture.state, "utf8");
    const originalState = JSON.parse(originalStateSource);
    const originalAuditSource = fs.readFileSync(originalState.paths.audit.path, "utf8");
    const originalAudit = JSON.parse(originalAuditSource);
    const browserResult = originalAudit.results.find((result) =>
      result.normalized.stage_id === "browser-evidence");
    const browserAttempt = originalState.attempts.find((attempt) =>
      attempt.packet_id === browserResult.packet_id && attempt.ingest_status === "recorded");
    const originalResultSource = fs.readFileSync(browserAttempt.result_path, "utf8");
    const attemptsBefore = originalState.attempts.length;

    const redirectResult = path.join(fixture.directory, "redirected-browser-result.json");
    fs.copyFileSync(browserAttempt.result_path, redirectResult);
    const forgedResultAudit = JSON.parse(originalAuditSource);
    const forgedResult = forgedResultAudit.results.find((result) =>
      result.packet_id === browserResult.packet_id);
    forgedResult.source.resolved_path = redirectResult;
    forgedResult.source.path = redirectResult;
    writeJson(originalState.paths.audit.path, forgedResultAudit);
    const forgedResultState = JSON.parse(originalStateSource);
    forgedResultState.paths.audit.digest = hashArtifact(originalState.paths.audit.path);
    delete forgedResultState.state_digest;
    forgedResultState.state_digest = canonicalDigest(forgedResultState);
    writeJson(fixture.state, forgedResultState);
    const forgedResultStateBytes = fs.readFileSync(fixture.state);

    const resultResume = runCli([
      "run", "--resume", fixture.state,
      "--host-config", fixture.host,
      "--json"
    ], fixture.directory);
    assert.equal(resultResume.status, 4, resultResume.stderr || resultResume.stdout);
    assert.match(resultResume.stderr, /source conflicts with its latest recorded attempt/);
    assert.ok(fs.readFileSync(fixture.state).equals(forgedResultStateBytes));
    assert.equal(readState(fixture).attempts.length, attemptsBefore);

    fs.writeFileSync(fixture.state, originalStateSource);
    fs.writeFileSync(originalState.paths.audit.path, originalAuditSource);
    fs.writeFileSync(browserAttempt.result_path, originalResultSource);
    const redirectedEvidence = path.join(fixture.directory, "redirected-browser-evidence.json");
    const originalEvidence = browserResult.normalized.evidence[0];
    fs.copyFileSync(originalEvidence.resolved_path, redirectedEvidence);
    const rawResult = JSON.parse(originalResultSource);
    rawResult.evidence[0].path = redirectedEvidence;
    writeJson(browserAttempt.result_path, rawResult);
    const forgedEvidenceAudit = JSON.parse(originalAuditSource);
    const forgedEvidenceResult = forgedEvidenceAudit.results.find((result) =>
      result.packet_id === browserResult.packet_id);
    forgedEvidenceResult.source.digest = hashArtifact(browserAttempt.result_path);
    forgedEvidenceResult.source.bytes = fs.statSync(browserAttempt.result_path).size;
    forgedEvidenceResult.normalized.evidence[0] = {
      ...forgedEvidenceResult.normalized.evidence[0],
      path: redirectedEvidence,
      resolved_path: redirectedEvidence,
      bytes: fs.statSync(redirectedEvidence).size,
      digest: hashArtifact(redirectedEvidence)
    };
    forgedEvidenceResult.normalized_digest = canonicalDigest(forgedEvidenceResult.normalized);
    writeJson(originalState.paths.audit.path, forgedEvidenceAudit);
    const forgedEvidenceState = JSON.parse(originalStateSource);
    const forgedAttempt = forgedEvidenceState.attempts.find((attempt) =>
      attempt.packet_id === browserResult.packet_id && attempt.ingest_status === "recorded");
    forgedAttempt.result_digest = hashArtifact(browserAttempt.result_path);
    forgedEvidenceState.paths.audit.digest = hashArtifact(originalState.paths.audit.path);
    delete forgedEvidenceState.state_digest;
    forgedEvidenceState.state_digest = canonicalDigest(forgedEvidenceState);
    writeJson(fixture.state, forgedEvidenceState);
    const forgedEvidenceStateBytes = fs.readFileSync(fixture.state);

    const evidenceResume = runCli([
      "run", "--resume", fixture.state,
      "--host-config", fixture.host,
      "--json"
    ], fixture.directory);
    assert.equal(evidenceResume.status, 4, evidenceResume.stderr || evidenceResume.stdout);
    assert.match(evidenceResume.stderr, /escapes the granted output directory at ingest/);
    assert.ok(fs.readFileSync(fixture.state).equals(forgedEvidenceStateBytes));
    assert.equal(readState(fixture).attempts.length, attemptsBefore);
  } finally {
    cleanup(fixture);
  }
});

test("resume rejects attempt reordering before it can redefine the latest recorded result", () => {
  const fixture = makeFixture();
  try {
    const first = runCli(startArgs(fixture), fixture.directory);
    assert.equal(first.status, 6, first.stderr || first.stdout);
    const retried = runCli([
      "run", "--resume", fixture.state,
      "--host-config", fixture.host,
      "--retry", "browser-evidence",
      "--json"
    ], fixture.directory);
    assert.equal(retried.status, 6, retried.stderr || retried.stdout);
    const state = readState(fixture);
    const browserIndexes = state.attempts
      .map((attempt, index) => ({ attempt, index }))
      .filter(({ attempt }) => attempt.provider_id === "browser-evidence")
      .map(({ index }) => index);
    assert.equal(browserIndexes.length, 2);
    [state.attempts[browserIndexes[0]], state.attempts[browserIndexes[1]]] =
      [state.attempts[browserIndexes[1]], state.attempts[browserIndexes[0]]];
    delete state.state_digest;
    state.state_digest = canonicalDigest(state);
    writeJson(fixture.state, state);
    const forgedState = fs.readFileSync(fixture.state);

    const resumed = runCli([
      "run", "--resume", fixture.state,
      "--host-config", fixture.host,
      "--json"
    ], fixture.directory);
    assert.equal(resumed.status, 4, resumed.stderr || resumed.stdout);
    assert.match(resumed.stderr, /is out of sequence/);
    assert.ok(fs.readFileSync(fixture.state).equals(forgedState));
  } finally {
    cleanup(fixture);
  }
});

test("external resume authority binds creator actor against coordinated self-review downgrades", () => {
  const fixture = makeFixture();
  try {
    const first = runCli(startArgs(fixture), fixture.directory);
    assert.equal(first.status, 6, first.stderr || first.stdout);
    const state = readState(fixture);
    const originalAuthority = state.resume_authority_digest;
    const attemptsBefore = state.attempts.length;
    const audit = JSON.parse(fs.readFileSync(state.paths.audit.path, "utf8"));
    const routedReviewer = audit.results[0].normalized.reviewer.actor_id;
    assert.notEqual(routedReviewer, state.request.creator_actor_id);

    state.request.creator_actor_id = routedReviewer;
    audit.creator.actor_id = routedReviewer;
    audit.approval_scope_digest = approvalScopeForTest(audit);
    audit.manifest_digest = canonicalDigest(auditManifestForTest(audit));
    writeJson(state.paths.audit.path, audit);
    state.paths.audit.digest = hashArtifact(state.paths.audit.path);
    delete state.state_digest;
    state.state_digest = canonicalDigest(state);
    writeJson(fixture.state, state);

    const resumed = runCli([
      "run", "--resume", fixture.state,
      "--authority-digest", originalAuthority,
      "--host-config", fixture.host,
      "--json"
    ], fixture.directory, { injectAuthority: false });
    assert.equal(resumed.status, 4, resumed.stderr || resumed.stdout);
    assert.match(resumed.stderr,
      /start authority receipt conflicts|resume authority digest conflicts|creator actor conflicts/);
    assert.equal(readState(fixture).attempts.length, attemptsBefore,
      "creator actor downgrade must fail before another child starts");
  } finally {
    cleanup(fixture);
  }
});

test("re-signed owner and reviewer graph downgrade fails against the source plan", () => {
  const fixture = makeFixture();
  try {
    const lineage = writeLineageProfile(fixture);
    const args = startArgs(fixture);
    args[args.indexOf("--profile") + 1] = lineage.profile;
    const first = runCli(args, fixture.directory);
    assert.equal(first.status, 6, first.stderr || first.stdout);
    const state = readState(fixture);
    const attemptsBefore = state.attempts.length;
    const audit = JSON.parse(fs.readFileSync(state.paths.audit.path, "utf8"));
    const removedPacket = audit.packets.find((packet) => packet.required);
    audit.owner_approval_required = false;
    audit.packets = audit.packets.filter((packet) => packet.packet_id !== removedPacket.packet_id);
    audit.stages = audit.stages.filter((stage) => stage.id !== removedPacket.stage_id);
    audit.manifest_digest = canonicalDigest(auditManifestForTest(audit));
    writeJson(state.paths.audit.path, audit);
    state.paths.audit.digest = hashArtifact(state.paths.audit.path);
    delete state.state_digest;
    state.state_digest = canonicalDigest(state);
    writeJson(fixture.state, state);

    const resumed = runCli([
      "run", "--resume", fixture.state,
      "--authority-digest", state.resume_authority_digest,
      "--host-config", fixture.host,
      "--json"
    ], fixture.directory, { injectAuthority: false });
    assert.equal(resumed.status, 4, resumed.stderr || resumed.stdout);
    assert.match(resumed.stderr, /owner approval requirement|enforcement graph/);
    assert.equal(readState(fixture).attempts.length, attemptsBefore);
  } finally {
    cleanup(fixture);
  }
});

test("parent baseline tamper blocks slice resume before another child starts", () => {
  const fixture = makeFixture();
  try {
    const lineage = writeLineageProfile(fixture);
    const args = startArgs(fixture);
    args[args.indexOf("--profile") + 1] = lineage.profile;
    const first = runCli(args, fixture.directory);
    assert.equal(first.status, 6, first.stderr || first.stdout);
    const before = readState(fixture);
    const attemptsBefore = before.attempts.length;
    fs.appendFileSync(lineage.parent, "<!-- changed parent -->\n");
    const approval = writeApproval(fixture);
    const resumed = runCli([
      "run", "--resume", fixture.state,
      "--host-config", fixture.host,
      "--approval", approval,
      "--json"
    ], fixture.directory);
    assert.equal(resumed.status, 4, resumed.stderr || resumed.stdout);
    const state = readState(fixture);
    assert.equal(state.attempts.length, attemptsBefore);
    assert.match(resumed.stderr, /planning authority changed|parent_baseline artifact digest changed/);
  } finally {
    cleanup(fixture);
  }
});

test("resume rejects a re-signed baseline lineage conflict before another child starts", () => {
  const fixture = makeFixture();
  try {
    const lineage = writeLineageProfile(fixture);
    const args = startArgs(fixture);
    args[args.indexOf("--profile") + 1] = lineage.profile;
    const first = runCli(args, fixture.directory);
    assert.equal(first.status, 6, first.stderr || first.stdout);
    const state = readState(fixture);
    const attemptsBefore = state.attempts.length;
    state.baseline_lineage.candidate.version = "1000.0.0";
    const { lineage_digest: _oldLineageDigest, ...lineageBody } = state.baseline_lineage;
    state.baseline_lineage.lineage_digest = canonicalDigest(lineageBody);
    const { state_digest: _oldStateDigest, ...stateBody } = state;
    state.state_digest = canonicalDigest(stateBody);
    writeJson(fixture.state, state);
    const resumed = runCli([
      "run", "--resume", fixture.state,
      "--host-config", fixture.host,
      "--json"
    ], fixture.directory);
    assert.equal(resumed.status, 4, resumed.stderr || resumed.stdout);
    assert.match(resumed.stderr, /baseline_lineage/);
    assert.equal(JSON.parse(fs.readFileSync(fixture.state, "utf8")).attempts.length, attemptsBefore);
  } finally {
    cleanup(fixture);
  }
});

test("resume cannot strip every local lineage anchor while the planning authority still requires it", () => {
  const fixture = makeFixture();
  try {
    const lineage = writeLineageProfile(fixture);
    const args = startArgs(fixture);
    args[args.indexOf("--profile") + 1] = lineage.profile;
    const first = runCli(args, fixture.directory);
    assert.equal(first.status, 6, first.stderr || first.stdout);
    const state = readState(fixture);

    fs.rmSync(state.paths.plan.path);
    delete state.baseline_lineage;
    state.paths = {};
    state.steps = {};
    state.attempts = [];
    state.status = "running";
    state.blockers = [];
    state.pending = [];
    state.final_audit_status = null;
    state.final_receipt_digest = null;
    delete state.state_digest;
    state.state_digest = canonicalDigest(state);
    writeJson(fixture.state, state);

    const resumed = runCli([
      "run", "--resume", fixture.state,
      "--host-config", fixture.host,
      "--json"
    ], fixture.directory);
    assert.equal(resumed.status, 4, resumed.stderr || resumed.stdout);
    assert.match(resumed.stderr,
      /unbound canonical initialization anchors/);
  } finally {
    cleanup(fixture);
  }
});

test("resume rejects plan-kept audit and packet anchor rollback before child replay", () => {
  const fixture = makeFixture();
  try {
    const first = runCli(startArgs(fixture), fixture.directory);
    assert.equal(first.status, 6, first.stderr || first.stdout);
    const state = readState(fixture);
    const attemptsBefore = state.attempts.length;
    assert.ok(state.paths.plan && state.paths.audit && state.paths.packets);
    assert.ok(state.steps.plan && state.steps["audit-init"] && state.steps.dispatch);

    state.paths = { plan: state.paths.plan };
    for (const stepId of Object.keys(state.steps)) {
      if (!["plan", "planning-verification"].includes(stepId)) delete state.steps[stepId];
    }
    state.attempts = [];
    state.in_flight = null;
    state.status = "running";
    state.blockers = [];
    state.pending = [];
    state.final_audit_status = null;
    state.final_receipt_digest = null;
    delete state.state_digest;
    state.state_digest = canonicalDigest(state);
    writeJson(fixture.state, state);

    const resumed = runCli([
      "run", "--resume", fixture.state,
      "--host-config", fixture.host,
      "--json"
    ], fixture.directory);
    assert.equal(resumed.status, 4, resumed.stderr || resumed.stdout);
    assert.match(resumed.stderr, /unbound canonical initialization anchors/i);
    assert.match(resumed.stderr, /audit-sidecar/);
    assert.match(resumed.stderr, /packets-sidecar/);
    assert.equal(readState(fixture).attempts.length, 0);
    assert.ok(attemptsBefore > 0, "the rollback fixture must start from executed reviewer attempts");
  } finally {
    cleanup(fixture);
  }
});

test("resume rejects a complete initialization rollback even when every mutable anchor was deleted", () => {
  const fixture = makeFixture();
  try {
    const first = runCli(startArgs(fixture), fixture.directory);
    assert.equal(first.status, 6, first.stderr || first.stdout);
    const completedInitialization = readState(fixture);
    assert.ok(completedInitialization.attempts.length > 0,
      "the rollback fixture must start after reviewer children executed");

    fs.rmSync(completedInitialization.state_directory, { recursive: true, force: true });
    fs.mkdirSync(completedInitialization.state_directory, { recursive: true });
    completedInitialization.paths = {};
    completedInitialization.steps = {};
    completedInitialization.attempts = [];
    completedInitialization.in_flight = null;
    completedInitialization.lease_recoveries = [];
    completedInitialization.status = "running";
    completedInitialization.blockers = [];
    completedInitialization.pending = [];
    completedInitialization.baseline_observation = null;
    completedInitialization.final_audit_status = null;
    completedInitialization.final_receipt_digest = null;
    delete completedInitialization.initialization_authority_receipt;
    delete completedInitialization.state_digest;
    completedInitialization.state_digest = canonicalDigest(completedInitialization);
    writeJson(fixture.state, completedInitialization);

    const replay = runCli([
      "run", "--resume", fixture.state,
      "--host-config", fixture.host,
      "--json"
    ], fixture.directory);
    assert.equal(replay.status, 4, replay.stderr || replay.stdout);
    assert.match(replay.stderr, /initialization authority|rollback/i);
    assert.equal(readState(fixture).attempts.length, 0,
      "a rolled-back state must fail before any reviewer child is replayed");
  } finally {
    cleanup(fixture);
  }
});

test("resume requires the caller-retained initialization authority after child execution", () => {
  const fixture = makeFixture();
  try {
    const first = runCli(startArgs(fixture), fixture.directory);
    assert.equal(first.status, 6, first.stderr || first.stdout);
    const state = readState(fixture);
    const attemptsBefore = state.attempts.length;
    assert.ok(attemptsBefore > 0);
    assert.ok(state.initialization_authority_receipt?.path);
    fs.rmSync(state.initialization_authority_receipt.path);

    const resumed = runCli([
      "run", "--resume", fixture.state,
      "--host-config", fixture.host,
      "--json"
    ], fixture.directory);
    assert.equal(resumed.status, 4, resumed.stderr || resumed.stdout);
    assert.match(resumed.stderr, /initialization authority receipt is missing/i);
    assert.equal(readState(fixture).attempts.length, attemptsBefore);
  } finally {
    cleanup(fixture);
  }
});

for (const target of ["start", "initialization"]) {
  for (const action of ["delete", "replace"]) {
    test(`a child cannot ${action} the external ${target} authority`, () => {
      const fixture = makeFixture({
        settings: {
          "anti-slop": {
            parent_authority_mutation: { target, action }
          }
        }
      });
      try {
        const attempted = runCli(startArgs(fixture), fixture.directory);
        assert.equal(attempted.status, 4, attempted.stderr || attempted.stdout);
        assert.match(attempted.stderr, /parent-owned automation paths changed|path is missing/i);
        const state = readState(fixture);
        assert.equal(state.in_flight?.provider_id, "anti-slop");
        assert.equal(
          state.attempts.some((item) => item.provider_id === "anti-slop"),
          false,
          "the mutating child must not be recorded as a completed attempt"
        );
        const leaseResult = runCli([
          "lease", "status", "--state", fixture.state, "--json"
        ], fixture.directory);
        assert.equal(leaseResult.status, 0, leaseResult.stderr || leaseResult.stdout);
        const lease = JSON.parse(leaseResult.stdout);
        assert.equal(lease.status, "locked");
        assert.equal(lease.phase, "child-execution");
        assert.equal(lease.active_packet?.provider_id, "anti-slop");
      } finally {
        cleanup(fixture);
      }
    });
  }
}

for (const target of ["start", "initialization"]) {
  test(`${target} authority hash and parse stay bound to one descriptor during a path swap`, () => {
    const fixture = makeFixture();
    try {
      const first = runCli(startArgs(fixture), fixture.directory);
      assert.equal(first.status, 6, first.stderr || first.stdout);
      const state = readState(fixture);
      const authorityPath = target === "start"
        ? state.resume_authority_receipt.path
        : state.initialization_authority_receipt.path;
      const canonicalAuthorityPath = fs.realpathSync.native(authorityPath);
      const replacement = `${authorityPath}.replacement`;
      const displaced = `${authorityPath}.displaced`;
      fs.copyFileSync(authorityPath, replacement);
      let swapped = false;
      assert.throws(() => resumeAutomation(fixture.state, {
        authorityDigest: state.resume_authority_digest,
        hostManifest: loadHostManifest(fixture.host),
        faultInjector(checkpoint, detail) {
          if (swapped || checkpoint !== "after-read-before-path-revalidation") return;
          if (detail.path !== canonicalAuthorityPath) return;
          swapped = true;
          fs.renameSync(authorityPath, displaced);
          fs.renameSync(replacement, authorityPath);
        }
      }), /path identity changed while it was being read/);
      assert.equal(swapped, true);
      const leaseResult = runCli([
        "lease", "status", "--state", fixture.state, "--json"
      ], fixture.directory);
      assert.equal(leaseResult.status, 0, leaseResult.stderr || leaseResult.stdout);
      assert.equal(JSON.parse(leaseResult.stdout).status, "unlocked");
    } finally {
      cleanup(fixture);
    }
  });
}

test("step receipt hash and parse stay bound to one descriptor during resume", () => {
  const fixture = makeFixture();
  try {
    const first = runCli(startArgs(fixture), fixture.directory);
    assert.equal(first.status, 6, first.stderr || first.stdout);
    const state = readState(fixture);
    const receiptPath = state.steps.plan.receipt_path;
    const canonicalReceiptPath = fs.realpathSync.native(receiptPath);
    const replacement = `${receiptPath}.replacement`;
    const displaced = `${receiptPath}.displaced`;
    fs.copyFileSync(receiptPath, replacement);
    let swapped = false;
    assert.throws(() => resumeAutomation(fixture.state, {
      authorityDigest: state.resume_authority_digest,
      hostManifest: loadHostManifest(fixture.host),
      faultInjector(checkpoint, detail) {
        if (swapped || checkpoint !== "after-read-before-path-revalidation") return;
        if (detail.path !== canonicalReceiptPath) return;
        swapped = true;
        fs.renameSync(receiptPath, displaced);
        fs.renameSync(replacement, receiptPath);
      }
    }), /path identity changed while it was being read/);
    assert.equal(swapped, true);
    const leaseResult = runCli([
      "lease", "status", "--state", fixture.state, "--json"
    ], fixture.directory);
    assert.equal(leaseResult.status, 0, leaseResult.stderr || leaseResult.stdout);
    assert.equal(JSON.parse(leaseResult.stdout).status, "unlocked");
  } finally {
    cleanup(fixture);
  }
});

test("an unrelated prior lease recovery cannot authorize later initialization anchor rollback", () => {
  const fixture = makeFixture();
  try {
    const configurationPath = path.join(fixture.directory, "unrelated-recovery-configuration.json");
    writeJson(configurationPath, {
      statePath: fixture.state,
      routerPath: defaultRouter,
      profilePath: profile,
      input: {
        surface: "operator-product-ui",
        task: "redesign",
        direction: "approved",
        changes: ["source", "copy", "layout", "interaction"],
        risk: "standard",
        scope: "mockup"
      },
      artifacts: [fixture.artifact],
      scope: "mockup",
      creatorActorId: "creator-agent-1",
      invocation: "explicit",
      root: fixture.directory
    });
    const crashed = spawnSync(process.execPath, [
      startCrashHolder,
      configurationPath,
      "after-initial-state-write"
    ], {
      cwd: fixture.directory,
      encoding: "utf8",
      shell: false
    });
    assert.equal(crashed.status, 92, crashed.stderr || crashed.stdout);
    let state = readState(fixture);
    const leaseResult = runCli([
      "lease", "status", "--state", fixture.state, "--json"
    ], fixture.directory);
    assert.equal(leaseResult.status, 0, leaseResult.stderr || leaseResult.stdout);
    const lease = JSON.parse(leaseResult.stdout);
    const recovered = runCli([
      "lease", "recover", "--state", fixture.state,
      "--owner-token", lease.owner_token,
      "--acquired-at", lease.acquired_at,
      "--state-digest", lease.state_digest,
      "--authority-digest", state.resume_authority_digest,
      "--json"
    ], fixture.directory);
    assert.equal(recovered.status, 0, recovered.stderr || recovered.stdout);
    const recoveryReceipt = JSON.parse(fs.readFileSync(
      JSON.parse(recovered.stdout).receipt_path,
      "utf8"
    ));
    assert.equal(recoveryReceipt.initialization_reconciliation, null);

    const resumed = runCli([
      "run", "--resume", fixture.state,
      "--authority-digest", state.resume_authority_digest,
      "--host-config", fixture.host,
      "--json"
    ], fixture.directory, { injectAuthority: false });
    assert.equal(resumed.status, 6, resumed.stderr || resumed.stdout);
    state = readState(fixture);
    assert.equal(state.lease_recoveries.length, 1);

    state.paths = { plan: state.paths.plan };
    for (const stepId of Object.keys(state.steps)) {
      if (!["plan", "planning-verification"].includes(stepId)) delete state.steps[stepId];
    }
    state.attempts = [];
    state.in_flight = null;
    state.status = "running";
    state.blockers = [];
    state.pending = [];
    state.final_audit_status = null;
    state.final_receipt_digest = null;
    delete state.state_digest;
    state.state_digest = canonicalDigest(state);
    writeJson(fixture.state, state);

    const replay = runCli([
      "run", "--resume", fixture.state,
      "--authority-digest", state.resume_authority_digest,
      "--host-config", fixture.host,
      "--json"
    ], fixture.directory, { injectAuthority: false });
    assert.equal(replay.status, 4, replay.stderr || replay.stdout);
    assert.match(replay.stderr, /unbound canonical initialization anchors/i);
  } finally {
    cleanup(fixture);
  }
});

test("completed resume rejects re-signed lineage removal from final receipt and approval", () => {
  const fixture = makeFixture();
  try {
    const lineage = writeLineageProfile(fixture);
    const args = startArgs(fixture);
    args[args.indexOf("--profile") + 1] = lineage.profile;
    const first = runCli(args, fixture.directory);
    assert.equal(first.status, 6, first.stderr || first.stdout);
    const approvalPath = writeApproval(fixture);
    const completed = runCli([
      "run", "--resume", fixture.state,
      "--host-config", fixture.host,
      "--approval", approvalPath,
      "--json"
    ], fixture.directory);
    assert.equal(completed.status, 0, completed.stderr || completed.stdout);

    const state = readState(fixture);
    const approval = JSON.parse(fs.readFileSync(approvalPath, "utf8"));
    delete approval.baseline_lineage_digest;
    writeJson(approvalPath, approval);
    const approvalSnapshot = snapshotArtifact(approvalPath, { root: fixture.directory });

    const receipt = JSON.parse(fs.readFileSync(state.paths.final.path, "utf8"));
    delete receipt.baseline_lineage;
    delete receipt.owner_approval.baseline_lineage_digest;
    receipt.owner_approval.source.digest = approvalSnapshot.digest;
    receipt.owner_approval.source.bytes = approvalSnapshot.bytes;
    receipt.owner_approval.source.physical_identity_digest =
      approvalSnapshot.physical_identity_digest;
    receipt.owner_approval.normalized_digest = canonicalDigest({
      status: receipt.owner_approval.status,
      owner_id: receipt.owner_approval.owner_id,
      note: receipt.owner_approval.note,
      decided_at: receipt.owner_approval.decided_at,
      journey_identity: receipt.owner_approval.journey_identity,
      scope_digest: receipt.owner_approval.scope_digest
    });
    delete receipt.receipt_digest;
    receipt.receipt_digest = canonicalDigest(receipt);
    writeJson(state.paths.final.path, receipt);

    state.paths.final.digest = hashArtifact(state.paths.final.path);
    state.final_receipt_digest = receipt.receipt_digest;
    state.paths.approval.digest = approvalSnapshot.digest;
    state.paths.approval.physical_identity_digest =
      approvalSnapshot.physical_identity_digest;
    delete state.state_digest;
    state.state_digest = canonicalDigest(state);
    writeJson(fixture.state, state);

    const resumed = runCli(["run", "--resume", fixture.state, "--json"], fixture.directory);
    assert.equal(resumed.status, 4, resumed.stderr || resumed.stdout);
    assert.match(resumed.stderr, /final receipt baseline_lineage|owner approval.*baseline_lineage/);
  } finally {
    cleanup(fixture);
  }
});

test("missing host adapter remains manual_pending and is never reported as ran", () => {
  const fixture = makeFixture({ omit: ["anti-slop"] });
  try {
    const result = runCli(startArgs(fixture), fixture.directory);
    assert.equal(result.status, 6, result.stderr || result.stdout);
    const state = readState(fixture);
    assert.equal(state.status, "manual_pending");
    const attempt = state.attempts.find((item) => item.provider_id === "anti-slop");
    assert.equal(attempt.execution_status, "manual_pending");
    assert.match(attempt.reason, /not allowlisted/);
    assert.equal(attempt.ingest_status, "not-recorded");

    const audit = JSON.parse(fs.readFileSync(state.paths.audit.path, "utf8"));
    const packet = audit.packets.find((item) => item.provider.id === "anti-slop");
    const manualResult = path.join(fixture.directory, "manual-anti-slop-result.json");
    writeJson(manualResult, {
      audit_result_version: 1,
      run_id: audit.run_id,
      packet_id: packet.packet_id,
      packet_digest: packet.packet_digest,
      journey_identity: audit.journey_identity,
      provider_id: packet.provider.id,
      participant: packet.participant,
      ...(audit.baseline_lineage
        ? { baseline_lineage_digest: audit.baseline_lineage.lineage_digest }
        : {}),
      reviewer: { actor_id: "manual-reviewer-1", kind: "human" },
      verdict: "pass",
      capabilities_checked: packet.assigned_capabilities,
      artifact_digests: packet.artifact_digests,
      findings: [],
      evidence: [],
      resolutions: [],
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString()
    });
    const resumed = runCli([
      "run", "--resume", fixture.state,
      "--host-config", fixture.host,
      "--result", manualResult,
      "--json"
    ], fixture.directory);
    assert.equal(resumed.status, 6, resumed.stderr || resumed.stdout);
    const resumedState = readState(fixture);
    assert.equal(resumedState.final_audit_status, "critic_pass_owner_review_pending");
    assert.equal(
      resumedState.attempts.find((item) => item.provider_id === "anti-slop" && item.execution_status === "manual_recorded").ingest_status,
      "recorded"
    );
  } finally {
    cleanup(fixture);
  }
});

test("scanner zero hits cannot approve when the visual-intent reviewer is unavailable", () => {
  const fixture = makeFixture({ omit: ["visual-intent-review"] });
  try {
    const result = runCli(startArgs(fixture), fixture.directory);
    assert.equal(result.status, 6, result.stderr || result.stdout);
    const state = readState(fixture);
    assert.equal(state.status, "manual_pending");
    const visualAttempt = state.attempts.find((item) =>
      item.provider_id === "visual-intent-review"
    );
    assert.equal(visualAttempt.execution_status, "manual_pending");
    assert.match(visualAttempt.reason, /not allowlisted/);
    const scannerAttempt = state.attempts.find((item) => item.provider_id === "kill-ai-slop");
    assert.equal(scannerAttempt.execution_status, "ran");
    const audit = JSON.parse(fs.readFileSync(state.paths.audit.path, "utf8"));
    const scannerResult = audit.results.find((item) =>
      item.normalized.stage_id === "static-discovery"
    );
    assert.equal(scannerResult.normalized.verdict, "pass");
    assert.equal(scannerResult.normalized.findings.length, 0);
    assert.equal(state.final_audit_status, null);
  } finally {
    cleanup(fixture);
  }
});

test("partial host capability cannot satisfy a planned provider contract", () => {
  const fixture = makeFixture({
    capabilities: {
      "anti-slop": ["task-fit", "state-completeness", "responsive-review", "accessibility-review"]
    }
  });
  try {
    const result = runCli(startArgs(fixture), fixture.directory);
    assert.equal(result.status, 6, result.stderr || result.stdout);
    const state = readState(fixture);
    const attempt = state.attempts.find((item) => item.provider_id === "anti-slop");
    assert.equal(attempt.execution_status, "manual_pending");
    assert.match(attempt.reason, /lacks assigned capabilities: interaction-review/);
  } finally {
    cleanup(fixture);
  }
});

test("partial visual-signature capability cannot satisfy the independent reviewer contract", () => {
  const fixture = makeFixture({
    capabilities: {
      "visual-intent-review": PROVIDERS["visual-intent-review"].capabilities.filter((capability) =>
        capability !== "transformation-boundary"
      )
    }
  });
  try {
    const result = runCli(startArgs(fixture), fixture.directory);
    assert.equal(result.status, 6, result.stderr || result.stdout);
    const state = readState(fixture);
    const attempt = state.attempts.find((item) => item.provider_id === "visual-intent-review");
    assert.equal(attempt.execution_status, "manual_pending");
    assert.match(attempt.reason, /lacks assigned capabilities: transformation-boundary/);
    assert.equal(state.final_audit_status, null);
  } finally {
    cleanup(fixture);
  }
});

test("host manifest rejects arbitrary command fields before a state or child is created", () => {
  const fixture = makeFixture();
  try {
    const host = JSON.parse(fs.readFileSync(fixture.host, "utf8"));
    host.providers["anti-slop"].command = "touch must-not-run";
    writeJson(fixture.host, host);
    const result = runCli(startArgs(fixture), fixture.directory);
    assert.equal(result.status, 2, result.stderr || result.stdout);
    assert.match(result.stderr, /unsupported field: command/);
    assert.equal(fs.existsSync(fixture.state), false);
    assert.equal(fs.existsSync(path.join(fixture.directory, "must-not-run")), false);
  } finally {
    cleanup(fixture);
  }
});

test("automation state cannot mutate a directory artifact from inside its review boundary", () => {
  const fixture = makeFixture();
  try {
    const args = startArgs(fixture);
    args[args.indexOf("--artifact") + 1] = fixture.directory;
    const result = runCli(args, fixture.directory);
    assert.equal(result.status, 2, result.stderr || result.stdout);
    assert.match(result.stderr, /state must be outside directory artifacts/);
    assert.equal(fs.existsSync(fixture.state), false);
  } finally {
    cleanup(fixture);
  }
});

test("creator identity returned by a reviewer child is rejected", () => {
  const fixture = makeFixture({
    settings: { "anti-slop": { reviewer_actor_id: "__creator__" } }
  });
  try {
    const result = runCli(startArgs(fixture), fixture.directory);
    assert.equal(result.status, 5, result.stderr || result.stdout);
    const state = readState(fixture);
    assert.equal(state.status, "blocked");
    const attempt = state.attempts.find((item) => item.provider_id === "anti-slop");
    assert.equal(attempt.ingest_status, "rejected");
    assert.match(attempt.error, /reviewer cannot be the creator/);
  } finally {
    cleanup(fixture);
  }
});

test("scanner candidates stop at the explicit triage gate", () => {
  const fixture = makeFixture({ artifactText: "<!doctype html><!-- SCANNER_FINDING -->\n" });
  try {
    const result = runCli(startArgs(fixture), fixture.directory);
    assert.equal(result.status, 6, result.stderr || result.stdout);
    const state = readState(fixture);
    assert.equal(state.status, "manual_pending");
    assert.equal(state.steps["scanner-triage"].status, "manual_pending");
    assert.match(state.pending.join("\n"), /requires explicit triage/);
    assert.equal(state.steps["conflict-adjudication"], undefined);

    const audit = JSON.parse(fs.readFileSync(state.paths.audit.path, "utf8"));
    const adjudication = audit.packets.find((item) => item.stage_id === "adjudication");
    const premature = path.join(fixture.directory, "premature-adjudication.json");
    writeJson(premature, {
      audit_result_version: 1,
      run_id: audit.run_id,
      packet_id: adjudication.packet_id,
      packet_digest: adjudication.packet_digest,
      journey_identity: audit.journey_identity,
      provider_id: adjudication.provider.id,
      participant: adjudication.participant,
      ...(audit.baseline_lineage
        ? { baseline_lineage_digest: audit.baseline_lineage.lineage_digest }
        : {}),
      reviewer: { actor_id: "domain-reviewer-manual", kind: "human" },
      verdict: "pass",
      capabilities_checked: adjudication.assigned_capabilities,
      artifact_digests: adjudication.artifact_digests,
      findings: [],
      evidence: [],
      resolutions: [],
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString()
    });
    const stillPending = runCli([
      "run", "--resume", fixture.state,
      "--host-config", fixture.host,
      "--result", premature,
      "--json"
    ], fixture.directory);
    assert.equal(stillPending.status, 6, stillPending.stderr || stillPending.stdout);
    const after = JSON.parse(fs.readFileSync(readState(fixture).paths.audit.path, "utf8"));
    assert.equal(after.results.some((item) => item.packet_id === adjudication.packet_id), false);
  } finally {
    cleanup(fixture);
  }
});

test("critic conflict blocks when the adjudicator supplies no resolution", () => {
  const fixture = makeFixture({
    settings: {
      "anti-slop": { emit_conflict: true },
      "independent-rendered-craft-agent": { emit_conflict: true },
      "domain-authority-review": { resolve_conflicts: false }
    }
  });
  try {
    const result = runCli(startArgs(fixture), fixture.directory);
    assert.equal(result.status, 5, result.stderr || result.stdout);
    const state = readState(fixture);
    assert.equal(state.status, "blocked");
    assert.equal(state.steps["conflict-adjudication"].status, "blocked");
    assert.match(state.blockers.join("\n"), /conflict lacks adjudication/);
  } finally {
    cleanup(fixture);
  }
});

test("artifact tamper is detected before owner approval can finalize", () => {
  const fixture = makeFixture();
  try {
    const first = runCli(startArgs(fixture), fixture.directory);
    assert.equal(first.status, 6, first.stderr || first.stdout);
    const before = readState(fixture);
    const approval = writeApproval(fixture);
    fs.appendFileSync(fixture.artifact, "<!-- tampered -->\n");
    const resumed = runCli([
      "run", "--resume", fixture.state,
      "--host-config", fixture.host,
      "--approval", approval,
      "--json"
    ], fixture.directory);
    assert.equal(resumed.status, 5, resumed.stderr || resumed.stdout);
    const state = readState(fixture);
    assert.equal(state.status, "blocked");
    assert.match(state.blockers.join("\n"), /integrity failure: artifact/);
  } finally {
    cleanup(fixture);
  }
});

test("browser evidence tamper is detected before owner approval can finalize", () => {
  const fixture = makeFixture();
  try {
    const first = runCli(startArgs(fixture), fixture.directory);
    assert.equal(first.status, 6, first.stderr || first.stdout);
    const state = readState(fixture);
    const audit = JSON.parse(fs.readFileSync(state.paths.audit.path, "utf8"));
    const browserResult = audit.results.find((item) => item.normalized.stage_id === "browser-evidence");
    const evidencePath = browserResult.normalized.evidence[0].resolved_path;
    fs.appendFileSync(evidencePath, "tampered\n");
    const approval = writeApproval(fixture);
    const stateBefore = fs.readFileSync(fixture.state);
    const resumed = runCli([
      "run", "--resume", fixture.state,
      "--host-config", fixture.host,
      "--approval", approval,
      "--json"
    ], fixture.directory);
    assert.equal(resumed.status, 4, resumed.stderr || resumed.stdout);
    assert.match(resumed.stderr, /evidence 1 conflicts with its retained child boundary/);
    assert.ok(fs.readFileSync(fixture.state).equals(stateBefore),
      "evidence tamper must fail before the parent ledger is rewritten");
  } finally {
    cleanup(fixture);
  }
});

test("browser adapter output without required evidence is rejected", () => {
  const fixture = makeFixture({
    settings: { "browser-evidence": { browser_missing_evidence: true } }
  });
  try {
    const result = runCli(startArgs(fixture), fixture.directory);
    assert.equal(result.status, 5, result.stderr || result.stdout);
    const state = readState(fixture);
    const attempt = state.attempts.find((item) => item.provider_id === "browser-evidence");
    assert.equal(attempt.ingest_status, "rejected");
    assert.match(attempt.error, /requires evidence/);
  } finally {
    cleanup(fixture);
  }
});

test("high-risk privacy review remains a required manual gate when its adapter is absent", () => {
  const fixture = makeFixture();
  try {
    const args = [...startArgs(fixture), "--risk", "high"];
    const result = runCli(args, fixture.directory);
    assert.equal(result.status, 6, result.stderr || result.stdout);
    const state = readState(fixture);
    const attempt = state.attempts.find((item) => item.provider_id === "privacy-authority-review");
    assert.equal(attempt.execution_status, "manual_pending");
    assert.match(state.pending.join("\n"), /privacy-authority-review/);
  } finally {
    cleanup(fixture);
  }
});

test("failed child execution stays non-zero, then resumes with an explicit retry", () => {
  const fixture = makeFixture({
    settings: { "anti-slop": { fail_attempts: [1] } }
  });
  try {
    const first = runCli(startArgs(fixture), fixture.directory);
    assert.equal(first.status, 5, first.stderr || first.stdout);
    let state = readState(fixture);
    assert.equal(state.status, "blocked");
    assert.equal(state.attempts.find((item) => item.provider_id === "anti-slop").exit_code, 17);

    const retried = runCli([
      "run", "--resume", fixture.state,
      "--host-config", fixture.host,
      "--retry", "anti-slop",
      "--json"
    ], fixture.directory);
    assert.equal(retried.status, 6, retried.stderr || retried.stdout);
    state = readState(fixture);
    const attempts = state.attempts.filter((item) => item.provider_id === "anti-slop");
    assert.equal(attempts.length, 2);
    assert.equal(attempts[1].execution_status, "ran");
    assert.equal(attempts[1].ingest_status, "recorded");

    const approval = writeApproval(fixture);
    const completed = runCli([
      "run", "--resume", fixture.state,
      "--host-config", fixture.host,
      "--approval", approval,
      "--json"
    ], fixture.directory);
    assert.equal(completed.status, 0, completed.stderr || completed.stdout);
    assert.equal(readState(fixture).status, "complete");
  } finally {
    cleanup(fixture);
  }
});

test("child timeout fails closed and recovers only after an explicit retry", () => {
  const fixture = makeFixture({
    settings: { "anti-slop": { delay_ms: 500 } },
    timeouts: { "anti-slop": 100 }
  });
  try {
    const first = runCli(startArgs(fixture), fixture.directory);
    assert.equal(first.status, 5, first.stderr || first.stdout);
    let state = readState(fixture);
    const failed = state.attempts.find((item) => item.provider_id === "anti-slop");
    assert.equal(failed.execution_status, "blocked_execution_error");
    assert.match(failed.error, /ETIMEDOUT|timed out/i);

    const host = JSON.parse(fs.readFileSync(fixture.host, "utf8"));
    host.providers["anti-slop"].settings = {};
    host.providers["anti-slop"].timeout_ms = 1_000;
    writeJson(fixture.host, host);
    const resumed = runCli([
      "run", "--resume", fixture.state,
      "--host-config", fixture.host,
      "--retry", "anti-slop",
      "--json"
    ], fixture.directory);
    assert.equal(resumed.status, 6, resumed.stderr || resumed.stdout);
    state = readState(fixture);
    assert.equal(state.final_audit_status, "critic_pass_owner_review_pending");
    const attempts = state.attempts.filter((item) => item.provider_id === "anti-slop");
    assert.deepEqual(attempts.map((item) => item.execution_status), [
      "blocked_execution_error",
      "ran"
    ]);
  } finally {
    cleanup(fixture);
  }
});

test("invalid child JSON fails closed before result ingestion", () => {
  const fixture = makeFixture({ settings: { "anti-slop": { invalid_json: true } } });
  try {
    const result = runCli(startArgs(fixture), fixture.directory);
    assert.equal(result.status, 5, result.stderr || result.stdout);
    const state = readState(fixture);
    const attempt = state.attempts.find((item) => item.provider_id === "anti-slop");
    assert.equal(attempt.execution_status, "blocked_execution_error");
    assert.equal(attempt.ingest_status, "not-recorded");
    assert.match(attempt.error, /emitted invalid JSON/);
  } finally {
    cleanup(fixture);
  }
});

test("oversized child output fails closed at the process buffer boundary", () => {
  const fixture = makeFixture({
    settings: { "anti-slop": { oversized_stdout_bytes: 32 * 1024 * 1024 } }
  });
  try {
    const result = runCli(startArgs(fixture), fixture.directory);
    assert.equal(result.status, 5, result.stderr || result.stdout);
    const state = readState(fixture);
    const attempt = state.attempts.find((item) => item.provider_id === "anti-slop");
    assert.equal(attempt.execution_status, "blocked_execution_error");
    assert.equal(attempt.ingest_status, "not-recorded");
    assert.match(attempt.error, /ENOBUFS|maxBuffer/i);
  } finally {
    cleanup(fixture);
  }
});

test("returned evidence cannot escape its granted output directory", () => {
  const fixture = makeFixture({
    settings: { "browser-evidence": { evidence_escape: true } }
  });
  try {
    const result = runCli(startArgs(fixture), fixture.directory);
    assert.equal(result.status, 4, result.stderr || result.stdout);
    assert.match(result.stderr, /parent-owned automation paths changed across the child process boundary/);
    const state = readState(fixture);
    assert.equal(state.in_flight.provider_id, "browser-evidence");
    assert.equal(state.attempts.some((item) => item.provider_id === "browser-evidence"), false);
    const leaseStatus = JSON.parse(runCli([
      "lease", "status", "--state", fixture.state, "--json"
    ], fixture.directory).stdout);
    assert.equal(leaseStatus.status, "locked");
    assert.equal(leaseStatus.phase, "child-execution");
  } finally {
    cleanup(fixture);
  }
});

test("a pre-existing symlink ancestor cannot redirect the initial parent-owned state tree", () => {
  const fixture = makeFixture();
  try {
    const redirected = path.join(fixture.directory, "redirected-state-tree");
    const alias = path.join(fixture.directory, "state-alias");
    fs.mkdirSync(redirected);
    fs.symlinkSync(redirected, alias, "dir");
    fixture.state = path.join(alias, "automation.json");

    const result = runCli(startArgs(fixture), fixture.directory);
    assert.equal(result.status, 4, result.stderr || result.stdout);
    assert.match(result.stderr, /automation state path contains a symlink ancestor/);
    assert.deepEqual(fs.readdirSync(redirected), [],
      "state, sidecars, and lease must not be written through the redirected ancestor");
    assert.equal(fs.existsSync(`${fixture.state}.lease`), false);
    assert.equal(fs.existsSync(path.join(alias, "automation.d")), false);
  } finally {
    cleanup(fixture);
  }
});

test("standalone audit init preflights run and packet paths before any redirected write", {
  skip: process.platform === "win32"
}, () => {
  const fixture = makeFixture();
  try {
    const planPath = writeStandaloneAuditPlan(fixture);

    const redirectedRun = path.join(fixture.directory, "redirected-audit-run");
    const runAlias = path.join(fixture.directory, "audit-run-alias");
    fs.mkdirSync(redirectedRun);
    fs.symlinkSync(redirectedRun, runAlias, "dir");
    const safePackets = path.join(fixture.directory, "must-not-create-packets");
    const rejectedRun = runCli(standaloneAuditInitArgs(
      fixture,
      planPath,
      path.join(runAlias, "audit.json"),
      safePackets
    ), fixture.directory);
    assert.equal(rejectedRun.status, 4, rejectedRun.stderr || rejectedRun.stdout);
    assert.match(rejectedRun.stderr, /audit run output path contains a symlink ancestor/);
    assert.deepEqual(fs.readdirSync(redirectedRun), []);
    assert.equal(fs.existsSync(safePackets), false,
      "packet output must not be created after an unsafe run path is rejected");

    const redirectedPackets = path.join(fixture.directory, "redirected-audit-packet-root");
    const packetsAlias = path.join(fixture.directory, "audit-packet-root-alias");
    fs.mkdirSync(redirectedPackets);
    fs.symlinkSync(redirectedPackets, packetsAlias, "dir");
    const safeAudit = path.join(fixture.directory, "must-not-create-audit.json");
    const rejectedPackets = runCli(standaloneAuditInitArgs(
      fixture,
      planPath,
      safeAudit,
      path.join(packetsAlias, "packets")
    ), fixture.directory);
    assert.equal(rejectedPackets.status, 4, rejectedPackets.stderr || rejectedPackets.stdout);
    assert.match(rejectedPackets.stderr, /audit packet output directory contains a symlink ancestor/);
    assert.equal(fs.existsSync(safeAudit), false,
      "audit state must not be written before its packet path passes preflight");
    assert.deepEqual(fs.readdirSync(redirectedPackets), []);
  } finally {
    cleanup(fixture);
  }
});

test("standalone kill-ai-slop receipts remain ingestible and become parent-bound at audit record", () => {
  const fixture = makeFixture({ artifactText: "<!doctype html><main>SCANNER_FINDING</main>\n" });
  try {
    const planPath = writeStandaloneAuditPlan(fixture);
    const auditPath = path.join(fixture.directory, "standalone-scanner-audit.json");
    const initialized = runCli(
      standaloneAuditInitArgs(fixture, planPath, auditPath),
      fixture.directory
    );
    assert.equal(initialized.status, 0, initialized.stderr || initialized.stdout);
    const audit = JSON.parse(fs.readFileSync(auditPath, "utf8"));

    const scannerReceiptPath = path.join(fixture.directory, "standalone-scanner.json");
    const scanned = runCli([
      "scan",
      "--profile", profile,
      "--adapter", "kill-ai-slop",
      "--adapter-root", scannerRoot,
      "--target", fixture.artifact,
      "--out", scannerReceiptPath,
      "--json"
    ], fixture.directory);
    assert.equal(scanned.status, 0, scanned.stderr || scanned.stdout);
    const scannerReceipt = JSON.parse(fs.readFileSync(scannerReceiptPath, "utf8"));
    assert.equal(Object.hasOwn(scannerReceipt, "journey_identity"), false);

    const partialPath = path.join(fixture.directory, "partial-scanner-binding.json");
    writeJson(partialPath, { ...scannerReceipt, run_id: audit.run_id });
    const partial = runCli([
      "audit", "record",
      "--run", auditPath,
      "--result", partialPath,
      "--authority-digest", audit.audit_authority_digest,
      "--json"
    ], fixture.directory);
    assert.equal(partial.status, 4, partial.stderr || partial.stdout);
    assert.match(partial.stderr, /journey_identity|packet_digest/);
    assert.equal(JSON.parse(fs.readFileSync(auditPath, "utf8")).results.length, 0);

    const recorded = runCli([
      "audit", "record",
      "--run", auditPath,
      "--result", scannerReceiptPath,
      "--authority-digest", audit.audit_authority_digest,
      "--json"
    ], fixture.directory);
    assert.equal(recorded.status, 0, recorded.stderr || recorded.stdout);
    const updated = JSON.parse(fs.readFileSync(auditPath, "utf8"));
    const result = updated.results.find((entry) =>
      entry.normalized.provider_id === "kill-ai-slop");
    assert.ok(result);
    assert.equal(result.normalized.journey_identity.identity_digest,
      updated.journey_identity.identity_digest);
    assert.equal(result.normalized.participant.orchestrator_id, "kill-slop-router");
    assert.equal(result.normalized.receipt_binding,
      "standalone-compatibility-bound-at-ingest");
  } finally {
    cleanup(fixture);
  }
});

test("explicit dry-run and digest output paths reject symlink ancestors", {
  skip: process.platform === "win32"
}, () => {
  const fixture = makeFixture();
  try {
    const redirectedDryRun = path.join(fixture.directory, "redirected-dry-run-output");
    const dryRunAlias = path.join(fixture.directory, "dry-run-output-alias");
    fs.mkdirSync(redirectedDryRun);
    fs.symlinkSync(redirectedDryRun, dryRunAlias, "dir");
    fixture.state = path.join(dryRunAlias, "dry-run.json");

    const dryRun = runCli([
      ...startArgs(fixture),
      "--dry-run"
    ], fixture.directory);
    assert.equal(dryRun.status, 4, dryRun.stderr || dryRun.stdout);
    assert.match(dryRun.stderr, /CLI JSON output path contains a symlink ancestor/);
    assert.deepEqual(fs.readdirSync(redirectedDryRun), [],
      "dry-run must not write its report through a redirected output ancestor");

    const redirectedDigest = path.join(fixture.directory, "redirected-digest-output");
    const digestAlias = path.join(fixture.directory, "digest-output-alias");
    fs.mkdirSync(redirectedDigest);
    fs.symlinkSync(redirectedDigest, digestAlias, "dir");
    const digest = runCli([
      "digest",
      "--target", fixture.artifact,
      "--out", path.join(digestAlias, "digest.json"),
      "--json"
    ], fixture.directory);
    assert.equal(digest.status, 4, digest.stderr || digest.stdout);
    assert.match(digest.stderr, /CLI JSON output path contains a symlink ancestor/);
    assert.deepEqual(fs.readdirSync(redirectedDigest), [],
      "digest must not write its receipt through a redirected output ancestor");
  } finally {
    cleanup(fixture);
  }
});

test("standalone audit dispatch and ledger mutations reject symlinked ancestors", {
  skip: process.platform === "win32"
}, () => {
  const fixture = makeFixture();
  try {
    const planPath = writeStandaloneAuditPlan(fixture);
    const auditDirectory = path.join(fixture.directory, "audit-authority");
    const auditPath = path.join(auditDirectory, "audit.json");
    const initialized = runCli(
      standaloneAuditInitArgs(fixture, planPath, auditPath),
      fixture.directory
    );
    assert.equal(initialized.status, 0, initialized.stderr || initialized.stdout);
    const audit = JSON.parse(fs.readFileSync(auditPath, "utf8"));
    const originalDigest = hashArtifact(auditPath);

    const redirectedPackets = path.join(fixture.directory, "redirected-standalone-dispatch");
    const packetsAlias = path.join(fixture.directory, "standalone-dispatch-alias");
    fs.mkdirSync(redirectedPackets);
    fs.symlinkSync(redirectedPackets, packetsAlias, "dir");
    const dispatched = runCli([
      "audit", "dispatch",
      "--run", auditPath,
      "--out-dir", path.join(packetsAlias, "packets"),
      "--authority-digest", audit.audit_authority_digest,
      "--json"
    ], fixture.directory);
    assert.equal(dispatched.status, 4, dispatched.stderr || dispatched.stdout);
    assert.match(dispatched.stderr, /audit packet output directory contains a symlink ancestor/);
    assert.deepEqual(fs.readdirSync(redirectedPackets), []);

    const runAlias = path.join(fixture.directory, "standalone-audit-run-alias");
    fs.symlinkSync(auditDirectory, runAlias, "dir");
    const placeholder = path.join(fixture.directory, "standalone-input.json");
    writeJson(placeholder, {});
    const unauthorisedTriage = runCli([
      "audit", "triage",
      "--run", auditPath,
      "--triage", placeholder,
      "--json"
    ], fixture.directory);
    assert.equal(unauthorisedTriage.status, 4,
      unauthorisedTriage.stderr || unauthorisedTriage.stdout);
    assert.match(
      unauthorisedTriage.stderr,
      /audit triage recording requires the caller-retained audit authority digest/
    );
    assert.equal(hashArtifact(auditPath), originalDigest,
      "triage without the original audit authority must not mutate the ledger");
    for (const [command, option] of [["record", "--result"], ["triage", "--triage"]]) {
      const rejected = runCli([
        "audit", command,
        "--run", path.join(runAlias, "audit.json"),
        option, placeholder,
        "--authority-digest", audit.audit_authority_digest,
        "--json"
      ], fixture.directory);
      assert.equal(rejected.status, 4, rejected.stderr || rejected.stdout);
      assert.match(rejected.stderr, /audit run path contains a symlink ancestor/);
      assert.equal(hashArtifact(auditPath), originalDigest,
        `${command} must not mutate the audit ledger through a symlink ancestor`);
    }

    const redirectedReceipt = path.join(fixture.directory, "redirected-audit-receipt");
    const receiptAlias = path.join(fixture.directory, "audit-receipt-alias");
    fs.mkdirSync(redirectedReceipt);
    fs.symlinkSync(redirectedReceipt, receiptAlias, "dir");
    const finalized = runCli([
      "audit", "finalize",
      "--run", auditPath,
      "--authority-digest", audit.audit_authority_digest,
      "--out", path.join(receiptAlias, "receipt.json"),
      "--json"
    ], fixture.directory);
    assert.equal(finalized.status, 4, finalized.stderr || finalized.stdout);
    assert.match(finalized.stderr, /CLI JSON output path contains a symlink ancestor/);
    assert.deepEqual(fs.readdirSync(redirectedReceipt), []);
    assert.equal(hashArtifact(auditPath), originalDigest);
  } finally {
    cleanup(fixture);
  }
});

for (const authorityKind of ["router", "profile"]) {
  test(`a ${authorityKind} symlink ancestor fails before the initial state lease is written`, () => {
    const fixture = makeFixture();
    try {
      const realAuthority = path.join(fixture.directory, `${authorityKind}-authority-real`);
      const aliasAuthority = path.join(fixture.directory, `${authorityKind}-authority-alias`);
      fs.mkdirSync(realAuthority);
      const source = authorityKind === "router"
        ? path.join(root, "router", "default-router.json")
        : profile;
      const authorityPath = path.join(realAuthority, path.basename(source));
      fs.copyFileSync(source, authorityPath);
      fs.symlinkSync(realAuthority, aliasAuthority, "dir");
      const args = startArgs(fixture);
      if (authorityKind === "router") {
        args.push("--router", path.join(aliasAuthority, path.basename(source)));
      } else {
        args[args.indexOf("--profile") + 1] = path.join(aliasAuthority, path.basename(source));
      }

      const result = runCli(args, fixture.directory);
      assert.equal(result.status, 4, result.stderr || result.stdout);
      assert.match(result.stderr, new RegExp(`${authorityKind} source contains a symlink ancestor`));
      assert.equal(fs.existsSync(fixture.state), false,
        "authority rejection must happen before the automation state is created");
      assert.equal(fs.existsSync(`${fixture.state}.lease`), false,
        "authority rejection must happen before the state lease is created");
      assert.equal(fs.existsSync(fixture.state.replace(/\.json$/, ".d")), false,
        "authority rejection must happen before sidecar creation");
    } finally {
      cleanup(fixture);
    }
  });
}

test("a pre-existing symlink ancestor cannot redirect the automation evidence root", () => {
  const fixture = makeFixture({ omit: ["browser-evidence"] });
  try {
    const first = runCli(startArgs(fixture), fixture.directory);
    assert.equal(first.status, 6, first.stderr || first.stdout);
    const stateDirectory = readState(fixture).state_directory;
    const evidenceRoot = path.join(stateDirectory, "evidence");
    const outside = path.join(fixture.directory, "outside-evidence");
    fs.rmSync(evidenceRoot, { recursive: true, force: true });
    fs.mkdirSync(outside);
    fs.symlinkSync(outside, evidenceRoot, "dir");
    const host = JSON.parse(fs.readFileSync(fixture.host, "utf8"));
    const source = PROVIDERS["browser-evidence"];
    host.allowed_providers.push("browser-evidence");
    host.providers["browser-evidence"] = {
      ...source,
      permissions: ["artifact:read", "evidence:write", "browser:control"],
      settings: {},
      entrypoint: adapterEntrypoint,
      entrypoint_digest: hashArtifact(adapterEntrypoint)
    };
    writeJson(fixture.host, host);
    const result = runCli([
      "run", "--resume", fixture.state,
      "--host-config", fixture.host,
      "--json"
    ], fixture.directory);
    assert.equal(result.status, 4, result.stderr || result.stdout);
    assert.match(result.stderr,
      /granted output directory must be a real directory|evidence grant contains a symlink ancestor/);
    const state = readState(fixture);
    const browserAttempt = state.attempts
      .filter((item) => item.provider_id === "browser-evidence")
      .at(-1);
    assert.equal(browserAttempt.execution_status, "manual_pending",
      "preflight rejection must not create a false ran/blocked child attempt");
    const leaseStatus = JSON.parse(runCli([
      "lease", "status", "--state", fixture.state, "--json"
    ], fixture.directory).stdout);
    assert.equal(leaseStatus.status, "unlocked");
    assert.deepEqual(fs.readdirSync(outside), [],
      "the child must not write through the pre-existing evidence symlink");
  } finally {
    cleanup(fixture);
  }
});

for (const [name, setting, pattern] of [
  ["outside-root symlink", "evidence_symlink_escape", /symlink component|physical output directory/],
  ["outside-root hardlink", "evidence_hardlink_escape", /hard-linked file/],
  ["replaced output root", "evidence_root_replacement", /output directory changed/],
  ["special file", "evidence_special_file", /regular file or directory/]
]) {
  test(`returned evidence rejects a child-generated ${name}`, {
    skip: setting === "evidence_special_file" && process.platform === "win32"
  }, () => {
    const fixture = makeFixture({
      settings: { "browser-evidence": { [setting]: true } }
    });
    try {
      const result = runCli(startArgs(fixture), fixture.directory);
      const boundaryEscape = setting !== "evidence_special_file";
      assert.equal(result.status, boundaryEscape ? 4 : 5, result.stderr || result.stdout);
      const state = readState(fixture);
      if (boundaryEscape) {
        assert.equal(state.in_flight.provider_id, "browser-evidence");
        assert.equal(state.attempts.some((item) => item.provider_id === "browser-evidence"), false);
        assert.match(result.stderr,
          /parent-owned automation paths changed|parent-owned automation file must not be hard-linked/);
        const leaseStatus = JSON.parse(runCli([
          "lease", "status", "--state", fixture.state, "--json"
        ], fixture.directory).stdout);
        assert.equal(leaseStatus.status, "locked");
        assert.equal(leaseStatus.phase, "child-execution");
      } else {
        const attempt = state.attempts.find((item) => item.provider_id === "browser-evidence");
        assert.equal(attempt.execution_status, "blocked_execution_error");
        assert.equal(attempt.ingest_status, "not-recorded");
        assert.match(attempt.error, pattern);
      }
    } finally {
      cleanup(fixture);
    }
  });
}

for (const sidecar of ["results", "receipts"]) {
  test(`a child cannot redirect the parent-owned ${sidecar} sidecar before ingestion`, () => {
    const fixture = makeFixture({
      settings: { "project-contract": { parent_sidecar_symlink: sidecar } }
    });
    try {
      const result = runCli(startArgs(fixture), fixture.directory);
      assert.equal(result.status, 4, result.stderr || result.stdout);
      assert.match(result.stderr, /parent-owned automation path contains a symlink at the child boundary/);
      const state = readState(fixture);
      assert.equal(state.in_flight.provider_id, "project-contract");
      assert.equal(state.attempts.some((item) => item.provider_id === "project-contract"), false,
        "a sidecar mutation must stop before result ingestion records a child attempt");
      const leaseStatusResult = runCli([
        "lease", "status", "--state", fixture.state, "--json"
      ], fixture.directory);
      assert.equal(leaseStatusResult.status, 0, leaseStatusResult.stderr || leaseStatusResult.stdout);
      const leaseStatus = JSON.parse(leaseStatusResult.stdout);
      assert.equal(leaseStatus.status, "locked");
      assert.equal(leaseStatus.phase, "child-execution");
      const redirected = fs.readdirSync(fixture.directory)
        .filter((name) => name.startsWith(`${sidecar}-child-redirect-`));
      assert.equal(redirected.length, 1);
      assert.deepEqual(fs.readdirSync(path.join(fixture.directory, redirected[0])), [],
        "the parent must not write through the child-created sidecar symlink");
    } finally {
      cleanup(fixture);
    }
  });
}

test("a terminated orchestrator requires explicit lease recovery and retry for an in-flight child", {
  skip: process.platform === "win32"
}, async () => {
  const fixture = makeFixture({
    settings: { "anti-slop": { delay_ms: 10_000, write_started_marker: true } },
    timeouts: { "anti-slop": 500 }
  });
  let running = null;
  try {
    running = spawn(process.execPath, [cli, ...startArgs(fixture)], {
      cwd: fixture.directory,
      detached: true,
      stdio: "ignore"
    });
    const exited = once(running, "exit");
    const marker = path.join(
      fixture.directory,
      "automation.d",
      "evidence",
      "functional-human-review--anti-slop--1",
      "attempt-1",
      "started.marker"
    );
    await waitForPath(marker);
    process.kill(-running.pid, "SIGTERM");
    const [, signal] = await exited;
    assert.equal(signal, "SIGTERM");
    running = null;

    let state = readState(fixture);
    assert.equal(state.status, "running");
    assert.equal(state.attempts.some((item) => item.provider_id === "anti-slop"), false);
    assert.ok(state.attempts.some((item) => item.provider_id === "visual-intent-review"));
    assert.equal(state.in_flight.provider_id, "anti-slop");
    assert.equal(state.in_flight.attempt, 1);

    const leaseStatusResult = runCli([
      "lease", "status", "--state", fixture.state, "--json"
    ], fixture.directory);
    assert.equal(leaseStatusResult.status, 0, leaseStatusResult.stderr || leaseStatusResult.stdout);
    const leaseStatus = JSON.parse(leaseStatusResult.stdout);
    assert.equal(leaseStatus.status, "locked");
    assert.equal(leaseStatus.owner_process_alive, false);
    assert.equal(leaseStatus.phase, "child-execution");

    const refusedResume = runCli([
      "run", "--resume", fixture.state,
      "--host-config", fixture.host,
      "--json"
    ], fixture.directory);
    assert.equal(refusedResume.status, 5, refusedResume.stderr || refusedResume.stdout);
    assert.match(refusedResume.stderr, /active automation state lease/i);

    const recoveryDelay = Math.max(0, Date.parse(leaseStatus.recover_after) - Date.now()) + 50;
    await new Promise((resolve) => setTimeout(resolve, recoveryDelay));
    const stateBeforeUnauthorizedRecovery = fs.readFileSync(fixture.state);
    const unauthorizedRecovery = runCli([
      "lease", "recover", "--state", fixture.state,
      "--owner-token", leaseStatus.owner_token,
      "--acquired-at", leaseStatus.acquired_at,
      "--state-digest", leaseStatus.state_digest,
      "--json"
    ], fixture.directory);
    assert.equal(unauthorizedRecovery.status, 4,
      unauthorizedRecovery.stderr || unauthorizedRecovery.stdout);
    assert.match(unauthorizedRecovery.stderr,
      /resume requires --authority-digest from the original KillSlopRouter start receipt/);
    assert.ok(fs.readFileSync(fixture.state).equals(stateBeforeUnauthorizedRecovery),
      "unauthorized recovery must not rewrite the modern state ledger");
    const leaseAfterUnauthorizedRecovery = runCli([
      "lease", "status", "--state", fixture.state, "--json"
    ], fixture.directory);
    assert.equal(leaseAfterUnauthorizedRecovery.status, 0,
      leaseAfterUnauthorizedRecovery.stderr || leaseAfterUnauthorizedRecovery.stdout);
    assert.equal(JSON.parse(leaseAfterUnauthorizedRecovery.stdout).status, "locked",
      "unauthorized recovery must not claim or release the stale lease");

    const stateBeforeRecoveryCrash = fs.readFileSync(fixture.state);
    const recoveryCrash = spawnSync(process.execPath, [
      recoveryCrashHolder,
      fixture.state,
      leaseStatus.owner_token,
      leaseStatus.acquired_at,
      leaseStatus.state_digest,
      state.resume_authority_digest,
      "before-recovery-state-write"
    ], {
      cwd: fixture.directory,
      encoding: "utf8",
      shell: false
    });
    assert.equal(recoveryCrash.status, 91, recoveryCrash.stderr || recoveryCrash.stdout);
    assert.ok(fs.readFileSync(fixture.state).equals(stateBeforeRecoveryCrash),
      "a crash after receipt creation but before state commit must leave unresolved state byte-identical");
    const recoveryLeaseResult = runCli([
      "lease", "status", "--state", fixture.state, "--json"
    ], fixture.directory);
    assert.equal(recoveryLeaseResult.status, 0,
      recoveryLeaseResult.stderr || recoveryLeaseResult.stdout);
    const recoveryLease = JSON.parse(recoveryLeaseResult.stdout);
    assert.equal(recoveryLease.status, "locked");
    assert.equal(recoveryLease.operation, "recover");
    assert.equal(recoveryLease.phase, "recovery",
      "failed recovery must remain exclusively leased and recoverable");
    assert.equal(recoveryLease.owner_process_alive, false);

    const recovery = runCli([
      "lease", "recover", "--state", fixture.state,
      "--owner-token", recoveryLease.owner_token,
      "--acquired-at", recoveryLease.acquired_at,
      "--state-digest", recoveryLease.state_digest,
      "--authority-digest", state.resume_authority_digest,
      "--json"
    ], fixture.directory);
    assert.equal(recovery.status, 0, recovery.stderr || recovery.stdout);
    const recoveryResult = JSON.parse(recovery.stdout);
    assert.equal(recoveryResult.status, "recovered");
    assert.equal(recoveryResult.abandoned_packet.provider_id, "anti-slop");

    state = readState(fixture);
    assert.equal(state.in_flight, null);
    assert.equal(state.lease_recoveries.length, 1);
    const recoveryReceipt = JSON.parse(fs.readFileSync(state.lease_recoveries[0].path, "utf8"));
    assert.equal(recoveryReceipt.resume_authority_digest, state.resume_authority_digest);
    assert.equal(
      state.attempts.find((item) => item.provider_id === "anti-slop").execution_status,
      "abandoned_after_crash"
    );

    const recoveryReceiptPath = state.lease_recoveries[0].path;
    const recoveryReceiptSource = fs.readFileSync(recoveryReceiptPath, "utf8");
    fs.appendFileSync(recoveryReceiptPath, " ");
    const tamperedRecovery = runCli([
      "run", "--resume", fixture.state,
      "--host-config", fixture.host,
      "--json"
    ], fixture.directory);
    assert.equal(tamperedRecovery.status, 4, tamperedRecovery.stderr || tamperedRecovery.stdout);
    assert.match(tamperedRecovery.stderr, /state lease recovery receipt changed/i);
    fs.writeFileSync(recoveryReceiptPath, recoveryReceiptSource);

    const withoutRetry = runCli([
      "run", "--resume", fixture.state,
      "--host-config", fixture.host,
      "--json"
    ], fixture.directory);
    assert.equal(withoutRetry.status, 5, withoutRetry.stderr || withoutRetry.stdout);
    state = readState(fixture);
    assert.equal(
      state.attempts.filter((item) => item.provider_id === "anti-slop").length,
      1,
      "crash recovery must not implicitly replay an unknown child outcome"
    );

    const host = JSON.parse(fs.readFileSync(fixture.host, "utf8"));
    host.providers["anti-slop"].settings = {};
    host.providers["anti-slop"].timeout_ms = 1_000;
    writeJson(fixture.host, host);
    const resumed = runCli([
      "run", "--resume", fixture.state,
      "--host-config", fixture.host,
      "--retry", "anti-slop",
      "--json"
    ], fixture.directory);
    assert.equal(resumed.status, 6, resumed.stderr || resumed.stdout);
    state = readState(fixture);
    assert.equal(state.final_audit_status, "critic_pass_owner_review_pending");
    assert.equal(
      state.attempts.filter((item) => item.provider_id === "anti-slop" && item.execution_status === "ran").length,
      1
    );
  } finally {
    if (running?.pid) {
      try {
        process.kill(-running.pid, "SIGKILL");
      } catch {
        // The process group already exited.
      }
    }
    cleanup(fixture);
  }
});

for (const crashCheckpoint of [
  "after-initial-state-write",
  "after-plan-sidecar-write",
  "after-plan-receipt-write",
  "after-planning-verification-receipt-write",
  "after-audit-sidecar-write",
  "after-audit-init-receipt-write",
  "after-packets-sidecar-write",
  "after-dispatch-receipt-write",
  "after-initialization-authority-receipt-write",
  "after-initialization-authority-bind-before-state-write"
]) {
  test(`a crash at ${crashCheckpoint} retains start authority and resumes initialization exactly once`, () => {
    const fixture = makeFixture();
    try {
      const configurationPath = path.join(fixture.directory, "start-crash-configuration.json");
      writeJson(configurationPath, {
        statePath: fixture.state,
        routerPath: defaultRouter,
        profilePath: profile,
        input: {
          surface: "operator-product-ui",
          task: "redesign",
          direction: "approved",
          changes: ["source", "copy", "layout", "interaction"],
          risk: "standard",
          scope: "mockup"
        },
        artifacts: [fixture.artifact],
        scope: "mockup",
        creatorActorId: "creator-agent-1",
        invocation: "explicit",
        root: fixture.directory
      });
      const crashed = spawnSync(process.execPath, [
        startCrashHolder,
        configurationPath,
        crashCheckpoint
      ], {
        cwd: fixture.directory,
        encoding: "utf8",
        shell: false
      });
      assert.equal(crashed.status, 92, crashed.stderr || crashed.stdout);

      const beforeRecovery = readState(fixture);
      assert.match(beforeRecovery.resume_authority_digest, /^sha256:[a-f0-9]{64}$/);
      assert.ok(fs.existsSync(beforeRecovery.resume_authority_receipt.path));
      const authorityReceipt = JSON.parse(fs.readFileSync(
        beforeRecovery.resume_authority_receipt.path,
        "utf8"
      ));
      assert.equal(authorityReceipt.resume_authority_digest,
        beforeRecovery.resume_authority_digest);
      const leaseResult = runCli([
        "lease", "status", "--state", fixture.state, "--json"
      ], fixture.directory);
      assert.equal(leaseResult.status, 0, leaseResult.stderr || leaseResult.stdout);
      const lease = JSON.parse(leaseResult.stdout);
      assert.equal(lease.status, "locked");
      assert.equal(lease.owner_process_alive, false);

      const recovered = runCli([
        "lease", "recover", "--state", fixture.state,
        "--owner-token", lease.owner_token,
        "--acquired-at", lease.acquired_at,
        "--state-digest", lease.state_digest,
        "--authority-digest", beforeRecovery.resume_authority_digest,
        "--json"
      ], fixture.directory);
      assert.equal(recovered.status, 0, recovered.stderr || recovered.stdout);
      const recoveryResult = JSON.parse(recovered.stdout);
      assert.equal(recoveryResult.status, "recovered");
      const recoveryReceipt = JSON.parse(fs.readFileSync(recoveryResult.receipt_path, "utf8"));
      assert.equal(recoveryReceipt.state_lease_recovery_receipt_version, 3);
      if (crashCheckpoint === "after-initial-state-write") {
        assert.equal(recoveryReceipt.initialization_reconciliation, null);
      } else {
        assert.equal(
          recoveryReceipt.initialization_reconciliation.initialization_reconciliation_version,
          3
        );
        const authorityOnlyCrash = crashCheckpoint.startsWith(
          "after-initialization-authority-"
        );
        assert.equal(
          recoveryReceipt.initialization_reconciliation.reconciled_anchor_ids.length > 0,
          !authorityOnlyCrash
        );
        assert.equal(
          recoveryReceipt.initialization_reconciliation.initialization_authority.status,
          "bound"
        );
        assert.equal(
          recoveryReceipt.initialization_reconciliation.reconciled_initialization_graph_digest,
          recoveryReceipt.initialization_reconciliation.initialization_authority
            .snapshot.initialization_graph_digest
        );
      }

      const resumed = runCli([
        "run", "--resume", fixture.state,
        "--authority-digest", beforeRecovery.resume_authority_digest,
        "--host-config", fixture.host,
        "--json"
      ], fixture.directory, { injectAuthority: false });
      assert.equal(resumed.status, 6, resumed.stderr || resumed.stdout);
      const afterResume = readState(fixture);
      assert.equal(afterResume.run_id, beforeRecovery.run_id);
      assert.equal(afterResume.resume_authority_digest,
        beforeRecovery.resume_authority_digest);
      assert.ok(afterResume.paths.plan && afterResume.paths.audit && afterResume.paths.packets);
      assert.ok(afterResume.initialization_authority_receipt);
      assert.equal(afterResume.steps.plan.attempt, 1,
        "bootstrap recovery must commit exactly one canonical plan step");
      assert.equal(afterResume.steps["audit-init"].attempt, 1,
        "bootstrap recovery must commit exactly one canonical audit step");
      assert.equal(afterResume.steps.dispatch.attempt, 1,
        "bootstrap recovery must commit exactly one canonical dispatch step");
    } finally {
      cleanup(fixture);
    }
  });
}

test("a crash during initialization reconciliation leaves state unchanged and recovers exactly once", () => {
  const fixture = makeFixture();
  try {
    const configurationPath = path.join(fixture.directory, "reconciliation-crash-configuration.json");
    writeJson(configurationPath, {
      statePath: fixture.state,
      routerPath: defaultRouter,
      profilePath: profile,
      input: {
        surface: "operator-product-ui",
        task: "redesign",
        direction: "approved",
        changes: ["source", "copy", "layout", "interaction"],
        risk: "standard",
        scope: "mockup"
      },
      artifacts: [fixture.artifact],
      scope: "mockup",
      creatorActorId: "creator-agent-1",
      invocation: "explicit",
      root: fixture.directory
    });
    const startCrash = spawnSync(process.execPath, [
      startCrashHolder,
      configurationPath,
      "after-audit-sidecar-write"
    ], {
      cwd: fixture.directory,
      encoding: "utf8",
      shell: false
    });
    assert.equal(startCrash.status, 92, startCrash.stderr || startCrash.stdout);
    const beforeRecovery = readState(fixture);
    const beforeRecoveryBytes = fs.readFileSync(fixture.state);
    const firstLeaseResult = runCli([
      "lease", "status", "--state", fixture.state, "--json"
    ], fixture.directory);
    assert.equal(firstLeaseResult.status, 0, firstLeaseResult.stderr || firstLeaseResult.stdout);
    const firstLease = JSON.parse(firstLeaseResult.stdout);

    const reconciliationCrash = spawnSync(process.execPath, [
      recoveryCrashHolder,
      fixture.state,
      firstLease.owner_token,
      firstLease.acquired_at,
      firstLease.state_digest,
      beforeRecovery.resume_authority_digest,
      "after-recovery-initialization-reconciliation"
    ], {
      cwd: fixture.directory,
      encoding: "utf8",
      shell: false
    });
    assert.equal(reconciliationCrash.status, 91,
      reconciliationCrash.stderr || reconciliationCrash.stdout);
    assert.ok(fs.readFileSync(fixture.state).equals(beforeRecoveryBytes),
      "reconciliation sidecars and receipts must remain uncommitted until one state checkpoint");

    const secondLeaseResult = runCli([
      "lease", "status", "--state", fixture.state, "--json"
    ], fixture.directory);
    assert.equal(secondLeaseResult.status, 0, secondLeaseResult.stderr || secondLeaseResult.stdout);
    const secondLease = JSON.parse(secondLeaseResult.stdout);
    assert.equal(secondLease.operation, "recover");
    assert.equal(secondLease.phase, "recovery");
    assert.equal(secondLease.owner_process_alive, false);
    assert.equal(secondLease.state_digest, beforeRecovery.state_digest);

    const recovered = runCli([
      "lease", "recover", "--state", fixture.state,
      "--owner-token", secondLease.owner_token,
      "--acquired-at", secondLease.acquired_at,
      "--state-digest", secondLease.state_digest,
      "--authority-digest", beforeRecovery.resume_authority_digest,
      "--json"
    ], fixture.directory);
    assert.equal(recovered.status, 0, recovered.stderr || recovered.stdout);
    const recoveryResult = JSON.parse(recovered.stdout);
    const recoveryReceipt = JSON.parse(fs.readFileSync(recoveryResult.receipt_path, "utf8"));
    assert.equal(recoveryReceipt.state_lease_recovery_receipt_version, 3);
    assert.equal(
      recoveryReceipt.initialization_reconciliation.previous_state_digest,
      beforeRecovery.state_digest
    );
    let state = readState(fixture);
    assert.equal(state.attempts.length, 0, "lease recovery must not start a reviewer child");
    assert.equal(state.steps.plan.attempt, 1);
    assert.equal(state.steps["planning-verification"].attempt, 1);
    assert.equal(state.steps["audit-init"].attempt, 1);
    assert.equal(state.steps.dispatch.attempt, 1);

    const resumed = runCli([
      "run", "--resume", fixture.state,
      "--authority-digest", beforeRecovery.resume_authority_digest,
      "--host-config", fixture.host,
      "--json"
    ], fixture.directory, { injectAuthority: false });
    assert.equal(resumed.status, 6, resumed.stderr || resumed.stdout);
    state = readState(fixture);
    assert.ok(state.attempts.length > 0);
    assert.equal(state.steps["audit-init"].attempt, 1);
    assert.equal(state.steps.dispatch.attempt, 1);
  } finally {
    cleanup(fixture);
  }
});

const RECOVERY_INITIALIZATION_CRASH_ANCHORS = {
  "after-plan-receipt-write": ["receipts", "01-plan-receipt.json"],
  "after-planning-verification-receipt-write": ["receipts", "02-planning-verification-receipt.json"],
  "after-audit-sidecar-write": ["audit-run.json"],
  "after-audit-init-receipt-write": ["receipts", "03-audit-init-receipt.json"],
  "after-packets-sidecar-write": ["packets"],
  "after-dispatch-receipt-write": ["receipts", "04-dispatch-receipt.json"]
};

test("modern recovery adopts an exact orphan claim after lease replacement crash", () => {
  const fixture = makeFixture();
  try {
    const configurationPath = writeStartCrashConfiguration(
      fixture,
      "recovery-claim-replacement-crash.json"
    );
    const startCrash = spawnSync(process.execPath, [
      startCrashHolder,
      configurationPath,
      "after-plan-sidecar-write"
    ], { cwd: fixture.directory, encoding: "utf8", shell: false });
    assert.equal(startCrash.status, 92, startCrash.stderr || startCrash.stdout);
    const stateBeforeRecovery = readState(fixture);
    const stateBytes = fs.readFileSync(fixture.state);
    const firstLeaseResult = runCli([
      "lease", "status", "--state", fixture.state, "--json"
    ], fixture.directory);
    assert.equal(firstLeaseResult.status, 0, firstLeaseResult.stderr || firstLeaseResult.stdout);
    const firstLease = JSON.parse(firstLeaseResult.stdout);

    const recoveryCrash = spawnSync(process.execPath, [
      recoveryCrashHolder,
      fixture.state,
      firstLease.owner_token,
      firstLease.acquired_at,
      firstLease.state_digest,
      stateBeforeRecovery.resume_authority_digest,
      "after-recovery-lease-replacement-before-claim-cleanup"
    ], { cwd: fixture.directory, encoding: "utf8", shell: false });
    assert.equal(recoveryCrash.status, 91, recoveryCrash.stderr || recoveryCrash.stdout);
    assert.ok(fs.readFileSync(fixture.state).equals(stateBytes),
      "lease replacement crash must not mutate the unresolved state ledger");

    const claimPath = path.join(`${fixture.state}.lease`, "recovery-claim.json");
    assert.equal(fs.existsSync(claimPath), true);
    const secondLeaseResult = runCli([
      "lease", "status", "--state", fixture.state, "--json"
    ], fixture.directory);
    assert.equal(secondLeaseResult.status, 0, secondLeaseResult.stderr || secondLeaseResult.stdout);
    const secondLease = JSON.parse(secondLeaseResult.stdout);
    assert.equal(secondLease.operation, "recover");
    assert.equal(secondLease.phase, "recovery");
    assert.equal(secondLease.owner_process_alive, false);

    const recovered = runCli([
      "lease", "recover", "--state", fixture.state,
      "--owner-token", secondLease.owner_token,
      "--acquired-at", secondLease.acquired_at,
      "--state-digest", secondLease.state_digest,
      "--authority-digest", stateBeforeRecovery.resume_authority_digest,
      "--json"
    ], fixture.directory, { injectAuthority: false });
    assert.equal(recovered.status, 0, recovered.stderr || recovered.stdout);
    assert.equal(fs.existsSync(claimPath), false);
    const leaseAfter = runCli([
      "lease", "status", "--state", fixture.state, "--json"
    ], fixture.directory);
    assert.equal(JSON.parse(leaseAfter.stdout).status, "unlocked");
  } finally {
    cleanup(fixture);
  }
});

for (const [recoveryCheckpoint, anchorParts] of
  Object.entries(RECOVERY_INITIALIZATION_CRASH_ANCHORS)) {
  test(`recovery crash at ${recoveryCheckpoint} adopts the same initialization anchor bytes`, () => {
    const fixture = makeFixture();
    try {
      const configurationPath = writeStartCrashConfiguration(
        fixture,
        `recovery-anchor-${recoveryCheckpoint}.json`
      );
      const startCrash = spawnSync(process.execPath, [
        startCrashHolder,
        configurationPath,
        "after-plan-sidecar-write"
      ], { cwd: fixture.directory, encoding: "utf8", shell: false });
      assert.equal(startCrash.status, 92, startCrash.stderr || startCrash.stdout);
      const beforeRecovery = readState(fixture);
      const beforeStateBytes = fs.readFileSync(fixture.state);
      const firstLeaseResult = runCli([
        "lease", "status", "--state", fixture.state, "--json"
      ], fixture.directory);
      assert.equal(firstLeaseResult.status, 0, firstLeaseResult.stderr || firstLeaseResult.stdout);
      const firstLease = JSON.parse(firstLeaseResult.stdout);

      const recoveryCrash = spawnSync(process.execPath, [
        recoveryCrashHolder,
        fixture.state,
        firstLease.owner_token,
        firstLease.acquired_at,
        firstLease.state_digest,
        beforeRecovery.resume_authority_digest,
        recoveryCheckpoint
      ], { cwd: fixture.directory, encoding: "utf8", shell: false });
      assert.equal(recoveryCrash.status, 91, recoveryCrash.stderr || recoveryCrash.stdout);
      assert.ok(fs.readFileSync(fixture.state).equals(beforeStateBytes));

      const anchorPath = path.join(beforeRecovery.state_directory, ...anchorParts);
      assert.ok(fs.existsSync(anchorPath), `expected recovery anchor at ${anchorPath}`);
      const anchorStat = fs.lstatSync(anchorPath);
      const retainedAnchor = anchorStat.isDirectory()
        ? hashArtifact(anchorPath)
        : fs.readFileSync(anchorPath);

      const secondLeaseResult = runCli([
        "lease", "status", "--state", fixture.state, "--json"
      ], fixture.directory);
      assert.equal(secondLeaseResult.status, 0, secondLeaseResult.stderr || secondLeaseResult.stdout);
      const secondLease = JSON.parse(secondLeaseResult.stdout);
      const recovered = runCli([
        "lease", "recover", "--state", fixture.state,
        "--owner-token", secondLease.owner_token,
        "--acquired-at", secondLease.acquired_at,
        "--state-digest", secondLease.state_digest,
        "--authority-digest", beforeRecovery.resume_authority_digest,
        "--json"
      ], fixture.directory);
      assert.equal(recovered.status, 0, recovered.stderr || recovered.stdout);

      if (anchorStat.isDirectory()) {
        assert.equal(hashArtifact(anchorPath), retainedAnchor);
      } else {
        assert.ok(fs.readFileSync(anchorPath).equals(retainedAnchor),
          "recovery must adopt the existing receipt bytes instead of rewriting them");
      }
      const state = readState(fixture);
      for (const stepId of ["plan", "planning-verification", "audit-init", "dispatch"]) {
        assert.equal(state.steps[stepId].attempt, 1);
      }
      assert.equal(state.attempts.length, 0);
    } finally {
      cleanup(fixture);
    }
  });
}

for (const recoveryCheckpoint of [
  "after-recovery-receipt",
  "before-recovery-state-write",
  "after-recovery-state-write"
]) {
  test(`recovery transaction at ${recoveryCheckpoint} reuses one receipt and one state commit`, () => {
    const fixture = makeFixture();
    try {
      const configurationPath = writeStartCrashConfiguration(
        fixture,
        `recovery-transaction-${recoveryCheckpoint}.json`
      );
      const startCrash = spawnSync(process.execPath, [
        startCrashHolder,
        configurationPath,
        "after-audit-sidecar-write"
      ], { cwd: fixture.directory, encoding: "utf8", shell: false });
      assert.equal(startCrash.status, 92, startCrash.stderr || startCrash.stdout);
      const beforeRecovery = readState(fixture);
      const firstLeaseResult = runCli([
        "lease", "status", "--state", fixture.state, "--json"
      ], fixture.directory);
      assert.equal(firstLeaseResult.status, 0, firstLeaseResult.stderr || firstLeaseResult.stdout);
      const firstLease = JSON.parse(firstLeaseResult.stdout);

      const recoveryCrash = spawnSync(process.execPath, [
        recoveryCrashHolder,
        fixture.state,
        firstLease.owner_token,
        firstLease.acquired_at,
        firstLease.state_digest,
        beforeRecovery.resume_authority_digest,
        recoveryCheckpoint
      ], { cwd: fixture.directory, encoding: "utf8", shell: false });
      assert.equal(recoveryCrash.status, 91, recoveryCrash.stderr || recoveryCrash.stdout);
      const receiptDirectory = path.join(beforeRecovery.state_directory, "receipts");
      const recoveryReceiptNames = fs.readdirSync(receiptDirectory)
        .filter((name) => name.startsWith("state-lease-recovery-"));
      assert.equal(recoveryReceiptNames.length, 1);
      const retainedReceiptPath = path.join(receiptDirectory, recoveryReceiptNames[0]);
      const retainedReceiptBytes = fs.readFileSync(retainedReceiptPath);

      const secondLeaseResult = runCli([
        "lease", "status", "--state", fixture.state, "--json"
      ], fixture.directory);
      assert.equal(secondLeaseResult.status, 0, secondLeaseResult.stderr || secondLeaseResult.stdout);
      const secondLease = JSON.parse(secondLeaseResult.stdout);
      const recovered = runCli([
        "lease", "recover", "--state", fixture.state,
        "--owner-token", secondLease.owner_token,
        "--acquired-at", secondLease.acquired_at,
        "--state-digest", secondLease.state_digest,
        "--authority-digest", beforeRecovery.resume_authority_digest,
        "--json"
      ], fixture.directory);
      assert.equal(recovered.status, 0, recovered.stderr || recovered.stdout);
      const recoveryResult = JSON.parse(recovered.stdout);
      assert.equal(path.resolve(recoveryResult.receipt_path), path.resolve(retainedReceiptPath));
      assert.ok(fs.readFileSync(retainedReceiptPath).equals(retainedReceiptBytes));
      assert.equal(fs.readdirSync(receiptDirectory)
        .filter((name) => name.startsWith("state-lease-recovery-")).length, 1);
      const state = readState(fixture);
      assert.equal(state.lease_recoveries.length, 1);
      assert.equal(path.resolve(state.lease_recoveries[0].path), path.resolve(retainedReceiptPath));
      assert.equal(state.steps["audit-init"].attempt, 1);
      assert.equal(state.steps.dispatch.attempt, 1);
      const leaseAfter = runCli([
        "lease", "status", "--state", fixture.state, "--json"
      ], fixture.directory);
      assert.equal(leaseAfter.status, 0, leaseAfter.stderr || leaseAfter.stdout);
      assert.equal(JSON.parse(leaseAfter.stdout).status, "unlocked");
    } finally {
      cleanup(fixture);
    }
  });
}

test("a lineaged run resumes exactly once after the initial state write", () => {
  const fixture = makeFixture();
  try {
    const lineage = writeLineageProfile(fixture);
    const configurationPath = path.join(fixture.directory, "lineaged-start-crash-configuration.json");
    writeJson(configurationPath, {
      statePath: fixture.state,
      routerPath: defaultRouter,
      profilePath: lineage.profile,
      input: {
        surface: "operator-product-ui",
        task: "redesign",
        direction: "approved",
        changes: ["source", "copy", "layout", "interaction"],
        risk: "standard",
        scope: "mockup"
      },
      artifacts: [fixture.artifact],
      scope: "mockup",
      creatorActorId: "creator-agent-1",
      invocation: "explicit",
      root: fixture.directory
    });
    const crashed = spawnSync(process.execPath, [
      startCrashHolder,
      configurationPath,
      "after-initial-state-write"
    ], {
      cwd: fixture.directory,
      encoding: "utf8",
      shell: false
    });
    assert.equal(crashed.status, 92, crashed.stderr || crashed.stdout);

    const beforeRecovery = readState(fixture);
    assert.equal(beforeRecovery.paths.plan, undefined);
    assert.match(beforeRecovery.request.initial_plan_authority_digest,
      /^sha256:[a-f0-9]{64}$/);
    const authorityReceipt = JSON.parse(fs.readFileSync(
      beforeRecovery.resume_authority_receipt.path,
      "utf8"
    ));
    assert.equal(authorityReceipt.authority.automation_resume_authority_version, 5);
    assert.equal(authorityReceipt.authority.initial_plan_authority_digest,
      beforeRecovery.request.initial_plan_authority_digest);

    const leaseResult = runCli([
      "lease", "status", "--state", fixture.state, "--json"
    ], fixture.directory);
    assert.equal(leaseResult.status, 0, leaseResult.stderr || leaseResult.stdout);
    const lease = JSON.parse(leaseResult.stdout);
    const recovered = runCli([
      "lease", "recover", "--state", fixture.state,
      "--owner-token", lease.owner_token,
      "--acquired-at", lease.acquired_at,
      "--state-digest", lease.state_digest,
      "--authority-digest", beforeRecovery.resume_authority_digest,
      "--json"
    ], fixture.directory);
    assert.equal(recovered.status, 0, recovered.stderr || recovered.stdout);

    const resumed = runCli([
      "run", "--resume", fixture.state,
      "--authority-digest", beforeRecovery.resume_authority_digest,
      "--host-config", fixture.host,
      "--json"
    ], fixture.directory, { injectAuthority: false });
    assert.equal(resumed.status, 6, resumed.stderr || resumed.stdout);
    const afterResume = readState(fixture);
    const plan = JSON.parse(fs.readFileSync(afterResume.paths.plan.path, "utf8"));
    assert.equal(afterResume.request.initial_plan_authority_digest,
      beforeRecovery.request.initial_plan_authority_digest);
    assert.equal(automationPlanAuthorityDigest(plan),
      beforeRecovery.request.initial_plan_authority_digest);
    assert.equal(afterResume.baseline_lineage.lineage_digest,
      plan.baseline_lineage.lineage_digest);
    assert.equal(afterResume.baseline_lineage.promotion.supersedes_parent, false);
    assert.equal(afterResume.steps.plan.attempt, 1);
    assert.equal(afterResume.steps["audit-init"].attempt, 1);
    assert.equal(afterResume.steps.dispatch.attempt, 1);
  } finally {
    cleanup(fixture);
  }
});

test("a lineaged initial-state crash rejects changed planning authority before plan or child commit", () => {
  const fixture = makeFixture();
  try {
    const lineage = writeLineageProfile(fixture);
    const configurationPath = path.join(fixture.directory, "lineaged-start-tamper-configuration.json");
    writeJson(configurationPath, {
      statePath: fixture.state,
      routerPath: defaultRouter,
      profilePath: lineage.profile,
      input: {
        surface: "operator-product-ui",
        task: "redesign",
        direction: "approved",
        changes: ["source", "copy", "layout", "interaction"],
        risk: "standard",
        scope: "mockup"
      },
      artifacts: [fixture.artifact],
      scope: "mockup",
      creatorActorId: "creator-agent-1",
      invocation: "explicit",
      root: fixture.directory
    });
    const crashed = spawnSync(process.execPath, [
      startCrashHolder,
      configurationPath,
      "after-initial-state-write"
    ], {
      cwd: fixture.directory,
      encoding: "utf8",
      shell: false
    });
    assert.equal(crashed.status, 92, crashed.stderr || crashed.stdout);
    const beforeRecovery = readState(fixture);

    const leaseResult = runCli([
      "lease", "status", "--state", fixture.state, "--json"
    ], fixture.directory);
    assert.equal(leaseResult.status, 0, leaseResult.stderr || leaseResult.stdout);
    const lease = JSON.parse(leaseResult.stdout);
    const recovered = runCli([
      "lease", "recover", "--state", fixture.state,
      "--owner-token", lease.owner_token,
      "--acquired-at", lease.acquired_at,
      "--state-digest", lease.state_digest,
      "--authority-digest", beforeRecovery.resume_authority_digest,
      "--json"
    ], fixture.directory);
    assert.equal(recovered.status, 0, recovered.stderr || recovered.stdout);

    const changedPlanning = JSON.parse(fs.readFileSync(lineage.planning, "utf8"));
    changedPlanning.updated_at = new Date(Date.now() + 1_000).toISOString();
    writeJson(lineage.planning, changedPlanning);
    const resumed = runCli([
      "run", "--resume", fixture.state,
      "--authority-digest", beforeRecovery.resume_authority_digest,
      "--host-config", fixture.host,
      "--json"
    ], fixture.directory, { injectAuthority: false });
    assert.equal(resumed.status, 4, resumed.stderr || resumed.stdout);
    assert.match(resumed.stderr, /initial planning authority changed/);
    const afterFailure = readState(fixture);
    assert.equal(afterFailure.paths.plan, undefined);
    assert.equal(afterFailure.attempts.length, 0);
    assert.equal(afterFailure.request.initial_plan_authority_digest,
      beforeRecovery.request.initial_plan_authority_digest);
  } finally {
    cleanup(fixture);
  }
});

test("a crash after durable authority issuance but before the first state can be recovered and restarted", () => {
  const fixture = makeFixture();
  try {
    const configurationPath = path.join(fixture.directory, "pre-state-crash-configuration.json");
    writeJson(configurationPath, {
      statePath: fixture.state,
      routerPath: defaultRouter,
      profilePath: profile,
      input: {
        surface: "operator-product-ui",
        task: "redesign",
        direction: "approved",
        changes: ["source", "copy", "layout", "interaction"],
        risk: "standard",
        scope: "mockup"
      },
      artifacts: [fixture.artifact],
      scope: "mockup",
      creatorActorId: "creator-agent-1",
      invocation: "explicit",
      root: fixture.directory
    });
    const crashed = spawnSync(process.execPath, [
      startCrashHolder,
      configurationPath,
      "after-start-authority-issue"
    ], {
      cwd: fixture.directory,
      encoding: "utf8",
      shell: false
    });
    assert.equal(crashed.status, 92, crashed.stderr || crashed.stdout);
    assert.equal(fs.existsSync(fixture.state), false);
    const authorityDirectory = `${fixture.state}.authorities`;
    assert.equal(fs.readdirSync(authorityDirectory).length, 1,
      "the caller-visible authority receipt must be durable before the first state write");

    const leaseResult = runCli([
      "lease", "status", "--state", fixture.state, "--json"
    ], fixture.directory);
    assert.equal(leaseResult.status, 0, leaseResult.stderr || leaseResult.stdout);
    const lease = JSON.parse(leaseResult.stdout);
    assert.equal(lease.state_digest, "absent");
    const recovered = runCli([
      "lease", "recover", "--state", fixture.state,
      "--owner-token", lease.owner_token,
      "--acquired-at", lease.acquired_at,
      "--state-digest", lease.state_digest,
      "--json"
    ], fixture.directory);
    assert.equal(recovered.status, 0, recovered.stderr || recovered.stdout);

    const restarted = runCli(startArgs(fixture), fixture.directory);
    assert.equal(restarted.status, 6, restarted.stderr || restarted.stdout);
    const retainedAuthorities = fs.readdirSync(authorityDirectory);
    assert.equal(retainedAuthorities.filter((name) =>
      !name.endsWith(".initialization.json")).length, 2,
      "a restarted journey must issue a fresh authority receipt without overwriting the abandoned one");
    assert.equal(retainedAuthorities.filter((name) =>
      name.endsWith(".initialization.json")).length, 1,
    "the restarted journey must commit exactly one initialization authority before child execution");
  } finally {
    cleanup(fixture);
  }
});

test("concurrent resume fails closed before a second reviewer child starts", {
  skip: process.platform === "win32"
}, async () => {
  const fixture = makeFixture({
    settings: { "anti-slop": { delay_ms: 1_500, write_pid_marker: true } },
    timeouts: { "anti-slop": 5_000 }
  });
  let running = null;
  let runningStdout = "";
  let runningStderr = "";
  try {
    const readyHost = JSON.parse(fs.readFileSync(fixture.host, "utf8"));
    const manualHost = structuredClone(readyHost);
    manualHost.allowed_providers = manualHost.allowed_providers.filter((id) => id !== "anti-slop");
    delete manualHost.providers["anti-slop"];
    writeJson(fixture.host, manualHost);

    const started = runCli(startArgs(fixture), fixture.directory);
    assert.equal(started.status, 6, started.stderr || started.stdout);
    writeJson(fixture.host, readyHost);

    running = spawn(process.execPath, [
      cli,
      "run", "--resume", fixture.state,
      "--authority-digest", readState(fixture).resume_authority_digest,
      "--host-config", fixture.host,
      "--json"
    ], {
      cwd: fixture.directory,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    running.stdout.setEncoding("utf8");
    running.stderr.setEncoding("utf8");
    running.stdout.on("data", (chunk) => {
      runningStdout += chunk;
    });
    running.stderr.on("data", (chunk) => {
      runningStderr += chunk;
    });
    const runningExit = once(running, "exit");
    const evidenceDirectory = path.join(
      fixture.directory,
      "automation.d",
      "evidence",
      "functional-human-review--anti-slop--1",
      "attempt-2"
    );
    await waitForMatchingFiles(evidenceDirectory, /^started\.\d+\.marker$/);

    const overlappingStart = runCli(startArgs(fixture), fixture.directory);
    assert.equal(overlappingStart.status, 5, overlappingStart.stderr || overlappingStart.stdout);
    assert.match(overlappingStart.stderr, /active automation state lease/i);

    const overlappingMigration = runCli([
      "run", "--resume", fixture.state,
      "--migrate-identity",
      "--host-config", fixture.host,
      "--json"
    ], fixture.directory);
    assert.equal(overlappingMigration.status, 5,
      overlappingMigration.stderr || overlappingMigration.stdout);
    assert.match(overlappingMigration.stderr, /active automation state lease/i);

    const overlapping = runCli([
      "run", "--resume", fixture.state,
      "--host-config", fixture.host,
      "--json"
    ], fixture.directory);
    assert.equal(overlapping.status, 5, overlapping.stderr || overlapping.stdout);
    assert.match(overlapping.stderr, /active automation state lease/i);

    const [exitCode, signal] = await runningExit;
    assert.equal(signal, null);
    assert.equal(exitCode, 6, runningStderr || runningStdout);
    running = null;

    const markers = await waitForMatchingFiles(
      evidenceDirectory,
      /^started\.\d+\.marker$/
    );
    assert.equal(markers.length, 1, "only the lease owner may start the reviewer child");
    const state = readState(fixture);
    assert.equal(
      state.attempts.filter((item) => item.provider_id === "anti-slop" && item.execution_status === "ran").length,
      1
    );
  } finally {
    if (running?.pid) {
      try {
        process.kill(-running.pid, "SIGKILL");
      } catch {
        // The process group already exited.
      }
    }
    cleanup(fixture);
  }
});

test("automation state tamper blocks resume before another child runs", () => {
  const fixture = makeFixture();
  try {
    const first = runCli(startArgs(fixture), fixture.directory);
    assert.equal(first.status, 6, first.stderr || first.stdout);
    const state = readState(fixture);
    const attemptsBefore = state.attempts.length;
    state.status = "complete";
    writeJson(fixture.state, state);
    const resumed = runCli([
      "run", "--resume", fixture.state,
      "--host-config", fixture.host,
      "--json"
    ], fixture.directory);
    assert.equal(resumed.status, 4, resumed.stderr || resumed.stdout);
    assert.match(resumed.stderr, /automation state digest mismatch/);
    assert.equal(JSON.parse(fs.readFileSync(fixture.state, "utf8")).attempts.length, attemptsBefore);
  } finally {
    cleanup(fixture);
  }
});

test("resume rejects a re-signed parent identity conflict before another child runs", () => {
  const fixture = makeFixture();
  try {
    const first = runCli(startArgs(fixture), fixture.directory);
    assert.equal(first.status, 6, first.stderr || first.stdout);
    const state = readState(fixture);
    const attemptsBefore = state.attempts.length;
    state.journey_identity.invocation = "resume";
    const { identity_digest: _oldIdentityDigest, ...identityBody } = state.journey_identity;
    state.journey_identity.identity_digest = canonicalDigest(identityBody);
    const { state_digest: _oldStateDigest, ...stateBody } = state;
    state.state_digest = canonicalDigest(stateBody);
    writeJson(fixture.state, state);
    const resumed = runCli([
      "run", "--resume", fixture.state,
      "--host-config", fixture.host,
      "--json"
    ], fixture.directory);
    assert.equal(resumed.status, 4, resumed.stderr || resumed.stdout);
    assert.match(
      resumed.stderr,
      /start authority receipt does not bind|automation resume authority digest conflicts|journey identity mismatch|journey identities conflict/
    );
    assert.equal(JSON.parse(fs.readFileSync(fixture.state, "utf8")).attempts.length, attemptsBefore);
  } finally {
    cleanup(fixture);
  }
});

test("dry-run reports adapter readiness without creating automation state", () => {
  const fixture = makeFixture();
  try {
    const result = runCli([
      ...startArgs(fixture).filter((value, index, values) =>
        value !== "--out" && values[index - 1] !== "--out"),
      "--dry-run"
    ], fixture.directory);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const report = JSON.parse(result.stdout);
    assert.equal(report.status, "dry_run");
    assert.equal(report.plan.visual_signature.primary, "#175CD3");
    assert.equal(report.plan.visual_signature.typography_family, "Inter");
    assert.equal(report.plan.visual_signature.density, "compact");
    assert.equal(report.plan.visual_signature.elevation, "layered");
    assert.equal(Object.hasOwn(report.planning_verification, "baseline_lineage_digest"), false);
    assert.ok(report.host_readiness.every((item) => item.execution_status === "ready"));
    assert.equal(fs.existsSync(fixture.state), false);
  } finally {
    cleanup(fixture);
  }
});

test("dry-run exits manual_pending when any planned adapter is not executable", () => {
  const fixture = makeFixture({ omit: ["anti-slop"] });
  try {
    const result = runCli([
      ...startArgs(fixture).filter((value, index, values) =>
        value !== "--out" && values[index - 1] !== "--out"),
      "--dry-run"
    ], fixture.directory);
    assert.equal(result.status, 6, result.stderr || result.stdout);
    const report = JSON.parse(result.stdout);
    assert.equal(report.status, "dry_run");
    assert.match(report.pending.join("\n"), /anti-slop.*not allowlisted/);
    assert.equal(fs.existsSync(fixture.state), false);
  } finally {
    cleanup(fixture);
  }
});

test("plan --dry-run is rejected because only integrated dry-run inspects execution readiness", () => {
  const fixture = makeFixture();
  try {
    const result = runCli([
      "plan",
      "--dry-run",
      "--profile", profile,
      "--task", "audit",
      "--changes", "source,layout",
      "--artifact", fixture.artifact,
      "--scope", "runtime",
      "--json"
    ], fixture.directory);
    assert.equal(result.status, 2, result.stderr || result.stdout);
    assert.match(result.stderr, /use killsloprouter run --dry-run/);
    assert.equal(fs.existsSync(fixture.state), false);
  } finally {
    cleanup(fixture);
  }
});

test("runtime redesign cannot start without a finalized pre-change UI observation run", () => {
  const fixture = makeFixture();
  try {
    const result = runCli([
      ...startArgs(fixture)
        .map((value) => value === "mockup" ? "runtime" : value),
      "--root", fixture.directory
    ], fixture.directory);
    assert.equal(result.status, 5, result.stderr || result.stdout);
    assert.match(result.stderr, /runtime redesign requires --observation-run/);
    assert.equal(fs.existsSync(fixture.state), false);
  } finally {
    cleanup(fixture);
  }
});

test("an official Playwright route cannot execute through a generic browser host", () => {
  const fixture = makeFixture();
  try {
    const runtimeProfile = writeOfficialTargetProfile(fixture);
    const observationState = path.join(fixture.directory, "observation.json");
    const observed = runCli([
      "run",
      "--profile", runtimeProfile,
      "--host-config", fixture.host,
      "--task", "audit",
      "--direction", "none",
      "--changes", "source,copy,style,layout,interaction,state",
      "--artifact", fixture.artifact,
      "--scope", "runtime",
      "--root", fixture.directory,
      "--out", observationState,
      "--json"
    ], fixture.directory);
    assert.equal(observed.status, 6, observed.stderr || observed.stdout);
    const observation = JSON.parse(fs.readFileSync(observationState, "utf8"));
    assert.equal(observation.status, "manual_pending");
    assert.equal(observation.steps.execution.status, "manual_pending");
    const browserAttempt = observation.attempts.find((item) =>
      item.provider_id === "browser-evidence"
    );
    assert.equal(browserAttempt.execution_status, "manual_pending");
    assert.equal(browserAttempt.ingest_status, "not-recorded");
    assert.match(browserAttempt.reason,
      /official Playwright routing requires the digest-locked official Playwright host adapter/);
    assert.equal(observation.paths.final, undefined);
  } finally {
    cleanup(fixture);
  }
});

test("a generic browser child cannot become the required official UI observation", () => {
  const fixture = makeFixture();
  try {
    const observationState = path.join(fixture.directory, "observation.json");
    const observed = runCli([
      "run",
      "--profile", profile,
      "--host-config", fixture.host,
      "--task", "audit",
      "--direction", "none",
      "--changes", "source,copy,style,layout,interaction,state",
      "--artifact", fixture.artifact,
      "--scope", "runtime",
      "--root", fixture.directory,
      "--out", observationState,
      "--json"
    ], fixture.directory);
    assert.equal(observed.status, 6, observed.stderr || observed.stdout);
    const observation = JSON.parse(fs.readFileSync(observationState, "utf8"));
    assert.equal(observation.steps.execution.status, "completed");
    assert.equal(observation.steps["result-ingest"].status, "completed");
    assert.equal(observation.steps["scanner-triage"].status, "completed");
    assert.equal(observation.steps["conflict-adjudication"].status, "completed");
    assert.equal(
      observation.attempts.find((item) => item.provider_id === "browser-evidence").metadata.transport,
      "node-json-stdio-fixture"
    );

    const redesignState = path.join(fixture.directory, "redesign.json");
    const redesign = runCli([
      "run",
      "--profile", profile,
      "--host-config", fixture.host,
      "--task", "redesign",
      "--direction", "approved",
      "--changes", "source,copy,layout,interaction",
      "--artifact", fixture.artifact,
      "--scope", "runtime",
      "--creator-id", "creator-agent-2",
      "--observation-run", observationState,
      "--root", fixture.directory,
      "--out", redesignState,
      "--json"
    ], fixture.directory);
    assert.equal(redesign.status, 5, redesign.stderr || redesign.stdout);
    const state = JSON.parse(fs.readFileSync(redesignState, "utf8"));
    assert.equal(state.status, "blocked");
    assert.match(state.blockers.join("\n"), /runtime redesign did not route the official Playwright adapter/);
  } finally {
    cleanup(fixture);
  }
});
