import { canonicalDigest } from "../../src/integrity.mjs";

export function targetVisualGoals(craft) {
  return { visual_goal_contract_version: 1, goals: [{
    goal_id: "recognizable-task-treatment",
    intent: "Preserve a deliberate identity/value/control relationship supporting comparison, not metadata-only differentiation.",
    unacceptable_outcomes: ["A technically readable but visually unresolved repeated record treatment."],
    relationship_ids: craft.relationships.map((item) => item.relationship_id)
  }] };
}

// Injected protocol verdicts, never an actual taste or Owner assessment.
export function visualGoalReview(task, settings = {}) {
  const contract = task.visual_goal_contract;
  if (!contract || settings.omit_visual_goal_review) return null;
  const craft = task.reference_intelligence.component_recipe_contract.target_craft.obligations;
  const evidence = task.reference_intelligence.component_recipe_contract;
  return { visual_goal_review_version: 1, contract_digest: contract.contract_digest,
    candidates: task.candidate_ids.map((id) => {
      const browser = task.browser_bindings[id];
      const locales = contract.obligations.observation_locales;
      const observations = () => evidence.required_viewports.flatMap(viewport => evidence.required_states.flatMap(state => (locales || [null]).map(locale => ({
        viewport, state, ...(locales ? { locale } : {}),
        screenshot_digest: browser.evidence.find(item => item.kind === "screenshot" && item.viewport === viewport && item.state === state && (!locales || item.locale === locale)).digest,
        observation: "Synthetic injected observation of coupled target treatment; not an actual visual judgment."
      }))));
      return { candidate_id: id, result_digest: task.candidate_bindings[id].result_digest, browser_result_digest: browser.result_digest,
        goals: contract.obligations.goals.map(goal => ({ goal_id: goal.goal_id, verdict: settings.visual_goal_verdict || "satisfied",
          rationale: "Synthetic protocol-only goal assessment.", observations: observations() })),
        local_regression: { status: settings.local_regression_status || "closed", note: "Synthetic scoped regression closure, not direction acceptance." },
        relationship_comparisons: craft.relationships.map(relation => ({ relationship_id: relation.relationship_id,
          binding_digest: canonicalDigest(relation.binding), basis: relation.binding.kind === "recipe" ? "verified-recipe" : "target-invention",
          verdict: "supported", rationale: "Synthetic rendered relationship compared to its exact recipe binding, not a source image.", observations: observations() })),
        preserve_instructions: []
      };
    })
  };
}
