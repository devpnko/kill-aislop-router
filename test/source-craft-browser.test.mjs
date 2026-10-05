import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { sourceCraftSpace, sourceCraftHost, SOURCE_CRAFT_PRIVATE_MARKER } from "./fixtures/source-craft-space.mjs";
import { startDesignExploration, readDesignState, resumeDesignExploration, validateDesignResult,
  dispatchDesignPackets } from "../src/design.mjs";
import { buildDesignSpecimenComparison, compareDesignSpecimens, validateSpecimenOwnerDecision } from "../src/specimen-comparison.mjs";
import { canonicalDigest } from "../src/integrity.mjs";
import { assertPublishedSchema } from "./fixtures/schema-validation.mjs";

function disposeFixture(space, passed) {
  if (passed) fs.rmSync(space.directory, { recursive: true, force: true });
  else {
    // Preserve the original unexpected native/browser failure privately. No
    // retries, TAP evidence dumps, production assets or invented browser PASS.
    try {
      const parent = path.resolve(".killsloprouter");
      fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
      const lane = fs.mkdtempSync(path.join(parent, "source-craft-browser-failure-"));
      fs.chmodSync(lane, 0o700);
      fs.writeFileSync(path.join(lane, "fixture.json"), JSON.stringify({ synthetic_fixture: space.directory,
        state: space.statePath }), { flag: "wx", mode: 0o600 });
    } catch { /* Preserve the original failure. */ }
  }
}

// Exactly one real official local-browser run. Independent synthetic reviewers
// exercise protocol/rights isolation only, not real quality, source parity,
// human authorship, source license verification or production Owner approval.
test("official single specimen source craft: private independent comparison, replay guards and no Owner autopass", () => {
  const space = sourceCraftSpace();
  let passed = false;
  try {
    const marker = path.join(space.directory, "source-critic-spawned.txt");
    let sawSourceCheckpoint = false;
    const state = startDesignExploration({ ...space,
      hostManifest: sourceCraftHost(space, { sourceCraft: { spawn_marker: marker } }),
      faultInjector: (point, details) => {
        if (point !== "after-child-lease-before-spawn" || details.packet_id !== "source-craft-review") return;
        const checkpoint = JSON.parse(fs.readFileSync(details.state_path));
        assertPublishedSchema("design-exploration-run", checkpoint);
        assert.equal(checkpoint.in_flight.packet_id, "source-craft-review");
        assert.ok(checkpoint.in_flight.execution_authority);
        assert.ok(checkpoint.in_flight.permission_scopes.includes("reference-evidence:read"));
        assert.equal(checkpoint.results.length, 3);
        assert.deepEqual(checkpoint.results.map(item => item.normalized.kind),
          ["direction-candidate", "browser-evidence", "specimen-review"]);
        assert.equal(fs.existsSync(marker), false);
        sawSourceCheckpoint = true;
      } });
    assert.equal(state.phase, "specimen-feedback", `unexpected stage ${state.phase}; results=${state.results.length}`);
    assert.equal(state.status, "manual_pending");
    assert.deepEqual(state.results.map(item => item.normalized.kind),
      ["direction-candidate", "browser-evidence", "specimen-review", "source-craft-review"]);
    assert.equal(state.packets.length, 4);
    assert.equal(sawSourceCheckpoint, true);
    assert.equal(fs.readFileSync(marker, "utf8"), "source-craft-review");
    assert.equal(state.approval, null);
    const creator = state.results.find(item => item.normalized.kind === "direction-candidate");
    const browser = state.results.find(item => item.normalized.kind === "browser-evidence");
    const target = state.results.find(item => item.normalized.kind === "specimen-review");
    const source = state.results.find(item => item.normalized.kind === "source-craft-review");
    const sourcePacket = state.packets.find(item => item.packet_id === source.packet_id);
    const sourceAttempt = state.attempts.find(item => item.packet_id === source.packet_id && item.execution_status === "ran");
    const browserAttempt = state.attempts.find(item => item.packet_id === browser.packet_id && item.execution_status === "ran");
    assert.equal(browserAttempt.adapter, "browser-json-v1");
    assert.ok(browserAttempt.execution_authority);
    assert.ok(sourceAttempt.execution_authority);
    assert.equal(source.normalized.actor.actor_id, space.authority.reviewer_actor_id);
    assert.equal(source.normalized.source_craft_review.candidate_result_digest, creator.result_digest);
    assert.equal(source.normalized.source_craft_review.browser_result_digest, browser.result_digest);
    assert.equal(sourcePacket.design_task.target_review_binding.result_digest, target.result_digest);
    assertPublishedSchema("source-craft-review", source.normalized.source_craft_review);
    assertPublishedSchema("design-result", source.normalized);
    assertPublishedSchema("design-packet", sourcePacket);
    assertPublishedSchema("design-exploration-run", state);
    for (const record of [creator, browser, target]) {
      const attempt = state.attempts.find(item => item.packet_id === record.packet_id && item.execution_status === "ran");
      assert.ok(!attempt.permission_scopes.includes("reference-evidence:read"));
      assert.notEqual(attempt.execution_authority.adapter_entrypoint.graph_digest,
        sourceAttempt.execution_authority.adapter_entrypoint.graph_digest);
    }
    const reportEvidence = source.evidence.find(item => item.evidence_kind === "review-report");
    const privateReport = JSON.parse(fs.readFileSync(reportEvidence.resolved_path));
    assert.deepEqual([...privateReport.source_capture_digests].sort(), [...space.authority.capture_digests].sort());
    assert.deepEqual([...privateReport.prior_result_kinds].sort(), ["browser-evidence", "direction-candidate"]);
    assert.equal(privateReport.private_marker, SOURCE_CRAFT_PRIVATE_MARKER);
    for (const packet of state.packets.filter(item => item.packet_id !== source.packet_id)) {
      const text = JSON.stringify(packet);
      assert.equal(packet.design_task.source_craft_review, undefined);
      for (const secret of [space.authorityPath, space.rightsPath, SOURCE_CRAFT_PRIVATE_MARKER,
        ...privateReport.source_paths]) assert.ok(!text.includes(secret));
    }
    const resumed = resumeDesignExploration(space.statePath);
    assert.equal(resumed.results.length, 4);
    assert.equal(resumed.attempts.length, state.attempts.length);
    assert.equal(resumed.approval, null);
    assert.equal(readDesignState(space.statePath).state_digest, resumed.state_digest);

    const reportPath = path.join(space.directory, "source-craft-comparison.json");
    const comparison = compareDesignSpecimens([space.statePath], reportPath);
    assert.equal(comparison.candidates[0].selectable, true);
    assert.equal(comparison.candidates[0].source_craft_result_digest, source.result_digest);
    assert.equal(comparison.candidates[0].source_craft_review.status, "accepted");
    assert.equal(comparison.candidates[0].source_craft_review.adequacy, "adequate");
    assert.equal(comparison.decision_contract.default_selection, null);
    assert.equal(comparison.source_craft_parity_assessed, false);
    assert.equal(comparison.candidates[0].source_craft_parity_assessed, false);
    assert.equal(fs.existsSync(`${reportPath}.selection.json`), false);
    const publicText = JSON.stringify(comparison);
    for (const secret of [SOURCE_CRAFT_PRIVATE_MARKER, source.normalized.source_craft_review.rationale,
      space.authorityPath, space.rightsPath, reportEvidence.resolved_path, ...privateReport.source_paths]) {
      assert.ok(!publicText.includes(secret));
    }
    assert.ok(comparison.candidates[0].source_craft_review.slots.every(slot =>
      slot.verdict === "adapted" && !Object.hasOwn(slot, "rationale") && !Object.hasOwn(slot, "adaptation_justification")));

    const publicSecrets = [SOURCE_CRAFT_PRIVATE_MARKER, source.normalized.source_craft_review.rationale,
      source.normalized.source_craft_review.slots[0].rationale,
      source.normalized.source_craft_review.slots[0].adaptation_justification,
      space.authorityPath, space.rightsPath, reportEvidence.resolved_path, ...privateReport.source_paths];
    for (const args of [
      ["status", "--run", space.statePath, "--json"],
      ["status", "--run", space.statePath],
      ["run", "--resume", space.statePath, "--json"]
    ]) {
      const child = spawnSync(process.execPath, [path.resolve("bin/killsloprouter.mjs"), "design", ...args], { encoding: "utf8" });
      assert.equal(child.status, args[0] === "run" ? 6 : 0, child.stderr);
      for (const secret of publicSecrets) assert.ok(!`${child.stdout}${child.stderr}`.includes(secret), `CLI leaked private source review via ${args[0]}`);
      if (args.includes("--json")) {
        const summary = JSON.parse(child.stdout);
        assert.equal(summary.design_public_state_version, 1);
        assert.equal(summary.results.length, 4);
        assert.ok(summary.results.every(item => item.normalized === undefined && item.source === undefined && item.evidence === undefined));
        assert.equal(summary.packets.length, 4);
        assert.ok(summary.packets.every(item => item.design_task === undefined));
        assert.equal(summary.source_craft_authority, undefined);
      }
    }
    assert.equal(readDesignState(space.statePath).attempts.length, state.attempts.length);

    const raw = JSON.parse(fs.readFileSync(source.source.resolved_path));
    for (const [label, mutate, expression] of [
      ["packet replay", input => { input.packet_digest = canonicalDigest("another packet"); }, /packet.*digest|binding/],
      ["authority replay", input => { input.source_craft_review.authority_digest = canonicalDigest("another authority"); }, /authority.*binding/],
      ["candidate replay", input => { input.source_craft_review.candidate_result_digest = canonicalDigest("another candidate"); }, /candidate.*binding/],
      ["browser replay", input => { input.source_craft_review.browser_result_digest = canonicalDigest("another browser"); }, /browser.*binding/],
      ["fixed actor alias", input => { input.actor.actor_id = creator.normalized.actor.actor_id; }, /actor|independent|reviewer/],
      ["capture substitution", input => { input.source_craft_review.slots[0].source_capture_digest = canonicalDigest("other capture"); }, /source capture.*binding/],
      ["screenshot substitution", input => { input.source_craft_review.slots[0].target_screenshot_digest = canonicalDigest("other screenshot"); }, /screenshot.*bound/],
      ["locale substitution", input => { input.source_craft_review.slots[0].locale = "unplanned"; }, /locale.*binding/],
      ["invented sufficiency", input => { input.source_craft_review.slots[0].limitations = []; }, /unknown.*disclosed/]
    ]) {
      const changed = structuredClone(raw); mutate(changed);
      assert.throws(() => validateDesignResult(state, sourcePacket, changed, source.source.resolved_path), expression, label);
    }
    const alteredPacketState = structuredClone(state);
    const alteredPacket = alteredPacketState.packets.find(item => item.packet_id === source.packet_id);
    alteredPacket.design_task.source_craft_review.obligations.comparison_slots[0].capture_digest = canonicalDigest("substituted capture");
    const { packet_digest: _old, ...packetBody } = alteredPacket;
    alteredPacket.packet_digest = canonicalDigest(packetBody);
    const dispatchPath = path.join(space.directory, "substituted-source-packet");
    assert.throws(() => dispatchDesignPackets(alteredPacketState, dispatchPath), /exact private authority|source craft|packet/);
    assert.equal(fs.existsSync(dispatchPath), false);

    for (const verdict of ["lost", "unassessed"]) {
      const negative = structuredClone(raw);
      const review = negative.source_craft_review;
      review.adequacy = verdict === "unassessed" ? "insufficient" : "adequate";
      review.slots[0].verdict = verdict;
      review.slots[0].adequacy = review.adequacy;
      review.slots[0].adaptation_justification = null;
      assert.throws(() => validateDesignResult(state, sourcePacket, negative, source.source.resolved_path), /source-craft-unresolved/);
      negative.blockers.push({ candidate_id: space.brief.specimen_feedback.candidate_id,
        code: "source-craft-unresolved", hard: true, message: "Synthetic negative component comparison; no visual approval." });
      const normalized = validateDesignResult(state, sourcePacket, negative, source.source.resolved_path);
      assert.equal(normalized.source_craft_review.slots[0].verdict, verdict);
      // Pure rejected-comparison projection only. No fake official result or
      // rewritten accepted run is ever passed through persistence/ingest.
      const negativeState = structuredClone(state);
      negativeState.status = "blocked";
      negativeState.results.find(item => item.packet_id === source.packet_id).normalized = normalized;
      const blocked = buildDesignSpecimenComparison([negativeState]);
      assert.equal(blocked.candidates[0].selectable, false);
      assert.equal(blocked.candidates[0].source_craft_review.status, "blocked");
      const decision = {
        design_specimen_owner_decision_version: 1, comparison_digest: blocked.comparison_digest,
        owner_id: "synthetic-external-owner", status: "select", selected_run_id: state.run_id,
        observed_render_bindings: blocked.decision_contract.required_render_bindings.map(item => ({ ...item,
          observation: "Synthetic Owner protocol fixture, never production or taste approval." })),
        rationale: "Attempted synthetic selection must not bypass unresolved source craft.",
        planned_expansion: "No expansion until independent blockers are resolved in a separately authorized successor.",
        decided_at: "2026-10-06T00:00:00.000Z", acknowledges_not_final_approval: true
      };
      assert.throws(() => validateSpecimenOwnerDecision(blocked, decision, [negativeState]), /critic-eligible/);
    }

    fs.appendFileSync(privateReport.source_paths[0], "synthetic substituted capture bytes");
    assert.throws(() => readDesignState(space.statePath), /capture|artifact|digest|changed/);
    assert.throws(() => resumeDesignExploration(space.statePath), /capture|artifact|digest|changed/);
    const changedComparison = path.join(space.directory, "changed-capture-comparison.json");
    assert.throws(() => compareDesignSpecimens([space.statePath], changedComparison), /capture|artifact|digest|changed/);
    assert.equal(fs.existsSync(changedComparison), false);
    const failedStatus = spawnSync(process.execPath, [path.resolve("bin/killsloprouter.mjs"), "design", "status",
      "--run", space.statePath, "--json"], { encoding: "utf8" });
    assert.notEqual(failedStatus.status, 0);
    for (const secret of publicSecrets) assert.ok(!`${failedStatus.stdout}${failedStatus.stderr}`.includes(secret),
      "failed CLI status exposed private source capture/report data");
    passed = true;
  } finally { disposeFixture(space, passed); }
});
