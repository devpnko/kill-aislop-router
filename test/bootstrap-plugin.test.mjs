import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { canonicalDigest, hashArtifact } from "../src/integrity.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "bin", "killsloprouter.mjs");
const installer = path.join(root, "scripts", "install-codex-plugin.mjs");

function runNode(script, args, cwd) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd,
    encoding: "utf8",
    timeout: 30_000
  });
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function approveVisualIntent(profilePath, artifactPath) {
  const profile = readJson(profilePath);
  const surface = profile.surface_contract.primary;
  const receiptPath = path.join(path.dirname(profilePath), "visual-intent-approval.json");
  const intent = {
    mode: "product-native",
    editorial_treatment: "forbidden",
    editorial_scope: [],
    energy: "balanced",
    depth: "layered",
    preserve: ["operator task density", "existing brand character", "visual energy"],
    avoid: ["paper-like neutralization", "universal flattening"]
  };
  writeJson(receiptPath, {
    visual_intent_receipt_version: 1,
    project_id: profile.project_id,
    surface,
    status: "approved",
    intent,
    authority: {
      kind: "approved-reference",
      authority_id: "bootstrap-fixture-owner",
      basis: "The fixture is an operator product surface, not an editorial treatment.",
      decided_at: "2026-08-18T00:00:00.000Z"
    },
    evidence: [{
      kind: "approved-artifact",
      path: path.relative(path.dirname(receiptPath), artifactPath),
      digest: hashArtifact(artifactPath)
    }]
  });
  profile.visual_intents[surface] = {
    visual_intent_version: 1,
    status: "approved",
    ...intent,
    authority_receipt: path.basename(receiptPath),
    authority_digest: hashArtifact(receiptPath)
  };
  writeJson(profilePath, profile);
}

function approveVisualSignature(profilePath, artifactPath) {
  const profile = readJson(profilePath);
  const surface = profile.surface_contract.primary;
  const receiptPath = path.join(path.dirname(profilePath), "visual-signature-approval.json");
  const signature = {
    palette: {
      primary: [{ value: "#175CD3", token: "--brand", usage: "primary actions" }],
      accent: [],
      background: [{ value: "#F8FAFC", usage: "application canvas" }],
      surface: [{ value: "#FFFFFF", usage: "panels" }],
      text: [{ value: "#101828", usage: "labels and data" }],
      semantic: []
    },
    typography: {
      families: [{ family: "Inter", role: "operator interface" }],
      scale: "compact operator hierarchy",
      weights: ["400", "600"],
      treatments: ["tabular numerals"]
    },
    density: { mode: "compact", characteristics: ["same-screen comparison"] },
    shape: {
      radii: ["4px controls"],
      geometry: ["restrained rectangles"],
      strokes: ["1px panel strokes"]
    },
    elevation: {
      strategy: "layered",
      shadows: ["low overlay shadow"],
      separation: ["surface contrast"]
    },
    imagery: { strategy: "functional", characteristics: ["status imagery only"] },
    motion: { intensity: "restrained", characteristics: ["state confirmation"] },
    style_keywords: ["operational", "data-dense"],
    forbidden_transformations: [
      "paper-like neutralization",
      "consumer-card spacing",
      "global depth removal"
    ]
  };
  const relativeArtifact = path.relative(path.dirname(receiptPath), artifactPath);
  const aspects = [
    "palette",
    "typography",
    "density",
    "shape",
    "elevation",
    "imagery",
    "motion",
    "style_keywords",
    "forbidden_transformations"
  ];
  writeJson(receiptPath, {
    visual_signature_receipt_version: 1,
    project_id: profile.project_id,
    surface,
    status: "approved",
    signature,
    authority: {
      kind: "approved-reference",
      authority_id: "bootstrap-fixture-owner",
      basis: "The fixture binds a compact operator signature for routing tests.",
      decided_at: "2026-08-18T00:00:00.000Z"
    },
    evidence: [{
      kind: "approved-artifact",
      path: relativeArtifact,
      digest: hashArtifact(artifactPath)
    }],
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

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

test("bootstrap requires an explicit project surface before writing configuration", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-bootstrap-surface-"));
  try {
    const result = runNode(cli, [
      "bootstrap",
      "--root", directory,
      "--project-id", "missing-surface",
      "--locale", "ko-KR",
      "--json"
    ], directory);
    assert.equal(result.status, 2, result.stderr || result.stdout);
    assert.match(result.stderr, /bootstrap requires --surface/);
    assert.equal(fs.existsSync(path.join(directory, ".killsloprouter")), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("bootstrap creates a non-overwriting manual-only project boundary that dry-runs", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-bootstrap-"));
  try {
    const first = runNode(cli, [
      "bootstrap",
      "--root", directory,
      "--project-id", "sample-product",
      "--locale", "ko-KR",
      "--surface", "operator-product-ui",
      "--json"
    ], directory);
    assert.equal(first.status, 0, first.stderr || first.stdout);
    const output = JSON.parse(first.stdout);
    assert.equal(output.status, "manual_adapter_setup_required");

    const config = path.join(directory, ".killsloprouter");
    const profilePath = path.join(config, "profile.json");
    const hostPath = path.join(config, "host-adapters.json");
    const receiptPath = path.join(config, "bootstrap-receipt.json");
    const profile = readJson(profilePath);
    const host = readJson(hostPath);
    const receipt = readJson(receiptPath);
    assert.equal(profile.approved_design_system, false);
    assert.equal(profile.default_locale, "ko-KR");
    assert.equal(profile.surface_contract.primary, "operator-product-ui");
    assert.deepEqual(profile.surface_contract.allowed, ["operator-product-ui"]);
    assert.deepEqual(profile.surface_contract.artifact_bindings, [
      { root: ".", surface: "operator-product-ui" }
    ]);
    assert.equal(receipt.surface, "operator-product-ui");
    assert.equal(receipt.safety.surface_contract_locked, true);
    assert.equal(receipt.safety.visual_intent_resolved, false);
    assert.equal(receipt.safety.visual_signature_resolved, false);
    assert.equal(receipt.safety.editorial_default_allowed, false);
    assert.equal(receipt.safety.style_defaults_allowed, false);
    assert.equal(profile.visual_intents["operator-product-ui"].status, "unresolved");
    assert.equal(profile.visual_intents["operator-product-ui"].editorial_treatment, "forbidden");
    assert.equal(profile.visual_signatures["operator-product-ui"].status, "unresolved");
    assert.deepEqual(profile.visual_signatures["operator-product-ui"].palette.primary, []);
    assert.deepEqual(profile.evidence.required_scenarios, []);
    assert.ok(Object.values(profile.local_adapters).every((item) => item.executor === "manual-review"));
    assert.ok(Object.values(host.providers).every((item) => item.adapter === "manual-v1"));
    assert.deepEqual(host.granted_permissions, []);
    assert.equal(receipt.profile.digest, hashArtifact(profilePath));
    assert.equal(receipt.host_manifest.digest, hashArtifact(hostPath));
    const { receipt_digest: expectedDigest, ...receiptBody } = receipt;
    assert.equal(expectedDigest, canonicalDigest(receiptBody));

    const before = [hashArtifact(profilePath), hashArtifact(hostPath), hashArtifact(receiptPath)];
    const repeated = runNode(cli, [
      "bootstrap",
      "--root", directory,
      "--project-id", "sample-product",
      "--locale", "ko-KR",
      "--surface", "operator-product-ui",
      "--json"
    ], directory);
    assert.equal(repeated.status, 2, repeated.stderr || repeated.stdout);
    assert.match(repeated.stderr, /refuses to overwrite/);
    assert.deepEqual(
      [hashArtifact(profilePath), hashArtifact(hostPath), hashArtifact(receiptPath)],
      before
    );

    const doctor = runNode(cli, ["doctor", "--profile", profilePath, "--format", "json"], directory);
    assert.equal(doctor.status, 5, doctor.stderr || doctor.stdout);
    assert.equal(JSON.parse(doctor.stdout).status, "configuration_required");

    const invalidProfilePath = path.join(directory, "invalid-profile.json");
    const invalidProfile = structuredClone(profile);
    invalidProfile.surface_contract.artifact_bindings[0].root = "missing-product-root";
    fs.writeFileSync(invalidProfilePath, `${JSON.stringify(invalidProfile, null, 2)}\n`);
    const invalidDoctor = runNode(cli, [
      "doctor",
      "--profile", invalidProfilePath,
      "--format", "json"
    ], directory);
    assert.equal(invalidDoctor.status, 2, invalidDoctor.stderr || invalidDoctor.stdout);
    assert.match(invalidDoctor.stderr, /surface binding root does not exist/);

    const artifact = path.join(directory, "artifact.html");
    fs.writeFileSync(artifact, "<!doctype html><button>Save</button>\n");
    const blockedDryRun = runNode(cli, [
      "run",
      "--dry-run",
      "--profile", profilePath,
      "--host-config", hostPath,
      "--task", "audit",
      "--direction", "none",
      "--changes", "source,layout",
      "--artifact", artifact,
      "--scope", "runtime",
      "--json"
    ], directory);
    assert.equal(blockedDryRun.status, 5, blockedDryRun.stderr || blockedDryRun.stdout);
    assert.match(JSON.parse(blockedDryRun.stdout).blockers.join("\n"), /visual intent contract is unresolved/);

    approveVisualIntent(profilePath, artifact);
    const intentOnlyDoctor = runNode(cli, ["doctor", "--profile", profilePath, "--format", "json"], directory);
    assert.equal(intentOnlyDoctor.status, 5, intentOnlyDoctor.stderr || intentOnlyDoctor.stdout);
    assert.equal(JSON.parse(intentOnlyDoctor.stdout).visual_signatures[0].status, "unresolved");
    approveVisualSignature(profilePath, artifact);
    const scenarioBoundProfile = readJson(profilePath);
    scenarioBoundProfile.evidence.required_scenarios = ["root"];
    writeJson(profilePath, scenarioBoundProfile);
    const readyDoctor = runNode(cli, ["doctor", "--profile", profilePath, "--format", "json"], directory);
    assert.equal(readyDoctor.status, 0, readyDoctor.stderr || readyDoctor.stdout);
    const readyDoctorReport = JSON.parse(readyDoctor.stdout);
    assert.equal(readyDoctorReport.status, "automation-ready");
    assert.equal(readyDoctorReport.execution_readiness, "not_evaluated_use_integrated_dry_run");
    assert.equal(readyDoctorReport.completion_eligible, false);
    assert.equal(readyDoctorReport.next_required_command, "killsloprouter run --dry-run");

    const misleadingHostDoctor = runNode(cli, [
      "doctor",
      "--profile", profilePath,
      "--host-config", hostPath,
      "--format", "json"
    ], directory);
    assert.equal(misleadingHostDoctor.status, 2, misleadingHostDoctor.stderr || misleadingHostDoctor.stdout);
    assert.match(misleadingHostDoctor.stderr, /doctor validates project\/profile authority only/);

    const dryRun = runNode(cli, [
      "run",
      "--dry-run",
      "--profile", profilePath,
      "--host-config", hostPath,
      "--task", "audit",
      "--direction", "none",
      "--changes", "source,copy,layout,interaction",
      "--artifact", artifact,
      "--scope", "runtime",
      "--json"
    ], directory);
    assert.equal(dryRun.status, 6, dryRun.stderr || dryRun.stdout);
    const report = JSON.parse(dryRun.stdout);
    assert.equal(report.status, "dry_run");
    assert.equal(report.plan.route_id, "existing-ui-audit");
    assert.ok(report.host_readiness.length > 0);
    assert.ok(report.host_readiness.every((item) => item.execution_status === "manual_pending"));

    const mismatched = runNode(cli, [
      "run",
      "--dry-run",
      "--profile", profilePath,
      "--host-config", hostPath,
      "--surface", "consumer-product-ui",
      "--task", "audit",
      "--direction", "none",
      "--changes", "source",
      "--artifact", artifact,
      "--scope", "runtime",
      "--json"
    ], directory);
    assert.equal(mismatched.status, 3, mismatched.stderr || mismatched.stdout);
    assert.match(mismatched.stderr, /surface mismatch/);

    const statePath = path.join(config, "surface-tamper-run.json");
    const started = runNode(cli, [
      "run",
      "--profile", profilePath,
      "--host-config", hostPath,
      "--task", "audit",
      "--direction", "none",
      "--changes", "source",
      "--artifact", artifact,
      "--scope", "runtime",
      "--out", statePath,
      "--json"
    ], directory);
    assert.equal(started.status, 6, started.stderr || started.stdout);
    assert.equal(readJson(statePath).status, "manual_pending");

    const changedProfile = readJson(profilePath);
    changedProfile.surface_contract = {
      surface_contract_version: 1,
      primary: "consumer-product-ui",
      allowed: ["consumer-product-ui"],
      artifact_bindings: [{ root: ".", surface: "consumer-product-ui" }]
    };
    fs.writeFileSync(profilePath, `${JSON.stringify(changedProfile, null, 2)}\n`);
    const resumed = runNode(cli, [
      "run",
      "--resume", statePath,
      "--host-config", hostPath,
      "--json"
    ], directory);
    assert.equal(resumed.status, 4, resumed.stderr || resumed.stdout);
    assert.match(resumed.stderr, /profile changed after surface routing/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("bootstrap rejects a symlinked configuration boundary", () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-bootstrap-project-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-bootstrap-outside-"));
  try {
    fs.symlinkSync(outside, path.join(project, ".killsloprouter"), "dir");
    const result = runNode(cli, [
      "bootstrap",
      "--root", project,
      "--project-id", "symlink-test",
      "--locale", "en-US",
      "--surface", "operator-product-ui"
    ], project);
    assert.equal(result.status, 2, result.stderr || result.stdout);
    assert.match(result.stderr, /must be a real directory/);
    assert.deepEqual(fs.readdirSync(outside), []);
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test("Codex plugin installer preserves marketplace entries and refreshes only marked installs", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-plugin-"));
  try {
    const marketplace = path.join(directory, ".agents", "plugins", "marketplace.json");
    fs.mkdirSync(path.dirname(marketplace), { recursive: true });
    fs.writeFileSync(marketplace, `${JSON.stringify({
      name: "personal",
      interface: { displayName: "My Plugins" },
      plugins: [{
        name: "existing",
        source: { source: "local", path: "./plugins/existing" },
        policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
        category: "Productivity"
      }]
    }, null, 2)}\n`);

    const dryRun = runNode(installer, ["--home", directory, "--dry-run"], root);
    assert.equal(dryRun.status, 0, dryRun.stderr || dryRun.stdout);
    assert.equal(JSON.parse(dryRun.stdout).would_activate, false);

    const installed = runNode(installer, ["--home", directory], root);
    assert.equal(installed.status, 0, installed.stderr || installed.stdout);
    const result = JSON.parse(installed.stdout);
    assert.equal(result.activation.skipped, true);
    assert.match(result.next, /\$killsloprouter:kill-slop-router/);
    const target = path.join(directory, "plugins", "killsloprouter");
    assert.ok(fs.existsSync(path.join(target, ".codex-plugin", "plugin.json")));
    assert.ok(fs.existsSync(path.join(target, "bin", "killsloprouter.mjs")));
    assert.ok(fs.existsSync(path.join(target, ".killsloprouter-plugin-installed.json")));
    assert.equal(readJson(path.join(target, ".runtime", "node_modules", "playwright-core", "package.json")).version,
      "1.62.1");
    assert.equal(readJson(path.join(target, ".runtime", "node_modules", "axe-core", "package.json")).version,
      "4.13.0");
    assert.equal(fs.existsSync(path.join(target, ".runtime", "node_modules", "playwright-core", "LICENSE")), true);
    assert.equal(fs.existsSync(path.join(target, ".runtime", "node_modules", "axe-core", "LICENSE")), true);

    const registered = readJson(marketplace);
    assert.equal(registered.interface.displayName, "My Plugins");
    assert.equal(registered.plugins.some((item) => item.name === "existing"), true);
    assert.equal(registered.plugins.some((item) => item.name === "killsloprouter"), true);

    const refused = runNode(installer, ["--home", directory], root);
    assert.equal(refused.status, 2, refused.stderr || refused.stdout);
    assert.match(refused.stderr, /target exists/);

    const refreshed = runNode(installer, ["--home", directory, "--force"], root);
    assert.equal(refreshed.status, 0, refreshed.stderr || refreshed.stdout);
    const refreshResult = JSON.parse(refreshed.stdout);
    assert.ok(refreshResult.plugin_backup);
    assert.ok(fs.existsSync(refreshResult.plugin_backup));
    assert.ok(refreshResult.marketplace_backup);
    assert.ok(fs.existsSync(refreshResult.marketplace_backup));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("the packaged CLI exposes the plugin installer for one-command remote use", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-plugin-cli-"));
  try {
    const preview = runNode(cli, [
      "plugin",
      "install",
      "--home", directory,
      "--dry-run"
    ], root);
    assert.equal(preview.status, 0, preview.stderr || preview.stdout);
    const report = JSON.parse(preview.stdout);
    assert.equal(report.ok, true);
    assert.equal(report.dry_run, true);
    assert.equal(report.plugin_target, path.join(directory, "plugins", "killsloprouter"));
    assert.equal(fs.existsSync(report.plugin_target), false);

    const invalid = runNode(cli, ["plugin", "unknown"], root);
    assert.equal(invalid.status, 2, invalid.stderr || invalid.stdout);
    assert.match(invalid.stderr, /plugin requires the install subcommand/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
