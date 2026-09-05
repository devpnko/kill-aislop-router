import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadHostManifest } from "../src/execution.mjs";
import { dryRunDesignExploration } from "../src/design.mjs";
import { canonicalDigest, hashArtifact, snapshotArtifact } from "../src/integrity.mjs";
import {
  dispatchReferencePackets,
  dryRunReferenceIntelligence,
  inspectReferenceStateLease,
  readReferenceState,
  referenceSourceRecipientExecutionLineage,
  recoverReferenceStateLease,
  resumeReferenceIntelligence,
  startReferenceIntelligence,
  validateReferenceBrief,
  validateReferencePack
} from "../src/reference.mjs";
import { sealedEntrypointGraphDigest } from "../src/sealed-entrypoint.mjs";
import {
  referenceCaptureBytes,
  referenceMetadataBytes
} from "./fixtures/reference-source-fixture.mjs";

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

const exportReferences = [
  { id: "flowdesk-results", popularity: 96 },
  { id: "marketline-proof", popularity: 84 },
  { id: "proofgrid-offers", popularity: 72 },
  { id: "megashop-ranking", popularity: 100 }
];

function exportFrames(referenceId, index, settings = {}) {
  const primaryRole = ["transactional", "operational", "operational", "transactional"][index];
  const promotionalCount = Number.isInteger(settings.promotional_reference_count)
    ? settings.promotional_reference_count : settings.promotional_first ? 1 : 0;
  if (index < promotionalCount) {
    return [{
      frame_id: `frame-${referenceId}-primary`,
      role: "promotional",
      core_task: false,
      state: false
    }];
  }
  if (settings.single_frame_first && index === 0) {
    return [{
      frame_id: `frame-${referenceId}-primary`,
      role: primaryRole,
      core_task: true,
      state: false
    }];
  }
  if (settings.mixed_promotional_first && index === 0) {
    return [{
      frame_id: `frame-${referenceId}-primary`,
      role: primaryRole,
      core_task: true,
      state: false
    }, {
      frame_id: `frame-${referenceId}-promo`,
      role: "promotional",
      core_task: false,
      state: false
    }];
  }
  return [{
    frame_id: `frame-${referenceId}-primary`,
    role: primaryRole,
    core_task: true,
    state: false
  }, {
    frame_id: `frame-${referenceId}-state`,
    role: "state",
    core_task: false,
    state: true
  }];
}

function manualExportFor(space, settings = {}) {
  const { brief } = space;
  const queryIds = brief.source.queries.map((query) => query.id);
  return {
    export_version: 1,
    provider: "uibowl",
    access_mode: "manual-export",
    captured_at: "2026-09-04T01:00:00.000Z",
    query_ids: queryIds,
    records: exportReferences.map((item, index) => {
      const productRecordId = settings.shared_product_first_two && index < 2
        ? "product-shared-first-two" : `product-${item.id}`;
      const sharedProduct = settings.shared_product_first_two && index < 2;
      const frames = exportFrames(item.id, index, settings);
      const evidenceDirectory = path.join(space.evidence, "ui-bowl-export-evidence");
      fs.mkdirSync(evidenceDirectory, { recursive: true });
      const signalEvidenceId = sharedProduct ? `source-${item.id}` : `metadata-${item.id}`;
      const reciprocalEvidenceId = settings.reciprocal_shared_product_conflicts && index < 2
        ? `source-conflict-${item.id}` : null;
      const popularityRecords = brief.popularity_prior.signals.map((signal) => {
        let rawValue = settings.metric_specific_popularity &&
          signal.metric === "bookmark-count"
          ? 100 - item.popularity : item.popularity;
        if (settings.identical_shared_product_signal && index === 1) {
          rawValue = settings.metric_specific_popularity &&
            signal.metric === "bookmark-count"
            ? 100 - exportReferences[0].popularity
            : exportReferences[0].popularity;
        }
        return {
          record_kind: "signal",
          signal_id: signal.id,
          metric: signal.metric,
          subject_kind: signal.subject_kind,
          subject_record_id: signal.subject_kind === "product" ? productRecordId : item.id,
          raw_value: rawValue,
          scope: signal.scope,
          category: signal.category,
          as_of: "2026-09-04T01:00:00.000Z",
          snapshot_at: settings.mismatched_shared_product_snapshot && index === 1
            ? "2026-09-04T02:00:00.000Z"
            : "2026-09-04T01:00:00.000Z",
          normalization: structuredClone(signal.normalization),
          evidence_ids: [signal.subject_kind === "product" && sharedProduct
            ? signalEvidenceId : `metadata-${item.id}`]
        };
      });
      if (settings.popularity_conflict_first && index === 0) {
        const signal = brief.popularity_prior.signals[0];
        popularityRecords.push({
          record_kind: "conflict",
          signal_id: signal.id,
          subject_kind: signal.subject_kind,
          subject_record_id: signal.subject_kind === "product" ? productRecordId : item.id,
          raw_value: item.popularity + 10,
          as_of: "2026-09-03T01:00:00.000Z",
          evidence_ids: [`metadata-${item.id}`]
        });
      }
      if (settings.reciprocal_shared_product_conflicts && index < 2) {
        for (const signal of brief.popularity_prior.signals) {
          const other = exportReferences[index === 0 ? 1 : 0];
          const otherRawValue = settings.metric_specific_popularity &&
            signal.metric === "bookmark-count"
            ? 100 - other.popularity : other.popularity;
          popularityRecords.push({
            record_kind: "conflict",
            signal_id: signal.id,
            subject_kind: signal.subject_kind,
            subject_record_id: signal.subject_kind === "product"
              ? productRecordId : item.id,
            raw_value: otherRawValue,
            as_of: "2026-09-04T01:00:00.000Z",
            evidence_ids: [signal.subject_kind === "product"
              ? settings.misbound_reciprocal_shared_product_conflicts
                ? signalEvidenceId
                : reciprocalEvidenceId
              : `metadata-${item.id}`]
          });
        }
      }
      const sourceCaptureSeed = sharedProduct && settings.identical_shared_product_signal &&
        !settings.mismatched_shared_product_evidence ? 0 : index;
      const evidenceRecords = [
        {
          evidence_id: `source-${item.id}`,
          kind: "source-capture",
          bytes: referenceCaptureBytes(sourceCaptureSeed)
        }, {
          evidence_id: `metadata-${item.id}`,
          kind: "source-metadata",
          bytes: referenceMetadataBytes({
            productRecordId,
            screenRecordId: item.id,
            capturedAt: "2026-09-04T01:00:00.000Z",
            frames,
            popularityRecords
          })
        }
      ];
      if (reciprocalEvidenceId) {
        evidenceRecords.push({
          evidence_id: reciprocalEvidenceId,
          kind: "source-capture",
          bytes: referenceCaptureBytes(index === 0 ? 1 : 0)
        });
      }
      return {
        product_record_id: productRecordId,
        screen_record_id: item.id,
        uri: `https://uibowl.io/reference/${item.id}`,
        captured_at: "2026-09-04T01:00:00.000Z",
        query_ids: queryIds,
        frames,
        evidence_records: evidenceRecords.map((evidence) => {
          const evidenceId = evidence.evidence_id;
          const kind = evidence.kind;
          const evidencePath = path.join(
            evidenceDirectory,
            `${evidenceId}${kind === "source-capture" ? ".png" : ".json"}`
          );
          fs.writeFileSync(evidencePath, evidence.bytes);
          return {
          evidence_id: evidenceId,
          kind,
          path: path.relative(path.dirname(space.exportPath), evidencePath),
          digest: hashArtifact(evidencePath),
          frame_ids: frames.map((frame) => frame.frame_id),
          subject_bindings: [{
            subject_kind: "screen",
            subject_record_id: item.id
          }, {
            subject_kind: "product",
            subject_record_id: productRecordId
          }]
        };
        }),
        popularity_records: popularityRecords
      };
    })
  };
}

function refreshManualExport(space, settings = {}) {
  if (space.brief.source.access_mode !== "manual-export") return;
  writeJson(space.exportPath, manualExportFor(space, settings));
  space.brief.source.exports[0].digest = hashArtifact(space.exportPath);
  writeJson(space.briefPath, space.brief);
}

function writeJson(target, value) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
}

function writeResealedState(target, state) {
  const { state_digest: _digest, ...body } = state;
  state.state_digest = canonicalDigest(body);
  writeJson(target, state);
}

function rebindFile(target, rootDirectory) {
  return snapshotArtifact(target, { root: rootDirectory });
}

function rewritePackAndResealState(space, mutate) {
  const state = JSON.parse(fs.readFileSync(space.statePath, "utf8"));
  const packPath = state.outputs.reference_pack.resolved_path;
  const pack = JSON.parse(fs.readFileSync(packPath, "utf8"));
  mutate(pack);
  const { pack_digest: _packDigest, ...packBody } = pack;
  pack.pack_digest = canonicalDigest(packBody);
  writeJson(packPath, pack);
  state.outputs.reference_pack = rebindFile(packPath, state.state_directory);
  writeResealedState(space.statePath, state);
}

function rewriteExecutionAuthorityAndResealState(space, mutate) {
  const state = JSON.parse(fs.readFileSync(space.statePath, "utf8"));
  const attempt = state.attempts.find((item) => item.execution_status === "ran");
  assert.ok(attempt?.execution_authority && attempt.execution_authority_source);
  const authority = structuredClone(attempt.execution_authority);
  mutate(authority);
  const { authority_digest: _authorityDigest, ...authorityBody } = authority;
  authority.authority_digest = canonicalDigest(authorityBody);
  writeJson(attempt.execution_authority_source.resolved_path, authority);
  attempt.execution_authority = authority;
  attempt.execution_authority_source = rebindFile(
    attempt.execution_authority_source.resolved_path,
    state.state_directory
  );
  writeResealedState(space.statePath, state);
}

function pngCrc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const name = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(pngCrc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function blankCaptureBytes() {
  const width = 64;
  const height = 64;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const rows = Buffer.alloc((width * 4 + 1) * height);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", zlib.deflateSync(rows)),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

function workspace() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-reference-"));
  const evidence = path.join(directory, "evidence");
  fs.mkdirSync(evidence, { recursive: true });
  const ownerPath = path.join(evidence, "owner.md");
  const rightsPath = path.join(evidence, "rights.md");
  const planningPath = path.join(evidence, "planning.json");
  const exportPath = path.join(evidence, "ui-bowl-export.json");
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
      target_id: "regional-results",
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
      exports: [{
        id: "uibowl-export",
        kind: "uibowl-manual-export",
        path: "evidence/ui-bowl-export.json",
        digest: `sha256:${"0".repeat(64)}`
      }],
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
      ],
      sampling_policy: {
        minimum_distinct_products: 3,
        minimum_distinct_product_categories: 2,
        maximum_references_per_product: 1,
        maximum_references_per_ecosystem: 1,
        minimum_strong_hierarchy_references: 2,
        minimum_multi_state_families: 2,
        minimum_references_per_target_locale: 1,
        maximum_promotional_reference_ratio: 0.2,
        required_cohorts: ["task-fit", "cross-domain", "competent-baseline"],
        promotional_capture_policy: "weak-evidence-only"
      }
    },
    popularity_prior: {
      role: "within-fit-band-ranking-only",
      primary_sort: "product-fit-band",
      signals: [{
        id: "popular",
        metric: "curation-popularity",
        subject_kind: "screen",
        weight: 1,
        scope: "UI Bowl released-product collection",
        category: "all-released-products",
        normalization: {
          formula: "linear-bounds-v1",
          lower_bound: 0,
          upper_bound: 100,
          direction: "higher-is-better"
        }
      }],
      cannot_affect: ["eligibility", "hard-gates", "owner-approval"]
    },
    providers: {
      discovery: "reference-researcher",
      grammar_extractor: "reference-grammar-analyst",
      critic: "reference-independent-critic"
    }
  };
  const briefPath = path.join(directory, "reference-brief.json");
  const space = {
    directory,
    evidence,
    ownerPath,
    rightsPath,
    planningPath,
    exportPath,
    brief,
    briefPath,
    statePath: path.join(directory, ".killsloprouter", "reference-run.json")
  };
  refreshManualExport(space);
  return space;
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
  if (!fs.existsSync(space.statePath)) {
    refreshManualExport(space, settings.discovery || {});
  }
  const manifestPath = path.join(space.directory, `host-${Math.random().toString(16).slice(2)}.json`);
  const manifest = {
    host_adapter_version: 1,
    allowed_providers: [
      "reference-researcher", "reference-grammar-analyst", "reference-independent-critic"
    ],
    granted_permissions: ["artifact:read", "evidence:write", "network:external"],
    providers: {
      "reference-researcher": provider(capabilities.discovery, 3,
        ["artifact:read", "evidence:write"], settings.discovery, timeoutMs),
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

function writeDesignBriefFromReferenceState(space, state) {
  const designBrief = JSON.parse(fs.readFileSync(
    path.join(root, "examples", "design-brief.example.json"), "utf8"
  ));
  designBrief.project_id = space.brief.project_id;
  designBrief.surface = space.brief.surface;
  designBrief.screen_id = space.brief.planning.target_id;
  designBrief.locales = [...space.brief.locales];
  designBrief.product = {
    ...structuredClone(space.brief.planning.product_frame),
    density: "high"
  };
  designBrief.evidence.required_states = [
    ...space.brief.planning.product_frame.required_states
  ];
  designBrief.reference_pack = {
    path: state.outputs.reference_pack.resolved_path,
    digest: state.outputs.reference_pack.digest,
    producer_state: {
      path: space.statePath,
      digest: hashArtifact(space.statePath)
    },
    reviewer_source_access: {
      reviewer_source_access_version: 1,
      mode: "digest-bound-internal-critic",
      purposes: [
        "promotional-citation-firewall",
        "source-composition-independence"
      ],
      allowed_evidence_kinds: ["source-capture"],
      redistribution: false,
      creator_access: false,
      browser_provider_access: false,
      external_network: false
    }
  };
  const briefPath = path.join(
    space.directory, `design-brief-from-reference-${Math.random().toString(16).slice(2)}.json`
  );
  const baseline = path.join(
    space.directory, `design-baseline-${Math.random().toString(16).slice(2)}`
  );
  fs.mkdirSync(baseline);
  fs.writeFileSync(path.join(baseline, "index.html"), "<main>baseline</main>\n");
  writeJson(briefPath, designBrief);
  return { briefPath, baseline };
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
    space.brief.source.exports = [];
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

test("manual exports forbid network-enabled discovery before child spawn", () => {
  const space = workspace();
  try {
    const configured = host(space, {}, (manifest) => {
      manifest.providers["reference-researcher"].permissions.push("network:external");
    });
    const state = startReferenceIntelligence({
      statePath: space.statePath,
      briefPath: space.briefPath,
      hostManifest: configured.manifest,
      root: space.directory
    });
    assert.equal(state.status, "manual_pending");
    assert.equal(state.phase, "reference-discovery");
    assert.equal(state.results.length, 0);
    assert.equal(state.attempts.length, 1);
    assert.equal(state.attempts[0].execution_status, "manual_pending");
    assert.equal(state.attempts[0].child_pid, undefined);
    assert.equal(state.attempts[0].execution_authority, undefined);
    assert.equal(state.attempts[0].execution_authority_source, undefined);
    assert.match(state.attempts[0].reason, /permissions forbidden.*network:external/);
  } finally {
    fs.rmSync(space.directory, { recursive: true, force: true });
  }
});

test("reference start rejects an in-memory host declaration forgery before child intent", () => {
  const space = workspace();
  try {
    const configured = host(space);
    configured.manifest.providers["reference-researcher"].settings.in_memory_only = true;
    assert.throws(() => startReferenceIntelligence({
      statePath: space.statePath,
      briefPath: space.briefPath,
      hostManifest: configured.manifest,
      root: space.directory
    }), (error) => {
      assert.equal(error.exitCode, 4);
      assert.match(error.message,
        /host adapter manifest normalized authority was mutated in memory/);
      return true;
    });
    const state = JSON.parse(fs.readFileSync(space.statePath, "utf8"));
    assert.equal(state.in_flight, null);
    assert.deepEqual(state.attempts, []);
    assert.deepEqual(state.results, []);
  } finally {
    fs.rmSync(space.directory, { recursive: true, force: true });
  }
});

test("manual-only reference start records an empty source-recipient execution lineage", () => {
  const space = workspace();
  try {
    const state = startReferenceIntelligence({
      statePath: space.statePath,
      briefPath: space.briefPath,
      root: space.directory
    });
    assert.equal(state.status, "manual_pending");
    assert.equal(state.phase, "reference-discovery");
    assert.equal(state.results.length, 0);
    assert.equal(state.attempts.length, 1);
    assert.equal(state.attempts[0].execution_status, "manual_pending");
    assert.equal(state.attempts[0].adapter, null);
    assert.equal(state.attempts[0].child_pid, undefined);
    assert.equal(state.attempts[0].execution_authority, undefined);
    assert.equal(state.attempts[0].execution_authority_source, undefined);

    const persisted = readReferenceState(space.statePath);
    const lineage = referenceSourceRecipientExecutionLineage(persisted);
    assert.deepEqual(lineage.attempts, []);
    const { lineage_digest: _lineageDigest, ...lineageBody } = lineage;
    assert.equal(lineage.lineage_digest, canonicalDigest(lineageBody));
  } finally {
    fs.rmSync(space.directory, { recursive: true, force: true });
  }
});

test("authorized read-only source captures require complete non-blank decodable PNG evidence", () => {
  const invalidCaptures = [
    ["fake", Buffer.from("not-a-png"), /must be a complete PNG capture/],
    ["truncated", referenceCaptureBytes(0).subarray(0, referenceCaptureBytes(0).length - 10),
      /truncated PNG chunk|complete IHDR, IDAT, and IEND/],
    ["blank", blankCaptureBytes(), /cannot be a blank single-color capture/]
  ];
  for (const [label, replacement, message] of invalidCaptures) {
    const space = workspace();
    try {
      space.brief.source.access_mode = "authorized-read-only-adapter";
      space.brief.source.exports = [];
      writeJson(space.briefPath, space.brief);
      const configured = host(space, {}, (manifest) => {
        manifest.providers["reference-researcher"].permissions.push("network:external");
      });
      let replaced = false;
      const state = startReferenceIntelligence({
        statePath: space.statePath,
        briefPath: space.briefPath,
        hostManifest: configured.manifest,
        root: space.directory,
        faultInjector(point) {
          if (point !== "after-child-exit-before-authority-revalidation" || replaced) return;
          replaced = true;
          const output = path.join(
            `${space.statePath.slice(0, -path.extname(space.statePath).length)}.reference`,
            "evidence", "reference-discovery", "attempt-1"
          );
          const target = path.join(output,
            fs.readdirSync(output).find((entry) => entry.endsWith(".png")));
          fs.writeFileSync(target, replacement);
        }
      });
      assert.equal(replaced, true, label);
      assert.equal(state.status, "blocked", label);
      assert.equal(state.results.length, 0, label);
      assert.match(state.attempts.at(-1).error, message, label);
      assert.equal(state.in_flight, null, label);
    } finally {
      fs.rmSync(space.directory, { recursive: true, force: true });
    }
  }

  const valid = workspace();
  try {
    valid.brief.source.access_mode = "authorized-read-only-adapter";
    valid.brief.source.exports = [];
    writeJson(valid.briefPath, valid.brief);
    const configured = host(valid, {}, (manifest) => {
      manifest.providers["reference-researcher"].permissions.push("network:external");
    });
    let state = startReferenceIntelligence({
      statePath: valid.statePath,
      briefPath: valid.briefPath,
      hostManifest: configured.manifest,
      root: valid.directory
    });
    assert.equal(state.phase, "owner-reference-selection");
    assert.equal(state.results.length, 3);
    state = resumeReferenceIntelligence(valid.statePath, {
      hostManifest: configured.manifest,
      selectionPath: writeSelection(valid, state)
    });
    const pack = JSON.parse(fs.readFileSync(
      state.outputs.reference_pack.resolved_path,
      "utf8"
    ));
    assert.equal(
      pack.downstream_contract.reviewer_source_capture_readiness.status,
      "ready_at_compilation"
    );
    assert.deepEqual(
      pack.downstream_contract.reviewer_source_capture_readiness.uncovered_reference_ids,
      []
    );
  } finally {
    fs.rmSync(valid.directory, { recursive: true, force: true });
  }
});

test("reference child processes rank popularity only inside product-fit bands and compile a pixel-free pack", () => {
  const space = workspace();
  try {
    const configured = host(space, { discovery: { source_capture_first: true } });
    let state = startReferenceIntelligence({
      statePath: space.statePath,
      briefPath: space.briefPath,
      hostManifest: configured.manifest,
      root: space.directory
    });
    assert.equal(state.status, "manual_pending");
    assert.equal(state.phase, "owner-reference-selection");
    assert.equal(state.reasoning_registry.authority_scope,
      "non-authoritative-research-aid");
    assert.equal(state.reasoning_registry.source_pixels_included, false);
    assert.ok(state.reasoning_registry.lenses.length >= 12);
    assert.equal(state.reasoning_registry.design_checks.length, 11);
    assert.ok(state.packets.every((packet) =>
      packet.reference_task.human_design_reasoning.registry_digest ===
        state.reasoning_registry.registry_digest &&
      packet.reference_task.human_design_reasoning.design_checks.length === 11));
    assert.deepEqual(state.ranking.map((item) => item.reference_id), [
      "flowdesk-results", "marketline-proof", "proofgrid-offers", "megashop-ranking"
    ]);
    assert.equal(state.ranking.at(-1).popularity_score, 100,
      "a weaker product-fit band must not win through popularity");
    assert.equal(state.attempts.length, 3);
    assert.ok(state.attempts.every((item) => item.execution_status === "ran"));
    assert.ok(state.attempts.every((item) => Number.isInteger(item.child_pid) && item.child_pid > 0));
    assert.ok(state.attempts.every((item) =>
      item.execution_authority?.reference_execution_authority_version === 1 &&
      item.execution_authority_source?.digest &&
      item.execution_authority.provider.provider_id === item.provider_id &&
      item.execution_authority.provider.strength === item.strength &&
      item.execution_authority.host_manifest.digest === item.host_manifest_digest &&
      item.execution_authority.adapter_entrypoint.graph_digest));
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
    assert.equal(pack.downstream_contract.reasoning_registry_is_visual_authority, false);
    assert.equal(pack.downstream_contract.design_check_contracts.length, 11);
    assert.deepEqual(pack.downstream_contract.reviewer_source_capture_readiness, {
      status: "ready_at_compilation",
      capture_evidence_ids: [
        "source-flowdesk-results", "source-marketline-proof", "source-proofgrid-offers"
      ],
      uncovered_reference_ids: [],
      uncovered_observation_ids: [],
      revalidate_on_design_start: true
    });
    assert.deepEqual(
      pack.downstream_contract.design_check_contracts.map((item) => item.failure_code),
      pack.downstream_contract.required_design_checks.map((id) =>
        `reference-check-failed:${id}`)
    );
    assert.ok(pack.reasoning_lenses.length >= 12);
    assert.ok(pack.verified_hierarchy_reasoning.every((item) =>
      item.user_decision && item.likely_constraint && item.consequence_if_flattened));
    assert.ok(pack.verified_grammar.every((item) =>
      item.application_conditions.length > 0 && item.harmful_when.length > 0 &&
      item.tradeoff && typeof item.requires_live_data === "boolean"));
    assert.ok(pack.references.every((item) => item.product_fit &&
      item.product_fit.observed_ids.length > 0 &&
      ["exact", "adjacent", "weak"].includes(item.product_fit.band)));
    assert.equal(pack.provenance.reasoning_registry_digest,
      state.reasoning_registry.registry_digest);
    assert.equal(pack.evidence_manifest.some((item) =>
      item.kind === "source-capture" && item.reference_id &&
      item.product_record_id && item.screen_record_id && item.frame_ids.length > 0 &&
      item.subject_bindings.some((binding) => binding.subject_kind === "product") &&
      item.subject_bindings.some((binding) => binding.subject_kind === "screen")), true,
    "capture provenance may retain a digest/kind while pixel paths remain excluded");
    assert.doesNotMatch(JSON.stringify(pack),
      /\/evidence\/|\.png|data:image|base64|blob:/i);
    const { pack_digest: _digest, ...body } = pack;
    assert.equal(pack.pack_digest, canonicalDigest(body));
    assert.equal(readReferenceState(space.statePath).status, "complete");

    const designBrief = JSON.parse(fs.readFileSync(
      path.join(root, "examples", "design-brief.example.json"), "utf8"
    ));
    designBrief.project_id = space.brief.project_id;
    designBrief.surface = space.brief.surface;
    designBrief.screen_id = space.brief.planning.target_id;
    designBrief.locales = [...space.brief.locales];
    designBrief.product = {
      ...structuredClone(space.brief.planning.product_frame),
      density: "high"
    };
    designBrief.evidence.required_states = [
      ...space.brief.planning.product_frame.required_states
    ];
    designBrief.reference_pack = {
      path: state.outputs.reference_pack.resolved_path,
      digest: state.outputs.reference_pack.digest,
      producer_state: {
        path: space.statePath,
        digest: hashArtifact(space.statePath)
      },
      reviewer_source_access: {
        reviewer_source_access_version: 1,
        mode: "digest-bound-internal-critic",
        purposes: [
          "promotional-citation-firewall",
          "source-composition-independence"
        ],
        allowed_evidence_kinds: ["source-capture"],
        redistribution: false,
        creator_access: false,
        browser_provider_access: false,
        external_network: false
      }
    };
    const designBriefPath = path.join(space.directory, "design-brief-from-reference.json");
    const designBaseline = path.join(space.directory, "design-baseline");
    fs.mkdirSync(designBaseline);
    fs.writeFileSync(path.join(designBaseline, "index.html"), "<main>baseline</main>\n");
    writeJson(designBriefPath, designBrief);
    const designDryRun = dryRunDesignExploration({
      briefPath: designBriefPath,
      baselinePath: designBaseline,
      root: space.directory
    });
    assert.equal(designDryRun.reference_intelligence.pack_digest, pack.pack_digest);
    assert.equal(designDryRun.direction_matrix.length, 9);
  } finally {
    fs.rmSync(space.directory, { recursive: true, force: true });
  }
});

test("weighted popularity is reproducible across product and screen subjects", () => {
  const space = workspace();
  try {
    space.brief.popularity_prior.signals = [{
      id: "mau", metric: "mau", subject_kind: "product", weight: 0.75,
      scope: "UI Bowl released-product collection",
      category: "all-released-products",
      normalization: {
        formula: "linear-bounds-v1", lower_bound: 0, upper_bound: 100,
        direction: "higher-is-better"
      }
    }, {
      id: "bookmarks", metric: "bookmark-count", subject_kind: "screen", weight: 0.25,
      scope: "UI Bowl released-product collection",
      category: "all-released-products",
      normalization: {
        formula: "linear-bounds-v1", lower_bound: 0, upper_bound: 100,
        direction: "higher-is-better"
      }
    }];
    writeJson(space.briefPath, space.brief);
    const configured = host(space, {
      discovery: { metric_specific_popularity: true }
    });
    const state = startReferenceIntelligence({
      statePath: space.statePath,
      briefPath: space.briefPath,
      hostManifest: configured.manifest,
      root: space.directory
    });
    assert.equal(state.phase, "owner-reference-selection");
    const flowdesk = state.ranking.find((item) =>
      item.reference_id === "flowdesk-results");
    assert.equal(flowdesk.popularity_score, 73);
    assert.deepEqual(flowdesk.popularity_signals, ["mau", "bookmarks"]);
  } finally {
    fs.rmSync(space.directory, { recursive: true, force: true });
  }
});

test("independent critic self-review and insufficient verified coverage fail closed", () => {
  for (const variant of [
    "self-review", "coverage", "duplicate-grammar", "same-researcher-actor",
    "self-review-canonical", "same-researcher-actor-canonical", "overclaim-component"
  ]) {
    const space = workspace();
    try {
      const configured = host(space, {
        critic: variant === "self-review"
          ? { self_review: true }
          : variant === "self-review-canonical"
            ? { actor_id: " ＲＥＳＥＡＲＣＨＥＲ：ＧＲＡＭＭＡＲ－ＡＮＡＬＹＳＩＳ " }
          : variant === "coverage"
            ? { low_coverage: true }
            : variant === "overclaim-component" ? { overclaim_component: true } : {},
        grammar: variant === "duplicate-grammar"
          ? { duplicate_reference: true }
          : variant === "same-researcher-actor" ? { same_actor: true }
            : variant === "same-researcher-actor-canonical"
              ? { actor_id: " RESEARCHER:UIBOWL-DISCOVERY " } : {}
      });
      const state = startReferenceIntelligence({
        statePath: space.statePath,
        briefPath: space.briefPath,
        hostManifest: configured.manifest,
        root: space.directory
      });
      assert.equal(state.status, "blocked");
      if (["self-review", "self-review-canonical"].includes(variant)) {
        assert.ok(state.blockers.some((item) => item.includes("cannot review its own")));
      } else if (variant === "coverage") {
        assert.equal(state.phase, "reference-coverage");
        assert.ok(state.blockers.some((item) => item.includes("verified references 2/3")));
      } else if (variant === "duplicate-grammar") {
        assert.equal(state.phase, "reference-grammar");
        assert.ok(state.blockers.some((item) => item.includes("repeats reference")));
      } else if (["same-researcher-actor", "same-researcher-actor-canonical"].includes(variant)) {
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
      selection.owner_id = " CRITIC:REFERENCE-INDEPENDENT ";
    });
    assert.throws(() => resumeReferenceIntelligence(space.statePath, {
      hostManifest: configured.manifest,
      selectionPath: participant
    }), /participant cannot act as owner/);

    for (const ownerId of ["kill-slop-router", "reference-independent-critic"]) {
      const routedParticipant = writeSelection(space, state, (selection) => {
        selection.owner_id = ownerId;
      });
      assert.throws(() => resumeReferenceIntelligence(space.statePath, {
        hostManifest: configured.manifest,
        selectionPath: routedParticipant
      }), /participant cannot act as owner/, ownerId);
    }
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

test("resealed Owner selection pointer substitution fails closed while the Owner file remains unchanged", () => {
  const space = workspace();
  try {
    const configured = host(space);
    let state = startReferenceIntelligence({
      statePath: space.statePath,
      briefPath: space.briefPath,
      hostManifest: configured.manifest,
      root: space.directory
    });
    const ownerSelectionPath = writeSelection(space, state);
    const ownerSelectionDigest = hashArtifact(ownerSelectionPath);
    state = resumeReferenceIntelligence(space.statePath, {
      hostManifest: configured.manifest,
      selectionPath: ownerSelectionPath
    });
    assert.equal(state.status, "complete");
    const originalState = JSON.parse(fs.readFileSync(space.statePath, "utf8"));

    const forgedInsidePath = path.join(
      originalState.state_directory,
      "authority",
      "forged-owner-selection.json"
    );
    writeJson(forgedInsidePath, originalState.selection.normalized);
    const insideAttack = structuredClone(originalState);
    insideAttack.selection.source = rebindFile(
      forgedInsidePath,
      insideAttack.state_directory
    );
    writeResealedState(space.statePath, insideAttack);
    assert.throws(() => readReferenceState(space.statePath), (error) => {
      assert.equal(error.exitCode, 4);
      assert.match(error.message, /outside the child-writable state directory/);
      return true;
    });
    assert.throws(() => resumeReferenceIntelligence(space.statePath, {
      hostManifest: configured.manifest
    }), /outside the child-writable state directory/);

    writeJson(space.statePath, originalState);
    const forgedExternalPath = path.join(space.directory, "forged-owner-selection.json");
    const forgedSelection = structuredClone(originalState.selection.normalized);
    forgedSelection.owner_id = "kill-slop-router";
    writeJson(forgedExternalPath, forgedSelection);
    const externalAttack = structuredClone(originalState);
    externalAttack.selection.source = rebindFile(
      forgedExternalPath,
      externalAttack.state_directory
    );
    externalAttack.selection.normalized = forgedSelection;
    externalAttack.selection.selection_digest = canonicalDigest(forgedSelection);
    writeResealedState(space.statePath, externalAttack);
    assert.throws(() => readReferenceState(space.statePath),
      /participant cannot act as owner/);
    assert.throws(() => resumeReferenceIntelligence(space.statePath, {
      hostManifest: configured.manifest
    }), /participant cannot act as owner/);

    assert.equal(hashArtifact(ownerSelectionPath), ownerSelectionDigest);
    assert.equal(originalState.in_flight, null);
    assert.equal(externalAttack.attempts.length, originalState.attempts.length);
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

test("resealed state_directory redirect is rejected before read or resume child intent", () => {
  const space = workspace();
  try {
    const state = startReferenceIntelligence({
      statePath: space.statePath,
      briefPath: space.briefPath,
      root: space.directory
    });
    assert.equal(state.status, "manual_pending");
    assert.equal(state.in_flight, null);
    const attemptCount = state.attempts.length;
    const briefDigest = hashArtifact(space.briefPath);
    const selectionPath = path.join(space.directory, "external-selection.json");
    writeJson(selectionPath, { sentinel: "must-remain-unchanged" });
    const selectionDigest = hashArtifact(selectionPath);
    const redirected = path.join(space.directory, "redirected-reference-state");
    fs.mkdirSync(redirected);

    const resealed = JSON.parse(fs.readFileSync(space.statePath, "utf8"));
    resealed.state_directory = redirected;
    writeResealedState(space.statePath, resealed);
    const expectedError = (error) => {
      assert.equal(error.exitCode, 4);
      assert.match(error.message,
        /state_directory does not match the directory derived from recorded state_path/);
      return true;
    };
    assert.throws(() => readReferenceState(space.statePath), expectedError);

    const configured = host(space);
    assert.throws(() => resumeReferenceIntelligence(space.statePath, {
      hostManifest: configured.manifest,
      selectionPath
    }), expectedError);

    const unchanged = JSON.parse(fs.readFileSync(space.statePath, "utf8"));
    assert.equal(unchanged.state_directory, redirected);
    assert.equal(unchanged.in_flight, null);
    assert.equal(unchanged.attempts.length, attemptCount);
    assert.equal(hashArtifact(space.briefPath), briefDigest);
    assert.equal(hashArtifact(selectionPath), selectionDigest);
    assert.deepEqual(fs.readdirSync(redirected), []);
  } finally {
    fs.rmSync(space.directory, { recursive: true, force: true });
  }
});

test("resealed brief and authority pointer substitution conflicts with immutable packet sidecars", () => {
  const space = workspace();
  try {
    const state = startReferenceIntelligence({
      statePath: space.statePath,
      briefPath: space.briefPath,
      root: space.directory
    });
    assert.equal(state.status, "manual_pending");
    const originalBriefDigest = hashArtifact(space.briefPath);
    const packetPath = state.packet_files["reference-discovery"].resolved_path;
    const originalPacketDigest = hashArtifact(packetPath);
    const alternateDirectory = path.join(space.directory, "alternate-authority");
    fs.mkdirSync(alternateDirectory);
    const alternateOwner = path.join(alternateDirectory, "owner.md");
    const alternateRights = path.join(alternateDirectory, "rights.md");
    const alternatePlanning = path.join(alternateDirectory, "planning.json");
    fs.copyFileSync(space.ownerPath, alternateOwner);
    fs.copyFileSync(space.rightsPath, alternateRights);
    fs.copyFileSync(space.planningPath, alternatePlanning);

    const resealed = JSON.parse(fs.readFileSync(space.statePath, "utf8"));
    const alternateBrief = structuredClone(resealed.brief);
    alternateBrief.locales = ["en-US"];
    alternateBrief.activation.evidence.path = path.relative(
      space.directory,
      alternateOwner
    );
    alternateBrief.activation.evidence.digest = hashArtifact(alternateOwner);
    alternateBrief.planning.sources[0].path = path.relative(
      space.directory,
      alternatePlanning
    );
    alternateBrief.planning.sources[0].digest = hashArtifact(alternatePlanning);
    alternateBrief.source.rights.evidence.path = path.relative(
      space.directory,
      alternateRights
    );
    alternateBrief.source.rights.evidence.digest = hashArtifact(alternateRights);
    alternateBrief.source.access_mode = "authorized-read-only-adapter";
    alternateBrief.source.exports = [];
    const alternateBriefPath = path.join(alternateDirectory, "reference-brief.json");
    writeJson(alternateBriefPath, alternateBrief);

    resealed.brief = alternateBrief;
    resealed.brief_source = rebindFile(alternateBriefPath, space.directory);
    resealed.authority_sources.activation = rebindFile(
      alternateOwner,
      space.directory
    );
    resealed.authority_sources.rights = rebindFile(
      alternateRights,
      space.directory
    );
    resealed.authority_sources.planning = [{
      id: "service-plan",
      ...rebindFile(alternatePlanning, space.directory)
    }];
    resealed.authority_sources.exports = [];
    resealed.authority_sources.export_evidence = [];
    writeResealedState(space.statePath, resealed);

    const expectedError = (error) => {
      assert.equal(error.exitCode, 4);
      assert.match(error.message,
        /reference packet reference-discovery conflicts with its immutable brief authority/);
      return true;
    };
    assert.throws(() => readReferenceState(space.statePath), expectedError);
    const configured = host(space);
    assert.throws(() => resumeReferenceIntelligence(space.statePath, {
      hostManifest: configured.manifest
    }), expectedError);

    const unchanged = JSON.parse(fs.readFileSync(space.statePath, "utf8"));
    assert.equal(unchanged.in_flight, null);
    assert.equal(unchanged.attempts.length, state.attempts.length);
    assert.equal(hashArtifact(space.briefPath), originalBriefDigest);
    assert.equal(hashArtifact(packetPath), originalPacketDigest);
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

test("resealed cached packet cannot diverge from its digest-bound sidecar", () => {
  const space = workspace();
  try {
    startReferenceIntelligence({
      statePath: space.statePath,
      briefPath: space.briefPath,
      root: space.directory
    });
    const state = JSON.parse(fs.readFileSync(space.statePath, "utf8"));
    state.packets[0].reference_task.rule = "attacker-resealed cached packet";
    const { packet_digest: _packetDigest, ...packetBody } = state.packets[0];
    state.packets[0].packet_digest = canonicalDigest(packetBody);
    writeResealedState(space.statePath, state);
    assert.throws(() => readReferenceState(space.statePath),
      /cached state conflicts with its sidecar/);
  } finally {
    fs.rmSync(space.directory, { recursive: true, force: true });
  }
});

test("resealed result, evidence, participant, provider, and attempt lineage tamper fails closed", () => {
  const variants = [
    ["result provider", (state) => { state.results[0].provider_id = "other-provider"; },
      /result execution lineage conflicts/],
    ["result participant", (state) => { state.results[0].participant.role = "critic"; },
      /result execution lineage conflicts/],
    ["evidence", (state) => { state.results[0].evidence[0].digest = `sha256:${"0".repeat(64)}`; },
      /result evidence state binding mismatch/],
    ["attempt provider", (state) => { state.attempts[0].provider_id = "other-provider"; },
      /attempt execution lineage conflicts/],
    ["attempt participant", (state) => { state.attempts[0].participant.role = "critic"; },
      /attempt execution lineage conflicts/],
    ["attempt sequence", (state) => { state.attempts[0].attempt = 2; },
      /attempt sequence is invalid/],
    ["attempt result", (state) => { state.attempts[0].result_digest = `sha256:${"1".repeat(64)}`; },
      /attempt result lineage conflicts/]
  ];
  for (const [label, mutate, message] of variants) {
    const space = workspace();
    try {
      const configured = host(space);
      const produced = startReferenceIntelligence({
        statePath: space.statePath,
        briefPath: space.briefPath,
        hostManifest: configured.manifest,
        root: space.directory
      });
      assert.equal(produced.results.length, 3, label);
      const state = JSON.parse(fs.readFileSync(space.statePath, "utf8"));
      mutate(state);
      writeResealedState(space.statePath, state);
      assert.throws(() => readReferenceState(space.statePath), message, label);
    } finally {
      fs.rmSync(space.directory, { recursive: true, force: true });
    }
  }
});

test("resealed reference pack cannot diverge from the exact Owner selection, roles, or grammar order", () => {
  const variants = [
    ["selection digest", (pack) => {
      pack.selection.selection_digest = `sha256:${"0".repeat(64)}`;
    }, /pack selection conflicts with the persisted Owner selection/],
    ["anchor and role", (pack) => {
      const previousAnchor = pack.selection.anchor_reference_id;
      const nextAnchor = pack.selection.supporting_reference_ids[0];
      pack.selection.anchor_reference_id = nextAnchor;
      pack.selection.supporting_reference_ids[0] = previousAnchor;
      for (const reference of pack.references) {
        reference.role = reference.reference_id === nextAnchor ? "anchor" : "support";
      }
    }, /pack selection conflicts with the persisted Owner selection/],
    ["reference order", (pack) => {
      [pack.references[1], pack.references[2]] = [pack.references[2], pack.references[1]];
    }, /reference order or roles conflict with the persisted Owner selection/],
    ["grammar order", (pack) => {
      pack.verified_grammar.reverse();
    }, /grammar IDs conflict with the persisted Owner selection/]
  ];
  for (const [label, mutate, message] of variants) {
    const space = workspace();
    try {
      const configured = host(space);
      let state = startReferenceIntelligence({
        statePath: space.statePath,
        briefPath: space.briefPath,
        hostManifest: configured.manifest,
        root: space.directory
      });
      state = resumeReferenceIntelligence(space.statePath, {
        hostManifest: configured.manifest,
        selectionPath: writeSelection(space, state)
      });
      assert.equal(state.status, "complete", label);
      rewritePackAndResealState(space, mutate);
      assert.throws(() => readReferenceState(space.statePath), message, label);
    } finally {
      fs.rmSync(space.directory, { recursive: true, force: true });
    }
  }
});

test("resealed execution authority mutations fail closed against the immutable host declaration", () => {
  const variants = [
    ["strength", (authority) => { authority.provider.strength = 4; },
      /execution authority conflicts with its host manifest/],
    ["capabilities", (authority) => { authority.provider.capabilities.push("invented-capability"); },
      /execution authority conflicts with its host manifest/],
    ["permissions", (authority) => { authority.provider.permissions.push("network:external"); },
      /execution authority conflicts with its host manifest/],
    ["provider declaration", (authority) => {
      authority.provider.declaration_digest = `sha256:${"1".repeat(64)}`;
    }, /execution authority conflicts with its host manifest/],
    ["host content", (authority) => {
      authority.host_manifest.digest = `sha256:${"2".repeat(64)}`;
    }, /host manifest changed after it was digest-bound/],
    ["host physical identity", (authority) => {
      authority.host_manifest.physical_identity_digest = `sha256:${"3".repeat(64)}`;
    }, /host manifest changed after it was digest-bound/],
    ["entrypoint content", (authority) => {
      authority.adapter_entrypoint.digest = `sha256:${"4".repeat(64)}`;
    }, /adapter entrypoint changed after it was digest-bound/],
    ["entrypoint physical identity", (authority) => {
      authority.adapter_entrypoint.physical_identity_digest = `sha256:${"5".repeat(64)}`;
    }, /adapter entrypoint changed after it was digest-bound/],
    ["entrypoint graph", (authority) => {
      authority.adapter_entrypoint.graph_digest = `sha256:${"6".repeat(64)}`;
    }, /adapter entrypoint conflicts with its host manifest/]
  ];
  for (const [label, mutate, message] of variants) {
    const space = workspace();
    try {
      const configured = host(space);
      const state = startReferenceIntelligence({
        statePath: space.statePath,
        briefPath: space.briefPath,
        hostManifest: configured.manifest,
        root: space.directory
      });
      assert.equal(state.attempts.filter((item) => item.execution_status === "ran").length, 3,
        label);
      rewriteExecutionAuthorityAndResealState(space, mutate);
      assert.throws(() => readReferenceState(space.statePath), message, label);
      assert.throws(() => resumeReferenceIntelligence(space.statePath, {
        hostManifest: configured.manifest
      }), message, `${label} resume`);
    } finally {
      fs.rmSync(space.directory, { recursive: true, force: true });
    }
  }
});

test("source-recipient execution lineage retains a failed child and its successful retry", () => {
  const space = workspace();
  try {
    const invalidHost = host(space, {
      discovery: { misbind_first_evidence: true }
    });
    let state = startReferenceIntelligence({
      statePath: space.statePath,
      briefPath: space.briefPath,
      hostManifest: invalidHost.manifest,
      root: space.directory
    });
    assert.equal(state.status, "blocked");
    assert.equal(state.attempts.length, 1);
    assert.equal(state.attempts[0].execution_status, "blocked_result_validation");

    const validHost = host(space);
    state = resumeReferenceIntelligence(space.statePath, {
      hostManifest: validHost.manifest,
      retry: "reference-discovery"
    });
    assert.equal(state.phase, "owner-reference-selection");
    state = resumeReferenceIntelligence(space.statePath, {
      hostManifest: validHost.manifest,
      selectionPath: writeSelection(space, state)
    });
    assert.equal(state.status, "complete");

    const verifiedState = readReferenceState(space.statePath);
    const lineage = referenceSourceRecipientExecutionLineage(verifiedState);
    const discoveryAttempts = lineage.attempts.filter((item) =>
      item.packet_id === "reference-discovery");
    assert.deepEqual(discoveryAttempts.map((item) => [
      item.attempt,
      item.execution_status
    ]), [
      [1, "blocked_result_validation"],
      [2, "ran"]
    ]);
    assert.ok(discoveryAttempts.every((item) =>
      item.provider_id === "reference-researcher" &&
      item.adapter === "agent-json-v1" &&
      /^sha256:[a-f0-9]{64}$/.test(item.authority_digest) &&
      /^sha256:[a-f0-9]{64}$/.test(item.provider_declaration_digest) &&
      /^sha256:[a-f0-9]{64}$/.test(item.adapter_entrypoint?.digest || "") &&
      /^sha256:[a-f0-9]{64}$/.test(
        item.adapter_entrypoint?.physical_identity_digest || ""
      ) &&
      /^sha256:[a-f0-9]{64}$/.test(item.adapter_entrypoint?.graph_digest || "")));
    assert.equal(discoveryAttempts[0].adapter_entrypoint.digest,
      discoveryAttempts[1].adapter_entrypoint.digest);
    assert.equal(discoveryAttempts[0].adapter_entrypoint.physical_identity_digest,
      discoveryAttempts[1].adapter_entrypoint.physical_identity_digest);
    assert.equal(discoveryAttempts[0].adapter_entrypoint.graph_digest,
      discoveryAttempts[1].adapter_entrypoint.graph_digest);
    assert.notEqual(discoveryAttempts[0].provider_declaration_digest,
      discoveryAttempts[1].provider_declaration_digest);
    assert.notEqual(discoveryAttempts[0].authority_digest,
      discoveryAttempts[1].authority_digest);
    const { lineage_digest: _lineageDigest, ...lineageBody } = lineage;
    assert.equal(lineage.lineage_digest, canonicalDigest(lineageBody));

    const resealed = JSON.parse(fs.readFileSync(space.statePath, "utf8"));
    const failedAttempt = resealed.attempts.find((item) =>
      item.packet_id === "reference-discovery" && item.attempt === 1);
    const authorityPath = failedAttempt.execution_authority_source.resolved_path;
    const authority = JSON.parse(fs.readFileSync(authorityPath, "utf8"));
    authority.provider.declaration_digest = `sha256:${"a".repeat(64)}`;
    const { authority_digest: _authorityDigest, ...authorityBody } = authority;
    authority.authority_digest = canonicalDigest(authorityBody);
    writeJson(authorityPath, authority);
    failedAttempt.execution_authority = authority;
    failedAttempt.execution_authority_source = rebindFile(
      authorityPath,
      resealed.state_directory
    );
    writeResealedState(space.statePath, resealed);
    assert.throws(() => referenceSourceRecipientExecutionLineage(resealed),
      /execution authority conflicts with its host manifest/);
    assert.throws(() => readReferenceState(space.statePath),
      /execution authority conflicts with its host manifest/);
  } finally {
    fs.rmSync(space.directory, { recursive: true, force: true });
  }
});

test("resealed attempt strength, capabilities, permissions, host, and entrypoint cannot drift", () => {
  const space = workspace();
  try {
    const configured = host(space);
    startReferenceIntelligence({
      statePath: space.statePath,
      briefPath: space.briefPath,
      hostManifest: configured.manifest,
      root: space.directory
    });
    const original = JSON.parse(fs.readFileSync(space.statePath, "utf8"));
    const variants = [
      ["strength", (attempt) => { attempt.strength = 4; }],
      ["capabilities", (attempt) => { attempt.capabilities.push("invented-capability"); }],
      ["permissions", (attempt) => { attempt.permission_scopes.push("network:external"); }],
      ["host", (attempt) => {
        attempt.host_manifest_digest = `sha256:${"7".repeat(64)}`;
      }],
      ["entrypoint content", (attempt) => {
        attempt.adapter_entrypoint.digest = `sha256:${"8".repeat(64)}`;
      }],
      ["entrypoint physical identity", (attempt) => {
        attempt.adapter_entrypoint.physical_identity_digest = `sha256:${"9".repeat(64)}`;
      }]
    ];
    for (const [label, mutate] of variants) {
      const state = structuredClone(original);
      mutate(state.attempts.find((item) => item.execution_status === "ran"));
      writeResealedState(space.statePath, state);
      assert.throws(() => readReferenceState(space.statePath),
        /execution fields conflict with immutable authority/, label);
    }
  } finally {
    fs.rmSync(space.directory, { recursive: true, force: true });
  }
});

test("execution authority sidecar tamper and authority stripping fail closed", () => {
  for (const variant of ["sidecar", "stripped"]) {
    const space = workspace();
    try {
      const configured = host(space);
      startReferenceIntelligence({
        statePath: space.statePath,
        briefPath: space.briefPath,
        hostManifest: configured.manifest,
        root: space.directory
      });
      const state = JSON.parse(fs.readFileSync(space.statePath, "utf8"));
      const attempt = state.attempts.find((item) => item.execution_status === "ran");
      if (variant === "sidecar") {
        fs.appendFileSync(attempt.execution_authority_source.resolved_path, "\n");
        assert.throws(() => readReferenceState(space.statePath),
          /execution authority source changed after it was digest-bound/);
      } else {
        delete attempt.execution_authority;
        delete attempt.execution_authority_source;
        writeResealedState(space.statePath, state);
        assert.throws(() => readReferenceState(space.statePath),
          /executed attempt lacks immutable execution authority/);
      }
    } finally {
      fs.rmSync(space.directory, { recursive: true, force: true });
    }
  }
});

test("bound human-design reasoning registry rejects content and inode replacement", () => {
  for (const replaceWithSameBytes of [false, true]) {
    const space = workspace();
    try {
      const state = startReferenceIntelligence({
        statePath: space.statePath,
        briefPath: space.briefPath,
        root: space.directory
      });
      const target = state.reasoning_registry.source.resolved_path;
      const original = fs.readFileSync(target);
      if (replaceWithSameBytes) {
        fs.renameSync(target, `${target}.old`);
        fs.writeFileSync(target, original);
      } else {
        const changed = JSON.parse(original.toString("utf8"));
        changed.lenses[0].question = "Tampered question";
        writeJson(target, changed);
      }
      assert.throws(() => readReferenceState(space.statePath),
        /reasoning registry.*changed|reasoning registry physical identity changed/);
    } finally {
      fs.rmSync(space.directory, { recursive: true, force: true });
    }
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
    assert.equal(dispatch.request_count, 1);
    assert.ok(fs.existsSync(path.join(output, "reference-discovery.json")));
    const requestPath = path.join(output, "reference-discovery.request.json");
    assert.ok(fs.existsSync(requestPath));
    const request = JSON.parse(fs.readFileSync(requestPath, "utf8"));
    const { request_digest: requestDigest, ...requestBody } = request;
    assert.equal(requestDigest, canonicalDigest(requestBody));
    assert.equal(dispatch.request_digests["reference-discovery"], requestDigest);
    assert.deepEqual(request.packet, state.packets[0]);
    assert.deepEqual(request.prior_results, []);
    assert.equal(request.authority_artifacts.source_evidence_descriptors_included, true);
    assert.equal(
      request.authority_artifacts.source_pixels_available_to_reference_participants,
      true
    );
    assert.equal(
      request.authority_artifacts.source_pixels_exposed_to_downstream_creator,
      false
    );
    assert.ok(request.authority_artifacts.source_export_evidence.some((item) =>
      item.evidence_kind === "source-capture" && item.file.path.endsWith(".png")));
    assert.equal(Object.hasOwn(request.authority_artifacts.brief, "resolved_path"), false);
    assert.equal(fs.statSync(requestPath).mode & 0o777, 0o600);
    assert.equal(readReferenceState(space.statePath).state_digest, state.state_digest);
  } finally {
    fs.rmSync(space.directory, { recursive: true, force: true });
  }
});

test("accepted manual results remain manual-only and cannot be resealed as executed", () => {
  const producer = workspace();
  const consumer = workspace();
  try {
    const configured = host(producer);
    const produced = startReferenceIntelligence({
      statePath: producer.statePath,
      briefPath: producer.briefPath,
      hostManifest: configured.manifest,
      root: producer.directory
    });
    let state = startReferenceIntelligence({
      statePath: consumer.statePath,
      briefPath: consumer.briefPath,
      root: consumer.directory
    });
    const packet = state.packets.find((item) => item.packet_id === "reference-discovery");
    const result = structuredClone(produced.results.find((item) =>
      item.packet_id === "reference-discovery").normalized);
    result.packet_digest = packet.packet_digest;
    const resultPath = path.join(
      path.dirname(produced.results.find((item) =>
        item.packet_id === "reference-discovery").source.resolved_path),
      "manual-discovery-for-consumer.json"
    );
    writeJson(resultPath, result);
    state = resumeReferenceIntelligence(consumer.statePath, {
      resultPaths: [resultPath]
    });
    const recorded = state.attempts.find((item) =>
      item.execution_status === "manual_recorded");
    assert.ok(recorded);
    assert.equal(recorded.adapter, "manual-v1");
    assert.equal(recorded.execution_authority, undefined);
    assert.equal(recorded.execution_authority_source, undefined);
    assert.equal(state.phase, "reference-grammar");

    const persisted = JSON.parse(fs.readFileSync(consumer.statePath, "utf8"));
    const persistedManual = persisted.attempts.find((item) =>
      item.execution_status === "manual_recorded");
    persistedManual.execution_authority = structuredClone(
      produced.attempts[0].execution_authority
    );
    persistedManual.execution_authority_source = structuredClone(
      produced.attempts[0].execution_authority_source
    );
    writeResealedState(consumer.statePath, persisted);
    assert.throws(() => readReferenceState(consumer.statePath),
      /manual attempt cannot claim execution authority/);
  } finally {
    fs.rmSync(producer.directory, { recursive: true, force: true });
    fs.rmSync(consumer.directory, { recursive: true, force: true });
  }
});

test("metadata-only research completes with exact downstream reviewer capture blockers", () => {
  const producer = workspace();
  const consumer = workspace();
  try {
    const producerHost = host(producer);
    const produced = startReferenceIntelligence({
      statePath: producer.statePath,
      briefPath: producer.briefPath,
      hostManifest: producerHost.manifest,
      root: producer.directory
    });

    const metadataOnlyExport = manualExportFor(consumer);
    for (const record of metadataOnlyExport.records) {
      record.evidence_records = record.evidence_records.filter((item) =>
        item.kind === "source-metadata");
    }
    writeJson(consumer.exportPath, metadataOnlyExport);
    consumer.brief.source.exports[0].digest = hashArtifact(consumer.exportPath);
    writeJson(consumer.briefPath, consumer.brief);

    let state = startReferenceIntelligence({
      statePath: consumer.statePath,
      briefPath: consumer.briefPath,
      root: consumer.directory
    });
    const discovery = structuredClone(produced.results.find((item) =>
      item.packet_id === "reference-discovery").normalized);
    discovery.packet_digest = state.packets.find((item) =>
      item.packet_id === "reference-discovery").packet_digest;
    discovery.evidence = discovery.evidence.filter((item) =>
      item.kind === "source-metadata");
    for (const reference of discovery.references) {
      for (const observation of reference.observed) {
        observation.evidence_ids = [`metadata-${reference.reference_id}`];
      }
    }
    const resultPath = path.join(
      path.dirname(produced.results.find((item) =>
        item.packet_id === "reference-discovery").source.resolved_path),
      "metadata-only-discovery.json"
    );
    writeJson(resultPath, discovery);
    state = resumeReferenceIntelligence(consumer.statePath, {
      resultPaths: [resultPath]
    });
    assert.equal(state.phase, "reference-grammar");

    const consumerHost = host(consumer);
    state = resumeReferenceIntelligence(consumer.statePath, {
      hostManifest: consumerHost.manifest
    });
    assert.equal(state.phase, "owner-reference-selection");
    state = resumeReferenceIntelligence(consumer.statePath, {
      hostManifest: consumerHost.manifest,
      selectionPath: writeSelection(consumer, state)
    });
    assert.equal(state.status, "complete");
    const pack = JSON.parse(fs.readFileSync(
      state.outputs.reference_pack.resolved_path,
      "utf8"
    ));
    const selectedIds = [
      pack.selection.anchor_reference_id,
      ...pack.selection.supporting_reference_ids
    ].sort((left, right) => left.localeCompare(right, "en"));
    assert.deepEqual(pack.downstream_contract.reviewer_source_capture_readiness, {
      status: "manual_pending",
      capture_evidence_ids: [],
      uncovered_reference_ids: selectedIds,
      uncovered_observation_ids: selectedIds.map((id) => `obs-${id}`).sort((left, right) =>
        left.localeCompare(right, "en")),
      revalidate_on_design_start: true
    });
    assert.equal(validateReferencePack(pack), pack);
  } finally {
    fs.rmSync(producer.directory, { recursive: true, force: true });
    fs.rmSync(consumer.directory, { recursive: true, force: true });
  }
});

test("reviewer capture readiness reports partial reference and observation frame coverage and rejects false-ready tamper", () => {
  const space = workspace();
  try {
    const configured = host(space);
    let state = startReferenceIntelligence({
      statePath: space.statePath,
      briefPath: space.briefPath,
      hostManifest: configured.manifest,
      root: space.directory
    });
    assert.equal(state.phase, "owner-reference-selection");
    state = resumeReferenceIntelligence(space.statePath, {
      hostManifest: configured.manifest,
      selectionPath: writeSelection(space, state)
    });
    assert.equal(state.status, "complete");

    const completePack = JSON.parse(fs.readFileSync(
      state.outputs.reference_pack.resolved_path,
      "utf8"
    ));
    const partial = structuredClone(completePack);
    const anchorId = partial.selection.anchor_reference_id;
    const uncoveredReferenceId = partial.selection.supporting_reference_ids[0];
    const retainedReferenceId = partial.selection.supporting_reference_ids[1];
    const anchorCaptureId = `source-${anchorId}`;
    const uncoveredCaptureId = `source-${uncoveredReferenceId}`;
    const retainedCaptureId = `source-${retainedReferenceId}`;
    const anchorMetadataId = `metadata-${anchorId}`;
    const uncoveredMetadataId = `metadata-${uncoveredReferenceId}`;

    const anchorCapture = partial.evidence_manifest.find((item) =>
      item.evidence_id === anchorCaptureId);
    assert.ok(anchorCapture);
    anchorCapture.frame_ids = [`frame-${anchorId}-state`];
    partial.evidence_manifest = partial.evidence_manifest.filter((item) =>
      item.evidence_id !== uncoveredCaptureId);

    const anchorObservation = partial.verified_observations.find((item) =>
      item.reference_id === anchorId);
    const uncoveredObservation = partial.verified_observations.find((item) =>
      item.reference_id === uncoveredReferenceId);
    assert.ok(anchorObservation);
    assert.ok(uncoveredObservation);
    anchorObservation.evidence_ids = [anchorMetadataId];
    uncoveredObservation.evidence_ids = [uncoveredMetadataId];
    partial.references.find((item) => item.reference_id === anchorId)
      .popularity.signals[0].evidence_ids = [anchorCaptureId];

    const captureEvidenceIds = [anchorCaptureId, retainedCaptureId]
      .sort((left, right) => left.localeCompare(right, "en"));
    const uncoveredObservationIds = [
      anchorObservation.observation_id,
      uncoveredObservation.observation_id
    ].sort((left, right) => left.localeCompare(right, "en"));
    partial.downstream_contract.reviewer_source_capture_readiness = {
      status: "manual_pending",
      capture_evidence_ids: captureEvidenceIds,
      uncovered_reference_ids: [uncoveredReferenceId],
      uncovered_observation_ids: uncoveredObservationIds,
      revalidate_on_design_start: true
    };
    const { pack_digest: _partialDigest, ...partialBody } = partial;
    partial.pack_digest = canonicalDigest(partialBody);
    assert.equal(validateReferencePack(partial), partial);

    const tampered = structuredClone(partial);
    tampered.downstream_contract.reviewer_source_capture_readiness = {
      status: "ready_at_compilation",
      capture_evidence_ids: captureEvidenceIds,
      uncovered_reference_ids: [],
      uncovered_observation_ids: [],
      revalidate_on_design_start: true
    };
    const { pack_digest: _tamperedDigest, ...tamperedBody } = tampered;
    tampered.pack_digest = canonicalDigest(tamperedBody);
    assert.throws(() => validateReferencePack(tampered),
      /reviewer source-capture readiness is not router-reproducible/);
  } finally {
    fs.rmSync(space.directory, { recursive: true, force: true });
  }
});

test("manual grammar and review dispatch expose only stage-required digest-bound prior results", () => {
  for (const stage of ["reference-grammar", "reference-review"]) {
    const space = workspace();
    try {
      const configured = host(space, {}, (manifest) => {
        if (stage === "reference-grammar") {
          manifest.providers["reference-grammar-analyst"].capabilities = [
            "reference-grammar-extraction"
          ];
        } else {
          manifest.providers["reference-independent-critic"].capabilities = [
            "reference-evidence-review"
          ];
        }
      });
      const state = startReferenceIntelligence({
        statePath: space.statePath,
        briefPath: space.briefPath,
        hostManifest: configured.manifest,
        root: space.directory
      });
      assert.equal(state.status, "manual_pending");
      assert.equal(state.phase, stage);
      const output = path.join(space.directory, `dispatch-${stage}`);
      const dispatch = dispatchReferencePackets(state, output);
      assert.equal(dispatch.packet_count, 1);
      assert.equal(dispatch.request_count, 1);
      const requestPath = path.join(output, `${stage}.request.json`);
      const request = JSON.parse(fs.readFileSync(requestPath, "utf8"));
      const expectedPacketIds = stage === "reference-grammar"
        ? ["reference-discovery"]
        : ["reference-discovery", "reference-grammar"];
      assert.deepEqual(request.prior_results.map((item) => item.packet_id), expectedPacketIds);
      assert.deepEqual(
        request.packet,
        state.packets.find((packet) => packet.packet_id === stage)
      );
      assert.equal(request.state_digest, state.state_digest);
      assert.equal(request.authority_artifacts.source_evidence_descriptors_included, true);
      assert.equal(
        request.authority_artifacts.source_pixels_available_to_reference_participants,
        true
      );
      assert.equal(
        request.authority_artifacts.source_pixels_exposed_to_downstream_creator,
        false
      );
      assert.ok(request.authority_artifacts.source_export_evidence.some((item) =>
        item.evidence_kind === "source-capture" && item.file.path.endsWith(".png")));
      assert.doesNotMatch(JSON.stringify(request.authority_artifacts), /resolved_path/);
      for (const prior of request.prior_results) {
        const record = state.results.find((item) => item.packet_id === prior.packet_id);
        assert.equal(prior.result_digest, record.result_digest);
        assert.equal(prior.result_source_digest, record.source.digest);
        assert.equal(Object.hasOwn(prior.normalized_result, "evidence"), false);
        assert.deepEqual(
          prior.evidence_digests,
          record.evidence.map((item) => ({
            evidence_id: item.evidence_id,
            evidence_kind: item.evidence_kind,
            ...(item.reference_id ? {
              reference_id: item.reference_id,
              product_record_id: item.product_record_id,
              screen_record_id: item.screen_record_id,
              frame_ids: item.frame_ids,
              subject_bindings: item.subject_bindings
            } : {}),
            digest: item.digest
          }))
        );
        const serializedRequest = JSON.stringify(request);
        assert.equal(serializedRequest.includes(record.source.resolved_path), false);
        for (const evidence of record.evidence) {
          assert.equal(serializedRequest.includes(evidence.resolved_path), false);
        }
      }
      const { request_digest: requestDigest, ...requestBody } = request;
      assert.equal(requestDigest, canonicalDigest(requestBody));
      assert.equal(dispatch.request_digests[stage], requestDigest);
      assert.equal(fs.statSync(requestPath).mode & 0o777, 0o600);
    } finally {
      fs.rmSync(space.directory, { recursive: true, force: true });
    }
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
    const popularityQuota = structuredClone(space.brief);
    popularityQuota.coverage.sampling_policy.required_cohorts = [
      "task-fit", "cross-domain", "high-bookmark"
    ];
    assert.throws(() => validateReferenceBrief(popularityQuota, { root: space.directory }),
      /unsupported: high-bookmark/);
    const missingExport = structuredClone(space.brief);
    missingExport.source.exports = [];
    assert.throws(() => validateReferenceBrief(missingExport, { root: space.directory }),
      /manual-export.*digest-bound source\.exports/i);
    const mixedAuthorized = structuredClone(space.brief);
    mixedAuthorized.source.access_mode = "authorized-read-only-adapter";
    assert.throws(() => validateReferenceBrief(mixedAuthorized, { root: space.directory }),
      /authorized read-only.*cannot mix manual exports/i);
    const duplicateSignal = structuredClone(space.brief);
    duplicateSignal.popularity_prior.signals.push(
      structuredClone(duplicateSignal.popularity_prior.signals[0])
    );
    assert.throws(() => validateReferenceBrief(duplicateSignal, { root: space.directory }),
      /duplicate reference popularity signal id/);
    const invalidSubject = structuredClone(space.brief);
    invalidSubject.popularity_prior.signals = [{
      id: "mau", metric: "mau", subject_kind: "screen", weight: 1,
      scope: "UI Bowl released-product collection",
      category: "all-released-products",
      normalization: {
        formula: "linear-bounds-v1", lower_bound: 0, upper_bound: 100,
        direction: "higher-is-better"
      }
    }];
    assert.throws(() => validateReferenceBrief(invalidSubject, { root: space.directory }),
      /subject_kind is invalid/);
  } finally {
    fs.rmSync(space.directory, { recursive: true, force: true });
  }
});

test("product popularity repeated across screens is identical or explicitly conflicted", () => {
  for (const [settings, accepted] of [
    [{ shared_product_first_two: true }, false],
    [{ shared_product_first_two: true, identical_shared_product_signal: true }, true],
    [{ shared_product_first_two: true, reciprocal_shared_product_conflicts: true }, true],
    [{
      shared_product_first_two: true,
      reciprocal_shared_product_conflicts: true,
      misbound_reciprocal_shared_product_conflicts: true
    }, false]
  ]) {
    const space = workspace();
    try {
      space.brief.popularity_prior.signals[0].subject_kind = "product";
      refreshManualExport(space, settings);
      if (accepted) {
        assert.doesNotThrow(() => validateReferenceBrief(space.brief, {
          root: space.directory
        }));
      } else {
        assert.throws(() => validateReferenceBrief(space.brief, {
          root: space.directory
        }), /differs across screens without reciprocal explicit conflict records/);
      }
    } finally {
      fs.rmSync(space.directory, { recursive: true, force: true });
    }
  }
});

test("same-product popularity rejects snapshot or canonical product-evidence drift", () => {
  for (const [settings, message] of [
    [{
      shared_product_first_two: true,
      identical_shared_product_signal: true,
      mismatched_shared_product_snapshot: true
    }, /snapshot_at differs across screens/],
    [{
      shared_product_first_two: true,
      identical_shared_product_signal: true,
      mismatched_shared_product_evidence: true
    }, /differs across screens without reciprocal explicit conflict records/]
  ]) {
    const space = workspace();
    try {
      space.brief.popularity_prior.signals[0].subject_kind = "product";
      refreshManualExport(space, settings);
      assert.throws(() => validateReferenceBrief(space.brief, {
        root: space.directory
      }), message);
    } finally {
      fs.rmSync(space.directory, { recursive: true, force: true });
    }
  }
});

test("source identity, router-derived scores, and causal text cannot be forged", () => {
  for (const [settings, phase, message] of [
    [{ discovery: { duplicate_source_identity: true } }, "reference-discovery", /duplicate UI Bowl screen/],
    [{ discovery: { misbind_first_evidence: true } }, "reference-discovery", /frame-bound source evidence|invalid source binding/],
    [{ discovery: { forged_popularity_score: true } }, "reference-discovery", /normalized_score is not router-reproducible/],
    [{ grammar: { forged_fit_score: true } }, "reference-grammar", /fit score\/band is not router-reproducible/],
    [{ grammar: { source_style_literal: true } }, "reference-grammar", /source-specific copying instructions/]
  ]) {
    const space = workspace();
    try {
      const configured = host(space, settings);
      const state = startReferenceIntelligence({
        statePath: space.statePath,
        briefPath: space.briefPath,
        hostManifest: configured.manifest,
        root: space.directory
      });
      assert.equal(state.status, "blocked");
      assert.equal(state.phase, phase);
      assert.match(state.blockers.join(" "), message);
    } finally {
      fs.rmSync(space.directory, { recursive: true, force: true });
    }
  }
});

test("manual export membership binds every discovered record before it can rank", () => {
  for (const variant of ["omitted-record", "changed-uri"]) {
    const space = workspace();
    try {
      const configured = host(space);
      const manifest = JSON.parse(fs.readFileSync(space.exportPath, "utf8"));
      if (variant === "omitted-record") manifest.records.shift();
      else manifest.records[0].uri = "https://uibowl.io/reference/different-screen";
      writeJson(space.exportPath, manifest);
      space.brief.source.exports[0].digest = hashArtifact(space.exportPath);
      writeJson(space.briefPath, space.brief);
      const state = startReferenceIntelligence({
        statePath: space.statePath,
        briefPath: space.briefPath,
        hostManifest: configured.manifest,
        root: space.directory
      });
      assert.equal(state.status, "blocked");
      assert.equal(state.phase, "reference-discovery");
      assert.match(state.blockers.join(" "), /not a member of the digest-bound manual export/);
    } finally {
      fs.rmSync(space.directory, { recursive: true, force: true });
    }
  }

  const fabricatedEvidence = workspace();
  try {
    const configured = host(fabricatedEvidence, {
      discovery: { fabricated_source_evidence_first: true }
    });
    const state = startReferenceIntelligence({
      statePath: fabricatedEvidence.statePath,
      briefPath: fabricatedEvidence.briefPath,
      hostManifest: configured.manifest,
      root: fabricatedEvidence.directory
    });
    assert.equal(state.status, "blocked");
    assert.equal(state.phase, "reference-discovery");
    assert.match(state.blockers.join(" "),
      /not the exact digest-bound manual export evidence/);
  } finally {
    fs.rmSync(fabricatedEvidence.directory, { recursive: true, force: true });
  }
});

test("evidence product subjects and brief-bound popularity policy fail closed", () => {
  for (const [discovery, message] of [
    [{ wrong_product_evidence_subject: true }, /subject.*conflicts with the evidence record binding/],
    [{ arbitrary_popularity_scope: true }, /popularity signal is not configured/],
    [{ arbitrary_popularity_normalization: true }, /popularity signal is not configured/]
  ]) {
    const space = workspace();
    try {
      const configured = host(space, { discovery });
      const state = startReferenceIntelligence({
        statePath: space.statePath,
        briefPath: space.briefPath,
        hostManifest: configured.manifest,
        root: space.directory
      });
      assert.equal(state.status, "blocked");
      assert.equal(state.phase, "reference-discovery");
      assert.match(state.blockers.join(" "), message);
    } finally {
      fs.rmSync(space.directory, { recursive: true, force: true });
    }
  }
});

test("critic evidence closure and locale transferability fail closed", () => {
  for (const [settings, message] of [
    [{ critic: { omit_first_evidence_verification: true } }, /leaves source evidence unverified/],
    [{ critic: { omit_first_observation_verification: true } }, /verifies fit without its observations/],
    [{ critic: { medium_copy_risk: true } }, /eligible reference.*unresolved hard gate/],
    [{ grammar: { unsupported_locale: true } }, /eligible reference.*unresolved hard gate/]
  ]) {
    const space = workspace();
    try {
      const configured = host(space, settings);
      const state = startReferenceIntelligence({
        statePath: space.statePath,
        briefPath: space.briefPath,
        hostManifest: configured.manifest,
        root: space.directory
      });
      assert.equal(state.status, "blocked");
      assert.equal(state.phase, "reference-review");
      assert.match(state.blockers.join(" "), message);
    } finally {
      fs.rmSync(space.directory, { recursive: true, force: true });
    }
  }
});

test("mixed promotional frames cannot establish operational grammar", () => {
  const space = workspace();
  try {
    const configured = host(space, {
      discovery: { mixed_promotional_first: true },
      grammar: { cite_promotional_observation: true }
    });
    const state = startReferenceIntelligence({
      statePath: space.statePath,
      briefPath: space.briefPath,
      hostManifest: configured.manifest,
      root: space.directory
    });
    assert.equal(state.status, "blocked");
    assert.equal(state.phase, "reference-grammar");
    assert.match(state.blockers.join(" "), /operational grammar.*promotional frame evidence/);
  } finally {
    fs.rmSync(space.directory, { recursive: true, force: true });
  }

  const indirect = workspace();
  try {
    const configured = host(indirect, {
      discovery: { mixed_promotional_first: true },
      grammar: { reasoning_cites_promotional_observation: true }
    });
    const state = startReferenceIntelligence({
      statePath: indirect.statePath,
      briefPath: indirect.briefPath,
      hostManifest: configured.manifest,
      root: indirect.directory
    });
    assert.equal(state.status, "blocked");
    assert.equal(state.phase, "reference-grammar");
    assert.match(state.blockers.join(" "), /operational grammar.*promotional frame evidence/);
  } finally {
    fs.rmSync(indirect.directory, { recursive: true, force: true });
  }

  const uncited = workspace();
  try {
    const configured = host(uncited, {
      discovery: { mixed_promotional_first: true }
    });
    const state = startReferenceIntelligence({
      statePath: uncited.statePath,
      briefPath: uncited.briefPath,
      hostManifest: configured.manifest,
      root: uncited.directory
    });
    assert.equal(state.status, "manual_pending");
    assert.equal(state.phase, "owner-reference-selection");
  } finally {
    fs.rmSync(uncited.directory, { recursive: true, force: true });
  }
});

test("only critic-verified component and pattern labels reach the pack", () => {
  const space = workspace();
  try {
    const configured = host(space, { critic: { partial_verified_labels: true } });
    let state = startReferenceIntelligence({
      statePath: space.statePath,
      briefPath: space.briefPath,
      hostManifest: configured.manifest,
      root: space.directory
    });
    assert.equal(state.phase, "owner-reference-selection");
    state = resumeReferenceIntelligence(space.statePath, {
      hostManifest: configured.manifest,
      selectionPath: writeSelection(space, state)
    });
    assert.equal(state.status, "complete");
    const pack = JSON.parse(fs.readFileSync(state.outputs.reference_pack.resolved_path, "utf8"));
    const first = pack.references.find((item) => item.reference_id === "flowdesk-results");
    assert.deepEqual(first.component_families, ["tabs"]);
    assert.equal(first.component_families.includes("comparison-table"), false);
  } finally {
    fs.rmSync(space.directory, { recursive: true, force: true });
  }
});

test("manual export tamper and networked downstream analysis are stopped before spawn", () => {
  const tamper = workspace();
  try {
    startReferenceIntelligence({
      statePath: tamper.statePath,
      briefPath: tamper.briefPath,
      root: tamper.directory
    });
    fs.appendFileSync(tamper.exportPath, "tampered\n");
    assert.throws(() => readReferenceState(tamper.statePath),
      /UI Bowl manual export.*changed after it was digest-bound/);
  } finally {
    fs.rmSync(tamper.directory, { recursive: true, force: true });
  }

  for (const [providerId, phase, completedChildren] of [
    ["reference-grammar-analyst", "reference-grammar", 1],
    ["reference-independent-critic", "reference-review", 2]
  ]) {
    const space = workspace();
    try {
      const configured = host(space, {}, (manifest) => {
        manifest.providers[providerId].permissions.push("network:external");
      });
      const state = startReferenceIntelligence({
        statePath: space.statePath,
        briefPath: space.briefPath,
        hostManifest: configured.manifest,
        root: space.directory
      });
      assert.equal(state.status, "manual_pending");
      assert.equal(state.phase, phase);
      assert.equal(state.results.length, completedChildren);
      const blockedAttempt = state.attempts.at(-1);
      assert.equal(blockedAttempt.execution_status, "manual_pending");
      assert.equal(blockedAttempt.child_pid, undefined);
      assert.match(blockedAttempt.reason, /permissions forbidden.*network:external/);
    } finally {
      fs.rmSync(space.directory, { recursive: true, force: true });
    }
  }
});

test("authority drift after child exit preserves unresolved in-flight state and lease", () => {
  const variants = [
    ["brief", (space) => space.briefPath, /reference brief changed/],
    ["activation", (space) => space.ownerPath, /owner activation evidence changed/],
    ["rights", (space) => space.rightsPath, /rights evidence changed/],
    ["planning", (space) => space.planningPath, /service-planning source service-plan changed/],
    ["manifest", (space) => space.exportPath, /UI Bowl manual export uibowl-export changed/],
    ["export evidence", (space) => {
      const manifest = JSON.parse(fs.readFileSync(space.exportPath, "utf8"));
      return path.resolve(
        path.dirname(space.exportPath),
        manifest.records[0].evidence_records[0].path
      );
    }, /UI Bowl manual export evidence source-flowdesk-results changed/]
  ];
  for (const [label, target, message] of variants) {
    const space = workspace();
    try {
      const configured = host(space);
      let mutated = false;
      assert.throws(() => startReferenceIntelligence({
        statePath: space.statePath,
        briefPath: space.briefPath,
        hostManifest: configured.manifest,
        root: space.directory,
        faultInjector(point) {
          if (point === "after-child-exit-before-authority-revalidation" && !mutated) {
            mutated = true;
            fs.appendFileSync(target(space), "\n");
          }
        }
      }), message, label);
      assert.equal(mutated, true, label);
      const persisted = JSON.parse(fs.readFileSync(space.statePath, "utf8"));
      assert.equal(persisted.in_flight.packet_id, "reference-discovery", label);
      assert.equal(persisted.results.length, 0, label);
      assert.equal(persisted.attempts.length, 0, label);
      const lease = inspectReferenceStateLease(space.statePath);
      assert.equal(lease.status, "locked", label);
      assert.equal(lease.phase, "child-execution", label);
      assert.equal(lease.active_packet.packet_id, "reference-discovery", label);
    } finally {
      fs.rmSync(space.directory, { recursive: true, force: true });
    }
  }
});

test("human-design grammar fails closed without a causal hierarchy chain or tradeoff", () => {
  for (const grammarSettings of [
    { missing_hierarchy_reasoning: true },
    { missing_tradeoff: true }
  ]) {
    const space = workspace();
    try {
      const configured = host(space, { grammar: grammarSettings });
      const state = startReferenceIntelligence({
        statePath: space.statePath,
        briefPath: space.briefPath,
        hostManifest: configured.manifest,
        root: space.directory
      });
      assert.equal(state.status, "blocked");
      assert.equal(state.phase, "reference-grammar");
      assert.match(state.blockers.join(" "),
        /causal hierarchy reasoning|unsupported field|tradeoff/);
    } finally {
      fs.rmSync(space.directory, { recursive: true, force: true });
    }
  }
});

test("single-frame and promotional evidence cannot establish operational hierarchy grammar", () => {
  const single = workspace();
  try {
    const configured = host(single, { discovery: { single_frame_first: true } });
    const state = startReferenceIntelligence({
      statePath: single.statePath,
      briefPath: single.briefPath,
      hostManifest: configured.manifest,
      root: single.directory
    });
    assert.equal(state.status, "blocked");
    assert.equal(state.phase, "reference-discovery");
    assert.match(state.blockers.join(" "), /single-frame or no-task family/);
  } finally {
    fs.rmSync(single.directory, { recursive: true, force: true });
  }

  const promotional = workspace();
  try {
    const configured = host(promotional, {
      discovery: { promotional_first: true },
      grammar: { promotional_operational_overclaim: true },
      critic: { promotional_operational_overclaim: true }
    });
    const state = startReferenceIntelligence({
      statePath: promotional.statePath,
      briefPath: promotional.briefPath,
      hostManifest: configured.manifest,
      root: promotional.directory
    });
    assert.equal(state.status, "blocked");
    assert.equal(state.phase, "reference-grammar");
    assert.match(state.blockers.join(" "), /operational grammar.*promotional frame evidence/);
  } finally {
    fs.rmSync(promotional.directory, { recursive: true, force: true });
  }

  const promotionalRatio = workspace();
  try {
    const configured = host(promotionalRatio, {
      discovery: { promotional_reference_count: 2 }
    });
    const state = startReferenceIntelligence({
      statePath: promotionalRatio.statePath,
      briefPath: promotionalRatio.briefPath,
      hostManifest: configured.manifest,
      root: promotionalRatio.directory
    });
    assert.equal(state.status, "blocked");
    assert.equal(state.phase, "reference-coverage");
    assert.match(state.blockers.join(" "), /promotional reference ratio/);
  } finally {
    fs.rmSync(promotionalRatio.directory, { recursive: true, force: true });
  }
});

test("conflicted popularity ranks last inside its fit band without blocking eligibility", () => {
  const space = workspace();
  try {
    const configured = host(space, {
      discovery: { popularity_conflict_first: true }
    });
    let state = startReferenceIntelligence({
      statePath: space.statePath,
      briefPath: space.briefPath,
      hostManifest: configured.manifest,
      root: space.directory
    });
    assert.equal(state.phase, "owner-reference-selection");
    assert.deepEqual(state.ranking.map((item) => item.reference_id), [
      "marketline-proof", "proofgrid-offers", "flowdesk-results", "megashop-ranking"
    ]);
    const conflicted = state.ranking.find((item) => item.reference_id === "flowdesk-results");
    assert.equal(conflicted.popularity_verified, false);
    assert.equal(conflicted.popularity_status, "conflicted");
    assert.equal(conflicted.popularity_score, null);
    state = resumeReferenceIntelligence(space.statePath, {
      hostManifest: configured.manifest,
      selectionPath: writeSelection(space, state)
    });
    assert.equal(state.status, "complete");
  } finally {
    fs.rmSync(space.directory, { recursive: true, force: true });
  }
});

test("coverage rejects a popularity sample dominated by one product ecosystem", () => {
  const space = workspace();
  try {
    const configured = host(space, {
      discovery: { duplicate_ecosystem: true }
    });
    const state = startReferenceIntelligence({
      statePath: space.statePath,
      briefPath: space.briefPath,
      hostManifest: configured.manifest,
      root: space.directory
    });
    assert.equal(state.status, "blocked");
    assert.equal(state.phase, "reference-coverage");
    assert.match(state.blockers.join(" "), /ecosystem flowdesk exceeds reference cap/);
  } finally {
    fs.rmSync(space.directory, { recursive: true, force: true });
  }
});

test("completed reference pack is reconstructed exactly from immutable producer state", () => {
  const variants = [
    ["app name", (pack) => {
      pack.references[0].app_name = "Forged product name";
    }],
    ["verified pattern", (pack) => {
      pack.references[0].patterns[0] = "forged-progressive-disclosure";
    }],
    ["verified observation", (pack) => {
      pack.verified_observations[0].statement =
        "A coherently resealed but unsupported hierarchy observation.";
    }],
    ["verified hierarchy reasoning", (pack) => {
      pack.verified_hierarchy_reasoning[0].user_decision =
        "A different unsupported user decision.";
    }],
    ["verified grammar", (pack) => {
      pack.verified_grammar[0].principle =
        "A different unsupported hierarchy principle.";
    }]
  ];
  for (const [label, mutate] of variants) {
    const space = workspace();
    try {
      const configured = host(space);
      let state = startReferenceIntelligence({
        statePath: space.statePath,
        briefPath: space.briefPath,
        hostManifest: configured.manifest,
        root: space.directory
      });
      state = resumeReferenceIntelligence(space.statePath, {
        hostManifest: configured.manifest,
        selectionPath: writeSelection(space, state)
      });
      assert.equal(state.status, "complete", label);
      rewritePackAndResealState(space, mutate);
      assert.throws(() => readReferenceState(space.statePath),
        /reference intelligence pack cannot diverge from immutable producer state/,
        `${label} read`);
      assert.throws(() => resumeReferenceIntelligence(space.statePath, {
        hostManifest: configured.manifest
      }), /reference intelligence pack cannot diverge from immutable producer state/,
      `${label} resume`);
    } finally {
      fs.rmSync(space.directory, { recursive: true, force: true });
    }
  }
});

test("downstream design start rejects a coherently resealed derived reference pack", () => {
  const space = workspace();
  try {
    const configured = host(space);
    let state = startReferenceIntelligence({
      statePath: space.statePath,
      briefPath: space.briefPath,
      hostManifest: configured.manifest,
      root: space.directory
    });
    state = resumeReferenceIntelligence(space.statePath, {
      hostManifest: configured.manifest,
      selectionPath: writeSelection(space, state)
    });
    rewritePackAndResealState(space, (pack) => {
      pack.verified_grammar[0].principle =
        "A resealed downstream design instruction without producer authority.";
    });
    const tamperedState = JSON.parse(fs.readFileSync(space.statePath, "utf8"));
    const design = writeDesignBriefFromReferenceState(space, tamperedState);
    assert.throws(() => dryRunDesignExploration({
      briefPath: design.briefPath,
      baselinePath: design.baseline,
      root: space.directory
    }), /reference intelligence pack cannot diverge from immutable producer state/);
  } finally {
    fs.rmSync(space.directory, { recursive: true, force: true });
  }
});

test("reference pack output is fixed to the canonical state output path", () => {
  const space = workspace();
  try {
    const configured = host(space);
    let state = startReferenceIntelligence({
      statePath: space.statePath,
      briefPath: space.briefPath,
      hostManifest: configured.manifest,
      root: space.directory
    });
    state = resumeReferenceIntelligence(space.statePath, {
      hostManifest: configured.manifest,
      selectionPath: writeSelection(space, state)
    });
    const redirected = path.join(space.directory, "redirected-reference-pack.json");
    fs.copyFileSync(state.outputs.reference_pack.resolved_path, redirected);
    const resealed = JSON.parse(fs.readFileSync(space.statePath, "utf8"));
    resealed.outputs.reference_pack = rebindFile(redirected, resealed.state_directory);
    writeResealedState(space.statePath, resealed);
    assert.throws(() => readReferenceState(space.statePath),
      /reference intelligence pack output is redirected outside its canonical state path/);
  } finally {
    fs.rmSync(space.directory, { recursive: true, force: true });
  }
});

test("each reference result has exactly one accepted attempt and failed attempts bind no result", () => {
  for (const [label, mutate, message] of [
    ["duplicate manual acceptance", (state) => {
      const accepted = state.attempts.find((attempt) =>
        attempt.packet_id === "reference-discovery" && attempt.execution_status === "ran");
      state.attempts.push({
        packet_id: accepted.packet_id,
        provider_id: accepted.provider_id,
        participant: structuredClone(accepted.participant),
        packet_digest: accepted.packet_digest,
        adapter: "manual-v1",
        execution_status: "manual_recorded",
        attempt: 2,
        result_path: accepted.result_path,
        result_digest: accepted.result_digest,
        recorded_at: "2026-09-04T03:00:00.000Z"
      });
    }, /reference result requires exactly one accepted attempt lineage/],
    ["failed attempt result binding", (state) => {
      const accepted = state.attempts.find((attempt) =>
        attempt.packet_id === "reference-discovery" && attempt.execution_status === "ran");
      state.attempts.push({
        ...structuredClone(accepted),
        attempt: 2,
        execution_status: "blocked_execution_error",
        error: "synthetic failed retry must not claim the accepted result"
      });
    }, /reference non-accepted attempt cannot carry result binding/]
  ]) {
    const space = workspace();
    try {
      const configured = host(space);
      let state = startReferenceIntelligence({
        statePath: space.statePath,
        briefPath: space.briefPath,
        hostManifest: configured.manifest,
        root: space.directory
      });
      state = resumeReferenceIntelligence(space.statePath, {
        hostManifest: configured.manifest,
        selectionPath: writeSelection(space, state)
      });
      const resealed = JSON.parse(fs.readFileSync(space.statePath, "utf8"));
      mutate(resealed);
      writeResealedState(space.statePath, resealed);
      assert.throws(() => readReferenceState(space.statePath), message, label);
    } finally {
      fs.rmSync(space.directory, { recursive: true, force: true });
    }
  }
});

test("reference lifecycle rejects forged completion before read, resume, and status", () => {
  const space = workspace();
  try {
    const state = startReferenceIntelligence({
      statePath: space.statePath,
      briefPath: space.briefPath,
      root: space.directory
    });
    assert.equal(state.status, "manual_pending");
    assert.equal(state.phase, "reference-discovery");
    const forged = JSON.parse(fs.readFileSync(space.statePath, "utf8"));
    forged.status = "complete";
    forged.phase = "complete";
    forged.blockers = [];
    forged.pending = [];
    writeResealedState(space.statePath, forged);

    const message = /reference lifecycle complete state is missing canonical packets, results, Owner authority, or pack output/;
    assert.throws(() => readReferenceState(space.statePath), message);
    assert.throws(() => resumeReferenceIntelligence(space.statePath), message);
    const status = spawnSync(process.execPath, [
      cli, "reference", "status", "--run", space.statePath, "--json"
    ], { encoding: "utf8" });
    assert.notEqual(status.status, 0);
    assert.match(status.stderr, message);
  } finally {
    fs.rmSync(space.directory, { recursive: true, force: true });
  }
});

test("reference lifecycle rejects incoherent pending, blocked, and pre-complete output states", () => {
  const variants = [
    ["pending phase", (state) => {
      state.phase = "reference-grammar";
    }, /manual_pending packet phase conflicts/],
    ["blocked without failed attempt", (state) => {
      state.status = "blocked";
      state.blockers = ["forged blocker"];
      state.pending = [];
    }, /blocked packet phase conflicts/]
  ];
  for (const [label, mutate, message] of variants) {
    const space = workspace();
    try {
      startReferenceIntelligence({
        statePath: space.statePath,
        briefPath: space.briefPath,
        root: space.directory
      });
      const resealed = JSON.parse(fs.readFileSync(space.statePath, "utf8"));
      mutate(resealed);
      writeResealedState(space.statePath, resealed);
      assert.throws(() => readReferenceState(space.statePath), message, label);
    } finally {
      fs.rmSync(space.directory, { recursive: true, force: true });
    }
  }

  const completed = workspace();
  try {
    const configured = host(completed);
    let state = startReferenceIntelligence({
      statePath: completed.statePath,
      briefPath: completed.briefPath,
      hostManifest: configured.manifest,
      root: completed.directory
    });
    state = resumeReferenceIntelligence(completed.statePath, {
      hostManifest: configured.manifest,
      selectionPath: writeSelection(completed, state)
    });
    const resealed = JSON.parse(fs.readFileSync(completed.statePath, "utf8"));
    resealed.status = "manual_pending";
    resealed.phase = "owner-reference-selection";
    resealed.pending = ["forged pending state retaining a completed pack"];
    writeResealedState(completed.statePath, resealed);
    assert.throws(() => readReferenceState(completed.statePath),
      /reference pack output cannot exist before lifecycle completion/);
  } finally {
    fs.rmSync(completed.directory, { recursive: true, force: true });
  }
});
