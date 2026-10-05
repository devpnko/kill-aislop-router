import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { referenceCandidateSpace } from "./fixtures/reference-candidate-space.mjs";
import { startDesignExploration, resumeDesignExploration, dryRunDesignExploration, dispatchDesignPackets } from "../src/design.mjs";
import { candidateReferenceProjection, validateReferenceCandidate } from "../src/reference-candidates.mjs";
import { buildDesignSpecimenComparison, compareDesignSpecimens, selectDesignSpecimen, validateSpecimenOwnerDecision } from "../src/specimen-comparison.mjs";
import { canonicalDigest, readJsonPinned } from "../src/integrity.mjs";
import { assertPublishedSchema } from "./fixtures/schema-validation.mjs";

const cleanup = space => fs.rmSync(space.directory, { recursive: true, force: true });
const save = space => fs.writeFileSync(space.briefPath, JSON.stringify(space.brief));

function abandonedCohort() {
  const spaces = [referenceCandidateSpace({ count: 2 }), referenceCandidateSpace({ count: 2 })];
  try {
    for (const space of spaces) {
      space.brief.reference_candidate.planned_state_paths = spaces.map(item => item.statePath);
      save(space);
    }
    const states = spaces.map(space => {
      startDesignExploration(space);
      return resumeDesignExploration(space.statePath, {
        abandonSpecimen: true, abandonmentReason: "Synthetic comparison-guard fixture; no rendered or Owner approval claim."
      });
    });
    return { spaces, states, cleanup: () => spaces.forEach(cleanup) };
  } catch (error) {
    spaces.forEach(cleanup);
    throw error;
  }
}

// Pure comparison tests below deliberately do not persist these synthetic result
// records or feed them to public ingest. Real official browser proof is separate.
function syntheticBrowser(state, space, index, mutateSettings = () => {}) {
  const settings = {
    contract: "synthetic-official-comparison-contract",
    scenario_digest: canonicalDigest("same scenario"), browser_channel: "chrome", locale: "en-US",
    runtime_digest: canonicalDigest("same runtime"), allowed_origins: ["http://127.0.0.1:4321"],
    max_keyboard_tabs: 40, navigation_timeout_ms: 1000,
    viewports: { mobile: { width: 390, height: 844 }, tablet: { width: 768, height: 1024 }, desktop: { width: 1440, height: 900 } },
    color_schemes: ["light", "dark"]
  };
  mutateSettings(settings);
  const providerId = state.brief.providers.browser_evidence;
  const provider = { adapter: "playwright-browser-v1", settings };
  const hostPath = path.join(space.directory, `synthetic-comparison-host-${index}.json`);
  fs.writeFileSync(hostPath, JSON.stringify({ providers: { [providerId]: provider } }), { mode: 0o600 });
  const pinned = readJsonPinned(hostPath);
  const packetId = `synthetic-browser-${index}`;
  const resultDigest = canonicalDigest(packetId);
  state.results.push({
    packet_id: packetId, result_digest: resultDigest, provider_id: providerId,
    normalized: { kind: "browser-evidence", actor: { actor_id: `synthetic-browser-actor-${index}` }, browser_engine_version: "synthetic-151" },
    evidence: [{ evidence_kind: "screenshot", digest: canonicalDigest(`synthetic screenshot ${index}`) }]
  });
  state.packets.push({ packet_id: packetId, design_task: { kind: "browser-evidence" } });
  state.attempts.push({
    packet_id: packetId, result_digest: resultDigest, execution_status: "ran", adapter: "playwright-browser-v1",
    execution_authority: {
      host_manifest: pinned.source_snapshot,
      provider_declaration_digest: canonicalDigest(provider),
      adapter_entrypoint: { graph_digest: canonicalDigest("synthetic browser graph") }
    }
  });
  return { hostPath, packetId };
}

test("single primary route has one planned depth, zero color candidates and no phantom siblings", () => {
  const space = referenceCandidateSpace();
  try {
    assertPublishedSchema("design-brief", space.brief);
    const dry = dryRunDesignExploration(space);
    assert.equal(dry.direction_matrix.length, 1);
    assert.equal(dry.color_matrix.total_candidates, 0);
    assert.equal(dry.readiness.length, 3);
    assert.equal(dry.specimen_feedback.remaining_creators, "none-in-this-run");
    const state = startDesignExploration(space);
    assertPublishedSchema("design-exploration-run", state);
    assertPublishedSchema("design-packet", state.packets[0]);
    assert.equal(state.packets.length, 1);
    assert.equal(state.results.length, 0);
    assert.equal(state.approval, null);
    assert.deepEqual(state.outputs, {});
    const task = state.packets[0].design_task;
    assert.equal(task.reference_intelligence.source_pixels_available_to_participant, false);
    assert.ok(!JSON.stringify(task).includes(space.brief.reference_candidate.primary_reference_id));
    assert.equal(task.reference_candidate_scope.primary_only, true);
    assert.throws(() => resumeDesignExploration(space.statePath, { expandSpecimen: true }), /cannot expand/);
    const changed = structuredClone(state);
    changed.packets[0].design_task.reference_candidate_scope.task_frame_digest = canonicalDigest("different task");
    const { packet_digest: _old, ...body } = changed.packets[0];
    changed.packets[0].packet_digest = canonicalDigest(body);
    assert.throws(() => dispatchDesignPackets(changed, path.join(space.directory, "substitution")), /primary\/task frame binding|exact canonical candidate/);
  } finally { cleanup(space); }
});

test("primary-only projection preserves global aliases and rejects blends or omitted required recipes", () => {
  const space = referenceCandidateSpace();
  try {
    const pack = JSON.parse(fs.readFileSync(path.resolve(space.directory, space.brief.reference_pack.path)));
    const original = candidateReferenceProjection(space.brief, pack);
    const grammar = structuredClone(pack.verified_grammar[0]);
    grammar.grammar_id = "zz-support"; grammar.reference_id = "support-only";
    pack.verified_grammar.push(grammar);
    const filtered = candidateReferenceProjection(space.brief, pack);
    assert.deepEqual(filtered.transferable_grammar, original.transferable_grammar);
    assert.deepEqual(filtered.causal_reasoning, original.causal_reasoning);
    space.brief.reference_candidate.primary_grammar_ids.push(grammar.grammar_id);
    assert.throws(() => candidateReferenceProjection(space.brief, pack), /silent blending/);
    space.brief.reference_candidate.primary_grammar_ids.pop();
    space.brief.reference_requirement = { mode: "required", required_recipe_families: ["missing-family"] };
    assert.throws(() => candidateReferenceProjection(space.brief, pack), /missing required recipe/);
  } finally { cleanup(space); }
});

test("new mode requires meaningful count, audit and all locale visual observations", () => {
  const space = referenceCandidateSpace();
  try {
    for (const mutate of [
      brief => { delete brief.constraint_audit; },
      brief => { brief.reference_candidate.candidate_count_rationale = ""; },
      brief => { brief.reference_candidate.planned_candidate_count = 0; },
      brief => { brief.visual_goal_contract.observation_locales = []; },
      brief => { brief.color_strategies = [{}]; }
    ]) {
      const brief = structuredClone(space.brief); mutate(brief);
      assert.throws(() => validateReferenceCandidate(brief));
    }
  } finally { cleanup(space); }
});

test("declared cohort accounts for unrendered abandonment, rejects incomplete comparison, permits reject-all only", () => {
  const first = referenceCandidateSpace({ count: 2 });
  const second = referenceCandidateSpace({ count: 2 });
  try {
    for (const space of [first, second]) {
      space.brief.reference_candidate.planned_state_paths = [first.statePath, second.statePath]; save(space);
    }
    const states = [first, second].map(space => {
      startDesignExploration(space);
      return resumeDesignExploration(space.statePath, { abandonSpecimen: true, abandonmentReason: "Reject before rendering; no fabricated visual evidence." });
    });
    const target = path.join(first.directory, "comparison.json");
    assert.throws(() => compareDesignSpecimens([first.statePath], target), /complete declared cohort/);
    assert.equal(fs.existsSync(target), false);
    const report = compareDesignSpecimens([first.statePath, second.statePath], target);
    assert.equal(report.candidates.length, 2);
    assert.ok(report.candidates.every(item => item.prototype === null && item.browser_result_digest === null && !item.selectable));
    assert.deepEqual(report.decision_contract.required_render_bindings, []);
    assert.equal(report.decision_contract.default_selection, null);
    assert.throws(() => compareDesignSpecimens([first.statePath, second.statePath], target), /cannot be overwritten/);
    const switched = structuredClone(states);
    switched[1].brief.providers.specimen_reviewer = switched[0].brief.directions[0].creator_provider_id;
    assert.throws(() => buildDesignSpecimenComparison(switched), /independent across every candidate/);
    const substituted = structuredClone(states);
    substituted[1].state_path = path.join(second.directory, "fresh-replacement.json");
    assert.throws(() => buildDesignSpecimenComparison(substituted), /predeclared cohort/);
    const owner = {
      design_specimen_owner_decision_version: 1, comparison_digest: report.comparison_digest,
      owner_id: "external-human-owner", status: "reject-all", selected_run_id: null,
      observed_render_bindings: [], rationale: "Reject this whole cohort before implementation.",
      planned_expansion: null, decided_at: "2026-10-05T00:00:00.000Z", acknowledges_not_final_approval: true
    };
    assertPublishedSchema("design-specimen-owner-decision", owner);
    assert.throws(() => validateSpecimenOwnerDecision(report, { ...owner, status: "select", selected_run_id: states[0].run_id, planned_expansion: "Expand" }, states), /critic-eligible/);
    assert.throws(() => validateSpecimenOwnerDecision(report, { ...owner, owner_id: states[0].brief.providers.specimen_reviewer }, states), /must be external/);
    const decisionPath = path.join(first.directory, "owner.json");
    fs.writeFileSync(decisionPath, JSON.stringify(owner));
    const receipt = selectDesignSpecimen(target, decisionPath);
    assert.equal(receipt.selected, null);
    assert.equal(receipt.owner_selection_granted, false);
    assert.equal(receipt.final_design_approval_granted, false);
    assert.ok(fs.existsSync(`${target}.selection.json`));
    assert.throws(() => selectDesignSpecimen(target, decisionPath), /cannot be overwritten/);
    const mixed = structuredClone(states);
    mixed[1].brief.locales = ["other-locale"];
    assert.throws(() => buildDesignSpecimenComparison(mixed), /task frame differs/);
    const cli = spawnSync(process.execPath, [path.resolve("bin/killsloprouter.mjs"), "design", "compare", "--runs", first.statePath, "--out", path.join(first.directory, "incomplete.json"), "--json"], { encoding: "utf8" });
    assert.notEqual(cli.status, 0);
    assert.match(cli.stderr, /complete declared cohort/);
    for (const args of [
      ["compare", "--runs", `${first.statePath},${second.statePath}`, "--out", target, "--dry-run"],
      ["select", "--comparison", target, "--decision", decisionPath, "--out", target]
    ]) {
      const before = fs.readFileSync(target);
      const rejected = spawnSync(process.execPath, [path.resolve("bin/killsloprouter.mjs"), "design", ...args], { encoding: "utf8" });
      assert.equal(rejected.status, 2, rejected.stderr);
      assert.match(rejected.stderr, /unknown or repeated/);
      assert.deepEqual(fs.readFileSync(target), before);
    }
    const cliTarget = path.join(first.directory, "cli-comparison.json");
    const compared = spawnSync(process.execPath, [path.resolve("bin/killsloprouter.mjs"), "design", "compare", "--runs", `${first.statePath},${second.statePath}`, "--out", cliTarget, "--json"], { encoding: "utf8" });
    assert.equal(compared.status, 0, compared.stderr);
    assert.deepEqual(JSON.parse(fs.readFileSync(cliTarget)), report);
  } finally { cleanup(first); cleanup(second); }
});

test("comparison refuses unfinished candidates; reference brief changes invalidate old plan", () => {
  const space = referenceCandidateSpace();
  try {
    startDesignExploration(space);
    assert.throws(() => compareDesignSpecimens([space.statePath], path.join(space.directory, "premature.json")), /feedback or explicit abandonment/);
    space.brief.reference_candidate.task_frame = "A different target task";
    save(space);
    assert.throws(() => resumeDesignExploration(space.statePath), /digest|changed|identity/);
  } finally { cleanup(space); }
});

test("cohort independence rejects canonical cross-candidate provider and result-actor aliases", () => {
  const cohort = abandonedCohort();
  try {
    assert.doesNotThrow(() => buildDesignSpecimenComparison(cohort.states));
    const alias = value => `  ${value.toUpperCase()}  `;
    const cases = [
      ["creator provider reused as sibling browser", states => {
        states[1].brief.providers.browser_evidence = alias(states[0].brief.directions[0].creator_provider_id);
      }],
      ["browser provider reused as sibling critic", states => {
        states[1].brief.providers.specimen_reviewer = alias(states[0].brief.providers.browser_evidence);
      }],
      ["creator actor reused as sibling critic actor", states => {
        states[0].results.push({ normalized: { kind: "direction-candidate", actor: { actor_id: "synthetic-shared-actor" } }, evidence: [] });
        states[1].results.push({ normalized: { kind: "specimen-review", actor: { actor_id: "  ＳＹＮＴＨＥＴＩＣ-ＳＨＡＲＥＤ-ＡＣＴＯＲ  " }, blockers: [] } });
      }]
    ];
    for (const [label, mutate] of cases) {
      const states = structuredClone(cohort.states);
      mutate(states);
      assert.throws(() => buildDesignSpecimenComparison(states), /independent across every candidate/, label);
    }
    for (const field of ["source_recipient_provider_ids", "source_recipient_actor_ids"]) {
      for (const role of ["creator", "browser"]) {
        const states = structuredClone(cohort.states);
        const participant = role === "creator" ? states[1].brief.directions[0].creator_provider_id : states[1].brief.providers.browser_evidence;
        states[0].reference_pack.producer_state.review_source_authority[field].push(alias(participant));
        assert.throws(() => buildDesignSpecimenComparison(states), /source recipients cannot create or browse any candidate/, `${field} / ${role}`);
      }
    }
    const reviewerSource = structuredClone(cohort.states);
    reviewerSource[0].reference_pack.producer_state.review_source_authority.source_recipient_actor_ids.push(alias(reviewerSource[1].brief.providers.specimen_reviewer));
    assert.doesNotThrow(() => buildDesignSpecimenComparison(reviewerSource), "independent critic source access is not a forbidden creator/browser identity reuse");
  } finally { cohort.cleanup(); }
});

test("cohort source lineage rejects executable aliases across runs, including failed historical source attempts", () => {
  const cohort = abandonedCohort();
  try {
    for (const role of ["direction-candidate", "browser-evidence"]) {
      for (const aliasKind of ["graph_digest", "digest", "physical_identity_digest", "provider_declaration_digest", "adapter-without-entrypoint"]) {
        const states = structuredClone(cohort.states);
        const source = {
          execution_status: "blocked_execution_error", adapter: "synthetic-source-adapter",
          provider_declaration_digest: canonicalDigest("source declaration"),
          adapter_entrypoint: {
            graph_digest: canonicalDigest("source graph"), digest: canonicalDigest("source bytes"),
            physical_identity_digest: canonicalDigest("source physical identity")
          }
        };
        const authority = {
          provider_declaration_digest: canonicalDigest("target declaration"),
          adapter_entrypoint: {
            graph_digest: canonicalDigest("target graph"), digest: canonicalDigest("target bytes"),
            physical_identity_digest: canonicalDigest("target physical identity")
          }
        };
        const target = { packet_id: "synthetic-target-attempt", adapter: "synthetic-target-adapter", execution_authority: authority };
        states[0].reference_pack.producer_state.review_source_authority.source_recipient_execution_lineage.attempts = [source];
        states[1].packets.push({ packet_id: target.packet_id, design_task: { kind: role } });
        states[1].attempts.push(target);
        assert.doesNotThrow(() => buildDesignSpecimenComparison(states), `${role} / distinct ${aliasKind} control`);
        if (aliasKind === "adapter-without-entrypoint") {
          delete authority.adapter_entrypoint;
          delete source.adapter_entrypoint;
          target.adapter = source.adapter;
        } else if (aliasKind === "provider_declaration_digest") {
          authority.provider_declaration_digest = source.provider_declaration_digest;
        } else {
          authority.adapter_entrypoint[aliasKind] = source.adapter_entrypoint[aliasKind];
        }
        assert.throws(() => buildDesignSpecimenComparison(states), /source executable cannot alias any creator or browser authority/, `${role} / ${aliasKind}`);
      }
    }
  } finally { cohort.cleanup(); }
});

test("comparison binds every executed browser setting and engine version across the cohort", () => {
  const cohort = abandonedCohort();
  try {
    const mutations = [
      ["contract", settings => { settings.contract = "another-contract"; }],
      ["scenario", settings => { settings.scenario_digest = canonicalDigest("changed scenario"); }],
      ["channel", settings => { settings.browser_channel = "chromium"; }],
      ["locale", settings => { settings.locale = "ko-KR"; }],
      ["runtime", settings => { settings.runtime_digest = canonicalDigest("changed runtime"); }],
      ["origins", settings => { settings.allowed_origins = ["http://127.0.0.1:4322"]; }],
      ["keyboard budget", settings => { settings.max_keyboard_tabs += 1; }],
      ["interaction budget", settings => { settings.navigation_timeout_ms += 1; }],
      ["viewport", settings => { settings.viewports.mobile.width += 1; }],
      ["color scheme", settings => { settings.color_schemes = ["light"]; }]
    ];
    let sequence = 0;
    for (const [label, mutate] of mutations) {
      const states = structuredClone(cohort.states);
      syntheticBrowser(states[0], cohort.spaces[0], sequence++);
      syntheticBrowser(states[1], cohort.spaces[1], sequence++, mutate);
      assert.throws(() => buildDesignSpecimenComparison(states), /executed browser scenario, viewport, color-scheme or browser settings differ/, label);
    }
    const equivalent = structuredClone(cohort.states);
    syntheticBrowser(equivalent[0], cohort.spaces[0], sequence++);
    syntheticBrowser(equivalent[1], cohort.spaces[1], sequence++, settings => settings.color_schemes.reverse());
    const comparison = buildDesignSpecimenComparison(equivalent);
    assert.ok(comparison.executed_browser_contract_digest);
    assert.ok(comparison.candidates.every(item => !item.selectable), "synthetic browser records on abandoned runs do not confer eligibility");
    equivalent[1].results.at(-1).normalized.browser_engine_version = "synthetic-152";
    assert.throws(() => buildDesignSpecimenComparison(equivalent), /browser settings differ/, "engine version differs even when declared settings match");
  } finally { cohort.cleanup(); }
});

test("comparison rechecks browser host bytes, physical identity, declaration and accepted attempt", () => {
  const cohort = abandonedCohort();
  try {
    const states = structuredClone(cohort.states);
    syntheticBrowser(states[0], cohort.spaces[0], 0);
    const second = syntheticBrowser(states[1], cohort.spaces[1], 1);
    assert.doesNotThrow(() => buildDesignSpecimenComparison(states));
    for (const [label, mutate, expected] of [
      ["unaccepted attempt", changed => { changed[1].attempts.at(-1).execution_status = "blocked_execution_error"; }, /accepted official browser execution authority/],
      ["unmatched result", changed => { changed[1].attempts.at(-1).result_digest = canonicalDigest("another result"); }, /accepted official browser execution authority/],
      ["physical pin", changed => { changed[1].attempts.at(-1).execution_authority.host_manifest.physical_identity_digest = canonicalDigest("other physical identity"); }, /browser host changed/],
      ["declaration pin", changed => { changed[1].attempts.at(-1).execution_authority.provider_declaration_digest = canonicalDigest("another provider declaration"); }, /browser declaration changed/]
    ]) {
      const changed = structuredClone(states);
      mutate(changed);
      assert.throws(() => buildDesignSpecimenComparison(changed), expected, label);
    }
    fs.appendFileSync(second.hostPath, "\n");
    assert.throws(() => buildDesignSpecimenComparison(states), /browser host changed/, "same parsed JSON with different host bytes is not interchangeable");
  } finally { cohort.cleanup(); }
});
