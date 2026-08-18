import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { recordAuditResult } from "../src/audit.mjs";
import { executeAuditPacket, inspectPacketAdapter, loadHostManifest } from "../src/execution.mjs";
import { hashArtifact, snapshotArtifact } from "../src/integrity.mjs";
import {
  configurePlaywright,
  playwrightRuntimeDigest,
  resolvePlaywrightRuntimeRoot
} from "../src/playwright.mjs";

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

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function runCli(args, cwd) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: "utf8",
    timeout: 60_000
  });
}

function bootstrapProject(directory) {
  const result = runCli([
    "bootstrap",
    "--root", directory,
    "--project-id", "playwright-fixture",
    "--locale", "en-US",
    "--surface", "operator-product-ui",
    "--json"
  ], directory);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return {
    profile: path.join(directory, ".killsloprouter", "profile.json"),
    host: path.join(directory, ".killsloprouter", "host-adapters.json"),
    scenarios: path.join(directory, ".killsloprouter", "playwright-scenarios.json"),
    baselines: path.join(directory, ".killsloprouter", "playwright-baselines")
  };
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
  return {
    packet_id: "browser-evidence--browser-evidence--1",
    stage_id: "browser-evidence",
    stage_question: "Do the approved states work in a real browser?",
    provider: { id: "browser-evidence", kind: "local", version: "playwright-core@1.62.1" },
    minimum_strength: 3,
    reviewer_independence_required: true,
    assigned_capabilities: capabilities,
    artifact_digests: artifactDigests,
    evidence_required: true,
    required_evidence_kinds: ["screenshot", "test-report"],
    evidence_contract: profile.evidence,
    packet_digest: "fixture-packet-digest"
  };
}

function makeRun(directory, artifact, packet) {
  return {
    audit_run_version: 1,
    run_id: "playwright-real-child-run",
    root: directory,
    packets: [packet],
    creator: { provider_id: "project-design-system", actor_id: "creator-agent-1" },
    scope: { kind: "runtime", claim: "Rendered runtime" },
    artifacts: [snapshotArtifact(artifact, { root: directory })],
    results: [],
    triage: []
  };
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
  const approval = path.join(directory, "approval.json");
  writeJson(approval, {
    approval_version: 1,
    run_id: audit.run_id,
    scope_digest: audit.approval_scope_digest,
    owner_id: "playwright-release-owner",
    status: "approved",
    note: "Approved exact Playwright E2E evidence and artifact scope.",
    decided_at: new Date().toISOString()
  });
  return approval;
}

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
      required_checks: ["keyboard"]
    };
    writeJson(paths.profile, weakenedProfile);
    const configured = runCli([
      "browser", "configure",
      "--profile", paths.profile,
      "--host-config", paths.host,
      "--base-url", "http://127.0.0.1:4173",
      "--channel", "chrome",
      "--json"
    ], directory);
    assert.equal(configured.status, 0, configured.stderr || configured.stdout);
    const receipt = JSON.parse(configured.stdout);
    assert.equal(receipt.status, "configured");
    assert.match(receipt.receipt_digest, /^sha256:[a-f0-9]{64}$/);
    assert.equal(receipt.browser.attestation_path, "/.well-known/killsloprouter-artifact.json");
    assert.deepEqual(receipt.browser.allowed_origins, []);
    const profile = readJson(paths.profile);
    assert.equal(profile.evidence.browser, "playwright");
    assert.deepEqual(profile.evidence.required_viewports, ["mobile", "tablet", "desktop"]);
    assert.deepEqual(profile.evidence.required_checks, [
      "keyboard", "state", "overflow", "contrast", "zoom-200", "visual-regression",
      "screen-reader", "console", "network"
    ]);
    assert.ok(profile.evidence.required_checks.includes("screen-reader"));
    assert.ok(profile.evidence.required_checks.includes("visual-regression"));
    const host = loadHostManifest(paths.host);
    const declaration = host.providers["browser-evidence"];
    assert.equal(declaration.settings.contract, "killsloprouter-playwright-v1");
    assert.equal(declaration.settings.runtime_digest, playwrightRuntimeDigest(resolvePlaywrightRuntimeRoot()));
    assert.deepEqual(declaration.permissions, ["artifact:read", "evidence:write", "browser:control"]);
    assert.equal(fs.existsSync(receipt.profile.backup), true);
    assert.equal(fs.existsSync(receipt.host_manifest.backup), true);

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
      scenarios: [{ id: "invalid", path: "/", actions: [{ type: "shell", locator: "body" }] }]
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
        id: "external-explicit",
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
    assert.throws(() => loadHostManifest(paths.host), /runtime digest mismatch/);
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

test("official Playwright adapter crosses a real child boundary, blocks missing baselines, and passes after digest-locked retry", {
  timeout: 120_000
}, async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-playwright-e2e-"));
  let server = null;
  try {
    const artifact = path.join(directory, "artifact.html");
    fs.writeFileSync(artifact, "<!doctype html><p>artifact source for attestation</p>\n");
    const snapshot = snapshotArtifact(artifact, { root: directory });
    const artifactDigests = { [snapshot.path]: snapshot.digest };
    server = await startServer(artifactDigests);
    const paths = bootstrapProject(directory);
    writeJson(paths.scenarios, {
      playwright_scenario_version: 1,
      scenarios: [{
        id: "details-open",
        path: "/",
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
    let profile = readJson(paths.profile);
    let manifest = loadHostManifest(paths.host);
    const packet = makePacket(profile, artifactDigests);
    let run = makeRun(directory, artifact, packet);
    assert.equal(inspectPacketAdapter(packet, manifest).execution_status, "ready");

    const firstOutput = path.join(directory, "evidence-attempt-1");
    const first = executeAuditPacket({ run, packet, manifest, attempt: 1, outputDirectory: firstOutput });
    assert.equal(first.execution_status, "ran", first.error);
    assert.notEqual(first.child_pid, process.pid);
    assert.equal(first.result.verdict, "block");
    assert.match(first.result.findings.map((item) => item.category).join("\n"), /visual-regression/);
    assert.ok(first.result.evidence.some((item) => item.kind === "test-report"));
    assert.ok(first.result.evidence.some((item) => item.kind === "trace"));
    assert.deepEqual(
      new Set(first.result.evidence.filter((item) => item.kind === "screenshot").flatMap((item) => item.viewports)),
      new Set(["mobile", "tablet", "desktop"])
    );
    const firstResultPath = path.join(firstOutput, "adapter-result.json");
    writeJson(firstResultPath, first.result);
    run = recordAuditResult(run, first.result, firstResultPath);
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
    assert.equal(report.artifact_attestation.artifact_digests[snapshot.path], snapshot.digest);
    assert.ok(report.executions.every((entry) => entry.visual_regression.status === "matched"));
    assert.ok(report.executions.every((entry) => entry.actions.every((action) => action.status === "passed")));
    assert.ok(report.executions.every((entry) => entry.assertions.every((assertion) => assertion.status === "passed")));
    run = recordAuditResult(run, second.result, path.join(secondOutput, "browser-report.json"), { replace: true });
    assert.equal(run.results[0].normalized.verdict, "pass_with_findings");

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
    manifest = loadHostManifest(paths.host);
    const changedOutput = path.join(directory, "evidence-material-change");
    const changed = executeAuditPacket({ run, packet, manifest, attempt: 3, outputDirectory: changedOutput });
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

test("integrated automation resumes and retries the official Playwright stage before owner approval", {
  timeout: 120_000
}, async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-playwright-automation-"));
  let server = null;
  try {
    const artifact = path.join(directory, "artifact.html");
    fs.writeFileSync(artifact, "<!doctype html><p>integrated browser artifact</p>\n");
    const snapshot = snapshotArtifact(artifact, { root: directory });
    server = await startServer({ [snapshot.path]: snapshot.digest });
    const paths = bootstrapProject(directory);
    approveFixtureVisualIntent(paths.profile, artifact);
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
  } finally {
    if (server?.child && !server.child.killed) server.child.kill("SIGTERM");
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
