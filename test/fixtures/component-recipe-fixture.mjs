import fs from "node:fs";

export function componentRecipe() {
  return JSON.parse(fs.readFileSync(new URL("../../examples/component-recipe.example.json", import.meta.url), "utf8"));
}

export function componentSpecs(recipes, viewports, states) {
  return recipes.map(({ grammar_id, recipe_digest, recipe }) => ({
    grammar_id, recipe_digest, disposition: "applied",
    rationale: "Synthetic protocol fixture only, not a human craft approval.",
    visual_values: {
      surface: "Target canvas #FFFFFF and inset plane #F8FAFC",
      edges: "Target 1px #64748B border with 8px outer radius",
      elevation: "Target overlay shadow 0 8px 24px rgba(15,23,42,0.15)",
      typography: "Target system-ui 16px; 600 label; tabular-nums for comparison values",
      spacing: "Target cell inset 12px and 20px between attribute groups",
      color: "Target text #0F172A; action #1D4ED8; warning #92400E",
      imagery: "No image is needed for the synthetic object",
      motion: "Target state changes preserve geometry; reduced motion removes transitions"
    },
    part_selectors: Object.fromEntries(recipe.anatomy.map((part) => [part.part_id,
      ({ identity: "h1", value: "[data-killsloprouter-state]:not([hidden]) h2", conditions: "[data-killsloprouter-state]:not([hidden]) [data-state-copy]", detail: "button" })[part.part_id] || "main"])),
    responsive: viewports.map((viewport, index) => {
      const { basis: _basis, observed_ids: _ids, ...variant } = recipe.responsive_variants[Math.min(index, 2)];
      return { ...variant, viewport };
    }),
    state_treatments: Object.fromEntries(states.map((state) => [state, `Target ${state} keeps object identity and exposes the next permitted action.`])),
    interaction_treatments: { ...recipe.interaction_states },
    coherence: "One target type scale, corner family and elevation ladder across the specimen.",
    content_stress: [...recipe.content_stress],
    intermediate_width_behavior: recipe.intermediate_width_behavior
  }));
}
