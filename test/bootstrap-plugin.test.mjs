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
    assert.equal(doctor.status, 0, doctor.stderr || doctor.stdout);
    assert.equal(JSON.parse(doctor.stdout).status, "automation-ready");

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
    assert.equal(dryRun.status, 0, dryRun.stderr || dryRun.stdout);
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
