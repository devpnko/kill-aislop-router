import fs from "node:fs";
import { workspace, attachReferencePack } from "../design-suite.mjs";

export function specimenSpace() {
  const space = workspace();
  const before = JSON.parse(fs.readFileSync(space.briefPath));
  before.evidence.required_viewports = ["mobile", "tablet", "desktop"];
  fs.writeFileSync(space.briefPath, JSON.stringify(before));
  attachReferencePack(space, null, { componentRecipes: true });
  const brief = JSON.parse(fs.readFileSync(space.briefPath));
  brief.specimen_feedback = { specimen_feedback_version: 1, candidate_id: `${brief.directions[0].id}--refine` };
  brief.providers.specimen_reviewer = "specimen-critic";
  fs.writeFileSync(space.briefPath, JSON.stringify(brief));
  return { ...space, baselinePath: space.baseline, root: space.directory };
}
