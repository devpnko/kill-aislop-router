import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { workspace, attachReferencePack, host } from "./design-suite.mjs";
import { startDesignExploration, dryRunDesignExploration, readDesignState, dispatchDesignPackets,
  designReferenceDelivery } from "../src/design.mjs";
import { canonicalDigest, hashArtifact } from "../src/integrity.mjs";
import { assertPublishedSchema } from "./fixtures/schema-validation.mjs";

function setup() {
  const space = workspace();
  const brief = JSON.parse(fs.readFileSync(space.briefPath));
  brief.evidence.required_viewports = ["mobile", "tablet", "desktop"];
  fs.writeFileSync(space.briefPath, JSON.stringify(brief));
  attachReferencePack(space, null, { componentRecipes: true });
  return { ...space, baselinePath: space.baseline, root: space.directory };
}

test("new API and CLI starts stop missing target appearance coverage before creator dispatch", () => {
  const space = setup();
  try {
    const brief = JSON.parse(fs.readFileSync(space.briefPath));
    delete brief.component_craft;
    fs.writeFileSync(space.briefPath, JSON.stringify(brief));
    assert.throws(() => dryRunDesignExploration(space), /component craft coverage is missing/);
    assert.throws(() => startDesignExploration(space), /component craft coverage is missing/);
    assert.equal(fs.existsSync(space.statePath), false);
    const result = spawnSync(process.execPath, [path.resolve("bin/killsloprouter.mjs"), "design", "run", "--brief", space.briefPath,
      "--baseline", space.baseline, "--out", space.statePath, "--dry-run", "--json"], { encoding: "utf8", cwd: space.directory });
    assert.equal(result.status, 5, result.stderr);
    assert.match(result.stderr, /component craft coverage is missing/);
    assert.equal(fs.existsSync(space.statePath), false);
  } finally { fs.rmSync(space.directory, { recursive: true, force: true }); }
});

test("actual creator packets/resume preserve target obligations and reject re-sealed packet loss", () => {
  const space = setup();
  try {
    const state = startDesignExploration(space);
    assert.equal(state.status, "manual_pending");
    assert.equal(state.attempts.some((attempt) => attempt.execution_status === "ran"), false);
    assert.equal(designReferenceDelivery(state).target_craft.status, "bound-review-required");
    const historicalReport = designReferenceDelivery({ ...state, brief: { ...state.brief, component_craft: undefined } });
    assert.equal(historicalReport.target_craft.status, "legacy-unassessed"); // Derived report, not a rewritten run.
    for (const packet of state.packets) {
      assertPublishedSchema("design-packet", packet);
      assert.deepEqual(packet.design_task.reference_intelligence.component_recipe_contract.target_craft.obligations.parts, state.brief.component_craft.parts);
      assert.doesNotMatch(JSON.stringify(packet), /flowdesk|marketline|proofgrid|source-capture|uibowl\.io/);
    }
    assert.equal(readDesignState(space.statePath).state_digest, state.state_digest);
    state.packets[0].design_task.reference_intelligence.component_recipe_contract.target_craft.obligations.parts.pop();
    const { packet_digest: _old, ...body } = state.packets[0];
    state.packets[0].packet_digest = canonicalDigest(body);
    assert.throws(() => dispatchDesignPackets(state, path.join(space.directory, "bad-packets")), /final participant packet/);
    assert.equal(fs.existsSync(path.join(space.directory, "bad-packets")), false);
  } finally { fs.rmSync(space.directory, { recursive: true, force: true }); }
});

for (const omitted of [false, true]) test(`real child creator ingest ${omitted ? "blocks omitted" : "accepts bound"} target craft, with no browser grant`, () => {
  const space = setup();
  try {
    const manifest = host(space.directory, { direction: { omit_target_craft: omitted } }, (value) => {
      // Missing adapter is intentionally pending, never substitute a fake official result.
      delete value.providers["browser-evidence"];
      value.allowed_providers = value.allowed_providers.filter((key) => key !== "browser-evidence");
    });
    const state = startDesignExploration({ ...space, hostManifest: manifest });
    assert.equal(state.results.filter((item) => item.normalized.kind === "direction-candidate").length, omitted ? 0 : 9,
      JSON.stringify(state.blockers));
    if (omitted) assert.match(state.blockers.join(" "), /component craft.*implementation/);
    else assert.equal(state.phase, "direction-browser-evidence");
    assert.equal(state.results.some((item) => item.normalized.kind === "browser-evidence"), false);
    assert.equal(state.attempts.some((item) => item.packet_id.startsWith("browser-") && item.execution_status === "ran"), false);
    assert.equal(readDesignState(space.statePath).state_digest, state.state_digest);
  } finally { fs.rmSync(space.directory, { recursive: true, force: true }); }
});

test("reviewer constraint cannot ride the baseline artifact grant into a creator", () => {
  const space = setup();
  try {
    const target = path.join(space.baseline, "constraint.json");
    fs.writeFileSync(target, JSON.stringify({ claim: "Synthetic target contrast constraint, not Owner approval." }));
    const brief = JSON.parse(fs.readFileSync(space.briefPath));
    brief.component_craft.constraint_evidence = [{ evidence_id: "target-rule", path: "project/constraint.json",
      digest: hashArtifact(target), relationship_ids: ["identity-value-treatment"] }];
    fs.writeFileSync(space.briefPath, JSON.stringify(brief));
    assert.throws(() => dryRunDesignExploration(space), /outside the creator-readable baseline/);
    assert.throws(() => startDesignExploration(space), /outside the creator-readable baseline/);
    assert.equal(fs.existsSync(space.statePath), false);
    // Same evidence/constraint, safely outside the creator grant. No browser or child is launched.
    const privateTarget = path.join(space.directory, "constraint.json");
    fs.renameSync(target, privateTarget);
    brief.component_craft.constraint_evidence[0].path = "constraint.json";
    fs.writeFileSync(space.briefPath, JSON.stringify(brief));
    const state = startDesignExploration(space);
    assert.equal(state.status, "manual_pending");
    assert.equal(state.attempts.some((attempt) => attempt.execution_status === "ran"), false);
    assert.doesNotMatch(JSON.stringify(state.packets), /constraint\.json/);
    state.packets[0].design_task.reference_intelligence.component_recipe_contract.target_constraint_evidence =
      brief.component_craft.constraint_evidence;
    const { packet_digest: _old, ...body } = state.packets[0];
    state.packets[0].packet_digest = canonicalDigest(body);
    assert.throws(() => dispatchDesignPackets(state, path.join(space.directory, "leaked-packet")),
      /reviewer-only target constraint evidence/);
    assert.equal(fs.existsSync(path.join(space.directory, "leaked-packet")), false);
  } finally { fs.rmSync(space.directory, { recursive: true, force: true }); }
});
