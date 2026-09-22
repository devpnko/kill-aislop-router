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
