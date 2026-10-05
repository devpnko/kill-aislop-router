import { canonicalDigest } from "../../src/integrity.mjs";

// Synthetic contract/critic messages test protocol only, not visual quality.
export function targetCraft(recipes) {
  const selected = recipes[0];
  const parts = selected.recipe.anatomy.slice(0, 2);
  const link = { kind: "recipe", grammar_id: selected.grammar_id, recipe_digest: selected.recipe_digest };
  return {
    component_craft_version: 1,
    parts: parts.map((part) => ({ part_id: part.part_id, role: part.role,
      binding: { ...link, part_ids: [part.part_id] } })),
    relationships: [{
      relationship_id: "identity-value-treatment", part_ids: parts.map((part) => part.part_id),
      aspects: ["surface", "edges", "elevation", "typography", "spacing", "color"],
      expectation: "An open reading plane, a small identity accent, clear value type and selective edge/depth preserve state separation together.",
      binding: link,
      decision: {
        disposition: "adapt", basis: "recipe-transfer",
        rationale: "Use target roles and hue while preserving comparison and selective emphasis.",
        target_treatment: "Compact labeled accent; raised detail control; open value plane and tabular type.",
        preserves: ["contrast hierarchy", "small accent area", "accent placement", "state separation", "surface-edge-depth relationships"],
        changes: ["target hue"], evidence_ids: []
      }
    }],
    constraint_evidence: []
  };
}

export function craftImplementation(packetContract) {
  const contract = packetContract.obligations;
  return {
    component_craft_version: 1, contract_digest: packetContract.contract_digest,
    parts: contract.parts.map((part, index) => ({ part_id: part.part_id, selector: index ? "h2" : "h1" })),
    relationships: contract.relationships.map((item) => ({ relationship_id: item.relationship_id,
      decision_digest: canonicalDigest(item.decision), implementation: "Target 16px label, 24px value, 1px edge and compact accent; fixture declaration, not a rendered verdict." }))
  };
}

export function craftReview(packetContract, records, browsers, evidence, { passed = true } = {}) {
  const contract = packetContract.obligations;
  return {
    component_craft_review_version: 1, contract_digest: packetContract.contract_digest,
    candidates: records.map((record) => {
      const browser = browsers.find((item) => item.normalized.candidate_id === record.normalized.candidate_id);
      const observations = (field) => evidence.required_viewports.flatMap((viewport) => evidence.required_states.map((state) => ({
        viewport, state,
        screenshot_digest: browser.evidence.find((item) => item.evidence_kind === "screenshot" && item.viewport === viewport && item.state === state).digest,
        [field]: passed, note: "Synthetic injected observation; does not establish an actual independent visual judgment."
      })));
      return {
        candidate_id: record.normalized.candidate_id, result_digest: record.result_digest, browser_result_digest: browser.result_digest,
        parts: contract.parts.map((part) => ({ part_id: part.part_id, observations: observations("present") })),
        relationships: contract.relationships.map((item) => ({ relationship_id: item.relationship_id,
          adaptation_supported: passed, rationale: "Synthetic reviewer protocol fixture only.", observations: observations("passed") }))
      };
    })
  };
}
