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
assert.equal(
  operator.stages.find((stage) => stage.id === "rendered-craft-review").routing_status,
  "ready_with_fallback"
);
assert.equal(
  operator.stages.find((stage) => stage.id === "copy-review").routing_status,
  "ready_with_fallback"
);

const consumer = plan({
  surface: "consumer-product-ui",
  task: "build",
  direction: "missing",
  changes: ["source", "copy", "layout"]
}, null);
assert.equal(consumer.creator, "taste-skill");
assert.equal(consumer.status, "blocked");
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

const marketing = plan({
  surface: "marketing-editorial",
  task: "redesign",
  direction: "approved",
  changes: ["copy"]
});
assert.equal(marketing.status, "planned");
assert.equal(
  marketing.stages.find((stage) => stage.id === "copy-review")
    .unavailable_actors.some((actor) => actor.id === "stop-slop" && actor.optional),
  true
);

const noFallbackProfile = structuredClone(profile);
noFallbackProfile.external_adapters["anti-slop"].status = "unavailable";
delete noFallbackProfile.fallback_adapters;
const noFallback = plan({
  surface: "operator-product-ui",
  task: "redesign",
  direction: "approved",
  changes: ["layout", "interaction"]
}, noFallbackProfile);
assert.equal(noFallback.status, "blocked");
assert.equal(
  noFallback.stages.find((stage) => stage.id === "functional-human-review").routing_status,
  "blocked"
);
assert.match(noFallback.unresolved.join("\n"), /functional-human-review blocked/);

const weakFallbackProfile = structuredClone(profile);
weakFallbackProfile.external_adapters["anti-slop"].status = "unavailable";
weakFallbackProfile.fallback_adapters["anti-slop"] = [{
  id: "weak-functional-check",
  kind: "agent",
  status: "routable",
  version: "test:weak",
  target: "reviewers/weak",
  executor: "fresh-agent-review",
  strength: 2,
  capabilities: ["task-fit", "state-completeness", "responsive-review", "accessibility-review", "interaction-review"],
  independent_from_creator: true
}];
const weakFallback = plan({
  surface: "operator-product-ui",
  task: "redesign",
  direction: "approved",
  changes: ["layout", "interaction"]
}, weakFallbackProfile);
assert.equal(weakFallback.status, "blocked");
assert.equal(
  weakFallback.stages.find((stage) => stage.id === "functional-human-review").substitutions.length,
  0
);

const compositeFallbackProfile = structuredClone(profile);
compositeFallbackProfile.external_adapters["anti-slop"].status = "unavailable";
compositeFallbackProfile.fallback_adapters["anti-slop"] = [
  {
    id: "workflow-state-critic",
    kind: "agent",
    status: "routable",
    version: "test:workflow",
    target: "reviewers/workflow",
    executor: "fresh-agent-review",
    strength: 3,
    capabilities: ["task-fit", "state-completeness", "responsive-review"],
    independent_from_creator: true
  },
  {
    id: "accessibility-interaction-critic",
    kind: "browser",
    status: "routable",
    version: "test:accessibility",
    target: "tests/accessibility",
    executor: "browser-review",
    strength: 3,
    capabilities: ["accessibility-review", "interaction-review"],
    independent_from_creator: true
  }
];
const compositeFallback = plan({
  surface: "operator-product-ui",
  task: "redesign",
  direction: "approved",
  changes: ["layout", "interaction"]
}, compositeFallbackProfile);
const compositeStage = compositeFallback.stages.find((stage) => stage.id === "functional-human-review");
assert.equal(compositeFallback.status, "planned");
assert.equal(compositeStage.routing_status, "ready_with_fallback");
assert.equal(compositeStage.substitutions.length, 2);
assert.deepEqual(compositeStage.missing_capabilities, []);

const selfReviewProfile = structuredClone(compositeFallbackProfile);
selfReviewProfile.fallback_adapters["anti-slop"] = [{
  id: "project-design-system",
  kind: "agent",
  status: "routable",
  version: "test:self-review",
  target: "reviewers/project-design-system",
  executor: "fresh-agent-review",
  strength: 4,
  capabilities: ["task-fit", "state-completeness", "responsive-review", "accessibility-review", "interaction-review"],
  independent_from_creator: true
}];
const selfReview = plan({
  surface: "operator-product-ui",
  task: "redesign",
  direction: "approved",
  changes: ["layout", "interaction"]
}, selfReviewProfile);
assert.equal(selfReview.status, "blocked");
assert.match(selfReview.unresolved.join("\n"), /functional-human-review blocked/);

const missingTargetProfile = structuredClone(compositeFallbackProfile);
missingTargetProfile.fallback_adapters["anti-slop"] = [{
  id: "missing-target-functional-critic",
  kind: "agent",
  status: "routable",
  version: "test:missing-target",
  target: "/definitely/missing/killsloprouter-reviewer",
  executor: "fresh-agent-review",
  strength: 4,
  capabilities: ["task-fit", "state-completeness", "responsive-review", "accessibility-review", "interaction-review"],
  independent_from_creator: true
}];
const missingTarget = plan({
  surface: "operator-product-ui",
  task: "redesign",
  direction: "approved",
  changes: ["layout", "interaction"]
}, missingTargetProfile);
assert.equal(missingTarget.status, "blocked");
assert.equal(
  missingTarget.stages.find((stage) => stage.id === "functional-human-review")
    .fallback_candidates[0].availability,
  "blocked-missing-target"
);

const missingRequiredRouter = structuredClone(router);
const operatorRoute = missingRequiredRouter.routes.find((route) => route.id === "operator-product-ui");
operatorRoute.stages = operatorRoute.stages.filter((stage) => stage.id !== "browser-evidence");
const missingRequired = planRoute({
  router: missingRequiredRouter,
  profile,
  input: {
    surface: "operator-product-ui",
    task: "redesign",
    direction: "approved",
    changes: ["layout"],
    risk: "standard"
  }
});
assert.equal(missingRequired.status, "blocked");
assert.match(missingRequired.unresolved.join("\n"), /browser-evidence/);

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
