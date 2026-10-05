import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { workspace } from "./design-suite.mjs";
import { specimenSpace } from "./fixtures/specimen-space.mjs";
import { startDesignExploration, resumeDesignExploration, dryRunDesignExploration, dispatchDesignPackets, readDesignState, inspectDesignStateLease, recoverDesignStateLease } from "../src/design.mjs";
import { canonicalDigest } from "../src/integrity.mjs";
import { assertPublishedSchema } from "./fixtures/schema-validation.mjs";

test("new specimen start dispatches exactly one planned candidate, resume cannot invent siblings or approval", () => {
  const s = specimenSpace();
  try {
    assertPublishedSchema("design-brief", JSON.parse(fs.readFileSync(s.briefPath)));
    const dry = dryRunDesignExploration(s);
    assert.equal(dry.specimen_feedback.initial_creator_count, 1);
    let state = startDesignExploration(s);
    assert.equal(state.phase, "specimen-generation");
    assert.equal(state.packets.length, 1);
    assert.equal(state.results.length, 0);
    assert.equal(state.approval, null);
    const beforeExpansion = state.state_digest;
    assert.throws(() => resumeDesignExploration(s.statePath, { expandSpecimen: true }), /already recorded specimen feedback/);
    assert.equal(readDesignState(s.statePath).state_digest, beforeExpansion);
    state = resumeDesignExploration(s.statePath);
    assert.equal(state.packets.length, 1);
    const packet = state.packets[0];
    assertPublishedSchema("design-packet", packet);
    const siblingState = structuredClone(state);
    const sibling = structuredClone(packet);
    sibling.packet_id = `direction-${state.brief.directions[1].id}--refine`;
    sibling.design_task.candidate_id = `${state.brief.directions[1].id}--refine`;
    const { packet_digest: _previous, ...siblingBody } = sibling;
    sibling.packet_digest = canonicalDigest(siblingBody);
    siblingState.packets.push(sibling);
    assert.throws(() => dispatchDesignPackets(siblingState, path.join(s.directory, "premature")), /pending specimen cannot dispatch siblings/);
    assert.equal(fs.existsSync(path.join(s.directory, "premature")), false);
    const swapped = structuredClone(state);
    swapped.packets[0].design_task.candidate_id = `${state.brief.directions[1].id}--refine`;
    const { packet_digest: _oldSwap, ...swappedBody } = swapped.packets[0];
    swapped.packets[0].packet_digest = canonicalDigest(swappedBody);
    assert.throws(() => dispatchDesignPackets(swapped, path.join(s.directory, "same-id-substitution")), /exact canonical candidate/);
    assert.equal(fs.existsSync(path.join(s.directory, "same-id-substitution")), false);
    delete packet.design_task.visual_goal_contract;
    const { packet_digest: _old, ...body } = packet;
    packet.packet_digest = canonicalDigest(body);
    assert.throws(() => dispatchDesignPackets(state, path.join(s.directory, "bad")), /exact canonical candidate|visual-goal obligations/);
    assert.equal(fs.existsSync(path.join(s.directory, "bad")), false);
    state = resumeDesignExploration(s.statePath, { abandonSpecimen: true, abandonmentReason: "Direction unsuitable; preserve evidence, no approval." });
    assert.equal(state.phase, "specimen-abandoned");
    assert.deepEqual(state.outputs, {});
    assert.equal(state.specimen_abandonment.owner_approval_granted, false);
    const digest = state.state_digest;
    assert.equal(resumeDesignExploration(s.statePath, { expandSpecimen: true }).state_digest, digest);
    assert.equal(readDesignState(s.statePath).state_digest, digest);
    assert.throws(() => dispatchDesignPackets(state, path.join(s.directory, "abandoned-dispatch")), /terminal/);
  } finally { fs.rmSync(s.directory, { recursive: true, force: true }); }
});

test("lease recovery after a committed abandonment crash preserves terminal rejection and evidence", () => {
  const s = specimenSpace();
  try {
    startDesignExploration(s);
    const crashed = spawnSync(process.execPath, ["--input-type=module", "-e", `
      import { resumeDesignExploration } from './src/design.mjs';
      resumeDesignExploration(process.argv[1], { abandonSpecimen: true,
        abandonmentReason: 'Deterministic crash recovery; no approval.',
        faultInjector(point) { if (point === 'after-state-write-before-lease-commit') process.exit(73); }
      });`, s.statePath], { encoding: "utf8" });
    assert.equal(crashed.status, 73, crashed.stderr);
    const before = readDesignState(s.statePath);
    const lease = inspectDesignStateLease(s.statePath);
    const recovered = recoverDesignStateLease(s.statePath, { ownerToken: lease.owner_token,
      acquiredAt: lease.acquired_at, stateDigest: lease.state_digest });
    assert.equal(recovered.status, "recovered");
    const after = readDesignState(s.statePath);
    assert.equal(after.status, "blocked");
    assert.equal(after.phase, "specimen-abandoned");
    for (const field of ["specimen_abandonment", "blockers", "pending", "packets", "results", "outputs"]) assert.deepEqual(after[field], before[field]);
    assert.equal(resumeDesignExploration(s.statePath).state_digest, after.state_digest);
  } finally { fs.rmSync(s.directory, { recursive: true, force: true }); }
});

test("empty initial specimen checkpoint recovers only its canonical selected creator", () => {
  const s = specimenSpace();
  try {
    const crashed = spawnSync(process.execPath, ["--input-type=module", "-e", `
      import { startDesignExploration } from './src/design.mjs';
      startDesignExploration({ ...JSON.parse(process.argv[1]),
        faultInjector(point) { if (point === 'after-state-write-before-lease-commit') process.exit(73); }
      });`, JSON.stringify(s)], { encoding: "utf8" });
    assert.equal(crashed.status, 73, crashed.stderr);
    assert.equal(readDesignState(s.statePath).packets.length, 0);
    const lease = inspectDesignStateLease(s.statePath);
    recoverDesignStateLease(s.statePath, { ownerToken: lease.owner_token, acquiredAt: lease.acquired_at, stateDigest: lease.state_digest });
    const state = resumeDesignExploration(s.statePath);
    assert.equal(state.phase, "specimen-generation");
    assert.equal(state.packets.length, 1);
    assert.equal(state.packets[0].design_task.candidate_id, state.brief.specimen_feedback.candidate_id);
    assert.equal(state.results.length, 0);
  } finally { fs.rmSync(s.directory, { recursive: true, force: true }); }
});

test("CLI abandonment is terminal nonzero with a reason and does not dispatch or fabricate accepted siblings", () => {
  const s = specimenSpace();
  try {
    startDesignExploration(s);
    const result = spawnSync(process.execPath, [path.resolve("bin/killsloprouter.mjs"), "design", "run", "--resume", s.statePath,
      "--abandon-specimen", "--reason", "Owner-facing direction remains unresolved.", "--json"], { encoding: "utf8" });
    assert.notEqual(result.status, 0);
    const state = readDesignState(s.statePath);
    assert.equal(state.phase, "specimen-abandoned", result.stderr);
    assert.equal(state.results.length, 0);
  } finally { fs.rmSync(s.directory, { recursive: true, force: true }); }
});

test("recipe-backed new starts require visual goals and specimen reviewer independence; legacy default remains nine", () => {
  const s = specimenSpace();
  try {
    const brief = JSON.parse(fs.readFileSync(s.briefPath));
    brief.providers.specimen_reviewer = brief.directions[0].creator_provider_id;
    fs.writeFileSync(s.briefPath, JSON.stringify(brief));
    assert.throws(() => startDesignExploration(s), /independent/);
    delete brief.specimen_feedback; delete brief.providers.specimen_reviewer; delete brief.visual_goal_contract;
    fs.writeFileSync(s.briefPath, JSON.stringify(brief));
    assert.throws(() => startDesignExploration(s), /visual goal contract is missing/);
    assert.equal(fs.existsSync(s.statePath), false);
  } finally { fs.rmSync(s.directory, { recursive: true, force: true }); }
  const legacy = workspace();
  try {
    const state = startDesignExploration({ ...legacy, baselinePath: legacy.baseline, root: legacy.directory });
    assert.equal(state.packets.length, 9);
    assert.throws(() => resumeDesignExploration(legacy.statePath, { abandonSpecimen: true, abandonmentReason: "no retrofit" }), /brief-bound specimen checkpoint/);
  } finally { fs.rmSync(legacy.directory, { recursive: true, force: true }); }
});
