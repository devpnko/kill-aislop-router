import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  auditAuthorityDigestForRun,
  dispatchAuditPackets as dispatchAuditPacketsCore,
  finalizeAudit as finalizeAuditCore,
  initializeAudit as initializeAuditCore,
  recordAuditResult as recordAuditResultCore,
  recordTriage as recordTriageCore,
  verifyAuditJourneyIdentity
} from "../src/audit.mjs";
import { planRoute, readJson } from "../src/router.mjs";
import { canonicalDigest, hashArtifact, snapshotArtifact } from "../src/integrity.mjs";
import {
  createBoundEvidenceSnapshotter,
  executeAuditPacket,
  inspectPacketAdapter,
  loadHostManifest
} from "../src/execution.mjs";
import { sealedEntrypointGraphDigest } from "../src/sealed-entrypoint.mjs";

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

let auditPlanSequence = 0;

function initializeAudit(options) {
  let planPath = options.planPath || null;
  if (!planPath) {
    planPath = path.join(
      options.root || process.cwd(),
      `route-plan-${++auditPlanSequence}.json`
    );
    writeJson(planPath, options.plan);
  }
  return initializeAuditCore({ ...options, planPath });
}

function dispatchAuditPackets(run, outDir, options = {}) {
  return dispatchAuditPacketsCore(run, outDir, {
    authorityDigest: run.audit_authority_digest,
    ...options
  });
}

function recordAuditResult(run, input, sourcePath, options = {}) {
  return recordAuditResultCore(run, input, sourcePath, {
    authorityDigest: run.audit_authority_digest,
    ...options
  });
}

function recordTriage(run, input, sourcePath, options = {}) {
  return recordTriageCore(run, input, sourcePath, {
    authorityDigest: run.audit_authority_digest,
    ...options
  });
}

function finalizeAudit(run, options = {}) {
  return finalizeAuditCore(run, {
    authorityDigest: run.audit_authority_digest,
    ...options
  });
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
  if (Object.hasOwn(run, "baseline_lineage")) manifest.baseline_lineage = run.baseline_lineage;
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

function materializeExampleVisualIntent(selectedProfile) {
  const materialized = structuredClone(selectedProfile);
  for (const contract of Object.values(materialized.visual_intents || {})) {
    if (contract.authority_receipt && !path.isAbsolute(contract.authority_receipt)) {
      contract.authority_receipt = path.resolve(path.dirname(profilePath), contract.authority_receipt);
    }
  }
  for (const contract of Object.values(materialized.visual_signatures || {})) {
    if (contract.authority_receipt && !path.isAbsolute(contract.authority_receipt)) {
      contract.authority_receipt = path.resolve(path.dirname(profilePath), contract.authority_receipt);
    }
  }
  return materialized;
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

function createPhysicalAuthorityFixture({ artifactCount = 1 } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-physical-authority-"));
  fs.cpSync(
    path.join(root, "examples", "planning-evidence"),
    path.join(directory, "planning-evidence"),
    { recursive: true }
  );
  const routedProfilePath = path.join(directory, "profile.json");
  writeJson(routedProfilePath, profile);
  const artifacts = Array.from({ length: artifactCount }, (_, index) => {
    const target = path.join(directory, `artifact-${index + 1}.html`);
    fs.writeFileSync(target, `<!doctype html><main>artifact ${index + 1}</main>\n`);
    return target;
  });
  const plan = planRoute({
    router,
    profile,
    routerPath,
    profilePath: routedProfilePath,
    input: {
      surface: "operator-product-ui",
      task: "redesign",
      direction: "approved",
      changes: ["source", "copy", "layout", "interaction"],
      risk: "standard"
    },
    artifacts,
    root: directory
  });
  assert.equal(plan.status, "planned");
  const planPath = path.join(directory, "route-plan.json");
  writeJson(planPath, plan);
  const run = initializeAudit({
    plan,
    planPath,
    artifacts,
    scope: "mockup",
    creatorActorId: "creator-physical-authority",
    root: directory,
    runId: `physical-authority-${path.basename(directory)}`,
    now: startedAt
  });
  const packet = run.packets.find((candidate) => candidate.provider.id === "project-contract");
  const adapterEntrypoint = path.join(directory, "host-adapter.mjs");
  fs.copyFileSync(path.join(root, "test", "fixtures", "host-adapter.mjs"), adapterEntrypoint);
  const hostPath = path.join(directory, "host.json");
  writeJson(hostPath, {
    host_adapter_version: 1,
    allowed_providers: [packet.provider.id],
    granted_permissions: ["artifact:read"],
    providers: {
      [packet.provider.id]: {
        adapter: "agent-json-v1",
        entrypoint: adapterEntrypoint,
        entrypoint_digest: hashArtifact(adapterEntrypoint),
        capabilities: packet.assigned_capabilities,
        strength: packet.minimum_strength,
        permissions: ["artifact:read"],
        settings: { write_started_marker: true }
      }
    }
  });
  return {
    directory,
    artifacts,
    planPath,
    routedProfilePath,
    run,
    packet,
    adapterEntrypoint,
    manifest: loadHostManifest(hostPath)
  };
}

function makeResult(packet, fixture, overrides = {}) {
  const evidence = packet.stage_id === "browser-evidence" ? [
    {
      path: path.basename(fixture.screenshot),
      kind: "screenshot",
      covers: packet.assigned_capabilities,
      viewports: ["desktop"],
      checks: [],
      scenarios: packet.evidence_contract.required_scenarios
    },
    {
      path: path.basename(fixture.mobileScreenshot),
      kind: "screenshot",
      covers: packet.assigned_capabilities,
      viewports: ["mobile"],
      checks: [],
      scenarios: packet.evidence_contract.required_scenarios
    },
    {
      path: path.basename(fixture.report),
      kind: "test-report",
      covers: packet.assigned_capabilities,
      viewports: packet.evidence_contract.required_viewports,
      checks: packet.evidence_contract.required_checks,
      scenarios: packet.evidence_contract.required_scenarios
    }
  ] : [];
  return {
    audit_result_version: 1,
    run_id: fixture.run.run_id,
    packet_id: packet.packet_id,
    packet_digest: packet.packet_digest,
    journey_identity: fixture.run.journey_identity,
    provider_id: packet.provider.id,
    participant: packet.participant,
    ...(fixture.run.baseline_lineage
      ? { baseline_lineage_digest: fixture.run.baseline_lineage.lineage_digest }
      : {}),
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

test("KillSlopRouter parent aliases cannot become audit creator, reviewer, or owner identities", () => {
  const fixture = createFixture();
  try {
    for (const actorId of [
      "kill-slop-router", "KillSlopRouter", "killsloprouter:kill-slop-router",
      "킬슬롭라우터", "킬 슬롭 라우터"
    ]) {
      assert.throws(() => initializeAuditCore({
        plan: fixture.plan,
        planPath: fixture.planFile,
        artifacts: [fixture.artifact],
        scope: "mockup",
        creatorActorId: actorId,
        root: fixture.directory,
        runId: `reserved-creator-${actorId}`,
        now: startedAt
      }), /cannot use the KillSlopRouter parent identity/);
    }

    const packet = fixture.run.packets[0];
    for (const actorId of ["KillSlopRouter", " killsloprouter ", "킬 슬롭 라우터"]) {
      const result = makeResult(packet, fixture, {
        reviewer: { actor_id: actorId, kind: packet.provider.kind || "agent" }
      });
      const resultPath = path.join(
        fixture.directory,
        `reserved-reviewer-${actorId.trim().replaceAll(" ", "-")}.json`
      );
      writeJson(resultPath, result);
      assert.throws(() => recordAuditResult(fixture.run, result, resultPath),
        /cannot use the KillSlopRouter parent identity/);
      assert.deepEqual(fixture.run.results, []);
    }

    const validResult = makeResult(packet, fixture);
    const validResultPath = path.join(fixture.directory, "valid-reviewer.json");
    writeJson(validResultPath, validResult);
    const recorded = recordAuditResult(fixture.run, validResult, validResultPath);
    const tampered = structuredClone(recorded);
    tampered.results[0].normalized.reviewer.actor_id = "킬슬롭라우터";
    tampered.results[0].normalized_digest = canonicalDigest(tampered.results[0].normalized);
    assert.throws(() => verifyAuditJourneyIdentity(tampered),
      /recorded result .* cannot use the KillSlopRouter parent identity/);

    const complete = recordAll(fixture);
    const approval = {
      approval_version: 1,
      run_id: complete.run_id,
      journey_identity: complete.journey_identity,
      scope_digest: complete.approval_scope_digest,
      owner_id: "killsloprouter",
      status: "approved",
      note: "Attempt to reuse the router parent as owner.",
      decided_at: finishedAt
    };
    const approvalPath = path.join(fixture.directory, "reserved-owner.json");
    writeJson(approvalPath, approval);
    assert.throws(() => finalizeAudit(complete, { approval, approvalPath }),
      /cannot use the KillSlopRouter parent identity/);
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("automated reviewer parent identity is rejected at result ingestion", () => {
  const fixture = createPhysicalAuthorityFixture();
  try {
    const providerId = fixture.packet.provider.id;
    const raw = JSON.parse(fs.readFileSync(fixture.manifest.manifest_path, "utf8"));
    raw.providers[providerId].settings.reviewer_actor_id = "KillSlopRouter";
    writeJson(fixture.manifest.manifest_path, raw);
    const outputDirectory = path.join(fixture.directory, "reserved-actor-output");
    const executed = executeAuditPacket({
      run: fixture.run,
      packet: fixture.packet,
      manifest: loadHostManifest(fixture.manifest.manifest_path),
      attempt: 1,
      outputDirectory,
      outputGrantRoot: fixture.directory
    });
    assert.equal(executed.execution_status, "ran", executed.error);
    const resultPath = path.join(fixture.directory, "reserved-actor-result.json");
    writeJson(resultPath, executed.result);
    assert.throws(() => recordAuditResult(fixture.run, executed.result, resultPath),
      /cannot use the KillSlopRouter parent identity/);
    assert.deepEqual(fixture.run.results, []);
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("direct execution creates a fresh nested output tree without an explicit grant root", () => {
  const fixture = createPhysicalAuthorityFixture();
  try {
    const outputDirectory = path.join(
      fixture.directory,
      "fresh-output",
      "nested",
      "attempt-1"
    );
    assert.equal(fs.existsSync(path.dirname(outputDirectory)), false);
    const executed = executeAuditPacket({
      run: fixture.run,
      packet: fixture.packet,
      manifest: fixture.manifest,
      outputDirectory
    });
    assert.equal(executed.execution_status, "ran", executed.error);
    assert.equal(fs.existsSync(path.join(outputDirectory, "started.marker")), true);
    assert.equal(executed.evidence_boundary.lexical_path, outputDirectory);
    assert.equal(executed.evidence_boundary.grant.lexical_path, fixture.directory);
    assert.match(executed.evidence_boundary.device, /^(0|[1-9][0-9]*)$/);
    assert.match(executed.evidence_boundary.inode, /^(0|[1-9][0-9]*)$/);
    assert.match(executed.evidence_boundary.grant.device, /^(0|[1-9][0-9]*)$/);
    assert.match(executed.evidence_boundary.grant.inode, /^(0|[1-9][0-9]*)$/);
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("in-memory host manifest authority forgery fails before inspection or child spawn", () => {
  const fixture = createPhysicalAuthorityFixture();
  try {
    const providerId = fixture.packet.provider.id;
    const variants = [
      ["provider declaration", (manifest) => {
        manifest.providers[providerId].adapter = "skill-json-v1";
      }],
      ["entrypoint path", (manifest) => {
        manifest.providers[providerId].entrypoint = `${fixture.adapterEntrypoint}.forged`;
      }],
      ["entrypoint authority", (manifest) => {
        manifest.providers[providerId].entrypoint_authority.digest =
          `sha256:${"0".repeat(64)}`;
      }],
      ["capability", (manifest) => {
        manifest.providers[providerId].capabilities.push("forged-capability");
      }],
      ["permission", (manifest) => {
        manifest.providers[providerId].permissions.push("network:external");
      }],
      ["settings", (manifest) => {
        manifest.providers[providerId].settings.in_memory_only = true;
      }]
    ];
    const assertBlocked = (operation, label) => assert.throws(operation, (error) => {
      assert.equal(error.exitCode, 4, label);
      assert.match(error.message,
        /host adapter manifest normalized authority was mutated in memory/,
        label);
      return true;
    });

    for (const [label, mutate] of variants) {
      const forged = loadHostManifest(fixture.manifest.manifest_path);
      mutate(forged);
      assertBlocked(() => inspectPacketAdapter(fixture.packet, forged),
        `${label} must fail at inspection`);

      const outputDirectory = path.join(
        fixture.directory,
        `forged-${label.replaceAll(" ", "-")}`
      );
      assertBlocked(() => executeAuditPacket({
        run: fixture.run,
        packet: fixture.packet,
        manifest: forged,
        outputDirectory,
        outputGrantRoot: fixture.directory
      }), `${label} must fail at execution`);
      assert.equal(fs.existsSync(path.join(outputDirectory, "started.marker")), false,
        `${label} must be rejected before the reviewer child starts`);
    }
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("one manifest load shares exact sealed calculations without provider authority aliases", () => {
  const fixture = createPhysicalAuthorityFixture();
  try {
    const entrypoint = path.join(fixture.directory, "shared-adapter.mjs");
    const dependency = path.join(fixture.directory, "shared-helper.mjs");
    fs.writeFileSync(dependency, "export default 'shared-authority';\n");
    fs.writeFileSync(entrypoint,
      "import value from './shared-helper.mjs'; process.stdout.write(value);\n");
    const graphDigest = sealedEntrypointGraphDigest(entrypoint);
    const declaration = {
      adapter: "agent-json-v1",
      entrypoint,
      entrypoint_digest: hashArtifact(entrypoint),
      entrypoint_graph_digest: graphDigest,
      capabilities: fixture.packet.assigned_capabilities,
      strength: fixture.packet.minimum_strength,
      permissions: ["artifact:read"],
      settings: {}
    };
    const secondaryProvider = "shared-secondary-reviewer";
    const hostPath = path.join(fixture.directory, "shared-host.json");
    const raw = {
      host_adapter_version: 1,
      allowed_providers: [fixture.packet.provider.id, secondaryProvider],
      granted_permissions: ["artifact:read"],
      providers: {
        [fixture.packet.provider.id]: structuredClone(declaration),
        [secondaryProvider]: structuredClone(declaration)
      }
    };
    writeJson(hostPath, raw);
    const loaded = loadHostManifest(hostPath);
    const primaryAuthority =
      loaded.providers[fixture.packet.provider.id].entrypoint_authority;
    const secondaryAuthority =
      loaded.providers[secondaryProvider].entrypoint_authority;
    assert.deepEqual(primaryAuthority, secondaryAuthority);
    assert.notStrictEqual(primaryAuthority, secondaryAuthority);
    assert.notStrictEqual(primaryAuthority.module_graph, secondaryAuthority.module_graph);
    assert.notStrictEqual(
      primaryAuthority.module_graph.modules[0],
      secondaryAuthority.module_graph.modules[0]
    );
    const secondaryDigest = secondaryAuthority.module_graph.modules[0].digest;
    primaryAuthority.module_graph.modules[0].digest = `sha256:${"0".repeat(64)}`;
    assert.equal(secondaryAuthority.module_graph.modules[0].digest, secondaryDigest,
      "provider authority clones must not share mutable nested graph objects");

    raw.providers[secondaryProvider].entrypoint_digest = `sha256:${"0".repeat(64)}`;
    writeJson(hostPath, raw);
    assert.throws(() => loadHostManifest(hostPath),
      /shared-secondary-reviewer entrypoint digest mismatch/,
      "a different expected digest must not reuse another provider's cached authority");
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("shared per-load authority still rejects entrypoint and nested dependency tamper", () => {
  const fixture = createPhysicalAuthorityFixture();
  try {
    const entrypoint = path.join(fixture.directory, "shared-tamper-adapter.mjs");
    const dependency = path.join(fixture.directory, "shared-tamper-helper.mjs");
    const entrypointSource =
      "import value from './shared-tamper-helper.mjs'; process.stdout.write(value);\n";
    const dependencySource = "export default 'shared-authority';\n";
    fs.writeFileSync(dependency, dependencySource);
    fs.writeFileSync(entrypoint, entrypointSource);
    const declaration = {
      adapter: "agent-json-v1",
      entrypoint,
      entrypoint_digest: hashArtifact(entrypoint),
      entrypoint_graph_digest: sealedEntrypointGraphDigest(entrypoint),
      capabilities: fixture.packet.assigned_capabilities,
      strength: fixture.packet.minimum_strength,
      permissions: ["artifact:read"],
      settings: {}
    };
    const secondaryProvider = "shared-tamper-secondary";
    const hostPath = path.join(fixture.directory, "shared-tamper-host.json");
    writeJson(hostPath, {
      host_adapter_version: 1,
      allowed_providers: [fixture.packet.provider.id, secondaryProvider],
      granted_permissions: ["artifact:read"],
      providers: {
        [fixture.packet.provider.id]: structuredClone(declaration),
        [secondaryProvider]: structuredClone(declaration)
      }
    });

    let loaded = loadHostManifest(hostPath);
    fs.appendFileSync(entrypoint, "// entrypoint tamper\n");
    assert.throws(() => inspectPacketAdapter(fixture.packet, loaded),
      /entrypoint digest mismatch/);

    fs.writeFileSync(entrypoint, entrypointSource);
    loaded = loadHostManifest(hostPath);
    fs.appendFileSync(dependency, "export const tampered = true;\n");
    assert.throws(() => inspectPacketAdapter(fixture.packet, loaded),
      /module graph digest mismatch/);
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("evidence output replacement between child return and audit ingestion fails closed", () => {
  const fixture = createFixture();
  try {
    const packet = fixture.run.packets.find((candidate) => candidate.stage_id === "browser-evidence");
    const adapterEntrypoint = path.join(root, "test", "fixtures", "host-adapter.mjs");
    const hostPath = path.join(fixture.directory, "ingest-race-host.json");
    writeJson(hostPath, {
      host_adapter_version: 1,
      allowed_providers: [packet.provider.id],
      granted_permissions: ["artifact:read", "evidence:write", "browser:control"],
      providers: {
        [packet.provider.id]: {
          adapter: "browser-json-v1",
          entrypoint: adapterEntrypoint,
          entrypoint_digest: hashArtifact(adapterEntrypoint),
          capabilities: packet.assigned_capabilities,
          strength: packet.minimum_strength,
          permissions: ["artifact:read", "evidence:write", "browser:control"],
          settings: {}
        }
      }
    });
    const outputDirectory = path.join(fixture.directory, "ingest-race-evidence");
    const executed = executeAuditPacket({
      run: fixture.run,
      packet,
      manifest: loadHostManifest(hostPath),
      attempt: 1,
      outputDirectory,
      outputGrantRoot: fixture.directory
    });
    assert.equal(executed.execution_status, "ran", executed.error);
    const resultPath = path.join(fixture.directory, "ingest-race-result.json");
    writeJson(resultPath, executed.result);
    fs.renameSync(outputDirectory, `${outputDirectory}.detached`);
    fs.mkdirSync(outputDirectory);
    for (const item of executed.result.evidence) {
      fs.writeFileSync(item.path, "substituted after child exit\n");
    }
    assert.throws(() => recordAuditResult(
      fixture.run,
      executed.result,
      resultPath,
      { evidenceSnapshotter: createBoundEvidenceSnapshotter(executed.evidence_boundary) }
    ), /output directory changed|output root changed/);
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("route plan hash and parse remain descriptor-bound immediately before child spawn", () => {
  const fixture = createFixture();
  try {
    const packet = fixture.run.packets.find((candidate) =>
      candidate.provider.id === "project-contract");
    const adapterEntrypoint = path.join(root, "test", "fixtures", "host-adapter.mjs");
    const hostPath = path.join(fixture.directory, "plan-swap-host.json");
    writeJson(hostPath, {
      host_adapter_version: 1,
      allowed_providers: [packet.provider.id],
      granted_permissions: ["artifact:read"],
      providers: {
        [packet.provider.id]: {
          adapter: "agent-json-v1",
          entrypoint: adapterEntrypoint,
          entrypoint_digest: hashArtifact(adapterEntrypoint),
          capabilities: packet.assigned_capabilities,
          strength: packet.minimum_strength,
          permissions: ["artifact:read"],
          settings: { write_started_marker: true }
        }
      }
    });
    const planPath = fixture.run.route.plan_source.resolved_path;
    const canonicalPlanPath = fs.realpathSync.native(planPath);
    const replacement = `${planPath}.replacement`;
    const displaced = `${planPath}.displaced`;
    fs.copyFileSync(planPath, replacement);
    let swapped = false;
    const outputDirectory = path.join(fixture.directory, "plan-swap-output");
    const executed = executeAuditPacket({
      run: fixture.run,
      packet,
      manifest: loadHostManifest(hostPath),
      attempt: 1,
      outputDirectory,
      outputGrantRoot: fixture.directory,
      authorityFaultInjector(checkpoint, detail) {
        if (swapped || checkpoint !== "after-read-before-path-revalidation") return;
        if (detail.path !== canonicalPlanPath) return;
        swapped = true;
        fs.renameSync(planPath, displaced);
        fs.renameSync(replacement, planPath);
      }
    });
    assert.equal(swapped, true);
    assert.equal(executed.execution_status, "blocked_execution_error");
    assert.match(executed.error, /path identity changed while it was being read/);
    assert.equal(fs.existsSync(path.join(outputDirectory, "started.marker")), false,
      "a path-swapped plan must be rejected before the reviewer child starts");
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});

for (const [label, selectTarget] of [
  ["route plan", (fixture) => fixture.run.route.plan_source.resolved_path],
  ["project profile", (fixture) => fixture.run.route.profile_source.resolved_path],
  ["visual authority", (fixture) => fixture.run.visual_intent_sources[0].resolved_path],
  ["artifact", (fixture) => fixture.run.artifacts[0].resolved_path]
]) {
  test(`same-byte ${label} inode replacement fails at the final child boundary`, () => {
    const fixture = createPhysicalAuthorityFixture();
    try {
      const target = selectTarget(fixture);
      const replacement = `${target}.same-bytes`;
      const displaced = `${target}.displaced`;
      fs.copyFileSync(target, replacement);
      let swapped = false;
      const outputDirectory = path.join(fixture.directory, `${label.replaceAll(" ", "-")}-output`);
      const executed = executeAuditPacket({
        run: fixture.run,
        packet: fixture.packet,
        manifest: fixture.manifest,
        outputDirectory,
        outputGrantRoot: fixture.directory,
        authorityFaultInjector(checkpoint) {
          if (swapped || checkpoint !==
            "after-audit-authority-preflight-before-final-confirmation") return;
          swapped = true;
          fs.renameSync(target, displaced);
          fs.renameSync(replacement, target);
        }
      });
      assert.equal(swapped, true);
      assert.equal(executed.execution_status, "blocked_execution_error");
      assert.match(executed.error, /physical.identity|path identity changed/i);
      assert.equal(executed.child_pid, null);
      assert.equal(fs.existsSync(path.join(outputDirectory, "started.marker")), false,
        `same-byte ${label} replacement must block before reviewer spawn`);
    } finally {
      fs.rmSync(fixture.directory, { recursive: true, force: true });
    }
  });
}

test("an earlier artifact cannot change while a later artifact is being verified", () => {
  const fixture = createPhysicalAuthorityFixture({ artifactCount: 2 });
  try {
    const [first, second] = fixture.artifacts;
    const replacement = `${first}.same-bytes`;
    const displaced = `${first}.displaced`;
    fs.copyFileSync(first, replacement);
    const canonicalSecond = fs.realpathSync.native(second);
    let swapped = false;
    const outputDirectory = path.join(fixture.directory, "sequential-artifact-output");
    const executed = executeAuditPacket({
      run: fixture.run,
      packet: fixture.packet,
      manifest: fixture.manifest,
      outputDirectory,
      outputGrantRoot: fixture.directory,
      authorityFaultInjector(checkpoint, detail) {
        if (swapped || checkpoint !== "after-read-before-path-revalidation") return;
        if (detail.path !== canonicalSecond) return;
        swapped = true;
        fs.renameSync(first, displaced);
        fs.renameSync(replacement, first);
      }
    });
    assert.equal(swapped, true);
    assert.equal(executed.execution_status, "blocked_execution_error");
    assert.match(executed.error, /audit artifact.*physical.identity/i);
    assert.equal(executed.child_pid, null);
    assert.equal(fs.existsSync(path.join(outputDirectory, "started.marker")), false,
      "sequential authority validation must not leave an earlier artifact mutable");
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("a digest-verified adapter entrypoint replacement never executes replacement code", () => {
  const fixture = createPhysicalAuthorityFixture();
  try {
    const replacement = `${fixture.adapterEntrypoint}.same-bytes`;
    const displaced = `${fixture.adapterEntrypoint}.displaced`;
    fs.copyFileSync(fixture.adapterEntrypoint, replacement);
    let swapped = false;
    const outputDirectory = path.join(fixture.directory, "entrypoint-replacement-output");
    const executed = executeAuditPacket({
      run: fixture.run,
      packet: fixture.packet,
      manifest: fixture.manifest,
      outputDirectory,
      outputGrantRoot: fixture.directory,
      authorityFaultInjector(checkpoint) {
        if (swapped || checkpoint !==
          "after-child-authority-preflight-before-final-confirmation") return;
        swapped = true;
        fs.renameSync(fixture.adapterEntrypoint, displaced);
        fs.renameSync(replacement, fixture.adapterEntrypoint);
      }
    });
    assert.equal(swapped, true);
    assert.equal(executed.execution_status, "blocked_execution_error");
    assert.match(executed.error, /entrypoint.*(?:physical|changed|digest)/i);
    assert.equal(executed.child_pid, null);
    assert.equal(fs.existsSync(path.join(outputDirectory, "started.marker")), false,
      "a replaced entrypoint must never reach child execution");
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("audit packets produce a complete critic-pass receipt and explicit owner approval", () => {
  const fixture = createFixture();
  try {
    const dispatchDirectory = path.join(fixture.directory, "packets");
    const dispatch = dispatchAuditPackets(fixture.run, dispatchDirectory);
    assert.equal(dispatch.packets.length, fixture.run.packets.length);
    assert.equal(fs.existsSync(dispatch.approval_template), true);
    const intentPacket = fixture.run.packets.find((packet) => packet.stage_id === "visual-intent-review");
    assert.ok(intentPacket);
    assert.equal(intentPacket.reviewer_independence_required, true);
    assert.equal(intentPacket.visual_intent_contract.authority_status, "verified");
    assert.equal(intentPacket.visual_intent_contract.editorial_treatment, "forbidden");
    assert.match(intentPacket.visual_intent_contract.contract_digest, /^sha256:[a-f0-9]{64}$/);
    assert.ok(fixture.run.packets.every((packet) =>
      packet.visual_intent_contract.contract_digest === intentPacket.visual_intent_contract.contract_digest
    ));
    assert.equal(intentPacket.visual_signature_contract.authority_status, "verified");
    assert.equal(intentPacket.visual_signature_contract.palette.primary[0].value, "#175CD3");
    assert.equal(intentPacket.visual_signature_contract.palette.primary[0].token, "--color-brand-600");
    assert.equal(intentPacket.visual_signature_contract.density.mode, "compact");
    assert.equal(intentPacket.visual_signature_contract.authority.coverage.length, 9);
    assert.ok(intentPacket.visual_signature_contract.sources.every((source) => !("path" in source)));
    assert.ok(fixture.run.packets.every((packet) =>
      packet.visual_signature_contract.contract_digest ===
        intentPacket.visual_signature_contract.contract_digest
    ));

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
      journey_identity: run.journey_identity,
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
    assert.equal(
      approved.route.plan_source.resolved_path,
      path.resolve(run.route.plan_source.resolved_path)
    );
    assert.equal(
      hashArtifact(approved.route.plan_source.resolved_path),
      approved.route.plan_source.digest
    );
    assert.equal(Object.hasOwn(approved, "baseline_lineage"), false);
    assert.equal(approved.boundaries.includes("latest-version-never-promotes-a-parent-baseline"), false);
    assert.equal(approved.boundaries.includes("slice-candidates-inherit-a-digest-bound-parent-baseline"), false);
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("audit packet dispatch rejects a symlink ancestor before any redirected write", {
  skip: process.platform === "win32"
}, () => {
  const fixture = createFixture();
  try {
    const redirected = path.join(fixture.directory, "redirected-audit-packets");
    const alias = path.join(fixture.directory, "audit-packets-alias");
    fs.mkdirSync(redirected);
    fs.symlinkSync(redirected, alias, "dir");

    assert.throws(
      () => dispatchAuditPacketsCore(
        fixture.run,
        path.join(alias, "packets"),
        { authorityDigest: fixture.run.audit_authority_digest }
      ),
      /audit packet output directory contains a symlink ancestor/
    );
    assert.deepEqual(
      fs.readdirSync(redirected),
      [],
      "dispatch must not create a directory or packet through a redirected ancestor"
    );
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("source-less public audits cannot initialize, spawn a child, or finalize after coordinated re-signing", () => {
  const fixture = createFixture();
  try {
    assert.throws(() => initializeAuditCore({
      plan: fixture.plan,
      artifacts: [fixture.artifact],
      scope: "mockup",
      creatorActorId: "creator-agent-1",
      root: fixture.directory
    }), /persisted canonical route plan source/);

    const downgraded = structuredClone(fixture.run);
    downgraded.route.plan_source = null;
    downgraded.owner_approval_required = false;
    const removed = downgraded.packets.find((packet) => packet.required);
    downgraded.packets = downgraded.packets.filter((packet) =>
      packet.packet_id !== removed.packet_id);
    downgraded.stages = downgraded.stages.filter((stage) => stage.id !== removed.stage_id);
    downgraded.approval_scope_digest = approvalScopeForTest(downgraded);
    downgraded.manifest_digest = canonicalDigest(auditManifestForTest(downgraded));

    const packet = downgraded.packets.find((candidate) => candidate.provider.id !== "kill-ai-slop");
    const adapterEntrypoint = path.join(root, "test", "fixtures", "host-adapter.mjs");
    const hostPath = path.join(fixture.directory, "source-less-host.json");
    writeJson(hostPath, {
      host_adapter_version: 1,
      allowed_providers: [packet.provider.id],
      granted_permissions: ["artifact:read"],
      providers: {
        [packet.provider.id]: {
          adapter: "agent-json-v1",
          entrypoint: adapterEntrypoint,
          entrypoint_digest: hashArtifact(adapterEntrypoint),
          capabilities: packet.assigned_capabilities,
          strength: packet.minimum_strength,
          permissions: ["artifact:read"],
          settings: { write_started_marker: true }
        }
      }
    });
    const outputDirectory = path.join(fixture.directory, "source-less-child");
    const executed = executeAuditPacket({
      run: downgraded,
      packet,
      manifest: loadHostManifest(hostPath),
      outputDirectory
    });
    assert.equal(executed.execution_status, "blocked_execution_error");
    assert.match(executed.error, /digest-bound canonical route plan source/);
    assert.equal(fs.existsSync(path.join(outputDirectory, "started.marker")), false);

    assert.throws(
      () => finalizeAudit(downgraded, { now: finishedAt }),
      /audit authority no longer binds|digest-bound canonical route plan source/
    );
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("audit initialization binds plan and profile provenance to the descriptor that was parsed", () => {
  for (const authority of ["plan", "profile"]) {
    const fixture = createPhysicalAuthorityFixture();
    try {
      const target = authority === "plan" ? fixture.planPath : fixture.routedProfilePath;
      const checkpoint = authority === "plan"
        ? "after-route-plan-pin-before-authority-bind"
        : "after-profile-pin-before-authority-bind";
      const retained = `${target}.retained`;
      let replaced = false;
      assert.throws(() => initializeAudit({
        plan: JSON.parse(fs.readFileSync(fixture.planPath, "utf8")),
        planPath: fixture.planPath,
        artifacts: fixture.artifacts,
        scope: "mockup",
        creatorActorId: "creator-same-byte-replacement",
        root: fixture.directory,
        runId: `same-byte-${authority}-replacement`,
        now: startedAt,
        authorityFaultInjector(observed) {
          if (observed !== checkpoint || replaced) return;
          replaced = true;
          fs.renameSync(target, retained);
          fs.copyFileSync(retained, target);
        }
      }), /physical identity|physical-identity/);
      assert.equal(replaced, true, `${authority} replacement checkpoint must execute`);
      assert.equal(
        hashArtifact(target),
        hashArtifact(retained),
        "same-byte replacement must preserve content while changing authority identity"
      );
    } finally {
      fs.rmSync(fixture.directory, { recursive: true, force: true });
    }
  }
});

test("planning-gated mockup audits require an unchanged G6 receipt", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-planning-test-"));
  try {
    const artifact = path.join(directory, "fixture.html");
    fs.writeFileSync(artifact, "<!doctype html><main>fixture</main>\n");
    fs.copyFileSync(
      path.join(root, "examples", "service-planning-gate.example.json"),
      path.join(directory, "planning.json")
    );
    fs.cpSync(
      path.join(root, "examples", "planning-evidence"),
      path.join(directory, "planning-evidence"),
      { recursive: true }
    );
    const guardedProfile = materializeExampleVisualIntent(profile);
    guardedProfile.planning.required = true;
    guardedProfile.planning.surface_receipts["operator-product-ui"] = "planning.json";
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
      },
      artifacts: [artifact],
      root: directory
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

test("parent and slice lineage is preserved through packets and exact owner approval", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-lineage-audit-"));
  try {
    const parent = path.join(directory, "parent-v2.2.39.html");
    const candidate = path.join(directory, "policy-v2.2.84.html");
    const screenshot = path.join(directory, "desktop.png");
    const mobileScreenshot = path.join(directory, "mobile.png");
    const report = path.join(directory, "playwright.json");
    const planningPath = path.join(directory, "planning.json");
    fs.writeFileSync(parent, "<!doctype html><main>all-menu parent</main>\n");
    fs.writeFileSync(candidate, "<!doctype html><main>policy slice</main>\n");
    fs.writeFileSync(screenshot, "fake-png-evidence");
    fs.writeFileSync(mobileScreenshot, "fake-mobile-png-evidence");
    fs.writeFileSync(report, "{\"passed\":true}\n");
    writeJson(planningPath, {
      planning_gate_version: 1,
      protocol: { id: "fixture-planning", version: "1", authority: "fixture-owner" },
      project_id: profile.project_id,
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
          version: "2.2.84",
          slice_id: "policy-source-to-setting",
          artifacts: [{ path: path.basename(candidate), digest: hashArtifact(candidate) }]
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
          evidence: [{ kind: "mockup", path: path.basename(candidate), digest: hashArtifact(candidate) }]
        }
      },
      updated_at: startedAt
    });
    const planningReceipt = readJson(planningPath, "lineage planning fixture");
    const candidateScopeApproval = path.join(directory, "candidate-scope-owner-approval.json");
    writeJson(candidateScopeApproval, {
      status: "approved",
      owner_id: "fixture-owner",
      lineage_id: planningReceipt.baseline_lineage.lineage_id,
      baseline_lineage_digest: canonicalDigest(planningReceipt.baseline_lineage),
      decision_scope: "candidate-slice-binding",
      parent_promotion: false,
      candidate: planningReceipt.baseline_lineage.candidate,
      decided_at: startedAt,
      note: "Bind the exact policy candidate as a slice without parent promotion."
    });
    planningReceipt.gates.G7 = {
      status: "approved",
      evidence: [{
        kind: "approved-artifact",
        path: path.basename(candidate),
        digest: hashArtifact(candidate)
      }, {
        kind: "owner-approval",
        path: path.basename(candidateScopeApproval),
        digest: hashArtifact(candidateScopeApproval)
      }]
    };
    writeJson(planningPath, planningReceipt);
    const guardedProfile = materializeExampleVisualIntent(profile);
    guardedProfile.planning = { required: true, receipt: planningPath };
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
      },
      artifacts: [candidate],
      root: directory
    });
    assert.equal(plan.status, "planned");
    assert.equal(plan.baseline_lineage.candidate.version, "2.2.84");
    assert.equal(plan.baseline_lineage.promotion.supersedes_parent, false);
    const planFile = path.join(directory, "route.json");
    writeJson(planFile, plan);
    const run = initializeAudit({
      plan,
      planPath: planFile,
      artifacts: [candidate],
      scope: "mockup",
      root: directory,
      runId: "lineage-audit-run",
      now: startedAt
    });
    const lineageDigest = run.baseline_lineage.lineage_digest;
    assert.ok(run.packets.every((packet) =>
      packet.baseline_lineage.lineage_digest === lineageDigest));

    const ownerGateDowngrade = structuredClone(run);
    ownerGateDowngrade.owner_approval_required = false;
    ownerGateDowngrade.manifest_digest = canonicalDigest({
      attacker_resigned_audit: ownerGateDowngrade
    });
    assert.throws(
      () => verifyAuditJourneyIdentity(ownerGateDowngrade),
      /owner approval requirement conflicts with the digest-bound route plan/
    );

    const reviewerGraphDowngrade = structuredClone(run);
    const removedPacket = reviewerGraphDowngrade.packets.find((packet) => packet.required);
    reviewerGraphDowngrade.packets = reviewerGraphDowngrade.packets.filter((packet) =>
      packet.packet_id !== removedPacket.packet_id);
    reviewerGraphDowngrade.stages = reviewerGraphDowngrade.stages.filter((stage) =>
      stage.id !== removedPacket.stage_id);
    reviewerGraphDowngrade.manifest_digest = canonicalDigest({
      attacker_resigned_audit: reviewerGraphDowngrade
    });
    assert.throws(
      () => verifyAuditJourneyIdentity(reviewerGraphDowngrade),
      /stage enforcement graph|packet enforcement graph/
    );

    const downgraded = structuredClone(run);
    delete downgraded.baseline_lineage;
    delete downgraded.planning_gate.baseline_lineage;
    downgraded.planning_gate.lineage_required = false;
    downgraded.packets = downgraded.packets.map((packet) => {
      const next = structuredClone(packet);
      delete next.baseline_lineage;
      delete next.packet_digest;
      next.packet_digest = canonicalDigest(next);
      return next;
    });
    assert.throws(
      () => verifyAuditJourneyIdentity(downgraded),
      /digest-bound route plan/,
      "a consistently packet-re-signed downgrade must remain anchored to the route plan"
    );

    const executablePacket = run.packets.find((packet) => packet.provider.id === "project-contract");
    const adapterEntrypoint = path.join(root, "test", "fixtures", "host-adapter.mjs");
    const hostPath = path.join(directory, "lineage-host.json");
    writeJson(hostPath, {
      host_adapter_version: 1,
      allowed_providers: [executablePacket.provider.id],
      granted_permissions: ["artifact:read"],
      providers: {
        [executablePacket.provider.id]: {
          adapter: "agent-json-v1",
          entrypoint: adapterEntrypoint,
          entrypoint_digest: hashArtifact(adapterEntrypoint),
          capabilities: executablePacket.assigned_capabilities,
          strength: executablePacket.minimum_strength,
          permissions: ["artifact:read"],
          settings: { write_started_marker: true }
        }
      }
    });
    const lineageAExecution = executeAuditPacket({
      run,
      packet: executablePacket,
      manifest: loadHostManifest(hostPath),
      attempt: 1,
      outputDirectory: path.join(directory, "lineage-a-result")
    });
    assert.equal(lineageAExecution.execution_status, "ran", lineageAExecution.error);

    const parentB = path.join(directory, "parent-v2.2.40.html");
    fs.writeFileSync(parentB, "<!doctype html><main>different parent, same candidate</main>\n");
    const planningB = JSON.parse(fs.readFileSync(planningPath, "utf8"));
    planningB.baseline_lineage.parent_baseline = {
      id: "store-parent-b",
      version: "2.2.40",
      artifacts: [{ path: path.basename(parentB), digest: hashArtifact(parentB) }]
    };
    const candidateScopeApprovalB = path.join(directory, "candidate-scope-owner-approval-b.json");
    writeJson(candidateScopeApprovalB, {
      status: "approved",
      owner_id: "fixture-owner",
      lineage_id: planningB.baseline_lineage.lineage_id,
      baseline_lineage_digest: canonicalDigest(planningB.baseline_lineage),
      decision_scope: "candidate-slice-binding",
      parent_promotion: false,
      candidate: planningB.baseline_lineage.candidate,
      decided_at: startedAt,
      note: "Bind the exact policy candidate to the second parent for replay isolation."
    });
    planningB.gates.G7.evidence = planningB.gates.G7.evidence.map((item) =>
      item.kind === "owner-approval"
        ? {
          kind: "owner-approval",
          path: path.basename(candidateScopeApprovalB),
          digest: hashArtifact(candidateScopeApprovalB)
        }
        : item);
    const planningBPath = path.join(directory, "planning-b.json");
    writeJson(planningBPath, planningB);
    const profileB = materializeExampleVisualIntent(profile);
    profileB.planning = { required: true, receipt: planningBPath };
    const profileBPath = path.join(directory, "profile-b.json");
    writeJson(profileBPath, profileB);
    const planB = planRoute({
      router,
      profile: profileB,
      routerPath,
      profilePath: profileBPath,
      input: plan.input,
      artifacts: [candidate],
      root: directory
    });
    const planBPath = path.join(directory, "route-b.json");
    writeJson(planBPath, planB);
    const runB = initializeAudit({
      plan: planB,
      planPath: planBPath,
      artifacts: [candidate],
      scope: "mockup",
      root: directory,
      runId: "lineage-audit-run-b",
      now: startedAt
    });
    const packetB = runB.packets.find((packet) => packet.provider.id === executablePacket.provider.id);
    const replay = {
      ...lineageAExecution.result,
      run_id: runB.run_id,
      packet_id: packetB.packet_id,
      packet_digest: packetB.packet_digest,
      journey_identity: runB.journey_identity,
      provider_id: packetB.provider.id,
      participant: packetB.participant
    };
    const replayPath = path.join(directory, "cross-parent-replay.json");
    writeJson(replayPath, replay);
    assert.throws(
      () => recordAuditResult(runB, replay, replayPath),
      /baseline_lineage_digest does not match/,
      "same candidate bytes cannot replay a child result under a different parent"
    );

    const downgradedRouteRun = structuredClone(run);
    downgradedRouteRun.route.input.task = "redesign";
    const downgradedOutput = path.join(directory, "downgraded-route-child-output");
    const downgradedExecution = executeAuditPacket({
      run: downgradedRouteRun,
      packet: downgradedRouteRun.packets.find((packet) =>
        packet.packet_id === executablePacket.packet_id),
      manifest: loadHostManifest(hostPath),
      attempt: 1,
      outputDirectory: downgradedOutput
    });
    assert.equal(downgradedExecution.execution_status, "blocked_execution_error");
    assert.match(downgradedExecution.error, /route input conflicts with the digest-bound route plan/);
    assert.equal(fs.existsSync(path.join(downgradedOutput, "started.marker")), false,
      "mutable audit task claims must be rejected before the child spawn boundary");

    const dispatch = dispatchAuditPackets(run, path.join(directory, "packets"));
    const approvalTemplate = JSON.parse(fs.readFileSync(dispatch.approval_template, "utf8"));
    assert.equal(approvalTemplate.baseline_lineage_digest, lineageDigest);

    const completed = recordAll({
      directory,
      screenshot,
      mobileScreenshot,
      report,
      run
    });
    const missingLineageApproval = {
      approval_version: 1,
      run_id: completed.run_id,
      journey_identity: completed.journey_identity,
      scope_digest: completed.approval_scope_digest,
      owner_id: "release-owner-1",
      status: "approved",
      note: "Reviewed the exact policy slice.",
      decided_at: finishedAt
    };
    const approvalPath = path.join(directory, "approval.json");
    writeJson(approvalPath, missingLineageApproval);
    assert.throws(() => finalizeAudit(completed, {
      approval: missingLineageApproval,
      approvalPath,
      now: finishedAt
    }), /approval baseline_lineage_digest does not match/);

    const approval = {
      ...missingLineageApproval,
      baseline_lineage_digest: lineageDigest
    };
    writeJson(approvalPath, approval);
    const approved = finalizeAudit(completed, { approval, approvalPath, now: finishedAt });
    assert.equal(approved.status, "approved");
    assert.equal(approved.baseline_lineage.lineage_digest, lineageDigest);
    assert.equal(approved.owner_approval.baseline_lineage_digest, lineageDigest);
    assert.ok(approved.boundaries.includes("latest-version-never-promotes-a-parent-baseline"));
    assert.ok(approved.boundaries.includes("slice-candidates-inherit-a-digest-bound-parent-baseline"));

    fs.appendFileSync(parent, "<!-- tampered immediately before child spawn -->\n");
    const childOutput = path.join(directory, "blocked-child-output");
    const blockedExecution = executeAuditPacket({
      run,
      packet: executablePacket,
      manifest: loadHostManifest(hostPath),
      attempt: 1,
      outputDirectory: childOutput
    });
    assert.equal(blockedExecution.execution_status, "blocked_execution_error");
    assert.match(blockedExecution.error, /parent_baseline artifact digest changed/);
    assert.equal(fs.existsSync(path.join(childOutput, "started.marker")), false);
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
    const guardedProfile = materializeExampleVisualIntent(profile);
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
      },
      artifacts: [artifact],
      root: directory
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

test("visual-intent authority and its evidence remain integrity-bound through finalization", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-intent-tamper-"));
  try {
    const artifact = path.join(directory, "artifact.html");
    const basis = path.join(directory, "visual-direction.md");
    const authorityPath = path.join(directory, "visual-intent.json");
    const routedProfilePath = path.join(directory, "profile.json");
    fs.writeFileSync(artifact, "<!doctype html><main>operator artifact</main>\n");
    fs.writeFileSync(basis, "Product-native operator UI with retained density and visual energy.\n");
    const intent = {
      mode: "product-native",
      editorial_treatment: "forbidden",
      editorial_scope: [],
      energy: "balanced",
      depth: "layered",
      preserve: ["operator task density", "visual energy", "existing brand character"],
      avoid: ["paper-like neutralization", "universal flattening"]
    };
    writeJson(authorityPath, {
      visual_intent_receipt_version: 1,
      project_id: profile.project_id,
      surface: "operator-product-ui",
      status: "approved",
      intent,
      authority: {
        kind: "project-contract",
        authority_id: "fixture-product-contract",
        basis: "The project contract is the visual-direction authority.",
        decided_at: startedAt
      },
      evidence: [{
        kind: "project-contract",
        path: path.basename(basis),
        digest: hashArtifact(basis)
      }]
    });
    const routedProfile = materializeExampleVisualIntent(profile);
    routedProfile.visual_intents["operator-product-ui"] = {
      visual_intent_version: 1,
      status: "approved",
      ...intent,
      authority_receipt: path.basename(authorityPath),
      authority_digest: hashArtifact(authorityPath)
    };
    writeJson(routedProfilePath, routedProfile);
    const plan = planRoute({
      router,
      profile: routedProfile,
      routerPath,
      profilePath: routedProfilePath,
      input: {
        task: "audit",
        direction: "none",
        changes: ["style", "layout"],
        risk: "standard"
      },
      artifacts: [artifact],
      root: directory
    });
    assert.equal(plan.status, "planned");
    const run = initializeAudit({
      plan,
      artifacts: [artifact],
      scope: "runtime",
      root: directory,
      runId: "visual-intent-tamper-run",
      now: startedAt
    });
    const packet = run.packets.find((candidate) => candidate.provider.id === "project-contract");
    const adapterEntrypoint = path.join(root, "test", "fixtures", "host-adapter.mjs");
    const hostPath = path.join(directory, "visual-authority-host.json");
    writeJson(hostPath, {
      host_adapter_version: 1,
      allowed_providers: [packet.provider.id],
      granted_permissions: ["artifact:read"],
      providers: {
        [packet.provider.id]: {
          adapter: "agent-json-v1",
          entrypoint: adapterEntrypoint,
          entrypoint_digest: hashArtifact(adapterEntrypoint),
          capabilities: packet.assigned_capabilities,
          strength: packet.minimum_strength,
          permissions: ["artifact:read"],
          settings: { write_started_marker: true }
        }
      }
    });
    const manifest = loadHostManifest(hostPath);
    const authorityBytes = fs.readFileSync(authorityPath);
    const profileBytes = fs.readFileSync(routedProfilePath);

    const canonicalAuthorityPath = fs.realpathSync.native(authorityPath);
    const authorityReplacement = `${authorityPath}.replacement`;
    const authorityDisplaced = `${authorityPath}.displaced`;
    fs.copyFileSync(authorityPath, authorityReplacement);
    let authoritySwapped = false;
    const swappedAuthorityOutput = path.join(directory, "swapped-visual-child");
    const swappedAuthority = executeAuditPacket({
      run,
      packet,
      manifest,
      outputDirectory: swappedAuthorityOutput,
      outputGrantRoot: directory,
      authorityFaultInjector(checkpoint, detail) {
        if (authoritySwapped || checkpoint !== "after-read-before-path-revalidation") return;
        if (detail.path !== canonicalAuthorityPath) return;
        authoritySwapped = true;
        fs.renameSync(authorityPath, authorityDisplaced);
        fs.renameSync(authorityReplacement, authorityPath);
      }
    });
    assert.equal(authoritySwapped, true);
    assert.equal(swappedAuthority.execution_status, "blocked_execution_error");
    assert.match(swappedAuthority.error, /path identity changed while it was being read/);
    assert.equal(fs.existsSync(path.join(swappedAuthorityOutput, "started.marker")), false,
      "path-swapped visual authority must block before reviewer spawn");
    fs.rmSync(authorityPath);
    fs.renameSync(authorityDisplaced, authorityPath);

    fs.appendFileSync(authorityPath, "\n");
    const staleVisualOutput = path.join(directory, "stale-visual-child");
    const staleVisual = executeAuditPacket({
      run,
      packet,
      manifest,
      outputDirectory: staleVisualOutput,
      outputGrantRoot: directory
    });
    assert.equal(staleVisual.execution_status, "blocked_execution_error");
    assert.match(staleVisual.error, /visual-intent authority.*changed before child execution/);
    assert.equal(fs.existsSync(path.join(staleVisualOutput, "started.marker")), false,
      "changed visual authority must block before reviewer spawn");

    fs.writeFileSync(authorityPath, authorityBytes);
    fs.appendFileSync(routedProfilePath, "\n");
    const staleProfileOutput = path.join(directory, "stale-profile-child");
    const staleProfile = executeAuditPacket({
      run,
      packet,
      manifest,
      outputDirectory: staleProfileOutput,
      outputGrantRoot: directory
    });
    assert.equal(staleProfile.execution_status, "blocked_execution_error");
    assert.match(staleProfile.error, /routed project profile changed before child execution/);
    assert.equal(fs.existsSync(path.join(staleProfileOutput, "started.marker")), false,
      "changed project profile must block before reviewer spawn");

    fs.writeFileSync(routedProfilePath, profileBytes);
    fs.appendFileSync(authorityPath, "\n");
    fs.appendFileSync(basis, "tampered\n");
    const receipt = finalizeAudit(run, { now: finishedAt });
    assert.equal(receipt.status, "blocked");
    assert.match(receipt.blockers.join("\n"), /integrity failure: visual-intent:authority-receipt/);
    assert.match(receipt.blockers.join("\n"), /integrity failure: visual-intent:authority-evidence:project-contract/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("visual-signature authority and exact style evidence remain integrity-bound", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-signature-tamper-"));
  try {
    const artifact = path.join(directory, "artifact.html");
    const signatureEvidence = path.join(directory, "visual-style-contract.json");
    const ownerEvidence = path.join(directory, "visual-signature-owner-approval.json");
    const signatureReceiptPath = path.join(directory, "visual-signature.json");
    const routedProfilePath = path.join(directory, "profile.json");
    fs.writeFileSync(artifact, "<!doctype html><main>operator artifact</main>\n");
    fs.copyFileSync(
      path.join(root, "examples", "planning-evidence", "visual-style-contract.json"),
      signatureEvidence
    );
    fs.copyFileSync(
      path.join(root, "examples", "planning-evidence", "visual-signature-owner-approval.json"),
      ownerEvidence
    );
    const sourceReceipt = readJson(
      path.join(root, "examples", "planning-evidence", "visual-signature-approval.json"),
      "visual signature receipt"
    );
    sourceReceipt.evidence = sourceReceipt.evidence.map((item) => ({
      ...item,
      path: path.basename(item.path)
    }));
    sourceReceipt.coverage = sourceReceipt.coverage.map((item) => ({
      ...item,
      evidence_paths: item.evidence_paths.map((evidencePath) => path.basename(evidencePath))
    }));
    writeJson(signatureReceiptPath, sourceReceipt);
    const routedProfile = materializeExampleVisualIntent(profile);
    routedProfile.visual_signatures["operator-product-ui"].authority_receipt =
      path.basename(signatureReceiptPath);
    routedProfile.visual_signatures["operator-product-ui"].authority_digest =
      hashArtifact(signatureReceiptPath);
    writeJson(routedProfilePath, routedProfile);
    const plan = planRoute({
      router,
      profile: routedProfile,
      routerPath,
      profilePath: routedProfilePath,
      input: {
        task: "audit",
        direction: "none",
        changes: ["style", "layout"],
        risk: "standard"
      },
      artifacts: [artifact],
      root: directory
    });
    assert.equal(plan.status, "planned");
    assert.equal(plan.visual_signature.palette.primary[0].value, "#175CD3");
    const run = initializeAudit({
      plan,
      artifacts: [artifact],
      scope: "runtime",
      root: directory,
      runId: "visual-signature-tamper-run",
      now: startedAt
    });
    fs.appendFileSync(signatureReceiptPath, "\n");
    fs.appendFileSync(signatureEvidence, "\n");
    const receipt = finalizeAudit(run, { now: finishedAt });
    assert.equal(receipt.status, "blocked");
    assert.match(receipt.blockers.join("\n"), /integrity failure: visual-signature:signature-authority-receipt/);
    assert.match(receipt.blockers.join("\n"), /integrity failure: visual-signature:signature-authority-evidence:design-tokens/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("audit initialization rejects a forged visual-intent plan claim", () => {
  const fixture = createFixture();
  try {
    const forged = structuredClone(fixture.plan);
    forged.visual_intent.energy = "quiet";
    assert.throws(() => initializeAudit({
      plan: forged,
      artifacts: [fixture.artifact],
      scope: "mockup",
      creatorActorId: "creator-agent-1",
      root: fixture.directory
    }), /visual-intent contract does not match the digest-bound project profile/);
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("audit initialization rejects a forged visual-signature plan claim", () => {
  const fixture = createFixture();
  try {
    const forged = structuredClone(fixture.plan);
    forged.visual_signature.palette.primary[0].value = "#F4F5F2";
    assert.throws(() => initializeAudit({
      plan: forged,
      artifacts: [fixture.artifact],
      scope: "mockup",
      creatorActorId: "creator-agent-1",
      root: fixture.directory
    }), /visual-signature contract does not match the digest-bound project profile/);
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("audit initialization cannot bypass the critical scenario inventory with an unscoped plan", () => {
  const fixture = createFixture();
  try {
    const forged = structuredClone(fixture.plan);
    forged.evidence_contract.required_scenarios = [];
    assert.throws(() => initializeAudit({
      plan: forged,
      artifacts: [fixture.artifact],
      scope: "mockup",
      creatorActorId: "creator-agent-1",
      root: fixture.directory
    }), /scoped UI audit requires a non-empty evidence\.required_scenarios inventory/);
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true });
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

test("caller-retained audit authority blocks coordinated creator actor re-signing", () => {
  const fixture = createFixture();
  try {
    const originalAuthority = fixture.run.audit_authority_digest;
    const forged = structuredClone(fixture.run);
    forged.creator.actor_id = "attacker-selected-decoy";
    forged.audit_authority_digest = auditAuthorityDigestForRun(forged);
    forged.approval_scope_digest = approvalScopeForTest(forged);
    forged.manifest_digest = canonicalDigest(auditManifestForTest(forged));
    const packet = forged.packets.find((candidate) => candidate.reviewer_independence_required);
    const result = makeResult(packet, { ...fixture, run: forged }, {
      reviewer: { actor_id: "creator-agent-1", kind: "agent" }
    });
    const resultPath = path.join(fixture.directory, "coordinated-creator-forgery.json");
    writeJson(resultPath, result);

    assert.throws(
      () => dispatchAuditPacketsCore(forged, path.join(fixture.directory, "forged-packets"), {
        authorityDigest: originalAuthority
      }),
      /authority digest does not match the original/
    );
    assert.throws(
      () => recordAuditResultCore(forged, result, resultPath, {
        authorityDigest: originalAuthority
      }),
      /authority digest does not match the original/
    );
    assert.throws(
      () => finalizeAuditCore(forged, { authorityDigest: originalAuthority }),
      /authority digest does not match the original/
    );
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("finalization revalidates accepted reviewer independence after coordinated result re-signing", () => {
  const fixture = createFixture();
  try {
    const packet = fixture.run.packets.find((candidate) => candidate.reviewer_independence_required);
    const sourcePath = path.join(fixture.directory, "accepted-then-resigned.json");
    const input = makeResult(packet, fixture);
    writeJson(sourcePath, input);
    const recorded = recordAuditResult(fixture.run, input, sourcePath);

    const forged = structuredClone(recorded);
    const forgedSource = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
    forgedSource.reviewer.actor_id = fixture.run.creator.actor_id;
    writeJson(sourcePath, forgedSource);
    const resignedSource = snapshotArtifact(sourcePath, { root: fixture.directory });
    forged.results[0].source.digest = resignedSource.digest;
    forged.results[0].source.bytes = resignedSource.bytes;
    forged.results[0].source.physical_identity_digest =
      resignedSource.physical_identity_digest;
    forged.results[0].normalized.reviewer.actor_id = fixture.run.creator.actor_id;
    forged.results[0].normalized_digest = canonicalDigest(forged.results[0].normalized);

    const receipt = finalizeAudit(forged, { now: finishedAt });
    assert.equal(receipt.status, "blocked");
    assert.match(receipt.blockers.join("\n"), /result-authority:.*reviewer cannot be the creator|recorded reviewer became the creator/);
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

test("browser packets require non-screenshot proof for every critical scenario", () => {
  const fixture = createFixture();
  try {
    const packet = fixture.run.packets.find((candidate) => candidate.stage_id === "browser-evidence");
    const result = makeResult(packet, fixture);
    const report = result.evidence.find((item) => item.kind === "test-report");
    report.scenarios = [];
    const resultPath = path.join(fixture.directory, "scenario-report-gap.json");
    writeJson(resultPath, result);
    assert.throws(
      () => recordAuditResult(fixture.run, result, resultPath),
      /scenario lacks non-screenshot proof: root/
    );
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("browser packets require every critical scenario at every required viewport", () => {
  const fixture = createFixture();
  try {
    const packet = fixture.run.packets.find((candidate) => candidate.stage_id === "browser-evidence");
    const result = makeResult(packet, fixture);
    const mobile = result.evidence.find((item) =>
      item.kind === "screenshot" && item.viewports.includes("mobile")
    );
    mobile.scenarios = [];
    const resultPath = path.join(fixture.directory, "scenario-viewport-gap.json");
    writeJson(resultPath, result);
    assert.throws(
      () => recordAuditResult(fixture.run, result, resultPath),
      /missing a screenshot for scenario root at viewport mobile/
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
    assert.throws(
      () => recordTriageCore(run, triage, triagePath),
      /audit triage recording requires the caller-retained audit authority digest/
    );
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
    const routedProfile = materializeExampleVisualIntent(profile);
    writeJson(routedProfilePath, routedProfile);
    const plan = planRoute({
      router,
      profile: routedProfile,
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

    writeJson(routedProfilePath, routedProfile);
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
      journey_identity: run.journey_identity,
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
    const cliRun = JSON.parse(fs.readFileSync(runPath, "utf8"));

    const finalize = spawnSync(process.execPath, [
      cli,
      "audit", "finalize",
      "--run", runPath,
      "--authority-digest", cliRun.audit_authority_digest
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
