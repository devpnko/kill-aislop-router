import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AXE_CORE_VERSION, PLAYWRIGHT_CORE_VERSION } from "../src/playwright.mjs";
import { hashArtifact } from "../src/integrity.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function filesBelow(relative, extension) {
  const start = path.join(root, relative);
  if (!fs.existsSync(start)) return [];
  const found = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) walk(absolute);
      if (entry.isFile() && absolute.endsWith(extension)) found.push(absolute);
    }
  };
  walk(start);
  return found;
}

const jsonFiles = [
  path.join(root, "package.json"),
  path.join(root, ".codex-plugin", "plugin.json"),
  ...filesBelow("router", ".json"),
  ...filesBelow("registry", ".json"),
  ...filesBelow("schemas", ".json"),
  ...filesBelow("examples", ".json")
];
for (const file of jsonFiles) JSON.parse(fs.readFileSync(file, "utf8"));

const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const packageLock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
const pluginJson = JSON.parse(fs.readFileSync(path.join(root, ".codex-plugin", "plugin.json"), "utf8"));
const router = JSON.parse(fs.readFileSync(path.join(root, "router", "default-router.json"), "utf8"));
const toolLock = JSON.parse(fs.readFileSync(path.join(root, "registry", "tool-lock.json"), "utf8"));
const exampleProfile = JSON.parse(fs.readFileSync(
  path.join(root, "examples", "project-profile.example.json"),
  "utf8"
));
assert.equal(packageJson.version, router.router_version, "package and router versions must agree");
const pluginBaseVersion = pluginJson.version.replace(/\+codex\.[0-9A-Za-z.-]+$/, "");
assert.equal(packageJson.version, pluginBaseVersion, "package and plugin base versions must agree");
assert.match(
  pluginJson.version,
  new RegExp(`^${packageJson.version.replace(/\./g, "\\.")}(?:\\+codex\\.[0-9A-Za-z.-]+)?$`),
  "plugin version may contain only the Codex development cachebuster"
);
assert.equal(pluginJson.name, "killsloprouter", "plugin name must match its folder and package identity");
assert.equal(pluginJson.skills, "./skills/", "plugin must expose its bundled skills");
assert.equal("mcpServers" in pluginJson, false, "V1 plugin must not declare an MCP server");
assert.ok(
  pluginJson.interface.defaultPrompt.every((prompt) => prompt.includes("$killsloprouter:kill-slop-router")),
  "plugin prompts must use the namespaced skill invocation"
);
assert.ok(fs.existsSync(path.join(root, "skills", "kill-slop-router", "SKILL.md")), "plugin skill is missing");
assert.ok(fs.existsSync(path.join(root, "scripts", "install-codex-plugin.mjs")), "plugin installer is missing");
assert.equal(router.invariants.surface_is_not_a_visual_style_preset, true);
assert.equal(router.invariants.editorial_treatment_requires_verified_visual_intent, true);
assert.equal(router.invariants.scanner_zero_hits_is_not_design_approval, true);
assert.equal(router.invariants.visual_signature_authority_is_digest_bound, true);
assert.equal(router.invariants.palette_frequency_is_not_style_authority, true);
assert.equal(router.invariants.critic_preferences_cannot_override_visual_signature, true);
for (const invariant of [
  "creator_cannot_self_approve",
  "browser_evidence_required_for_visual_approval",
  "profile_commands_are_never_executed",
  "routable_is_not_execution_evidence",
  "locale_domain_privacy_browser_and_owner_gates_remain_hard"
]) {
  assert.equal(router.invariants[invariant], true, `${invariant} must remain a hard invariant`);
}
for (const blocker of [
  "authority-or-privacy-leak",
  "missing-required-state",
  "keyboard-failure",
  "contrast-failure",
  "overflow-overlap-or-clipping",
  "visual-intent-contract-violation",
  "visual-signature-contract-violation",
  "brand-token-substitution",
  "unapproved-style-normalization"
]) {
  assert.ok(router.adjudication.hard_blockers.includes(blocker),
    `${blocker} must remain a hard blocker`);
}
assert.ok(router.provider_capabilities["visual-intent-review"]?.independent_from_creator);
assert.ok(router.stage_capability_contracts["visual-intent-review"]?.requires_independent_critic);
const signatureCapabilities = [
  "palette-fidelity",
  "typography-fidelity",
  "density-fidelity",
  "shape-fidelity",
  "elevation-fidelity",
  "imagery-fidelity",
  "motion-fidelity",
  "transformation-boundary"
];
for (const capability of signatureCapabilities) {
  assert.ok(router.provider_capabilities["visual-intent-review"].capabilities.includes(capability),
    `visual-intent-review provider must declare ${capability}`);
  assert.ok(router.stage_capability_contracts["visual-intent-review"].required.includes(capability),
    `visual-intent-review stage must require ${capability}`);
}
for (const routeId of [
  "existing-ui-audit",
  "design-system-extraction",
  "operator-product-ui",
  "consumer-product-ui",
  "marketing-editorial"
]) {
  const route = router.routes.find((item) => item.id === routeId);
  assert.ok(route?.stages.some((stage) => stage.id === "visual-intent-review"),
    `${routeId} must preserve the visual-intent gate`);
}
const exampleIntent = exampleProfile.visual_intents?.[exampleProfile.surface_contract.primary];
assert.equal(exampleIntent?.status, "approved", "example visual intent must be approved");
const intentReceiptPath = path.resolve(
  path.dirname(path.join(root, "examples", "project-profile.example.json")),
  exampleIntent.authority_receipt
);
assert.equal(hashArtifact(intentReceiptPath), exampleIntent.authority_digest,
  "example visual-intent receipt digest must match the profile");
const intentReceipt = JSON.parse(fs.readFileSync(intentReceiptPath, "utf8"));
assert.deepEqual(intentReceipt.intent, {
  mode: exampleIntent.mode,
  editorial_treatment: exampleIntent.editorial_treatment,
  editorial_scope: exampleIntent.editorial_scope,
  energy: exampleIntent.energy,
  depth: exampleIntent.depth,
  preserve: exampleIntent.preserve,
  avoid: exampleIntent.avoid
}, "example visual-intent receipt must repeat the exact profile contract");
for (const evidence of intentReceipt.evidence) {
  const evidencePath = path.resolve(path.dirname(intentReceiptPath), evidence.path);
  assert.equal(hashArtifact(evidencePath), evidence.digest,
    `example visual-intent evidence digest must match: ${evidence.path}`);
}
const exampleSignature = exampleProfile.visual_signatures?.[exampleProfile.surface_contract.primary];
assert.equal(exampleSignature?.status, "approved", "example visual signature must be approved");
const signatureReceiptPath = path.resolve(
  path.dirname(path.join(root, "examples", "project-profile.example.json")),
  exampleSignature.authority_receipt
);
assert.equal(hashArtifact(signatureReceiptPath), exampleSignature.authority_digest,
  "example visual-signature receipt digest must match the profile");
const signatureReceipt = JSON.parse(fs.readFileSync(signatureReceiptPath, "utf8"));
const signatureBody = {
  palette: exampleSignature.palette,
  typography: exampleSignature.typography,
  density: exampleSignature.density,
  shape: exampleSignature.shape,
  elevation: exampleSignature.elevation,
  imagery: exampleSignature.imagery,
  motion: exampleSignature.motion,
  style_keywords: exampleSignature.style_keywords,
  forbidden_transformations: exampleSignature.forbidden_transformations
};
assert.deepEqual(signatureReceipt.signature, signatureBody,
  "example visual-signature receipt must repeat the exact profile contract");
const signatureEvidencePaths = new Set();
for (const evidence of signatureReceipt.evidence) {
  const evidencePath = path.resolve(path.dirname(signatureReceiptPath), evidence.path);
  assert.equal(hashArtifact(evidencePath), evidence.digest,
    `example visual-signature evidence digest must match: ${evidence.path}`);
  signatureEvidencePaths.add(evidence.path);
}
const expectedSignatureAspects = new Set([
  "palette",
  "typography",
  "density",
  "shape",
  "elevation",
  "imagery",
  "motion",
  "style_keywords",
  "forbidden_transformations"
]);
assert.deepEqual(new Set(signatureReceipt.coverage.map((item) => item.aspect)), expectedSignatureAspects,
  "example visual-signature receipt must cover every aspect exactly once");
const coveredEvidencePaths = new Set(signatureReceipt.coverage.flatMap((item) => item.evidence_paths));
assert.deepEqual(coveredEvidencePaths, signatureEvidencePaths,
  "example visual-signature evidence must be assigned to coverage");
assert.equal(packageJson.engines.node, ">=20", "V1 Node engine floor must remain explicit");
assert.equal(packageLock.lockfileVersion, 3, "npm lockfile version must remain explicit");
assert.equal(packageLock.packages[""].dependencies["playwright-core"], "1.62.1");
assert.equal(packageLock.packages[""].dependencies["axe-core"], "4.13.0");
assert.equal(packageLock.packages["node_modules/playwright-core"].version, "1.62.1");
assert.equal(packageLock.packages["node_modules/axe-core"].version, "4.13.0");
assert.equal(PLAYWRIGHT_CORE_VERSION, packageJson.dependencies["playwright-core"]);
assert.equal(AXE_CORE_VERSION, packageJson.dependencies["axe-core"]);
for (const packageName of ["playwright-core", "axe-core"]) {
  const lockedTool = toolLock.tools.find((tool) => tool.id === packageName);
  const lockedPackage = packageLock.packages[`node_modules/${packageName}`];
  assert.equal(lockedTool.version, lockedPackage.version, `${packageName} registry version must match npm lock`);
  assert.equal(lockedTool.integrity, lockedPackage.integrity,
    `${packageName} registry integrity must match npm lock`);
}

const markdownFiles = [
  ...filesBelow("docs", ".md"),
  path.join(root, "README.md"),
  path.join(root, "SECURITY.md"),
  path.join(root, "CHANGELOG.md")
];
const linkPattern = /\[[^\]]+\]\(([^)]+)\)/g;
for (const file of markdownFiles) {
  const source = fs.readFileSync(file, "utf8");
  for (const match of source.matchAll(linkPattern)) {
    const target = match[1].trim();
    if (/^(?:https?:|mailto:|#)/.test(target)) continue;
    const withoutAnchor = target.split("#")[0];
    const resolved = path.resolve(path.dirname(file), decodeURIComponent(withoutAnchor));
    assert.ok(fs.existsSync(resolved), `${path.relative(root, file)} has a broken link: ${target}`);
  }
}

const ci = fs.readFileSync(path.join(root, ".github", "workflows", "ci.yml"), "utf8");
assert.match(ci, /node:\s*\[20, 22\]/, "CI must test Node 20 and 22");
assert.match(ci, /contents:\s*read/, "CI repository permission must remain read-only");
assert.match(ci, /npm ci --ignore-scripts/, "CI must install from the exact lockfile");
assert.match(ci, /playwright-core install --with-deps chromium/,
  "CI must install its browser explicitly");
assert.match(ci, /KSR_PLAYWRIGHT_CHANNEL:\s*bundled/,
  "CI must use the explicitly installed Playwright Chromium build");

process.stdout.write(`static checks: ${jsonFiles.length} JSON files, ${markdownFiles.length} Markdown files\n`);
