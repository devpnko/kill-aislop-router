import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  assertJourneyPresentation,
  createJourneyIdentity,
  createParticipant,
  identitiesMatch,
  presentationViolations,
  resolveJourneyPresentation,
  verifyJourneyIdentity
} from "../src/identity.mjs";
import {
  inspectSkillCatalog,
  migrateLegacySkillEntry
} from "../src/skill-catalog.mjs";
import {
  migrateAutomationStateIdentity,
  readAutomationState
} from "../src/automation.mjs";
import { initializeAudit, rebindLegacyAuditIdentity } from "../src/audit.mjs";
import { planRoute, readJson } from "../src/router.mjs";
import { canonicalDigest, hashArtifact } from "../src/integrity.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "bin", "killsloprouter.mjs");
const installer = path.join(root, "scripts", "install-codex-plugin.mjs");
const profile = path.join(root, "examples", "project-profile.example.json");
const cases = JSON.parse(fs.readFileSync(
  path.join(root, "test", "fixtures", "orchestrator-identity.json"), "utf8"
));

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function runNode(entrypoint, args, cwd = root) {
  return spawnSync(process.execPath, [entrypoint, ...args], {
    cwd,
    encoding: "utf8",
    shell: false,
    timeout: 30_000
  });
}

test("explicit and resumed journeys keep KillSlopRouter as parent while standalone antislop remains compatible", () => {
  const identity = createJourneyIdentity({
    runId: "identity-presentation-fixture",
    routerVersion: "1.0.0",
    invocation: "explicit"
  });
  verifyJourneyIdentity(identity, { runId: "identity-presentation-fixture" });
  for (const fixture of cases.resolution_cases) {
    const result = resolveJourneyPresentation({
      utterance: fixture.utterance,
      activeJourneyIdentity: fixture.active_journey ? identity : null
    });
    assert.equal(result.active_workflow, fixture.expected, fixture.id);
    if (fixture.active_journey) assert.equal(result.journey_identity.identity_digest, identity.identity_digest);
  }
  const participant = createParticipant({ providerId: "anti-slop", stageId: "functional-human-review" });
  for (const fixture of cases.presentation_cases) {
    const participants = fixture.providers.map((providerId) => ({ ...participant, provider_id: providerId }));
    const violations = presentationViolations(fixture.text, { identity, participants });
    assert.equal(violations.length === 0, fixture.allowed, fixture.id);
    if (fixture.allowed) assert.equal(assertJourneyPresentation(fixture.text, { identity, participants }), fixture.text);
    else assert.throws(() => assertJourneyPresentation(fixture.text, { identity, participants }),
      /presentation invariant failed/);
  }
});

test("identity digest and internal participant metadata fail closed on tamper", () => {
  const identity = createJourneyIdentity({ runId: "tamper-fixture", routerVersion: "1.0.0" });
  const clone = structuredClone(identity);
  assert.equal(identitiesMatch(identity, clone), true);
  clone.display_name = "anti-slop";
  assert.equal(identitiesMatch(identity, clone), false);
  assert.throws(() => verifyJourneyIdentity(clone), /display_name|digest/);
  const participant = createParticipant({ providerId: "anti-slop", stageId: "functional-human-review" });
  assert.deepEqual(participant, {
    participant_version: 1,
    provider_id: "anti-slop",
    role: "critic",
    visibility: "internal",
    orchestrator_id: "kill-slop-router"
  });
});

test("installer detects duplicate entries and performs only explicit backup-bound shim migration", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-catalog-"));
  try {
    const legacy = path.join(home, ".codex", "skills", "kill-slop-router");
    const standalone = path.join(home, ".codex", "skills", "antislop");
    fs.mkdirSync(path.join(legacy, "agents"), { recursive: true });
    fs.writeFileSync(path.join(legacy, "SKILL.md"), "# legacy full router\n");
    fs.writeFileSync(path.join(legacy, "agents", "openai.yaml"), "policy:\n  allow_implicit_invocation: true\n");
    fs.mkdirSync(standalone, { recursive: true });
    fs.writeFileSync(path.join(standalone, "SKILL.md"), "# standalone antislop\n");
    const legacyDigest = hashArtifact(legacy);
    const standaloneDigest = hashArtifact(standalone);

    const before = inspectSkillCatalog({ home, assumeCanonical: true });
    assert.equal(before.status, "identity_conflict");
    assert.equal(before.legacy.status, "full-entry");
    const refused = runNode(installer, ["--home", home, "--dry-run"]);
    assert.equal(refused.status, 5, refused.stderr || refused.stdout);
    assert.equal(JSON.parse(refused.stdout).status, "identity_conflict");
    const doctorBeforeInstall = runNode(cli, [
      "doctor", "--profile", profile, "--home", home, "--format", "json"
    ]);
    assert.equal(doctorBeforeInstall.status, 5, doctorBeforeInstall.stderr || doctorBeforeInstall.stdout);
    assert.equal(JSON.parse(doctorBeforeInstall.stdout).skill_catalog.status, "identity_conflict");

    const installed = runNode(installer, ["--home", home, "--migrate-legacy-entry", "--no-activate"]);
    assert.equal(installed.status, 0, installed.stderr || installed.stdout);
    const receipt = JSON.parse(installed.stdout);
    assert.equal(receipt.legacy_migration.status, "migrated");
    assert.equal(receipt.legacy_migration.backup.digest, legacyDigest);
    assert.equal(hashArtifact(receipt.legacy_migration.backup.path), legacyDigest);
    assert.equal(hashArtifact(standalone), standaloneDigest);
    assert.equal(receipt.skill_catalog.status, "ready");
    assert.equal(receipt.skill_catalog.legacy.status, "verified-explicit-shim");
    const metadata = fs.readFileSync(path.join(legacy, "agents", "openai.yaml"), "utf8");
    const skill = fs.readFileSync(path.join(legacy, "SKILL.md"), "utf8");
    assert.match(metadata, /allow_implicit_invocation: false/);
    assert.match(skill, /\$killsloprouter:kill-slop-router/);
    assert.doesNotMatch(skill, /Run contract|Default journey/);

    fs.appendFileSync(path.join(legacy, "SKILL.md"), "tamper\n");
    const tampered = inspectSkillCatalog({ home });
    assert.equal(tampered.status, "identity_conflict");
    assert.equal(tampered.legacy.status, "invalid-shim");
    const doctor = runNode(cli, [
      "doctor", "--profile", profile, "--home", home, "--format", "json"
    ]);
    assert.equal(doctor.status, 5, doctor.stderr || doctor.stdout);
    assert.equal(JSON.parse(doctor.stdout).skill_catalog.status, "identity_conflict");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

function legacyizeState(statePath) {
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  for (const [stepId, step] of Object.entries(state.steps)) {
    const receipt = JSON.parse(fs.readFileSync(step.receipt_path, "utf8"));
    delete receipt.journey_identity;
    delete receipt.receipt_digest;
    receipt.receipt_digest = canonicalDigest(receipt);
    writeJson(step.receipt_path, receipt);
    state.steps[stepId].receipt_digest = receipt.receipt_digest;
    state.steps[stepId].file_digest = hashArtifact(step.receipt_path);
  }
  delete state.journey_identity;
  delete state.state_digest;
  state.state_digest = canonicalDigest(state);
  writeJson(statePath, state);
  return state;
}

test("verified legacy state migration binds identity and its receipt before resume", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-legacy-state-"));
  try {
    const artifact = path.join(directory, "artifact.html");
    const statePath = path.join(directory, ".killsloprouter", "legacy.json");
    fs.writeFileSync(artifact, "<!doctype html><main>legacy fixture</main>\n");
    const started = runNode(cli, [
      "run", "--profile", profile,
      "--surface", "consumer-product-ui",
      "--task", "audit", "--direction", "approved", "--changes", "source",
      "--artifact", artifact, "--scope", "mockup", "--out", statePath, "--json"
    ], directory);
    assert.equal(started.status, 5, started.stderr || started.stdout);
    const legacy = legacyizeState(statePath);
    assert.equal(legacy.attempts.length, 0);
    const migrated = migrateAutomationStateIdentity(statePath);
    assert.equal(migrated.journey_identity.invocation, "legacy-migrated");
    assert.equal(migrated.journey_identity.run_id, migrated.run_id);
    assert.match(migrated.journey_identity.identity_digest, /^sha256:/);
    assert.ok(migrated.identity_migration);
    const migrationReceipt = JSON.parse(fs.readFileSync(migrated.identity_migration.path, "utf8"));
    assert.equal(migrationReceipt.verified.prior_attempt_count, 0);
    assert.equal(migrationReceipt.previous_state_digest, legacy.state_digest);
    assert.equal(readAutomationState(statePath).journey_identity.identity_digest,
      migrated.journey_identity.identity_digest);

    migrationReceipt.verified.router_version = "tampered";
    writeJson(migrated.identity_migration.path, migrationReceipt);
    assert.throws(() => readAutomationState(statePath), /migration receipt|changed outside|digest mismatch/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function legacyAuditManifest(run) {
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
    baseline_observation: run.baseline_observation,
    hard_blockers: run.hard_blockers,
    invariants: run.invariants,
    owner_approval_required: run.owner_approval_required,
    stages: run.stages,
    packets: run.packets,
    approval_scope_digest: run.approval_scope_digest
  };
}

test("verified legacy audit migration rebinds every evidence-free packet and rejects packet tamper", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-legacy-audit-"));
  try {
    const routerPath = path.join(root, "router", "default-router.json");
    const artifact = path.join(directory, "artifact.html");
    fs.writeFileSync(artifact, "<!doctype html><button>Review</button>\n");
    const router = readJson(routerPath, "router");
    const projectProfile = readJson(profile, "profile");
    const plan = planRoute({
      router,
      profile: projectProfile,
      routerPath,
      profilePath: profile,
      input: {
        surface: "operator-product-ui",
        task: "redesign",
        direction: "approved",
        changes: ["source", "copy", "layout", "interaction"],
        risk: "standard"
      }
    });
    const current = initializeAudit({
      plan,
      artifacts: [artifact],
      scope: "mockup",
      creatorActorId: "creator:legacy-fixture",
      root: directory,
      runId: "legacy-audit-fixture"
    });
    const legacy = structuredClone(current);
    delete legacy.journey_identity;
    delete legacy.creator.participant;
    legacy.packets = legacy.packets.map((packet) => {
      const old = structuredClone(packet);
      delete old.run_id;
      delete old.journey_identity;
      delete old.participant;
      delete old.packet_digest;
      old.packet_digest = canonicalDigest(old);
      return old;
    });
    legacy.approval_scope_digest = canonicalDigest({
      run_id: legacy.run_id,
      plan_digest: legacy.route.plan_digest,
      scope: legacy.scope.kind,
      planning_gate: legacy.planning_gate,
      visual_intent: legacy.visual_intent || null,
      visual_intent_sources: legacy.visual_intent_sources.map((source) => source.digest),
      visual_signature: legacy.visual_signature || null,
      visual_signature_sources: legacy.visual_signature_sources.map((source) => source.digest),
      baseline_observation: legacy.baseline_observation || null,
      creator: legacy.creator,
      artifacts: Object.fromEntries(legacy.artifacts.map((item) => [item.path, item.digest])),
      packets: legacy.packets.map((packet) => packet.packet_digest)
    });
    legacy.manifest_digest = canonicalDigest(legacyAuditManifest(legacy));
    const rebound = rebindLegacyAuditIdentity(legacy, current.journey_identity);
    assert.equal(rebound.journey_identity.identity_digest, current.journey_identity.identity_digest);
    assert.equal(rebound.creator.participant.role, "creator");
    assert.ok(rebound.packets.every((packet) =>
      packet.run_id === rebound.run_id &&
      packet.journey_identity.identity_digest === rebound.journey_identity.identity_digest &&
      packet.participant.visibility === "internal"
    ));

    const tampered = structuredClone(legacy);
    tampered.packets[0].stage_id = "tampered-stage";
    tampered.manifest_digest = canonicalDigest(legacyAuditManifest(tampered));
    assert.throws(() => rebindLegacyAuditIdentity(tampered, current.journey_identity),
      /legacy packet digest mismatch/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("legacy migration refuses to relabel any prior child execution evidence", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-legacy-evidence-"));
  try {
    const statePath = path.join(directory, "legacy.json");
    const identity = createJourneyIdentity({ runId: "legacy-evidence", routerVersion: "1.0.0" });
    const state = {
      automation_run_version: 1,
      run_id: "legacy-evidence",
      journey_identity: identity,
      status: "manual_pending",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      state_path: statePath,
      state_directory: path.join(directory, "legacy.d"),
      request: { router_path: path.join(root, "router", "default-router.json") },
      paths: {}, steps: {},
      attempts: [{ packet_id: "child", execution_status: "ran" }],
      blockers: [], pending: [], identity_migration: null, baseline_observation: null,
      final_audit_status: null, final_receipt_digest: null
    };
    delete state.journey_identity;
    state.state_digest = canonicalDigest(state);
    writeJson(statePath, state);
    assert.throws(() => migrateAutomationStateIdentity(statePath),
      /contains adapter attempts; start a new KillSlopRouter run/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
