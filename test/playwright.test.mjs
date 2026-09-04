import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { auditAuthorityDigestForRun, recordAuditResult } from "../src/audit.mjs";
import { executeAuditPacket, inspectPacketAdapter, loadHostManifest } from "../src/execution.mjs";
import { canonicalDigest, hashArtifact, snapshotArtifact } from "../src/integrity.mjs";
import {
  configurePlaywright,
  createPlaywrightRuntimeSeal,
  MAX_PLAYWRIGHT_BASELINE_BYTES,
  playwrightRuntimeDigest,
  playwrightRuntimePhysicalIdentityDigest,
  playwrightVerificationContractDigest,
  resolvePlaywrightRuntimeRoot
} from "../src/playwright.mjs";
import { createJourneyIdentity, createParticipant } from "../src/identity.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "bin", "killsloprouter.mjs");
const serverEntrypoint = path.join(root, "test", "fixtures", "playwright-site.mjs");
const genericAdapter = path.join(root, "test", "fixtures", "host-adapter.mjs");
const scannerRoot = path.join(root, "test", "fixtures", "kill-ai-slop");
const scannerEntrypoint = path.join(scannerRoot, "skill", "scripts", "scan.mjs");
const router = readJson(path.join(root, "router", "default-router.json"));

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

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function runCli(args, cwd) {
  const commandArgs = [...args];
  const resumeIndex = commandArgs.indexOf("--resume");
  if (resumeIndex >= 0 && !commandArgs.includes("--migrate-identity") &&
    !commandArgs.includes("--authority-digest")) {
    const statePath = path.resolve(cwd, commandArgs[resumeIndex + 1]);
    if (fs.existsSync(statePath)) {
      const state = readJson(statePath);
      if (state.resume_authority_digest) {
        commandArgs.push("--authority-digest", state.resume_authority_digest);
      }
    }
  }
  return spawnSync(process.execPath, [cli, ...commandArgs], {
    cwd,
    encoding: "utf8",
    timeout: 60_000
  });
}

function sealPacket(packet) {
  delete packet.packet_digest;
  packet.packet_digest = canonicalDigest(packet);
  return packet;
}

function bootstrapProject(directory, requiredScenarios = ["root"]) {
  const result = runCli([
    "bootstrap",
    "--root", directory,
    "--project-id", "playwright-fixture",
    "--locale", "en-US",
    "--surface", "operator-product-ui",
    "--json"
  ], directory);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const paths = {
    profile: path.join(directory, ".killsloprouter", "profile.json"),
    host: path.join(directory, ".killsloprouter", "host-adapters.json"),
    scenarios: path.join(directory, ".killsloprouter", "playwright-scenarios.json"),
    baselines: path.join(directory, ".killsloprouter", "playwright-baselines")
  };
  const profile = readJson(paths.profile);
  profile.evidence.required_scenarios = [...requiredScenarios];
  writeJson(paths.profile, profile);
  return paths;
}

function approveFixtureVisualIntent(profilePath, artifactPath) {
  const profile = readJson(profilePath);
  const surface = profile.surface_contract.primary;
  const receiptPath = path.join(path.dirname(profilePath), "visual-intent-approval.json");
  const receipt = {
    visual_intent_receipt_version: 1,
    project_id: profile.project_id,
    surface,
    status: "approved",
    intent: {
      mode: "product-native",
      editorial_treatment: "forbidden",
      editorial_scope: [],
      energy: "balanced",
      depth: "layered",
      preserve: ["fixture interaction hierarchy", "browser state clarity", "visual energy"],
      avoid: ["paper-like neutralization", "universal flattening"]
    },
    authority: {
      kind: "approved-reference",
      authority_id: "playwright-fixture-owner",
      basis: "The fixture tests a product-native interactive surface, not an editorial treatment.",
      decided_at: "2026-08-18T00:00:00.000Z"
    },
    evidence: [{
      kind: "approved-artifact",
      path: path.relative(path.dirname(receiptPath), artifactPath),
      digest: hashArtifact(artifactPath)
    }]
  };
  writeJson(receiptPath, receipt);
  profile.visual_intents[surface] = {
    visual_intent_version: 1,
    status: "approved",
    ...receipt.intent,
    authority_receipt: path.basename(receiptPath),
    authority_digest: hashArtifact(receiptPath)
  };
  writeJson(profilePath, profile);
}

function approveFixtureVisualSignature(profilePath, artifactPath) {
  const profile = readJson(profilePath);
  const surface = profile.surface_contract.primary;
  const receiptPath = path.join(path.dirname(profilePath), "visual-signature-approval.json");
  const signature = {
    palette: {
      primary: [{ value: "#175CD3", usage: "primary actions" }],
      accent: [],
      background: [{ value: "#F8FAFC", usage: "canvas" }],
      surface: [{ value: "#FFFFFF", usage: "panels" }],
      text: [{ value: "#101828", usage: "labels" }],
      semantic: []
    },
    typography: {
      families: [{ family: "Inter", role: "operator interface" }],
      scale: "compact operator hierarchy",
      weights: ["400", "600"],
      treatments: ["tabular numerals"]
    },
    density: { mode: "compact", characteristics: ["same-screen comparison"] },
    shape: { radii: ["4px controls"], geometry: ["rectangular panels"], strokes: ["1px strokes"] },
    elevation: { strategy: "layered", shadows: ["low overlay shadow"], separation: ["surface contrast"] },
    imagery: { strategy: "functional", characteristics: ["state evidence only"] },
    motion: { intensity: "restrained", characteristics: ["state transitions"] },
    style_keywords: ["operational", "high-clarity"],
    forbidden_transformations: ["paper-like neutralization", "global flattening"]
  };
  const relativeArtifact = path.relative(path.dirname(receiptPath), artifactPath);
  const aspects = [
    "palette", "typography", "density", "shape", "elevation", "imagery", "motion",
    "style_keywords", "forbidden_transformations"
  ];
  writeJson(receiptPath, {
    visual_signature_receipt_version: 1,
    project_id: profile.project_id,
    surface,
    status: "approved",
    signature,
    authority: {
      kind: "approved-reference",
      authority_id: "playwright-fixture-owner",
      basis: "The browser fixture binds an exact product-native visual signature.",
      decided_at: "2026-08-18T00:00:00.000Z"
    },
    evidence: [{ kind: "approved-artifact", path: relativeArtifact, digest: hashArtifact(artifactPath) }],
    coverage: aspects.map((aspect) => ({ aspect, evidence_paths: [relativeArtifact] }))
  });
  profile.visual_signatures[surface] = {
    visual_signature_version: 1,
    status: "approved",
    ...signature,
    authority_receipt: path.basename(receiptPath),
    authority_digest: hashArtifact(receiptPath)
  };
  writeJson(profilePath, profile);
}

function startServer(artifactDigests) {
  const child = spawn(process.execPath, [serverEntrypoint], {
    cwd: root,
    env: { PATH: process.env.PATH || "", KSR_TEST_ARTIFACT_DIGESTS: JSON.stringify(artifactDigests) },
    stdio: ["ignore", "pipe", "pipe"]
  });
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => reject(new Error(`fixture server timeout: ${stderr}`)), 10_000);
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      const newline = stdout.indexOf("\n");
      if (newline < 0) return;
      clearTimeout(timeout);
      try {
        resolve({ child, ...JSON.parse(stdout.slice(0, newline)) });
      } catch (error) {
        reject(error);
      }
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code) => {
      if (code !== null && !stdout.includes("\n")) {
        clearTimeout(timeout);
        reject(new Error(`fixture server exited ${code}: ${stderr}`));
      }
    });
  });
}

function makePacket(profile, artifactDigests) {
  const capabilities = [
    "responsive-evidence",
    "keyboard-evidence",
    "state-evidence",
    "overflow-evidence",
    "contrast-evidence",
    "zoom-evidence"
  ];
  const runId = "playwright-real-child-run";
  return sealPacket({
    dispatch_packet_version: 1,
    packet_id: "browser-evidence--browser-evidence--1",
    run_id: runId,
    journey_identity: createJourneyIdentity({ runId, routerVersion: "1.0.0" }),
    participant: createParticipant({ providerId: "browser-evidence", stageId: "browser-evidence" }),
    stage_id: "browser-evidence",
    stage_question: "Do the approved states work in a real browser?",
    required: true,
    provider: {
      id: "browser-evidence",
      kind: "local",
      version: "playwright-core@1.62.1",
      executor: null,
      fallback_for: null,
      resolved_to: "official:playwright-browser-v1"
    },
    minimum_strength: 3,
    reviewer_independence_required: true,
    assigned_capabilities: capabilities,
    artifact_digests: artifactDigests,
    evidence_required: true,
    required_evidence_kinds: ["screenshot", "test-report"],
    evidence_contract: profile.evidence,
    visual_intent_contract: null,
    visual_signature_contract: null,
  });
}

function makeRun(directory, artifact, packet) {
  const sourcePlan = {
    receipt_version: 1,
    router_id: "kill-slop-router",
    router_version: packet.journey_identity.orchestrator_version,
    router_path: path.join(root, "router", "default-router.json"),
    profile_path: null,
    profile_digest: null,
    project_id: "playwright-boundary-fixture",
    status: "planned",
    route_id: "playwright-boundary",
    input: {
      surface: "operator-product-ui",
      task: "audit",
      scope: "runtime"
    },
    surface_resolution: null,
    visual_intent: null,
    visual_signature: null,
    creator: "project-design-system",
    stages: [{
      id: packet.stage_id,
      question: packet.stage_question,
      optional: false,
      required_capabilities: packet.assigned_capabilities,
      evidence_required: packet.evidence_required,
      required_evidence_kinds: packet.required_evidence_kinds,
      minimum_strength: packet.minimum_strength,
      requires_independent_critic: packet.reviewer_independence_required,
      selected_actors: [{
        id: packet.provider.id,
        kind: packet.provider.kind,
        version: packet.provider.version,
        executor: packet.provider.executor,
        fallback_for: packet.provider.fallback_for,
        resolved_to: packet.provider.resolved_to,
        capabilities: packet.assigned_capabilities,
        optional: false
      }]
    }],
    planning_gate: null,
    evidence_contract: packet.evidence_contract,
    adjudication: { hard_blockers: [] },
    invariants: {}
  };
  const planPath = path.join(directory, `plan-${packet.run_id}.json`);
  writeJson(planPath, sourcePlan);
  const planSource = snapshotArtifact(planPath, { root: directory });
  const artifacts = [snapshotArtifact(artifact, { root: directory })];
  const run = {
    audit_run_version: 1,
    run_id: packet.run_id,
    journey_identity: packet.journey_identity,
    status: "collecting",
    root: directory,
    packets: [packet],
    creator: {
      provider_id: "project-design-system",
      actor_id: "creator-agent-1",
      participant: createParticipant({ providerId: "project-design-system", role: "creator" })
    },
    scope: { kind: "runtime", claim: "runtime-artifacts-reviewed" },
    route: {
      router_id: sourcePlan.router_id,
      router_version: sourcePlan.router_version,
      route_id: sourcePlan.route_id,
      project_id: sourcePlan.project_id,
      plan_digest: canonicalDigest(sourcePlan),
      plan_source: planSource,
      profile_source: null,
      surface_resolution: null,
      input: sourcePlan.input
    },
    planning_gate: null,
    visual_intent: null,
    visual_intent_sources: [],
    visual_signature: null,
    visual_signature_sources: [],
    artifacts,
    evidence_contract: packet.evidence_contract,
    baseline_observation: null,
    hard_blockers: [],
    invariants: {},
    owner_approval_required: false,
    stages: [{
      id: packet.stage_id,
      question: packet.stage_question,
      optional: false,
      required_capabilities: packet.assigned_capabilities,
      evidence_required: packet.evidence_required,
      required_evidence_kinds: packet.required_evidence_kinds
    }],
    results: [],
    triage: [],
    approval_scope_digest: canonicalDigest({ fixture: packet.run_id }),
    manifest_digest: canonicalDigest({ fixture: packet.run_id, packet: packet.packet_digest })
  };
  run.audit_authority_digest = auditAuthorityDigestForRun(run);
  return run;
}

function enableFixtureReviewers(hostPath) {
  const host = readJson(hostPath);
  const providerIds = [
    "project-contract",
    "visual-intent-review",
    "kill-ai-slop",
    "anti-slop",
    "hallmark",
    "no-ai-slop",
    "locale-copy-review",
    "browser-evidence",
    "domain-authority-review"
  ];
  const providers = {};
  for (const providerId of providerIds) {
    if (providerId === "browser-evidence") {
      providers[providerId] = host.providers[providerId];
      continue;
    }
    const contract = router.provider_capabilities[providerId];
    if (providerId === "kill-ai-slop") {
      providers[providerId] = {
        adapter: "kill-ai-slop-v1",
        adapter_root: scannerRoot,
        entrypoint_digest: hashArtifact(scannerEntrypoint),
        strength: contract.strength,
        capabilities: contract.capabilities,
        permissions: ["artifact:read"],
        settings: {}
      };
    } else {
      providers[providerId] = {
        adapter: providerId === "anti-slop" ? "skill-json-v1" : "agent-json-v1",
        entrypoint: genericAdapter,
        entrypoint_digest: hashArtifact(genericAdapter),
        strength: contract.strength,
        capabilities: contract.capabilities,
        permissions: ["artifact:read"],
        settings: {}
      };
    }
  }
  host.allowed_providers = providerIds;
  host.granted_permissions = ["artifact:read", "evidence:write", "browser:control"];
  host.providers = providers;
  writeJson(hostPath, host);
}

function writeApproval(statePath, directory) {
  const state = readJson(statePath);
  const audit = readJson(state.paths.audit.path);
  const extension = path.extname(statePath);
  const stateName = path.basename(statePath, extension);
  const approval = path.join(directory, `${stateName}.approval.json`);
  writeJson(approval, {
    approval_version: 1,
    run_id: audit.run_id,
    journey_identity: audit.journey_identity,
    scope_digest: audit.approval_scope_digest,
    owner_id: "playwright-release-owner",
    status: "approved",
    note: "Approved exact Playwright E2E evidence and artifact scope.",
    decided_at: new Date().toISOString()
  });
  return approval;
}

test("browser verification contract is portable while runtime physical identity remains host-local", () => {
  const settings = {
    contract: "killsloprouter-playwright-v1",
    attestation_path: "/.well-known/killsloprouter-artifact.json",
    allowed_origins: [],
    browser_channel: "chromium",
    locale: "ko-KR",
    runtime_digest: `sha256:${"1".repeat(64)}`,
    scenario_digest: `sha256:${"2".repeat(64)}`,
    viewports: { mobile: { width: 390, height: 844 } },
    color_schemes: ["light"],
    max_keyboard_tabs: 200,
    navigation_timeout_ms: 30_000
  };
  const first = playwrightVerificationContractDigest({
    ...settings,
    runtime_physical_identity_digest: `sha256:${"3".repeat(64)}`
  });
  const relocated = playwrightVerificationContractDigest({
    ...settings,
    runtime_physical_identity_digest: `sha256:${"4".repeat(64)}`
  });
  assert.equal(relocated, first,
    "portable profile authority must not bind machine-local inode/mtime state");
  assert.notEqual(playwrightVerificationContractDigest({
    ...settings,
    runtime_digest: `sha256:${"5".repeat(64)}`
  }), first, "reviewed runtime content remains part of the portable contract");
});

test("browser configure creates a digest-locked official adapter and rejects external URLs by default", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-playwright-config-"));
  try {
    const paths = bootstrapProject(directory);
    const artifact = path.join(directory, "artifact.html");
    fs.writeFileSync(artifact, "<!doctype html><p>attestation source</p>\n");
    const attestationPath = path.join(directory, ".killsloprouter", "browser-attestation.json");
    const attested = runCli([
      "browser", "attest",
      "--root", directory,
      "--artifact", artifact,
      "--out", attestationPath,
      "--json"
    ], directory);
    assert.equal(attested.status, 0, attested.stderr || attested.stdout);
    assert.deepEqual(readJson(attestationPath), {
      killsloprouter_browser_attestation_version: 1,
      artifact_digests: { "artifact.html": hashArtifact(artifact) }
    });
    const weakenedProfile = readJson(paths.profile);
    weakenedProfile.evidence = {
      browser: "legacy-smoke-test",
      required_viewports: ["mobile"],
      required_checks: ["keyboard"],
      required_scenarios: []
    };
    writeJson(paths.profile, weakenedProfile);
    const configured = runCli([
      "browser", "configure",
      "--profile", paths.profile,
      "--host-config", paths.host,
      "--base-url", "http://127.0.0.1:4173",
      "--channel", "chrome",
      "--required-scenarios", "root",
      "--json"
    ], directory);
    assert.equal(configured.status, 0, configured.stderr || configured.stdout);
    const receipt = JSON.parse(configured.stdout);
    assert.equal(receipt.status, "configured");
    assert.match(receipt.receipt_digest, /^sha256:[a-f0-9]{64}$/);
    assert.equal(receipt.browser.attestation_path, "/.well-known/killsloprouter-artifact.json");
    assert.deepEqual(receipt.browser.allowed_origins, []);
    assert.deepEqual(receipt.browser.required_scenarios, ["root"]);
    const profile = readJson(paths.profile);
    assert.equal(profile.evidence.browser, "playwright");
    assert.deepEqual(profile.evidence.required_viewports, ["mobile", "tablet", "desktop"]);
    assert.deepEqual(profile.evidence.required_checks, [
      "keyboard", "state", "overflow", "contrast", "zoom-200", "visual-regression",
      "screen-reader", "console", "network"
    ]);
    assert.ok(profile.evidence.required_checks.includes("screen-reader"));
    assert.ok(profile.evidence.required_checks.includes("visual-regression"));
    assert.deepEqual(profile.evidence.required_scenarios, ["root"]);
    const host = loadHostManifest(paths.host);
    const declaration = host.providers["browser-evidence"];
    assert.equal(declaration.settings.contract, "killsloprouter-playwright-v1");
    assert.match(declaration.entrypoint_graph_digest, /^sha256:/);
    assert.equal(receipt.adapter.entrypoint_graph_digest,
      declaration.entrypoint_graph_digest);
    assert.equal(declaration.settings.runtime_digest, playwrightRuntimeDigest(resolvePlaywrightRuntimeRoot()));
    assert.equal(declaration.settings.runtime_physical_identity_digest,
      playwrightRuntimePhysicalIdentityDigest(resolvePlaywrightRuntimeRoot()));
    assert.equal(receipt.adapter.runtime_physical_identity_digest,
      declaration.settings.runtime_physical_identity_digest);
    assert.equal(profile.evidence.scenario_digest, declaration.settings.scenario_digest);
    assert.equal(profile.evidence.browser_contract_digest,
      declaration.official_playwright.verificationContractDigest);
    assert.equal(receipt.browser.verification_contract_digest,
      profile.evidence.browser_contract_digest);
    assert.deepEqual(declaration.permissions, ["artifact:read", "evidence:write", "browser:control"]);
    assert.equal(fs.existsSync(receipt.profile.backup), true);
    assert.equal(fs.existsSync(receipt.host_manifest.backup), true);

    const configuredHost = readJson(paths.host);
    const weakenedHost = structuredClone(configuredHost);
    weakenedHost.providers["browser-evidence"].settings.viewports.mobile.width += 1;
    writeJson(paths.host, weakenedHost);
    const weakenedInspection = inspectPacketAdapter(makePacket(profile, {
      "artifact.html": `sha256:${"a".repeat(64)}`
    }), loadHostManifest(paths.host));
    assert.equal(weakenedInspection.execution_status, "manual_pending");
    assert.match(weakenedInspection.reason, /does not match the profile-bound browser verification contract/);
    writeJson(paths.host, configuredHost);

    const before = [hashArtifact(paths.profile), hashArtifact(paths.host)];
    assert.throws(() => configurePlaywright({
      profilePath: paths.profile,
      hostManifestPath: paths.host,
      baseUrl: "https://example.com",
      browserChannel: "chrome"
    }), /--allow-external/);
    assert.deepEqual([hashArtifact(paths.profile), hashArtifact(paths.host)], before);

    writeJson(paths.scenarios, {
      playwright_scenario_version: 1,
      scenarios: [{
        id: "unreviewed-state",
        path: "/",
        actions: [],
        assertions: [{ type: "visible", locator: "body" }]
      }]
    });
    assert.throws(() => configurePlaywright({
      profilePath: paths.profile,
      hostManifestPath: paths.host,
      baseUrl: "http://127.0.0.1:4173",
      browserChannel: "chrome",
      scenarioPath: paths.scenarios
    }), /required Playwright scenario is missing.*root/);
    assert.deepEqual([hashArtifact(paths.profile), hashArtifact(paths.host)], before);

    writeJson(paths.scenarios, {
      playwright_scenario_version: 1,
      scenarios: [{ id: "root", path: "/", actions: [], assertions: [] }]
    });
    assert.throws(() => configurePlaywright({
      profilePath: paths.profile,
      hostManifestPath: paths.host,
      baseUrl: "http://127.0.0.1:4173",
      browserChannel: "chrome",
      scenarioPath: paths.scenarios
    }), /required Playwright scenario needs at least one state assertion: root/);
    assert.deepEqual([hashArtifact(paths.profile), hashArtifact(paths.host)], before);

    writeJson(paths.scenarios, {
      playwright_scenario_version: 1,
      scenarios: [{ id: "root", path: "/", actions: [{ type: "shell", locator: "body" }] }]
    });
    assert.throws(() => configurePlaywright({
      profilePath: paths.profile,
      hostManifestPath: paths.host,
      baseUrl: "http://127.0.0.1:4173",
      browserChannel: "chrome",
      scenarioPath: paths.scenarios
    }), /unsupported action: shell/);
    assert.deepEqual([hashArtifact(paths.profile), hashArtifact(paths.host)], before);

    writeJson(paths.scenarios, {
      playwright_scenario_version: 1,
      scenarios: [{
        id: "root",
        path: "/",
        actions: [],
        assertions: [{
          type: "computed-style", locator: "body", property: "color;background", value: "red"
        }]
      }]
    });
    assert.throws(() => configurePlaywright({
      profilePath: paths.profile,
      hostManifestPath: paths.host,
      baseUrl: "http://127.0.0.1:4173",
      browserChannel: "chrome",
      scenarioPath: paths.scenarios
    }), /safe CSS property/);
    assert.deepEqual([hashArtifact(paths.profile), hashArtifact(paths.host)], before);

    writeJson(paths.scenarios, {
      playwright_scenario_version: 1,
      scenarios: [{
        id: "root",
        path: "/",
        actions: [],
        assertions: [{ type: "visible", locator: "body" }]
      }]
    });
    const externalReceipt = configurePlaywright({
      profilePath: paths.profile,
      hostManifestPath: paths.host,
      baseUrl: "https://example.com",
      browserChannel: "chrome",
      allowedOrigins: ["https://cdn.example.com"],
      allowExternal: true,
      scenarioPath: paths.scenarios
    });
    assert.equal(externalReceipt.browser.external_network, true);
    assert.deepEqual(externalReceipt.browser.allowed_origins, ["https://cdn.example.com"]);
    const externalHost = loadHostManifest(paths.host);
    assert.ok(externalHost.providers["browser-evidence"].permissions.includes("network:external"));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("Playwright configuration rejects baselines that cannot be handed to the child", () => {
  const cases = [
    {
      label: "unsafe filename",
      prepare(baselines) {
        fs.writeFileSync(path.join(baselines, ".DS_Store"), "finder metadata\n");
      },
      expected: /safe PNG filenames only: \.DS_Store/
    },
    {
      label: "nested directory",
      prepare(baselines) {
        fs.mkdirSync(path.join(baselines, "nested"));
      },
      expected: /flat regular files only: nested/
    },
    {
      label: "oversized baseline set",
      prepare(baselines) {
        const oversized = path.join(baselines, "oversized.png");
        fs.writeFileSync(oversized, "");
        fs.truncateSync(oversized, MAX_PLAYWRIGHT_BASELINE_BYTES + 1);
      },
      expected: /baseline authority exceeds/
    }
  ];

  for (const fixtureCase of cases) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-playwright-baseline-"));
    try {
      const paths = bootstrapProject(directory);
      fs.mkdirSync(paths.baselines, { recursive: true });
      fixtureCase.prepare(paths.baselines);
      const before = [hashArtifact(paths.profile), hashArtifact(paths.host)];
      assert.throws(() => configurePlaywright({
        profilePath: paths.profile,
        hostManifestPath: paths.host,
        baseUrl: "http://127.0.0.1:4173",
        browserChannel: "chrome"
      }), fixtureCase.expected, fixtureCase.label);
      assert.deepEqual(
        [hashArtifact(paths.profile), hashArtifact(paths.host)],
        before,
        `${fixtureCase.label} must fail before profile or host mutation`
      );
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }
});

test("browser attest cannot mutate a directory artifact outside its real ignored boundary", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-playwright-attest-boundary-"));
  try {
    const artifact = path.join(directory, "src");
    fs.mkdirSync(artifact);
    fs.writeFileSync(path.join(artifact, "index.html"), "<!doctype html><p>boundary</p>\n");
    const before = hashArtifact(artifact);
    const rejected = runCli([
      "browser", "attest",
      "--root", directory,
      "--artifact", artifact,
      "--out", path.join(artifact, "attestation.json"),
      "--json"
    ], directory);
    assert.equal(rejected.status, 2, rejected.stderr || rejected.stdout);
    assert.match(rejected.stderr, /must be under \.killsloprouter/);
    assert.equal(fs.existsSync(path.join(artifact, "attestation.json")), false);

    const safeDirectory = path.join(artifact, ".killsloprouter");
    const safeOutput = path.join(safeDirectory, "browser-attestation.json");
    const written = runCli([
      "browser", "attest",
      "--root", directory,
      "--artifact", artifact,
      "--out", safeOutput,
      "--json"
    ], directory);
    assert.equal(written.status, 0, written.stderr || written.stdout);
    assert.equal(hashArtifact(artifact), before);

    fs.rmSync(safeDirectory, { recursive: true, force: true });
    const outside = path.join(directory, "outside");
    fs.mkdirSync(outside);
    fs.symlinkSync(outside, safeDirectory, "dir");
    const symlinked = runCli([
      "browser", "attest",
      "--root", directory,
      "--artifact", artifact,
      "--out", safeOutput,
      "--json"
    ], directory);
    assert.equal(symlinked.status, 4, symlinked.stderr || symlinked.stdout);
    assert.match(symlinked.stderr, /output boundary contains a symlink/);
    assert.deepEqual(fs.readdirSync(outside), []);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("official Playwright runtime, scenario, and baseline tamper fail before child execution", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-playwright-tamper-"));
  try {
    const paths = bootstrapProject(directory);
    configurePlaywright({
      profilePath: paths.profile,
      hostManifestPath: paths.host,
      baseUrl: "http://127.0.0.1:4173",
      browserChannel: "chrome"
    });
    fs.appendFileSync(paths.scenarios, " \n");
    assert.throws(() => loadHostManifest(paths.host), /scenario file digest mismatch/);

    configurePlaywright({
      profilePath: paths.profile,
      hostManifestPath: paths.host,
      baseUrl: "http://127.0.0.1:4173",
      browserChannel: "chrome"
    });
    fs.writeFileSync(path.join(paths.baselines, "unapproved.png"), "unapproved pixels\n");
    assert.throws(() => loadHostManifest(paths.host), /baseline directory digest mismatch/);

    configurePlaywright({
      profilePath: paths.profile,
      hostManifestPath: paths.host,
      baseUrl: "http://127.0.0.1:4173",
      browserChannel: "chrome"
    });
    const host = readJson(paths.host);
    const runtime = path.join(directory, "runtime");
    for (const name of ["axe-core", "playwright-core"]) {
      const target = path.join(runtime, "node_modules", name);
      fs.mkdirSync(target, { recursive: true });
      fs.copyFileSync(path.join(root, "node_modules", name, "package.json"), path.join(target, "package.json"));
    }
    host.providers["browser-evidence"].settings.runtime_root = runtime;
    host.providers["browser-evidence"].settings.runtime_digest = playwrightRuntimeDigest(runtime);
    writeJson(paths.host, host);
    fs.writeFileSync(path.join(runtime, "node_modules", "playwright-core", "tampered.js"), "tamper\n");
    assert.throws(() => loadHostManifest(paths.host),
      /runtime (?:digest mismatch|must use the bundled trusted runtime root)/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("Playwright executes a private package seal and rejects same-byte runtime replacement", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-playwright-runtime-seal-"));
  let seal = null;
  try {
    const runtimeRoot = path.join(directory, "runtime");
    for (const packageName of ["axe-core", "playwright-core"]) {
      fs.cpSync(
        path.join(root, "node_modules", packageName),
        path.join(runtimeRoot, "node_modules", packageName),
        { recursive: true, preserveTimestamps: true }
      );
    }
    let settings = {
      runtime_root: runtimeRoot,
      runtime_digest: playwrightRuntimeDigest(runtimeRoot),
      runtime_physical_identity_digest: playwrightRuntimePhysicalIdentityDigest(runtimeRoot)
    };
    seal = createPlaywrightRuntimeSeal(settings);
    assert.notEqual(seal.runtimeRoot, runtimeRoot);
    assert.equal(playwrightRuntimeDigest(seal.runtimeRoot), settings.runtime_digest);
    assert.equal(playwrightRuntimePhysicalIdentityDigest(seal.runtimeRoot),
      seal.runtimePhysicalIdentityDigest);

    const target = path.join(runtimeRoot, "node_modules", "axe-core", "axe.min.js");
    replaceWithSameBytes(target);
    assert.throws(() => createPlaywrightRuntimeSeal(settings),
      /physical identity mismatch before sealing/);
    assert.equal(playwrightRuntimeDigest(seal.runtimeRoot), settings.runtime_digest,
      "an already sealed runtime must remain content-stable after source replacement");

    settings = {
      ...settings,
      runtime_physical_identity_digest: playwrightRuntimePhysicalIdentityDigest(runtimeRoot)
    };
    let injected = false;
    assert.throws(() => createPlaywrightRuntimeSeal(settings, {
      faultInjector(checkpoint) {
        if (injected || checkpoint !==
          "after-playwright-runtime-copy-before-source-revalidation") return;
        injected = true;
        replaceWithSameBytes(target);
      }
    }), /changed while its private execution seal was being created/);
    assert.equal(injected, true);
  } finally {
    seal?.cleanup();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("Playwright scenario identity and manifest-relative paths remain bound across the child handoff", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-playwright-handoff-"));
  try {
    const paths = bootstrapProject(directory);
    configurePlaywright({
      profilePath: paths.profile,
      hostManifestPath: paths.host,
      baseUrl: "http://127.0.0.1:4173",
      browserChannel: "chrome"
    });
    const artifact = path.join(directory, "artifact.html");
    fs.writeFileSync(artifact, "<!doctype html><main>handoff fixture</main>\n");
    const profile = readJson(paths.profile);
    const packet = makePacket(profile, { "artifact.html": hashArtifact(artifact) });
    const run = makeRun(directory, artifact, packet);
    let manifest = loadHostManifest(paths.host);
    const configuredScenario = manifest.providers["browser-evidence"].settings.scenario_file;
    assert.equal(path.isAbsolute(configuredScenario), true);

    const displaced = `${paths.scenarios}.displaced`;
    const sameBytes = `${paths.scenarios}.same-bytes`;
    fs.copyFileSync(paths.scenarios, sameBytes);
    fs.renameSync(paths.scenarios, displaced);
    fs.symlinkSync(sameBytes, paths.scenarios);
    const symlinkedOutput = path.join(directory, "symlinked-scenario-output");
    assert.throws(() => executeAuditPacket({
      run,
      packet,
      manifest,
      outputDirectory: symlinkedOutput,
      outputGrantRoot: directory
    }), (error) => {
      assert.equal(error.exitCode, 4);
      assert.match(error.message, /Playwright scenario file.*symlink/);
      return true;
    });
    assert.equal(fs.existsSync(symlinkedOutput), false,
      "a substituted scenario path must fail before browser output or child creation");
    fs.rmSync(paths.scenarios);
    fs.renameSync(displaced, paths.scenarios);
    fs.rmSync(sameBytes);
    manifest = loadHostManifest(paths.host);

    const replacement = `${paths.scenarios}.replacement`;
    const original = `${paths.scenarios}.original`;
    fs.copyFileSync(paths.scenarios, replacement);
    const canonicalScenario = fs.realpathSync.native(paths.scenarios);
    let scenarioSwapped = false;
    const swappedResult = executeAuditPacket({
      run,
      packet,
      manifest,
      outputDirectory: path.join(directory, "swapped-scenario-output"),
      outputGrantRoot: directory,
      authorityFaultInjector(checkpoint, detail) {
        if (scenarioSwapped || checkpoint !== "after-read-before-path-revalidation") return;
        if (detail.path !== canonicalScenario) return;
        scenarioSwapped = true;
        fs.renameSync(paths.scenarios, original);
        fs.renameSync(replacement, paths.scenarios);
      }
    });
    assert.equal(scenarioSwapped, true);
    assert.equal(swappedResult.execution_status, "blocked_execution_error");
    assert.match(swappedResult.error, /path identity changed while it was being read/);
    assert.equal(swappedResult.child_pid, null,
      "a scenario inode swap must fail before the browser child starts");
    fs.rmSync(paths.scenarios);
    fs.renameSync(original, paths.scenarios);
    manifest = loadHostManifest(paths.host);

    const racingReplacement = `${paths.scenarios}.racing-replacement`;
    const racingOriginal = `${paths.scenarios}.racing-original`;
    fs.copyFileSync(paths.scenarios, racingReplacement);
    let armed = false;
    const racingResult = executeAuditPacket({
      run,
      packet,
      manifest,
      outputDirectory: path.join(directory, "racing-scenario-output"),
      outputGrantRoot: directory,
      authorityFaultInjector(checkpoint) {
        if (armed || checkpoint !==
          "after-playwright-authority-handoff-before-final-confirmation") return;
        armed = true;
        fs.renameSync(paths.scenarios, racingOriginal);
        fs.symlinkSync(racingReplacement, paths.scenarios);
      }
    });
    assert.equal(armed, true, racingResult.error || JSON.stringify(racingResult));
    assert.equal(fs.lstatSync(paths.scenarios).isSymbolicLink(), true);
    assert.equal(racingResult.execution_status, "blocked_execution_error");
    assert.match(racingResult.error, /scenario.*(?:symlink|path identity changed)/i);
    assert.equal(racingResult.child_pid, null,
      "a delayed scenario replacement must fail before the adapter child starts");
    fs.rmSync(paths.scenarios);
    fs.renameSync(racingOriginal, paths.scenarios);
    fs.rmSync(racingReplacement);

    const relativeHost = readJson(paths.host);
    const hostBase = path.dirname(paths.host);
    for (const key of ["runtime_root", "scenario_file", "baseline_directory"]) {
      relativeHost.providers["browser-evidence"].settings[key] = path.relative(
        hostBase,
        relativeHost.providers["browser-evidence"].settings[key]
      );
    }
    writeJson(paths.host, relativeHost);
    const relativeManifest = loadHostManifest(paths.host);
    const relativeDeclaration = relativeManifest.providers["browser-evidence"];
    assert.equal(path.isAbsolute(relativeDeclaration.settings.runtime_root), true);
    assert.equal(path.isAbsolute(relativeDeclaration.settings.scenario_file), true);
    assert.equal(path.isAbsolute(relativeDeclaration.settings.baseline_directory), true);
    const relativeResult = executeAuditPacket({
      run,
      packet,
      manifest: relativeManifest,
      outputDirectory: path.join(directory, "relative-scenario-output"),
      outputGrantRoot: directory
    });
    assert.notEqual(relativeResult.execution_status, "manual_pending");
    assert.doesNotMatch(relativeResult.error || "", /ENOENT.*playwright-scenarios/i,
      "the child must receive the manifest-resolved scenario path");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

for (const authorityKind of ["scenario-file", "baseline-directory"]) {
  test(`Playwright ${authorityKind} same-content replacement fails before browser spawn`, () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-playwright-physical-"));
    try {
      const paths = bootstrapProject(directory);
      configurePlaywright({
        profilePath: paths.profile,
        hostManifestPath: paths.host,
        baseUrl: "http://127.0.0.1:4173",
        browserChannel: "chrome"
      });
      const artifact = path.join(directory, "artifact.html");
      fs.writeFileSync(artifact, "<!doctype html><main>physical authority fixture</main>\n");
      const profile = readJson(paths.profile);
      const packet = makePacket(profile, { "artifact.html": hashArtifact(artifact) });
      const run = makeRun(directory, artifact, packet);
      const manifest = loadHostManifest(paths.host);
      const target = authorityKind === "scenario-file" ? paths.scenarios : paths.baselines;
      const replacement = `${target}.same-content`;
      const displaced = `${target}.displaced`;
      if (authorityKind === "scenario-file") fs.copyFileSync(target, replacement);
      else fs.cpSync(target, replacement, { recursive: true });
      let swapped = false;
      const executed = executeAuditPacket({
        run,
        packet,
        manifest,
        outputDirectory: path.join(directory, `${authorityKind}-output`),
        outputGrantRoot: directory,
        authorityFaultInjector(checkpoint) {
          if (swapped || checkpoint !==
            "after-playwright-authority-handoff-before-final-confirmation") return;
          swapped = true;
          fs.renameSync(target, displaced);
          fs.renameSync(replacement, target);
        }
      });
      assert.equal(swapped, true);
      assert.equal(executed.execution_status, "blocked_execution_error");
      assert.match(executed.error, /Playwright.*physical identity changed/i);
      assert.equal(executed.child_pid, null,
        `same-content ${authorityKind} replacement must block before browser spawn`);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
}

test("official Playwright adapter verifies a digest-bound static design prototype", {
  timeout: 60_000
}, () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-playwright-design-"));
  try {
    const paths = bootstrapProject(directory);
    configurePlaywright({
      profilePath: paths.profile,
      hostManifestPath: paths.host,
      baseUrl: "http://127.0.0.1:4173",
      browserChannel: process.env.KSR_PLAYWRIGHT_CHANNEL || "chrome"
    });
    const prototype = path.join(directory, "candidate.html");
    fs.writeFileSync(prototype, `<!doctype html>
<html lang="en-US"><head><meta charset="utf-8"><title>Design candidate</title>
<style>body{margin:0;color:#0f172a;background:#fff;font:16px sans-serif}main{padding:24px}button{color:#fff;background:#1d4ed8;border:2px solid #1d4ed8;padding:12px}</style></head>
<body><main data-killsloprouter-locale="en-US">
<p data-killsloprouter-locale="ko-KR">검토 대기</p>
<section data-killsloprouter-state="default"><button type="button">Review exception</button></section>
<section data-killsloprouter-state="error" role="alert">A recoverable error</section>
</main></body></html>\n`);
    const capabilities = [
      "responsive-evidence", "keyboard-evidence", "state-evidence", "overflow-evidence",
      "contrast-evidence", "zoom-evidence"
    ];
    const packet = {
      design_packet_version: 1,
      packet_id: "browser-design-fixture",
      run_id: "official-design-browser-run",
      journey_identity: createJourneyIdentity({
        runId: "official-design-browser-run", routerVersion: "1.0.0"
      }),
      participant: createParticipant({
        providerId: "browser-evidence",
        stageId: "browser-evidence",
        designTaskKind: "browser-evidence"
      }),
      stage_id: "browser-evidence",
      provider: { id: "browser-evidence", kind: "local", version: "playwright-core@1.62.1" },
      assigned_capabilities: capabilities,
      minimum_strength: 3,
      required_permissions: ["artifact:read", "evidence:write", "browser:control"],
      evidence_contract: {
        required_viewports: ["mobile", "desktop"],
        required_checks: ["keyboard", "state", "overflow", "contrast", "zoom-200"]
      },
      design_task: {
        kind: "browser-evidence",
        subject_kind: "direction-candidate",
        subject_id: "signal-desk--refine",
        subject_result_digest: `sha256:${"2".repeat(64)}`,
        prototype_paths: [prototype],
        prototypes: [{ path: prototype, digest: hashArtifact(prototype) }],
        locales: ["en-US", "ko-KR"],
        required_states: ["default", "error"]
      },
      packet_digest: `sha256:${"1".repeat(64)}`
    };
    sealPacket(packet);
    const manifest = loadHostManifest(paths.host);
    const unsupportedPacket = structuredClone(packet);
    unsupportedPacket.evidence_contract.required_checks.push("screen-reader", "visual-regression");
    sealPacket(unsupportedPacket);
    const unsupported = inspectPacketAdapter(unsupportedPacket, manifest);
    assert.equal(unsupported.execution_status, "manual_pending");
    assert.match(unsupported.reason, /screen-reader, visual-regression/);
    assert.equal(inspectPacketAdapter(packet, manifest).execution_status, "ready");
    const run = {
      run_id: packet.run_id,
      journey_identity: packet.journey_identity,
      packets: [packet],
      creator: { provider_id: "design-direction-agent", actor_id: "creator:direction" },
      scope: { kind: "design-exploration" },
      artifacts: [snapshotArtifact(prototype, { root: directory })],
      results: []
    };
    const result = executeAuditPacket({
      run,
      packet,
      manifest,
      attempt: 1,
      outputDirectory: path.join(directory, "design-evidence")
    });
    assert.equal(result.execution_status, "ran", result.error);
    assert.notEqual(result.child_pid, process.pid);
    assert.equal(result.result.kind, "browser-evidence");
    assert.equal(result.result.browser_engine, "playwright");
    assert.ok(Object.values(result.result.checks).every(Boolean));
    assert.deepEqual(new Set(result.result.locales_tested), new Set(["en-US", "ko-KR"]));
    assert.deepEqual(new Set(result.result.states_tested), new Set(["default", "error"]));
    assert.deepEqual(
      new Set(result.result.evidence.filter((item) => item.kind === "screenshot").map((item) => item.viewport)),
      new Set(["mobile", "desktop"])
    );

    fs.writeFileSync(prototype, `<!doctype html>
<html lang="en-US"><head><meta charset="utf-8"><title>Layout defect</title>
<style>body{margin:0;color:#0f172a;background:#fff;font:16px sans-serif}main{padding:24px}button{color:#fff;background:#1d4ed8;border:2px solid #1d4ed8;padding:12px}.collision{display:grid;grid-template-columns:100px 100px}.collision span:first-child{width:150px}h2{width:100px;white-space:nowrap;overflow:hidden}</style></head>
<body><main data-killsloprouter-locale="en-US"><p data-killsloprouter-locale="ko-KR">검토 대기</p>
<section data-killsloprouter-state="default"><button type="button">Review exception</button><h2>Required unclipped heading</h2><div class="collision"><span>First</span><span>Second</span></div></section>
<section data-killsloprouter-state="error" role="alert">A recoverable error</section>
</main></body></html>\n`);
    const layoutPacket = structuredClone(packet);
    layoutPacket.packet_id = "browser-design-layout-defect";
    layoutPacket.run_id = "official-design-browser-layout-run";
    layoutPacket.journey_identity = createJourneyIdentity({
      runId: layoutPacket.run_id, routerVersion: "1.0.0"
    });
    layoutPacket.packet_digest = `sha256:${"4".repeat(64)}`;
    layoutPacket.design_task.prototypes[0].digest = hashArtifact(prototype);
    sealPacket(layoutPacket);
    const layoutBlocked = executeAuditPacket({
      run: {
        ...run,
        run_id: layoutPacket.run_id,
        journey_identity: layoutPacket.journey_identity,
        packets: [layoutPacket],
        artifacts: [snapshotArtifact(prototype, { root: directory })]
      },
      packet: layoutPacket,
      manifest,
      attempt: 1,
      outputDirectory: path.join(directory, "layout-blocked-design-evidence")
    });
    assert.equal(layoutBlocked.execution_status, "ran", layoutBlocked.error);
    assert.equal(layoutBlocked.result.checks.overflow, false);
    assert.equal(layoutBlocked.result.checks["zoom-200"], false);
    const layoutBlockedReport = readJson(
      layoutBlocked.result.evidence.find((item) => item.kind === "test-report").path
    );
    assert.ok(layoutBlockedReport.executions.every((execution) => execution.overflow.overlaps.length > 0));
    assert.ok(layoutBlockedReport.executions.every((execution) => execution.overflow.clipped_text.length > 0));

    fs.writeFileSync(path.join(directory, "unbound.css"), "body { background: hotpink; }\n");
    fs.writeFileSync(prototype, `<!doctype html>
<html lang="en-US"><head><meta charset="utf-8"><title>Unbound resource</title>
<link rel="stylesheet" href="./unbound.css">
<style>body{margin:0;color:#0f172a;background:#fff;font:16px sans-serif}main{padding:24px}button{color:#fff;background:#1d4ed8;border:2px solid #1d4ed8;padding:12px}</style></head>
<body><main data-killsloprouter-locale="en-US">
<p data-killsloprouter-locale="ko-KR">검토 대기</p>
<section data-killsloprouter-state="default"><button type="button">Review exception</button></section>
<section data-killsloprouter-state="error" role="alert">A recoverable error</section>
</main></body></html>\n`);
    const blockedPacket = structuredClone(packet);
    blockedPacket.packet_id = "browser-design-unbound-resource";
    blockedPacket.run_id = "official-design-browser-block-run";
    blockedPacket.journey_identity = createJourneyIdentity({
      runId: blockedPacket.run_id, routerVersion: "1.0.0"
    });
    blockedPacket.packet_digest = `sha256:${"3".repeat(64)}`;
    blockedPacket.evidence_contract.required_checks.push("network");
    blockedPacket.design_task.prototypes[0].digest = hashArtifact(prototype);
    sealPacket(blockedPacket);
    const blocked = executeAuditPacket({
      run: {
        ...run,
        run_id: blockedPacket.run_id,
        journey_identity: blockedPacket.journey_identity,
        packets: [blockedPacket],
        artifacts: [snapshotArtifact(prototype, { root: directory })]
      },
      packet: blockedPacket,
      manifest,
      attempt: 1,
      outputDirectory: path.join(directory, "blocked-design-evidence")
    });
    assert.equal(blocked.execution_status, "ran", blocked.error);
    assert.equal(blocked.result.checks.network, false);
    const blockedReportPath = blocked.result.evidence.find((item) => item.kind === "test-report").path;
    const blockedReport = readJson(blockedReportPath);
    assert.ok(blockedReport.executions.every((execution) =>
      execution.blocked_requests.some((item) => item.url.endsWith("/unbound.css"))));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("served artifact attestation mismatch fails closed across the child boundary", {
  timeout: 30_000
}, async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-playwright-attestation-"));
  let server = null;
  try {
    const artifact = path.join(directory, "artifact.html");
    fs.writeFileSync(artifact, "<!doctype html><p>attested artifact</p>\n");
    const snapshot = snapshotArtifact(artifact, { root: directory });
    const expectedDigests = { [snapshot.path]: snapshot.digest };
    server = await startServer({ [snapshot.path]: "sha256:0000000000000000000000000000000000000000000000000000000000000000" });
    const paths = bootstrapProject(directory);
    configurePlaywright({
      profilePath: paths.profile,
      hostManifestPath: paths.host,
      baseUrl: server.url,
      browserChannel: process.env.KSR_PLAYWRIGHT_CHANNEL || "chrome"
    });
    const profile = readJson(paths.profile);
    const manifest = loadHostManifest(paths.host);
    const packet = makePacket(profile, expectedDigests);
    const result = executeAuditPacket({
      run: makeRun(directory, artifact, packet),
      packet,
      manifest,
      attempt: 1,
      outputDirectory: path.join(directory, "evidence")
    });
    assert.equal(result.execution_status, "blocked_execution_error");
    assert.equal(result.exit_code, 4);
    assert.match(result.error, /served artifact attestation does not match/);
  } finally {
    if (server?.child && !server.child.killed) server.child.kill("SIGTERM");
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("official Playwright adapter crosses a real child boundary, blocks layout defects, and passes after digest-locked retry", {
  timeout: 150_000
}, async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-playwright-e2e-"));
  let server = null;
  try {
    const artifact = path.join(directory, "artifact.html");
    fs.writeFileSync(artifact, "<!doctype html><p>artifact source for attestation</p>\n");
    const snapshot = snapshotArtifact(artifact, { root: directory });
    const artifactDigests = { [snapshot.path]: snapshot.digest };
    server = await startServer(artifactDigests);
    const paths = bootstrapProject(directory, ["details-open"]);
    writeJson(paths.scenarios, {
      playwright_scenario_version: 1,
      scenarios: [{
        id: "details-open",
        path: "/",
        actions: [{ type: "click", locator: "#toggle" }],
        assertions: [
          { type: "visible", locator: "#details" },
          { type: "text", locator: "#details", value: "Verified state" },
          { type: "no-overlap", locator: "#details > *" },
          { type: "no-clipping", locator: "#toggle, #details-heading" },
          { type: "count", locator: ".window-label", value: 1 },
          { type: "computed-style", locator: ".sponsor-slot", property: "border-top-style", value: "dashed" },
          { type: "computed-style", locator: ".sponsor-slot", property: "border-top-width", value: "2px" },
          { type: "computed-style", locator: ".sponsor-slot", property: "background-color", value: "rgb(255, 255, 255)" }
        ]
      }]
    });
    configurePlaywright({
      profilePath: paths.profile,
      hostManifestPath: paths.host,
      baseUrl: server.url,
      browserChannel: process.env.KSR_PLAYWRIGHT_CHANNEL || "chrome",
      scenarioPath: paths.scenarios,
      baselineDirectory: paths.baselines
    });
    let profile = readJson(paths.profile);
    let manifest = loadHostManifest(paths.host);
    let packet = makePacket(profile, artifactDigests);
    let run = makeRun(directory, artifact, packet);
    assert.equal(inspectPacketAdapter(packet, manifest).execution_status, "ready");

    const firstOutput = path.join(directory, "evidence-attempt-1");
    const first = executeAuditPacket({ run, packet, manifest, attempt: 1, outputDirectory: firstOutput });
    assert.equal(first.execution_status, "ran", first.error);
    assert.notEqual(first.child_pid, process.pid);
    assert.equal(first.result.verdict, "block");
    assert.match(first.result.findings.map((item) => item.category).join("\n"), /visual-regression/);
    assert.equal(first.result.findings.some((item) => item.category === "keyboard"), false);
    assert.ok(first.result.evidence.some((item) => item.kind === "test-report"));
    assert.ok(first.result.evidence.some((item) => item.kind === "trace"));
    assert.deepEqual(
      new Set(first.result.evidence.filter((item) => item.kind === "screenshot").flatMap((item) => item.viewports)),
      new Set(["mobile", "tablet", "desktop"])
    );
    const firstResultPath = path.join(firstOutput, "adapter-result.json");
    writeJson(firstResultPath, first.result);
    run = recordAuditResult(run, first.result, firstResultPath, {
      authorityDigest: run.audit_authority_digest
    });
    assert.equal(run.results[0].normalized.verdict, "block");

    for (const item of first.result.evidence.filter((entry) => entry.kind === "screenshot")) {
      fs.copyFileSync(item.path, path.join(paths.baselines, path.basename(item.path)));
    }
    configurePlaywright({
      profilePath: paths.profile,
      hostManifestPath: paths.host,
      baseUrl: server.url,
      browserChannel: process.env.KSR_PLAYWRIGHT_CHANNEL || "chrome",
      scenarioPath: paths.scenarios,
      baselineDirectory: paths.baselines
    });
    profile = readJson(paths.profile);
    manifest = loadHostManifest(paths.host);
    const secondOutput = path.join(directory, "evidence-attempt-2");
    const second = executeAuditPacket({ run, packet, manifest, attempt: 2, outputDirectory: secondOutput });
    assert.equal(second.execution_status, "ran", second.error);
    assert.equal(second.result.verdict, "pass_with_findings");
    const report = readJson(path.join(secondOutput, "browser-report.json"));
    assert.equal(report.status, "passed");
    assert.deepEqual(report.required_scenarios, ["details-open"]);
    assert.equal(report.artifact_attestation.artifact_digests[snapshot.path], snapshot.digest);
    assert.ok(report.executions.every((entry) => entry.visual_regression.status === "matched"));
    assert.ok(report.executions.every((entry) => entry.actions.every((action) => action.status === "passed")));
    assert.ok(report.executions.every((entry) => entry.assertions.every((assertion) => assertion.status === "passed")));
    assert.ok(second.result.evidence
      .filter((item) => ["screenshot", "test-report"].includes(item.kind))
      .every((item) => item.scenarios.includes("details-open")));
    run = recordAuditResult(run, second.result, path.join(secondOutput, "browser-report.json"), {
      replace: true,
      authorityDigest: run.audit_authority_digest
    });
    assert.equal(run.results[0].normalized.verdict, "pass_with_findings");

    writeJson(paths.scenarios, {
      playwright_scenario_version: 1,
      scenarios: [{
        id: "details-open",
        path: "/layout-bad",
        actions: [],
        assertions: [
          { type: "no-overlap", locator: "#collision > span" },
          { type: "no-clipping", locator: "#clipped-title" },
          { type: "count", locator: ".window-label", value: 1 },
          { type: "computed-style", locator: ".sponsor-slot", property: "border-top-style", value: "dashed" }
        ]
      }]
    });
    configurePlaywright({
      profilePath: paths.profile,
      hostManifestPath: paths.host,
      baseUrl: server.url,
      browserChannel: process.env.KSR_PLAYWRIGHT_CHANNEL || "chrome",
      scenarioPath: paths.scenarios,
      baselineDirectory: paths.baselines
    });
    profile = readJson(paths.profile);
    manifest = loadHostManifest(paths.host);
    packet = makePacket(profile, artifactDigests);
    run = makeRun(directory, artifact, packet);
    const layoutOutput = path.join(directory, "evidence-layout-defects");
    const layout = executeAuditPacket({ run, packet, manifest, attempt: 3, outputDirectory: layoutOutput });
    assert.equal(layout.execution_status, "ran", layout.error);
    assert.equal(layout.result.verdict, "block");
    assert.ok(layout.result.findings.some((item) =>
      item.category === "overflow" && item.rule_id === "overflow-overlap-or-clipping"));
    assert.ok(layout.result.findings.some((item) =>
      item.category === "overflow" && item.claim.startsWith("Unintended overflow, overlap, or text clipping")));
    assert.ok(layout.result.findings.some((item) =>
      item.category === "state-assertion-failure" && item.rule_id === "missing-required-state"));
    assert.ok(layout.result.findings.some((item) =>
      item.category === "visual-intent" && item.rule_id === "visual-intent-contract-violation"));
    const layoutReport = readJson(path.join(layoutOutput, "browser-report.json"));
    assert.ok(layoutReport.executions.every((entry) => entry.overflow.overlaps.length > 0));
    assert.ok(layoutReport.executions.every((entry) => entry.overflow.clipped_text.length > 0));
    assert.ok(layoutReport.executions.every((entry) =>
      entry.assertions.filter((assertion) =>
        ["no-overlap", "no-clipping", "computed-style"].includes(assertion.type))
        .every((assertion) => assertion.status === "failed")));

    writeJson(paths.scenarios, {
      playwright_scenario_version: 1,
      scenarios: [{
        id: "details-open",
        path: "/changed",
        actions: [{ type: "click", locator: "#toggle" }],
        assertions: [
          { type: "visible", locator: "#details" },
          { type: "text", locator: "#details", value: "Verified state" }
        ]
      }]
    });
    configurePlaywright({
      profilePath: paths.profile,
      hostManifestPath: paths.host,
      baseUrl: server.url,
      browserChannel: process.env.KSR_PLAYWRIGHT_CHANNEL || "chrome",
      scenarioPath: paths.scenarios,
      baselineDirectory: paths.baselines
    });
    profile = readJson(paths.profile);
    manifest = loadHostManifest(paths.host);
    packet = makePacket(profile, artifactDigests);
    run = makeRun(directory, artifact, packet);
    const changedOutput = path.join(directory, "evidence-material-change");
    const changed = executeAuditPacket({ run, packet, manifest, attempt: 4, outputDirectory: changedOutput });
    assert.equal(changed.execution_status, "ran", changed.error);
    assert.equal(changed.result.verdict, "block");
    assert.ok(changed.result.findings.some((item) => item.category === "visual-regression"));
    assert.ok(changed.result.evidence.some((item) => item.kind === "visual-diff"));
    const changedReport = readJson(path.join(changedOutput, "browser-report.json"));
    assert.ok(changedReport.executions.some((entry) => entry.visual_regression.status === "changed"));
  } finally {
    if (server?.child && !server.child.killed) server.child.kill("SIGTERM");
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("integrated automation binds a real pre-change observation before the runtime redesign audit", {
  timeout: 180_000
}, async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-playwright-automation-"));
  let server = null;
  try {
    const artifact = path.join(directory, "artifact.html");
    const authority = path.join(directory, "approved-visual-authority.html");
    fs.writeFileSync(artifact, "<!doctype html><p>integrated browser artifact</p>\n");
    fs.writeFileSync(authority, "<!doctype html><p>stable approved visual authority</p>\n");
    const snapshot = snapshotArtifact(artifact, { root: directory });
    server = await startServer({ [snapshot.path]: snapshot.digest });
    const paths = bootstrapProject(directory, ["integrated-details"]);
    approveFixtureVisualIntent(paths.profile, authority);
    approveFixtureVisualSignature(paths.profile, authority);
    const creationProfile = readJson(paths.profile);
    creationProfile.approved_design_system = true;
    writeJson(paths.profile, creationProfile);
    writeJson(paths.scenarios, {
      playwright_scenario_version: 1,
      scenarios: [{
        id: "integrated-details",
        path: "/",
        actions: [{ type: "click", locator: "#toggle" }],
        assertions: [{ type: "visible", locator: "#details" }]
      }]
    });
    configurePlaywright({
      profilePath: paths.profile,
      hostManifestPath: paths.host,
      baseUrl: server.url,
      browserChannel: process.env.KSR_PLAYWRIGHT_CHANNEL || "chrome",
      scenarioPath: paths.scenarios,
      baselineDirectory: paths.baselines
    });
    enableFixtureReviewers(paths.host);
    const statePath = path.join(directory, ".killsloprouter", "playwright-automation.json");
    const first = runCli([
      "run",
      "--profile", paths.profile,
      "--host-config", paths.host,
      "--surface", "operator-product-ui",
      "--task", "audit",
      "--direction", "none",
      "--changes", "source,copy,style,layout,interaction,state",
      "--artifact", artifact,
      "--scope", "runtime",
      "--root", directory,
      "--out", statePath,
      "--json"
    ], directory);
    assert.equal(first.status, 5, first.stderr || first.stdout);
    let state = readJson(statePath);
    assert.equal(state.status, "blocked");
    let audit = readJson(state.paths.audit.path);
    const browserResult = audit.results.find((item) => item.normalized.stage_id === "browser-evidence");
    assert.ok(browserResult, JSON.stringify({
      blockers: state.blockers,
      attempts: state.attempts.map((item) => ({
        provider_id: item.provider_id,
        execution_status: item.execution_status,
        error: item.error || null,
        reason: item.reason || null
      })),
      result_stages: audit.results.map((item) => item.normalized.stage_id)
    }, null, 2));
    assert.equal(browserResult.normalized.verdict, "block");
    assert.notEqual(
      state.attempts.find((item) => item.provider_id === "browser-evidence").child_pid,
      process.pid
    );
    for (const item of browserResult.normalized.evidence.filter((entry) => entry.kind === "screenshot")) {
      fs.copyFileSync(item.resolved_path, path.join(paths.baselines, path.basename(item.resolved_path)));
    }

    configurePlaywright({
      profilePath: paths.profile,
      hostManifestPath: paths.host,
      baseUrl: server.url,
      browserChannel: process.env.KSR_PLAYWRIGHT_CHANNEL || "chrome",
      scenarioPath: paths.scenarios,
      baselineDirectory: paths.baselines
    });
    enableFixtureReviewers(paths.host);
    const retried = runCli([
      "run", "--resume", statePath,
      "--host-config", paths.host,
      "--retry", "browser-evidence",
      "--json"
    ], directory);
    assert.equal(retried.status, 6, retried.stderr || retried.stdout);
    state = readJson(statePath);
    assert.equal(state.status, "manual_pending");
    assert.equal(state.final_audit_status, "critic_pass_owner_review_pending");
    const browserAttempts = state.attempts.filter((item) => item.provider_id === "browser-evidence");
    assert.equal(browserAttempts.length, 2);
    assert.ok(browserAttempts.every((attempt) => attempt.execution_status === "ran"));
    audit = readJson(state.paths.audit.path);
    assert.equal(
      audit.results.find((item) => item.normalized.stage_id === "browser-evidence").normalized.verdict,
      "pass_with_findings"
    );

    const approval = writeApproval(statePath, directory);
    const completed = runCli([
      "run", "--resume", statePath,
      "--host-config", paths.host,
      "--approval", approval,
      "--json"
    ], directory);
    assert.equal(completed.status, 0, completed.stderr || completed.stdout);
    assert.equal(readJson(statePath).status, "complete");

    fs.appendFileSync(artifact, "<!-- post-observation implementation -->\n");
    server.child.kill("SIGTERM");
    const changedSnapshot = snapshotArtifact(artifact, { root: directory });
    server = await startServer({ [changedSnapshot.path]: changedSnapshot.digest });
    configurePlaywright({
      profilePath: paths.profile,
      hostManifestPath: paths.host,
      baseUrl: server.url,
      browserChannel: process.env.KSR_PLAYWRIGHT_CHANNEL || "chrome",
      scenarioPath: paths.scenarios,
      baselineDirectory: paths.baselines
    });
    enableFixtureReviewers(paths.host);

    const redesignArgs = [
      "--profile", paths.profile,
      "--host-config", paths.host,
      "--surface", "operator-product-ui",
      "--task", "redesign",
      "--direction", "approved",
      "--changes", "source,copy,style,layout,interaction,state",
      "--artifact", artifact,
      "--scope", "runtime",
      "--creator-id", "creator-agent-2",
      "--observation-run", statePath,
      "--root", directory,
      "--json"
    ];
    const dryRun = runCli(["run", "--dry-run", ...redesignArgs], directory);
    assert.equal(dryRun.status, 0, dryRun.stderr || dryRun.stdout);
    const dryRunReport = JSON.parse(dryRun.stdout);
    assert.equal(dryRunReport.baseline_observation.run_id, state.run_id);
    assert.deepEqual(dryRunReport.baseline_observation.required_scenarios, ["integrated-details"]);

    const redesignStatePath = path.join(directory, ".killsloprouter", "playwright-redesign.json");
    const redesigned = runCli([
      "run", ...redesignArgs.slice(0, -1),
      "--out", redesignStatePath,
      "--json"
    ], directory);
    assert.equal(redesigned.status, 6, redesigned.stderr || redesigned.stdout);
    const redesignState = readJson(redesignStatePath);
    assert.equal(redesignState.status, "manual_pending");
    assert.equal(redesignState.baseline_observation.run_id, state.run_id);
    const observationPlan = readJson(state.paths.plan.path);
    const redesignPlan = readJson(redesignState.paths.plan.path);
    assert.equal(redesignState.baseline_observation.profile_digest,
      observationPlan.profile_digest);
    assert.equal(redesignPlan.profile_digest, observationPlan.profile_digest);
    assert.notDeepEqual(
      redesignState.baseline_observation.artifact_digests,
      Object.fromEntries([[changedSnapshot.path, changedSnapshot.digest]])
    );
    const redesignAudit = readJson(redesignState.paths.audit.path);
    assert.equal(redesignAudit.baseline_observation.observation_digest,
      redesignState.baseline_observation.observation_digest);
    const redesignBrowserAttempt = redesignState.attempts.find((item) =>
      item.provider_id === "browser-evidence"
    );
    assert.equal(redesignBrowserAttempt.metadata.transport, "official-playwright-json-v1");
    assert.equal(redesignBrowserAttempt.metadata.observed_journey_identity_digest,
      redesignState.journey_identity.identity_digest);
    assert.equal(redesignBrowserAttempt.metadata.observed_participant.provider_id, "browser-evidence");
    assert.equal(redesignBrowserAttempt.metadata.observed_participant.visibility, "internal");

    const redesignApproval = writeApproval(redesignStatePath, directory);
    const redesignCompleted = runCli([
      "run", "--resume", redesignStatePath,
      "--host-config", paths.host,
      "--approval", redesignApproval,
      "--json"
    ], directory);
    assert.equal(redesignCompleted.status, 0, redesignCompleted.stderr || redesignCompleted.stdout);
    assert.equal(readJson(redesignStatePath).status, "complete");
  } finally {
    if (server?.child && !server.child.killed) server.child.kill("SIGTERM");
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
