import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-pack-"));

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: "utf8",
    shell: false,
    timeout: 180_000,
    maxBuffer: 16 * 1024 * 1024,
    ...options
  });
}

try {
  const packed = run(npm, [
    "pack",
    "--json",
    "--ignore-scripts",
    "--pack-destination", temporary
  ]);

  if (packed.error || packed.status !== 0) {
    throw new Error(packed.stderr || packed.error?.message || "npm pack failed");
  }

  const report = JSON.parse(packed.stdout)[0];
  const files = new Set(report.files.map((entry) => entry.path));
  const required = [
    ".codex-plugin/plugin.json",
    "bin/killsloprouter.mjs",
    "src/router.mjs",
    "src/audit.mjs",
    "src/automation.mjs",
    "src/bootstrap.mjs",
    "src/design.mjs",
    "src/execution.mjs",
    "src/playwright.mjs",
    "src/adapters/playwright-browser.mjs",
    "router/default-router.json",
    "schemas/automation-run.schema.json",
    "schemas/bootstrap-receipt.schema.json",
    "schemas/automation-step-receipt.schema.json",
    "schemas/host-adapter.schema.json",
    "schemas/design-brief.schema.json",
    "schemas/design-font-report.schema.json",
    "schemas/design-packet.schema.json",
    "schemas/design-result.schema.json",
    "schemas/design-exploration-run.schema.json",
    "schemas/design-shortlist.schema.json",
    "schemas/design-token-spec.schema.json",
    "schemas/design-owner-decision.schema.json",
    "schemas/design-direction-decision.schema.json",
    "schemas/design-profile-bindings.schema.json",
    "schemas/host-adapter-request.schema.json",
    "schemas/host-adapter-response.schema.json",
    "schemas/browser-attestation.schema.json",
    "schemas/playwright-scenarios.schema.json",
    "schemas/playwright-setup-receipt.schema.json",
    "schemas/project-profile.schema.json",
    "schemas/visual-intent-receipt.schema.json",
    "schemas/visual-signature-receipt.schema.json",
    "docs/adapter-authoring.md",
    "docs/design-exploration.md",
    "docs/codex-plugin.md",
    "docs/surface-contract.md",
    "docs/visual-intent-contract.md",
    "docs/visual-signature-contract.md",
    "docs/playwright-browser.md",
    "docs/threat-model-and-permissions.md",
    "docs/migration-v1.md",
    "scripts/install-codex-plugin.mjs",
    "skills/kill-slop-router/SKILL.md",
    "skills/kill-slop-router/agents/openai.yaml",
    "examples/planning-evidence/visual-signature-approval.json",
    "examples/design-brief.example.json",
    "examples/playwright-scenarios.example.json",
    "README.md",
    "LICENSE"
  ];

  for (const expected of required) assert.ok(files.has(expected), `package is missing ${expected}`);
  for (const file of files) {
    assert.equal(file.startsWith("test/"), false, `test fixture leaked into package: ${file}`);
    assert.equal(file.startsWith(".git/"), false, `Git metadata leaked into package: ${file}`);
  }

  const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
  assert.deepEqual(packageJson.dependencies, {
    "axe-core": "4.13.0",
    "playwright-core": "1.62.1"
  }, "browser runtime dependencies must remain exact pins");

  const tarball = path.join(temporary, report.filename);
  assert.ok(fs.existsSync(tarball), "npm pack did not create the reported tarball");
  const consumer = path.join(temporary, "consumer");
  fs.mkdirSync(consumer);
  fs.writeFileSync(path.join(consumer, "package.json"), `${JSON.stringify({
    name: "killsloprouter-pack-consumer",
    version: "0.0.0",
    private: true
  }, null, 2)}\n`);

  const installed = run(npm, [
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--prefer-offline",
    "--package-lock=false",
    tarball
  ], { cwd: consumer });
  assert.equal(installed.status, 0, installed.stderr || installed.stdout);

  const installedRoot = path.join(consumer, "node_modules", "killsloprouter");
  const installedCli = path.join(installedRoot, "bin", "killsloprouter.mjs");
  const help = run(process.execPath, [installedCli, "--help"], { cwd: consumer });
  assert.equal(help.status, 0, help.stderr || help.stdout);

  const installedProfile = path.join(installedRoot, "examples", "project-profile.example.json");
  const installedHost = path.join(installedRoot, "examples", "host-adapter.example.json");
  const installedArtifact = path.join(installedRoot, "examples", "planning-evidence", "mockup.html");
  const doctor = run(process.execPath, [
    installedCli,
    "doctor",
    "--profile", installedProfile,
    "--json"
  ], { cwd: consumer });
  assert.equal(doctor.status, 0, doctor.stderr || doctor.stdout);
  assert.equal(JSON.parse(doctor.stdout).status, "automation-ready");

  const dryRun = run(process.execPath, [
    installedCli,
    "run",
    "--dry-run",
    "--profile", installedProfile,
    "--host-config", installedHost,
    "--surface", "operator-product-ui",
    "--task", "redesign",
    "--direction", "approved",
    "--changes", "source,copy,layout,interaction",
    "--artifact", installedArtifact,
    "--scope", "mockup",
    "--creator-id", "pack-consumer",
    "--json"
  ], { cwd: consumer });
  assert.equal(dryRun.status, 6, dryRun.stderr || dryRun.stdout);
  const dryReport = JSON.parse(dryRun.stdout);
  assert.equal(dryReport.status, "dry_run");
  assert.ok(dryReport.host_readiness.length > 0);
  assert.ok(dryReport.host_readiness.every((item) => item.execution_status === "manual_pending"));

  process.stdout.write(`package: ${report.filename}\n`);
  process.stdout.write(`files: ${report.entryCount}\n`);
  process.stdout.write(`bytes: ${report.size}\n`);
  process.stdout.write("installed consumer: help, doctor, manual dry-run passed\n");
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
