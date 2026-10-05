import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { host } from "./design-suite.mjs";
import { specimenSpace } from "./fixtures/specimen-space.mjs";
import { startDesignExploration, resumeDesignExploration, validateDesignResult, readDesignState, dispatchDesignPackets } from "../src/design.mjs";
import { canonicalDigest, hashArtifact } from "../src/integrity.mjs";
import { assertPublishedSchema } from "./fixtures/schema-validation.mjs";

// Official local browser, synthetic external creator/critic. Critic messages
// test workflow and enforcement, not actual beauty or an Owner decision.
for (const verdict of ["rejected", "satisfied"]) test(`single official specimen ${verdict}: no fake siblings, persistent goal judgment, explicit continuation`, () => {
  const s = specimenSpace();
  try {
    const manifest = host(s.directory, { specimenReview: { visual_goal_verdict: verdict } });
    let state = startDesignExploration({ ...s, hostManifest: manifest });
    assert.equal(state.phase, "specimen-feedback", JSON.stringify({ phase: state.phase, status: state.status, blockers: state.blockers }));
    assert.equal(state.results.length, 3);
    assert.equal(state.packets.length, 3);
    assert.equal(state.results.filter(r => r.normalized.kind === "direction-candidate").length, 1);
    const browser = state.results.find(r => r.normalized.kind === "browser-evidence");
    const attempt = state.attempts.find(a => a.packet_id === browser.packet_id && a.execution_status === "ran");
    assert.equal(attempt.adapter, "browser-json-v1");
    assert.equal(attempt.adapter_entrypoint.digest, hashArtifact(path.resolve("src/adapters/playwright-browser.mjs")));
    const packet = state.packets.find(p => p.packet_id === "specimen-review");
    const result = state.results.find(r => r.packet_id === packet.packet_id);
    assertPublishedSchema("design-packet", packet);
    const input = JSON.parse(fs.readFileSync(result.source.resolved_path));
    assertPublishedSchema("design-result", input);
    assert.equal(result.normalized.visual_goal_review.candidates[0].local_regression.status, "closed");
    assert.equal(result.normalized.visual_goal_review.candidates[0].goals[0].verdict, verdict);
    assert.equal(packet.design_task.reference_intelligence.audience, "specimen-reviewer");
    assert.equal(packet.design_task.reference_intelligence.review_source_authority, undefined);
    assert.equal(state.approval, null);
    assert.deepEqual(state.outputs, {});
    for (const [mutate, pattern] of [
      [x => { delete x.visual_goal_review; }, /visual goal/],
      [x => { x.visual_goal_review.candidates[0].goals[0].verdict = "rejected"; x.blockers = []; }, /persistent hard blocker/],
      [x => { x.actor.actor_id = state.results[0].normalized.actor.actor_id; }, /creator cannot review/],
      [x => { x.actor.actor_id = browser.normalized.actor.actor_id; }, /browser actor cannot review/],
      [x => { x.visual_goal_review.candidates[0].browser_result_digest = canonicalDigest("stale"); }, /binding mismatch/],
      [x => { x.scores = []; }, /aggregate/],
      [x => { x.visual_goal_review.candidates[0].preserve_instructions = [{ relationship_id: "identity-value-treatment", mode: "bound-obligation", text: "Keep the unapproved skin.", decision_digest: canonicalDigest(state.brief.component_craft.relationships[0].decision) }]; }, /unsupported preserve/]
    ]) {
      const bad = structuredClone(input); mutate(bad);
      assert.throws(() => validateDesignResult(state, packet, bad, result.source.resolved_path), pattern);
    }
    const tampered = structuredClone(state);
    const badPacket = tampered.packets.find(p => p.packet_id === "specimen-review");
    badPacket.required_permissions.push("reference-evidence:read");
    const { packet_digest: _old, ...body } = badPacket;
    badPacket.packet_digest = canonicalDigest(body);
    assert.throws(() => dispatchDesignPackets(tampered, path.join(s.directory, "leaked")), /target-only permissions/);
    assert.equal(fs.existsSync(path.join(s.directory, "leaked")), false);
    const changedSubject = structuredClone(state);
    const changedBrowser = changedSubject.packets.find(p => p.design_task.kind === "browser-evidence");
    changedBrowser.design_task.subject_result_digest = canonicalDigest("different candidate");
    const { packet_digest: _previous, ...changedBody } = changedBrowser;
    changedBrowser.packet_digest = canonicalDigest(changedBody);
    assert.throws(() => dispatchDesignPackets(changedSubject, path.join(s.directory, "browser-substitution")), /packet-bound accepted attempt/);
    // Before the review packet exists there is no reviewer binding to catch it;
    // the selected browser's own canonical comparison must still reject it.
    changedSubject.packets = changedSubject.packets.filter(p => p.packet_id !== "specimen-review");
    changedSubject.results = changedSubject.results.filter(r => r.packet_id !== "specimen-review");
    changedSubject.attempts = changedSubject.attempts.filter(a => a.packet_id !== "specimen-review");
    assert.throws(() => dispatchDesignPackets(changedSubject, path.join(s.directory, "pre-review-browser-substitution")), /exact accepted candidate/);
    state = resumeDesignExploration(s.statePath);
    assert.equal(state.phase, "specimen-feedback");
    assert.equal(state.packets.length, 3);
    const expansionCheckpoints = [];
    state = resumeDesignExploration(s.statePath, { expandSpecimen: true, faultInjector(point) {
      if (point !== "after-state-write-before-lease-commit") return;
      const snapshot = JSON.parse(fs.readFileSync(s.statePath));
      if (snapshot.specimen_expansion) expansionCheckpoints.push(snapshot.packets.filter(p => p.design_task.kind === "direction-candidate").length);
    } });
    if (verdict === "rejected") {
      assert.equal(state.status, "blocked");
      assert.equal(state.packets.length, 3);
      assert.equal(state.specimen_expansion, undefined);
      state = resumeDesignExploration(s.statePath, { abandonSpecimen: true, abandonmentReason: "Reject direction despite passing technical checks." });
      assert.equal(state.phase, "specimen-abandoned");
    } else {
      assert.equal(state.phase, "direction-generation"); // No host supplied: eight remain pending, not fake accepted.
      assert.equal(state.packets.filter(p => p.design_task.kind === "direction-candidate").length, 9);
      assert.equal(state.results.length, 3);
      assert.equal(state.specimen_expansion.review_result_digest, result.result_digest);
      assert.equal(state.specimen_expansion.owner_approval_granted, false);
      assert.ok(expansionCheckpoints.length > 0);
      assert.ok(expansionCheckpoints.every(count => count === 9), "no intermediate expansion-only checkpoint may survive a crash");
    }
    assert.equal(readDesignState(s.statePath).state_digest, state.state_digest);
  } finally { fs.rmSync(s.directory, { recursive: true, force: true }); }
});
