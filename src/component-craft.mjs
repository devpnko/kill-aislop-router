import path from "node:path";
import { RouterError } from "./router.mjs";
import { canonicalDigest, readJsonPinned } from "./integrity.mjs";
import { COMPONENT_VISUAL_ASPECTS, componentSchemaContract } from "./component-recipes.mjs";

// Target-side obligations. No source imagery, new aesthetic score or approval.
const digest = /^sha256:[a-f0-9]{64}$/;
const id = /^[a-z][a-z0-9-]*$/;
function need(value, message) {
  if (!value) throw new RouterError(`component craft: ${message}`, 4);
}
function text(value, label) {
  need(typeof value === "string" && value.trim().length > 0, `${label} is required`);
}
function shape(value, keys, label) {
  need(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  need(Object.keys(value).every((key) => keys.includes(key)), `${label} has an unsupported field`);
}
function strings(value, label, min = 1) {
  need(Array.isArray(value) && value.length >= min, `${label} is incomplete`);
  value.forEach((item) => text(item, label));
  need(new Set(value).size === value.length, `${label} has duplicates`);
}
function entries(value, key, label, min = 1) {
  need(Array.isArray(value) && value.length >= min, `${label} is incomplete`);
  strings(value.map((item) => item?.[key]), label, min);
  return value.map((item) => item[key]);
}
function same(actual, expected, label) {
  need(actual.length === expected.length && actual.every((item) => expected.includes(item)),
    `${label} coverage gap; account for every declared target exactly once`);
}
function binding(value, recipes, label, part = false) {
  shape(value, ["kind", "grammar_id", "recipe_digest", "part_ids", "rationale"], label);
  if (value.kind === "target-invention") {
    text(value.rationale, `${label} target invention rationale`);
    need(["grammar_id", "recipe_digest", "part_ids"].every((key) => value[key] === undefined),
      `${label} invention cannot claim extracted recipe coverage`);
    return;
  }
  need(value.kind === "recipe", `${label} requires recipe binding or explicit target invention`);
  text(value.grammar_id, `${label} grammar_id`);
  need(digest.test(value.recipe_digest), `${label} recipe_digest is invalid`);
  need(value.rationale === undefined, `${label} recipe cannot claim invention`);
  if (part) strings(value.part_ids, `${label} recipe part_ids`);
  else need(value.part_ids === undefined, `${label} relationship uses whole recipe treatment`);
  if (!recipes) return; // Shape-only brief validation, before pack resolution.
  const recipe = recipes.find((item) => item.grammar_id === value.grammar_id);
  need(recipe?.recipe_digest === value.recipe_digest, `${label} recipe binding mismatch`);
  if (part) need(value.part_ids.every((key) => recipe.recipe.anatomy.some((item) => item.part_id === key)),
    `${label} names an absent recipe part`);
}

export function validateComponentCraft(contract, recipes = null) {
  shape(contract, ["component_craft_version", "parts", "relationships", "constraint_evidence"], "contract");
  need(contract.component_craft_version === 1, "component_craft_version must be 1");
  const parts = entries(contract.parts, "part_id", "target parts", 2);
  const relationships = entries(contract.relationships, "relationship_id", "target relationships");
  need([...parts, ...relationships].every((key) => id.test(key)), "target IDs must be stable semantic IDs");
  const evidence = entries(contract.constraint_evidence, "evidence_id", "constraint evidence", 0);
  for (const item of contract.constraint_evidence) {
    shape(item, ["evidence_id", "path", "digest", "relationship_ids"], "constraint evidence");
    text(item.path, "constraint evidence path");
    need(digest.test(item.digest), "constraint evidence digest is invalid");
    strings(item.relationship_ids, "constraint relationship scope");
    need(item.relationship_ids.every((key) => relationships.includes(key)), "constraint evidence scope is unknown");
  }
  for (const part of contract.parts) {
    shape(part, ["part_id", "role", "binding"], `part ${part.part_id}`);
    text(part.role, `part ${part.part_id} role`);
    binding(part.binding, recipes, `part ${part.part_id}`, true);
    need(contract.relationships.some((item) => item.part_ids?.includes(part.part_id)),
      `part ${part.part_id} has no relationship coverage`);
  }
  for (const relation of contract.relationships) {
    const label = `relationship ${relation.relationship_id}`;
    shape(relation, ["relationship_id", "part_ids", "aspects", "expectation", "binding", "decision"], label);
    strings(relation.part_ids, `${label} part_ids`, 2);
    need(relation.part_ids.every((key) => parts.includes(key)), `${label} names an undeclared target part`);
    strings(relation.aspects, `${label} aspects`);
    need(relation.aspects.every((key) => COMPONENT_VISUAL_ASPECTS.includes(key)), `${label} unknown visual aspect`);
    text(relation.expectation, `${label} expectation`);
    binding(relation.binding, recipes, label);
    const decision = relation.decision;
    shape(decision, ["disposition", "basis", "rationale", "target_treatment", "preserves", "changes", "evidence_ids"], `${label} decision`);
    need(["preserve", "adapt", "replace"].includes(decision.disposition), `${label} disposition is invalid`);
    need(["recipe-transfer", "target-invention", "parent-preference", "functional", "accessibility", "approved-brand"].includes(decision.basis), `${label} basis is invalid`);
    for (const key of ["rationale", "target_treatment"]) text(decision[key], `${label} ${key}`);
    strings(decision.preserves, `${label} preserves`);
    strings(decision.changes, `${label} changes`, decision.disposition === "preserve" ? 0 : 1);
    need(decision.disposition !== "preserve" || decision.changes.length === 0, `${label} preserve cannot conceal changed treatment`);
    need(!decision.preserves.some((item) => decision.changes.includes(item)), `${label} cannot preserve and change the same property`);
    strings(decision.evidence_ids, `${label} evidence_ids`, 0);
    need(decision.evidence_ids.every((key) => evidence.includes(key) && contract.constraint_evidence
      .find((item) => item.evidence_id === key).relationship_ids.includes(relation.relationship_id)), `${label} constraint evidence is unbound or out of scope`);
    if (["functional", "accessibility", "approved-brand"].includes(decision.basis)) {
      need(decision.evidence_ids.length > 0, `${label} claimed project constraint needs scoped evidence, not parent preference`);
    }
    if (relation.binding.kind === "target-invention") {
      need(decision.basis !== "recipe-transfer" && decision.disposition !== "preserve",
        `${label} invention cannot claim preserved reference treatment`);
    }
  }
  need(["surface", "edges", "elevation", "typography", "spacing", "color"].every((aspect) =>
    contract.relationships.some((item) => item.aspects.includes(aspect))),
  "relationship coverage must address surface, edge/depth, internal type, spacing and color roles together");
  return contract;
}

// Re-read on dispatch/resume/result validation. Evidence remains a claimed
// constraint for the independent reviewer, never automatic brand authority.
export function verifyCraftConstraints(contract, briefPath) {
  if (!contract) return [];
  const directory = path.dirname(path.resolve(briefPath));
  return contract.constraint_evidence.map((item) => {
    const target = path.resolve(directory, item.path);
    const relative = path.relative(directory, target);
    need(relative && !relative.startsWith("..") && !path.isAbsolute(relative), "constraint evidence must be inside the brief lane");
    const pinned = readJsonPinned(target, { label: "target craft constraint" });
    need(pinned.bytes <= 1024 * 1024, "constraint evidence must be a bounded target JSON document");
    need(pinned.digest === item.digest, `constraint ${item.evidence_id} digest mismatch`);
    return { ...item, path: target, input: pinned.input };
  });
}

export function craftPacketContract(contract, recipes) {
  validateComponentCraft(contract, recipes);
  // Do not grant creator access to files used to substantiate constraints.
  const projected = structuredClone(contract);
  projected.constraint_evidence = projected.constraint_evidence.map(({ path: _path, ...item }) => item);
  return {
    contract_digest: canonicalDigest(contract),
    obligations: projected,
    specification_field: "design-contract.component_craft",
    review_field: "component_craft_review",
    implementation_contract: componentSchemaContract("craft-implementation"),
    review_contract: componentSchemaContract("craft-review"),
    review_scope: "target-renders-against-source-neutral-obligations",
    source_craft_parity_assessed: false,
    owner_approval_granted: false,
    rule: "Inspect every target part and coupled relationship at every required state and viewport. Compare actual target renders with the bound expectations and decisions, not prose alone. Review contrast, accent area/placement, state separation, edge/depth, internal type and controls together. Hue adaptation is allowed; unsupported flattening or missing parts fails component-craft-and-reflow. Constraint evidence is a claim to check, not granted authority. Parent preferences cannot silently replace bound obligations. Browser PASS and ranking do not prove visual improvement."
  };
}

export function assertCraftPacket(packet, contract, recipes, constraints = []) {
  if (!contract) return;
  const envelope = packet.design_task.reference_intelligence?.component_recipe_contract;
  const reviewer = ["direction-review", "color-review", "specimen-review"].includes(packet.design_task.kind);
  need(reviewer
    ? canonicalDigest(envelope?.target_constraint_evidence ?? null) === canonicalDigest(constraints)
    : envelope?.target_constraint_evidence === undefined,
  "final participant packet changed or leaked reviewer-only target constraint evidence");
  if (packet.design_task.kind === "browser-evidence") {
    need(envelope?.target_craft === undefined, "browser packet cannot receive target craft review authority");
    return;
  }
  const received = envelope?.target_craft;
  need(received && canonicalDigest(received) === canonicalDigest(craftPacketContract(contract, recipes)),
    "final participant packet lost or changed target craft obligations; repair dispatch before spawning a child");
}

export function validateCraftImplementation(value, contract, specs) {
  if (!contract) {
    need(value === undefined, "legacy run cannot claim unbound target craft coverage");
    return;
  }
  shape(value, ["component_craft_version", "contract_digest", "parts", "relationships"], "implementation");
  need(value.component_craft_version === 1 && value.contract_digest === canonicalDigest(contract), "implementation contract digest mismatch");
  same(entries(value.parts, "part_id", "implemented parts"), contract.parts.map((part) => part.part_id), "part");
  for (const part of value.parts) {
    shape(part, ["part_id", "selector"], "implemented part");
    text(part.selector, `part ${part.part_id} selector`);
  }
  same(entries(value.relationships, "relationship_id", "implemented relationships"),
    contract.relationships.map((item) => item.relationship_id), "relationship");
  for (const relation of value.relationships) {
    shape(relation, ["relationship_id", "decision_digest", "implementation"], "implemented relationship");
    const expected = contract.relationships.find((item) => item.relationship_id === relation.relationship_id);
    need(relation.decision_digest === canonicalDigest(expected.decision), `relationship ${relation.relationship_id} changed the bound preserve/adapt/replace decision`);
    text(relation.implementation, `relationship ${relation.relationship_id} actual treatment`);
  }
  for (const target of [...contract.parts, ...contract.relationships]) {
    if (target.binding.kind !== "recipe") continue;
    need(specs?.some((spec) => spec.grammar_id === target.binding.grammar_id &&
      spec.recipe_digest === target.binding.recipe_digest && spec.disposition === "applied"),
    "target-bound recipe cannot be discarded by component_specs while claiming appearance coverage");
  }
}

function observations(items, evidence, browser, field, label) {
  const dimensions = evidence.required_viewports.flatMap((viewport) => evidence.required_states.map((state) => `${viewport}:${state}`));
  need(Array.isArray(items), `${label} rendered observations are missing`);
  const seen = [];
  for (const item of items) {
    shape(item, ["viewport", "state", "screenshot_digest", field, "note"], label);
    seen.push(`${item.viewport}:${item.state}`);
    need(typeof item[field] === "boolean", `${label} ${field} must be boolean`);
    text(item.note, `${label} observation note`);
    need(browser.evidence.some((snapshot) => snapshot.evidence_kind === "screenshot" &&
      snapshot.viewport === item.viewport && snapshot.state === item.state && snapshot.digest === item.screenshot_digest),
    `${label} must bind an actual candidate browser screenshot for this state/viewport`);
  }
  strings(seen, `${label} observed dimensions`);
  same(seen, dimensions, `${label} rendered`);
  return items.every((item) => item[field]);
}

export function validateCraftReview(review, contract, records, browsers, evidence) {
  if (!contract) {
    need(review === undefined, "legacy run cannot claim unbound rendered target craft review");
    return new Map();
  }
  shape(review, ["component_craft_review_version", "contract_digest", "candidates"], "rendered review");
  need(review.component_craft_review_version === 1 && review.contract_digest === canonicalDigest(contract), "rendered review contract digest mismatch");
  same(entries(review.candidates, "candidate_id", "review candidates"), records.map((item) => item.normalized.candidate_id), "review candidate");
  const verdicts = new Map();
  for (const item of review.candidates) {
    shape(item, ["candidate_id", "result_digest", "browser_result_digest", "parts", "relationships"], "review candidate");
    const candidate = records.find((record) => record.normalized.candidate_id === item.candidate_id);
    const browser = browsers.find((record) => record?.normalized.candidate_id === item.candidate_id);
    need(candidate.result_digest === item.result_digest && browser?.result_digest === item.browser_result_digest,
      "rendered craft review candidate/browser binding mismatch");
    same(entries(item.parts, "part_id", "review parts"), contract.parts.map((part) => part.part_id), "review part");
    same(entries(item.relationships, "relationship_id", "review relationships"), contract.relationships.map((relation) => relation.relationship_id), "review relationship");
    let passed = true;
    for (const part of item.parts) {
      shape(part, ["part_id", "observations"], "review part");
      const present = observations(part.observations, evidence, browser, "present", `part ${part.part_id}`);
      passed = present && passed;
    }
    for (const relation of item.relationships) {
      shape(relation, ["relationship_id", "adaptation_supported", "rationale", "observations"], "review relationship");
      need(typeof relation.adaptation_supported === "boolean", "adaptation_supported must be a reviewer determination");
      text(relation.rationale, "review adaptation rationale");
      const intact = observations(relation.observations, evidence, browser, "passed", `relationship ${relation.relationship_id}`);
      passed = intact && relation.adaptation_supported && passed;
    }
    verdicts.set(item.candidate_id, passed);
  }
  return verdicts;
}
