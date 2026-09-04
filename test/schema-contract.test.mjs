import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readSchema(name) {
  return JSON.parse(fs.readFileSync(path.join(root, "schemas", name), "utf8"));
}

function satisfiesRequiredObject(schema, value) {
  if (schema.type === "object" && (!value || typeof value !== "object" || Array.isArray(value))) {
    return false;
  }
  return (schema.required || []).every((key) => Object.hasOwn(value, key));
}

test("published start authority schema rejects an empty parent-owned path contract", () => {
  const schema = readSchema("automation-start-authority-receipt.schema.json");
  const parent = schema.$defs.parent_owned_path_contract;
  assert.equal(satisfiesRequiredObject(parent, {}), false);
  assert.deepEqual(parent.required, [
    "automation_parent_path_contract_version", "state_path", "state_directory",
    "resume_authorities_directory", "resume_authority_receipt_path",
    "initialization_authority_receipt_path", "route_directory", "plan_path",
    "audit_path", "packets_directory", "results_directory", "evidence_directory",
    "receipts_directory", "step_receipts", "migration_receipts_directory",
    "migrated_step_receipts", "identity_migration_receipt_path", "final_receipt_path",
    "external_input_policy"
  ]);
  assert.equal(parent.additionalProperties, false);
});

test("published host request schema rejects empty or omitted official Playwright authority", () => {
  const schema = readSchema("host-adapter-request.schema.json");
  const authority = schema.$defs.playwright_authority;
  assert.equal(satisfiesRequiredObject(authority, {}), false);
  assert.deepEqual(authority.required, [
    "playwright_child_authority_version", "runtime_digest",
    "runtime_source_physical_identity_digest", "runtime_seal_physical_identity_digest", "scenario",
    "baselines", "authority_digest"
  ]);
  assert.equal(authority.additionalProperties, false);
  const officialConditional = schema.allOf.find((entry) =>
    entry.if?.properties?.settings?.properties?.contract?.const ===
      "killsloprouter-playwright-v1");
  assert.deepEqual(officialConditional?.then?.required, ["playwright_authority"]);
  assert.ok(officialConditional.then.properties.settings.required.includes(
    "runtime_physical_identity_digest"));
});

test("published reference schemas keep popularity subordinate and the pack non-authoritative", () => {
  const brief = readSchema("reference-brief.schema.json");
  assert.equal(brief.properties.popularity_prior.properties.role.const,
    "within-fit-band-ranking-only");
  assert.equal(brief.properties.popularity_prior.properties.primary_sort.const,
    "product-fit-band");
  assert.equal(brief.properties.source.properties.rights.properties.creator_pixel_access.const, false);
  const pack = readSchema("reference-pack.schema.json");
  assert.equal(pack.properties.authority_scope.const, "discovery-evidence-only");
  assert.equal(pack.properties.downstream_contract.properties.source_pixels_included.const, false);
  assert.equal(pack.properties.downstream_contract.properties.visual_authority_granted.const, false);
  assert.equal(pack.properties.downstream_contract.properties.exact_three_3x3_route_unchanged.const, true);
  const result = readSchema("reference-result.schema.json");
  const eligible = result.$defs.disposition.allOf[0].then.properties;
  assert.equal(eligible.verified_component_families.minItems, 1);
  assert.equal(eligible.verified_patterns.minItems, 1);
  assert.equal(eligible.verified_grammar_ids.minItems, 1);
});

test("published runtime setup receipts require physical execution authority", () => {
  const codex = readSchema("codex-host-setup-receipt.schema.json");
  assert.ok(codex.properties.adapter.required.includes("entrypoint_graph_digest"));
  assert.ok(codex.properties.runtime.required.includes("physical_identity_digest"));
  assert.ok(codex.properties.runtime.required.includes("root_physical_identity_digest"));
  const playwright = readSchema("playwright-setup-receipt.schema.json");
  assert.ok(playwright.properties.adapter.required.includes("entrypoint_graph_digest"));
  assert.ok(playwright.properties.adapter.required.includes(
    "runtime_physical_identity_digest"));
  const request = readSchema("host-adapter-request.schema.json");
  const codexConditional = request.allOf.find((entry) =>
    entry.if?.properties?.settings?.properties?.contract?.const ===
      "killsloprouter-codex-review-v1");
  assert.ok(codexConditional.then.properties.settings.required.includes(
    "runtime_root_physical_identity_digest"));
});

test("published automation state stores lossless physical identity markers", () => {
  const schema = readSchema("automation-run.schema.json");
  assert.deepEqual(schema.$defs.physical_identity_marker.anyOf, [
    { type: "string", pattern: "^(0|[1-9][0-9]*)$" },
    { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER }
  ]);
  assert.deepEqual(schema.$defs.directory_identity.properties.device,
    { $ref: "#/$defs/physical_identity_marker" });
  assert.deepEqual(schema.$defs.evidence_boundary.properties.inode,
    { $ref: "#/$defs/physical_identity_marker" });
});
