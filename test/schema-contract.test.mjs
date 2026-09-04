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
  assert.ok(brief.properties.popularity_prior.properties.signals.items.required.includes(
    "subject_kind"));
  assert.equal(brief.properties.source.properties.rights.properties.creator_pixel_access.const, false);
  assert.equal(
    brief.properties.coverage.properties.sampling_policy.properties.promotional_capture_policy.const,
    "weak-evidence-only"
  );
  assert.doesNotMatch(
    JSON.stringify(brief.properties.coverage.properties.sampling_policy.properties.required_cohorts),
    /high-bookmark|high-reach/
  );
  const pack = readSchema("reference-pack.schema.json");
  assert.equal(pack.properties.authority_scope.const, "discovery-evidence-only");
  assert.ok(pack.required.includes("evidence_manifest"));
  assert.ok(pack.$defs.reference.required.includes("product_fit"));
  assert.ok(pack.$defs.popularity_signal.required.includes("subject_record_id"));
  assert.equal(pack.properties.downstream_contract.properties.source_pixels_included.const, false);
  assert.equal(pack.properties.downstream_contract.properties.visual_authority_granted.const, false);
  assert.equal(
    pack.properties.downstream_contract.properties.reasoning_registry_is_visual_authority.const,
    false
  );
  assert.equal(pack.properties.downstream_contract.properties.exact_three_3x3_route_unchanged.const, true);
  assert.equal(
    pack.properties.downstream_contract.properties.required_design_checks.minItems,
    11
  );
  assert.equal(
    pack.properties.downstream_contract.properties.design_check_contracts.minItems,
    11
  );
  const captureReadiness = pack.properties.downstream_contract.properties
    .reviewer_source_capture_readiness;
  assert.ok(pack.properties.downstream_contract.required.includes(
    "reviewer_source_capture_readiness"));
  assert.deepEqual(captureReadiness.required, [
    "status", "capture_evidence_ids", "uncovered_reference_ids",
    "uncovered_observation_ids", "revalidate_on_design_start"
  ]);
  assert.deepEqual(captureReadiness.properties.status.enum,
    ["ready_at_compilation", "manual_pending"]);
  assert.equal(captureReadiness.properties.revalidate_on_design_start.const, true);
  const syntheticExport = JSON.parse(fs.readFileSync(path.join(
    root, "examples", "reference-evidence", "ui-bowl-manual-export.json"
  ), "utf8"));
  assert.ok(syntheticExport.records.flatMap((record) => record.evidence_records)
    .every((evidence) => evidence.kind === "source-metadata"));
  const result = readSchema("reference-result.schema.json");
  const eligible = result.$defs.disposition.allOf[0].then.properties;
  assert.equal(eligible.verified_component_families.minItems, 1);
  assert.equal(eligible.verified_patterns.minItems, 1);
  assert.equal(eligible.verified_evidence_ids.minItems, 1);
  assert.equal(eligible.verified_grammar_ids.minItems, 1);
  assert.equal(eligible.verified_hierarchy_reasoning_ids.minItems, 1);
  const reasoning = readSchema("human-design-reasoning-registry.schema.json");
  assert.equal(reasoning.properties.authority_scope.const, "non-authoritative-research-aid");
  assert.equal(reasoning.properties.source_pixels_included.const, false);
  assert.equal(reasoning.properties.design_checks.minItems, 11);
  assert.deepEqual(reasoning.$defs.design_check.required, [
    "check_id", "lens_ids", "pass_condition", "required_evidence", "stages", "failure_code"
  ]);
  const designBrief = readSchema("design-brief.schema.json");
  assert.deepEqual(designBrief.properties.reference_pack.required,
    ["path", "digest", "producer_state", "reviewer_source_access"]);
  const referenceRun = readSchema("reference-run.schema.json");
  assert.ok(referenceRun.required.includes("reasoning_registry"));
  assert.equal(referenceRun.properties.reasoning_registry.properties.design_checks.minItems, 11);
  assert.equal(referenceRun.properties.reasoning_registry.properties.design_checks.maxItems, 11);
  assert.equal(referenceRun.properties.reasoning_registry.properties.design_checks.uniqueItems, true);
  assert.deepEqual(referenceRun.$defs.execution_authority.required, [
    "reference_execution_authority_version", "host_manifest", "provider",
    "adapter_entrypoint", "authority_digest"
  ]);
  assert.ok(referenceRun.$defs.attempt.properties.execution_authority);
  assert.ok(referenceRun.$defs.attempt.properties.execution_authority_source);
  assert.ok(referenceRun.$defs.attempt.allOf.some((entry) =>
    entry.if?.properties?.execution_status?.anyOf?.some((status) => status.const === "ran") &&
    entry.then?.required?.includes("execution_authority") &&
    entry.then?.required?.includes("execution_authority_source")));
  const inFlightAuthority = referenceRun.properties.in_flight.oneOf.find((entry) =>
    entry.type === "object");
  assert.ok(inFlightAuthority.required.includes("execution_authority"));
  assert.ok(inFlightAuthority.required.includes("execution_authority_source"));
  const referencePacket = readSchema("reference-packet.schema.json");
  const packetTask = referencePacket.properties.reference_task;
  assert.equal(referencePacket.$defs.digest.pattern, "^sha256:[a-f0-9]{64}$");
  for (const field of ["brief_digest", "authority_graph_digest"]) {
    assert.ok(packetTask.required.includes(field),
      `reference packet task must require ${field}`);
    assert.equal(packetTask.properties[field].$ref, "#/$defs/digest");
  }
  assert.equal(referenceRun.properties.packets.items.$ref,
    "reference-packet.schema.json");
  const packetChecks = referencePacket.properties.reference_task.properties
    .human_design_reasoning.properties.design_checks;
  assert.equal(packetChecks.minItems, 11);
  assert.equal(packetChecks.maxItems, 11);
  assert.equal(packetChecks.uniqueItems, true);
  assert.match(packetChecks.items.$ref, /human-design-reasoning-registry/);
  assert.ok(referencePacket.allOf.some((entry) =>
    entry.if?.properties?.stage_id?.enum?.includes("reference-review") &&
    entry.then?.properties?.forbidden_permissions?.contains?.const === "network:external"));
  const dispatchRequest = readSchema("reference-dispatch-request.schema.json");
  assert.equal(dispatchRequest.properties.packet.$ref,
    "reference-packet.schema.json");
  assert.equal(
    dispatchRequest.properties.authority_artifacts.properties
      .source_evidence_descriptors_included.type,
    "boolean"
  );
  assert.equal(
    dispatchRequest.properties.authority_artifacts.properties
      .source_pixels_available_to_reference_participants.type,
    "boolean"
  );
  assert.equal(
    dispatchRequest.properties.authority_artifacts.properties
      .source_pixels_exposed_to_downstream_creator.const,
    false
  );
  assert.equal(
    dispatchRequest.properties.prior_results.items.properties.normalized_result.not.required[0],
    "evidence"
  );
  const priorEvidence = dispatchRequest.properties.prior_results.items.properties
    .evidence_digests.items;
  const priorSourceConditional = priorEvidence.allOf[0];
  for (const field of [
    "reference_id", "product_record_id", "screen_record_id", "frame_ids",
    "subject_bindings"
  ]) {
    assert.ok(priorSourceConditional.then.required.includes(field),
      `dispatch prior source evidence must require ${field}`);
    assert.ok(priorSourceConditional.else.not.anyOf.some((entry) =>
      entry.required?.includes(field)),
    `dispatch non-source evidence must forbid ${field}`);
  }
  assert.equal(
    priorEvidence.properties.subject_bindings.contains.properties.subject_kind.const,
    "screen"
  );
  assert.equal(
    dispatchRequest.$defs.export_evidence.properties.subject_bindings
      .contains.properties.subject_kind.const,
    "screen"
  );
  const designPacket = readSchema("design-packet.schema.json");
  const referenceIntelligence = designPacket.properties.design_task.properties
    .reference_intelligence;
  assert.deepEqual(referenceIntelligence.properties.audience.enum,
    ["creator", "independent-reviewer"]);
  assert.equal(referenceIntelligence.properties.source_pixels_included.const, false);
  assert.equal(referenceIntelligence.properties.source_identities_included.const, false);
  assert.equal(
    referenceIntelligence.properties.source_pixels_exposed_to_downstream_creator.const,
    false
  );
  assert.ok(designPacket.allOf.some((entry) =>
    entry.if?.properties?.design_task?.required?.includes("reference_intelligence") &&
    entry.then?.properties?.forbidden_permissions?.contains?.const === "network:external"));
  assert.ok(designPacket.allOf.some((entry) =>
    entry.if?.properties?.design_task?.properties?.reference_intelligence
      ?.properties?.audience?.const === "independent-reviewer" &&
    entry.then?.properties?.required_permissions?.contains?.const ===
      "reference-evidence:read" &&
    entry.then?.properties?.forbidden_permissions?.not?.contains?.const ===
      "reference-evidence:read"));
  const designRun = readSchema("design-exploration-run.schema.json");
  assert.ok(designRun.$defs.attempt.allOf.some((entry) =>
    entry.if?.properties?.execution_status?.anyOf?.some((status) => status.const === "ran") &&
    entry.then?.required?.includes("execution_authority")));
  assert.ok(designRun.required.includes("lease_recoveries"));
  assert.ok(designRun.required.includes("in_flight"));
  assert.equal(
    designRun.properties.pending_finalization.oneOf[1].$ref,
    "#/$defs/pendingFinalization"
  );
  assert.deepEqual(designRun.$defs.pendingFinalization.required, [
    "design_finalization_transaction_version", "directory", "staging_directory",
    "files", "final_receipt_digests", "transaction_digest"
  ]);
  assert.deepEqual(designRun.$defs.finalizationFile.required,
    ["name", "digest", "bytes"]);
  assert.ok(designRun.$defs.reviewSourceAuthority.required.includes(
    "source_recipient_provider_ids"));
  assert.ok(designRun.$defs.reviewSourceAuthority.required.includes(
    "source_recipient_actor_ids"));
  for (const field of ["source_recipient_provider_ids", "source_recipient_actor_ids"]) {
    assert.equal(designRun.$defs.reviewSourceAuthority.properties[field].minItems, 1);
    assert.equal(designRun.$defs.reviewSourceAuthority.properties[field].uniqueItems, true);
  }
  assert.ok(designRun.$defs.reviewSourceAuthority.required.includes(
    "source_recipient_execution_lineage"));
  const sourceLineage = designRun.$defs.sourceRecipientExecutionLineage;
  assert.deepEqual(sourceLineage.required, [
    "reference_source_recipient_execution_lineage_version", "attempts",
    "lineage_digest"
  ]);
  assert.equal(sourceLineage.properties.attempts.minItems, undefined);
  assert.ok(designRun.$defs.sourceRecipientExecutionAttempt.required.includes("adapter"));
  assert.deepEqual(designRun.$defs.sourceRecipientExecutionAttempt.properties.adapter.enum, [
    "kill-ai-slop-v1", "agent-json-v1", "skill-json-v1",
    "browser-json-v1", "manual-v1"
  ]);
  assert.deepEqual(designRun.$defs.sourceRecipientExecutionEntrypoint.required,
    ["digest", "physical_identity_digest", "graph_digest"]);
  assert.ok(designRun.$defs.reviewSourceAuthority.properties.captures.items
    .properties.frames.items.properties.role.enum.includes("navigational"));
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
