import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { hashArtifact } from "../../src/integrity.mjs";

// Deliberately separate synthetic exception fixtures from the public,
// reference-required starter. This helper is not included in npm/plugin payloads.
export const fixtureOptOutPath = fileURLToPath(new URL("./design-reference-opt-out.json", import.meta.url));
export function noReferenceFixtureBrief() {
  const brief = JSON.parse(fs.readFileSync(new URL("../../examples/design-brief.example.json", import.meta.url), "utf8"));
  delete brief.reference_requirement;
  brief.reference_opt_out = {
    path: "design-reference-opt-out.example.json",
    digest: hashArtifact(fixtureOptOutPath)
  };
  return brief;
}
