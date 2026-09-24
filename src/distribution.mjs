import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalDigest, hashArtifact } from "./integrity.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FEATURES = {
  "reference-intelligence": [
    "src/reference.mjs", "registry/human-design-reasoning.json",
    "schemas/human-design-reasoning-registry.schema.json",
    "schemas/reference-brief.schema.json", "schemas/reference-pack.schema.json",
    "schemas/reference-packet.schema.json", "schemas/reference-result.schema.json",
    "schemas/reference-run.schema.json", "schemas/uibowl-manual-export.schema.json",
    "docs/reference-intelligence.md"
  ],
  "component-craft": ["src/component-recipes.mjs", "schemas/component-recipe.schema.json", "schemas/component-specs.schema.json"],
  "reference-research-library": ["src/reference-library.mjs", "registry/reference-library.json",
    "schemas/reference-library.schema.json", "docs/reference-library.md",
    "docs/research/ui-bowl-korea-component-study-2026-09-22.json",
    "docs/research/ui-bowl-korea-component-study-2026-09-22.md",
    "docs/research/ui-bowl-korea-component-study-review-2026-09-22.json",
    "docs/research/ui-bowl-korea-familiar-30-2026-09-22.json"],
  "reference-requirement": ["src/design.mjs", "schemas/design-brief.schema.json",
    "schemas/design-reference-opt-out.schema.json", "docs/reference-delivery.md"],
  "reference-selection-handoff": ["src/reference.mjs", "src/usage-guidance.mjs", "docs/reference-delivery.md"],
  "executed-design-browser-proof": ["src/design-browser-proof.mjs", "src/adapters/playwright-browser.mjs"],
  "project-onboarding": ["src/usage-guidance.mjs", "docs/project-setup.md"],
  "account-plugin-sync": ["src/plugin-sync.mjs", "schemas/plugin-sync-policy.schema.json"]
};

// Package inventory, not a host/provider, authentication or live-model test.
// A source checkout, npm install and plugin copy must expose the same feature
// contract. Paths are fixed here, never supplied by a project/profile.
export function inspectDistribution(root = packageRoot) {
  function inventory(files) {
    return files.map((file) => {
      const target = path.join(root, file);
      const regular = fs.existsSync(target) && fs.lstatSync(target).isFile() &&
        !fs.lstatSync(target).isSymbolicLink();
      return { path: file, digest: regular ? hashArtifact(target) : null };
    });
  }
  const entrypointEvidence = inventory([
    ".codex-plugin/plugin.json", "bin/killsloprouter.mjs", "src/cli.mjs",
    "skills/kill-slop-router/SKILL.md", "skills/kill-slop-router/agents/openai.yaml"
  ]);
  const features = Object.entries(FEATURES).map(([id, files]) => {
    const evidence = inventory(files);
    return { id, status: evidence.every((item) => item.digest) ? "available" : "missing", evidence };
  });
  const plugin = JSON.parse(fs.readFileSync(path.join(root, ".codex-plugin/plugin.json"), "utf8"));
  const body = {
    distribution_report_version: 1,
    plugin_version: plugin.version,
    entrypoint_evidence: entrypointEvidence,
    features,
    status: entrypointEvidence.every((item) => item.digest) &&
      features.every((item) => item.status === "available") ? "available" : "incomplete",
    project_reference_bound: false,
    live_skill_loading_verified: false,
    note: "Bundled capabilities only. Git push, matching version strings and package presence do not prove project reference binding, host execution, fresh skill loading or visual approval."
  };
  return { ...body, distribution_digest: canonicalDigest(body) };
}
