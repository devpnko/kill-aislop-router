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
  createPluginInstallMarker,
  inspectSkillCatalog,
  migrateLegacySkillEntry,
  shimMetadata,
  shimSkill
} from "../src/skill-catalog.mjs";
import {
  automationResumeAuthorityDigest,
  inspectAutomationStateLease,
  migrateAutomationStateIdentity,
  readAutomationState,
  recoverAutomationStateLease
} from "../src/automation.mjs";
import { initializeAudit, rebindLegacyAuditIdentity } from "../src/audit.mjs";
import { planRoute, readJson } from "../src/router.mjs";
import { canonicalDigest, hashArtifact } from "../src/integrity.mjs";
import { acquireStateLease, releaseStateLease } from "../src/state-lease.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "bin", "killsloprouter.mjs");
const installer = path.join(root, "scripts", "install-codex-plugin.mjs");
const profile = path.join(root, "examples", "project-profile.example.json");
const cases = JSON.parse(fs.readFileSync(
  path.join(root, "test", "fixtures", "orchestrator-identity.json"), "utf8"
));
const legacyFixtureRoot = path.join(root, "test", "fixtures", "legacy-9045fce-capture");
const legacyCapture = JSON.parse(fs.readFileSync(
  path.join(legacyFixtureRoot, "CAPTURE.json"), "utf8"
));

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function replaceWithSameBytes(file) {
  const replacement = `${file}.same-bytes-replacement`;
  fs.writeFileSync(replacement, fs.readFileSync(file), { flag: "wx" });
  fs.renameSync(replacement, file);
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
    assert.equal(receipt.skill_catalog.canonical.status, "installed");
    assert.match(receipt.skill_catalog.canonical.marker_digest, /^sha256:[a-f0-9]{64}$/);
    assert.match(receipt.skill_catalog.canonical.payload_digest, /^sha256:[a-f0-9]{64}$/);
    assert.match(receipt.skill_catalog.canonical.runtime_digest, /^sha256:[a-f0-9]{64}$/);
    assert.match(receipt.skill_catalog.canonical.canonical_skill_digest,
      /^sha256:[a-f0-9]{64}$/);
    assert.equal(receipt.skill_catalog.legacy.status, "verified-explicit-shim");
    const metadata = fs.readFileSync(path.join(legacy, "agents", "openai.yaml"), "utf8");
    const skill = fs.readFileSync(path.join(legacy, "SKILL.md"), "utf8");
    assert.match(metadata, /allow_implicit_invocation: false/);
    assert.match(skill, /\$killsloprouter:kill-slop-router/);
    assert.doesNotMatch(skill, /Run contract|Default journey/);

    const canonicalSkill = receipt.skill_catalog.canonical.skill_path;
    const canonicalSkillBytes = fs.readFileSync(canonicalSkill);
    fs.appendFileSync(canonicalSkill, "tamper\n");
    const canonicalTamper = inspectSkillCatalog({ home });
    assert.equal(canonicalTamper.status, "identity_conflict");
    assert.equal(canonicalTamper.canonical.status, "unsafe-or-incomplete");
    fs.writeFileSync(canonicalSkill, canonicalSkillBytes);
    assert.equal(inspectSkillCatalog({ home }).status, "ready");

    const canonicalMarkerPath = path.join(
      receipt.skill_catalog.canonical.path,
      ".killsloprouter-plugin-installed.json"
    );
    const canonicalMarker = JSON.parse(fs.readFileSync(canonicalMarkerPath, "utf8"));
    const forgedProvenance = { ...canonicalMarker, source: "arbitrary-self-authored-marker" };
    delete forgedProvenance.marker_digest;
    forgedProvenance.marker_digest = canonicalDigest(forgedProvenance);
    writeJson(canonicalMarkerPath, forgedProvenance);
    const provenanceTamper = inspectSkillCatalog({ home });
    assert.equal(provenanceTamper.status, "identity_conflict");
    assert.equal(provenanceTamper.canonical.status, "unsafe-or-incomplete");
    writeJson(canonicalMarkerPath, canonicalMarker);
    assert.equal(inspectSkillCatalog({ home }).status, "ready");

    const canonicalRoot = receipt.skill_catalog.canonical.path;
    const canonicalReadme = path.join(canonicalRoot, "README.md");
    fs.appendFileSync(canonicalReadme, "\nolder reviewed payload fixture\n");
    const packageMetadata = JSON.parse(fs.readFileSync(path.join(canonicalRoot, "package.json"), "utf8"));
    writeJson(path.join(canonicalRoot, ".killsloprouter-plugin-installed.json"),
      createPluginInstallMarker({
        root: canonicalRoot,
        version: packageMetadata.version
      }));
    const refreshRequired = inspectSkillCatalog({ home });
    assert.equal(refreshRequired.status, "identity_conflict");
    assert.equal(refreshRequired.canonical.status, "refresh-required");
    fs.rmSync(legacy, { recursive: true });
    fs.mkdirSync(path.join(legacy, "agents"), { recursive: true });
    fs.writeFileSync(path.join(legacy, "SKILL.md"), "# second legacy full router\n");
    fs.writeFileSync(path.join(legacy, "agents", "openai.yaml"),
      "policy:\n  allow_implicit_invocation: true\n");
    const mixedRefresh = inspectSkillCatalog({ home });
    assert.equal(mixedRefresh.canonical.status, "refresh-required");
    assert.equal(mixedRefresh.legacy.status, "full-entry");
    assert.equal(mixedRefresh.migration.kind, "canonical-refresh-and-legacy-shim");
    assert.equal(mixedRefresh.migration.command,
      "killsloprouter plugin install --force --migrate-legacy-entry");
    const incompleteRefresh = runNode(installer, ["--home", home, "--force", "--no-activate"]);
    assert.equal(incompleteRefresh.status, 5, incompleteRefresh.stderr || incompleteRefresh.stdout);
    assert.equal(JSON.parse(incompleteRefresh.stdout).next,
      "killsloprouter plugin install --force --migrate-legacy-entry");
    const refreshed = runNode(installer, [
      "--home", home, "--force", "--migrate-legacy-entry", "--no-activate"
    ]);
    assert.equal(refreshed.status, 0, refreshed.stderr || refreshed.stdout);
    const refreshReceipt = JSON.parse(refreshed.stdout);
    assert.equal(refreshReceipt.skill_catalog.status, "ready");
    assert.equal(refreshReceipt.skill_catalog.canonical.status, "installed");
    assert.equal(fs.existsSync(refreshReceipt.plugin_backup), true);

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

test("catalog rejects empty canonical markers and self-consistent forged legacy shim markers", () => {
  const canonicalHome = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-forged-canonical-"));
  const legacyHome = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-forged-shim-"));
  try {
    const canonical = path.join(canonicalHome, "plugins", "killsloprouter");
    fs.mkdirSync(path.join(canonical, "skills", "kill-slop-router"), { recursive: true });
    fs.writeFileSync(path.join(canonical, ".killsloprouter-plugin-installed.json"), "{}\n");
    fs.writeFileSync(path.join(canonical, "skills", "kill-slop-router", "SKILL.md"),
      "# unrelated workflow\n");
    const canonicalReport = inspectSkillCatalog({ home: canonicalHome });
    assert.equal(canonicalReport.status, "identity_conflict");
    assert.equal(canonicalReport.canonical.status, "unsafe-or-incomplete");

    writeJson(path.join(canonical, ".killsloprouter-plugin-installed.json"), {
      name: "killsloprouter",
      version: "1.0.0",
      installed_by: "scripts/install-codex-plugin.mjs",
      installed_at: "2026-08-29T00:00:00.000Z",
      source: "arbitrary-self-authored-marker"
    });
    const shapedButUnbound = inspectSkillCatalog({ home: canonicalHome });
    assert.equal(shapedButUnbound.status, "identity_conflict");
    assert.equal(shapedButUnbound.canonical.status, "unsafe-or-incomplete");

    const legacy = path.join(legacyHome, ".codex", "skills", "kill-slop-router");
    const migratedAt = "2026-08-29T00:00:00.000Z";
    const migrationId = "123e4567-e89b-42d3-a456-426614174000";
    const stamp = migratedAt.replace(/[-:.]/g, "");
    const backup = path.join(
      legacyHome,
      ".codex",
      "skills",
      ".killsloprouter-backups",
      `kill-slop-router-${stamp}-${migrationId}`
    );
    fs.mkdirSync(path.join(legacy, "agents"), { recursive: true });
    fs.mkdirSync(backup, { recursive: true });
    fs.writeFileSync(path.join(legacy, "SKILL.md"), shimSkill());
    fs.writeFileSync(path.join(legacy, "agents", "openai.yaml"), shimMetadata());
    fs.writeFileSync(path.join(backup, "SKILL.md"), "# purported original router\n");
    const marker = {
      legacy_shim_version: 1,
      migration_id: migrationId,
      migrated_at: migratedAt,
      legacy_entrypoint: "kill-slop-router",
      canonical_entrypoint: "killsloprouter:kill-slop-router",
      original_digest: hashArtifact(backup),
      backup: { path: backup, digest: hashArtifact(backup) },
      files: {
        skill: hashArtifact(path.join(legacy, "SKILL.md")),
        metadata: hashArtifact(path.join(legacy, "agents", "openai.yaml"))
      }
    };
    marker.migration_digest = canonicalDigest(marker);
    writeJson(path.join(legacy, ".killsloprouter-legacy-shim.json"), marker);
    const legacyReport = inspectSkillCatalog({ home: legacyHome, assumeCanonical: true });
    assert.equal(legacyReport.status, "identity_conflict");
    assert.equal(legacyReport.legacy.status, "refresh-required-shim");

    const forgedV2 = {
      legacy_shim_version: 2,
      migration_contract: "explicit-backup-only-canonical-bound-v2",
      migration_id: migrationId,
      migrated_at: migratedAt,
      legacy_entrypoint: "kill-slop-router",
      canonical_entrypoint: "killsloprouter:kill-slop-router",
      original_digest: hashArtifact(backup),
      backup: { path: backup, digest: hashArtifact(backup) },
      canonical_install: {
        marker_digest: canonicalDigest({ fake: "marker" }),
        payload_digest: canonicalDigest({ fake: "payload" }),
        runtime_digest: canonicalDigest({ fake: "runtime" }),
        canonical_skill_digest: canonicalDigest({ fake: "skill" })
      },
      files: {
        skill: hashArtifact(path.join(legacy, "SKILL.md")),
        metadata: hashArtifact(path.join(legacy, "agents", "openai.yaml"))
      }
    };
    forgedV2.migration_digest = canonicalDigest(forgedV2);
    writeJson(path.join(legacy, ".killsloprouter-legacy-shim.json"), forgedV2);
    const forgedV2Report = inspectSkillCatalog({ home: legacyHome, assumeCanonical: true });
    assert.equal(forgedV2Report.status, "identity_conflict");
    assert.equal(forgedV2Report.legacy.status, "invalid-shim");
  } finally {
    fs.rmSync(canonicalHome, { recursive: true, force: true });
    fs.rmSync(legacyHome, { recursive: true, force: true });
  }
});

function readLegacyFixture(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(legacyFixtureRoot, relativePath), "utf8"));
}

function remapLegacyFixture(value, directory, routerPath) {
  return JSON.parse(JSON.stringify(value)
    .replaceAll(legacyCapture.captured_root, directory)
    .replaceAll(
      `${legacyCapture.source_checkout_root}/router/default-router.json`,
      routerPath
    ));
}

function materializeHistoricalLegacyState(directory) {
  assert.equal(hashArtifact(path.join(legacyFixtureRoot, "legacy-state.json")),
    legacyCapture.state_file_digest, "historical state fixture changed");
  assert.equal(hashArtifact(path.join(legacyFixtureRoot, "legacy-state.d", "plan.json")),
    legacyCapture.plan_file_digest, "historical plan fixture changed");
  assert.equal(hashArtifact(path.join(legacyFixtureRoot, "legacy-state.d", "audit-run.json")),
    legacyCapture.audit_file_digest, "historical audit fixture changed");

  const statePath = path.join(directory, "legacy-state.json");
  const stateDirectory = path.join(directory, "legacy-state.d");
  const receiptsDirectory = path.join(stateDirectory, "receipts");
  const routerPath = path.join(directory, "default-router.json");
  const profilePath = path.join(directory, "profile.json");
  const artifactPath = path.join(directory, "artifact.txt");
  const planPath = path.join(stateDirectory, "plan.json");
  const auditPath = path.join(stateDirectory, "audit-run.json");
  fs.mkdirSync(receiptsDirectory, { recursive: true });
  fs.copyFileSync(path.join(legacyFixtureRoot, "default-router.json"), routerPath);
  fs.copyFileSync(path.join(legacyFixtureRoot, "profile.json"), profilePath);
  fs.copyFileSync(path.join(legacyFixtureRoot, "artifact.txt"), artifactPath);
  assert.equal(hashArtifact(routerPath), legacyCapture.source_router_digest,
    "historical router authority changed");
  assert.equal(hashArtifact(profilePath), legacyCapture.profile_file_digest,
    "historical profile fixture changed");

  const plan = remapLegacyFixture(
    readLegacyFixture(path.join("legacy-state.d", "plan.json")),
    directory,
    routerPath
  );
  writeJson(planPath, plan);

  const audit = remapLegacyFixture(
    readLegacyFixture(path.join("legacy-state.d", "audit-run.json")),
    directory,
    routerPath
  );
  audit.route.plan_digest = canonicalDigest(plan);
  audit.route.plan_source = {
    ...audit.route.plan_source,
    resolved_path: planPath,
    bytes: fs.lstatSync(planPath).size,
    digest: hashArtifact(planPath)
  };
  audit.route.profile_source = {
    ...audit.route.profile_source,
    resolved_path: profilePath,
    bytes: fs.lstatSync(profilePath).size,
    digest: hashArtifact(profilePath)
  };
  audit.artifacts[0] = {
    ...audit.artifacts[0],
    resolved_path: artifactPath,
    bytes: fs.lstatSync(artifactPath).size,
    digest: hashArtifact(artifactPath)
  };
  audit.approval_scope_digest = legacyApprovalScope(audit);
  audit.manifest_digest = canonicalDigest(legacyAuditManifest(audit));
  writeJson(auditPath, audit);

  const receiptFiles = {
    plan: "01-plan-receipt.json",
    "planning-verification": "02-planning-verification-receipt.json",
    "audit-init": "03-audit-init-receipt.json"
  };
  const receipts = {};
  for (const [stepId, file] of Object.entries(receiptFiles)) {
    const receipt = remapLegacyFixture(
      readLegacyFixture(path.join("legacy-state.d", "receipts", file)),
      directory,
      routerPath
    );
    if (stepId === "plan") {
      receipt.payload.plan_path = planPath;
      receipt.payload.plan_digest = canonicalDigest(plan);
    }
    if (stepId === "audit-init") {
      receipt.payload.audit_path = auditPath;
      receipt.payload.audit_digest = hashArtifact(auditPath);
      receipt.payload.audit_manifest_digest = audit.manifest_digest;
      receipt.payload.approval_scope_digest = audit.approval_scope_digest;
      receipt.payload.artifact_digests = { "artifact.txt": hashArtifact(artifactPath) };
    }
    delete receipt.receipt_digest;
    receipt.receipt_digest = canonicalDigest(receipt);
    const receiptPath = path.join(receiptsDirectory, file);
    writeJson(receiptPath, receipt);
    receipts[stepId] = { receipt, receiptPath };
  }

  const state = remapLegacyFixture(
    readLegacyFixture("legacy-state.json"),
    directory,
    routerPath
  );
  state.state_path = statePath;
  state.state_directory = stateDirectory;
  state.request.router_path = routerPath;
  state.request.profile_path = profilePath;
  state.request.profile_digest = hashArtifact(profilePath);
  state.request.root = directory;
  state.request.artifacts = [artifactPath];
  state.paths.plan = { path: planPath, digest: hashArtifact(planPath) };
  state.paths.audit = { path: auditPath, digest: hashArtifact(auditPath) };
  for (const [stepId, { receipt, receiptPath }] of Object.entries(receipts)) {
    state.steps[stepId] = {
      ...state.steps[stepId],
      receipt_path: receiptPath,
      receipt_digest: receipt.receipt_digest,
      file_digest: hashArtifact(receiptPath)
    };
  }
  delete state.state_digest;
  state.state_digest = canonicalDigest(state);
  writeJson(statePath, state);
  return { state, statePath, stateDirectory, routerPath, profilePath, artifactPath };
}

function stripModernStateForForgery(statePath) {
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  const plan = JSON.parse(fs.readFileSync(state.paths.plan.path, "utf8"));
  delete plan.router_digest;
  delete plan.baseline_lineage;
  writeJson(state.paths.plan.path, plan);
  state.paths.plan.digest = hashArtifact(state.paths.plan.path);

  const audit = JSON.parse(fs.readFileSync(state.paths.audit.path, "utf8"));
  delete audit.journey_identity;
  delete audit.audit_authority_digest;
  delete audit.baseline_lineage;
  delete audit.creator.participant;
  audit.route.plan_digest = canonicalDigest(plan);
  audit.route.plan_source.digest = state.paths.plan.digest;
  audit.route.plan_source.bytes = fs.lstatSync(state.paths.plan.path).size;
  audit.packets = audit.packets.map((packet) => {
    const legacyPacket = structuredClone(packet);
    delete legacyPacket.run_id;
    delete legacyPacket.journey_identity;
    delete legacyPacket.participant;
    delete legacyPacket.baseline_lineage;
    delete legacyPacket.packet_digest;
    legacyPacket.packet_digest = canonicalDigest(legacyPacket);
    return legacyPacket;
  });
  audit.approval_scope_digest = legacyApprovalScope(audit);
  audit.manifest_digest = canonicalDigest(legacyAuditManifest(audit));
  writeJson(state.paths.audit.path, audit);
  state.paths.audit.digest = hashArtifact(state.paths.audit.path);

  if (state.paths.packets) {
    fs.rmSync(state.paths.packets.path, { recursive: true, force: true });
    delete state.paths.packets;
  }
  for (const stepId of ["dispatch", "execution", "result-ingest", "scanner-triage",
    "conflict-adjudication", "finalize"]) {
    if (!state.steps[stepId]) continue;
    fs.rmSync(state.steps[stepId].receipt_path, { force: true });
    delete state.steps[stepId];
  }
  for (const [stepId, step] of Object.entries(state.steps)) {
    const receipt = JSON.parse(fs.readFileSync(step.receipt_path, "utf8"));
    delete receipt.journey_identity;
    delete receipt.payload.resume_authority_digest;
    delete receipt.payload.baseline_lineage_digest;
    delete receipt.payload.audit_authority_digest;
    if (stepId === "plan") receipt.payload.plan_digest = canonicalDigest(plan);
    if (stepId === "audit-init") {
      receipt.payload.audit_digest = state.paths.audit.digest;
      receipt.payload.audit_manifest_digest = audit.manifest_digest;
    }
    delete receipt.receipt_digest;
    receipt.receipt_digest = canonicalDigest(receipt);
    writeJson(step.receipt_path, receipt);
    state.steps[stepId].receipt_digest = receipt.receipt_digest;
    state.steps[stepId].file_digest = hashArtifact(step.receipt_path);
  }
  delete state.journey_identity;
  delete state.resume_authority_digest;
  delete state.resume_authority_receipt;
  delete state.in_flight;
  delete state.lease_recoveries;
  delete state.identity_migration;
  delete state.baseline_lineage;
  delete state.request.router_digest;
  delete state.request.artifact_digests;
  delete state.request.initial_plan_authority_digest;
  state.attempts = [];
  state.status = "running";
  state.blockers = [];
  state.pending = [];
  delete state.state_digest;
  state.state_digest = canonicalDigest(state);
  writeJson(statePath, state);
  return state;
}

function makeLeaseRecoverable(statePath, operation = "legacy-migration") {
  acquireStateLease({ statePath, operation });
  const leasePath = path.join(`${statePath}.lease`, "lease.json");
  const record = JSON.parse(fs.readFileSync(leasePath, "utf8"));
  record.owner_process_identity.marker = canonicalDigest({
    fixture: "terminated-owner",
    original: record.owner_process_identity.marker
  });
  record.recover_after = new Date(Date.now() - 1_000).toISOString();
  delete record.lease_digest;
  record.lease_digest = canonicalDigest(record);
  writeJson(leasePath, record);
  return inspectAutomationStateLease(statePath);
}

test("packaged hard-linked router remains valid across resume and stale-lease recovery", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-packaged-router-"));
  try {
    const packageRoot = path.join(directory, "content-addressed-package");
    const packagedRouter = path.join(packageRoot, "default-router.json");
    const linkedRouter = path.join(directory, "default-router.json");
    const artifact = path.join(directory, "artifact.html");
    const statePath = path.join(directory, "automation.json");
    fs.mkdirSync(packageRoot, { recursive: true });
    fs.copyFileSync(path.join(root, "router", "default-router.json"), packagedRouter);
    fs.linkSync(packagedRouter, linkedRouter);
    fs.writeFileSync(artifact, "<!doctype html><main>packaged router fixture</main>\n");
    assert.equal(fs.statSync(linkedRouter).nlink, 2);

    const started = runNode(cli, [
      "run", "--router", linkedRouter,
      "--profile", profile, "--root", directory,
      "--surface", "operator-product-ui",
      "--task", "audit", "--direction", "none", "--changes", "source",
      "--artifact", artifact, "--scope", "runtime", "--out", statePath, "--json"
    ], directory);
    assert.equal(started.status, 6, started.stderr || started.stdout);
    let state = JSON.parse(fs.readFileSync(statePath, "utf8"));

    const resumed = runNode(cli, [
      "run", "--resume", statePath,
      "--authority-digest", state.resume_authority_digest,
      "--json"
    ], directory);
    assert.equal(resumed.status, 6, resumed.stderr || resumed.stdout);
    state = JSON.parse(fs.readFileSync(statePath, "utf8"));

    const stale = makeLeaseRecoverable(statePath, "resume");
    const recovered = recoverAutomationStateLease(statePath, {
      ownerToken: stale.owner_token,
      acquiredAt: stale.acquired_at,
      stateDigest: stale.state_digest,
      authorityDigest: state.resume_authority_digest
    });
    assert.equal(recovered.status, "recovered");
    assert.equal(inspectAutomationStateLease(statePath).status, "unlocked");

    state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    const afterRecovery = runNode(cli, [
      "run", "--resume", statePath,
      "--authority-digest", state.resume_authority_digest,
      "--json"
    ], directory);
    assert.equal(afterRecovery.status, 6, afterRecovery.stderr || afterRecovery.stdout);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("verified legacy migration accepts a hard-linked packaged router", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-legacy-packaged-router-"));
  try {
    const { statePath, routerPath } = materializeHistoricalLegacyState(directory);
    fs.linkSync(routerPath, path.join(directory, "content-store-router.json"));
    assert.equal(fs.statSync(routerPath).nlink, 2);
    const backupPath = path.join(directory, "legacy-state.pre-migration.backup.json");
    fs.copyFileSync(statePath, backupPath);
    const migrated = migrateAutomationStateIdentity(statePath, {
      legacyBackupPath: backupPath,
      authorityDigest: hashArtifact(backupPath)
    });
    assert.equal(migrated.journey_identity.invocation, "legacy-migrated");
    assert.equal(readAutomationState(statePath).state_digest, migrated.state_digest);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("pre-identity stale lease recovery verifies backup authority before claiming the lease", () => {
  const missingDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-legacy-recover-missing-"));
  try {
    const { statePath } = materializeHistoricalLegacyState(missingDirectory);
    const stale = makeLeaseRecoverable(statePath);
    assert.throws(() => recoverAutomationStateLease(statePath, {
      ownerToken: stale.owner_token,
      acquiredAt: stale.acquired_at,
      stateDigest: stale.state_digest
    }), /--legacy-backup/);
    const unchanged = inspectAutomationStateLease(statePath);
    assert.equal(unchanged.status, "locked",
      "an authority failure must leave the original stale lease untouched");
    assert.equal(unchanged.lease_digest, stale.lease_digest);
  } finally {
    fs.rmSync(missingDirectory, { recursive: true, force: true });
  }

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-legacy-recover-"));
  try {
    const { statePath } = materializeHistoricalLegacyState(directory);
    const backupBeforeRecovery = path.join(directory, "legacy-before-recovery.json");
    fs.copyFileSync(statePath, backupBeforeRecovery);
    const stale = makeLeaseRecoverable(statePath);
    const recovered = recoverAutomationStateLease(statePath, {
      ownerToken: stale.owner_token,
      acquiredAt: stale.acquired_at,
      stateDigest: stale.state_digest,
      legacyBackupPath: backupBeforeRecovery,
      authorityDigest: hashArtifact(backupBeforeRecovery)
    });
    assert.equal(recovered.status, "recovered");
    assert.equal(inspectAutomationStateLease(statePath).status, "unlocked");
    const recoveredState = JSON.parse(fs.readFileSync(statePath, "utf8"));
    assert.equal(recoveredState.journey_identity, undefined);
    assert.equal(recoveredState.lease_recoveries.length, 1);

    const migrationBackup = path.join(directory, "legacy-after-recovery.json");
    fs.copyFileSync(statePath, migrationBackup);
    const migrated = migrateAutomationStateIdentity(statePath, {
      legacyBackupPath: migrationBackup,
      authorityDigest: hashArtifact(migrationBackup)
    });
    assert.equal(migrated.journey_identity.invocation, "legacy-migrated");
    assert.deepEqual(
      JSON.parse(fs.readFileSync(migrated.identity_migration.path, "utf8")).legacy_lease_recoveries,
      [recovered.receipt_digest]
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

for (const phase of ["after-sidecar-staging", "before-state-commit"]) {
  test(`legacy migration ${phase} fault preserves every active source and permits retry`, () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-migration-cow-"));
    try {
      const { statePath } = materializeHistoricalLegacyState(directory);
      const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
      const backupPath = path.join(directory, "legacy-copy-on-write.backup.json");
      fs.copyFileSync(statePath, backupPath);
      const authorityDigest = hashArtifact(backupPath);
      const protectedPaths = [
        statePath,
        state.paths.plan.path,
        state.paths.audit.path,
        ...Object.values(state.steps).map((step) => step.receipt_path)
      ];
      const before = new Map(protectedPaths.map((target) => [target, fs.readFileSync(target)]));
      assert.throws(() => migrateAutomationStateIdentity(statePath, {
        legacyBackupPath: backupPath,
        authorityDigest,
        faultInjector(checkpoint) {
          if (checkpoint === phase) throw new Error(`fixture migration fault: ${phase}`);
        }
      }), new RegExp(`fixture migration fault: ${phase}`));
      for (const [target, bytes] of before) {
        assert.ok(fs.readFileSync(target).equals(bytes),
          `${path.basename(target)} must remain byte-identical after a staged migration fault`);
      }
      assert.equal(inspectAutomationStateLease(statePath).status, "unlocked");
      const retried = migrateAutomationStateIdentity(statePath, {
        legacyBackupPath: backupPath,
        authorityDigest
      });
      assert.equal(retried.journey_identity.invocation, "legacy-migrated");
      assert.notEqual(retried.paths.plan.path, state.paths.plan.path);
      assert.equal(fs.readFileSync(state.paths.plan.path, "utf8"),
        before.get(state.paths.plan.path).toString());
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
}

test("legacy migration rejects a redirected transaction root before any off-tree write", {
  skip: process.platform === "win32"
}, () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-migration-root-"));
  try {
    const { statePath, stateDirectory } = materializeHistoricalLegacyState(directory);
    const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    const backupPath = path.join(directory, "legacy-transaction-root.backup.json");
    fs.copyFileSync(statePath, backupPath);
    const outside = path.join(directory, "outside-migration-transactions");
    fs.mkdirSync(outside);
    fs.symlinkSync(outside, path.join(stateDirectory, "identity-migrations"), "dir");
    const protectedPaths = [
      statePath,
      state.paths.plan.path,
      state.paths.audit.path,
      ...Object.values(state.steps).map((step) => step.receipt_path)
    ];
    const before = new Map(protectedPaths.map((target) => [target, fs.readFileSync(target)]));

    assert.throws(() => migrateAutomationStateIdentity(statePath, {
      legacyBackupPath: backupPath,
      authorityDigest: hashArtifact(backupPath)
    }), /identity migration transaction directory contains a symlink ancestor/);
    assert.deepEqual(fs.readdirSync(outside), [],
      "migration must reject the redirected root before staging any off-tree sidecar");
    for (const [target, bytes] of before) {
      assert.ok(fs.readFileSync(target).equals(bytes),
        `${path.basename(target)} must remain byte-identical after migration preflight rejection`);
    }
    assert.equal(inspectAutomationStateLease(statePath).status, "unlocked");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("verified legacy state migration binds identity and its receipt before resume", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-legacy-state-"));
  try {
    const { statePath, state: legacy } = materializeHistoricalLegacyState(directory);
    assert.equal(legacy.attempts.length, 0);

    const recoveryReceiptPath = path.join(
      legacy.state_directory,
      "receipts",
      "legacy-state-lease-recovery.json"
    );
    const recoveryReceipt = {
      state_lease_recovery_receipt_version: 1,
      status: "recovered",
      run_id: legacy.run_id,
      journey_identity: null,
      resume_authority_digest: null,
      state_path: statePath,
      recovered_at: "2026-08-28T00:00:00.000Z",
      recovered_lease: {
        lease_digest: canonicalDigest({ fixture: "legacy-lease" }),
        owner_token_digest: canonicalDigest({ fixture: "legacy-owner" }),
        owner_pid: 4242,
        owner_process_identity: {
          process_identity_version: 1,
          method: "fixture-start-time",
          marker: canonicalDigest({ fixture: "legacy-process" })
        },
        acquired_at: "2026-08-28T00:00:00.000Z",
        operation: "resume",
        phase: "state-write",
        state_digest: legacy.state_digest,
        recover_after: "2026-08-28T00:00:00.000Z",
        active_packet: null
      },
      abandoned_attempt: null,
      receipt_digest: null
    };
    const recoveryBody = { ...recoveryReceipt };
    delete recoveryBody.receipt_digest;
    recoveryReceipt.receipt_digest = canonicalDigest(recoveryBody);
    writeJson(recoveryReceiptPath, recoveryReceipt);
    legacy.lease_recoveries = [{
      path: recoveryReceiptPath,
      digest: hashArtifact(recoveryReceiptPath),
      receipt_digest: recoveryReceipt.receipt_digest
    }];
    delete legacy.state_digest;
    legacy.state_digest = canonicalDigest(legacy);
    writeJson(statePath, legacy);
    const legacyBackupPath = path.join(directory, "legacy-state.pre-migration.backup.json");
    fs.copyFileSync(statePath, legacyBackupPath);
    const legacyAuthority = hashArtifact(legacyBackupPath);
    const legacyPlanDigest = legacy.paths.plan.digest;

    const missingBackup = runNode(cli, [
      "run", "--resume", statePath, "--migrate-identity", "--json"
    ], directory);
    assert.equal(missingBackup.status, 4, missingBackup.stderr || missingBackup.stdout);
    assert.match(missingBackup.stderr, /--legacy-backup/);

    const missingAuthority = runNode(cli, [
      "run", "--resume", statePath, "--migrate-identity",
      "--legacy-backup", legacyBackupPath, "--json"
    ], directory);
    assert.equal(missingAuthority.status, 4, missingAuthority.stderr || missingAuthority.stdout);
    assert.match(missingAuthority.stderr, /--authority-digest/);

    const wrongAuthority = runNode(cli, [
      "run", "--resume", statePath, "--migrate-identity",
      "--legacy-backup", legacyBackupPath,
      "--authority-digest", `sha256:${"0".repeat(64)}`, "--json"
    ], directory);
    assert.equal(wrongAuthority.status, 4, wrongAuthority.stderr || wrongAuthority.stdout);
    assert.match(wrongAuthority.stderr, /legacy migration authority digest does not match/);

    const recoveryReceiptSource = fs.readFileSync(recoveryReceiptPath, "utf8");
    fs.appendFileSync(recoveryReceiptPath, " ");
    const tamperedMigration = runNode(cli, [
      "run", "--resume", statePath, "--migrate-identity",
      "--legacy-backup", legacyBackupPath,
      "--authority-digest", legacyAuthority, "--json"
    ], directory);
    assert.equal(tamperedMigration.status, 4,
      tamperedMigration.stderr || tamperedMigration.stdout);
    assert.match(tamperedMigration.stderr, /state lease recovery receipt changed/i);
    assert.equal(JSON.parse(fs.readFileSync(statePath, "utf8")).journey_identity, undefined,
      "tampered legacy recovery evidence must block before identity migration");
    fs.writeFileSync(recoveryReceiptPath, recoveryReceiptSource);

    const beforeConflict = hashArtifact(statePath);
    const conflictingLease = acquireStateLease({ statePath, operation: "resume" });
    try {
      assert.throws(() => migrateAutomationStateIdentity(statePath),
        /active automation state lease/);
      assert.equal(hashArtifact(statePath), beforeConflict,
        "a conflicting migration must not rewrite the legacy state");
    } finally {
      releaseStateLease(conflictingLease);
    }
    const migrated = migrateAutomationStateIdentity(statePath, {
      authorityDigest: legacyAuthority,
      legacyBackupPath
    });
    assert.equal(migrated.journey_identity.invocation, "legacy-migrated");
    assert.equal(migrated.journey_identity.run_id, migrated.run_id);
    assert.match(migrated.journey_identity.identity_digest, /^sha256:/);
    assert.ok(migrated.identity_migration);
    const migrationReceipt = JSON.parse(fs.readFileSync(migrated.identity_migration.path, "utf8"));
    assert.equal(migrationReceipt.verified.prior_attempt_count, 0);
    assert.equal(migrationReceipt.previous_state_digest, legacy.state_digest);
    assert.equal(migrationReceipt.legacy_backup.digest, legacyAuthority);
    assert.equal(migrationReceipt.legacy_backup.path, fs.realpathSync.native(legacyBackupPath));
    assert.match(migrationReceipt.legacy_backup.physical_identity_digest, /^sha256:/);
    assert.match(migrated.identity_migration.physical_identity_digest, /^sha256:/);
    assert.equal(migrationReceipt.legacy_backup.source_commit, legacyCapture.source_commit);
    assert.equal(migrationReceipt.verified.source_commit, legacyCapture.source_commit);
    assert.equal(migrationReceipt.verified.previous_plan_digest, legacyPlanDigest);
    assert.equal(migrationReceipt.resume_authority_digest, migrated.resume_authority_digest);
    assert.deepEqual(migrationReceipt.legacy_lease_recoveries,
      [recoveryReceipt.receipt_digest]);
    assert.equal(readAutomationState(statePath).journey_identity.identity_digest,
      migrated.journey_identity.identity_digest);
    const untrustedResume = runNode(cli, [
      "run", "--resume", statePath, "--json"
    ], directory);
    assert.equal(untrustedResume.status, 4, untrustedResume.stderr || untrustedResume.stdout);
    assert.match(untrustedResume.stderr, /requires --authority-digest/);
    const resumed = runNode(cli, [
      "run", "--resume", statePath,
      "--authority-digest", migrated.resume_authority_digest,
      "--json"
    ], directory);
    assert.equal(resumed.status, 6, resumed.stderr || resumed.stdout);

    const retainedStateSource = fs.readFileSync(statePath, "utf8");
    const retainedReceiptSource = fs.readFileSync(migrated.identity_migration.path, "utf8");
    const redirectedBackup = path.join(directory, "redirected-legacy-backup.json");
    fs.copyFileSync(legacyBackupPath, redirectedBackup);
    const redirectedState = JSON.parse(retainedStateSource);
    const redirectedReceipt = JSON.parse(retainedReceiptSource);
    const redirectedAuthority = structuredClone(redirectedState.identity_migration.authority);
    redirectedAuthority.legacy_backup.path = redirectedBackup;
    delete redirectedAuthority.authority_digest;
    redirectedAuthority.authority_digest = canonicalDigest(redirectedAuthority);
    redirectedState.identity_migration.authority = redirectedAuthority;
    const migratedPlan = JSON.parse(fs.readFileSync(redirectedState.paths.plan.path, "utf8"));
    redirectedState.resume_authority_digest = automationResumeAuthorityDigest(
      redirectedState,
      migratedPlan
    );
    redirectedReceipt.legacy_backup = redirectedAuthority.legacy_backup;
    redirectedReceipt.migration_authority = redirectedAuthority;
    redirectedReceipt.resume_authority_digest = redirectedState.resume_authority_digest;
    delete redirectedReceipt.receipt_digest;
    redirectedReceipt.receipt_digest = canonicalDigest(redirectedReceipt);
    writeJson(redirectedState.identity_migration.path, redirectedReceipt);
    redirectedState.identity_migration.digest = hashArtifact(redirectedState.identity_migration.path);
    redirectedState.identity_migration.receipt_digest = redirectedReceipt.receipt_digest;
    delete redirectedState.state_digest;
    redirectedState.state_digest = canonicalDigest(redirectedState);
    writeJson(statePath, redirectedState);
    const redirectedResume = runNode(cli, [
      "run", "--resume", statePath,
      "--authority-digest", migrated.resume_authority_digest,
      "--json"
    ], directory);
    assert.equal(redirectedResume.status, 4,
      redirectedResume.stderr || redirectedResume.stdout);
    assert.match(redirectedResume.stderr, /resume authority digest does not match/);
    fs.writeFileSync(statePath, retainedStateSource);
    fs.writeFileSync(migrated.identity_migration.path, retainedReceiptSource);
    fs.rmSync(redirectedBackup);

    migrationReceipt.verified.router_version = "tampered";
    writeJson(migrated.identity_migration.path, migrationReceipt);
    assert.throws(() => readAutomationState(statePath), /migration receipt|changed outside|digest mismatch/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("a modern state cannot re-sign its invocation as legacy-migrated to bypass authority checks", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-forged-legacy-"));
  try {
    const artifact = path.join(directory, "artifact.html");
    const statePath = path.join(directory, "automation.json");
    fs.writeFileSync(artifact, "<!doctype html><main>modern run</main>\n");
    const started = runNode(cli, [
      "run", "--profile", profile,
      "--surface", "operator-product-ui",
      "--task", "audit", "--direction", "approved", "--changes", "source",
      "--artifact", artifact, "--scope", "mockup", "--out", statePath, "--json"
    ], directory);
    assert.equal(started.status, 6, started.stderr || started.stdout);
    const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    state.journey_identity.invocation = "legacy-migrated";
    delete state.journey_identity.identity_digest;
    state.journey_identity.identity_digest = canonicalDigest(state.journey_identity);
    delete state.state_digest;
    state.state_digest = canonicalDigest(state);
    writeJson(statePath, state);
    assert.throws(
      () => readAutomationState(statePath),
      /legacy-migrated automation (?:requires a verified identity migration receipt|cannot claim a modern start authority receipt)/
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("legacy migration backup, sidecars, and receipt reject same-byte inode replacement", () => {
  for (const targetKind of ["backup", "plan", "audit", "migration-receipt"]) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), `killsloprouter-legacy-physical-${targetKind}-`));
    try {
      const { statePath } = materializeHistoricalLegacyState(directory);
      const backupPath = path.join(directory, "legacy-state.pre-migration.backup.json");
      fs.copyFileSync(statePath, backupPath);
      const migrated = migrateAutomationStateIdentity(statePath, {
        authorityDigest: hashArtifact(backupPath),
        legacyBackupPath: backupPath
      });
      const target = targetKind === "backup"
        ? migrated.identity_migration.authority.legacy_backup.path
        : targetKind === "migration-receipt"
          ? migrated.identity_migration.path
          : migrated.identity_migration.authority.legacy_sources[targetKind].path;
      const before = fs.statSync(target, { bigint: true });
      replaceWithSameBytes(target);
      const after = fs.statSync(target, { bigint: true });
      assert.notEqual(after.ino, before.ino, `${targetKind} fixture must replace the inode`);
      assert.throws(() => readAutomationState(statePath), /physical identity|provenance changed/,
        `${targetKind} same-byte replacement must fail closed`);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }
});

test("legacy migration backup rejects a second hard link without pretending identity recovers", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-legacy-hardlink-"));
  try {
    const { statePath } = materializeHistoricalLegacyState(directory);
    const backupPath = path.join(directory, "legacy-state.pre-migration.backup.json");
    fs.copyFileSync(statePath, backupPath);
    migrateAutomationStateIdentity(statePath, {
      authorityDigest: hashArtifact(backupPath),
      legacyBackupPath: backupPath
    });
    const backupAlias = path.join(directory, "legacy-state.backup-alias.json");
    fs.linkSync(backupPath, backupAlias);
    assert.throws(() => readAutomationState(statePath),
      /legacy backup must remain a single-link regular non-symlink file/);
    fs.rmSync(backupAlias);
    assert.throws(() => readAutomationState(statePath), /physical identity changed/,
      "removing the alias must not silently re-authorize a backup whose inode metadata changed");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("identity migration receipt remains descriptor-pinned during a path swap", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-migration-receipt-swap-"));
  try {
    const { statePath } = materializeHistoricalLegacyState(directory);
    const backupPath = path.join(directory, "legacy-state.pre-migration.backup.json");
    fs.copyFileSync(statePath, backupPath);
    const migrated = migrateAutomationStateIdentity(statePath, {
      authorityDigest: hashArtifact(backupPath),
      legacyBackupPath: backupPath
    });
    const receiptPath = migrated.identity_migration.path;
    const canonicalReceiptPath = fs.realpathSync.native(receiptPath);
    const replacement = `${receiptPath}.replacement`;
    const displaced = `${receiptPath}.displaced`;
    fs.copyFileSync(receiptPath, replacement);
    let swapped = false;
    assert.throws(() => migrateAutomationStateIdentity(statePath, {
      faultInjector(checkpoint, detail) {
        if (swapped || checkpoint !== "after-read-before-path-revalidation") return;
        if (detail.path !== canonicalReceiptPath) return;
        swapped = true;
        fs.renameSync(receiptPath, displaced);
        fs.renameSync(replacement, receiptPath);
      }
    }), /path identity changed while it was being read/);
    assert.equal(swapped, true);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("identity-stripped modern state cannot enter the verified legacy migration path", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-modern-strip-"));
  try {
    const artifact = path.join(directory, "artifact.html");
    const statePath = path.join(directory, "automation.json");
    fs.writeFileSync(artifact, "<!doctype html><main>modern state</main>\n");
    const started = runNode(cli, [
      "run", "--router", path.join(legacyFixtureRoot, "default-router.json"),
      "--profile", profile, "--root", directory,
      "--surface", "operator-product-ui",
      "--task", "audit", "--direction", "none", "--changes", "source",
      "--artifact", artifact, "--scope", "mockup", "--out", statePath, "--json"
    ], directory);
    assert.equal(started.status, 6, started.stderr || started.stdout);
    const state = stripModernStateForForgery(statePath);
    const legacyBackupPath = path.join(directory, "forged-modern.backup.json");
    fs.copyFileSync(statePath, legacyBackupPath);
    const authorityDigest = hashArtifact(legacyBackupPath);
    assert.throws(() => migrateAutomationStateIdentity(statePath, {
      authorityDigest,
      legacyBackupPath
    }), /verified .* capture|provenance does not match/);
    assert.equal(JSON.parse(fs.readFileSync(statePath, "utf8")).state_digest,
      state.state_digest, "failed forged migration must not rewrite the active state");
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

function legacyApprovalScope(run) {
  return canonicalDigest({
    run_id: run.run_id,
    plan_digest: run.route.plan_digest,
    scope: run.scope.kind,
    planning_gate: run.planning_gate,
    visual_intent: run.visual_intent || null,
    visual_intent_sources: run.visual_intent_sources.map((source) => source.digest),
    visual_signature: run.visual_signature || null,
    visual_signature_sources: run.visual_signature_sources.map((source) => source.digest),
    baseline_observation: run.baseline_observation || null,
    creator: run.creator,
    artifacts: Object.fromEntries(run.artifacts.map((item) => [item.path, item.digest])),
    packets: run.packets.map((packet) => packet.packet_digest)
  });
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
    const planPath = path.join(directory, "route-plan.json");
    writeJson(planPath, plan);
    const current = initializeAudit({
      plan,
      planPath,
      artifacts: [artifact],
      scope: "mockup",
      creatorActorId: "creator:legacy-fixture",
      root: directory,
      runId: "legacy-audit-fixture"
    });
    const legacy = structuredClone(current);
    delete legacy.journey_identity;
    delete legacy.audit_authority_digest;
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
    const { statePath, state } = materializeHistoricalLegacyState(directory);
    state.status = "manual_pending";
    state.attempts = [{ packet_id: "child", execution_status: "ran" }];
    delete state.state_digest;
    state.state_digest = canonicalDigest(state);
    writeJson(statePath, state);
    const legacyBackupPath = path.join(directory, "legacy-with-child.backup.json");
    fs.copyFileSync(statePath, legacyBackupPath);
    assert.throws(() => migrateAutomationStateIdentity(statePath, {
      authorityDigest: hashArtifact(legacyBackupPath),
      legacyBackupPath
    }), /contains adapter attempts; start a new KillSlopRouter run/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
