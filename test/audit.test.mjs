import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  dispatchAuditPackets,
  finalizeAudit,
  initializeAudit,
  recordAuditResult,
  recordTriage
} from "../src/audit.mjs";
import { planRoute, readJson } from "../src/router.mjs";
import { hashArtifact } from "../src/integrity.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const routerPath = path.join(root, "router", "default-router.json");
const profilePath = path.join(root, "examples", "project-profile.example.json");
const router = readJson(routerPath, "router");
const profile = readJson(profilePath, "profile");
const startedAt = "2026-08-18T00:00:00.000Z";
const finishedAt = "2026-08-18T00:01:00.000Z";

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function createFixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-audit-test-"));
  const artifact = path.join(directory, "fixture.html");
  const screenshot = path.join(directory, "desktop.png");
  const mobileScreenshot = path.join(directory, "mobile.png");
  const report = path.join(directory, "playwright.json");
  fs.writeFileSync(artifact, "<!doctype html><button>Save</button>\n");
  fs.writeFileSync(screenshot, "fake-png-evidence");
  fs.writeFileSync(mobileScreenshot, "fake-mobile-png-evidence");
  fs.writeFileSync(report, "{\"passed\":true}\n");
  const plan = planRoute({
    router,
    profile,
    routerPath,
    profilePath,
    input: {
      surface: "operator-product-ui",
      task: "redesign",
      direction: "approved",
      changes: ["source", "copy", "layout", "interaction"],
      risk: "standard"
    }
  });
  assert.equal(plan.status, "planned");
  const planFile = path.join(directory, "route.json");
  writeJson(planFile, plan);
  const run = initializeAudit({
    plan,
    planPath: planFile,
    artifacts: [artifact],
    scope: "mockup",
    creatorActorId: "creator-agent-1",
    root: directory,
    runId: "audit-test-run",
    now: startedAt
  });
  return { directory, artifact, screenshot, mobileScreenshot, report, plan, planFile, run };
}

function makeResult(packet, fixture, overrides = {}) {
  const evidence = packet.stage_id === "browser-evidence" ? [
    {
      path: path.basename(fixture.screenshot),
      kind: "screenshot",
      covers: packet.assigned_capabilities,
      viewports: ["desktop"],
      checks: []
    },
    {
      path: path.basename(fixture.mobileScreenshot),
      kind: "screenshot",
      covers: packet.assigned_capabilities,
      viewports: ["mobile"],
      checks: []
    },
    {
      path: path.basename(fixture.report),
      kind: "test-report",
      covers: packet.assigned_capabilities,
      viewports: packet.evidence_contract.required_viewports,
      checks: packet.evidence_contract.required_checks
    }
  ] : [];
  return {
    audit_result_version: 1,
    packet_id: packet.packet_id,
    provider_id: packet.provider.id,
    reviewer: { actor_id: `reviewer-${packet.packet_id}`, kind: packet.provider.kind || "agent" },
    verdict: "pass",
    capabilities_checked: packet.assigned_capabilities,
    artifact_digests: packet.artifact_digests,
    findings: [],
    evidence,
    resolutions: [],
    started_at: startedAt,
    finished_at: finishedAt,
    ...overrides
  };
}

function recordAll(fixture, customize = () => ({})) {
  let run = fixture.run;
  for (const packet of run.packets) {
    const result = makeResult(packet, fixture, customize(packet));
    const resultPath = path.join(fixture.directory, `${packet.packet_id}.result.json`);
    writeJson(resultPath, result);
    run = recordAuditResult(run, result, resultPath);
  }
  return run;
}

test("audit packets produce a complete critic-pass receipt and explicit owner approval", () => {
  const fixture = createFixture();
  try {
    const dispatchDirectory = path.join(fixture.directory, "packets");
    const dispatch = dispatchAuditPackets(fixture.run, dispatchDirectory);
    assert.equal(dispatch.packets.length, fixture.run.packets.length);
    assert.equal(fs.existsSync(dispatch.approval_template), true);

    const incomplete = finalizeAudit(fixture.run, { now: finishedAt });
    assert.equal(incomplete.status, "incomplete");
    assert.ok(incomplete.missing.length > 0);

    const run = recordAll(fixture);
    const pending = finalizeAudit(run, { now: finishedAt });
    assert.equal(pending.status, "critic_pass_owner_review_pending");
    assert.equal(pending.technical_status, "pass");
    assert.match(pending.receipt_digest, /^sha256:[a-f0-9]{64}$/);
    assert.equal(pending.scope.claim, "mockup-only-no-runtime-parity-claim");
    assert.equal(finalizeAudit(run).receipt_digest, finalizeAudit(run).receipt_digest);

    const approval = {
      approval_version: 1,
      run_id: run.run_id,
      scope_digest: run.approval_scope_digest,
      owner_id: "release-owner-1",
      status: "approved",
      note: "Reviewed the exact mockup scope and remaining findings.",
      decided_at: finishedAt
    };
    const approvalPath = path.join(fixture.directory, "approval.json");
    writeJson(approvalPath, approval);
    const approved = finalizeAudit(run, { approval, approvalPath, now: finishedAt });
    assert.equal(approved.status, "approved");
    assert.equal(approved.owner_approval.owner_id, "release-owner-1");
    assert.equal(approved.integrity.status, "pass");
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("planning-gated mockup audits require an unchanged G6 receipt", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-planning-test-"));
  try {
    const artifact = path.join(directory, "fixture.html");
    fs.writeFileSync(artifact, "<!doctype html><main>fixture</main>\n");
    const guardedProfile = structuredClone(profile);
    guardedProfile.planning.required = true;
    guardedProfile.planning.surface_receipts["operator-product-ui"] = path.resolve(
      path.dirname(profilePath),
      guardedProfile.planning.surface_receipts["operator-product-ui"]
    );
    const guardedProfilePath = path.join(directory, "profile.json");
    writeJson(guardedProfilePath, guardedProfile);
    const plan = planRoute({
      router,
      profile: guardedProfile,
      routerPath,
      profilePath: guardedProfilePath,
      input: {
        surface: "operator-product-ui",
        task: "audit",
        direction: "none",
        changes: ["source"],
        risk: "standard",
        scope: "mockup"
      }
    });
    assert.equal(plan.status, "planned");
    assert.equal(plan.planning_gate.gate_statuses.G6, "passed");
    const run = initializeAudit({
      plan,
      artifacts: [artifact],
      scope: "mockup",
      root: directory,
      runId: "planning-gated-run",
      now: startedAt
    });
    assert.equal(run.planning_gate.requirements[0].gate, "G6");

    const changedPlan = structuredClone(plan);
    changedPlan.planning_gate.receipt_digest = `sha256:${"0".repeat(64)}`;
    assert.throws(
      () => initializeAudit({
        plan: changedPlan,
        artifacts: [artifact],
        scope: "mockup",
        root: directory
      }),
      /planning receipt changed/
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("planning evidence tamper after audit initialization blocks finalization", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-planning-tamper-"));
  try {
    const mockup = path.join(directory, "mockup.html");
    const artifact = path.join(directory, "artifact.html");
    const planningPath = path.join(directory, "planning.json");
    fs.writeFileSync(mockup, "<!doctype html><main>approved mockup</main>\n");
    fs.writeFileSync(artifact, "<!doctype html><main>review artifact</main>\n");
    writeJson(planningPath, {
      planning_gate_version: 1,
      protocol: { id: "fixture-planning", version: "1", authority: "fixture-owner" },
      project_id: profile.project_id,
      surface: "operator-product-ui",
      scope_id: "fixture-scope",
      phase: "phase_2",
      gates: {
        G6: {
          status: "passed",
          evidence: [{ kind: "mockup", path: "mockup.html", digest: hashArtifact(mockup) }]
        }
      },
      updated_at: startedAt
    });
    const guardedProfile = structuredClone(profile);
    guardedProfile.planning = { required: true, receipt: "planning.json" };
    const guardedProfilePath = path.join(directory, "profile.json");
    writeJson(guardedProfilePath, guardedProfile);
    const plan = planRoute({
      router,
      profile: guardedProfile,
      routerPath,
      profilePath: guardedProfilePath,
      input: {
        surface: "operator-product-ui",
        task: "audit",
        direction: "none",
        changes: ["source"],
        risk: "standard",
        scope: "mockup"
      }
    });
    assert.equal(plan.status, "planned");
    const run = initializeAudit({
      plan,
      artifacts: [artifact],
      scope: "mockup",
      root: directory,
      runId: "planning-tamper-run",
      now: startedAt
    });
    fs.appendFileSync(mockup, "<!-- changed after audit init -->\n");
    const receipt = finalizeAudit(run, { now: finishedAt });
    assert.equal(receipt.status, "blocked");
    assert.match(receipt.blockers.join("\n"), /planning gate verification failed.*evidence digest changed/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("creator self-review is rejected before it enters the ledger", () => {
  const fixture = createFixture();
  try {
    const packet = fixture.run.packets.find((candidate) => candidate.reviewer_independence_required);
    const result = makeResult(packet, fixture, {
      reviewer: { actor_id: "creator-agent-1", kind: "agent" }
    });
    const resultPath = path.join(fixture.directory, "self-review.json");
    writeJson(resultPath, result);
    assert.throws(
      () => recordAuditResult(fixture.run, result, resultPath),
      /reviewer cannot be the creator/
    );
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("browser packets reject incomplete proof instead of accepting a smoke-test label", () => {
  const fixture = createFixture();
  try {
    const packet = fixture.run.packets.find((candidate) => candidate.stage_id === "browser-evidence");
    const result = makeResult(packet, fixture, {
      evidence: [{
        path: path.basename(fixture.report),
        kind: "test-report",
        covers: packet.assigned_capabilities,
        viewports: ["desktop"],
        checks: ["keyboard", "state", "overflow"]
      }]
    });
    const resultPath = path.join(fixture.directory, "incomplete-browser-result.json");
    writeJson(resultPath, result);
    assert.throws(
      () => recordAuditResult(fixture.run, result, resultPath),
      /missing screenshot evidence/
    );
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("scanner candidates remain blocked until an explicit triage decision is recorded", () => {
  const fixture = createFixture();
  try {
    const staticPacket = fixture.run.packets.find((packet) => packet.stage_id === "static-discovery");
    const run = recordAll(fixture, (packet) => packet.packet_id === staticPacket.packet_id ? {
      verdict: "pass_with_findings",
      findings: [{
        id: "candidate-1",
        severity: "candidate",
        category: "visual-tell",
        claim: "Large shadow may be generic",
        evidence: "fixture.html:1",
        disposition: "open"
      }]
    } : {});
    const blocked = finalizeAudit(run, { now: finishedAt });
    assert.equal(blocked.status, "blocked");
    assert.match(blocked.blockers.join("\n"), /unresolved finding/);

    const triage = {
      triage_version: 1,
      decisions: [{
        finding_ref: `${staticPacket.packet_id}/candidate-1`,
        disposition: "informational",
        rationale: "The source token is bounded by the approved component contract.",
        decided_by: "domain-reviewer-1",
        evidence: []
      }]
    };
    const triagePath = path.join(fixture.directory, "triage.json");
    writeJson(triagePath, triage);
    const triagedRun = recordTriage(run, triage, triagePath);
    const pending = finalizeAudit(triagedRun, { now: finishedAt });
    assert.equal(pending.status, "critic_pass_owner_review_pending");
    assert.equal(pending.findings[0].disposition, "informational");
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("critic disagreement requires an explicit adjudication result", () => {
  const fixture = createFixture();
  try {
    const functional = fixture.run.packets.find((packet) => packet.stage_id === "functional-human-review");
    const craft = fixture.run.packets.find((packet) => packet.stage_id === "rendered-craft-review");
    const adjudication = fixture.run.packets.find((packet) => packet.stage_id === "adjudication");
    const functionalRef = `${functional.packet_id}/density-1`;
    const craftRef = `${craft.packet_id}/density-2`;
    let run = recordAll(fixture, (packet) => {
      if (packet.packet_id === functional.packet_id) {
        return {
          verdict: "pass_with_findings",
          findings: [{
            id: "density-1",
            severity: "minor",
            category: "workflow-density",
            claim: "Keep the compact control row",
            evidence: "Operator task needs same-screen comparison",
            disposition: "informational",
            rationale: "Task density is intentional.",
            conflicts_with: [craftRef]
          }]
        };
      }
      if (packet.packet_id === craft.packet_id) {
        return {
          verdict: "pass_with_findings",
          findings: [{
            id: "density-2",
            severity: "minor",
            category: "visual-restraint",
            claim: "Split the compact control row",
            evidence: "Rendered hierarchy is crowded",
            disposition: "informational",
            rationale: "Craft reviewer prefers more separation.",
            conflicts_with: [functionalRef]
          }]
        };
      }
      return {};
    });
    const blocked = finalizeAudit(run, { now: finishedAt });
    assert.equal(blocked.status, "blocked");
    assert.match(blocked.blockers.join("\n"), /conflict lacks adjudication/);

    const resolvedResult = makeResult(adjudication, fixture, {
      resolutions: [{
        finding_refs: [functionalRef, craftRef],
        decision: "Keep one compact row with stronger grouping",
        basis: "project-contract-and-browser-evidence",
        rationale: "The operator comparison task requires same-screen access and passes overflow checks."
      }]
    });
    const resolvedPath = path.join(fixture.directory, "adjudication-resolved.json");
    writeJson(resolvedPath, resolvedResult);
    run = recordAuditResult(run, resolvedResult, resolvedPath, { replace: true });
    const pending = finalizeAudit(run, { now: finishedAt });
    assert.equal(pending.status, "critic_pass_owner_review_pending");
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("artifact or evidence changes after review invalidate the receipt", () => {
  const fixture = createFixture();
  try {
    const run = recordAll(fixture);
    fs.appendFileSync(fixture.screenshot, "tampered");
    fs.appendFileSync(fixture.artifact, "<!-- changed after review -->\n");
    const blocked = finalizeAudit(run, { now: finishedAt });
    assert.equal(blocked.status, "blocked");
    assert.match(blocked.blockers.join("\n"), /integrity failure: artifact/);
    assert.match(blocked.blockers.join("\n"), /integrity failure: evidence/);
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("surface profile changes after routing invalidate audit initialization and finalization", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-profile-tamper-"));
  try {
    const artifact = path.join(directory, "fixture.html");
    const routedProfilePath = path.join(directory, "profile.json");
    fs.writeFileSync(artifact, "<!doctype html><main>operator workflow</main>\n");
    writeJson(routedProfilePath, profile);
    const plan = planRoute({
      router,
      profile,
      routerPath,
      profilePath: routedProfilePath,
      input: {
        task: "audit",
        direction: "none",
        changes: ["source"],
        risk: "standard"
      },
      artifacts: [artifact],
      root: directory
    });
    assert.equal(plan.status, "planned");
    assert.equal(plan.input.surface, "operator-product-ui");

    fs.appendFileSync(routedProfilePath, "\n");
    assert.throws(() => initializeAudit({
      plan,
      artifacts: [artifact],
      scope: "runtime",
      root: directory
    }), /project profile changed after route planning/);

    writeJson(routedProfilePath, profile);
    const run = initializeAudit({
      plan,
      artifacts: [artifact],
      scope: "runtime",
      root: directory,
      runId: "profile-tamper-run",
      now: startedAt
    });
    fs.appendFileSync(routedProfilePath, "\n");
    const receipt = finalizeAudit(run, { now: finishedAt });
    assert.equal(receipt.status, "blocked");
    assert.match(receipt.blockers.join("\n"), /integrity failure: route-profile/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("editing stage requirements in the run ledger invalidates the manifest", () => {
  const fixture = createFixture();
  try {
    const run = recordAll(fixture);
    run.stages[0].required_capabilities = [];
    const blocked = finalizeAudit(run, { now: finishedAt });
    assert.equal(blocked.status, "blocked");
    assert.match(blocked.blockers.join("\n"), /integrity failure: audit-manifest/);
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("owner approval is bound to the exact run scope and cannot come from the creator", () => {
  const fixture = createFixture();
  try {
    const run = recordAll(fixture);
    const wrongScope = {
      approval_version: 1,
      run_id: run.run_id,
      scope_digest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      owner_id: "release-owner-1",
      status: "approved",
      note: "Wrong scope",
      decided_at: finishedAt
    };
    assert.throws(() => finalizeAudit(run, { approval: wrongScope }), /scope_digest/);

    const selfApproval = {
      ...wrongScope,
      scope_digest: run.approval_scope_digest,
      owner_id: "creator-agent-1"
    };
    assert.throws(() => finalizeAudit(run, { approval: selfApproval }), /creator cannot approve/);
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("CLI initializes packets and fails finalization when required critics are missing", () => {
  const fixture = createFixture();
  try {
    const runPath = path.join(fixture.directory, "cli-run.json");
    const cli = path.join(root, "bin", "killsloprouter.mjs");
    const init = spawnSync(process.execPath, [
      cli,
      "audit", "init",
      "--plan", fixture.planFile,
      "--artifact", fixture.artifact,
      "--scope", "mockup",
      "--creator-id", "cli-creator-1",
      "--out", runPath
    ], { cwd: fixture.directory, encoding: "utf8" });
    assert.equal(init.status, 0, init.stderr);
    assert.match(init.stdout, /packet_count:/);
    assert.equal(fs.existsSync(runPath), true);
    assert.equal(fs.existsSync(path.join(fixture.directory, "cli-run.packets")), true);

    const finalize = spawnSync(process.execPath, [
      cli,
      "audit", "finalize",
      "--run", runPath
    ], { cwd: fixture.directory, encoding: "utf8" });
    assert.equal(finalize.status, 5);
    assert.match(finalize.stdout, /status: incomplete/);
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("runtime handoff cannot be approved through a mockup-only audit scope", () => {
  const fixture = createFixture();
  try {
    const runtimePlan = planRoute({
      router,
      profile,
      routerPath,
      profilePath,
      input: {
        surface: "operator-product-ui",
        task: "runtime-handoff",
        direction: "approved",
        changes: ["interaction", "state"],
        risk: "standard"
      }
    });
    assert.throws(() => initializeAudit({
      plan: runtimePlan,
      artifacts: [fixture.artifact],
      scope: "mockup",
      creatorActorId: "creator-agent-1",
      root: fixture.directory
    }), /require --scope runtime/);
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});
