import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { planRoute, readJson } from "../src/router.mjs";
import { runKillAiSlop } from "../src/adapters/kill-ai-slop.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const routerPath = path.join(root, "router", "default-router.json");
const profilePath = path.join(root, "examples", "project-profile.example.json");
const router = readJson(routerPath, "router");
const profile = readJson(profilePath, "profile");

function plan(input, selectedProfile = profile) {
  return planRoute({ router, profile: selectedProfile, input, routerPath, profilePath });
}

const operator = plan({
  surface: "operator-product-ui",
  task: "redesign",
  direction: "approved",
  changes: ["source", "layout", "interaction"]
});
assert.equal(operator.status, "planned");
assert.equal(operator.creator, "project-design-system");
assert.equal(JSON.stringify(operator.stages).includes("taste-skill"), false);

const consumer = plan({
  surface: "consumer-product-ui",
  task: "build",
  direction: "missing",
  changes: ["source", "copy", "layout"]
}, null);
assert.equal(consumer.creator, "taste-skill");
assert.equal(consumer.status, "unresolved");
assert.equal(consumer.stages.some((stage) => stage.id === "rendered-craft-review"), true);

const reference = plan({
  surface: "consumer-product-ui",
  task: "redesign",
  direction: "reference",
  changes: []
});
assert.equal(reference.creator, "hallmark");
assert.equal(reference.stages.some((stage) => stage.id === "rendered-craft-review"), false);
assert.equal(reference.stages.some((stage) => stage.id === "direction-coherence-review"), true);

const audit = plan({
  surface: "operator-product-ui",
  task: "audit",
  direction: "none",
  changes: ["source"]
});
assert.equal(audit.creator, null);
assert.equal(audit.route_id, "existing-ui-audit");

const highRisk = plan({
  surface: "consumer-product-ui",
  task: "runtime-handoff",
  direction: "approved",
  changes: ["data", "authority", "interaction"],
  risk: "high"
});
assert.equal(highRisk.status, "planned");
assert.equal(highRisk.stages.some((stage) => stage.id === "high-risk-project-gates"), true);
assert.equal(JSON.stringify(highRisk.stages).includes("privacy-authority-review"), true);

const cli = spawnSync(process.execPath, [
  path.join(root, "bin", "killsloprouter.mjs"),
  "plan",
  "--profile", profilePath,
  "--surface", "consumer-product-ui",
  "--task", "audit",
  "--format", "json"
], { encoding: "utf8" });
assert.equal(cli.status, 0, cli.stderr);
assert.equal(JSON.parse(cli.stdout).route_id, "existing-ui-audit");

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-adapter-test-"));
try {
  const scannerDir = path.join(temp, "adapter", "skill", "scripts");
  fs.mkdirSync(scannerDir, { recursive: true });
  fs.writeFileSync(path.join(scannerDir, "scan.mjs"), `
    console.log(JSON.stringify({
      filesScanned: 1,
      groups: 1,
      hits: 1,
      findings: [{
        id: "20",
        group: "component",
        name: "oversized drop shadow",
        fix: "tight elevation",
        hits: [{ file: "fixture.html", line: 1, text: "box-shadow: 0 30px 80px" }]
      }]
    }))
  `);
  const target = path.join(temp, "fixture.html");
  fs.writeFileSync(target, "<style>.x{box-shadow:0 30px 80px}</style>");
  const adapterReceipt = runKillAiSlop({
    adapterRoot: path.join(temp, "adapter"),
    target,
    version: "test"
  });
  assert.equal(adapterReceipt.status, "pass_with_findings");
  assert.equal(adapterReceipt.summary.hits, 1);
  assert.match(adapterReceipt.artifact_digest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(adapterReceipt.findings[0].disposition, "open");
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

process.stdout.write("KillSlopRouter tests passed\n");
