import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  validateComponentCraft, verifyCraftConstraints, craftPacketContract, assertCraftPacket,
  validateCraftImplementation, validateCraftReview
} from "../src/component-craft.mjs";
import { canonicalDigest, hashArtifact } from "../src/integrity.mjs";
import { componentRecipe, componentSpecs } from "./fixtures/component-recipe-fixture.mjs";
import { selectedComponentRecipes } from "../src/component-recipes.mjs";
import { targetCraft, craftImplementation, craftReview } from "./fixtures/component-craft-fixture.mjs";
import { assertPublishedSchema } from "./fixtures/schema-validation.mjs";

function fixture() {
  const recipes = selectedComponentRecipes([1, 2, 3].map((n) => ({ grammar_id: `grammar-00${n}`, component_recipe: componentRecipe() })));
  const contract = targetCraft(recipes);
  const evidence = { required_viewports: ["mobile", "tablet", "desktop"], required_states: ["default", "error"] };
  const records = [{ normalized: { candidate_id: "card--refine" }, result_digest: canonicalDigest("candidate") }];
  const browsers = [{ normalized: { candidate_id: "card--refine" }, result_digest: canonicalDigest("browser"), evidence: evidence.required_viewports.flatMap((viewport) => evidence.required_states.map((state) => ({ viewport, state, evidence_kind: "screenshot", digest: canonicalDigest({ viewport, state }) }))) }];
  const packet = craftPacketContract(contract, recipes);
  return { recipes, contract, evidence, records, browsers, packet,
    specs: componentSpecs(recipes, evidence.required_viewports, evidence.required_states),
    implementation: craftImplementation(packet), review: craftReview(packet, records, browsers, evidence) };
}

test("target appearance contract maps parts and relationships, not recipe counts or family names", () => {
  const f = fixture();
  assert.equal(f.recipes.length, 3);
  assert.equal(f.recipes.flatMap((item) => Object.keys(item.recipe.visual_treatment)).length, 24);
  validateComponentCraft(f.contract, f.recipes);
  f.contract.parts.push({ part_id: "status-badge", role: "Visible status separate from the answer" });
  assert.throws(() => validateComponentCraft(f.contract, f.recipes), /part status-badge/);
  assert.throws(() => validateComponentCraft(undefined, f.recipes), /contract must be an object/);
});

test("row to card needs mapped treatment, not a forced new family taxonomy", () => {
  const f = fixture();
  f.contract.parts[0].role = "Identity inside the new result card";
  assert.equal(f.recipes[0].recipe.family, "comparison-table");
  validateComponentCraft(f.contract, f.recipes);
  assertPublishedSchema("component-craft", f.contract);
});

for (const [name, mutate, pattern] of [
  ["unknown recipe", (c) => c.parts[0].binding.grammar_id = "missing", /binding mismatch/],
  ["recipe digest tamper", (c) => c.relationships[0].binding.recipe_digest = canonicalDigest("other"), /binding mismatch/],
  ["absent recipe badge", (c) => c.parts[0].binding.part_ids = ["status-badge"], /absent recipe part/],
  ["unmapped relationship", (c) => c.relationships[0].part_ids.push("invented-card"), /undeclared/],
  ["only hierarchy, no material", (c) => c.relationships[0].aspects = ["typography"], /edge\/depth/],
  ["silent parent flattening", (c) => { c.relationships[0].decision.basis = "parent-preference"; c.relationships[0].decision.rationale = ""; }, /rationale/],
  ["preserve labeled while changes made", (c) => c.relationships[0].decision.disposition = "preserve", /conceal/],
  ["unscoped brand claim", (c) => c.relationships[0].decision.basis = "approved-brand", /scoped evidence/]
]) test(`coverage rejects ${name}`, () => {
  const f = fixture(); mutate(f.contract);
  assert.throws(() => validateComponentCraft(f.contract, f.recipes), pattern);
});

test("explicit target invention remains honest and cannot claim extracted material", () => {
  const f = fixture();
  f.contract.parts[0].binding = { kind: "target-invention", rationale: "The target needs a compact identity control absent from the recipe." };
  f.contract.relationships[0].binding = { ...f.contract.parts[0].binding };
  assert.throws(() => validateComponentCraft(f.contract, f.recipes), /invention cannot claim/);
  f.contract.relationships[0].decision.basis = "target-invention";
  validateComponentCraft(f.contract, f.recipes);
});

test("hue adaptation preserves relative craft and is not a literal color constraint", () => {
  const f = fixture();
  f.contract.relationships[0].decision.target_treatment = "Use a blue identity accent instead of green, same small area and placement, contrast hierarchy and edge/depth.";
  validateComponentCraft(f.contract, f.recipes);
  const packet = craftPacketContract(f.contract, f.recipes);
  validateCraftImplementation(craftImplementation(packet), f.contract, f.specs);
  const result = validateCraftReview(craftReview(packet, f.records, f.browsers, f.evidence), f.contract, f.records, f.browsers, f.evidence);
  assert.equal(result.get("card--refine"), true); // Protocol eligibility, not visual detection.
  assert.equal(packet.owner_approval_granted, false);
  assert.equal(packet.source_craft_parity_assessed, false);
});

for (const basis of ["accessibility", "functional", "approved-brand"]) test(`${basis} adaptation requires scoped, unchanged evidence and reviewer support`, () => {
  const f = fixture();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ksr-craft-constraint-"));
  try {
    const file = path.join(directory, "constraint.json");
    fs.writeFileSync(file, JSON.stringify({ claim: "Synthetic target constraint; not Owner approval." }));
    f.contract.constraint_evidence = [{ evidence_id: "target-constraint", path: "constraint.json", digest: hashArtifact(file), relationship_ids: ["identity-value-treatment"] }];
    Object.assign(f.contract.relationships[0].decision, { basis, evidence_ids: ["target-constraint"] });
    validateComponentCraft(f.contract, f.recipes);
    verifyCraftConstraints(f.contract, path.join(directory, "brief.json"));
    assertPublishedSchema("component-craft", f.contract);
    const packet = craftPacketContract(f.contract, f.recipes);
    assert.doesNotMatch(JSON.stringify(packet), /constraint\.json|Synthetic target constraint/);
    const review = craftReview(packet, f.records, f.browsers, f.evidence);
    assert.equal(validateCraftReview(review, f.contract, f.records, f.browsers, f.evidence).get("card--refine"), true);
    review.candidates[0].relationships[0].adaptation_supported = false;
    assert.equal(validateCraftReview(review, f.contract, f.records, f.browsers, f.evidence).get("card--refine"), false);
    fs.writeFileSync(file, "{}");
    assert.throws(() => verifyCraftConstraints(f.contract, path.join(directory, "brief.json")), /digest mismatch/);
    f.contract.constraint_evidence[0].path = "../outside.json";
    assert.throws(() => verifyCraftConstraints(f.contract, path.join(directory, "brief.json")), /inside the brief lane/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("final source-neutral participant packet checks reject omission, overrides and re-digested losses", () => {
  const f = fixture();
  const packet = { design_task: { kind: "direction-candidate", reference_intelligence: { component_recipe_contract: { target_craft: f.packet } } } };
  assertCraftPacket(packet, f.contract, f.recipes);
  packet.design_task.reference_intelligence.component_recipe_contract.target_craft.obligations.parts.pop();
  packet.packet_digest = canonicalDigest(packet);
  assert.throws(() => assertCraftPacket(packet, f.contract, f.recipes), /final participant packet/);
  delete packet.design_task.reference_intelligence;
  assert.throws(() => assertCraftPacket(packet, f.contract, f.recipes), /final participant packet/);
});

test("candidate cannot substitute narrative for part selectors and exact decisions", () => {
  const f = fixture();
  validateCraftImplementation(f.implementation, f.contract, f.specs);
  assertPublishedSchema("component-craft-implementation", f.implementation);
  f.implementation.parts.pop();
  assert.throws(() => validateCraftImplementation(f.implementation, f.contract), /coverage gap/);
  f.implementation = craftImplementation(f.packet);
  f.implementation.relationships[0].decision_digest = canonicalDigest("remove all edge/depth");
  assert.throws(() => validateCraftImplementation(f.implementation, f.contract), /changed the bound/);
});

test("reviewer-only constraint descriptors are exact and cannot leak through re-sealed packets", () => {
  const f = fixture();
  const constraints = [{ evidence_id: "target-rule", path: "/synthetic-private/constraint.json",
    digest: canonicalDigest("constraint"), relationship_ids: ["identity-value-treatment"] }];
  const packet = { design_task: { kind: "direction-review", reference_intelligence: {
    component_recipe_contract: { target_craft: f.packet, target_constraint_evidence: constraints }
  } } };
  assertCraftPacket(packet, f.contract, f.recipes, constraints);
  for (const mutate of [
    (p) => { delete p.design_task.reference_intelligence.component_recipe_contract.target_constraint_evidence; },
    (p) => { p.design_task.reference_intelligence.component_recipe_contract.target_constraint_evidence[0].path = "/substituted.json"; },
    (p) => { p.design_task.kind = "direction-candidate"; },
    (p) => { p.design_task.kind = "color-candidate"; },
    (p) => { p.design_task.kind = "browser-evidence"; }
  ]) {
    const bad = structuredClone(packet); mutate(bad); bad.packet_digest = canonicalDigest(bad);
    assert.throws(() => assertCraftPacket(bad, f.contract, f.recipes, constraints), /reviewer-only target constraint evidence/);
  }
});

test("review requires actual screenshot bindings across state/viewport, not narrative or browser PASS", () => {
  const f = fixture();
  validateCraftReview(f.review, f.contract, f.records, f.browsers, f.evidence);
  assertPublishedSchema("component-craft-review", f.review);
  assert.throws(() => validateCraftReview(undefined, f.contract, f.records, f.browsers, f.evidence), /rendered review/);
  f.review.candidates[0].parts[0].observations[0].screenshot_digest = canonicalDigest("other render");
  assert.throws(() => validateCraftReview(f.review, f.contract, f.records, f.browsers, f.evidence), /actual candidate browser screenshot/);
  f.review = craftReview(f.packet, f.records, f.browsers, f.evidence);
  f.review.candidates[0].relationships[0].observations.pop();
  assert.throws(() => validateCraftReview(f.review, f.contract, f.records, f.browsers, f.evidence), /coverage gap/);
});

for (const mode of ["missing part", "accent slab", "unsupported override"]) test(`injected rendered ${mode} verdict fails craft even with browser success`, () => {
  const f = fixture();
  if (mode === "missing part") f.review.candidates[0].parts[0].observations[0].present = false;
  if (mode === "accent slab") {
    Object.assign(f.review.candidates[0].relationships[0].observations[0], { passed: false, note: "Small selective accent became a large monochrome slab; relationship lost." });
  }
  if (mode === "unsupported override") f.review.candidates[0].relationships[0].adaptation_supported = false;
  assert.equal(validateCraftReview(f.review, f.contract, f.records, f.browsers, f.evidence).get("card--refine"), false);
});

test("legacy state cannot acquire a forged new craft pass", () => {
  validateCraftImplementation(undefined, undefined);
  validateCraftReview(undefined, undefined, [], [], {});
  assert.throws(() => validateCraftImplementation(fixture().implementation, undefined), /legacy/);
  assert.throws(() => validateCraftReview(fixture().review, undefined, [], [], {}), /legacy/);
});

test("applied unrelated recipe cannot mask disposal of a target-bound recipe", () => {
  const f = fixture();
  validateCraftImplementation(f.implementation, f.contract, f.specs);
  f.specs[0].disposition = "not-applicable";
  assert.throws(() => validateCraftImplementation(f.implementation, f.contract, f.specs), /target-bound recipe cannot be discarded/);
  assert.throws(() => validateCraftImplementation(f.implementation, f.contract), /target-bound recipe cannot be discarded/);
});
