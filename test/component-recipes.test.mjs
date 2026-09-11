import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  COMPONENT_CRAFT_CHECK, COMPONENT_VISUAL_ASPECTS, projectComponentRecipe,
  selectedComponentRecipes, validateComponentRecipe, validateComponentSpecs,
  validateComponentViewports, validateComponentRangeMapping, componentSchemaContract
} from "../src/component-recipes.mjs";
import { componentRecipe, componentSpecs } from "./fixtures/component-recipe-fixture.mjs";
import { assertPublishedSchema } from "./fixtures/schema-validation.mjs";
import { canonicalDigest } from "../src/integrity.mjs";

const evidence = { required_viewports: ["mobile", "tablet", "desktop"], required_states: ["default", "loading", "empty", "error", "permission-denied"] };
function setup() {
  const recipe = componentRecipe();
  const recipes = selectedComponentRecipes([{ grammar_id: "grammar-001", component_recipe: projectComponentRecipe(recipe) }]);
  return { recipe, recipes, specs: componentSpecs(recipes, evidence.required_viewports, evidence.required_states) };
}

test("component craft carries eight visual aspects, three sizes and interaction states without source IDs", () => {
  const { recipe, recipes, specs } = setup();
  recipe.responsive_variants[2].basis = "observed";
  recipe.responsive_variants[2].observed_ids = ["source-observation-1"];
  validateComponentRecipe(recipe, ["source-observation-1"]);
  const projection = projectComponentRecipe(recipe);
  assert.equal(projection.responsive_variants[2].basis, "observed");
  assert.doesNotMatch(JSON.stringify(projection), /source-observation-1|observed_ids/);
  assert.deepEqual(Object.keys(projection.visual_treatment), COMPONENT_VISUAL_ASPECTS);
  validateComponentSpecs(specs, recipes, evidence);
  assert.match(specs[0].visual_values.edges, /1px/); // Target values, not source-literal authority.
  assert.deepEqual(COMPONENT_CRAFT_CHECK.stages, ["direction-review", "color-review"]);
  assert.ok(COMPONENT_CRAFT_CHECK.required_evidence.includes("playwright-evidence"));
  assert.match(COMPONENT_CRAFT_CHECK.pass_condition, /does not certify aesthetic quality or human authorship/);
});

for (const [name, mutate, error] of [
  ["missing surface craft", (r) => delete r.visual_treatment.elevation, /elevation/],
  ["missing tablet", (r) => r.responsive_variants.splice(1, 1), /compact, medium and wide/],
  ["duplicate range", (r) => r.responsive_variants[0].range = "wide", /duplicate/],
  ["unseen mobile claimed observed", (r) => r.responsive_variants[0].basis = "observed", /observed_ids/],
  ["forged observation", (r) => { r.responsive_variants[0].basis = "observed"; r.responsive_variants[0].observed_ids = ["fake"]; }, /bound/],
  ["proposal laundering", (r) => r.responsive_variants[0].observed_ids = ["fake"], /proposals/],
  ["lost comparison axis", (r) => { r.responsive_variants[0].preserved_parts.splice(1, 1); r.responsive_variants[0].deferred_parts.push("value"); }, /primary/],
  ["unaccounted part", (r) => r.responsive_variants[0].deferred_parts = [], /every part/],
  ["missing focus", (r) => delete r.interaction_states["focus-visible"], /focus-visible/],
  ["injected command", (r) => r.command = "run anything", /unsupported/]
]) test(`component recipe rejects ${name}`, () => {
  const recipe = componentRecipe();
  mutate(recipe);
  assert.throws(() => validateComponentRecipe(recipe), error);
});

for (const [name, mutate, error] of [
  ["missing specimen specification", (s) => s.splice(0), /every selected recipe/],
  ["recipe tamper", (s) => s[0].recipe_digest = `sha256:${"0".repeat(64)}`, /digest/],
  ["missing actual values", (s) => delete s[0].visual_values.typography, /typography/],
  ["missing selector", (s) => delete s[0].part_selectors.value, /selector value/],
  ["missing state", (s) => delete s[0].state_treatments.error, /state error/],
  ["missing focus implementation", (s) => delete s[0].interaction_treatments["focus-visible"], /focus-visible/],
  ["unverified viewport", (s) => s[0].responsive[1].viewport = "imagined", /unknown or missing/],
  ["all desktop shrink", (s) => s[0].responsive.forEach((v) => v.range = "wide"), /all three/],
  ["hidden primary value", (s) => { s[0].responsive[0].preserved_parts.splice(1, 1); s[0].responsive[0].deferred_parts.push("value"); }, /primary/],
  ["all recipes skipped", (s) => s[0] = { grammar_id: s[0].grammar_id, recipe_digest: s[0].recipe_digest, disposition: "not-applicable", rationale: "No matching component" }, /all recipes were discarded/]
]) test(`component application rejects ${name}`, () => {
  const { recipes, specs } = setup();
  mutate(specs);
  assert.throws(() => validateComponentSpecs(specs, recipes, evidence), error);
});

test("legacy no-recipe flow stays unchanged and does not acquire unbound recipe claims", () => {
  validateComponentSpecs(undefined, [], evidence);
  assert.throws(() => validateComponentSpecs([], [], evidence), /unbound/);
  const { recipes, specs } = setup();
  assert.throws(() => validateComponentSpecs(specs, recipes, { ...evidence, required_viewports: ["mobile", "desktop"] }), /three distinct/);
});

test("responsive proof cannot rename one desktop width as three sizes or reverse width order", () => {
  const { specs } = setup();
  const viewports = { mobile: { width: 390 }, tablet: { width: 768 }, desktop: { width: 1440 } };
  validateComponentViewports(viewports, evidence.required_viewports);
  validateComponentRangeMapping(specs, viewports);
  assert.throws(() => validateComponentViewports({ mobile: { width: 1440 }, tablet: { width: 1440 }, desktop: { width: 1440 } }, evidence.required_viewports), /three distinct configured/);
  [specs[0].responsive[0].range, specs[0].responsive[2].range] = ["wide", "compact"];
  assert.throws(() => validateComponentRangeMapping(specs, viewports), /width order/);
});

test("published recipe schemas expose the same visual aspects and bind result/pack contracts", () => {
  const schema = (name) => JSON.parse(fs.readFileSync(new URL(`../schemas/${name}.schema.json`, import.meta.url)));
  assert.deepEqual(schema("component-recipe").$defs.visual_aspects.required, COMPONENT_VISUAL_ASPECTS);
  assert.equal(schema("reference-result").$defs.grammar_principle.properties.component_recipe.$ref, "component-recipe.schema.json");
  assert.equal(schema("reference-pack").$defs.grammar.properties.component_recipe.$ref, "component-recipe.schema.json");
  assert.ok(schema("reference-brief").properties.coverage.properties.required_recipe_families);
  assert.equal(schema("component-specs").items.properties.recipe_digest.pattern, "^sha256:[a-f0-9]{64}$");
  assertPublishedSchema("component-recipe", componentRecipe());
  assertPublishedSchema("component-specs", setup().specs);
  const card = JSON.parse(fs.readFileSync(new URL("../examples/component-card-recipe.example.json", import.meta.url)));
  validateComponentRecipe(card);
  assertPublishedSchema("component-recipe", card);
  assert.equal(card.family, "result-card");
});

test("packet-only child validates both closed schemas without package-relative schema access", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-packet-consumer-"));
  try {
    for (const [kind, specimen] of [["recipe", componentRecipe()], ["specs", setup().specs]]) {
      const contract = componentSchemaContract(kind);
      assert.equal(contract.schema_digest, canonicalDigest(contract.schema));
      assert.doesNotMatch(JSON.stringify(contract.schema), /"\$ref"/);
      for (const [value, expected] of [[specimen, true], [{}, false]]) {
        const result = spawnSync(process.execPath, [fileURLToPath(new URL("./fixtures/component-packet-consumer.mjs", import.meta.url))], {
          cwd: directory, input: JSON.stringify({ contract, specimen: value }), encoding: "utf8"
        });
        assert.equal(result.status, 0, result.stderr);
        assert.equal(JSON.parse(result.stdout).valid, expected, result.stdout);
      }
    }
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("published packet schemas resolve both historical URI bases before validating", () => {
  for (const name of ["design-packet", "reference-packet"]) {
    assert.throws(() => assertPublishedSchema(name, {}), /must have required property/);
  }
});
