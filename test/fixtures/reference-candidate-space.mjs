import fs from "node:fs";
import path from "node:path";
import { specimenSpace } from "./specimen-space.mjs";
import { designConstraintInventory } from "../../src/design-constraints.mjs";
import { hashArtifact } from "../../src/integrity.mjs";

// Synthetic fixture authority only; never an actual Owner or aesthetic verdict.
export function referenceCandidateSpace({ count = 1, comparisonId = "single-task-comparison" } = {}) {
  const space = specimenSpace();
  const brief = JSON.parse(fs.readFileSync(space.briefPath));
  const pack = JSON.parse(fs.readFileSync(path.resolve(space.directory, brief.reference_pack.path)));
  brief.directions = [brief.directions[0]];
  brief.color_strategies = [];
  brief.visual_goal_contract.observation_locales = [...brief.locales];
  const primary = pack.verified_grammar.find(item => item.component_recipe).reference_id;
  brief.reference_candidate = {
    reference_candidate_version: 1, comparison_id: comparisonId,
    planned_candidate_count: count,
    planned_state_paths: count === 1 ? [space.statePath] : Array.from({ length: count }, (_, index) => path.join(space.directory, `planned-${index}.json`)),
    candidate_count_rationale: "Inspect each distinct primary-reference hypothesis once; no depth or color quota.",
    primary_reference_id: primary,
    primary_grammar_ids: pack.verified_grammar.filter(item => item.reference_id === primary).map(item => item.grammar_id),
    task_frame: "Compare target exception triage specimens under the same target task and evidence matrix."
  };
  const source = path.join(space.directory, "candidate-constraint-evidence.json");
  fs.writeFileSync(source, JSON.stringify({ synthetic: true, claim: "Target functional evidence fixture; not Owner taste or visual approval." }));
  brief.constraint_audit = {
    version: 1, context: "exploration",
    evidence: [{ evidence_id: "target-functional", path: path.basename(source), digest: hashArtifact(source) }],
    released_proposals: [],
    entries: designConstraintInventory(brief).map(({ pointer, value_digest, hard }) => ({
      pointer, value_digest, role: hard ? "functional" : "design-proposal",
      rationale: "Synthetic protocol classification, not proof of human preference.",
      evidence_ids: hard ? ["target-functional"] : []
    }))
  };
  fs.writeFileSync(space.briefPath, JSON.stringify(brief));
  return { ...space, brief };
}
