import { RouterError } from "./router.mjs";
import { canonicalDigest } from "./integrity.mjs";
import { referenceProjection } from "./reference-projection.mjs";
import path from "node:path";
import { trustedPlatformPath } from "./path-security.mjs";

const check = (value, message) => { if (!value) throw new RouterError(message, 4); };
const text = value => typeof value === "string" && value.trim().length > 0;
const fields = ["reference_candidate_version", "comparison_id", "planned_candidate_count", "planned_state_paths", "candidate_count_rationale", "primary_reference_id", "primary_grammar_ids", "task_frame"];

export function validateReferenceCandidate(brief) {
  const candidate = brief.reference_candidate;
  if (!candidate) return;
  check(Object.keys(candidate).length === fields.length && fields.every(key => Object.hasOwn(candidate, key)), "reference candidate fields are missing or unsupported");
  check(candidate.reference_candidate_version === 1, "reference candidate version must be 1");
  for (const key of ["comparison_id", "candidate_count_rationale", "primary_reference_id", "task_frame"]) check(text(candidate[key]), `reference candidate ${key} is required`);
  // Resource guard, not a design-quality quota: one is a valid justified plan.
  check(Number.isInteger(candidate.planned_candidate_count) && candidate.planned_candidate_count >= 1 && candidate.planned_candidate_count <= 24, "reference candidate count must be 1..24 (comparison resource bound, not a quality quota)");
  check(Array.isArray(candidate.planned_state_paths) && candidate.planned_state_paths.length === candidate.planned_candidate_count && candidate.planned_state_paths.every(value => text(value) && path.isAbsolute(value)) && new Set(candidate.planned_state_paths.map(trustedPlatformPath)).size === candidate.planned_candidate_count, "reference candidate must predeclare the exact unique absolute state paths of its whole cohort");
  check(Array.isArray(candidate.primary_grammar_ids) && candidate.primary_grammar_ids.length > 0 && candidate.primary_grammar_ids.every(text) && new Set(candidate.primary_grammar_ids).size === candidate.primary_grammar_ids.length, "reference candidate primary grammar ids must be unique and nonempty");
  check(brief.reference_pack && brief.specimen_feedback && brief.visual_goal_contract && brief.component_craft && brief.constraint_audit, "reference candidate requires reference pack, specimen feedback, visual goals, component craft and constraint audit");
  check(Array.isArray(brief.visual_goal_contract.observation_locales) && canonicalDigest([...brief.visual_goal_contract.observation_locales].sort()) === canonicalDigest([...brief.locales].sort()), "reference candidate visual goals must explicitly observe every project locale");
  check(brief.directions?.length === 1 && brief.color_strategies?.length === 0, "reference candidate requires one direction and zero color strategies; no unrun siblings may be invented");
}

export function candidateReferenceProjection(brief, pack) {
  const projection = referenceProjection(pack);
  const candidate = brief.reference_candidate;
  if (!candidate) return projection;
  check(pack.references.some(item => item.reference_id === candidate.primary_reference_id), "reference candidate primary reference is outside the verified pack");
  const selected = candidate.primary_grammar_ids.map(id => pack.verified_grammar.find(item => item.grammar_id === id));
  check(selected.every(item => item && item.reference_id === candidate.primary_reference_id), "reference candidate grammar must belong only to its explicit primary reference; silent blending is forbidden");
  const reasoningIds = new Set(selected.flatMap(item => item.reasoning_ids));
  check([...reasoningIds].every(id => pack.verified_hierarchy_reasoning.some(item => item.reasoning_id === id && item.reference_id === candidate.primary_reference_id)), "reference candidate reasoning must close over its primary reference only");
  const families = new Set(selected.filter(item => item.component_recipe).map(item => item.component_recipe.family));
  check((brief.reference_requirement?.required_recipe_families || []).every(family => families.has(family)), "reference candidate primary subset is missing required recipe families");
  check(selected.some(item => item.component_recipe) && selected.some(item => item.dimension !== "color-roles"), "reference candidate needs a primary component recipe and applicable direction grammar");
  const aliases = new Set(candidate.primary_grammar_ids.map(id => projection.grammar_aliases.get(id)));
  const causalAliases = new Set([...reasoningIds].map(id => projection.reasoning_aliases.get(id)));
  return { ...projection,
    transferable_grammar: projection.transferable_grammar.filter(item => aliases.has(item.grammar_id)),
    causal_reasoning: projection.causal_reasoning.filter(item => causalAliases.has(item.reasoning_id))
  };
}

export function referenceCandidateTaskFrame(state) {
  const brief = state.brief;
  return {
    project_id: brief.project_id, surface: brief.surface, screen_id: brief.screen_id,
    product: brief.product, baseline_digest: state.baseline.digest,
    baseline_policy: brief.baseline_policy, editorial_boundary: brief.editorial_boundary,
    evidence: brief.evidence, locales: brief.locales,
    task_frame: brief.reference_candidate.task_frame
  };
}

export function referenceCandidateBinding(state) {
  if (!state.brief.reference_candidate) return null;
  const candidate = state.brief.reference_candidate;
  check(!state.state_path || candidate.planned_state_paths.map(trustedPlatformPath).includes(trustedPlatformPath(state.state_path)), "reference candidate run path is outside its predeclared cohort");
  const projection = candidateReferenceProjection(state.brief, state.reference_pack.normalized);
  return {
    ...structuredClone(candidate), planned_state_paths: candidate.planned_state_paths.map(trustedPlatformPath).sort(),
    pack_digest: state.reference_pack.pack_digest,
    primary_recipe_digest: canonicalDigest(projection.transferable_grammar),
    causal_reasoning_digest: canonicalDigest(projection.causal_reasoning),
    task_frame_digest: canonicalDigest(referenceCandidateTaskFrame(state))
  };
}
