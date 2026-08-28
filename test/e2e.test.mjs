import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { canonicalDigest, hashArtifact } from "../src/integrity.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "bin", "killsloprouter.mjs");
const profile = path.join(root, "examples", "project-profile.example.json");
const adapterEntrypoint = path.join(root, "test", "fixtures", "host-adapter.mjs");
const scannerRoot = path.join(root, "test", "fixtures", "kill-ai-slop");
const scannerEntrypoint = path.join(scannerRoot, "skill", "scripts", "scan.mjs");

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

function runCli(args, cwd) {
  return spawnSync(process.execPath, [cli, ...args], {
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

function readState(fixture) {
  return JSON.parse(fs.readFileSync(fixture.state, "utf8"));
}

function writeApproval(fixture, ownerId = "release-owner-1") {
  const state = readState(fixture);
  const audit = JSON.parse(fs.readFileSync(state.paths.audit.path, "utf8"));
  const approval = path.join(fixture.directory, "approval.json");
  writeJson(approval, {
    approval_version: 1,
    run_id: audit.run_id,
    journey_identity: audit.journey_identity,
    scope_digest: audit.approval_scope_digest,
    owner_id: ownerId,
    status: "approved",
    note: "Approved the exact E2E fixture scope.",
    decided_at: new Date().toISOString()
  });
  return approval;
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

async function waitForPath(filePath, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(filePath)) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`timed out waiting for ${filePath}`);
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
    const resumed = runCli([
      "run", "--resume", fixture.state,
      "--host-config", fixture.host,
      "--approval", approval,
      "--json"
    ], fixture.directory);
    assert.equal(resumed.status, 0, resumed.stderr || resumed.stdout);
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
    const finalReceipt = JSON.parse(fs.readFileSync(state.paths.final.path, "utf8"));
    assert.equal(finalReceipt.journey_identity.identity_digest, journeyDigest);
    assert.equal(finalReceipt.owner_approval.journey_identity.identity_digest, journeyDigest);
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
      packet_id: packet.packet_id,
      provider_id: packet.provider.id,
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
      packet_id: adjudication.packet_id,
      provider_id: adjudication.provider.id,
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
    const resumed = runCli([
      "run", "--resume", fixture.state,
      "--host-config", fixture.host,
      "--approval", approval,
      "--json"
    ], fixture.directory);
    assert.equal(resumed.status, 5, resumed.stderr || resumed.stdout);
    assert.match(readState(fixture).blockers.join("\n"), /integrity failure: evidence/);
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
    assert.equal(result.status, 5, result.stderr || result.stdout);
    const state = readState(fixture);
    const attempt = state.attempts.find((item) => item.provider_id === "browser-evidence");
    assert.equal(attempt.execution_status, "blocked_execution_error");
    assert.equal(attempt.ingest_status, "not-recorded");
    assert.match(attempt.error, /evidence escapes the granted output directory/);
  } finally {
    cleanup(fixture);
  }
});

test("a terminated orchestrator resumes from its last sealed child-process checkpoint", {
  skip: process.platform === "win32"
}, async () => {
  const fixture = makeFixture({
    settings: { "anti-slop": { delay_ms: 10_000, write_started_marker: true } },
    timeouts: { "anti-slop": 20_000 }
  });
  let running = null;
  try {
    running = spawn(process.execPath, [cli, ...startArgs(fixture)], {
      cwd: fixture.directory,
      detached: true,
      stdio: "ignore"
    });
    const marker = path.join(
      fixture.directory,
      "automation.d",
      "evidence",
      "functional-human-review--anti-slop--1",
      "attempt-1",
      "started.marker"
    );
    await waitForPath(marker);
    const exited = once(running, "exit");
    process.kill(-running.pid, "SIGTERM");
    const [, signal] = await exited;
    assert.equal(signal, "SIGTERM");
    running = null;

    let state = readState(fixture);
    assert.equal(state.status, "running");
    assert.equal(state.attempts.some((item) => item.provider_id === "anti-slop"), false);
    assert.ok(state.attempts.some((item) => item.provider_id === "visual-intent-review"));

    const host = JSON.parse(fs.readFileSync(fixture.host, "utf8"));
    host.providers["anti-slop"].settings = {};
    host.providers["anti-slop"].timeout_ms = 1_000;
    writeJson(fixture.host, host);
    const resumed = runCli([
      "run", "--resume", fixture.state,
      "--host-config", fixture.host,
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
    assert.match(resumed.stderr, /journey identity mismatch|journey identities conflict/);
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
