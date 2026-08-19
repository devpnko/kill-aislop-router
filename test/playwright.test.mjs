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
        id: "unsafe-style-property",
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
    const manifest = loadHostManifest(paths.host);
    const unsupportedPacket = structuredClone(packet);
    unsupportedPacket.evidence_contract.required_checks.push("screen-reader", "visual-regression");
    const unsupported = inspectPacketAdapter(unsupportedPacket, manifest);
    assert.equal(unsupported.execution_status, "manual_pending");
    assert.match(unsupported.reason, /screen-reader, visual-regression/);
    assert.equal(inspectPacketAdapter(packet, manifest).execution_status, "ready");
    const run = {
      run_id: packet.run_id,
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
    layoutPacket.packet_digest = `sha256:${"4".repeat(64)}`;
    layoutPacket.design_task.prototypes[0].digest = hashArtifact(prototype);
    const layoutBlocked = executeAuditPacket({
      run: {
        ...run,
        run_id: "official-design-browser-layout-run",
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
    blockedPacket.packet_digest = `sha256:${"3".repeat(64)}`;
    blockedPacket.evidence_contract.required_checks.push("network");
    blockedPacket.design_task.prototypes[0].digest = hashArtifact(prototype);
    const blocked = executeAuditPacket({
      run: { ...run, run_id: "official-design-browser-block-run", packets: [blockedPacket] },
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
    const paths = bootstrapProject(directory);
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
        id: "layout-readability",
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
    manifest = loadHostManifest(paths.host);
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
    manifest = loadHostManifest(paths.host);
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
    approveFixtureVisualSignature(paths.profile, artifact);
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
