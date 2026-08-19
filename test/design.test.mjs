import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  contrastRatio,
  dryRunDesignExploration,
  readDesignState,
  resumeDesignExploration,
  startDesignExploration
} from "../src/design.mjs";
import { loadHostManifest } from "../src/execution.mjs";
import { hashArtifact } from "../src/integrity.mjs";
import { resolveVisualIntent, resolveVisualSignature } from "../src/router.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = path.join(root, "test", "fixtures", "design-host-adapter.mjs");
const exampleBrief = JSON.parse(fs.readFileSync(path.join(root, "examples", "design-brief.example.json"), "utf8"));

function workspace() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-design-"));
  const baseline = path.join(directory, "project");
  fs.mkdirSync(baseline, { recursive: true });
  fs.writeFileSync(path.join(baseline, "app.html"), "<!doctype html><main>existing operator UI</main>\n");
  const briefPath = path.join(directory, "design-brief.json");
  fs.writeFileSync(briefPath, `${JSON.stringify(exampleBrief, null, 2)}\n`);
  const statePath = path.join(baseline, ".killsloprouter", "design-run.json");
  return { directory, baseline, briefPath, statePath };
}

function provider(adapter, capabilities, strength, permissions, settings = {}) {
  return {
    adapter,
    entrypoint: fixture,
    entrypoint_digest: hashArtifact(fixture),
    capabilities,
    strength,
    permissions,
    timeout_ms: 30_000,
    settings
  };
}

const capabilities = {
  direction: [
    "design-direction-generation", "baseline-preservation", "responsive-prototype", "locale-prototype"
  ],
  directionReview: [
    "product-fit-review", "visual-distinctiveness-review", "baseline-preservation-review", "responsive-review"
  ],
  color: [
    "color-system-generation", "semantic-color-roles", "contrast-aware-palette", "responsive-prototype"
  ],
  colorReview: [
    "color-harmony-review", "semantic-role-review", "contrast-review", "brand-fit-review"
  ],
  browser: [
    "responsive-evidence", "keyboard-evidence", "state-evidence", "overflow-evidence",
    "contrast-evidence", "zoom-evidence"
  ]
};

function host(directory, settings = {}, mutate = null) {
  const manifestPath = path.join(directory, `host-${Math.random().toString(16).slice(2)}.json`);
  const manifest = {
    host_adapter_version: 1,
    allowed_providers: [
      "design-direction-agent", "design-direction-critic", "color-system-agent",
      "color-system-critic", "browser-evidence"
    ],
    granted_permissions: ["artifact:read", "evidence:write", "browser:control"],
    providers: {
      "design-direction-agent": provider("agent-json-v1", capabilities.direction, 3,
        ["artifact:read", "evidence:write"], settings.direction),
      "design-direction-critic": provider("agent-json-v1", capabilities.directionReview, 4,
        ["artifact:read", "evidence:write"], settings.directionReview),
      "color-system-agent": provider("skill-json-v1", capabilities.color, 3,
        ["artifact:read", "evidence:write"], settings.color),
      "color-system-critic": provider("agent-json-v1", capabilities.colorReview, 4,
        ["artifact:read", "evidence:write"], settings.colorReview),
      "browser-evidence": provider("browser-json-v1", capabilities.browser, 3,
        ["artifact:read", "evidence:write", "browser:control"], settings.browser)
    }
  };
  if (mutate) mutate(manifest);
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return loadHostManifest(manifestPath);
}

function writeShortlist(space, state) {
  const review = state.results.find((record) => record.packet_id === "direction-review");
  const target = path.join(space.directory, "shortlist.json");
  fs.writeFileSync(target, `${JSON.stringify({
    design_shortlist_version: 1,
    run_id: state.run_id,
    selection_scope_digest: state.selection_scope_digest,
    owner_id: "owner:product-design",
    candidate_ids: review.normalized.ranking.slice(0, 3),
    rationale: "These three retain the operator model while offering meaningfully different visual theses.",
    decided_at: "2026-08-19T08:00:00.000Z"
  }, null, 2)}\n`);
  return target;
}

function writeApproval(space, state, ownerId = "owner:product-design") {
  const designId = state.shortlist.normalized.candidate_ids[0];
  const color = state.results.find((record) =>
    record.normalized.kind === "color-candidate" && record.normalized.design_candidate_id === designId);
  const target = path.join(space.directory, "approval.json");
  fs.writeFileSync(target, `${JSON.stringify({
    design_owner_decision_version: 1,
    run_id: state.run_id,
    approval_scope_digest: state.approval_scope_digest,
    owner_id: ownerId,
    status: "approved",
    selected_design_candidate_id: designId,
    selected_color_candidate_id: color.normalized.candidate_id,
    note: "Approve this exact product-native direction and semantic color system.",
    decided_at: "2026-08-19T09:00:00.000Z"
  }, null, 2)}\n`);
  return target;
}

test("dry run exposes a 9-direction and 9-color matrix without mistaking routing for execution", () => {
  const space = workspace();
  try {
    const report = dryRunDesignExploration({
      briefPath: space.briefPath,
      baselinePath: space.baseline
    });
    assert.equal(report.status, "manual_pending");
    assert.equal(report.direction_matrix.length, 9);
    assert.equal(report.color_matrix.total_candidates, 9);
    assert.ok(report.readiness.every((item) => item.execution_status === "manual_pending"));
  } finally {
    fs.rmSync(space.directory, { recursive: true, force: true });
  }
});

test("partial capability and missing browser adapters remain manual_pending", () => {
  const space = workspace();
  try {
    const partial = host(space.directory, {}, (manifest) => {
      manifest.providers["design-direction-agent"].permissions = ["artifact:read"];
      manifest.providers["color-system-agent"].capabilities = ["color-system-generation"];
      manifest.providers["browser-evidence"].adapter = "manual-v1";
      delete manifest.providers["browser-evidence"].entrypoint;
      delete manifest.providers["browser-evidence"].entrypoint_digest;
      manifest.providers["browser-evidence"].permissions = [];
    });
    const report = dryRunDesignExploration({
      briefPath: space.briefPath,
      baselinePath: space.baseline,
      hostManifest: partial
    });
    assert.equal(report.status, "manual_pending");
    assert.ok(report.pending.some((item) => item.includes("lacks required permissions")));
    assert.ok(report.pending.some((item) => item.includes("lacks assigned capabilities")));
    assert.ok(report.pending.some((item) => item.includes("explicitly manual")));
  } finally {
    fs.rmSync(space.directory, { recursive: true, force: true });
  }
});

test("design CLI creates resumable state, reports status, and dispatches exact packets", () => {
  const space = workspace();
  try {
    const cli = path.join(root, "bin", "killsloprouter.mjs");
    const started = spawnSync(process.execPath, [
      cli, "design", "run",
      "--brief", space.briefPath,
      "--baseline", space.baseline,
      "--out", space.statePath,
      "--json"
    ], { encoding: "utf8" });
    assert.equal(started.status, 6, started.stderr);
    assert.equal(JSON.parse(started.stdout).phase, "direction-generation");
    assert.equal(readDesignState(space.statePath).packets.length, 9);

    const status = spawnSync(process.execPath, [
      cli, "design", "status", "--run", space.statePath, "--json"
    ], { encoding: "utf8" });
    assert.equal(status.status, 0, status.stderr);
    assert.equal(JSON.parse(status.stdout).status, "manual_pending");

    const output = path.join(space.directory, "dispatched");
    const dispatch = spawnSync(process.execPath, [
      cli, "design", "dispatch", "--run", space.statePath, "--out-dir", output, "--json"
    ], { encoding: "utf8" });
    assert.equal(dispatch.status, 0, dispatch.stderr);
    assert.equal(JSON.parse(dispatch.stdout).packet_count, 9);
    assert.equal(fs.readdirSync(output).filter((file) => file.endsWith(".json")).length, 9);
  } finally {
    fs.rmSync(space.directory, { recursive: true, force: true });
  }
});

test("resumable exploration crosses real child processes, owner gates, and compiles verified receipts", () => {
  const space = workspace();
  try {
    const manifest = host(space.directory);
    let state = startDesignExploration({
      statePath: space.statePath,
      briefPath: space.briefPath,
      baselinePath: space.baseline,
      hostManifest: manifest,
      root: space.directory
    });
    assert.equal(state.status, "manual_pending");
    assert.equal(state.phase, "direction-selection");
    assert.equal(state.results.filter((item) => item.normalized.kind === "direction-candidate").length, 9);
    assert.equal(state.results.filter((item) => item.normalized.kind === "browser-evidence").length, 9);
    assert.ok(state.attempts.filter((item) => item.execution_status === "ran")
      .every((item) => Number.isInteger(item.child_pid) && item.child_pid > 0));

    state = resumeDesignExploration(space.statePath, {
      hostManifest: host(space.directory, { color: { weak_contrast: true } }),
      shortlistPath: writeShortlist(space, state)
    });
    assert.equal(state.status, "blocked");
    assert.equal(state.phase, "color-generation");
    assert.ok(state.blockers.some((item) => item.includes("text_muted/canvas")));

    state = resumeDesignExploration(space.statePath, {
      hostManifest: manifest,
      retry: "all"
    });
    assert.equal(state.status, "manual_pending");
    assert.equal(state.phase, "owner-approval");
    assert.equal(state.results.filter((item) => item.normalized.kind === "color-candidate").length, 9);
    assert.equal(state.results.filter((item) => item.normalized.kind === "browser-evidence").length, 18);

    const selectedCreator = state.results.find((record) =>
      record.normalized.kind === "direction-candidate" &&
      record.normalized.candidate_id === state.shortlist.normalized.candidate_ids[0]).normalized.actor.actor_id;
    assert.throws(() => resumeDesignExploration(space.statePath, {
      hostManifest: manifest,
      approvalPath: writeApproval(space, state, selectedCreator)
    }), /creator cannot approve/);

    state = resumeDesignExploration(space.statePath, {
      hostManifest: manifest,
      approvalPath: writeApproval(space, state)
    });
    assert.equal(state.status, "complete");
    assert.match(state.final_receipt_digests.visual_intent, /^sha256:/);
    assert.match(state.final_receipt_digests.visual_signature, /^sha256:/);

    const decision = JSON.parse(fs.readFileSync(state.outputs.decision.resolved_path, "utf8"));
    assert.deepEqual(Object.keys(decision.source_bindings).sort(), [
      "color_browser", "color_candidate", "color_review",
      "direction_browser", "direction_candidate", "direction_review"
    ]);
    for (const binding of Object.values(decision.source_bindings)) {
      assert.match(binding.packet_digest, /^sha256:/);
      assert.match(binding.result_source_digest, /^sha256:/);
      assert.ok(binding.evidence.every((item) => /^sha256:/.test(item.digest)));
      assert.equal(binding.execution.execution_status, "ran");
      assert.ok(binding.execution.strength >= 3);
      assert.ok(binding.execution.capabilities.length > 0);
      assert.ok(binding.execution.permission_scopes.includes("artifact:read"));
      assert.match(binding.execution.host_manifest_digest, /^sha256:/);
      assert.match(binding.execution.adapter_entrypoint_digest, /^sha256:/);
    }

    const bindings = JSON.parse(fs.readFileSync(state.outputs.profile_bindings.resolved_path, "utf8"));
    const profile = {
      project_id: bindings.project_id,
      visual_intents: { [bindings.surface]: bindings.visual_intent },
      visual_signatures: { [bindings.surface]: bindings.visual_signature }
    };
    assert.equal(resolveVisualIntent(profile, state.outputs.profile_bindings.resolved_path, bindings.surface).authority_status,
      "verified");
    assert.equal(resolveVisualSignature(profile, state.outputs.profile_bindings.resolved_path, bindings.surface).authority_status,
      "verified");

    const signatureReceipt = JSON.parse(fs.readFileSync(
      state.outputs.visual_signature_receipt.resolved_path,
      "utf8"
    ));
    const evidencePaths = signatureReceipt.evidence.map((item) => item.path);
    assert.ok(evidencePaths.some((item) => item.endsWith("-fonts.json")));
    assert.ok(evidencePaths.some((item) => item.endsWith("-tokens.json")));
    assert.equal(evidencePaths.filter((item) => item.endsWith(".html")).length, 2);
    const paletteCoverage = signatureReceipt.coverage.find((item) => item.aspect === "palette");
    const typographyCoverage = signatureReceipt.coverage.find((item) => item.aspect === "typography");
    assert.ok(paletteCoverage.evidence_paths.some((item) => item.endsWith("-tokens.json")));
    assert.ok(typographyCoverage.evidence_paths.some((item) => item.endsWith("-fonts.json")));

    const prototype = state.results.find((record) =>
      record.normalized.kind === "direction-candidate").normalized.evidence[0].path;
    fs.appendFileSync(prototype, "tampered\n");
    assert.throws(() => readDesignState(space.statePath), /changed after it was digest-bound/);
  } finally {
    fs.rmSync(space.directory, { recursive: true, force: true });
  }
});

test("creator self-review and incomplete Playwright evidence fail closed", () => {
  const selfReview = workspace();
  try {
    const state = startDesignExploration({
      statePath: selfReview.statePath,
      briefPath: selfReview.briefPath,
      baselinePath: selfReview.baseline,
      hostManifest: host(selfReview.directory, { directionReview: { self_review: true } }),
      root: selfReview.directory
    });
    assert.equal(state.status, "blocked");
    assert.ok(state.blockers.some((item) => item.includes("creator cannot review")));
  } finally {
    fs.rmSync(selfReview.directory, { recursive: true, force: true });
  }

  const missingBrowser = workspace();
  try {
    const state = startDesignExploration({
      statePath: missingBrowser.statePath,
      briefPath: missingBrowser.briefPath,
      baselinePath: missingBrowser.baseline,
      hostManifest: host(missingBrowser.directory, { browser: { omit_last_viewport: true } }),
      root: missingBrowser.directory
    });
    assert.equal(state.status, "blocked");
    assert.ok(state.blockers.some((item) => item.includes("missing screenshot viewport")));
  } finally {
    fs.rmSync(missingBrowser.directory, { recursive: true, force: true });
  }
});

test("byte-identical matrices, repeated palettes, and low distinctiveness fail closed", () => {
  const duplicateDirections = workspace();
  try {
    const state = startDesignExploration({
      statePath: duplicateDirections.statePath,
      briefPath: duplicateDirections.briefPath,
      baselinePath: duplicateDirections.baseline,
      hostManifest: host(duplicateDirections.directory, { direction: { duplicate_prototype: true } }),
      root: duplicateDirections.directory
    });
    assert.equal(state.status, "blocked");
    assert.equal(state.phase, "direction-diversity");
    assert.ok(state.blockers.some((item) => item.includes("byte-identical")));
    assert.equal(state.results.filter((item) => item.normalized.kind === "browser-evidence").length, 0);
  } finally {
    fs.rmSync(duplicateDirections.directory, { recursive: true, force: true });
  }

  const lowDistinctiveness = workspace();
  try {
    const state = startDesignExploration({
      statePath: lowDistinctiveness.statePath,
      briefPath: lowDistinctiveness.briefPath,
      baselinePath: lowDistinctiveness.baseline,
      hostManifest: host(lowDistinctiveness.directory, {
        directionReview: { low_criterion: "distinctiveness" }
      }),
      root: lowDistinctiveness.directory
    });
    assert.equal(state.status, "blocked");
    assert.equal(state.phase, "direction-review");
    assert.ok(state.blockers.some((item) => item.includes("distinctiveness")));
  } finally {
    fs.rmSync(lowDistinctiveness.directory, { recursive: true, force: true });
  }

  const duplicateColors = workspace();
  try {
    let state = startDesignExploration({
      statePath: duplicateColors.statePath,
      briefPath: duplicateColors.briefPath,
      baselinePath: duplicateColors.baseline,
      hostManifest: host(duplicateColors.directory),
      root: duplicateColors.directory
    });
    state = resumeDesignExploration(duplicateColors.statePath, {
      hostManifest: host(duplicateColors.directory, { color: { duplicate_palette: true } }),
      shortlistPath: writeShortlist(duplicateColors, state)
    });
    assert.equal(state.status, "blocked");
    assert.equal(state.phase, "color-diversity");
    assert.ok(state.blockers.some((item) => item.includes("identical palette")));
  } finally {
    fs.rmSync(duplicateColors.directory, { recursive: true, force: true });
  }
});

test("font license evidence and implementation token mismatches fail closed", () => {
  const invalidFont = workspace();
  try {
    const state = startDesignExploration({
      statePath: invalidFont.statePath,
      briefPath: invalidFont.briefPath,
      baselinePath: invalidFont.baseline,
      hostManifest: host(invalidFont.directory, { direction: { invalid_font_report: true } }),
      root: invalidFont.directory
    });
    assert.equal(state.status, "blocked");
    assert.equal(state.phase, "direction-generation");
    assert.ok(state.blockers.some((item) => item.includes("license.status must be cleared")));
  } finally {
    fs.rmSync(invalidFont.directory, { recursive: true, force: true });
  }

  const mismatchedTokens = workspace();
  try {
    let state = startDesignExploration({
      statePath: mismatchedTokens.statePath,
      briefPath: mismatchedTokens.briefPath,
      baselinePath: mismatchedTokens.baseline,
      hostManifest: host(mismatchedTokens.directory),
      root: mismatchedTokens.directory
    });
    state = resumeDesignExploration(mismatchedTokens.statePath, {
      hostManifest: host(mismatchedTokens.directory, { color: { token_mismatch: true } }),
      shortlistPath: writeShortlist(mismatchedTokens, state)
    });
    assert.equal(state.status, "blocked");
    assert.equal(state.phase, "color-generation");
    assert.ok(state.blockers.some((item) => item.includes("token specification value mismatch")));
  } finally {
    fs.rmSync(mismatchedTokens.directory, { recursive: true, force: true });
  }
});

test("execution failures resume only through an explicit retry selector", () => {
  const space = workspace();
  try {
    let state = startDesignExploration({
      statePath: space.statePath,
      briefPath: space.briefPath,
      baselinePath: space.baseline,
      hostManifest: host(space.directory, { direction: { fail_attempts: [1] } }),
      root: space.directory
    });
    assert.equal(state.status, "blocked");
    assert.equal(state.results.length, 0);

    state = resumeDesignExploration(space.statePath, { hostManifest: host(space.directory) });
    assert.equal(state.status, "blocked");
    assert.equal(state.results.length, 0);

    state = resumeDesignExploration(space.statePath, {
      hostManifest: host(space.directory),
      retry: "all"
    });
    assert.equal(state.status, "manual_pending");
    assert.equal(state.phase, "direction-selection");
    assert.equal(state.results.filter((item) => item.normalized.kind === "direction-candidate").length, 9);
    assert.ok(state.attempts.some((item) => item.attempt === 2 && item.execution_status === "ran"));
  } finally {
    fs.rmSync(space.directory, { recursive: true, force: true });
  }
});

test("contrast ratios are recomputed locally instead of trusting adapter claims", () => {
  assert.ok(contrastRatio("#0F172A", "#FFFFFF") > 10);
  assert.ok(contrastRatio("#CBD5E1", "#FFFFFF") < 2);
});
