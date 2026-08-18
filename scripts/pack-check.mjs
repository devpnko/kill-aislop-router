import assert from "node:assert/strict";
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
  "bin/killsloprouter.mjs",
  "src/router.mjs",
  "src/audit.mjs",
  "src/automation.mjs",
  "src/execution.mjs",
  "router/default-router.json",
  "schemas/automation-run.schema.json",
  "schemas/automation-step-receipt.schema.json",
  "schemas/host-adapter.schema.json",
  "schemas/host-adapter-request.schema.json",
  "schemas/host-adapter-response.schema.json",
  "docs/adapter-authoring.md",
  "docs/threat-model-and-permissions.md",
  "docs/migration-v1.md",
  "README.md",
  "LICENSE"
];

for (const expected of required) assert.ok(files.has(expected), `package is missing ${expected}`);
for (const file of files) {
  assert.equal(file.startsWith("test/"), false, `test fixture leaked into package: ${file}`);
  assert.equal(file.startsWith(".git/"), false, `Git metadata leaked into package: ${file}`);
}

process.stdout.write(`package: ${report.filename}\nfiles: ${report.entryCount}\nbytes: ${report.size}\n`);
