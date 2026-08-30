import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { canonicalDigest, hashArtifact } from "../src/integrity.mjs";
import { inspectPacketAdapter, loadHostManifest } from "../src/execution.mjs";
import {
  codexRuntimePhysicalIdentityDigest,
  codexRuntimeRootDigest,
  codexRuntimeRootPhysicalIdentityDigest,
  createCodexRuntimeSeal,
  verifyCodexRuntimeSeal
} from "../src/codex.mjs";
import { createJourneyIdentity, createParticipant } from "../src/identity.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "bin", "killsloprouter.mjs");
const exampleProfile = path.join(root, "examples", "project-profile.example.json");
const planningEvidence = path.join(root, "examples", "planning-evidence");
const fakeRuntimeSource = path.join(root, "test", "fixtures", "fake-codex-runtime.mjs");
const genericAdapter = path.join(root, "test", "fixtures", "host-adapter.mjs");
const scannerRoot = path.join(root, "test", "fixtures", "kill-ai-slop");
const scannerEntrypoint = path.join(scannerRoot, "skill", "scripts", "scan.mjs");

const PROVIDERS = {
  "project-contract": {
    strength: 4,
    capabilities: ["task-contract", "object-model", "state-authority"]
  },
  "visual-intent-review": {
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
  "kill-ai-slop": {
    strength: 2,
    capabilities: ["source-pattern-detection"]
  },
  "anti-slop": {
    strength: 3,
    capabilities: ["task-fit", "state-completeness", "responsive-review", "accessibility-review", "interaction-review"]
  },
  "independent-rendered-craft-agent": {
    strength: 3,
    capabilities: ["rendered-hierarchy", "visual-specificity", "visual-restraint", "component-coherence"]
  },
  "independent-copy-agent": {
    strength: 3,
    capabilities: ["copy-specificity", "copy-honesty", "copy-concision"]
  },
  "locale-copy-review": {
    strength: 4,
    capabilities: ["locale-domain-copy"]
  },
  "browser-evidence": {
    strength: 3,
    capabilities: ["responsive-evidence", "keyboard-evidence", "state-evidence", "overflow-evidence", "contrast-evidence", "zoom-evidence"]
  },
  "domain-authority-review": {
    strength: 4,
    capabilities: ["domain-authority"]
  },
  "privacy-authority-review": {
    strength: 4,
    capabilities: ["privacy-authority"]
  },
  "owner-approval": {
    strength: 4,
    capabilities: ["owner-approval"]
  }
};

const AGENT_PROVIDERS = [
  "project-contract",
  "visual-intent-review",
  "independent-rendered-craft-agent",
  "independent-copy-agent",
  "locale-copy-review",
  "domain-authority-review"
];

function sealPacket(value) {
  delete value.packet_digest;
  value.packet_digest = canonicalDigest(value);
  return value;
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function replaceWithSameBytes(target) {
  const replacement = `${target}.same-bytes`;
  const displaced = `${target}.displaced`;
  const mode = fs.statSync(target).mode & 0o777;
  fs.copyFileSync(target, replacement);
  fs.chmodSync(replacement, mode);
  fs.renameSync(target, displaced);
  fs.renameSync(replacement, target);
  fs.rmSync(displaced);
}

function runCli(args, cwd) {
  const commandArgs = [...args];
  const resumeIndex = commandArgs.indexOf("--resume");
  if (resumeIndex >= 0 && !commandArgs.includes("--migrate-identity") &&
    !commandArgs.includes("--authority-digest")) {
    const statePath = path.resolve(cwd, commandArgs[resumeIndex + 1]);
    if (fs.existsSync(statePath)) {
      const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
      if (state.resume_authority_digest) {
        commandArgs.push("--authority-digest", state.resume_authority_digest);
      }
    }
  }
  const fixtureCodexHome = path.join(cwd, "codex-auth");
  return spawnSync(process.execPath, [cli, ...commandArgs], {
    cwd,
    encoding: "utf8",
    shell: false,
    timeout: 60_000,
    maxBuffer: 16 * 1024 * 1024,
    env: {
      ...process.env,
      KILLSLOPROUTER_TEST_SECRET: "must-not-reach-the-review-runtime",
      ...(fs.existsSync(fixtureCodexHome) ? { CODEX_HOME: fixtureCodexHome } : {})
    }
  });
}

function projectFixture({ runtimeMode = {}, executableProviders = true } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-codex-"));
  const config = path.join(directory, ".killsloprouter");
  const profile = path.join(config, "profile.json");
  const host = path.join(config, "host-adapters.json");
  const artifact = path.join(directory, "artifact.html");
  const state = path.join(config, "automation.json");
  const runtimeRoot = path.join(directory, "codex-runtime");
  const runtime = path.join(runtimeRoot, "codex");
  const skillRoot = path.join(directory, "skills", "anti-slop");
  const authHome = path.join(directory, "codex-auth");
  fs.mkdirSync(config, { recursive: true });
  fs.copyFileSync(exampleProfile, profile);
  fs.cpSync(planningEvidence, path.join(config, "planning-evidence"), { recursive: true });
  fs.writeFileSync(artifact, "<!doctype html><button type=\"button\">Save</button>\n");
  fs.mkdirSync(runtimeRoot, { recursive: true });
  fs.copyFileSync(fakeRuntimeSource, runtime);
  fs.chmodSync(runtime, 0o755);
  writeJson(path.join(runtimeRoot, "mode.json"), runtimeMode);
  fs.mkdirSync(skillRoot, { recursive: true });
  fs.writeFileSync(path.join(skillRoot, "SKILL.md"), [
    "# Anti-slop fixture skill",
    "",
    "Review task fit, state completeness, responsive behavior, accessibility, and interaction evidence.",
    "Do not modify the artifact."
  ].join("\n") + "\n");
  fs.mkdirSync(authHome, { recursive: true });
  fs.writeFileSync(path.join(authHome, "auth.json"), "{\"fixture\":true}\n", { mode: 0o600 });

  const providers = Object.fromEntries(Object.entries(PROVIDERS).map(([providerId, contract]) => [
    providerId,
    {
      adapter: "manual-v1",
      strength: contract.strength,
      capabilities: contract.capabilities,
      permissions: []
    }
  ]));
  const grantedPermissions = [];
  if (executableProviders) {
    providers["kill-ai-slop"] = {
      adapter: "kill-ai-slop-v1",
      adapter_root: scannerRoot,
      entrypoint_digest: hashArtifact(scannerEntrypoint),
      strength: PROVIDERS["kill-ai-slop"].strength,
      capabilities: PROVIDERS["kill-ai-slop"].capabilities,
      permissions: ["artifact:read"]
    };
    providers["browser-evidence"] = {
      adapter: "browser-json-v1",
      entrypoint: genericAdapter,
      entrypoint_digest: hashArtifact(genericAdapter),
      strength: PROVIDERS["browser-evidence"].strength,
      capabilities: PROVIDERS["browser-evidence"].capabilities,
      permissions: ["artifact:read", "evidence:write", "browser:control"]
    };
    grantedPermissions.push("artifact:read", "evidence:write", "browser:control");
  }
  writeJson(host, {
    host_adapter_version: 1,
    allowed_providers: Object.keys(providers),
    granted_permissions: grantedPermissions,
    providers
  });
  return { directory, config, profile, host, artifact, state, runtimeRoot, runtime, skillRoot, authHome };
}

function withFixtureCodexHome(fixture, callback) {
  const previous = process.env.CODEX_HOME;
  process.env.CODEX_HOME = fixture.authHome;
  try {
    return callback();
  } finally {
    if (previous === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previous;
  }
}

function loadFixtureManifest(fixture) {
  return withFixtureCodexHome(fixture, () => loadHostManifest(fixture.host));
}

function cleanup(fixture) {
  fs.rmSync(fixture.directory, { recursive: true, force: true });
}

function configureArgs(fixture, {
  agents = AGENT_PROVIDERS,
  skill = true,
  allowExternal = true,
  extra = []
} = {}) {
  return [
    "host", "configure-codex",
    "--profile", fixture.profile,
    "--host-config", fixture.host,
    "--runtime", fixture.runtime,
    "--runtime-root", fixture.runtimeRoot,
    "--model", "gpt-5.4-test",
    ...(agents.length ? ["--agent-providers", agents.join(",")] : []),
    ...(skill ? ["--skill-provider", `anti-slop=${fixture.skillRoot}`] : []),
    ...(allowExternal ? ["--allow-external"] : []),
    "--json",
    ...extra
  ];
}

function startArgs(fixture, extra = []) {
  return [
    "run",
    "--profile", fixture.profile,
    "--host-config", fixture.host,
    "--surface", "operator-product-ui",
    "--task", "redesign",
    "--direction", "approved",
    "--changes", "source,copy,layout,interaction",
    "--artifact", fixture.artifact,
    "--scope", "mockup",
    "--creator-id", "creator:codex-host-e2e",
    "--out", fixture.state,
    "--json",
    ...extra
  ];
}

function approvalFor(fixture) {
  const state = JSON.parse(fs.readFileSync(fixture.state, "utf8"));
  const audit = JSON.parse(fs.readFileSync(state.paths.audit.path, "utf8"));
  const approval = path.join(fixture.config, "owner-approval.json");
  writeJson(approval, {
    approval_version: 1,
    run_id: audit.run_id,
    journey_identity: audit.journey_identity,
    scope_digest: audit.approval_scope_digest,
    owner_id: "owner:codex-host-e2e",
    status: "approved",
    note: "Approved the exact fixed-runtime Codex host E2E scope.",
    decided_at: new Date().toISOString()
  });
  return approval;
}

function packet(providerId, { design = false, capabilities = null } = {}) {
  const runId = "codex-packet-fixture";
  const stageId = design
    ? "direction-candidate"
    : providerId === "anti-slop" ? "functional-human-review" : "project-contract";
  const designTask = design ? { kind: "direction-candidate" } : null;
  const value = {
    ...(design ? { design_packet_version: 1 } : { dispatch_packet_version: 1 }),
    packet_id: `${providerId}--fixture--1`,
    run_id: runId,
    journey_identity: createJourneyIdentity({ runId, routerVersion: "1.0.0" }),
    participant: createParticipant({
      providerId,
      stageId,
      designTaskKind: designTask?.kind || null
    }),
    stage_id: stageId,
    ...(designTask ? { design_task: designTask } : {}),
    provider: { id: providerId },
    assigned_capabilities: capabilities || PROVIDERS[providerId].capabilities,
    minimum_strength: PROVIDERS[providerId].strength,
    required_permissions: ["artifact:read"]
  };
  return sealPacket(value);
}

test("official Codex host configures digest-locked agent and skill reviewers and completes an integrated run", {
  timeout: 120_000
}, () => {
  const fixture = projectFixture();
  const schemaObservations = path.join(fixture.directory, "schema-observations.jsonl");
  writeJson(path.join(fixture.runtimeRoot, "mode.json"), {
    forbidden_env: "KILLSLOPROUTER_TEST_SECRET",
    schema_observation_path: schemaObservations
  });
  try {
    fs.symlinkSync("codex", path.join(fixture.runtimeRoot, "codex-link"));
    const configured = runCli(configureArgs(fixture), fixture.directory);
    assert.equal(configured.status, 0, configured.stderr || configured.stdout);
    const receipt = JSON.parse(configured.stdout);
    assert.equal(receipt.status, "configured");
    assert.equal(receipt.runtime.sandbox, "read-only");
    assert.equal(receipt.runtime.ephemeral, true);
    assert.match(receipt.adapter.entrypoint_graph_digest, /^sha256:/);
    assert.match(receipt.runtime.root_digest, /^sha256:/);
    assert.equal(receipt.privacy.credentials_stored, false);
    assert.equal(receipt.privacy.browser_or_owner_gate_substitution, false);
    const { receipt_digest: receiptDigest, ...receiptBody } = receipt;
    assert.equal(receiptDigest, canonicalDigest(receiptBody));
    assert.equal(hashArtifact(receipt.host_manifest.path), receipt.host_manifest.digest);
    assert.ok(receipt.providers.some((provider) => provider.adapter === "agent-json-v1"));
    assert.ok(receipt.providers.some((provider) => provider.adapter === "skill-json-v1"));

    const host = JSON.parse(fs.readFileSync(fixture.host, "utf8"));
    assert.ok(host.granted_permissions.includes("network:external"));
    for (const providerId of [...AGENT_PROVIDERS, "anti-slop"]) {
      const declaration = host.providers[providerId];
      assert.equal(declaration.settings.contract, "killsloprouter-codex-review-v1");
      assert.match(declaration.entrypoint_digest, /^sha256:/);
      assert.equal(declaration.entrypoint_graph_digest,
        receipt.adapter.entrypoint_graph_digest);
      assert.match(declaration.settings.runtime_digest, /^sha256:/);
      assert.match(declaration.settings.runtime_physical_identity_digest, /^sha256:/);
      assert.match(declaration.settings.runtime_root_digest, /^sha256:/);
      assert.match(declaration.settings.runtime_root_physical_identity_digest, /^sha256:/);
      assert.equal("command" in declaration, false);
      assert.equal("args" in declaration, false);
      assert.equal("credentials" in declaration.settings, false);
    }

    const started = runCli(startArgs(fixture), fixture.directory);
    assert.equal(started.status, 6, started.stderr || started.stdout);
    let state = JSON.parse(fs.readFileSync(fixture.state, "utf8"));
    assert.equal(state.status, "manual_pending");
    assert.equal(state.final_audit_status, "critic_pass_owner_review_pending");
    const officialAttempts = state.attempts.filter((attempt) =>
      attempt.metadata?.transport === "codex-exec-jsonl-v1");
    assert.ok(officialAttempts.length >= 2);
    assert.ok(officialAttempts.some((attempt) => attempt.adapter === "agent-json-v1"));
    assert.ok(officialAttempts.some((attempt) => attempt.adapter === "skill-json-v1"));
    assert.ok(officialAttempts.every((attempt) => attempt.execution_status === "ran" &&
      attempt.ingest_status === "recorded"));
    assert.ok(officialAttempts.every((attempt) =>
      attempt.metadata.observed_journey_identity_digest === state.journey_identity.identity_digest &&
      attempt.metadata.observed_participant.provider_id === attempt.provider_id &&
      attempt.metadata.observed_participant.visibility === "internal"));
    assert.ok(officialAttempts.every((attempt) => attempt.child_pid > 0 &&
      attempt.metadata.child_pid > 0 && attempt.child_pid !== attempt.metadata.child_pid));
    const threadIds = officialAttempts.map((attempt) => attempt.metadata.thread_id);
    assert.equal(new Set(threadIds).size, threadIds.length);
    assert.ok(threadIds.every((threadId) => threadId.startsWith("fixture-")));
    const schemaPolicies = fs.readFileSync(schemaObservations, "utf8")
      .trim().split(/\r?\n/).map((line) => JSON.parse(line));
    assert.ok(schemaPolicies.some((observation) =>
      observation.stage_id !== "adjudication" && observation.resolution_max_items === 0));
    assert.ok(schemaPolicies.some((observation) =>
      observation.stage_id === "adjudication" && observation.resolution_max_items === null));

    const approval = approvalFor(fixture);
    const resumed = runCli([
      "run", "--resume", fixture.state,
      "--host-config", fixture.host,
      "--approval", approval,
      "--json"
    ], fixture.directory);
    assert.equal(resumed.status, 0, resumed.stderr || resumed.stdout);
    state = JSON.parse(fs.readFileSync(fixture.state, "utf8"));
    assert.equal(state.status, "complete");
    assert.equal(state.final_audit_status, "approved");
  } finally {
    cleanup(fixture);
  }
});

test("multi-provider manifest validation defers private Codex runtime sealing to the child boundary", () => {
  const fixture = projectFixture();
  try {
    const configured = runCli(configureArgs(fixture, {
      agents: ["project-contract", "visual-intent-review"],
      skill: true
    }), fixture.directory);
    assert.equal(configured.status, 0, configured.stderr || configured.stdout);

    const first = loadFixtureManifest(fixture);
    for (const providerId of ["project-contract", "visual-intent-review", "anti-slop"]) {
      const inspection = first.providers[providerId].official_codex;
      assert.equal(inspection.readiness.status, "ready");
      assert.equal(inspection.runtimePath, fs.realpathSync.native(fixture.runtime));
      assert.equal(inspection.runtimeRoot, fs.realpathSync.native(fixture.runtimeRoot));
      assert.equal("cleanup" in inspection, false);
      assert.equal("sealedRuntimePhysicalIdentityDigest" in inspection, false);
      assert.equal("sealedRuntimeRootPhysicalIdentityDigest" in inspection, false);
    }

    // The first validation populated the digest-bound readiness cache. A
    // second validation must not attempt an otherwise observable os.tmpdir()
    // runtime clone for every provider.
    const previousTmpdir = process.env.TMPDIR;
    process.env.TMPDIR = path.join(fixture.directory, "missing-validation-tmp");
    try {
      const second = loadFixtureManifest(fixture);
      assert.ok(["project-contract", "visual-intent-review", "anti-slop"].every((providerId) =>
        second.providers[providerId].official_codex.readiness.status === "ready"));
    } finally {
      if (previousTmpdir === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = previousTmpdir;
    }
  } finally {
    cleanup(fixture);
  }
});

test("missing authentication returned by the nested runtime remains manual_pending and is never recorded as ran", () => {
  const fixture = projectFixture();
  const counter = path.join(fixture.directory, "auth-counter.txt");
  writeJson(path.join(fixture.runtimeRoot, "mode.json"), {
    auth_counter_path: counter,
    auth_successes: 2
  });
  try {
    const configured = runCli(configureArgs(fixture, { agents: [], skill: true }), fixture.directory);
    assert.equal(configured.status, 0, configured.stderr || configured.stdout);
    const started = runCli(startArgs(fixture), fixture.directory);
    assert.equal(started.status, 6, started.stderr || started.stdout);
    const state = JSON.parse(fs.readFileSync(fixture.state, "utf8"));
    const attempt = state.attempts.find((candidate) => candidate.provider_id === "anti-slop");
    assert.equal(attempt.execution_status, "manual_pending");
    assert.equal(attempt.ingest_status, "not-recorded");
    assert.equal(attempt.result_path, null);
    assert.match(attempt.reason, /authentication is unavailable/i);
    assert.equal(attempt.metadata.transport, "codex-exec-jsonl-v1");
  } finally {
    cleanup(fixture);
  }
});

test("authentication loss during Codex exec remains manual_pending instead of an execution claim", () => {
  const fixture = projectFixture({ runtimeMode: { exec_auth_failure: true } });
  try {
    const configured = runCli(configureArgs(fixture, { agents: [], skill: true }), fixture.directory);
    assert.equal(configured.status, 0, configured.stderr || configured.stdout);
    const started = runCli(startArgs(fixture), fixture.directory);
    assert.equal(started.status, 6, started.stderr || started.stdout);
    const state = JSON.parse(fs.readFileSync(fixture.state, "utf8"));
    const attempt = state.attempts.find((candidate) => candidate.provider_id === "anti-slop");
    assert.equal(attempt.execution_status, "manual_pending");
    assert.equal(attempt.ingest_status, "not-recorded");
    assert.equal(attempt.result_path, null);
    assert.match(attempt.reason, /authentication became unavailable during review/i);
  } finally {
    cleanup(fixture);
  }
});

test("missing runtime and skill stay manual_pending while runtime and skill tamper block", () => {
  const missingRuntime = projectFixture();
  try {
    const configured = runCli(configureArgs(missingRuntime, { agents: ["project-contract"], skill: false }),
      missingRuntime.directory);
    assert.equal(configured.status, 0, configured.stderr || configured.stdout);
    fs.rmSync(missingRuntime.runtime);
    const manifest = loadFixtureManifest(missingRuntime);
    const inspected = inspectPacketAdapter(packet("project-contract"), manifest);
    assert.equal(inspected.execution_status, "manual_pending");
    assert.match(inspected.reason, /runtime is missing/);
  } finally {
    cleanup(missingRuntime);
  }

  const runtimeTamper = projectFixture();
  try {
    const configured = runCli(configureArgs(runtimeTamper, { agents: ["project-contract"], skill: false }),
      runtimeTamper.directory);
    assert.equal(configured.status, 0, configured.stderr || configured.stdout);
    fs.appendFileSync(runtimeTamper.runtime, "\n// tampered\n");
    assert.throws(() => loadFixtureManifest(runtimeTamper), /runtime (?:root )?digest mismatch/);
  } finally {
    cleanup(runtimeTamper);
  }

  const missingSkill = projectFixture();
  try {
    const configured = runCli(configureArgs(missingSkill, { agents: [], skill: true }), missingSkill.directory);
    assert.equal(configured.status, 0, configured.stderr || configured.stdout);
    fs.rmSync(missingSkill.skillRoot, { recursive: true, force: true });
    const manifest = loadFixtureManifest(missingSkill);
    const inspected = inspectPacketAdapter(packet("anti-slop"), manifest);
    assert.equal(inspected.execution_status, "manual_pending");
    assert.match(inspected.reason, /skill is missing/);
  } finally {
    cleanup(missingSkill);
  }

  const skillTamper = projectFixture();
  try {
    const configured = runCli(configureArgs(skillTamper, { agents: [], skill: true }), skillTamper.directory);
    assert.equal(configured.status, 0, configured.stderr || configured.stdout);
    fs.appendFileSync(path.join(skillTamper.skillRoot, "SKILL.md"), "tampered\n");
    assert.throws(() => loadFixtureManifest(skillTamper), /skill digest mismatch/);
  } finally {
    cleanup(skillTamper);
  }
});

test("capability gaps and design creation stay manual_pending under the official Codex review contract", () => {
  const fixture = projectFixture();
  try {
    const configured = runCli(configureArgs(fixture, { agents: ["project-contract"], skill: false }),
      fixture.directory);
    assert.equal(configured.status, 0, configured.stderr || configured.stdout);
    const host = JSON.parse(fs.readFileSync(fixture.host, "utf8"));
    host.providers["project-contract"].capabilities = ["task-contract"];
    writeJson(fixture.host, host);
    let manifest = loadFixtureManifest(fixture);
    const partial = inspectPacketAdapter(packet("project-contract"), manifest);
    assert.equal(partial.execution_status, "manual_pending");
    assert.match(partial.reason, /lacks assigned capabilities/);
    const dryRun = runCli([
      ...startArgs(fixture).filter((value, index, values) =>
        value !== "--out" && values[index - 1] !== "--out"),
      "--dry-run"
    ], fixture.directory);
    assert.equal(dryRun.status, 6, dryRun.stderr || dryRun.stdout);
    const report = JSON.parse(dryRun.stdout);
    const projectContractReadiness = report.host_readiness.find((candidate) =>
      candidate.provider_id === "project-contract");
    assert.equal(projectContractReadiness.execution_status, "manual_pending");
    assert.match(projectContractReadiness.reason, /lacks assigned capabilities/);
    assert.equal(fs.existsSync(fixture.state), false);

    host.providers["project-contract"].capabilities = PROVIDERS["project-contract"].capabilities;
    writeJson(fixture.host, host);
    manifest = loadFixtureManifest(fixture);
    const design = inspectPacketAdapter(packet("project-contract", { design: true }), manifest);
    assert.equal(design.execution_status, "manual_pending");
    assert.match(design.reason, /cannot create or review design-exploration candidates/);
  } finally {
    cleanup(fixture);
  }
});

test("Codex reviewer output cannot claim completion with a partial capability set", () => {
  const fixture = projectFixture({
    runtimeMode: {
      review: {
        verdict: "pass",
        capabilities_checked: ["task-fit"],
        findings: [],
        resolutions: []
      }
    }
  });
  try {
    const configured = runCli(configureArgs(fixture, { agents: [], skill: true }), fixture.directory);
    assert.equal(configured.status, 0, configured.stderr || configured.stdout);
    const started = runCli(startArgs(fixture), fixture.directory);
    assert.equal(started.status, 5, started.stderr || started.stdout);
    const state = JSON.parse(fs.readFileSync(fixture.state, "utf8"));
    const attempt = state.attempts.find((candidate) => candidate.provider_id === "anti-slop");
    assert.equal(attempt.execution_status, "blocked_execution_error");
    assert.equal(attempt.ingest_status, "not-recorded");
    assert.match(attempt.error, /did not explicitly check the exact assigned capability set/);
  } finally {
    cleanup(fixture);
  }
});

test("Codex structured output schema avoids unsupported uniqueness keywords and runtime rejects duplicate references", () => {
  const outputSchema = JSON.parse(fs.readFileSync(
    path.join(root, "schemas", "codex-review-output.schema.json"),
    "utf8"
  ));
  assert.doesNotMatch(JSON.stringify(outputSchema), /"uniqueItems"/);

  const fixture = projectFixture({
    runtimeMode: {
      review: {
        verdict: "pass_with_findings",
        capabilities_checked: PROVIDERS["project-contract"].capabilities,
        findings: [{
          id: "duplicate-conflict",
          rule_id: null,
          severity: "minor",
          category: "contract",
          location: "artifact.html",
          claim: "Duplicate conflict references must not cross the adapter boundary.",
          evidence: "The fixture intentionally repeats the same reference.",
          suggested_fix: "Return unique references.",
          disposition: "open",
          rationale: null,
          conflicts_with: ["other/finding", "other/finding"]
        }],
        resolutions: []
      }
    }
  });
  try {
    const configured = runCli(configureArgs(fixture, {
      agents: ["project-contract"],
      skill: false
    }), fixture.directory);
    assert.equal(configured.status, 0, configured.stderr || configured.stdout);
    const started = runCli(startArgs(fixture), fixture.directory);
    assert.equal(started.status, 5, started.stderr || started.stdout);
    const state = JSON.parse(fs.readFileSync(fixture.state, "utf8"));
    const attempt = state.attempts.find((candidate) => candidate.provider_id === "project-contract");
    assert.equal(attempt.execution_status, "blocked_execution_error");
    assert.match(attempt.error, /conflicts_with must be a unique array/);
  } finally {
    cleanup(fixture);
  }
});

test("Codex reviewer cannot resolve critic conflicts outside adjudication", () => {
  const fixture = projectFixture({
    runtimeMode: {
      review: {
        verdict: "pass_with_findings",
        capabilities_checked: PROVIDERS["project-contract"].capabilities,
        findings: [{
          id: "contract-conflict",
          rule_id: null,
          severity: "minor",
          category: "contract",
          location: "artifact.html",
          claim: "The reviewer found a conflict but cannot adjudicate it in this packet.",
          evidence: "The fixture supplies a prior-result reference.",
          suggested_fix: null,
          disposition: "open",
          rationale: null,
          conflicts_with: ["prior/finding"]
        }],
        resolutions: [{
          finding_refs: ["contract-conflict", "prior/finding"],
          decision: "Choose the current finding.",
          basis: "The fixture intentionally attempts an out-of-stage decision.",
          rationale: "This must remain reserved for adjudication."
        }]
      }
    }
  });
  try {
    const configured = runCli(configureArgs(fixture, {
      agents: ["project-contract"],
      skill: false
    }), fixture.directory);
    assert.equal(configured.status, 0, configured.stderr || configured.stdout);
    const started = runCli(startArgs(fixture), fixture.directory);
    assert.equal(started.status, 5, started.stderr || started.stdout);
    const state = JSON.parse(fs.readFileSync(fixture.state, "utf8"));
    const attempt = state.attempts.find((candidate) => candidate.provider_id === "project-contract");
    assert.equal(attempt.execution_status, "blocked_execution_error");
    assert.match(attempt.error, /conflict resolutions only for an adjudication packet/);
  } finally {
    cleanup(fixture);
  }
});

test("Codex artifact mutation is detected after nested execution and before result ingestion", () => {
  const fixture = projectFixture({ runtimeMode: { mutate_artifact: true } });
  try {
    const configured = runCli(configureArgs(fixture, { agents: ["project-contract"], skill: false }),
      fixture.directory);
    assert.equal(configured.status, 0, configured.stderr || configured.stdout);
    const started = runCli(startArgs(fixture), fixture.directory);
    assert.equal(started.status, 5, started.stderr || started.stdout);
    const state = JSON.parse(fs.readFileSync(fixture.state, "utf8"));
    const attempt = state.attempts.find((candidate) => candidate.provider_id === "project-contract");
    assert.equal(attempt.execution_status, "blocked_execution_error");
    assert.equal(attempt.ingest_status, "not-recorded");
    assert.match(attempt.error, /artifact digest changed after Codex execution/);
  } finally {
    cleanup(fixture);
  }
});

test("Codex host configuration requires explicit external permission and rejects reserved or argument-bearing providers", () => {
  const fixture = projectFixture();
  try {
    const before = hashArtifact(fixture.host);
    const denied = runCli(configureArgs(fixture, {
      agents: ["project-contract"],
      skill: false,
      allowExternal: false
    }), fixture.directory);
    assert.equal(denied.status, 2, denied.stderr || denied.stdout);
    assert.match(denied.stderr, /requires explicit --allow-external/);
    assert.equal(hashArtifact(fixture.host), before);

    const reserved = runCli(configureArgs(fixture, {
      agents: ["owner-approval"],
      skill: false
    }), fixture.directory);
    assert.equal(reserved.status, 2, reserved.stderr || reserved.stdout);
    assert.match(reserved.stderr, /dedicated manual, scanner, browser, owner, or design adapter/);

    const standaloneAntiSlop = runCli(configureArgs(fixture, {
      agents: ["anti-slop"],
      skill: false
    }), fixture.directory);
    assert.equal(standaloneAntiSlop.status, 2, standaloneAntiSlop.stderr || standaloneAntiSlop.stdout);
    assert.match(standaloneAntiSlop.stderr,
      /Router-scoped skill critic; bind it with --skill-provider anti-slop=/);

    const unsafeHost = JSON.parse(fs.readFileSync(fixture.host, "utf8"));
    unsafeHost.providers["project-contract"].command = "arbitrary-project-command";
    writeJson(fixture.host, unsafeHost);
    const unsafe = runCli(configureArgs(fixture, {
      agents: ["project-contract"],
      skill: false
    }), fixture.directory);
    assert.equal(unsafe.status, 2, unsafe.stderr || unsafe.stdout);
    assert.match(unsafe.stderr, /unsupported field: command/);
    delete unsafeHost.providers["project-contract"].command;
    writeJson(fixture.host, unsafeHost);

    const configured = runCli(configureArgs(fixture, {
      agents: ["project-contract"],
      skill: false
    }), fixture.directory);
    assert.equal(configured.status, 0, configured.stderr || configured.stdout);
    const host = JSON.parse(fs.readFileSync(fixture.host, "utf8"));
    host.providers["project-contract"].settings.args = ["--dangerously-bypass-approvals-and-sandbox"];
    writeJson(fixture.host, host);
    assert.throws(() => loadFixtureManifest(fixture), /unsupported field: args/);
  } finally {
    cleanup(fixture);
  }
});

test("anti-slop remains pending unless the Router dispatches its skill child for functional-human-review", () => {
  const fixture = projectFixture();
  try {
    const configured = runCli(configureArgs(fixture, { agents: [], skill: true }), fixture.directory);
    assert.equal(configured.status, 0, configured.stderr || configured.stdout);
    const host = JSON.parse(fs.readFileSync(fixture.host, "utf8"));
    const declaration = host.providers["anti-slop"];
    declaration.adapter = "agent-json-v1";
    declaration.settings.reviewer_mode = "agent";
    delete declaration.settings.skill_name;
    delete declaration.settings.skill_root;
    delete declaration.settings.skill_digest;
    writeJson(fixture.host, host);
    let manifest = loadHostManifest(fixture.host);
    const direct = inspectPacketAdapter(packet("anti-slop"), manifest);
    assert.equal(direct.execution_status, "manual_pending");
    assert.match(direct.reason, /packet-bound skill-json-v1 child critic/);

    host.providers["anti-slop"] = {
      ...declaration,
      adapter: "skill-json-v1",
      settings: {
        ...declaration.settings,
        reviewer_mode: "skill",
        skill_name: "anti-slop",
        skill_root: fixture.skillRoot,
        skill_digest: hashArtifact(fixture.skillRoot, { ignores: [] })
      }
    };
    writeJson(fixture.host, host);
    manifest = loadHostManifest(fixture.host);
    const wrongStagePacket = packet("anti-slop");
    wrongStagePacket.stage_id = "rendered-craft-review";
    sealPacket(wrongStagePacket);
    const wrongStage = inspectPacketAdapter(wrongStagePacket, manifest);
    assert.equal(wrongStage.execution_status, "manual_pending");
    assert.match(wrongStage.reason, /only satisfy the routed functional-human-review stage/);
  } finally {
    cleanup(fixture);
  }
});

test("Codex runtime digest locks internal symlinks and rejects links outside the runtime root", () => {
  const fixture = projectFixture();
  try {
    fs.symlinkSync("codex", path.join(fixture.runtimeRoot, "internal-codex"));
    assert.match(codexRuntimeRootDigest(fixture.runtimeRoot), /^sha256:/);
    fs.symlinkSync(fixture.artifact, path.join(fixture.runtimeRoot, "outside-artifact"));
    assert.throws(() => codexRuntimeRootDigest(fixture.runtimeRoot), /symlink escapes its locked root/);
  } finally {
    cleanup(fixture);
  }
});

test("Codex executes a private runtime seal and rejects same-byte source replacement", () => {
  const fixture = projectFixture();
  let seal = null;
  try {
    const configured = runCli(configureArgs(fixture, {
      agents: ["project-contract"],
      skill: false
    }), fixture.directory);
    assert.equal(configured.status, 0, configured.stderr || configured.stdout);
    let settings = JSON.parse(fs.readFileSync(fixture.host, "utf8"))
      .providers["project-contract"].settings;
    assert.equal(settings.runtime_physical_identity_digest,
      codexRuntimePhysicalIdentityDigest(fixture.runtime));
    assert.equal(settings.runtime_root_physical_identity_digest,
      codexRuntimeRootPhysicalIdentityDigest(fixture.runtimeRoot));
    seal = createCodexRuntimeSeal({
      runtimeRoot: fixture.runtimeRoot,
      runtimePath: fixture.runtime,
      runtimeRootDigest: settings.runtime_root_digest,
      runtimeRootPhysicalIdentityDigest: settings.runtime_root_physical_identity_digest,
      runtimeDigest: settings.runtime_digest,
      runtimePhysicalIdentityDigest: settings.runtime_physical_identity_digest
    });
    assert.notEqual(seal.runtimePath, fixture.runtime);
    assert.equal(hashArtifact(seal.runtimePath), settings.runtime_digest);
    assert.deepEqual(verifyCodexRuntimeSeal(seal, settings), {
      runtimeRoot: seal.runtimeRoot,
      runtimePath: seal.runtimePath
    }, "the exported seal creator and verifier must share one object contract");

    replaceWithSameBytes(fixture.runtime);
    assert.throws(() => createCodexRuntimeSeal({
      runtimeRoot: fixture.runtimeRoot,
      runtimePath: fixture.runtime,
      runtimeRootDigest: settings.runtime_root_digest,
      runtimeRootPhysicalIdentityDigest: settings.runtime_root_physical_identity_digest,
      runtimeDigest: settings.runtime_digest,
      runtimePhysicalIdentityDigest: settings.runtime_physical_identity_digest
    }), /physical identity mismatch before sealing/);
    const sealedVersion = spawnSync(seal.runtimePath, ["--version"], {
      encoding: "utf8",
      shell: false
    });
    assert.equal(sealedVersion.status, 0, sealedVersion.stderr);
    assert.match(sealedVersion.stdout, /^codex-cli 0\.144\.1/m);
    replaceWithSameBytes(seal.runtimePath);
    assert.throws(() => verifyCodexRuntimeSeal(seal, settings),
      /sealed Codex runtime root physical identity changed before child execution/);

    const reconfigured = runCli(configureArgs(fixture, {
      agents: ["project-contract"],
      skill: false
    }), fixture.directory);
    assert.equal(reconfigured.status, 0, reconfigured.stderr || reconfigured.stdout);
    settings = JSON.parse(fs.readFileSync(fixture.host, "utf8"))
      .providers["project-contract"].settings;
    let injected = false;
    assert.throws(() => createCodexRuntimeSeal({
      runtimeRoot: fixture.runtimeRoot,
      runtimePath: fixture.runtime,
      runtimeRootDigest: settings.runtime_root_digest,
      runtimeRootPhysicalIdentityDigest: settings.runtime_root_physical_identity_digest,
      runtimeDigest: settings.runtime_digest,
      runtimePhysicalIdentityDigest: settings.runtime_physical_identity_digest,
      faultInjector(checkpoint) {
        if (injected || checkpoint !==
          "after-codex-runtime-copy-before-source-revalidation") return;
        injected = true;
        replaceWithSameBytes(fixture.runtime);
      }
    }), /changed while its private execution seal was being created/);
    assert.equal(injected, true);
  } finally {
    seal?.cleanup();
    cleanup(fixture);
  }
});

test("operator and consumer bootstraps opt into the Codex host without crossing their surface contracts", () => {
  for (const [surface, wrongSurface] of [
    ["operator-product-ui", "consumer-product-ui"],
    ["consumer-product-ui", "operator-product-ui"]
  ]) {
    const seed = projectFixture({ executableProviders: false });
    try {
      const project = path.join(seed.directory, surface);
      fs.mkdirSync(project);
      fs.cpSync(seed.authHome, path.join(project, "codex-auth"), { recursive: true });
      const artifact = path.join(project, "artifact.html");
      fs.writeFileSync(artifact, "<!doctype html><main>surface fixture</main>\n");
      const bootstrapped = runCli([
        "bootstrap",
        "--root", project,
        "--project-id", `codex-${surface}`,
        "--locale", "ko-KR",
        "--surface", surface,
        "--json"
      ], project);
      assert.equal(bootstrapped.status, 0, bootstrapped.stderr || bootstrapped.stdout);
      const config = path.join(project, ".killsloprouter");
      const fixture = {
        ...seed,
        directory: project,
        profile: path.join(config, "profile.json"),
        host: path.join(config, "host-adapters.json")
      };
      const configured = runCli(configureArgs(fixture, {
        agents: ["project-contract"],
        skill: true
      }), project);
      assert.equal(configured.status, 0, configured.stderr || configured.stdout);
      const host = JSON.parse(fs.readFileSync(fixture.host, "utf8"));
      assert.equal(host.providers["project-contract"].adapter, "agent-json-v1");
      assert.equal(host.providers["anti-slop"].adapter, "skill-json-v1");
      const profile = JSON.parse(fs.readFileSync(fixture.profile, "utf8"));
      assert.equal(profile.surface_contract.primary, surface);
      assert.deepEqual(profile.surface_contract.allowed, [surface]);

      const mismatched = runCli([
        "run",
        "--dry-run",
        "--profile", fixture.profile,
        "--host-config", fixture.host,
        "--surface", wrongSurface,
        "--task", "redesign",
        "--direction", "approved",
        "--changes", "source,layout,interaction",
        "--artifact", artifact,
        "--scope", "mockup",
        "--creator-id", "creator:wrong-surface-probe",
        "--json"
      ], project);
      assert.equal(mismatched.status, 3, mismatched.stderr || mismatched.stdout);
      assert.match(mismatched.stderr, /surface mismatch/);
    } finally {
      cleanup(seed);
    }
  }
});
