import { RouterError } from "./router.mjs";
import { canonicalDigest, readJsonPinned } from "./integrity.mjs";
import { fileURLToPath } from "node:url";

// Explicit judgments, not a beauty detector. Technical closure cannot supply
// missing visual judgment; extracted recipes cannot supply source-pixel rights.
function need(value, message) {
  if (!value) throw new RouterError(`visual goal: ${message}`, 4);
}
function shape(value, keys, label) {
  need(value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).every((key) => keys.includes(key)), `${label} has unsupported fields`);
}
function text(value, label) {
  need(typeof value === "string" && value.trim().length > 0, `${label} is required`);
}
function strings(value, label, min = 1) {
  need(Array.isArray(value) && value.length >= min, `${label} is incomplete`);
  value.forEach((item) => text(item, label));
  need(new Set(value).size === value.length, `${label} has duplicates`);
}
function same(actual, expected, label) {
  strings(actual, label, expected.length ? 1 : 0);
  need(actual.length === expected.length && actual.every((key) => expected.includes(key)),
    `${label} must cover the exact bound set`);
}

export function validateVisualGoalContract(contract, craft) {
  shape(contract, ["visual_goal_contract_version", "goals", "observation_locales"], "contract");
  need(contract.visual_goal_contract_version === 1 && craft, "contract requires target craft v1");
  if (contract.observation_locales !== undefined) strings(contract.observation_locales, "observation locales");
  need(Array.isArray(contract.goals) && contract.goals.length > 0, "goals are missing");
  strings(contract.goals.map((goal) => goal.goal_id), "goal IDs");
  for (const goal of contract.goals) {
    shape(goal, ["goal_id", "intent", "unacceptable_outcomes", "relationship_ids"], "goal");
    need(/^[a-z][a-z0-9-]*$/.test(goal.goal_id), "goal ID must be semantic and stable");
    text(goal.intent, "goal intent");
    strings(goal.unacceptable_outcomes, "unacceptable visual outcomes");
    strings(goal.relationship_ids, "goal relationships");
    need(goal.relationship_ids.every((key) => craft.relationships.some((item) => item.relationship_id === key)),
      "goal references an unbound target relationship");
  }
  need(craft.relationships.every((item) => contract.goals.some((goal) => goal.relationship_ids.includes(item.relationship_id))),
    "every target relationship needs an explicit visual goal");
  return contract;
}

export function visualGoalPacketContract(contract, craft) {
  validateVisualGoalContract(contract, craft);
  return {
    contract_digest: canonicalDigest(contract),
    obligations: structuredClone(contract),
    review_field: "visual_goal_review",
    review_contract: readJsonPinned(fileURLToPath(new URL("../schemas/visual-goal-review.schema.json", import.meta.url)),
      { label: "visual goal review schema" }).input,
    comparison_scope: "actual-target-renders-versus-verified-source-neutral-recipes",
    source_craft_parity_assessed: false,
    owner_approval_granted: false,
    rule: "Judge every visual goal independently of local regression closure. A repaired border, passing tasks, browser PASS, or within-pool ranking cannot resolve an unmet direction goal. Compare rendered coupled component relationships with the bound recipe, not manifest presence. Preserve instructions are suggestions unless they repeat an exact bound obligation; neither is new skin approval. Unresolved or rejected visual goals require a hard blocker. Do not use source captures for craft parity."
  };
}

// Only consume an already accepted browser record. The design engine separately
// validates official child provenance and the full executed report on replay.
// Locale cannot be inferred from screenshot filenames or a reviewer's claim.
export function visualGoalScreenshotBindings(browser) {
  const reports = (browser?.evidence || []).filter((item) => item.evidence_kind === "test-report");
  need(reports.length === 1, "locale observations require one bound official browser report");
  const report = readJsonPinned(reports[0].resolved_path, { label: "visual goal browser report" });
  need(report.digest === reports[0].digest, "locale browser report digest changed");
  need(report.input.design_playwright_report_version === 2 && Array.isArray(report.input.executions),
    "locale observations require executed design browser evidence");
  return report.input.executions.map((row) => {
    need(row.outcome === "passed" && row.locale_after === true && typeof row.locale === "string",
      "locale observation was not executed successfully");
    need(browser.evidence.some((shot) => shot.evidence_kind === "screenshot" &&
      shot.digest === row.screenshot_digest && shot.viewport === row.viewport && shot.state === row.state),
    "locale report screenshot is not bound to the browser result");
    return { kind: "screenshot", digest: row.screenshot_digest, viewport: row.viewport, state: row.state, locale: row.locale };
  });
}

function observations(items, browser, evidence, label, locales) {
  need(Array.isArray(items), `${label} requires actual rendered evidence`);
  const key = (viewport, state, locale) => JSON.stringify(locales ? [viewport, state, locale] : [viewport, state]);
  const required = evidence.required_viewports.flatMap((viewport) => evidence.required_states.flatMap((state) =>
    (locales || [null]).map((locale) => key(viewport, state, locale))));
  same(items.map((item) => key(item.viewport, item.state, item.locale)), required, `${label} dimensions`);
  const shots = locales ? visualGoalScreenshotBindings(browser) : browser?.evidence;
  for (const item of items) {
    shape(item, ["viewport", "state", "screenshot_digest", "observation", ...(locales ? ["locale"] : [])], label);
    text(item.observation, `${label} observation`);
    need(shots?.some((shot) => (shot.evidence_kind || shot.kind) === "screenshot" && shot.viewport === item.viewport &&
      shot.state === item.state && shot.digest === item.screenshot_digest && (!locales || shot.locale === item.locale)),
    `${label} screenshot is not bound to this candidate/browser/locale`);
  }
}

export function validateVisualGoalReview(review, contract, craft, records, browsers, evidence) {
  if (!contract) {
    need(review === undefined, "historical run cannot claim an unbound visual-goal verdict");
    return new Map();
  }
  validateVisualGoalContract(contract, craft);
  shape(review, ["visual_goal_review_version", "contract_digest", "candidates"], "review");
  need(review.visual_goal_review_version === 1 && review.contract_digest === canonicalDigest(contract), "review contract digest mismatch");
  need(Array.isArray(review.candidates), "review candidates are missing");
  same(review.candidates.map((item) => item.candidate_id), records.map((item) => item.normalized.candidate_id), "review candidates");
  const verdicts = new Map();
  for (const item of review.candidates) {
    shape(item, ["candidate_id", "result_digest", "browser_result_digest", "goals", "local_regression", "relationship_comparisons", "preserve_instructions"], "candidate review");
    const record = records.find((entry) => entry.normalized.candidate_id === item.candidate_id);
    const browser = browsers.find((entry) => entry?.normalized.candidate_id === item.candidate_id);
    need(record.result_digest === item.result_digest && browser?.result_digest === item.browser_result_digest,
      "candidate/browser result binding mismatch");
    shape(item.local_regression, ["status", "note"], "local regression");
    need(["closed", "open", "not-assessed"].includes(item.local_regression.status), "local regression status is invalid");
    text(item.local_regression.note, "local regression note");
    need(Array.isArray(item.goals), "goal assessments are missing");
    same(item.goals.map((goal) => goal.goal_id), contract.goals.map((goal) => goal.goal_id), "goal assessments");
    let satisfied = true;
    for (const goal of item.goals) {
      shape(goal, ["goal_id", "verdict", "rationale", "observations"], "goal assessment");
      need(["satisfied", "unresolved", "rejected"].includes(goal.verdict), "goal verdict is invalid");
      text(goal.rationale, "goal assessment rationale");
      observations(goal.observations, browser, evidence, `goal ${goal.goal_id}`, contract.observation_locales);
      satisfied = goal.verdict === "satisfied" && satisfied;
    }
    need(Array.isArray(item.relationship_comparisons), "rendered recipe comparisons are missing");
    same(item.relationship_comparisons.map((entry) => entry.relationship_id), craft.relationships.map((entry) => entry.relationship_id), "recipe comparisons");
    for (const comparison of item.relationship_comparisons) {
      shape(comparison, ["relationship_id", "binding_digest", "basis", "verdict", "rationale", "observations"], "relationship comparison");
      const relation = craft.relationships.find((entry) => entry.relationship_id === comparison.relationship_id);
      need(comparison.binding_digest === canonicalDigest(relation.binding), "recipe comparison binding mismatch");
      need(comparison.basis === (relation.binding.kind === "recipe" ? "verified-recipe" : "target-invention"),
        "comparison cannot invent source support or source-capture authority");
      need(["supported", "unsupported", "unassessed"].includes(comparison.verdict), "relationship comparison verdict is invalid");
      text(comparison.rationale, "relationship comparison rationale");
      observations(comparison.observations, browser, evidence, `relationship ${comparison.relationship_id}`, contract.observation_locales);
      satisfied = comparison.verdict === "supported" && satisfied;
    }
    need(Array.isArray(item.preserve_instructions), "preserve instructions must be explicit, including an empty list");
    for (const instruction of item.preserve_instructions) {
      shape(instruction, ["relationship_id", "mode", "text", "decision_digest"], "preserve instruction");
      const relation = craft.relationships.find((entry) => entry.relationship_id === instruction.relationship_id);
      need(relation, "preserve instruction relationship is unbound");
      text(instruction.text, "preserve instruction text");
      need(["suggestion", "bound-obligation"].includes(instruction.mode), "reviewer cannot create a mandatory skin/Owner approval");
      if (instruction.mode === "bound-obligation") {
        need(instruction.decision_digest === canonicalDigest(relation.decision) &&
          relation.decision.preserves.includes(instruction.text), "unsupported preserve instruction cannot freeze an unapproved skin");
      } else need(instruction.decision_digest === undefined, "reviewer suggestion cannot masquerade as bound authority");
    }
    // Deliberately not derived from local_regression, technical checks or scores.
    verdicts.set(item.candidate_id, satisfied);
  }
  return verdicts;
}
