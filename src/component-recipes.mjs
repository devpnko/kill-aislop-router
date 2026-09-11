import { RouterError } from "./router.mjs";
import { canonicalDigest, readJsonPinned } from "./integrity.mjs";
import { fileURLToPath } from "node:url";

// Transferable craft, not source pixels or a replacement visual authority.
export const COMPONENT_VISUAL_ASPECTS = Object.freeze([
  "surface", "edges", "elevation", "typography", "spacing", "color", "imagery", "motion"
]);
export const COMPONENT_RANGES = Object.freeze(["compact", "medium", "wide"]);
export const COMPONENT_CRAFT_CHECK = Object.freeze({
  check_id: "component-craft-and-reflow",
  lens_ids: ["expression-follows-promise", "responsive-reprioritization"],
  pass_condition: "Inspect the rendered component, not just its rationale: verify its part selectors, surface, edges, elevation, typography, spacing, color roles, imagery and motion against the target specification. Check every mapped viewport and required state, intermediate-width behavior, focus and pointer operation, preserved comparison axes, and coherence with the project visual signature. Reject generic flattening and incompatible style collages. Browser success does not certify aesthetic quality or human authorship.",
  required_evidence: ["component-craft-spec", "prototype", "playwright-evidence", "review-report"],
  stages: ["direction-review", "color-review"],
  failure_code: "reference-check-failed:component-craft-and-reflow"
});

function need(value, message) {
  if (!value) throw new RouterError(`component recipe: ${message}`, 4);
}
function text(value, label) {
  need(typeof value === "string" && value.trim().length > 0, `${label} must be nonempty text`);
}
function shape(value, keys, label) {
  need(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  need(Object.keys(value).every((key) => keys.includes(key)), `${label} has an unsupported field`);
}
function list(value, label, min = 1) {
  need(Array.isArray(value) && value.length >= min, `${label} requires ${min} or more items`);
  value.forEach((item) => text(item, label));
  need(new Set(value).size === value.length, `${label} has duplicate items`);
}
function same(left, right) {
  return left.length === right.length && left.every((item) => right.includes(item));
}
function aspects(value, label) {
  shape(value, COMPONENT_VISUAL_ASPECTS, label);
  COMPONENT_VISUAL_ASPECTS.forEach((key) => text(value[key], `${label}.${key}`));
}
function partPartition(value, parts, label) {
  list(value.preserved_parts, `${label}.preserved_parts`);
  list(value.deferred_parts, `${label}.deferred_parts`, 0);
  const all = [...value.preserved_parts, ...value.deferred_parts];
  need(new Set(all).size === all.length && same(all, parts.map((part) => part.part_id)),
    `${label} must account for every part exactly once`);
  need(parts.filter((part) => part.priority === "primary")
    .every((part) => value.preserved_parts.includes(part.part_id)),
  `${label} cannot defer primary decision or comparison parts`);
  text(value.composition, `${label}.composition`);
  text(value.access_path, `${label}.access_path`);
  need(["reflow", "contained-scroll", "none"].includes(value.overflow_strategy),
    `${label}.overflow_strategy is invalid`);
}

export function validateComponentRecipe(recipe, observedIds = []) {
  shape(recipe, ["component_recipe_version", "family", "anatomy", "visual_treatment",
    "preserve_character", "coherence_rules", "responsive_variants", "interaction_states",
    "content_stress", "intermediate_width_behavior"], "recipe");
  need(recipe.component_recipe_version === 1, "version must be 1");
  text(recipe.family, "family");
  need(Array.isArray(recipe.anatomy) && recipe.anatomy.length >= 2,
    "anatomy requires at least two visually differentiated parts");
  for (const part of recipe.anatomy) {
    shape(part, ["part_id", "role", "priority", "treatment"], "anatomy part");
    need(/^[a-z][a-z0-9-]*$/.test(part.part_id), "part_id must be a stable semantic ID");
    text(part.role, "part role");
    text(part.treatment, "part treatment");
    need(["primary", "secondary", "supporting"].includes(part.priority), "part priority is invalid");
  }
  list(recipe.anatomy.map((part) => part.part_id), "part IDs");
  need(recipe.anatomy.some((part) => part.priority === "primary"), "a primary part is required");
  aspects(recipe.visual_treatment, "visual_treatment");
  list(recipe.preserve_character, "preserve_character");
  list(recipe.coherence_rules, "coherence_rules");
  list(recipe.content_stress, "content_stress");
  text(recipe.intermediate_width_behavior, "intermediate_width_behavior");
  shape(recipe.interaction_states, ["rest", "hover", "focus-visible", "active", "disabled"],
    "interaction_states");
  for (const state of ["rest", "hover", "focus-visible", "active", "disabled"]) {
    text(recipe.interaction_states[state], `interaction_states.${state}`);
  }
  need(Array.isArray(recipe.responsive_variants) && recipe.responsive_variants.length === 3,
    "responsive_variants must cover compact, medium and wide");
  list(recipe.responsive_variants.map((item) => item.range), "responsive ranges");
  need(same(recipe.responsive_variants.map((item) => item.range), COMPONENT_RANGES),
    "responsive ranges must be compact, medium and wide");
  for (const variant of recipe.responsive_variants) {
    shape(variant, ["range", "basis", "observed_ids", "composition", "preserved_parts",
      "deferred_parts", "access_path", "overflow_strategy"], "responsive variant");
    need(["observed", "target-proposal"].includes(variant.basis), "responsive basis is invalid");
    list(variant.observed_ids, "responsive observed_ids", variant.basis === "observed" ? 1 : 0);
    need(variant.basis === "observed"
      ? variant.observed_ids.every((id) => observedIds.includes(id))
      : variant.observed_ids.length === 0,
    "responsive observations must be bound; proposals cannot claim source observations");
    partPartition(variant, recipe.anatomy, `responsive ${variant.range}`);
  }
  return recipe;
}

export function projectComponentRecipe(recipe) {
  // Keep the fact/proposal distinction, but never leak source observation IDs.
  const projected = structuredClone(recipe);
  for (const variant of projected.responsive_variants) delete variant.observed_ids;
  return projected;
}

export function selectedComponentRecipes(grammar) {
  return grammar.filter((item) => item.component_recipe).map((item) => ({
    grammar_id: item.grammar_id,
    recipe_digest: canonicalDigest(item.component_recipe),
    recipe: item.component_recipe
  }));
}

// A child runs in its own evidence directory, not the package root. Ship a
// closed schema with the packet instead of an unusable relative file hint.
export function componentSchemaContract(kind) {
  need(["recipe", "specs"].includes(kind), "unsupported schema contract");
  const documents = new Map(["component-recipe.schema.json", "component-specs.schema.json"].map((name) => [
    name, readJsonPinned(fileURLToPath(new URL(`../schemas/${name}`, import.meta.url)),
      { label: `component schema ${name}` }).input
  ]));
  function expand(value, documentName, ancestors = []) {
    if (Array.isArray(value)) return value.map((item) => expand(item, documentName, ancestors));
    if (!value || typeof value !== "object") return value;
    if (value.$ref) {
      const [file, fragment = ""] = value.$ref.split("#");
      const targetName = file || documentName;
      const key = `${targetName}#${fragment}`;
      need(documents.has(targetName) && !ancestors.includes(key), "schema reference is external or cyclic");
      const target = fragment.split("/").filter(Boolean).reduce((node, token) => node?.[token], documents.get(targetName));
      need(target !== undefined, "schema reference is unresolved");
      return expand(target, targetName, [...ancestors, key]);
    }
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => key !== "$defs" && key !== "$id")
      .map(([key, item]) => [key, expand(item, documentName, ancestors)]));
  }
  const name = `component-${kind}.schema.json`;
  const schema = expand(documents.get(name), name);
  return { schema, schema_digest: canonicalDigest(schema) };
}

export function validateComponentViewports(viewports, required) {
  const widths = required.map((id) => viewports?.[id]?.width);
  need(widths.every((width) => Number.isInteger(width) && width > 0) && new Set(widths).size >= 3,
    "compact/medium/wide require three distinct configured browser widths, not three aliases");
}

export function validateComponentRangeMapping(specs, viewports) {
  for (const spec of specs || []) {
    if (spec.disposition !== "applied") continue;
    const ordered = [...spec.responsive].sort((a, b) => viewports[a.viewport].width - viewports[b.viewport].width);
    const ranks = ordered.map((item) => COMPONENT_RANGES.indexOf(item.range));
    need(ranks.every((rank, index) => index === 0 || rank >= ranks[index - 1]),
      "component responsive ranges conflict with the configured browser width order");
  }
}

// Candidate-specific values live here, not in extracted source grammar. The
// containing design-contract evidence is hashed, independently reviewed and
// retained with the candidate; this is not an approval or a style preset.
export function validateComponentSpecs(specs, recipes, evidence) {
  if (!recipes.length) {
    need(specs === undefined, "unbound component_specs are forbidden");
    return;
  }
  need(Array.isArray(specs) && specs.length === recipes.length,
    "component_specs must disposition every selected recipe");
  list(specs.map((spec) => spec.grammar_id), "component_specs grammar IDs");
  need(evidence.required_viewports.length >= 3,
    "craft evidence needs three distinct project viewports for compact, medium and wide");
  for (const spec of specs) {
    const source = recipes.find((item) => item.grammar_id === spec.grammar_id);
    need(source && spec.recipe_digest === source.recipe_digest, "spec recipe digest binding mismatch");
    shape(spec, ["grammar_id", "recipe_digest", "disposition", "rationale", "visual_values",
      "part_selectors", "responsive", "state_treatments", "interaction_treatments",
      "coherence", "content_stress", "intermediate_width_behavior"], "component spec");
    text(spec.rationale, "spec rationale");
    need(["applied", "not-applicable"].includes(spec.disposition), "spec disposition is invalid");
    const implementationFields = ["visual_values", "part_selectors", "responsive", "state_treatments",
      "interaction_treatments", "coherence", "content_stress", "intermediate_width_behavior"];
    if (spec.disposition === "not-applicable") {
      need(implementationFields.every((key) => spec[key] === undefined),
        "not-applicable cannot claim an implementation");
      continue;
    }
    aspects(spec.visual_values, "visual_values");
    shape(spec.part_selectors, source.recipe.anatomy.map((part) => part.part_id), "part_selectors");
    for (const part of source.recipe.anatomy) text(spec.part_selectors[part.part_id], `selector ${part.part_id}`);
    text(spec.coherence, "coherence");
    text(spec.intermediate_width_behavior, "intermediate_width_behavior");
    list(spec.content_stress, "content_stress");
    shape(spec.state_treatments, evidence.required_states, "state_treatments");
    evidence.required_states.forEach((state) => text(spec.state_treatments[state], `state ${state}`));
    const interactions = Object.keys(source.recipe.interaction_states);
    shape(spec.interaction_treatments, interactions, "interaction_treatments");
    interactions.forEach((state) => text(spec.interaction_treatments[state], `interaction ${state}`));
    need(Array.isArray(spec.responsive) && spec.responsive.length === evidence.required_viewports.length,
      "responsive must map every required project viewport");
    list(spec.responsive.map((item) => item.viewport), "responsive viewports");
    need(same(spec.responsive.map((item) => item.viewport), evidence.required_viewports),
      "responsive has an unknown or missing project viewport");
    need(COMPONENT_RANGES.every((range) => spec.responsive.some((item) => item.range === range)),
      "responsive must exercise all three size ranges");
    for (const variant of spec.responsive) {
      shape(variant, ["range", "viewport", "composition", "preserved_parts", "deferred_parts",
        "access_path", "overflow_strategy"], "spec responsive variant");
      need(COMPONENT_RANGES.includes(variant.range), "spec responsive range is invalid");
      partPartition(variant, source.recipe.anatomy, `spec responsive ${variant.viewport}`);
    }
  }
  need(specs.some((spec) => spec.disposition === "applied"),
    "all recipes were discarded; select a fitting reference direction instead of claiming craft coverage");
}
