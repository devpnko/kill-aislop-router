import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadHostManifest } from "../src/execution.mjs";
import { canonicalDigest, hashArtifact } from "../src/integrity.mjs";
import {
  dispatchReferencePackets,
  dryRunReferenceIntelligence,
  inspectReferenceStateLease,
  readReferenceState,
  recoverReferenceStateLease,
  resumeReferenceIntelligence,
  startReferenceIntelligence,
  validateReferenceBrief
} from "../src/reference.mjs";
import { sealedEntrypointGraphDigest } from "../src/sealed-entrypoint.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = path.join(root, "test", "fixtures", "reference-host-adapter.mjs");
const cli = path.join(root, "bin", "killsloprouter.mjs");
const CHECKPOINT_CHILD_TIMEOUT_MS = 5_000;

const capabilities = {
  discovery: [
    "reference-discovery", "source-provenance", "rights-aware-research", "popularity-evidence"
  ],
  grammar: [
    "reference-grammar-extraction", "information-hierarchy-analysis",
    "component-pattern-analysis", "product-fit-analysis"
  ],
  critic: [
    "reference-evidence-review", "anti-copy-review", "product-fit-review",
    "popularity-ranking-review"
  ]
};

function writeJson(target, value) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
}

function workspace() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-reference-"));
  const evidence = path.join(directory, "evidence");
  fs.mkdirSync(evidence, { recursive: true });
  const ownerPath = path.join(evidence, "owner.md");
  const rightsPath = path.join(evidence, "rights.md");
  const planningPath = path.join(evidence, "planning.json");
  fs.writeFileSync(ownerPath, "Owner authorizes bounded UI Bowl reference research.\n");
  fs.writeFileSync(rightsPath, "Reference only; no redistribution and no creator pixel access.\n");
  writeJson(planningPath, {
    planning_gate_version: 1,
    protocol: { id: "service-planning", version: "1", authority: "owner-governed" },
    project_id: "reference-test",
    surface: "consumer-product-ui",
    scope_id: "results",
    phase: "phase_1",
    gates: {
      G1: { status: "passed" },
      G2: { status: "approved" }
    },
    updated_at: "2026-09-04T00:00:00.000Z"
  });
  const brief = {
    reference_brief_version: 1,
    project_id: "reference-test",
    surface: "consumer-product-ui",
    locales: ["ko-KR"],
    activation: {
      mode: "explicit-owner-reference-research",
      owner_request_id: "OWNER-REF-TEST",
      request_excerpt: "Use popular released-product references to improve the design grammar.",
      authorized_at: "2026-09-04T00:00:00.000Z",
      evidence: { path: "evidence/owner.md", digest: hashArtifact(ownerPath) }
    },
    planning: {
      product_frame: {
        primary_user: "buyer",
        user_job: "compare offers and their evidence",
        screen_family: "regional results",
        main_object: "seller offer",
        core_task: "compare normalized conditions",
        trust_risk: "high",
        density: "compact",
        required_states: ["results", "partial-data", "low-confidence", "empty", "error"],
        success_metric: "conditions and uncertainty remain comparable"
      },
      sources: [{
        id: "service-plan",
        kind: "service-planning-gate",
        path: "evidence/planning.json",
        digest: hashArtifact(planningPath)
      }],
      required_gate_ids: ["G1", "G2"]
    },
    source: {
      provider: "uibowl",
      access_mode: "manual-export",
      rights: {
        status: "reference-only",
        evidence: { path: "evidence/rights.md", digest: hashArtifact(rightsPath) },
        redistribution: false,
        creator_pixel_access: false
      },
      queries: [
        { id: "comparison", kind: "pattern", term: "comparison", screen_family: "results" },
        { id: "tabs", kind: "component", term: "tabs", screen_family: "results" }
      ]
    },
    coverage: {
      minimum_verified_references: 3,
      maximum_references: 12,
      required_component_families: ["tabs", "comparison-table", "evidence-panel"],
      required_patterns: ["progressive-disclosure", "confidence-disclosure"],
      required_grammar_dimensions: [
        "information-hierarchy", "navigation", "data-comparison", "evidence-presentation",
        "typography", "color-roles", "density", "responsive"
      ]
    },
    popularity_prior: {
      role: "within-fit-band-ranking-only",
      primary_sort: "product-fit-band",
      signals: [{ id: "popular", metric: "curation-popularity", weight: 1 }],
      cannot_affect: ["eligibility", "hard-gates", "owner-approval"]
    },
    providers: {
      discovery: "reference-researcher",
      grammar_extractor: "reference-grammar-analyst",
      critic: "reference-independent-critic"
    }
  };
  const briefPath = path.join(directory, "reference-brief.json");
  writeJson(briefPath, brief);
  return {
    directory,
    evidence,
    ownerPath,
    rightsPath,
    planningPath,
    brief,
    briefPath,
    statePath: path.join(directory, ".killsloprouter", "reference-run.json")
  };
}

function provider(providerCapabilities, strength, permissions, settings = {}, timeoutMs = 30_000) {
  return {
    adapter: "agent-json-v1",
    entrypoint: fixture,
    entrypoint_digest: hashArtifact(fixture),
    entrypoint_graph_digest: sealedEntrypointGraphDigest(fixture),
    capabilities: providerCapabilities,
    strength,
    permissions,
    timeout_ms: timeoutMs,
    settings
  };
}

function host(space, settings = {}, mutate = null, timeoutMs = 30_000) {
  const manifestPath = path.join(space.directory, `host-${Math.random().toString(16).slice(2)}.json`);
  const manifest = {
    host_adapter_version: 1,
    allowed_providers: [
      "reference-researcher", "reference-grammar-analyst", "reference-independent-critic"
    ],
    granted_permissions: ["artifact:read", "evidence:write", "network:external"],
    providers: {
      "reference-researcher": provider(capabilities.discovery, 3,
        ["artifact:read", "evidence:write", "network:external"], settings.discovery, timeoutMs),
      "reference-grammar-analyst": provider(capabilities.grammar, 3,
        ["artifact:read", "evidence:write"], settings.grammar, timeoutMs),
      "reference-independent-critic": provider(capabilities.critic, 4,
        ["artifact:read", "evidence:write"], settings.critic, timeoutMs)
    }
  };
  if (mutate) mutate(manifest);
  writeJson(manifestPath, manifest);
  return { path: manifestPath, manifest: loadHostManifest(manifestPath) };
}

function writeSelection(space, state, mutate = null) {
  const anchor = state.ranking[0].reference_id;
  const supports = state.ranking.slice(1, 3).map((item) => item.reference_id);
  const grammar = state.results.find((item) => item.packet_id === "reference-grammar").normalized;
  const grammarIds = state.brief.coverage.required_grammar_dimensions.map((dimension) =>
    grammar.references.find((entry) => entry.reference_id === anchor).grammar
      .find((item) => item.dimension === dimension).grammar_id);
  const selection = {
    reference_owner_selection_version: 1,
    run_id: state.run_id,
    journey_identity: state.journey_identity,
    selection_scope_digest: state.selection_scope_digest,
    owner_id: "owner:product-design",
    status: "selected",
    anchor_reference_id: anchor,
    supporting_reference_ids: supports,
    selected_grammar_ids: grammarIds,
    rationale: "Use the strongest exact-fit hierarchy with two independently sourced supports.",
    decided_at: "2026-09-04T02:00:00.000Z"
  };
  if (mutate) mutate(selection);
  const target = path.join(space.directory, `selection-${Math.random().toString(16).slice(2)}.json`);
  writeJson(target, selection);
  return target;
}

test("reference dry run binds service planning, parent identity, rights, and manual readiness", () => {
  const space = workspace();
  try {
    const report = dryRunReferenceIntelligence({
      briefPath: space.briefPath,
      root: space.directory
    });
    assert.equal(report.status, "manual_pending");
    assert.equal(report.journey_identity.display_name, "KillSlopRouter");
    assert.equal(report.popularity_policy.primary, "product-fit-band");
    assert.equal(report.popularity_policy.can_override_hard_gates, false);
    assert.equal(report.readiness.length, 3);
    assert.ok(report.readiness.every((item) => item.participant.visibility === "internal"));
    assert.deepEqual(report.readiness.map((item) => item.participant.role),
      ["researcher", "researcher", "critic"]);
  } finally {
    fs.rmSync(space.directory, { recursive: true, force: true });
  }
});

test("partial capability and missing network permission remain manual_pending", () => {
  const space = workspace();
  try {
    space.brief.source.access_mode = "authorized-read-only-adapter";
    writeJson(space.briefPath, space.brief);
    const configured = host(space, {}, (manifest) => {
      manifest.providers["reference-researcher"].permissions = ["artifact:read", "evidence:write"];
      manifest.providers["reference-grammar-analyst"].capabilities = ["reference-grammar-extraction"];
    });
    const report = dryRunReferenceIntelligence({
      briefPath: space.briefPath,
      hostManifest: configured.manifest,
      root: space.directory
    });
    assert.equal(report.status, "manual_pending");
    assert.ok(report.pending.some((item) => item.includes("network:external")));
    assert.ok(report.pending.some((item) => item.includes("lacks assigned capabilities")));
  } finally {
    fs.rmSync(space.directory, { recursive: true, force: true });
  }
});

test("reference child processes rank popularity only inside product-fit bands and compile a pixel-free pack", () => {
  const space = workspace();
  try {
    const configured = host(space);
    let state = startReferenceIntelligence({
      statePath: space.statePath,
      briefPath: space.briefPath,
      hostManifest: configured.manifest,
      root: space.directory
    });
    assert.equal(state.status, "manual_pending");
    assert.equal(state.phase, "owner-reference-selection");
    assert.deepEqual(state.ranking.map((item) => item.reference_id), [
      "flowdesk-results", "marketline-proof", "proofgrid-offers", "megashop-ranking"
    ]);
    assert.equal(state.ranking.at(-1).popularity_score, 100,
      "a weaker product-fit band must not win through popularity");
    assert.equal(state.attempts.length, 3);
    assert.ok(state.attempts.every((item) => item.execution_status === "ran"));
    assert.ok(state.attempts.every((item) => Number.isInteger(item.child_pid) && item.child_pid > 0));
    assert.ok(state.packets.every((packet) =>
      packet.journey_identity.identity_digest === state.journey_identity.identity_digest &&
      packet.participant.visibility === "internal" &&
      packet.participant.orchestrator_id === "kill-slop-router"));
    const ownerDispatch = dispatchReferencePackets(
      state,
      path.join(space.directory, "owner-dispatch")
    );
    assert.equal(ownerDispatch.packet_count, 0,
      "manual dispatch must not re-emit completed child packets");
    assert.ok(fs.existsSync(ownerDispatch.selection_template));

    state = resumeReferenceIntelligence(space.statePath, {
      hostManifest: configured.manifest,
      selectionPath: writeSelection(space, state)
    });
    assert.equal(state.status, "complete");
    const pack = JSON.parse(fs.readFileSync(state.outputs.reference_pack.resolved_path, "utf8"));
    assert.equal(pack.authority_scope, "discovery-evidence-only");
    assert.equal(pack.downstream_contract.source_pixels_included, false);
    assert.equal(pack.downstream_contract.visual_authority_granted, false);
    assert.equal(pack.downstream_contract.exact_three_3x3_route_unchanged, true);
    assert.doesNotMatch(JSON.stringify(pack), /source-capture|\/evidence\/|\.png/i);
    const { pack_digest: _digest, ...body } = pack;
    assert.equal(pack.pack_digest, canonicalDigest(body));
    assert.equal(readReferenceState(space.statePath).status, "complete");
  } finally {
    fs.rmSync(space.directory, { recursive: true, force: true });
  }
});

test("independent critic self-review and insufficient verified coverage fail closed", () => {
  for (const variant of [
    "self-review", "coverage", "duplicate-grammar", "same-researcher-actor",
    "overclaim-component"
  ]) {
    const space = workspace();
    try {
      const configured = host(space, {
        critic: variant === "self-review"
          ? { self_review: true }
          : variant === "coverage"
            ? { low_coverage: true }
            : variant === "overclaim-component" ? { overclaim_component: true } : {},
        grammar: variant === "duplicate-grammar"
          ? { duplicate_reference: true }
          : variant === "same-researcher-actor" ? { same_actor: true } : {}
      });
      const state = startReferenceIntelligence({
        statePath: space.statePath,
        briefPath: space.briefPath,
        hostManifest: configured.manifest,
        root: space.directory
      });
      assert.equal(state.status, "blocked");
      if (variant === "self-review") {
        assert.ok(state.blockers.some((item) => item.includes("cannot review its own")));
      } else if (variant === "coverage") {
        assert.equal(state.phase, "reference-coverage");
        assert.ok(state.blockers.some((item) => item.includes("verified references 2/3")));
      } else if (variant === "duplicate-grammar") {
        assert.equal(state.phase, "reference-grammar");
        assert.ok(state.blockers.some((item) => item.includes("repeats reference")));
      } else if (variant === "same-researcher-actor") {
        assert.equal(state.phase, "reference-grammar");
        assert.ok(state.blockers.some((item) => item.includes("distinct actor")));
      } else {
        assert.equal(state.phase, "reference-review");
        assert.ok(state.blockers.some((item) => item.includes("undeclared component or pattern")));
      }
    } finally {
      fs.rmSync(space.directory, { recursive: true, force: true });
    }
  }
});

test("generated owner template, placeholders, and participant-as-owner cannot satisfy the owner gate", () => {
  const space = workspace();
  try {
    const configured = host(space);
    const state = startReferenceIntelligence({
      statePath: space.statePath,
      briefPath: space.briefPath,
      hostManifest: configured.manifest,
      root: space.directory
    });
    const template = path.join(
      state.state_directory, "templates", "reference-owner-selection.json"
    );
    assert.throws(() => resumeReferenceIntelligence(space.statePath, {
      hostManifest: configured.manifest,
      selectionPath: template
    }), /outside the child-writable state directory/);

    const placeholder = writeSelection(space, state, (selection) => {
      selection.owner_id = "REPLACE_WITH_OWNER_ID";
    });
    assert.throws(() => resumeReferenceIntelligence(space.statePath, {
      hostManifest: configured.manifest,
      selectionPath: placeholder
    }), /owner placeholder/);

    const participant = writeSelection(space, state, (selection) => {
      selection.owner_id = "critic:reference-independent";
    });
    assert.throws(() => resumeReferenceIntelligence(space.statePath, {
      hostManifest: configured.manifest,
      selectionPath: participant
    }), /participant cannot act as owner/);
  } finally {
    fs.rmSync(space.directory, { recursive: true, force: true });
  }
});

test("planning evidence tamper and owner selection outside verified scope fail closed", () => {
  const space = workspace();
  try {
    const configured = host(space);
    let state = startReferenceIntelligence({
      statePath: space.statePath,
      briefPath: space.briefPath,
      hostManifest: configured.manifest,
      root: space.directory
    });
    const invalidSelection = writeSelection(space, state, (selection) => {
      selection.anchor_reference_id = "unknown-reference";
    });
    assert.throws(() => resumeReferenceIntelligence(space.statePath, {
      hostManifest: configured.manifest,
      selectionPath: invalidSelection
    }), /anchor is not eligible/);

    fs.appendFileSync(space.planningPath, "\n");
    assert.throws(() => readReferenceState(space.statePath),
      /service-planning source service-plan changed after it was digest-bound/);
  } finally {
    fs.rmSync(space.directory, { recursive: true, force: true });
  }
});

test("reference authority evidence must be a pinned single-link file", () => {
  const space = workspace();
  try {
    const linkedOwner = path.join(space.evidence, "owner-hardlink.md");
    fs.linkSync(space.ownerPath, linkedOwner);
    space.brief.activation.evidence.path = path.relative(space.directory, linkedOwner);
    writeJson(space.briefPath, space.brief);
    assert.throws(() => validateReferenceBrief(space.brief, { root: space.directory }),
      /single-link regular file/);
    assert.equal(fs.existsSync(space.statePath), false);
    assert.equal(fs.existsSync(`${space.statePath}.lease`), false);
  } finally {
    fs.rmSync(space.directory, { recursive: true, force: true });
  }
});

test("reference start and dispatch reject symlink ancestors before redirected writes", () => {
  const space = workspace();
  try {
    const redirectedState = path.join(space.directory, "redirected-state");
    const stateAlias = path.join(space.directory, "state-alias");
    fs.mkdirSync(redirectedState);
    fs.symlinkSync(redirectedState, stateAlias, "dir");
    assert.throws(() => startReferenceIntelligence({
      statePath: path.join(stateAlias, "nested", "reference-run.json"),
      briefPath: space.briefPath,
      root: space.directory
    }), /symbolic link|symlink/);
    assert.equal(fs.existsSync(path.join(redirectedState, "nested")), false);

    const state = startReferenceIntelligence({
      statePath: space.statePath,
      briefPath: space.briefPath,
      root: space.directory
    });
    const redirectedDispatch = path.join(space.directory, "redirected-dispatch");
    const dispatchAlias = path.join(space.directory, "dispatch-alias");
    fs.mkdirSync(redirectedDispatch);
    fs.symlinkSync(redirectedDispatch, dispatchAlias, "dir");
    assert.throws(() => dispatchReferencePackets(
      state,
      path.join(dispatchAlias, "nested")
    ), /symbolic link|symlink/);
    assert.equal(fs.existsSync(path.join(redirectedDispatch, "nested")), false);
  } finally {
    fs.rmSync(space.directory, { recursive: true, force: true });
  }
});

test("reference packet file tamper blocks state reuse", () => {
  const space = workspace();
  try {
    const state = startReferenceIntelligence({
      statePath: space.statePath,
      briefPath: space.briefPath,
      root: space.directory
    });
    const packetPath = state.packet_files["reference-discovery"].resolved_path;
    const packet = JSON.parse(fs.readFileSync(packetPath, "utf8"));
    packet.reference_task.rule = "tampered rule";
    writeJson(packetPath, packet);
    assert.throws(() => readReferenceState(space.statePath),
      /reference packet file reference-discovery changed after it was digest-bound/);
  } finally {
    fs.rmSync(space.directory, { recursive: true, force: true });
  }
});

test("manual reference evidence cannot escape the submitted result directory", () => {
  const producer = workspace();
  const consumer = workspace();
  try {
    const produced = startReferenceIntelligence({
      statePath: producer.statePath,
      briefPath: producer.briefPath,
      hostManifest: host(producer).manifest,
      root: producer.directory
    });
    const state = startReferenceIntelligence({
      statePath: consumer.statePath,
      briefPath: consumer.briefPath,
      root: consumer.directory
    });
    const result = structuredClone(produced.results.find((item) =>
      item.packet_id === "reference-discovery").normalized);
    result.packet_digest = state.packets.find((item) =>
      item.packet_id === "reference-discovery").packet_digest;
    const manualPath = path.join(consumer.directory, "manual-discovery-result.json");
    writeJson(manualPath, result);
    assert.throws(() => resumeReferenceIntelligence(consumer.statePath, {
      resultPaths: [manualPath]
    }), /escapes its authorized result directory/);
    assert.equal(readReferenceState(consumer.statePath).results.length, 0);
  } finally {
    fs.rmSync(producer.directory, { recursive: true, force: true });
    fs.rmSync(consumer.directory, { recursive: true, force: true });
  }
});

test("manual state dispatches exact packets and remains resumable", () => {
  const space = workspace();
  try {
    const state = startReferenceIntelligence({
      statePath: space.statePath,
      briefPath: space.briefPath,
      root: space.directory
    });
    assert.equal(state.status, "manual_pending");
    assert.equal(state.phase, "reference-discovery");
    const output = path.join(space.directory, "dispatch");
    const dispatch = dispatchReferencePackets(state, output);
    assert.equal(dispatch.packet_count, 1);
    assert.ok(fs.existsSync(path.join(output, "reference-discovery.json")));
    assert.equal(readReferenceState(space.statePath).state_digest, state.state_digest);
  } finally {
    fs.rmSync(space.directory, { recursive: true, force: true });
  }
});

test("overlapping reference resume is rejected before a second child starts", async () => {
  const space = workspace();
  try {
    startReferenceIntelligence({
      statePath: space.statePath,
      briefPath: space.briefPath,
      root: space.directory
    });
    const configured = host(space, {
      discovery: { delay_ms: 500 },
      grammar: { delay_ms: 500 },
      critic: { delay_ms: 500 }
    });
    const first = spawn(process.execPath, [
      cli, "reference", "run", "--resume", space.statePath,
      "--host-config", configured.path, "--json"
    ], { encoding: "utf8" });
    let firstStdout = "";
    let firstStderr = "";
    first.stdout.on("data", (chunk) => { firstStdout += chunk; });
    first.stderr.on("data", (chunk) => { firstStderr += chunk; });
    const leaseDirectory = `${space.statePath}.lease`;
    const deadline = Date.now() + 3_000;
    while (!fs.existsSync(leaseDirectory) && Date.now() < deadline) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
    assert.ok(fs.existsSync(leaseDirectory), "first resume did not acquire its state lease");
    const second = spawnSync(process.execPath, [
      cli, "reference", "run", "--resume", space.statePath,
      "--host-config", configured.path, "--json"
    ], { encoding: "utf8" });
    assert.equal(second.status, 5, second.stderr);
    assert.match(second.stderr, /active automation state lease blocks reference-resume/);
    const firstStatus = await new Promise((resolve, reject) => {
      first.once("error", reject);
      first.once("close", resolve);
    });
    assert.equal(firstStatus, 6, firstStderr || firstStdout);
    const state = readReferenceState(space.statePath);
    assert.equal(state.attempts.filter((item) => item.execution_status === "ran").length, 3);
    assert.equal(state.results.length, 3);
  } finally {
    fs.rmSync(space.directory, { recursive: true, force: true });
  }
});

test("stale child lease recovery records an unknown outcome and requires explicit retry", () => {
  const space = workspace();
  try {
    const crashHost = host(space, {}, null, 100);
    const configured = host(space);
    const runner = path.join(root, "test", "fixtures", "reference-crash-runner.mjs");
    const crashed = spawnSync(process.execPath, [
      runner, space.briefPath, space.statePath, crashHost.path, space.directory
    ], { encoding: "utf8" });
    assert.equal(crashed.status, 73, crashed.stderr);
    let lease = inspectReferenceStateLease(space.statePath);
    assert.equal(lease.status, "locked");
    assert.equal(lease.phase, "child-execution");
    const deadline = Date.parse(lease.recover_after);
    while (Date.now() <= deadline) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
    const recoveryProcess = spawnSync(process.execPath, [
      cli, "reference", "recover",
      "--state", space.statePath,
      "--owner-token", lease.owner_token,
      "--acquired-at", lease.acquired_at,
      "--state-digest", lease.state_digest,
      "--json"
    ], { encoding: "utf8" });
    assert.equal(recoveryProcess.status, 0, recoveryProcess.stderr);
    const recovered = JSON.parse(recoveryProcess.stdout);
    assert.equal(recovered.status, "recovered");
    assert.equal(recovered.recovery.outcome, "abandoned_after_crash");
    assert.equal(recovered.recovery.retry_required, true);
    assert.equal(inspectReferenceStateLease(space.statePath).status, "unlocked");
    let state = readReferenceState(space.statePath);
    assert.equal(state.status, "blocked");
    assert.equal(state.phase, "reference-recovery");
    assert.equal(state.lease_recoveries.length, 1);
    assert.ok(state.attempts.some((item) =>
      item.execution_status === "blocked_abandoned_after_crash"));

    state = resumeReferenceIntelligence(space.statePath, {
      hostManifest: configured.manifest
    });
    assert.equal(state.status, "blocked");
    assert.equal(state.results.length, 0);

    state = resumeReferenceIntelligence(space.statePath, {
      hostManifest: configured.manifest,
      retry: "reference-discovery"
    });
    assert.equal(state.status, "manual_pending");
    assert.equal(state.phase, "owner-reference-selection");
    assert.equal(state.results.length, 3);
  } finally {
    fs.rmSync(space.directory, { recursive: true, force: true });
  }
});

test("post-child state write crash recovers a verified checkpoint without rerunning the child", () => {
  const space = workspace();
  try {
    const crashHost = host(space, {}, null, CHECKPOINT_CHILD_TIMEOUT_MS);
    const configured = host(space);
    const runner = path.join(root, "test", "fixtures", "reference-crash-runner.mjs");
    const crashed = spawnSync(process.execPath, [
      runner, space.briefPath, space.statePath, crashHost.path, space.directory,
      "post-child-checkpoint"
    ], { encoding: "utf8" });
    assert.equal(crashed.status, 74, crashed.stderr);
    let state = readReferenceState(space.statePath);
    assert.equal(state.in_flight, null);
    assert.equal(state.results.length, 1);
    assert.equal(state.attempts.length, 1);
    assert.equal(state.attempts[0].execution_status, "ran");
    let lease = inspectReferenceStateLease(space.statePath);
    assert.equal(lease.phase, "child-execution");
    const deadline = Date.parse(lease.recover_after);
    while (Date.now() <= deadline) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
    const recovered = recoverReferenceStateLease(space.statePath, {
      ownerToken: lease.owner_token,
      acquiredAt: lease.acquired_at,
      stateDigest: lease.state_digest
    });
    assert.equal(recovered.recovery.outcome, "checkpoint_recovered");
    assert.equal(recovered.recovery.retry_required, false);
    assert.equal(inspectReferenceStateLease(space.statePath).status, "unlocked");
    state = readReferenceState(space.statePath);
    assert.equal(state.status, "manual_pending");
    assert.match(state.pending[0], /resume the recovered KillSlopRouter reference journey/);
    assert.equal(state.lease_recoveries.length, 1);
    assert.throws(() => recoverReferenceStateLease(space.statePath, {
      ownerToken: lease.owner_token,
      acquiredAt: lease.acquired_at,
      stateDigest: lease.state_digest
    }), /requires an active state lease/);
    assert.equal(readReferenceState(space.statePath).lease_recoveries.length, 1);

    state = resumeReferenceIntelligence(space.statePath, {
      hostManifest: configured.manifest
    });
    assert.equal(state.status, "manual_pending");
    assert.equal(state.phase, "owner-reference-selection");
    assert.equal(state.results.length, 3);
    assert.equal(state.attempts.filter((item) =>
      item.packet_id === "reference-discovery" && item.execution_status === "ran").length, 1);
  } finally {
    fs.rmSync(space.directory, { recursive: true, force: true });
  }
});

test("recovery checkpoint crash replays one receipt and never reruns the completed child", () => {
  const space = workspace();
  try {
    const crashHost = host(space, {}, null, CHECKPOINT_CHILD_TIMEOUT_MS);
    const configured = host(space);
    const runner = path.join(root, "test", "fixtures", "reference-crash-runner.mjs");
    let crashed = spawnSync(process.execPath, [
      runner, space.briefPath, space.statePath, crashHost.path, space.directory,
      "post-child-checkpoint"
    ], { encoding: "utf8" });
    assert.equal(crashed.status, 74, crashed.stderr);
    let lease = inspectReferenceStateLease(space.statePath);
    while (Date.now() <= Date.parse(lease.recover_after)) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }

    crashed = spawnSync(process.execPath, [
      runner, space.briefPath, space.statePath, crashHost.path, space.directory,
      "recovery-checkpoint", lease.owner_token, lease.acquired_at, lease.state_digest
    ], { encoding: "utf8" });
    assert.equal(crashed.status, 75, crashed.stderr);
    let state = readReferenceState(space.statePath);
    assert.equal(state.lease_recoveries.length, 1);
    const firstReceiptDigest = state.lease_recoveries[0].recovery_digest;
    assert.equal(state.status, "manual_pending");
    lease = inspectReferenceStateLease(space.statePath);
    assert.equal(lease.status, "locked");
    assert.equal(lease.phase, "state-write");
    while (Date.now() <= Date.parse(lease.recover_after)) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
    const replayed = recoverReferenceStateLease(space.statePath, {
      ownerToken: lease.owner_token,
      acquiredAt: lease.acquired_at,
      stateDigest: lease.state_digest
    });
    assert.equal(replayed.recovery.recovery_digest, firstReceiptDigest);
    assert.equal(inspectReferenceStateLease(space.statePath).status, "unlocked");
    state = readReferenceState(space.statePath);
    assert.equal(state.lease_recoveries.length, 1);

    state = resumeReferenceIntelligence(space.statePath, {
      hostManifest: configured.manifest
    });
    assert.equal(state.status, "manual_pending");
    assert.equal(state.results.length, 3);
    assert.equal(state.attempts.filter((item) =>
      item.packet_id === "reference-discovery" && item.execution_status === "ran").length, 1);
  } finally {
    fs.rmSync(space.directory, { recursive: true, force: true });
  }
});

test("recovery completion crash converges before its first receipt write", () => {
  const space = workspace();
  try {
    const crashHost = host(space, {}, null, CHECKPOINT_CHILD_TIMEOUT_MS);
    const configured = host(space);
    const runner = path.join(root, "test", "fixtures", "reference-crash-runner.mjs");
    let crashed = spawnSync(process.execPath, [
      runner, space.briefPath, space.statePath, crashHost.path, space.directory,
      "post-child-checkpoint"
    ], { encoding: "utf8" });
    assert.equal(crashed.status, 74, crashed.stderr);
    let lease = inspectReferenceStateLease(space.statePath);
    while (Date.now() <= Date.parse(lease.recover_after)) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }

    crashed = spawnSync(process.execPath, [
      runner, space.briefPath, space.statePath, crashHost.path, space.directory,
      "recovery-complete", lease.owner_token, lease.acquired_at, lease.state_digest
    ], { encoding: "utf8" });
    assert.equal(crashed.status, 77, crashed.stderr);
    let state = readReferenceState(space.statePath);
    assert.equal(state.lease_recoveries.length, 0);
    lease = inspectReferenceStateLease(space.statePath);
    assert.equal(lease.status, "locked");
    assert.equal(lease.phase, "checkpoint");
    while (Date.now() <= Date.parse(lease.recover_after)) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
    const recovered = recoverReferenceStateLease(space.statePath, {
      ownerToken: lease.owner_token,
      acquiredAt: lease.acquired_at,
      stateDigest: lease.state_digest
    });
    assert.equal(recovered.recovery.outcome, "checkpoint_recovered");
    assert.equal(inspectReferenceStateLease(space.statePath).status, "unlocked");
    state = readReferenceState(space.statePath);
    assert.equal(state.lease_recoveries.length, 1);

    state = resumeReferenceIntelligence(space.statePath, {
      hostManifest: configured.manifest
    });
    assert.equal(state.status, "manual_pending");
    assert.equal(state.results.length, 3);
    assert.equal(state.attempts.filter((item) =>
      item.packet_id === "reference-discovery" && item.execution_status === "ran").length, 1);
  } finally {
    fs.rmSync(space.directory, { recursive: true, force: true });
  }
});

test("resealed state tamper outside the stale lease transition cannot be recovered", () => {
  const space = workspace();
  try {
    const crashHost = host(space, {}, null, CHECKPOINT_CHILD_TIMEOUT_MS);
    const runner = path.join(root, "test", "fixtures", "reference-crash-runner.mjs");
    const crashed = spawnSync(process.execPath, [
      runner, space.briefPath, space.statePath, crashHost.path, space.directory,
      "post-child-checkpoint"
    ], { encoding: "utf8" });
    assert.equal(crashed.status, 74, crashed.stderr);
    const originalLease = inspectReferenceStateLease(space.statePath);
    const tampered = JSON.parse(fs.readFileSync(space.statePath, "utf8"));
    tampered.blockers.push("attacker-resealed-state");
    const { state_digest: _digest, ...body } = tampered;
    tampered.state_digest = canonicalDigest(body);
    writeJson(space.statePath, tampered);
    const observed = inspectReferenceStateLease(space.statePath);
    assert.notEqual(observed.state_digest, originalLease.state_digest);
    while (Date.now() <= Date.parse(observed.recover_after)) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
    assert.throws(() => recoverReferenceStateLease(space.statePath, {
      ownerToken: observed.owner_token,
      acquiredAt: observed.acquired_at,
      stateDigest: observed.state_digest
    }), /outside the lease-bound state transition/);
    assert.equal(inspectReferenceStateLease(space.statePath).status, "locked");
  } finally {
    fs.rmSync(space.directory, { recursive: true, force: true });
  }
});

test("reference brief rejects popularity as a cross-fit override and creator pixel access", () => {
  const space = workspace();
  try {
    const invalid = structuredClone(space.brief);
    invalid.popularity_prior.role = "global-primary-ranking";
    assert.throws(() => validateReferenceBrief(invalid, { root: space.directory }),
      /within an equal product-fit band/);
    const pixels = structuredClone(space.brief);
    pixels.source.rights.creator_pixel_access = true;
    assert.throws(() => validateReferenceBrief(pixels, { root: space.directory }),
      /must not be exposed to downstream creators/);
  } finally {
    fs.rmSync(space.directory, { recursive: true, force: true });
  }
});
