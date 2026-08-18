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
const routedProfileDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-route-profiles-"));
let routedProfileIndex = 0;
process.on("exit", () => fs.rmSync(routedProfileDirectory, { recursive: true, force: true }));

function materializeProfileReferences(selectedProfile) {
  if (!selectedProfile) return null;
  const materialized = structuredClone(selectedProfile);
  const profileBase = path.dirname(profilePath);
  if (materialized.design_system?.authority_receipt &&
    !path.isAbsolute(materialized.design_system.authority_receipt)) {
    materialized.design_system.authority_receipt = path.resolve(
      profileBase,
      materialized.design_system.authority_receipt
    );
  }
  if (materialized.planning?.receipt && !path.isAbsolute(materialized.planning.receipt)) {
    materialized.planning.receipt = path.resolve(profileBase, materialized.planning.receipt);
  }
  for (const [surface, receipt] of Object.entries(materialized.planning?.surface_receipts || {})) {
    if (!path.isAbsolute(receipt)) {
      materialized.planning.surface_receipts[surface] = path.resolve(profileBase, receipt);
    }
  }
  return materialized;
}

function bindProfileSurface(selectedProfile, surface) {
  const rebound = structuredClone(selectedProfile);
  rebound.surface_contract = {
    surface_contract_version: 1,
    primary: surface,
    allowed: [surface],
    artifact_bindings: [{ root: ".", surface }]
  };
  rebound.surface_overrides = rebound.surface_overrides?.[surface]
    ? { [surface]: rebound.surface_overrides[surface] }
    : {};
  if (rebound.planning?.surface_receipts) {
    const receipt = rebound.planning.surface_receipts[surface];
    rebound.planning.surface_receipts = receipt ? { [surface]: receipt } : {};
  }
  return rebound;
}

function plan(input, selectedProfile) {
  const selected = arguments.length < 2 ? bindProfileSurface(profile, input.surface) : selectedProfile;
  const routedProfile = materializeProfileReferences(selected);
  if (!routedProfile) {
    return planRoute({ router, profile: null, input, routerPath, profilePath: null });
  }
  const routedProfilePath = path.join(routedProfileDirectory, `${routedProfileIndex += 1}.json`);
  fs.writeFileSync(routedProfilePath, `${JSON.stringify(routedProfile, null, 2)}\n`);
  return planRoute({
    router,
    profile: routedProfile,
    input,
    routerPath,
    profilePath: routedProfilePath
  });
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

const systemize = plan({
  surface: "operator-product-ui",
  task: "systemize",
  direction: "approved",
  changes: ["source", "style", "layout", "interaction", "state"]
});
assert.equal(systemize.status, "planned");
assert.equal(systemize.creator, "project-systemizer");
assert.equal(systemize.route_id, "design-system-extraction");
assert.equal(systemize.planning_gate.status, "ready");
assert.deepEqual(systemize.planning_gate.requirements.map((item) => item.gate), ["G6T", "G7"]);
assert.equal(systemize.stages.some((stage) => stage.id === "system-contract-review"), true);

const noPlanningProfile = structuredClone(profile);
delete noPlanningProfile.planning;
const blockedSystemize = plan({
  surface: "operator-product-ui",
  task: "systemize",
  direction: "approved",
  changes: ["style", "layout"]
}, noPlanningProfile);
assert.equal(blockedSystemize.status, "blocked");
assert.match(blockedSystemize.unresolved.join("\n"), /no planning receipt/);

const planningRequiredProfile = structuredClone(profile);
planningRequiredProfile.planning.required = true;
const consumerPlanningProfile = bindProfileSurface(planningRequiredProfile, "consumer-product-ui");
const consumerPlanningBlocked = plan({
  surface: "consumer-product-ui",
  task: "runtime-handoff",
  direction: "approved",
  changes: ["interaction"]
}, consumerPlanningProfile);
assert.equal(consumerPlanningBlocked.status, "blocked");
assert.match(consumerPlanningBlocked.unresolved.join("\n"), /no planning receipt/);

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

const commandProfile = structuredClone(profile);
commandProfile.external_adapters["anti-slop"].command = "touch /tmp/must-not-run";
assert.throws(() => plan({
  surface: "operator-product-ui",
  task: "redesign",
  direction: "approved",
  changes: ["layout"]
}, commandProfile), /command is forbidden/);

const changedDesignAuthorityProfile = structuredClone(profile);
changedDesignAuthorityProfile.design_system.authority_digest = `sha256:${"0".repeat(64)}`;
const changedDesignAuthority = plan({
  surface: "operator-product-ui",
  task: "redesign",
  direction: "approved",
  changes: ["style"]
}, changedDesignAuthorityProfile);
assert.equal(changedDesignAuthority.status, "blocked");
assert.match(changedDesignAuthority.unresolved.join("\n"), /authority is digest-mismatch/);

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

const rejectedCli = spawnSync(process.execPath, [
  path.join(root, "bin", "killsloprouter.mjs"),
  "plan",
  "--profile", profilePath,
  "--surface", "consumer-product-ui",
  "--task", "audit",
  "--format", "json"
], { encoding: "utf8" });
assert.equal(rejectedCli.status, 3, rejectedCli.stderr);
assert.match(rejectedCli.stderr, /surface mismatch/);

const inferredCli = spawnSync(process.execPath, [
  path.join(root, "bin", "killsloprouter.mjs"),
  "plan",
  "--profile", profilePath,
  "--task", "audit",
  "--format", "json"
], { encoding: "utf8" });
assert.equal(inferredCli.status, 0, inferredCli.stderr);
assert.equal(JSON.parse(inferredCli.stdout).input.surface, "operator-product-ui");

const surfaceFixture = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-surface-contract-"));
try {
  fs.mkdirSync(path.join(surfaceFixture, "apps", "erp"), { recursive: true });
  fs.mkdirSync(path.join(surfaceFixture, "apps", "customer"), { recursive: true });
  fs.mkdirSync(path.join(surfaceFixture, "..legit"), { recursive: true });
  fs.writeFileSync(path.join(surfaceFixture, "apps", "erp", "screen.html"), "<p>ERP</p>\n");
  fs.writeFileSync(path.join(surfaceFixture, "apps", "customer", "screen.html"), "<p>Portal</p>\n");
  fs.writeFileSync(path.join(surfaceFixture, "..legit", "screen.html"), "<p>Legitimate path</p>\n");
  const multiSurfaceProfile = structuredClone(profile);
  multiSurfaceProfile.surface_contract = {
    surface_contract_version: 1,
    primary: "operator-product-ui",
    allowed: ["operator-product-ui", "consumer-product-ui"],
    artifact_bindings: [
      { root: ".", surface: "operator-product-ui" },
      { root: "apps/customer", surface: "consumer-product-ui" }
    ]
  };
  multiSurfaceProfile.surface_overrides = {
    "operator-product-ui": profile.surface_overrides["operator-product-ui"]
  };

  const portalPlan = planRoute({
    router,
    profile: multiSurfaceProfile,
    input: { task: "audit", direction: "none", changes: ["source"] },
    artifacts: ["apps/customer/screen.html"],
    root: surfaceFixture
  });
  assert.equal(portalPlan.input.surface, "consumer-product-ui");
  assert.equal(portalPlan.surface_resolution.artifact_bindings[0].binding_root, "apps/customer");

  const dottedPathPlan = planRoute({
    router,
    profile: multiSurfaceProfile,
    input: { task: "audit", direction: "none", changes: ["source"] },
    artifacts: ["..legit/screen.html"],
    root: surfaceFixture
  });
  assert.equal(dottedPathPlan.input.surface, "operator-product-ui");

  assert.throws(() => planRoute({
    router,
    profile: multiSurfaceProfile,
    input: {
      surface: "operator-product-ui",
      task: "audit",
      direction: "none",
      changes: ["source"]
    },
    artifacts: ["apps/customer/screen.html"],
    root: surfaceFixture
  }), /surface mismatch: contract resolved consumer-product-ui/);

  assert.throws(() => planRoute({
    router,
    profile: multiSurfaceProfile,
    input: { task: "audit", direction: "none", changes: ["source"] },
    artifacts: ["apps/erp/screen.html", "apps/customer/screen.html"],
    root: surfaceFixture
  }), /artifacts resolve to multiple surfaces/);

  assert.throws(() => planRoute({
    router,
    profile: multiSurfaceProfile,
    input: { task: "audit", direction: "none", changes: ["source"] },
    root: surfaceFixture
  }), /provide --artifact/);

  const duplicateBindingProfile = structuredClone(multiSurfaceProfile);
  duplicateBindingProfile.surface_contract.artifact_bindings.push({
    root: "apps/customer",
    surface: "operator-product-ui"
  });
  assert.throws(() => planRoute({
    router,
    profile: duplicateBindingProfile,
    input: { task: "audit", direction: "none", changes: [] },
    artifacts: ["apps/customer/screen.html"],
    root: surfaceFixture
  }), /duplicate artifact root/);

  fs.symlinkSync("customer", path.join(surfaceFixture, "apps", "customer-link"), "dir");
  assert.throws(() => planRoute({
    router,
    profile: multiSurfaceProfile,
    input: { task: "audit", direction: "none", changes: ["source"] },
    artifacts: ["apps/customer-link/screen.html"],
    root: surfaceFixture
  }), /surface routing artifact path contains a symlink/);
} finally {
  fs.rmSync(surfaceFixture, { recursive: true, force: true });
}

const legacyProfile = structuredClone(profile);
delete legacyProfile.surface_contract;
assert.throws(() => plan({
  surface: "operator-product-ui",
  task: "redesign",
  direction: "approved",
  changes: ["layout"]
}, legacyProfile), /surface_contract is required/);

const mismatchedProfileObject = structuredClone(profile);
mismatchedProfileObject.project_id = "not-the-profile-file";
assert.throws(() => planRoute({
  router,
  profile: mismatchedProfileObject,
  profilePath,
  input: { task: "audit", direction: "none", changes: [] }
}), /profile object does not match profile_path/);

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
