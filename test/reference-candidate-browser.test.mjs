import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { referenceCandidateSpace } from "./fixtures/reference-candidate-space.mjs";
import { host } from "./design-suite.mjs";
import { startDesignExploration, readDesignState, resumeDesignExploration, validateDesignResult } from "../src/design.mjs";
import { compareDesignSpecimens, selectDesignSpecimen } from "../src/specimen-comparison.mjs";
import { sha256 } from "../src/integrity.mjs";

function disposeFixture(s, passed) {
  if (passed) fs.rmSync(s.directory, { recursive: true, force: true });
  else {
    // Preserve unexpected native errors privately, with no retry or TAP leak.
    try {
      const parent = path.resolve(".killsloprouter");
      fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
      const lane = fs.mkdtempSync(path.join(parent, "reference-browser-failure-"));
      fs.chmodSync(lane, 0o700);
      fs.writeFileSync(path.join(lane, "fixture.json"), JSON.stringify({ synthetic_fixture: s.directory, state: s.statePath }), { flag: "wx", mode: 0o600 });
    } catch { /* Retention must not mask the original failure. */ }
  }
}

// Real official local browser; synthetic, independent creator/critic protocol
// and Owner messages. This does NOT test actual human taste or project approval.
test("one primary specimen: official browser, locale review, immutable Owner handoff without phantom siblings", () => {
  const s = referenceCandidateSpace();
  let passed = false;
  try {
    const state = startDesignExploration({ ...s, hostManifest: host(s.directory) });
    assert.equal(state.phase, "specimen-feedback", `unexpected stage ${state.phase}; results=${state.results.length}`);
    assert.equal(state.status, "manual_pending");
    assert.equal(state.results.length, 3);
    assert.equal(state.packets.length, 3);
    const browser = state.results.find(r => r.normalized.kind === "browser-evidence");
    const critic = state.results.find(r => r.normalized.kind === "specimen-review");
    const attempt = state.attempts.find(a => a.packet_id === browser.packet_id && a.execution_status === "ran");
    assert.equal(attempt.adapter, "browser-json-v1");
    assert.ok(attempt.execution_authority);
    assert.ok(critic.normalized.constraint_audit_review);
    const critiqueInput = JSON.parse(fs.readFileSync(critic.source.resolved_path));
    const negative = structuredClone(critiqueInput);
    negative.constraint_audit_review.entries[0].supported = false;
    const critiquePacket = state.packets.find(p => p.packet_id === critic.packet_id);
    assert.throws(() => validateDesignResult(state, critiquePacket, negative, critic.source.resolved_path), /constraint-audit-unresolved/);
    negative.blockers.push({ candidate_id: s.brief.specimen_feedback.candidate_id,
      code: "constraint-audit-unresolved", hard: true, message: "Synthetic unsupported preservation must remain unresolved." });
    assert.equal(validateDesignResult(state, critiquePacket, negative, critic.source.resolved_path)
      .constraint_audit_review.entries[0].supported, false);
    const observation = critic.normalized.visual_goal_review.candidates[0].goals[0].observations;
    assert.equal(observation.length, s.brief.locales.length * s.brief.evidence.required_states.length * s.brief.evidence.required_viewports.length);
    assert.deepEqual([...new Set(observation.map(o => o.locale))].sort(), [...s.brief.locales].sort());
    const reportPath = path.join(s.directory, "comparison.json");
    const report = compareDesignSpecimens([s.statePath], reportPath);
    assert.equal(report.candidates[0].selectable, true);
    assert.equal(report.decision_contract.default_selection, null);
    const decisionPath = path.join(s.directory, "synthetic-owner.json");
    const decision = {
      design_specimen_owner_decision_version: 1, comparison_digest: report.comparison_digest,
      owner_id: "synthetic-external-owner", status: "select", selected_run_id: state.run_id,
      observed_render_bindings: report.decision_contract.required_render_bindings.map(item => ({ ...item, observation: "Synthetic external choice for protocol testing only, not a taste assessment." })),
      rationale: "Synthetic selection does not establish source parity or approve production.",
      planned_expansion: "Keep the frozen target treatment while planning a separately authorized successor.",
      decided_at: "2026-10-05T00:00:00.000Z", acknowledges_not_final_approval: true
    };
    fs.writeFileSync(decisionPath, JSON.stringify(decision));
    const receipt = selectDesignSpecimen(reportPath, decisionPath);
    const frozen = receipt.selected.frozen_artifact;
    assert.equal(sha256(Buffer.from(frozen.content_base64, "base64")), frozen.digest);
    assert.equal(receipt.selected.critic_result_digest, critic.result_digest);
    assert.equal(receipt.selected.browser_result_digest, browser.result_digest);
    assert.equal(receipt.owner_selection_granted, true);
    assert.equal(receipt.final_design_approval_granted, false);
    assert.equal(receipt.design_system_approval_granted, false);
    assert.equal(receipt.source_craft_parity_assessed, false);
    assert.equal(receipt.selected.successor_plan.automatic_expansion_authorized, false);
    assert.equal(readDesignState(s.statePath).state_digest, state.state_digest);
    assert.throws(() => resumeDesignExploration(s.statePath, { expandSpecimen: true }), /cannot expand/);
    assert.throws(() => selectDesignSpecimen(reportPath, decisionPath), /cannot be overwritten/);
    assert.equal(readDesignState(s.statePath).approval, null);
    passed = true;
  } finally { disposeFixture(s, passed); }
});

test("negative provenance survives official browser PASS, persisted ingest, resume and cohort comparison", () => {
  const s = referenceCandidateSpace();
  let passed = false;
  try {
    const state = startDesignExploration({ ...s,
      hostManifest: host(s.directory, { specimenReview: { constraint_audit_supported: false } }) });
    assert.equal(state.phase, "specimen-feedback", `unexpected stage ${state.phase}; results=${state.results.length}`);
    assert.equal(state.status, "blocked");
    assert.equal(state.results.length, 3);
    const critic = state.results.find(r => r.normalized.kind === "specimen-review");
    assert.equal(critic.normalized.constraint_audit_review.entries[0].supported, false);
    assert.ok(critic.normalized.blockers.some(b => b.hard && b.code === "constraint-audit-unresolved"));
    const resumed = resumeDesignExploration(s.statePath);
    assert.equal(resumed.status, "blocked");
    assert.equal(resumed.results.length, 3);
    assert.equal(resumed.attempts.length, state.attempts.length);
    const report = compareDesignSpecimens([s.statePath], path.join(s.directory, "blocked-comparison.json"));
    assert.equal(report.candidates[0].disposition, "critic-rejected");
    assert.equal(report.candidates[0].selectable, false);
    assert.equal(report.candidates[0].critic_feedback.constraint_audit_review.entries[0].supported, false);
    assert.equal(report.decision_contract.default_selection, null);
    assert.equal(resumed.approval, null);
    passed = true;
  } finally { disposeFixture(s, passed); }
});

test("two rendered specimens require whole-cohort evidence before exact selected HTML handoff", () => {
  // Same synthetic primary reference, two actual browser runs: cohort protocol
  // coverage only, not proof of distinct reference hypotheses or visual quality.
  const spaces = [referenceCandidateSpace({ count: 2 }), referenceCandidateSpace({ count: 2 })];
  let passed = false;
  try {
    for (const s of spaces) {
      s.brief.reference_candidate.planned_state_paths = spaces.map(item => item.statePath);
      fs.writeFileSync(s.briefPath, JSON.stringify(s.brief));
    }
    const states = spaces.map(s => startDesignExploration({ ...s, hostManifest: host(s.directory) }));
    for (const state of states) {
      assert.equal(state.phase, "specimen-feedback", `unexpected stage ${state.phase}; results=${state.results.length}`);
      assert.equal(state.status, "manual_pending");
      assert.equal(state.results.length, 3);
      const browser = state.results.find(item => item.normalized.kind === "browser-evidence");
      const attempt = state.attempts.find(item => item.packet_id === browser.packet_id && item.execution_status === "ran");
      assert.equal(attempt.adapter, "browser-json-v1");
      assert.ok(attempt.execution_authority);
    }
    const reportPath = path.join(spaces[0].directory, "rendered-cohort.json");
    assert.throws(() => compareDesignSpecimens([spaces[0].statePath], reportPath), /planned|cohort/);
    assert.equal(fs.existsSync(reportPath), false);
    const report = compareDesignSpecimens(spaces.map(s => s.statePath), reportPath);
    assert.equal(report.candidates.length, 2);
    assert.ok(report.candidates.every(item => item.selectable));
    assert.equal(report.decision_contract.required_render_bindings.length, 2);
    assert.equal(report.decision_contract.default_selection, null);
    assert.equal(new Set(report.candidates.map(item => item.executed_browser_contract_digest)).size, 1);
    assert.equal(new Set(report.candidates.map(item => item.render_binding_digest)).size, 2);

    const decisionPath = path.join(spaces[0].directory, "synthetic-cohort-owner.json");
    const decision = {
      design_specimen_owner_decision_version: 1, comparison_digest: report.comparison_digest,
      owner_id: "synthetic-external-owner", status: "select", selected_run_id: states[1].run_id,
      observed_render_bindings: report.decision_contract.required_render_bindings.map(item => ({
        ...item, observation: "Synthetic whole-cohort protocol observation, not taste or project approval."
      })),
      rationale: "Select the second synthetic run without discarding the first run's rendered evidence.",
      planned_expansion: "A separate authorized successor must verify the selected baseline and dependencies.",
      decided_at: "2026-10-05T00:00:00.000Z", acknowledges_not_final_approval: true
    };
    fs.writeFileSync(decisionPath, JSON.stringify({ ...decision,
      observed_render_bindings: decision.observed_render_bindings.slice(0, 1) }));
    assert.throws(() => selectDesignSpecimen(reportPath, decisionPath), /every actually rendered candidate/);
    assert.equal(fs.existsSync(`${reportPath}.selection.json`), false);
    fs.writeFileSync(decisionPath, JSON.stringify(decision));
    const receipt = selectDesignSpecimen(reportPath, decisionPath);
    const chosen = report.candidates.find(item => item.run_id === states[1].run_id);
    assert.equal(receipt.selected.run_id, states[1].run_id);
    assert.equal(receipt.selected.browser_result_digest, chosen.browser_result_digest);
    assert.equal(receipt.selected.critic_result_digest, chosen.critic_result_digest);
    assert.deepEqual(Buffer.from(receipt.selected.frozen_artifact.content_base64, "base64"), fs.readFileSync(chosen.prototype.resolved_path));
    assert.equal(receipt.owner_decision.observed_render_bindings.length, 2);
    assert.equal(receipt.final_design_approval_granted, false);
    assert.equal(receipt.source_craft_parity_assessed, false);
    assert.equal(receipt.selected.successor_plan.automatic_expansion_authorized, false);
    for (const state of states) {
      const current = readDesignState(state.state_path);
      assert.equal(current.state_digest, state.state_digest);
      assert.equal(current.approval, null);
    }
    passed = true;
  } finally { for (const s of spaces) disposeFixture(s, passed); }
});
