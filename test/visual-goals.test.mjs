import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { canonicalDigest, hashArtifact } from "../src/integrity.mjs";
import { validateVisualGoalContract, visualGoalPacketContract, validateVisualGoalReview } from "../src/visual-goals.mjs";
import { selectedComponentRecipes } from "../src/component-recipes.mjs";
import { componentRecipe } from "./fixtures/component-recipe-fixture.mjs";
import { targetCraft } from "./fixtures/component-craft-fixture.mjs";
import { targetVisualGoals, visualGoalReview } from "./fixtures/visual-goal-fixture.mjs";
import { assertPublishedSchema } from "./fixtures/schema-validation.mjs";

function fixture() {
  const recipes = selectedComponentRecipes([{ grammar_id: "grammar-001", component_recipe: componentRecipe() }]);
  const craft = targetCraft(recipes), goals = targetVisualGoals(craft);
  const evidence = { required_viewports: ["mobile", "tablet", "desktop"], required_states: ["default", "error"] };
  const id = "card--refine";
  const records = [{ normalized: { candidate_id: id }, result_digest: canonicalDigest("candidate") }];
  const browsers = [{ normalized: { candidate_id: id }, result_digest: canonicalDigest("browser"), evidence:
    evidence.required_viewports.flatMap(viewport => evidence.required_states.map(state => ({
      evidence_kind: "screenshot", viewport, state, digest: canonicalDigest({ viewport, state }) }))) }];
  const task = { candidate_ids: [id], visual_goal_contract: visualGoalPacketContract(goals, craft),
    candidate_bindings: { [id]: records[0] }, browser_bindings: { [id]: { ...browsers[0], evidence: browsers[0].evidence.map(item => ({ ...item, kind: item.evidence_kind })) } },
    reference_intelligence: { component_recipe_contract: { ...evidence, target_craft: { obligations: craft } } } };
  return { craft, goals, evidence, records, browsers, task, review: visualGoalReview(task) };
}
function validate(f) { return validateVisualGoalReview(f.review, f.goals, f.craft, f.records, f.browsers, f.evidence); }

test("visual judgment is separate from regression closure and never creates aesthetic or Owner approval", () => {
  const f = fixture();
  assertPublishedSchema("visual-goal-contract", f.goals);
  assertPublishedSchema("visual-goal-review", f.review);
  assert.equal(validate(f).get("card--refine"), true);
  assert.equal(f.task.visual_goal_contract.owner_approval_granted, false);
  assert.equal(f.task.visual_goal_contract.source_craft_parity_assessed, false);
  for (const verdict of ["unresolved", "rejected"]) {
    f.review.candidates[0].goals[0].verdict = verdict;
    assert.equal(f.review.candidates[0].local_regression.status, "closed");
    assert.equal(validate(f).get("card--refine"), false);
  }
});

for (const [name, mutate, pattern] of [
  ["missing judgment", f => { f.review = undefined; }, /review has unsupported/],
  ["missing visual goal", f => { f.review.candidates[0].goals = []; }, /goal assessments/],
  ["missing actual relationship comparison", f => { f.review.candidates[0].relationship_comparisons = []; }, /recipe comparisons/],
  ["stale browser result", f => { f.review.candidates[0].browser_result_digest = canonicalDigest("stale"); }, /binding mismatch/],
  ["borrowed screenshot", f => { f.review.candidates[0].goals[0].observations[0].screenshot_digest = canonicalDigest("other"); }, /screenshot is not bound/],
  ["viewport omission", f => { f.review.candidates[0].relationship_comparisons[0].observations.pop(); }, /dimensions/],
  ["recipe substitution", f => { f.review.candidates[0].relationship_comparisons[0].binding_digest = canonicalDigest("other"); }, /binding mismatch/],
  ["new source-pixel purpose", f => { f.review.candidates[0].relationship_comparisons[0].basis = "source-capture-parity"; }, /cannot invent source support/],
  ["invented mandatory skin", f => { f.review.candidates[0].preserve_instructions = [{ relationship_id: "identity-value-treatment", mode: "mandatory", text: "Keep the white skin." }]; }, /cannot create/],
  ["digest laundered skin", f => { f.review.candidates[0].preserve_instructions = [{ relationship_id: "identity-value-treatment", mode: "bound-obligation", text: "Keep the white skin.", decision_digest: canonicalDigest(f.craft.relationships[0].decision) }]; }, /unsupported preserve/],
  ["approval masquerading as suggestion", f => { f.review.candidates[0].preserve_instructions = [{ relationship_id: "identity-value-treatment", mode: "suggestion", text: "Try a quieter surface.", decision_digest: canonicalDigest("approval") }]; }, /masquerade/]
]) test(`visual review rejects ${name}`, () => { const f = fixture(); mutate(f); assert.throws(() => validate(f), pattern); });

test("supported preserve and optional suggestions remain valid with no universal palette ban", () => {
  const f = fixture();
  f.review.candidates[0].preserve_instructions = [
    { relationship_id: "identity-value-treatment", mode: "bound-obligation", text: "contrast hierarchy", decision_digest: canonicalDigest(f.craft.relationships[0].decision) },
    { relationship_id: "identity-value-treatment", mode: "suggestion", text: "Consider a white or gray surface if it meets the target intent; not an approval." }
  ];
  assert.equal(validate(f).get("card--refine"), true);
  f.review.candidates[0].relationship_comparisons[0].verdict = "unsupported";
  assert.equal(validate(f).get("card--refine"), false);
});

test("legacy verdicts cannot be manufactured and uncovered relationships stop a new contract", () => {
  assert.equal(validateVisualGoalReview(undefined, undefined).size, 0);
  const f = fixture();
  assert.throws(() => validateVisualGoalReview(f.review, undefined), /historical run/);
  f.goals.goals[0].relationship_ids = ["missing"];
  assert.throws(() => validateVisualGoalContract(f.goals, f.craft), /unbound target/);
});

test("locale-scoped goal review binds each observation to its executed screenshot, not the locale list", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ksr-goal-locales-"));
  try {
    const f = fixture();
    f.goals.observation_locales = ["ko-KR", "en-US"];
    const executions = f.evidence.required_viewports.flatMap(viewport => f.evidence.required_states.flatMap(state =>
      f.goals.observation_locales.map(locale => ({ viewport, state, locale,
        screenshot_digest: canonicalDigest({ viewport, state, locale }), outcome: "passed", locale_after: true }))));
    const reportPath = path.join(directory, "report.json");
    fs.writeFileSync(reportPath, JSON.stringify({ design_playwright_report_version: 2, executions }));
    f.browsers[0].evidence = executions.map(row => ({ evidence_kind: "screenshot", ...row, digest: row.screenshot_digest }));
    f.browsers[0].evidence.push({ evidence_kind: "test-report", resolved_path: reportPath, digest: hashArtifact(reportPath) });
    f.task.browser_bindings["card--refine"].evidence = executions.map(row => ({ kind: "screenshot", ...row, digest: row.screenshot_digest }));
    f.task.visual_goal_contract = visualGoalPacketContract(f.goals, f.craft);
    f.review = visualGoalReview(f.task);
    assertPublishedSchema("visual-goal-contract", f.goals);
    assertPublishedSchema("visual-goal-review", f.review);
    assert.equal(validate(f).get("card--refine"), true);
    const original = structuredClone(f.review);
    f.review.candidates[0].goals[0].observations[0].screenshot_digest = executions[1].screenshot_digest;
    assert.throws(() => validate(f), /candidate\/browser\/locale/);
    f.review = structuredClone(original);
    delete f.review.candidates[0].relationship_comparisons[0].observations[0].locale;
    assert.throws(() => validate(f), /dimensions/);
    f.review = structuredClone(original);
    f.review.candidates[0].goals[0].observations.pop();
    assert.throws(() => validate(f), /dimensions/);
    f.review = original;
    fs.writeFileSync(reportPath, JSON.stringify({ design_playwright_report_version: 2, executions: [] }));
    assert.throws(() => validate(f), /report digest changed/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("legacy viewport/state judgment cannot silently claim locale coverage", () => {
  const f = fixture();
  f.review.candidates[0].goals[0].observations[0].locale = "ko-KR";
  assert.throws(() => validate(f), /unsupported fields/);
  f.goals.observation_locales = [];
  assert.throws(() => validateVisualGoalContract(f.goals, f.craft), /observation locales/);
});
