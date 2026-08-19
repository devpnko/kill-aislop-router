import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const packed = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", [
  "pack",
  "--dry-run",
  "--json",
  "--ignore-scripts"
], {
  encoding: "utf8",
  shell: false,
  maxBuffer: 16 * 1024 * 1024
});

if (packed.error || packed.status !== 0) {
  process.stderr.write(packed.stderr || packed.error?.message || "npm pack failed\n");
  process.exit(packed.status || 1);
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

process.stdout.write(`package: ${report.filename}\nfiles: ${report.entryCount}\nbytes: ${report.size}\n`);
