import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";
import { validateComponentRecipe, COMPONENT_VISUAL_ASPECTS } from "../src/component-recipes.mjs";
import { validateReferencePack, validateUiBowlManualExport } from "../src/reference.mjs";
import { assertPublishedSchema } from "./fixtures/schema-validation.mjs";

const read = (file) => JSON.parse(fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8"));
const study = read("docs/research/ui-bowl-korea-component-study-2026-09-22.json");
const intakePath = "docs/research/ui-bowl-korea-familiar-30-2026-09-22.json";
const intake = read(intakePath);
const secondPassAccess = read("docs/research/ui-bowl-second-pass-access-2026-09-23.json");
const choiceMatrix = read("docs/research/ui-bowl-component-choice-matrix-2026-09-23.json");
const digest = (file) => `sha256:${createHash("sha256").update(fs.readFileSync(new URL(`../${file}`, import.meta.url))).digest("hex")}`;
const sourceFrames = new Map(intake.products.flatMap((product) => product.frames.map((frame) => [frame.frame_id, { product, frame }])));

test("Korean component study is an additive, pinned, non-authoritative research artifact", () => {
  assert.equal(study.research_component_study_version, 1);
  assert.equal(study.authority_scope, "non-authoritative-research-aid");
  assert.equal(study.status, "research-draft-not-design-ready");
  assert.equal(study.source_index.path, intakePath);
  assert.equal(study.source_index.digest, digest(intakePath));
  assert.equal(study.source_index.digest, "sha256:b3a04d073bc5e3ae33418ca6a8d806e0d1109c8bd1bb795cedcca6efd2478fd3");
  assert.equal(digest("docs/research/ui-bowl-korea-familiar-30-2026-09-22.md"), "sha256:9c308ff4992a38a7809500c671f6babdb73c33c6a8054712e2151bc3a32d950c");
  for (const key of ["design_ready", "creator_input_approved", "visual_authority_granted", "source_pixels_included", "source_assets_included"]) assert.equal(study[key], false, key);
  assert.equal(study.rights.creator_pixel_access, false);
  assert.equal(study.rights.redistribution, false);
  assert.equal(study.rights.cross_project_approval_reuse, false);
  assert.equal(study.counts.ready_project_packs, 0);
  assert.equal(study.counts.source_behavior_executions, 0);
  assert.equal(study.counts.same_product_responsive_pairs, 0);
  assert.equal(study.counts.formal_reference_pipeline_review_passes, 0);
});

test("ten Korean-familiar surfaces are five ecosystems, not thirty independently analyzed services", () => {
  assert.equal(study.sources.length, 10);
  assert.equal(new Set(study.sources.map((source) => source.ecosystem)).size, 5);
  assert.equal(study.counts.product_surface_groups, 10);
  assert.equal(study.counts.distinct_ecosystems, 5);
  assert.equal(study.counts.distinct_frames, 30);
  assert.equal(study.counts.primary_consumer_frames, 24);
  assert.equal(study.counts.adjacent_support_or_operator_frames, 6);
  for (const source of study.sources) {
    const original = intake.products.find((product) => product.id === source.id);
    assert.ok(original, source.id);
    assert.equal(source.ecosystem, original.ecosystem);
    assert.equal(source.observed_surface, original.observed_surface);
    assert.equal(source.source_archive_group_date, original.source_archive_group_date);
    assert.deepEqual(source.frames, original.frames);
  }
  assert.match(study.sources.find((source) => source.id === "naver-map-web").observed_surface, /^support/);
  assert.match(study.sources.find((source) => source.id === "toss-business").observed_surface, /^operator/);
});

test("every detailed observation closes over the exact source frames and all thirty are covered", () => {
  assert.equal(study.entries.length, 14);
  assert.equal(study.counts.component_analyses, study.entries.length);
  assert.equal(new Set(study.entries.map((entry) => entry.id)).size, study.entries.length);
  const covered = new Set();
  for (const entry of study.entries) {
    assert.ok(study.sources.some((source) => source.id === entry.source_id));
    assert.equal(entry.family, entry.component_recipe.family);
    assert.ok(entry.frame_ids.length > 0);
    assert.equal(new Set(entry.frame_ids).size, entry.frame_ids.length);
    for (const id of entry.frame_ids) {
      assert.equal(sourceFrames.get(id)?.product.id, entry.source_id, `${entry.id}: ${id}`);
      covered.add(id);
    }
    const observedParts = entry.anatomy_observed.map((part) => part.part_id);
    assert.deepEqual(observedParts, entry.component_recipe.anatomy.map((part) => part.part_id));
    for (const part of entry.anatomy_observed) {
      assert.equal(part.priority, undefined, "Observed appearance must not inherit target preservation priority");
      assert.ok(part.visible_treatment.trim().length > 0);
      assert.ok(part.frame_ids.length > 0);
      assert.ok(part.frame_ids.every((id) => entry.frame_ids.includes(id)));
    }
    assert.deepEqual(Object.keys(entry.visual_observations).sort(), [...COMPONENT_VISUAL_ASPECTS].sort());
    for (const observation of [...Object.values(entry.visual_observations), ...entry.source_state_evidence]) {
      assert.ok(["observed-static", "not-observed"].includes(observation.basis));
      assert.ok(observation.description.trim());
      if (observation.basis === "observed-static") {
        assert.ok(observation.frame_ids.length > 0);
        assert.ok(observation.frame_ids.every((id) => entry.frame_ids.includes(id)));
      } else assert.deepEqual(observation.frame_ids, []);
    }
  }
  assert.deepEqual([...covered].sort(), [...sourceFrames.keys()].sort());
});

test("static source states cannot silently claim behavior, responsive execution or motion", () => {
  const states = ["rest", "selected", "hover", "focus-visible", "disabled", "loading", "empty", "error", "success"];
  const extraStaticStates = ["expanded", "populated", "proposal-visible", "handwriting-present", "populated-change", "input-emphasis", "registered-looking"];
  for (const entry of study.entries) {
    const recorded = entry.source_state_evidence.map((state) => state.state);
    assert.equal(new Set(recorded).size, recorded.length);
    assert.ok(states.every((state) => recorded.includes(state)));
    assert.ok(recorded.every((state) => [...states, ...extraStaticStates].includes(state)));
    for (const state of ["hover", "focus-visible"]) {
      assert.equal(entry.source_state_evidence.find((item) => item.state === state).basis, "not-observed");
    }
    assert.equal(entry.visual_observations.motion.basis, "not-observed");
    for (const variant of entry.component_recipe.responsive_variants) {
      assert.equal(variant.basis, "target-proposal");
      assert.deepEqual(variant.observed_ids, []);
    }
    assert.ok(entry.limitations.length >= 2);
  }
});

test("all detailed recipes satisfy the existing closed schema and runtime anatomy contract", () => {
  for (const entry of study.entries) {
    assertPublishedSchema("component-recipe", entry.component_recipe);
    validateComponentRecipe(entry.component_recipe);
    const anonymous = JSON.stringify(entry.component_recipe);
    assert.doesNotMatch(anonymous, /카카오|네이버|쿠팡|토스|컬리|파파고|UI Bowl|uibowl|naver|toss|kakao|coupang|kurly|https?:\/\/|\/Users\/|sha256:|#[0-9a-f]{3,8}\b/i, entry.id);
    const promoted = structuredClone(entry.component_recipe);
    promoted.responsive_variants[0].basis = "observed";
    assert.throws(() => validateComponentRecipe(promoted), /observed_ids/);
    const hidden = structuredClone(entry.component_recipe);
    const primary = hidden.anatomy.find((part) => part.priority === "primary").part_id;
    hidden.responsive_variants[0].preserved_parts = hidden.responsive_variants[0].preserved_parts.filter((id) => id !== primary);
    hidden.responsive_variants[0].deferred_parts.push(primary);
    assert.throws(() => validateComponentRecipe(hidden), /primary/);
  }
});

test("each transfer hypothesis includes constraints, harms and concrete target checks, not a style verdict", () => {
  for (const entry of study.entries) {
    for (const key of ["visible_priority", "supported_decision", "likely_constraint", "flattening_consequence", "tradeoff", "harmful_context", "live_data_dependency", "anti_copy_boundary"]) {
      assert.ok(typeof entry.causal_hypothesis[key] === "string" && entry.causal_hypothesis[key].trim(), `${entry.id}: ${key}`);
    }
    assert.ok(entry.causal_hypothesis.application_conditions.length >= 2);
    assert.ok(entry.application_checks.length >= 4);
    assert.equal(new Set(entry.application_checks.map((check) => check.id)).size, entry.application_checks.length);
    for (const check of entry.application_checks) {
      assert.equal(check.basis, "target-test-proposal");
      assert.ok(check.question.trim() && check.pass_condition.trim());
      assert.equal(check.passed, undefined);
    }
  }
  assert.equal(study.counts.target_test_proposals, study.entries.reduce((sum, entry) => sum + entry.application_checks.length, 0));
});

test("public analysis has no private pixels, paths, source account data or executable pack authority", () => {
  assert.throws(() => validateUiBowlManualExport(study));
  assert.throws(() => validateReferencePack(study));
  assert.doesNotMatch(JSON.stringify(study), /\/Users\/|\/tmp\/|data:image|\.png|\.jpe?g|api_key|Bearer\s/);
  for (const source of study.sources) {
    for (const frame of source.frames) {
      assert.equal(new URL(frame.source_url).hostname, "uibowl.io");
      assert.equal(new URL(frame.source_url).searchParams.get("imgId"), frame.frame_id);
      assert.match(frame.private_capture_digest, /^sha256:[a-f0-9]{64}$/);
      assert.equal(frame.source_interaction_tested, false);
    }
  }
});

test("second-pass access observation distinguishes a published plan from account entitlement", () => {
  assert.equal(secondPassAccess.research_access_observation_version, 1);
  assert.equal(secondPassAccess.orchestrator, "KillSlopRouter");
  assert.equal(secondPassAccess.kind, "manual-visible-browser-observation-not-authority");
  assert.equal(secondPassAccess.authority_scope, "non-authoritative-research-aid");
  assert.equal(secondPassAccess.status, "external-wait-owner-login");
  assert.equal(secondPassAccess.plan_description_is_account_entitlement, false);
  assert.deepEqual(secondPassAccess.observed_account, {
    login_button_visible: true,
    authenticated_account_verified: false,
    active_membership_verified: false,
    active_membership: null,
    all_product_image_access_verified: false,
    historical_capture_entitlement_verified: false
  });
  assert.equal(secondPassAccess.published_plan_descriptions.length, 3);
  assert.equal(secondPassAccess.evidence.length, 2);
  for (const item of secondPassAccess.evidence) {
    assert.equal(item.kind, "private-native-browser-screenshot");
    assert.ok(secondPassAccess.source_urls.includes(item.source_url));
    assert.match(item.digest, /^sha256:[a-f0-9]{64}$/);
    assert.ok(Number.isFinite(Date.parse(item.captured_at)));
    assert.ok(Date.parse(item.captured_at) <= Date.parse(secondPassAccess.observed_at));
    assert.equal(item.source_product_frame, false);
    assert.equal(item.pixels_distributed, false);
  }
});

test("second-pass access check cannot retroactively authorize acquisition or promote research to design", () => {
  const previous = secondPassAccess.existing_research;
  assert.equal(previous.study.digest, digest(previous.study.path));
  assert.equal(previous.independent_static_review.digest, digest(previous.independent_static_review.path));
  assert.equal(previous.study.digest, "sha256:8500cbe81a478e42e139378351371a655d210e5273cf917b9fbcf09c36f2a7b9");
  assert.equal(previous.independent_static_review.digest, "sha256:cfa27ad63c49883238cca3e9d4ca96b3173e9f5bcfb91ec255fa4ad7f84807b7");
  assert.equal(previous.existing_frame_count, study.counts.distinct_frames);
  assert.equal(previous.new_product_frames_acquired, 0);
  assert.equal(previous.historical_evidence_rewritten, false);
  assert.equal(previous.access_check_retroactively_authenticates_old_acquisition, false);
  for (const key of [
    "mcp_used", "hidden_api_or_asset_access", "access_bypass", "cookies_or_tokens_read",
    "credentials_collected", "subscription_or_payment_changed", "account_or_profile_switched",
    "creator_dispatched", "source_pixels_exposed_to_creator", "source_reuse_rights_verified",
    "formal_reference_run_executed", "official_design_browser_evidence", "owner_selection_created",
    "ready_reference_pack", "design_ready", "visual_authority_granted", "global_install_performed"
  ]) assert.equal(secondPassAccess.boundaries[key], false, key);
  assert.throws(() => validateUiBowlManualExport(secondPassAccess));
  assert.throws(() => validateReferencePack(secondPassAccess));
  assert.doesNotMatch(JSON.stringify(secondPassAccess), /\/Users\/|\/tmp\/|data:image|\.png|\.jpe?g|api_key|Bearer\s/);
});

test("component choice matrix is a pinned derivative, not source discovery or project selection", () => {
  assert.equal(choiceMatrix.component_choice_matrix_version, 1);
  assert.equal(choiceMatrix.orchestrator, "KillSlopRouter");
  assert.equal(choiceMatrix.status, "derivative-of-reviewed-static-study");
  assert.equal(choiceMatrix.authority_scope, "research-only");
  assert.equal(choiceMatrix.source_artifacts.length, 2);
  assert.deepEqual(choiceMatrix.source_artifacts.map((item) => item.path), [
    secondPassAccess.existing_research.study.path,
    secondPassAccess.existing_research.independent_static_review.path
  ]);
  for (const item of choiceMatrix.source_artifacts) {
    assert.equal(item.digest, digest(item.path));
    assert.equal(item.digest_recomputed_and_matched, true);
  }
  for (const key of [
    "fit_ranking", "ready_reference_pack", "creator_input", "owner_selection", "visual_authority",
    "formal_reference_pipeline_ran", "independent_approval_of_this_derivative", "new_source_pixels_inspected",
    "new_source_observations", "source_behavior_executed", "same_product_responsive_verified",
    "source_reuse_rights_verified", "source_acquisition_method_authenticated", "source_pixels_included",
    "source_assets_included", "private_paths_included", "account_metadata_included"
  ]) assert.equal(choiceMatrix.boundaries[key], false, key);
  assert.throws(() => validateUiBowlManualExport(choiceMatrix));
  assert.throws(() => validateReferencePack(choiceMatrix));
  assert.doesNotMatch(JSON.stringify(choiceMatrix), /\/Users\/|\/tmp\/|data:image|\.png|\.jpe?g|api_key|Bearer\s|#[0-9a-f]{3,8}\b/i);
});

test("component alternatives cite exact existing entries, anatomy and visual observation frames", () => {
  const aspects = ["surface", "edges", "elevation", "typography", "spacing", "color"];
  const entryIds = new Set();
  const frameIds = new Set();
  const sourceIds = new Set();
  const alternativeIds = new Set();
  assert.equal(new Set(choiceMatrix.decisions.map((item) => item.id)).size, choiceMatrix.decisions.length);
  for (const decision of choiceMatrix.decisions) {
    assert.ok(decision.alternatives.length >= 2, decision.id);
    for (const alternative of decision.alternatives) {
      assert.ok(!alternativeIds.has(alternative.id), alternative.id);
      alternativeIds.add(alternative.id);
      assert.ok(alternative.source_entries.length > 0);
      for (const citation of alternative.source_entries) {
        const index = study.entries.findIndex((entry) => entry.id === citation.entry_id);
        assert.notEqual(index, -1, citation.entry_id);
        const entry = study.entries[index];
        assert.ok(!entryIds.has(entry.id), `An entry must not inflate multiple comparison questions: ${entry.id}`);
        entryIds.add(entry.id);
        sourceIds.add(entry.source_id);
        assert.equal(citation.source_id, entry.source_id);
        assert.equal(citation.source_json_pointer, `/entries/${index}`);
        assert.ok(citation.frame_ids.length > 0);
        assert.equal(new Set(citation.frame_ids).size, citation.frame_ids.length);
        for (const id of citation.frame_ids) {
          assert.ok(entry.frame_ids.includes(id), `${entry.id}: ${id}`);
          frameIds.add(id);
        }
        assert.ok(citation.anatomy_citations.length > 0);
        assert.equal(new Set(citation.anatomy_citations.map((part) => part.part_id)).size, citation.anatomy_citations.length);
        for (const part of citation.anatomy_citations) {
          const observed = entry.anatomy_observed.find((item) => item.part_id === part.part_id);
          assert.ok(observed, `${entry.id}: ${part.part_id}`);
          assert.ok(part.observed.trim() && part.frame_ids.length > 0);
          assert.ok(part.frame_ids.every((id) => observed.frame_ids.includes(id) && citation.frame_ids.includes(id)), `${entry.id}: ${part.part_id} frame scope`);
        }
        assert.deepEqual(Object.keys(citation.aspect_citations).sort(), [...aspects].sort());
        for (const aspect of aspects) {
          const source = entry.visual_observations[aspect];
          const cited = citation.aspect_citations[aspect];
          assert.equal(source.basis, "observed-static", `${entry.id}: ${aspect}`);
          assert.ok(cited.observed.trim() && cited.frame_ids.length > 0);
          assert.ok(cited.frame_ids.every((id) => source.frame_ids.includes(id) && citation.frame_ids.includes(id)), `${entry.id}: ${aspect} frame scope`);
        }
      }
    }
  }
  assert.equal(choiceMatrix.coverage.decision_questions, choiceMatrix.decisions.length);
  assert.equal(choiceMatrix.coverage.alternatives, alternativeIds.size);
  assert.equal(choiceMatrix.coverage.unique_compared_entries, entryIds.size);
  assert.equal(choiceMatrix.coverage.unique_compared_source_frames, frameIds.size);
  assert.equal(choiceMatrix.coverage.unique_compared_product_surface_groups, sourceIds.size);
});

test("component choice hypotheses preserve all six craft axes without claiming executed proposals", () => {
  for (const decision of choiceMatrix.decisions) {
    assert.ok(decision.question.trim() && decision.discriminator_hypothesis.trim());
    for (const alternative of decision.alternatives) {
      assert.ok(alternative.when_to_consider.length >= 2);
      assert.ok(alternative.when_not_to_use.length >= 2);
      assert.ok(alternative.unknowns.length >= 2);
      assert.ok(alternative.tradeoff.trim() && alternative.anti_copy_boundary.trim());
      assert.deepEqual(Object.keys(alternative.target_relationships).sort(), ["hierarchy", "surface", "edges", "elevation", "typography", "spacing", "color"].sort());
      assert.ok(Object.values(alternative.target_relationships).every((value) => typeof value === "string" && value.trim()));
      assert.equal(alternative.approved, undefined);
      assert.equal(alternative.passed, undefined);
      assert.equal(alternative.fit_score, undefined);
    }
  }
  assert.equal(choiceMatrix.coverage.source_study_entries, study.entries.length);
  assert.equal(choiceMatrix.coverage.source_study_frames, study.counts.distinct_frames);
  assert.equal(choiceMatrix.coverage.source_study_responsive_proposals, study.entries.reduce((sum, entry) => sum + entry.component_recipe.responsive_variants.length, 0));
  assert.equal(choiceMatrix.coverage.source_study_application_check_proposals, study.counts.target_test_proposals);
  assert.equal(choiceMatrix.coverage.responsive_proposals_executed, 0);
  assert.equal(choiceMatrix.coverage.application_check_proposals_executed, 0);
  assert.equal(choiceMatrix.coverage.new_capture_count, 0);
  const citations = choiceMatrix.decisions.flatMap((decision) => decision.alternatives.flatMap((alternative) => alternative.source_entries));
  for (const [entryId, requiredParts] of [
    ["naverpay-briefing-reader", ["body"]],
    ["toss-securities-search-palette", ["query", "category"]],
    ["toss-securities-dense-modules", ["instrument-context"]],
    ["kurly-web-payment-registration", ["return-control"]]
  ]) {
    const cited = new Set(citations.find((item) => item.entry_id === entryId)?.anatomy_citations.map((part) => part.part_id));
    for (const part of requiredParts) assert.ok(cited.has(part), `${entryId}: hierarchy claim needs direct ${part} citation`);
  }
});

test("second-pass comparison preserves exclusions, state-scope cautions and uncaptured task gaps", () => {
  const compared = choiceMatrix.decisions.flatMap((decision) => decision.alternatives.flatMap((alternative) => alternative.source_entries.map((item) => item.entry_id)));
  const excluded = choiceMatrix.excluded_entries.map((item) => item.entry_id);
  assert.equal(new Set([...compared, ...excluded]).size, compared.length + excluded.length);
  assert.deepEqual([...compared, ...excluded].sort(), study.entries.map((entry) => entry.id).sort());
  for (const item of choiceMatrix.excluded_entries) {
    const index = study.entries.findIndex((entry) => entry.id === item.entry_id);
    assert.equal(item.source_json_pointer, `/entries/${index}`);
    assert.deepEqual(item.frame_ids, study.entries[index].frame_ids);
    assert.ok(item.reason.trim() && item.preserved_limit.trim());
  }
  const priorReview = read(secondPassAccess.existing_research.independent_static_review.path);
  for (const item of choiceMatrix.review_note_handling) {
    const note = priorReview.nonblocking_notes.find((value) => value.id === item.source_review_note_id);
    assert.ok(note?.entry_ids.includes(item.source_entry_id));
    const entry = study.entries.find((value) => value.id === item.source_entry_id);
    assert.equal(item.source_state_transition_verified, false);
    assert.ok(item.derived_static_label.trim() && item.meaning.trim());
    assert.ok(item.part_scope.length > 0 && item.frame_ids.length > 0);
    for (const partId of item.part_scope) {
      const part = entry.anatomy_observed.find((value) => value.part_id === partId);
      assert.ok(part, `${entry.id}: ${partId}`);
      assert.ok(item.frame_ids.every((id) => part.frame_ids.includes(id)), `${entry.id}: ${partId} state frame scope`);
    }
  }
  const emptyQueries = choiceMatrix.review_note_handling.filter((item) => item.derived_static_label === "empty-query-visible");
  assert.deepEqual(emptyQueries.map((item) => [item.source_entry_id, item.part_scope]), [
    ["naver-travel-hierarchical-search", ["query"]],
    ["naver-map-web-help-disclosure", ["help-query"]]
  ]);
  assert.deepEqual(choiceMatrix.unresolved_coverage_gaps.map((item) => [item.id, item.status]), [
    ["commerce-listing", "not-covered"],
    ["commerce-detail", "not-covered"],
    ["map-interaction", "not-covered"],
    ["long-source-reading", "insufficient"],
    ["same-product-responsive", "not-covered"]
  ]);
  assert.ok(choiceMatrix.unresolved_coverage_gaps.every((item) => item.reason.trim()));
});

test("second-pass manual peer review pins this derivative without inheriting source approval", () => {
  const reviewPath = "docs/research/ui-bowl-component-choice-review-2026-09-23.json";
  const review = read(reviewPath);
  assert.equal(digest(reviewPath), "sha256:0336820558b21f9e033a4e7955c91f55027bf111f3e4b675e8c9313bd162fa9e");
  assert.equal(review.orchestrator, "KillSlopRouter");
  assert.equal(review.review_kind, "manual-independent-peer-review");
  assert.equal(review.review_mode, "sealed-study-text-only");
  assert.equal(review.authority_scope, "non-authoritative-derivative-text-review");
  assert.equal(review.participant_role, "internal-independent-research-critic");
  assert.ok(typeof review.participant_actor === "string" && review.participant_actor.trim());
  assert.notEqual(review.participant_actor, "/root/korea_phase2_comparison");
  assert.notEqual(review.participant_actor, "/root");
  assert.deepEqual(review.must_fix_remaining, []);
  assert.deepEqual(review.reviewed_artifacts.map((item) => item.path).sort(), [
    "docs/research/ui-bowl-component-choice-matrix-2026-09-23.json",
    "docs/research/ui-bowl-component-choice-matrix-2026-09-23.md",
    "docs/research/ui-bowl-second-pass-access-2026-09-23.json",
    "docs/research/ui-bowl-second-pass-access-2026-09-23.md"
  ].sort());
  assert.deepEqual(review.source_artifacts.map((item) => item.path).sort(), choiceMatrix.source_artifacts.map((item) => item.path).sort());
  for (const item of [...review.reviewed_artifacts, ...review.source_artifacts]) assert.equal(item.digest, digest(item.path));
  for (const key of [
    "network_or_browser_used_this_review", "raw_image_observation_performed_this_review",
    "new_source_acquisition_performed_this_review", "access_browser_claims_independently_observed",
    "source_acquisition_method_authenticated", "historical_capture_entitlement_verified",
    "source_reuse_rights_approved", "formal_reference_cli_review", "formal_reference_pipeline_pass",
    "formal_cli_ran_receipt", "owner_approval", "creator_approval", "creator_input_approved",
    "ready_reference_pack", "design_ready", "visual_authority_granted", "source_behavior_executed",
    "same_product_responsive_behavior_verified", "accessibility_conformance_verified", "source_pixels_included",
    "private_capture_paths_or_filenames_included", "account_values_included"
  ]) assert.equal(review.boundaries[key], false, key);
  for (const key of [
    "raw_images_viewed_this_review", "raw_image_hashes_recomputed_this_review",
    "new_product_frames_acquired_this_review", "access_capture_bytes_inspected_this_review",
    "source_behavior_executions_this_review", "target_proposal_tests_executed_this_review",
    "repository_test_suites_executed_this_review", "closure_or_link_issues_found"
  ]) assert.equal(review.inspection[key], 0, key);
  const citations = choiceMatrix.decisions.flatMap((decision) => decision.alternatives.flatMap((alternative) => alternative.source_entries));
  assert.equal(review.inspection.source_entry_pointer_and_subject_bindings_checked, citations.length);
  assert.equal(review.inspection.anatomy_citations_checked, citations.reduce((sum, item) => sum + item.anatomy_citations.length, 0));
  assert.equal(review.inspection.anatomy_frame_bindings_checked, citations.reduce((sum, item) => sum + item.anatomy_citations.reduce((count, part) => count + part.frame_ids.length, 0), 0));
  assert.equal(review.inspection.visual_aspect_citations_checked, citations.reduce((sum, item) => sum + Object.keys(item.aspect_citations).length, 0));
  assert.equal(review.inspection.visual_aspect_frame_bindings_checked, citations.reduce((sum, item) => sum + Object.values(item.aspect_citations).reduce((count, aspect) => count + aspect.frame_ids.length, 0), 0));
  assert.doesNotMatch(JSON.stringify(review), /\/Users\/|\/tmp\/|data:image|\.png|\.jpe?g|api_key|Bearer\s/);
});
