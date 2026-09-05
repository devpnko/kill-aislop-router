import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-pack-"));

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: "utf8",
    shell: false,
    timeout: 180_000,
    maxBuffer: 16 * 1024 * 1024,
    ...options
  });
}

try {
  const packed = run(npm, [
    "pack",
    "--json",
    "--ignore-scripts",
    "--pack-destination", temporary
  ]);

  if (packed.error || packed.status !== 0) {
    throw new Error(packed.stderr || packed.error?.message || "npm pack failed");
  }

  const report = JSON.parse(packed.stdout)[0];
  const files = new Set(report.files.map((entry) => entry.path));
  const required = [
    ".codex-plugin/plugin.json",
    "bin/killsloprouter.mjs",
    "src/router.mjs",
    "src/audit.mjs",
    "src/automation.mjs",
    "src/state-lease.mjs",
    "src/state-lease-public.mjs",
    "src/bootstrap.mjs",
    "src/codex.mjs",
    "src/design.mjs",
    "src/execution.mjs",
    "src/playwright.mjs",
    "src/reference.mjs",
    "src/source-composition.mjs",
    "src/adapters/playwright-browser.mjs",
    "src/adapters/codex-review.mjs",
    "router/default-router.json",
    "schemas/automation-run.schema.json",
    "schemas/bootstrap-receipt.schema.json",
    "schemas/automation-step-receipt.schema.json",
    "schemas/baseline-lineage-declaration.schema.json",
    "schemas/baseline-lineage-owner-approval.schema.json",
    "schemas/baseline-lineage.schema.json",
    "schemas/state-lease.schema.json",
    "schemas/state-lease-recovery-receipt.schema.json",
    "schemas/host-adapter.schema.json",
    "schemas/codex-host-setup-receipt.schema.json",
    "schemas/codex-review-output.schema.json",
    "schemas/design-brief.schema.json",
    "schemas/design-font-report.schema.json",
    "schemas/design-packet.schema.json",
    "schemas/design-result.schema.json",
    "schemas/design-exploration-run.schema.json",
    "schemas/design-shortlist.schema.json",
    "schemas/design-token-spec.schema.json",
    "schemas/design-owner-decision.schema.json",
    "schemas/design-direction-decision.schema.json",
    "schemas/design-profile-bindings.schema.json",
    "schemas/design-source-composition-analysis.schema.json",
    "schemas/human-design-reasoning-registry.schema.json",
    "schemas/reference-brief.schema.json",
    "schemas/reference-dispatch-request.schema.json",
    "schemas/reference-lease-recovery.schema.json",
    "schemas/reference-owner-selection.schema.json",
    "schemas/reference-pack.schema.json",
    "schemas/reference-packet.schema.json",
    "schemas/reference-result.schema.json",
    "schemas/reference-run.schema.json",
    "schemas/uibowl-manual-export.schema.json",
    "schemas/host-adapter-request.schema.json",
    "schemas/host-adapter-response.schema.json",
    "schemas/browser-attestation.schema.json",
    "schemas/playwright-scenarios.schema.json",
    "schemas/playwright-setup-receipt.schema.json",
    "schemas/plugin-install-marker.schema.json",
    "schemas/legacy-skill-shim-marker.schema.json",
    "schemas/project-profile.schema.json",
    "schemas/visual-intent-receipt.schema.json",
    "schemas/visual-signature-receipt.schema.json",
    "docs/adapter-authoring.md",
    "docs/baseline-lineage.md",
    "docs/design-exploration.md",
    "docs/reference-intelligence.md",
    "docs/research/ui-bowl-popular-design-study-2026-09-04.md",
    "docs/reviews/fable-5.1-reference-intelligence.md",
    "docs/codex-plugin.md",
    "docs/codex-review-host.md",
    "docs/surface-contract.md",
    "docs/visual-intent-contract.md",
    "docs/visual-signature-contract.md",
    "docs/playwright-browser.md",
    "docs/threat-model-and-permissions.md",
    "docs/migration-v1.md",
    "scripts/install-codex-plugin.mjs",
    "skills/kill-slop-router/SKILL.md",
    "skills/kill-slop-router/agents/openai.yaml",
    "examples/planning-evidence/visual-signature-approval.json",
    "examples/service-planning-lineage.example.json",
    "examples/planning-evidence/parent-baseline.html",
    "examples/planning-evidence/policy-slice.html",
    "examples/planning-evidence/policy-slice-owner-approval.json",
    "examples/design-brief.example.json",
    "examples/reference-brief.example.json",
    "examples/reference-evidence/flowdesk-source-metadata.json",
    "examples/reference-evidence/marketline-source-metadata.json",
    "examples/reference-evidence/owner-request.md",
    "examples/reference-evidence/proofgrid-source-metadata.json",
    "examples/reference-evidence/service-planning-gate.json",
    "examples/reference-evidence/ui-bowl-manual-export.json",
    "examples/reference-evidence/ui-bowl-rights.md",
    "examples/playwright-scenarios.example.json",
    "README.md",
    "LICENSE"
  ];

  for (const expected of required) assert.ok(files.has(expected), `package is missing ${expected}`);
  for (const file of files) {
    assert.equal(file.startsWith("test/"), false, `test fixture leaked into package: ${file}`);
    assert.equal(file.startsWith(".git/"), false, `Git metadata leaked into package: ${file}`);
  }

  const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
  assert.deepEqual(packageJson.dependencies, {
    "axe-core": "4.13.0",
    "playwright-core": "1.62.1"
  }, "browser runtime dependencies must remain exact pins");

  const tarball = path.join(temporary, report.filename);
  assert.ok(fs.existsSync(tarball), "npm pack did not create the reported tarball");
  const consumer = path.join(temporary, "consumer");
  fs.mkdirSync(consumer);
  fs.writeFileSync(path.join(consumer, "package.json"), `${JSON.stringify({
    name: "killsloprouter-pack-consumer",
    version: "0.0.0",
    private: true
  }, null, 2)}\n`);

  const installed = run(npm, [
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--prefer-offline",
    "--package-lock=false",
    tarball
  ], { cwd: consumer });
  assert.equal(installed.status, 0, installed.stderr || installed.stdout);

  const installedRoot = path.join(consumer, "node_modules", "killsloprouter");
  const installedCli = path.join(installedRoot, "bin", "killsloprouter.mjs");
  const help = run(process.execPath, [installedCli, "--help"], { cwd: consumer });
  assert.equal(help.status, 0, help.stderr || help.stdout);
  assert.match(help.stdout, /host configure-codex/);
  assert.match(help.stdout, /lease recover/);
  assert.match(help.stdout, /--module-graph/);
  assert.match(help.stdout, /reference run --brief FILE/);
  assert.match(help.stdout, /reference dispatch --run FILE/);
  assert.match(help.stdout, /reference recover --state FILE/);
  const referenceHelp = run(process.execPath, [
    installedCli,
    "reference",
    "--help"
  ], { cwd: consumer });
  assert.equal(referenceHelp.status, 0,
    referenceHelp.stderr || referenceHelp.stdout);
  assert.match(referenceHelp.stdout, /reference run --resume FILE/);
  assert.match(referenceHelp.stdout, /reference status --run FILE/);
  const installedGraphDigest = run(process.execPath, [
    installedCli,
    "digest",
    "--target", path.join(installedRoot, "src", "adapters", "codex-review.mjs"),
    "--module-graph",
    "--json"
  ], { cwd: consumer });
  assert.equal(installedGraphDigest.status, 0,
    installedGraphDigest.stderr || installedGraphDigest.stdout);
  const installedGraphReceipt = JSON.parse(installedGraphDigest.stdout);
  assert.equal(installedGraphReceipt.kind, "sealed-entrypoint-module-graph");
  assert.match(installedGraphReceipt.digest, /^sha256:[a-f0-9]{64}$/);
  const codexExport = run(process.execPath, [
    "--input-type=module",
    "--eval",
    "import('killsloprouter/codex').then((module) => { if (!module.configureCodexReviewers) process.exit(1); })"
  ], { cwd: consumer });
  assert.equal(codexExport.status, 0, codexExport.stderr || codexExport.stdout);
  const leaseExport = run(process.execPath, [
    "--input-type=module",
    "--eval",
    "import('killsloprouter/state-lease').then((module) => { if (!module.acquireStateLease || !module.inspectStateLease || module.claimStaleStateLease || module.completeStateLeaseRecovery) process.exit(1); })"
  ], { cwd: consumer });
  assert.equal(leaseExport.status, 0, leaseExport.stderr || leaseExport.stdout);
  const referenceContractExport = run(process.execPath, [
    "--input-type=module",
    "--eval",
    `import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
const root = ${JSON.stringify(installedRoot)};
const reference = await import("killsloprouter/reference");
const brief = JSON.parse(fs.readFileSync(path.join(root, "examples", "reference-brief.example.json"), "utf8"));
const manualExport = JSON.parse(fs.readFileSync(path.join(root, "examples", "reference-evidence", "ui-bowl-manual-export.json"), "utf8"));
const registry = JSON.parse(fs.readFileSync(path.join(root, "registry", "human-design-reasoning.json"), "utf8"));
const designBriefSchema = JSON.parse(fs.readFileSync(path.join(root, "schemas", "design-brief.schema.json"), "utf8"));
const designDecisionSchema = JSON.parse(fs.readFileSync(path.join(root, "schemas", "design-direction-decision.schema.json"), "utf8"));
const designPacketSchema = JSON.parse(fs.readFileSync(path.join(root, "schemas", "design-packet.schema.json"), "utf8"));
const designRunSchema = JSON.parse(fs.readFileSync(path.join(root, "schemas", "design-exploration-run.schema.json"), "utf8"));
const referenceRunSchema = JSON.parse(fs.readFileSync(path.join(root, "schemas", "reference-run.schema.json"), "utf8"));
const referencePacketSchema = JSON.parse(fs.readFileSync(path.join(root, "schemas", "reference-packet.schema.json"), "utf8"));
const referenceDispatchSchema = JSON.parse(fs.readFileSync(path.join(root, "schemas", "reference-dispatch-request.schema.json"), "utf8"));
const sourceCompositionSchema = JSON.parse(fs.readFileSync(path.join(root, "schemas", "design-source-composition-analysis.schema.json"), "utf8"));
reference.validateReferenceBrief(brief, { root });
reference.validateUiBowlManualExport(manualExport);
reference.validateHumanDesignReasoningRegistry(registry);
assert.ok(manualExport.records.flatMap((record) => record.evidence_records).every((evidence) => evidence.kind === "source-metadata"));
assert.equal(sourceCompositionSchema.properties.design_source_composition_analysis_version.const, 1);
assert.deepEqual(sourceCompositionSchema.properties.stage.enum, ["direction-review", "color-review"]);
assert.equal(sourceCompositionSchema.additionalProperties, false);
assert.deepEqual(designBriefSchema.properties.reference_pack.required, ["path", "digest", "producer_state", "reviewer_source_access"]);
assert.equal(referenceRunSchema.properties.reasoning_registry.properties.design_checks.minItems, 11);
assert.equal(referenceRunSchema.properties.reasoning_registry.properties.design_checks.maxItems, 11);
assert.equal(referencePacketSchema.properties.reference_task.properties.human_design_reasoning.properties.design_checks.minItems, 11);
assert.equal(referencePacketSchema.properties.reference_task.properties.human_design_reasoning.properties.design_checks.maxItems, 11);
assert.equal(referencePacketSchema.$defs.digest.pattern, "^sha256:[a-f0-9]{64}$");
for (const field of ["brief_digest", "authority_graph_digest"]) {
  assert.ok(referencePacketSchema.properties.reference_task.required.includes(field));
  assert.equal(referencePacketSchema.properties.reference_task.properties[field].$ref, "#/$defs/digest");
}
assert.equal(referenceRunSchema.properties.packets.items.$ref, "reference-packet.schema.json");
assert.equal(referenceDispatchSchema.properties.packet.$ref, "reference-packet.schema.json");
const sourceCaptureReadinessSchema = JSON.parse(fs.readFileSync(path.join(root, "schemas", "reference-pack.schema.json"), "utf8")).properties.downstream_contract.properties.reviewer_source_capture_readiness;
assert.deepEqual(sourceCaptureReadinessSchema.required, ["status", "capture_evidence_ids", "uncovered_reference_ids", "uncovered_observation_ids", "revalidate_on_design_start"]);
assert.deepEqual(sourceCaptureReadinessSchema.properties.status.enum, ["ready_at_compilation", "manual_pending"]);
assert.equal(sourceCaptureReadinessSchema.properties.revalidate_on_design_start.const, true);
assert.ok(referenceRunSchema.$defs.attempt.properties.execution_authority);
assert.ok(referenceRunSchema.$defs.attempt.properties.execution_authority_source);
assert.ok(referenceRunSchema.$defs.attempt.allOf.some((entry) => entry.then?.required?.includes("execution_authority") && entry.then?.required?.includes("execution_authority_source")));
assert.ok(designRunSchema.$defs.attempt.allOf.some((entry) => entry.then?.required?.includes("execution_authority")));
assert.ok(designRunSchema.required.includes("lease_recoveries") && designRunSchema.required.includes("in_flight"));
assert.equal(designRunSchema.properties.pending_finalization.oneOf[1].$ref, "#/$defs/pendingFinalization");
assert.deepEqual(designRunSchema.$defs.pendingFinalization.required, ["design_finalization_transaction_version", "directory", "staging_directory", "files", "final_receipt_digests", "transaction_digest"]);
assert.deepEqual(designRunSchema.$defs.finalizationFile.required, ["name", "digest", "bytes"]);
for (const field of ["source_recipient_provider_ids", "source_recipient_actor_ids"]) {
  assert.ok(designRunSchema.$defs.reviewSourceAuthority.required.includes(field));
  assert.equal(designRunSchema.$defs.reviewSourceAuthority.properties[field].minItems, 1);
  assert.equal(designRunSchema.$defs.reviewSourceAuthority.properties[field].uniqueItems, true);
}
assert.ok(designRunSchema.$defs.reviewSourceAuthority.required.includes("source_recipient_execution_lineage"));
assert.deepEqual(designRunSchema.$defs.sourceRecipientExecutionLineage.required, ["reference_source_recipient_execution_lineage_version", "attempts", "lineage_digest"]);
assert.equal(designRunSchema.$defs.sourceRecipientExecutionLineage.properties.attempts.minItems, undefined);
assert.ok(designRunSchema.$defs.sourceRecipientExecutionAttempt.required.includes("adapter"));
assert.deepEqual(designRunSchema.$defs.sourceRecipientExecutionAttempt.properties.adapter.enum, ["kill-ai-slop-v1", "agent-json-v1", "skill-json-v1", "browser-json-v1", "manual-v1"]);
assert.deepEqual(designRunSchema.$defs.sourceRecipientExecutionEntrypoint.required, ["digest", "physical_identity_digest", "graph_digest"]);
assert.ok(designRunSchema.$defs.reviewSourceAuthority.properties.captures.items.properties.frames.items.properties.role.enum.includes("navigational"));
const priorEvidence = referenceDispatchSchema.properties.prior_results.items.properties.evidence_digests.items;
for (const field of ["reference_id", "product_record_id", "screen_record_id", "frame_ids", "subject_bindings"]) assert.ok(priorEvidence.allOf[0].then.required.includes(field));
assert.ok(designPacketSchema.allOf.some((entry) => entry.if?.properties?.design_task?.required?.includes("reference_intelligence") && entry.then?.properties?.forbidden_permissions?.contains?.const === "network:external"));
assert.ok(designPacketSchema.allOf.some((entry) => entry.if?.properties?.design_task?.properties?.reference_intelligence?.properties?.audience?.const === "independent-reviewer" && entry.then?.properties?.required_permissions?.contains?.const === "reference-evidence:read"));
const finalBinding = designDecisionSchema.$defs["reference-intelligence-binding"];
for (const field of ["review_source_capture_set_digest", "direction_source_composition_analysis_digest", "color_source_composition_analysis_digest"]) assert.ok(finalBinding.required.includes(field));`
  ], { cwd: consumer });
  assert.equal(referenceContractExport.status, 0,
    referenceContractExport.stderr || referenceContractExport.stdout);

  const installedProfile = path.join(installedRoot, "examples", "project-profile.example.json");
  const installedHost = path.join(installedRoot, "examples", "host-adapter.example.json");
  const installedArtifact = path.join(installedRoot, "examples", "planning-evidence", "mockup.html");
  const isolatedHome = path.join(temporary, "isolated-codex-home");
  const pluginInstall = run(process.execPath, [
    installedCli,
    "plugin", "install",
    "--home", isolatedHome,
    "--no-activate"
  ], { cwd: consumer });
  assert.equal(pluginInstall.status, 0, pluginInstall.stderr || pluginInstall.stdout);
  const pluginReceipt = JSON.parse(pluginInstall.stdout);
  assert.equal(pluginReceipt.skill_catalog.status, "ready");
  assert.equal(pluginReceipt.skill_catalog.canonical.status, "installed");
  assert.match(pluginReceipt.skill_catalog.canonical.marker_digest, /^sha256:[a-f0-9]{64}$/);
  assert.match(pluginReceipt.skill_catalog.canonical.payload_digest, /^sha256:[a-f0-9]{64}$/);
  assert.match(pluginReceipt.skill_catalog.canonical.runtime_digest, /^sha256:[a-f0-9]{64}$/);
  const doctor = run(process.execPath, [
    installedCli,
    "doctor",
    "--profile", installedProfile,
    "--home", isolatedHome,
    "--json"
  ], { cwd: consumer });
  assert.equal(doctor.status, 0, doctor.stderr || doctor.stdout);
  assert.equal(JSON.parse(doctor.stdout).status, "automation-ready");

  const installedReferenceBrief = path.join(
    installedRoot,
    "examples",
    "reference-brief.example.json"
  );
  const referenceDryRun = run(process.execPath, [
    installedCli,
    "reference", "run",
    "--brief", installedReferenceBrief,
    "--root", installedRoot,
    "--dry-run",
    "--json"
  ], { cwd: consumer });
  assert.equal(referenceDryRun.status, 6,
    referenceDryRun.stderr || referenceDryRun.stdout);
  const referenceDryReport = JSON.parse(referenceDryRun.stdout);
  assert.equal(referenceDryReport.status, "manual_pending");
  assert.equal(referenceDryReport.source.provider, "uibowl");
  assert.equal(referenceDryReport.source.access_mode, "manual-export");
  assert.equal(referenceDryReport.reasoning_registry.design_check_count, 11);
  assert.ok(referenceDryReport.readiness.every((item) =>
    item.execution_status === "manual_pending"));

  const dryRun = run(process.execPath, [
    installedCli,
    "run",
    "--dry-run",
    "--profile", installedProfile,
    "--host-config", installedHost,
    "--surface", "operator-product-ui",
    "--task", "redesign",
    "--direction", "approved",
    "--changes", "source,copy,layout,interaction",
    "--artifact", installedArtifact,
    "--scope", "mockup",
    "--creator-id", "pack-consumer",
    "--json"
  ], { cwd: consumer });
  assert.equal(dryRun.status, 6, dryRun.stderr || dryRun.stdout);
  const dryReport = JSON.parse(dryRun.stdout);
  assert.equal(dryReport.status, "dry_run");
  assert.ok(dryReport.host_readiness.length > 0);
  assert.ok(dryReport.host_readiness.every((item) => item.execution_status === "manual_pending"));

  process.stdout.write(`package: ${report.filename}\n`);
  process.stdout.write(`files: ${report.entryCount}\n`);
  process.stdout.write(`bytes: ${report.size}\n`);
  process.stdout.write("installed consumer: help/module-graph digest, Codex/state-lease/reference exports, reference contract validation and dry-run, integrity-bound plugin install, doctor, manual runtime dry-run passed\n");
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
