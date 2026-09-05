import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  contrastRatio,
  dryRunDesignExploration,
  inspectDesignStateLease,
  readDesignState,
  recoverDesignStateLease,
  resumeDesignExploration,
  startDesignExploration,
  validateDesignResult
} from "../src/design.mjs";
import { loadHostManifest } from "../src/execution.mjs";
import { canonicalDigest, hashArtifact, snapshotArtifact } from "../src/integrity.mjs";
import { createJourneyIdentity } from "../src/identity.mjs";
import {
  PLAYWRIGHT_ADAPTER_CONTRACT,
  playwrightAdapterPath,
  playwrightRuntimeDigest,
  playwrightRuntimePhysicalIdentityDigest,
  resolvePlaywrightRuntimeRoot
} from "../src/playwright.mjs";
import {
  loadHumanDesignReasoningRegistry,
  REFERENCE_DESIGN_CHECKS,
  resumeReferenceIntelligence,
  startReferenceIntelligence
} from "../src/reference.mjs";
import { resolveVisualIntent, resolveVisualSignature } from "../src/router.mjs";
import { sealedEntrypointGraphDigest } from "../src/sealed-entrypoint.mjs";
import {
  referenceCaptureBytes,
  referenceMetadataBytes
} from "./fixtures/reference-source-fixture.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = path.join(root, "test", "fixtures", "design-host-adapter.mjs");
const referenceFixture = path.join(root, "test", "fixtures", "reference-host-adapter.mjs");
const cli = path.join(root, "bin", "killsloprouter.mjs");
const CHECKPOINT_CHILD_TIMEOUT_MS = 500;
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

function resealDesignState(statePath, mutate) {
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  mutate(state);
  const { state_digest: _digest, ...body } = state;
  state.state_digest = canonicalDigest(body);
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
  return state;
}

function attachStandaloneReferencePack(space, mutate = null) {
  const runId = "reference-pack-fixture";
  const registry = loadHumanDesignReasoningRegistry();
  const planningFrame = {
    ...structuredClone(exampleBrief.product),
    density: "compact"
  };
  const reference = (id, role, product, category, ecosystem) => ({
    reference_id: id,
    role,
    source: {
      provider: "uibowl",
      uri: `https://uibowl.io/reference/${id}`,
      record_id: `screen-${id}`,
      product_record_id: `product-${product}`,
      screen_record_id: `screen-${id}`,
      captured_at: "2026-09-04T01:00:00.000Z"
    },
    app_name: product,
    product_category: category,
    screen_family: exampleBrief.product.screen_family,
    platform: "responsive",
    environment_of_use: "Desktop operations workspace with repeated exception decisions.",
    business_model: "B2B operations software.",
    session_shape: "repeated",
    locale: "en-US",
    sampled_because: role === "anchor"
      ? "Exact task-fit hierarchy evidence."
      : "Cross-domain support that challenges source-family assumptions.",
    family: {
      family_id: `family-${id}`,
      frame_count: 2,
      core_task_frame_count: 1,
      state_frame_count: 1,
      promotional_frame_count: 0,
      frames: [{
        frame_id: `frame-${id}-primary`, role: "operational", core_task: true, state: false
      }, {
        frame_id: `frame-${id}-state`, role: "state", core_task: false, state: true
      }]
    },
    screen_role: "operational",
    evidence_strength: "strong",
    sampling: { ecosystem_id: ecosystem, cohorts: role === "anchor" ? ["task-fit"] : ["cross-domain"] },
    component_families: ["comparison-table"],
    patterns: ["evidence-near-action"],
    product_fit: {
      band: role === "anchor" ? "exact" : "adjacent",
      score: role === "anchor" ? 90 : 70,
      dimensions: role === "anchor"
        ? { user: 5, task: 5, screen: 5, trust: 4, density: 4, locale: 4 }
        : { user: 4, task: 4, screen: 3, trust: 4, density: 3, locale: 3 },
      rationale: role === "anchor"
        ? "The repeated exception decision and evidence density closely match the target."
        : "The comparison structure transfers, but task cadence and locale need adaptation.",
      observed_ids: [role === "anchor" ? "obs-anchor" : `obs-${id}`]
    },
    popularity: {
      status: "verified-snapshot",
      signals: [{
        id: "bookmarks",
        metric: "bookmark-count",
        raw_value: role === "anchor" ? 80 : 60,
        normalized_score: role === "anchor" ? 80 : 60,
        scope: "UI Bowl product list",
        category,
        as_of: "2026-09-04T01:00:00.000Z",
        subject_kind: "screen",
        subject_record_id: `screen-${id}`,
        snapshot_at: "2026-09-04T01:00:00.000Z",
        normalization: {
          formula: "linear-bounds-v1",
          lower_bound: 0,
          upper_bound: 100,
          direction: "higher-is-better"
        },
        evidence_ids: [`source-${id}`]
      }],
      conflicts: [],
      verified: true,
      computed_score: role === "anchor" ? 80 : 60
    }
  });
  const pack = {
    reference_pack_version: 1,
    run_id: runId,
    journey_identity: createJourneyIdentity({
      runId,
      routerId: "kill-slop-router",
      routerVersion: "1.0.0",
      invocation: "explicit"
    }),
    project_id: exampleBrief.project_id,
    surface: exampleBrief.surface,
    authority_scope: "discovery-evidence-only",
    planning_target_id: exampleBrief.screen_id,
    product_frame_digest: canonicalDigest(planningFrame),
    planning_frame: planningFrame,
    selection: {
      owner_id: "owner:reference-selection",
      selection_digest: `sha256:${"2".repeat(64)}`,
      anchor_reference_id: "anchor-results",
      supporting_reference_ids: ["support-results"],
      rationale: "Use exact-fit operational hierarchy with cross-domain support."
    },
    references: [
      reference("anchor-results", "anchor", "AnchorOps", "operations", "anchor-ecosystem"),
      reference("support-results", "support", "SupportMarket", "commerce", "support-ecosystem")
    ],
    evidence_manifest: [{
      evidence_id: "source-anchor-results",
      kind: "source-capture",
      digest: `sha256:${"3".repeat(64)}`,
      reference_id: "anchor-results",
      screen_record_id: "screen-anchor-results",
      frame_ids: ["frame-anchor-results-primary"]
    }, {
      evidence_id: "source-support-results",
      kind: "source-metadata",
      digest: `sha256:${"a".repeat(64)}`,
      reference_id: "support-results",
      screen_record_id: "screen-support-results",
      frame_ids: ["frame-support-results-primary"]
    }],
    reasoning_lenses: structuredClone(registry.registry.lenses),
    verified_observations: [{
      observation_id: "obs-anchor",
      frame_id: "frame-anchor-results-primary",
      frame_role: "operational",
      kind: "hierarchy",
      priority: "primary",
      statement: "Comparable exception evidence precedes secondary metadata and action detail.",
      evidence_ids: ["source-anchor-results"],
      reference_id: "anchor-results"
    }, {
      observation_id: "obs-support-results",
      frame_id: "frame-support-results-primary",
      frame_role: "operational",
      kind: "hierarchy",
      priority: "supporting",
      statement: "Comparable proof remains aligned while secondary actions stay subordinate.",
      evidence_ids: ["source-support-results"],
      reference_id: "support-results"
    }],
    verified_hierarchy_reasoning: [{
      reasoning_id: "reasoning-comparison",
      observed_priority: "primary",
      user_decision: "Choose an exception before inspecting proof.",
      likely_constraint: "Repeated evidence must remain comparable.",
      consequence_if_flattened: "Risk and action would compete.",
      confidence: "high",
      observed_ids: ["obs-anchor"],
      reference_id: "anchor-results"
    }, {
      reasoning_id: "reasoning-color-role",
      observed_priority: "primary",
      user_decision: "Distinguish action, state, and evidence confidence.",
      likely_constraint: "Color roles must coexist with non-color cues.",
      consequence_if_flattened: "One accent would make unlike meanings ambiguous.",
      confidence: "high",
      observed_ids: ["obs-anchor"],
      reference_id: "anchor-results"
    }],
    verified_grammar: [
      {
        grammar_id: "grammar-comparison",
        dimension: "data-comparison",
        principle: "Keep evidence slots aligned around the target decision.",
        application: "Align the main object, evidence, state, and next action.",
        application_conditions: ["Repeated target objects are compared."],
        tradeoff: "Alignment limits decorative variation.",
        harmful_when: ["The screen contains only one narrative object."],
        requires_live_data: false,
        avoid: "Do not import source composition or branded treatment.",
        observed_ids: ["obs-anchor"],
        reasoning_ids: ["reasoning-comparison"],
        reference_id: "anchor-results"
      },
      {
        grammar_id: "grammar-color-roles",
        dimension: "color-roles",
        principle: "Give action, state, brand, and depth separate color jobs.",
        application: "Bind each target semantic role before choosing color values.",
        application_conditions: ["Several semantic states coexist with brand expression."],
        tradeoff: "More roles require stronger token and contrast governance.",
        harmful_when: ["Color is used without a non-color state cue."],
        requires_live_data: false,
        avoid: "Do not copy exact source colors or gradients.",
        observed_ids: ["obs-anchor"],
        reasoning_ids: ["reasoning-color-role"],
        reference_id: "anchor-results"
      }
    ],
    ranking_policy: {
      primary: "product-fit-band",
      within_band: "popularity-descending",
      unverified_or_conflicted_popularity: "rank-last-within-fit-band",
      popularity_cannot_affect: ["eligibility", "hard-gates", "owner-approval"],
      signals: [{
        id: "bookmarks", metric: "bookmark-count", subject_kind: "screen", weight: 1
      }]
    },
    downstream_contract: {
      source_pixels_included: false,
      reasoning_registry_is_visual_authority: false,
      visual_authority_granted: false,
      visual_signature_granted: false,
      design_creation_started: false,
      exact_three_3x3_route_unchanged: true,
      required_design_checks: [...REFERENCE_DESIGN_CHECKS],
      design_check_contracts: structuredClone(registry.registry.design_checks),
      required_next_gate: "separate KillSlopRouter design exploration with visual authority and owner gates"
    },
    provenance: {
      brief_digest: `sha256:${"4".repeat(64)}`,
      reasoning_registry_version: registry.registry.human_design_reasoning_registry_version,
      reasoning_registry_digest: registry.digest,
      reasoning_registry_source_digest: registry.source_digest,
      planning_digests: [`sha256:${"5".repeat(64)}`],
      source_export_digests: [`sha256:${"b".repeat(64)}`],
      rights_digest: `sha256:${"6".repeat(64)}`,
      result_digests: {
        "reference-discovery": `sha256:${"7".repeat(64)}`,
        "reference-grammar": `sha256:${"8".repeat(64)}`,
        "reference-review": `sha256:${"9".repeat(64)}`
      },
      selection_scope_digest: `sha256:${"a".repeat(64)}`
    },
    compiled_at: "2026-09-04T02:00:00.000Z",
    pack_digest: null
  };
  if (mutate) mutate(pack);
  pack.pack_digest = canonicalDigest({ ...pack, pack_digest: undefined });
  const packPath = path.join(space.directory, "reference-pack.json");
  fs.writeFileSync(packPath, `${JSON.stringify(pack, null, 2)}\n`);
  const brief = JSON.parse(fs.readFileSync(space.briefPath, "utf8"));
  brief.reference_pack = { path: packPath, digest: hashArtifact(packPath) };
  fs.writeFileSync(space.briefPath, `${JSON.stringify(brief, null, 2)}\n`);
  return { pack, packPath };
}

function attachReferencePack(space, mutate = null, {
  accessMode = "manual-export",
  includeCaptures = true,
  historicalFailedDiscoveryEntrypoint = null
} = {}) {
  const source = path.join(space.directory, "reference-source");
  const evidence = path.join(source, "evidence");
  fs.mkdirSync(evidence, { recursive: true });
  const ownerPath = path.join(evidence, "owner.md");
  const rightsPath = path.join(evidence, "rights.md");
  const planningPath = path.join(evidence, "planning.json");
  const exportPath = path.join(evidence, "ui-bowl-export.json");
  fs.writeFileSync(ownerPath, "Owner authorizes bounded reference research.\n");
  fs.writeFileSync(rightsPath, "Reference only; no redistribution or creator pixel access.\n");
  fs.writeFileSync(planningPath, `${JSON.stringify({
    planning_gate_version: 1,
    protocol: { id: "service-planning", version: "1", authority: "owner-governed" },
    project_id: exampleBrief.project_id,
    surface: exampleBrief.surface,
    scope_id: exampleBrief.screen_id,
    phase: "phase_1",
    gates: { G1: { status: "passed" }, G2: { status: "approved" } },
    updated_at: "2026-09-04T00:00:00.000Z"
  }, null, 2)}\n`);
  const exportedReferences = [
    ["flowdesk-results", "transactional", 96],
    ["marketline-proof", "operational", 84],
    ["proofgrid-offers", "operational", 72],
    ["megashop-ranking", "transactional", 100]
  ];
  fs.writeFileSync(exportPath, `${JSON.stringify({
    export_version: 1,
    provider: "uibowl",
    access_mode: "manual-export",
    captured_at: "2026-09-04T01:00:00.000Z",
    query_ids: ["comparison", "tabs"],
    records: exportedReferences.map(([id, role, popularity], index) => {
      const productRecordId = `product-${id}`;
      const frames = [
        { frame_id: `frame-${id}-primary`, role, core_task: true, state: false },
        { frame_id: `frame-${id}-state`, role: "state", core_task: false, state: true }
      ];
      const popularityRecords = [{
        record_kind: "signal", signal_id: "popular", metric: "curation-popularity",
        subject_kind: "screen", subject_record_id: id, raw_value: popularity,
        scope: "UI Bowl released-product collection", category: "all-released-products",
        as_of: "2026-09-04T01:00:00.000Z", snapshot_at: "2026-09-04T01:00:00.000Z",
        normalization: {
          formula: "linear-bounds-v1", lower_bound: 0, upper_bound: 100,
          direction: "higher-is-better"
        },
        evidence_ids: [`metadata-${id}`]
      }];
      const evidenceDirectory = path.join(evidence, "ui-bowl-export-evidence");
      fs.mkdirSync(evidenceDirectory, { recursive: true });
      const evidenceKinds = includeCaptures
        ? ["source-capture", "source-metadata"]
        : ["source-metadata"];
      const evidenceRecords = evidenceKinds.map((kind) => {
        const evidenceId = kind === "source-capture" ? `source-${id}` : `metadata-${id}`;
        const evidencePath = path.join(
          evidenceDirectory,
          `${evidenceId}${kind === "source-capture" ? ".png" : ".json"}`
        );
        fs.writeFileSync(evidencePath, kind === "source-capture"
          ? referenceCaptureBytes(index)
          : referenceMetadataBytes({
              productRecordId,
              screenRecordId: id,
              capturedAt: "2026-09-04T01:00:00.000Z",
              frames,
              popularityRecords
            }));
        return {
          evidence_id: evidenceId,
          kind,
          path: path.relative(path.dirname(exportPath), evidencePath),
          digest: hashArtifact(evidencePath),
          frame_ids: frames.map((frame) => frame.frame_id),
          subject_bindings: [{ subject_kind: "screen", subject_record_id: id }, {
            subject_kind: "product", subject_record_id: productRecordId
          }]
        };
      });
      return {
        product_record_id: productRecordId,
        screen_record_id: id,
        uri: `https://uibowl.io/reference/${id}`,
        captured_at: "2026-09-04T01:00:00.000Z",
        query_ids: ["comparison", "tabs"],
        frames,
        evidence_records: evidenceRecords,
        popularity_records: popularityRecords
      };
    })
  }, null, 2)}\n`);
  const productFrame = {
    ...structuredClone(exampleBrief.product),
    density: "compact"
  };
  const brief = {
    reference_brief_version: 1,
    project_id: exampleBrief.project_id,
    surface: exampleBrief.surface,
    locales: ["ko-KR"],
    activation: {
      mode: "explicit-owner-reference-research",
      owner_request_id: "OWNER-DESIGN-REFERENCE-TEST",
      request_excerpt: "Use released-product evidence to improve target-specific design reasoning.",
      authorized_at: "2026-09-04T00:00:00.000Z",
      evidence: { path: "evidence/owner.md", digest: hashArtifact(ownerPath) }
    },
    planning: {
      target_id: exampleBrief.screen_id,
      product_frame: productFrame,
      sources: [{
        id: "service-plan", kind: "service-planning-gate", path: "evidence/planning.json",
        digest: hashArtifact(planningPath)
      }],
      required_gate_ids: ["G1", "G2"]
    },
    source: {
      provider: "uibowl", access_mode: "manual-export",
      exports: [{
        id: "uibowl-export", kind: "uibowl-manual-export", path: "evidence/ui-bowl-export.json",
        digest: hashArtifact(exportPath)
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
        minimum_distinct_products: 3, minimum_distinct_product_categories: 2,
        maximum_references_per_product: 1, maximum_references_per_ecosystem: 1,
        minimum_strong_hierarchy_references: 2, minimum_multi_state_families: 2,
        minimum_references_per_target_locale: 1, maximum_promotional_reference_ratio: 0.2,
        required_cohorts: ["task-fit", "cross-domain", "competent-baseline"],
        promotional_capture_policy: "weak-evidence-only"
      }
    },
    popularity_prior: {
      role: "within-fit-band-ranking-only", primary_sort: "product-fit-band",
      signals: [{
        id: "popular", metric: "curation-popularity", subject_kind: "screen", weight: 1,
        scope: "UI Bowl released-product collection", category: "all-released-products",
        normalization: {
          formula: "linear-bounds-v1", lower_bound: 0, upper_bound: 100,
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
  if (accessMode === "authorized-read-only-adapter") {
    brief.source.access_mode = accessMode;
    brief.source.exports = [];
  }
  const referenceBriefPath = path.join(source, "reference-brief.json");
  fs.writeFileSync(referenceBriefPath, `${JSON.stringify(brief, null, 2)}\n`);
  const provider = (capabilities, strength, settings = {}, permissions = [
    "artifact:read", "evidence:write"
  ]) => ({
    adapter: "agent-json-v1",
    entrypoint: referenceFixture,
    entrypoint_digest: hashArtifact(referenceFixture),
    entrypoint_graph_digest: sealedEntrypointGraphDigest(referenceFixture),
    capabilities,
    strength,
    permissions,
    timeout_ms: 30_000,
    settings
  });
  const manifestPath = path.join(source, "host.json");
  fs.writeFileSync(manifestPath, `${JSON.stringify({
    host_adapter_version: 1,
    allowed_providers: [
      "reference-researcher", "reference-grammar-analyst", "reference-independent-critic"
    ],
    granted_permissions: [
      "artifact:read", "evidence:write",
      ...(accessMode === "authorized-read-only-adapter" ? ["network:external"] : [])
    ],
    providers: {
      "reference-researcher": provider([
        "reference-discovery", "source-provenance", "rights-aware-research", "popularity-evidence"
      ], 3, { metadata_only: !includeCaptures }, accessMode === "authorized-read-only-adapter"
        ? ["artifact:read", "evidence:write", "network:external"]
        : undefined),
      "reference-grammar-analyst": provider([
        "reference-grammar-extraction", "information-hierarchy-analysis",
        "component-pattern-analysis", "product-fit-analysis"
      ], 3),
      "reference-independent-critic": provider([
        "reference-evidence-review", "anti-copy-review", "product-fit-review",
        "popularity-ranking-review"
      ], 4)
    }
  }, null, 2)}\n`);
  const manifest = loadHostManifest(manifestPath);
  const producerStatePath = path.join(source, ".killsloprouter", "reference-run.json");
  let producerState;
  if (historicalFailedDiscoveryEntrypoint) {
    const failedManifestPath = path.join(source, "host-failed-discovery.json");
    const failedManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const failedDeclaration = failedManifest.providers["reference-researcher"];
    failedDeclaration.entrypoint = historicalFailedDiscoveryEntrypoint;
    failedDeclaration.entrypoint_digest = hashArtifact(
      historicalFailedDiscoveryEntrypoint
    );
    failedDeclaration.entrypoint_graph_digest = sealedEntrypointGraphDigest(
      historicalFailedDiscoveryEntrypoint
    );
    fs.writeFileSync(failedManifestPath,
      `${JSON.stringify(failedManifest, null, 2)}\n`);
    producerState = startReferenceIntelligence({
      statePath: producerStatePath,
      briefPath: referenceBriefPath,
      hostManifest: loadHostManifest(failedManifestPath),
      root: source
    });
    assert.equal(producerState.status, "blocked");
    assert.equal(producerState.attempts.length, 1);
    assert.ok(producerState.attempts[0].execution_authority);
    producerState = resumeReferenceIntelligence(producerStatePath, {
      hostManifest: manifest,
      retry: "reference-discovery"
    });
  } else {
    producerState = startReferenceIntelligence({
      statePath: producerStatePath,
      briefPath: referenceBriefPath,
      hostManifest: manifest,
      root: source
    });
  }
  assert.ok(producerState.ranking.length > 0,
    `reference producer fixture did not reach selection: ${JSON.stringify({
      status: producerState.status, phase: producerState.phase,
      blockers: producerState.blockers, pending: producerState.pending
    })}`);
  const anchor = producerState.ranking[0].reference_id;
  const supports = producerState.ranking.slice(1, 3).map((item) => item.reference_id);
  const grammar = producerState.results.find((item) =>
    item.packet_id === "reference-grammar").normalized;
  const grammarIds = brief.coverage.required_grammar_dimensions.map((dimension) =>
    grammar.references.find((entry) => entry.reference_id === anchor).grammar
      .find((item) => item.dimension === dimension).grammar_id);
  const selectionPath = path.join(source, "selection.json");
  fs.writeFileSync(selectionPath, `${JSON.stringify({
    reference_owner_selection_version: 1,
    run_id: producerState.run_id,
    journey_identity: producerState.journey_identity,
    selection_scope_digest: producerState.selection_scope_digest,
    owner_id: "owner:product-design",
    status: "selected",
    anchor_reference_id: anchor,
    supporting_reference_ids: supports,
    selected_grammar_ids: grammarIds,
    rationale: "Use the strongest target-fit hierarchy with independently sourced support.",
    decided_at: "2026-09-04T02:00:00.000Z"
  }, null, 2)}\n`);
  producerState = resumeReferenceIntelligence(producerStatePath, {
    hostManifest: manifest,
    selectionPath
  });
  assert.equal(producerState.status, "complete");
  const packPath = producerState.outputs.reference_pack.resolved_path;
  const pack = JSON.parse(fs.readFileSync(packPath, "utf8"));
  if (mutate) {
    mutate(pack);
    pack.pack_digest = canonicalDigest({ ...pack, pack_digest: undefined });
    fs.writeFileSync(packPath, `${JSON.stringify(pack, null, 2)}\n`);
  }
  const designBrief = JSON.parse(fs.readFileSync(space.briefPath, "utf8"));
  designBrief.reference_pack = {
    path: packPath,
    digest: hashArtifact(packPath),
    producer_state: { path: producerStatePath, digest: hashArtifact(producerStatePath) },
    reviewer_source_access: {
      reviewer_source_access_version: 1,
      mode: "digest-bound-internal-critic",
      purposes: ["promotional-citation-firewall", "source-composition-independence"],
      allowed_evidence_kinds: ["source-capture"],
      redistribution: false,
      creator_access: false,
      browser_provider_access: false,
      external_network: false
    }
  };
  fs.writeFileSync(space.briefPath, `${JSON.stringify(designBrief, null, 2)}\n`);
  return { pack, packPath, producerStatePath, producerState };
}

function provider(adapter, capabilities, strength, permissions, settings = {}) {
  return {
    adapter,
    entrypoint: fixture,
    entrypoint_digest: hashArtifact(fixture),
    entrypoint_graph_digest: sealedEntrypointGraphDigest(fixture),
    capabilities,
    strength,
    permissions,
    timeout_ms: 30_000,
    settings
  };
}

let officialPlaywrightFixtureAuthority = null;

function officialPlaywrightProvider(directory) {
  if (!officialPlaywrightFixtureAuthority) {
    const runtimeRoot = resolvePlaywrightRuntimeRoot();
    const entrypoint = playwrightAdapterPath();
    officialPlaywrightFixtureAuthority = {
      runtimeRoot,
      runtimeDigest: playwrightRuntimeDigest(runtimeRoot),
      runtimePhysicalIdentityDigest:
        playwrightRuntimePhysicalIdentityDigest(runtimeRoot),
      entrypoint,
      entrypointDigest: hashArtifact(entrypoint),
      entrypointGraphDigest: sealedEntrypointGraphDigest(entrypoint, {
        trustedPackageRoot: root
      })
    };
  }
  const authorityId = Math.random().toString(16).slice(2);
  const scenarioFile = path.join(directory, `playwright-scenarios-${authorityId}.json`);
  const baselineDirectory = path.join(directory, `playwright-baselines-${authorityId}`);
  fs.mkdirSync(baselineDirectory, { recursive: true });
  fs.writeFileSync(scenarioFile, `${JSON.stringify({
    playwright_scenario_version: 1,
    scenarios: [{
      id: "design-fixture",
      path: "/",
      actions: [],
      assertions: [{ type: "visible", locator: "body" }]
    }]
  }, null, 2)}\n`);
  const authority = officialPlaywrightFixtureAuthority;
  return {
    adapter: "browser-json-v1",
    entrypoint: authority.entrypoint,
    entrypoint_digest: authority.entrypointDigest,
    entrypoint_graph_digest: authority.entrypointGraphDigest,
    capabilities: capabilities.browser,
    strength: 3,
    permissions: ["artifact:read", "evidence:write", "browser:control"],
    timeout_ms: 900_000,
    settings: {
      contract: PLAYWRIGHT_ADAPTER_CONTRACT,
      base_url: "http://127.0.0.1:4173",
      attestation_path: "/.well-known/killsloprouter-artifact.json",
      allowed_origins: [],
      browser_channel: process.env.KSR_PLAYWRIGHT_CHANNEL || "chrome",
      locale: "en-US",
      runtime_root: authority.runtimeRoot,
      runtime_digest: authority.runtimeDigest,
      runtime_physical_identity_digest: authority.runtimePhysicalIdentityDigest,
      scenario_file: scenarioFile,
      scenario_digest: hashArtifact(scenarioFile),
      baseline_directory: baselineDirectory,
      baseline_digest: hashArtifact(baselineDirectory, { ignores: [] }),
      viewports: {
        mobile: { width: 390, height: 844 },
        tablet: { width: 768, height: 1024 },
        desktop: { width: 1440, height: 1000 }
      },
      color_schemes: ["light"],
      max_keyboard_tabs: 200,
      navigation_timeout_ms: 30_000
    }
  };
}

const capabilities = {
  direction: [
    "design-direction-generation", "baseline-preservation", "responsive-prototype", "locale-prototype"
  ],
  directionReview: [
    "product-fit-review", "visual-distinctiveness-review", "baseline-preservation-review", "responsive-review",
    "reference-source-composition-review"
  ],
  color: [
    "color-system-generation", "semantic-color-roles", "contrast-aware-palette", "responsive-prototype"
  ],
  colorReview: [
    "color-harmony-review", "semantic-role-review", "contrast-review", "brand-fit-review",
    "reference-source-composition-review"
  ],
  browser: [
    "responsive-evidence", "keyboard-evidence", "state-evidence", "overflow-evidence",
    "contrast-evidence", "zoom-evidence"
  ]
};

function host(directory, settings = {}, mutate = null) {
  const manifestPath = path.join(directory, `host-${Math.random().toString(16).slice(2)}.json`);
  const brief = JSON.parse(fs.readFileSync(path.join(directory, "design-brief.json"), "utf8"));
  const browserProvider = brief.reference_pack
    ? officialPlaywrightProvider(directory)
    : provider("browser-json-v1", capabilities.browser, 3,
      ["artifact:read", "evidence:write", "browser:control"], settings.browser);
  const manifest = {
    host_adapter_version: 1,
    allowed_providers: [
      "design-direction-agent", "design-direction-critic", "color-system-agent",
      "color-system-critic", "browser-evidence"
    ],
    granted_permissions: [
      "artifact:read", "evidence:write", "browser:control", "reference-evidence:read"
    ],
    providers: {
      "design-direction-agent": provider("agent-json-v1", capabilities.direction, 3,
        ["artifact:read", "evidence:write"], settings.direction),
      "design-direction-critic": provider("agent-json-v1", capabilities.directionReview, 4,
        ["artifact:read", "evidence:write", "reference-evidence:read"], settings.directionReview),
      "color-system-agent": provider("skill-json-v1", capabilities.color, 3,
        ["artifact:read", "evidence:write"], settings.color),
      "color-system-critic": provider("agent-json-v1", capabilities.colorReview, 4,
        ["artifact:read", "evidence:write", "reference-evidence:read"], settings.colorReview),
      "browser-evidence": browserProvider
    }
  };
  if (mutate) mutate(manifest);
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return loadHostManifest(manifestPath);
}

function writeShortlist(space, state, ownerId = "owner:product-design") {
  const review = state.results.find((record) => record.packet_id === "direction-review");
  const target = path.join(space.directory, "shortlist.json");
  fs.writeFileSync(target, `${JSON.stringify({
    design_shortlist_version: 1,
    run_id: state.run_id,
    journey_identity: state.journey_identity,
    selection_scope_digest: state.selection_scope_digest,
    owner_id: ownerId,
    candidate_ids: review.normalized.ranking.slice(0, 3),
    rationale: "These three retain the operator model while offering meaningfully different visual theses.",
    decided_at: "2026-08-19T08:00:00.000Z"
  }, null, 2)}\n`);
  return fs.realpathSync(target);
}

function writeApproval(space, state, ownerId = "owner:product-design") {
  const designId = state.shortlist.normalized.candidate_ids[0];
  const color = state.results.find((record) =>
    record.normalized.kind === "color-candidate" && record.normalized.design_candidate_id === designId);
  const target = path.join(space.directory, "approval.json");
  fs.writeFileSync(target, `${JSON.stringify({
    design_owner_decision_version: 1,
    run_id: state.run_id,
    journey_identity: state.journey_identity,
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

function writeRejectedApproval(space, state) {
  const designId = state.shortlist.normalized.candidate_ids[0];
  const color = state.results.find((record) =>
    record.normalized.kind === "color-candidate" &&
    record.normalized.design_candidate_id === designId);
  const target = path.join(space.directory, "rejected-approval.json");
  fs.writeFileSync(target, `${JSON.stringify({
    design_owner_decision_version: 1,
    run_id: state.run_id,
    journey_identity: state.journey_identity,
    approval_scope_digest: state.approval_scope_digest,
    owner_id: "owner:product-design",
    status: "rejected",
    selected_design_candidate_id: designId,
    selected_color_candidate_id: color.normalized.candidate_id,
    note: "Reject this exact bounded scope without granting implementation authority.",
    decided_at: "2026-08-19T09:00:00.000Z"
  }, null, 2)}\n`);
  return target;
}

function waitPast(timestamp) {
  while (Date.now() <= Date.parse(timestamp)) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
  }
}

async function waitFor(predicate, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return predicate();
}

function writeDesignCrashRunner(space) {
  const target = path.join(space.directory, "design-crash-runner.mjs");
  const designUrl = pathToFileURL(path.join(root, "src", "design.mjs")).href;
  const executionUrl = pathToFileURL(path.join(root, "src", "execution.mjs")).href;
  fs.writeFileSync(target, `
import { loadHostManifest } from ${JSON.stringify(executionUrl)};
import {
  recoverDesignStateLease,
  resumeDesignExploration,
  startDesignExploration
} from ${JSON.stringify(designUrl)};

const [mode, crashPoint, briefPath, baselinePath, statePath, hostPath, root,
  ownerToken, acquiredAt, stateDigest, approvalPath] = process.argv.slice(2);
let finalApprovalPublished = false;
let pendingFinalizationReady = false;
const faultInjector = (point, details = {}) => {
  if (crashPoint === "before-spawn" && point === "after-child-lease-before-spawn") {
    process.exit(73);
  }
  if (crashPoint === "post-child-checkpoint" &&
    point === "after-state-write-before-lease-commit" &&
    details.attempt_count > 0 && details.in_flight === null) {
    process.exit(74);
  }
  if (crashPoint === "state-before-commit" && point === "state-before-commit") {
    process.exit(78);
  }
  if (crashPoint === "state-after-write" &&
    point === "after-state-write-before-lease-commit") {
    process.exit(79);
  }
  if (point === "after-final-approval-publish-before-state-write") {
    finalApprovalPublished = true;
  }
  if (point === "before-final-approval-publish") {
    pendingFinalizationReady = true;
  }
  if (crashPoint === "pending-finalization-state-before-commit" &&
    pendingFinalizationReady && point === "state-before-commit") {
    process.exit(82);
  }
  if (crashPoint === "pending-finalization-state-after-write" &&
    pendingFinalizationReady && point === "after-state-write-before-lease-commit") {
    process.exit(83);
  }
  if (crashPoint === "finalization-state-before-commit" &&
    finalApprovalPublished && point === "state-before-commit") {
    process.exit(80);
  }
  if (crashPoint === "finalization-state-after-write" &&
    finalApprovalPublished && point === "after-state-write-before-lease-commit") {
    process.exit(81);
  }
};
if (mode === "start") {
  startDesignExploration({
    briefPath, baselinePath, statePath,
    hostManifest: hostPath ? loadHostManifest(hostPath) : null,
    root,
    faultInjector
  });
} else if (mode === "resume") {
  resumeDesignExploration(statePath, {
    hostManifest: hostPath ? loadHostManifest(hostPath) : null,
    approvalPath: approvalPath || null,
    faultInjector
  });
} else if (mode === "recover") {
  recoverDesignStateLease(statePath, {
    ownerToken, acquiredAt, stateDigest, faultInjector
  });
}
process.exit(76);
`);
  return target;
}

function writeSlowFailingAdapter(space, marker) {
  const target = path.join(space.directory, "slow-design-adapter.mjs");
  fs.writeFileSync(target, `
import fs from "node:fs";
let source = "";
for await (const chunk of process.stdin) source += chunk;
const request = JSON.parse(source);
const marker = request.settings.spawn_marker;
const first = !fs.existsSync(marker);
fs.appendFileSync(marker, request.packet.packet_id + "\\n");
if (first) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 750);
}
process.stderr.write("intentional slow design fixture failure\\n");
process.exit(23);
`);
  return target;
}

function writeFailingReferenceAdapter(space) {
  const target = path.join(space.directory, "failed-reference-recipient.mjs");
  fs.writeFileSync(target, [
    "export const historicalReferenceFailureBoundary = 'design-result-on-reference-packet';",
    `import ${JSON.stringify(pathToFileURL(fixture).href)};`,
    ""
  ].join("\n"));
  return fs.realpathSync(target);
}

function writeDependencyBackedDesignAdapter(space) {
  const dependency = path.join(space.directory, "design-adapter-dependency.mjs");
  const entrypoint = path.join(space.directory, "design-adapter-wrapper.mjs");
  fs.writeFileSync(dependency,
    "export const sealedDesignAdapterDependency = 'v1';\n");
  fs.writeFileSync(entrypoint, [
    'import "./design-adapter-dependency.mjs";',
    `import ${JSON.stringify(pathToFileURL(fixture).href)};`,
    ""
  ].join("\n"));
  return { dependency, entrypoint };
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
    assert.equal(Object.hasOwn(report, "reference_intelligence"), false);
    assert.ok(report.readiness.every((item) => item.execution_status === "manual_pending"));
    const state = startDesignExploration({
      statePath: space.statePath,
      briefPath: space.briefPath,
      baselinePath: space.baseline,
      root: space.directory
    });
    assert.ok(state.packets.every((packet) =>
      Object.hasOwn(packet, "forbidden_permissions") === false),
    "no-pack packets must retain their legacy byte/API shape");
  } finally {
    fs.rmSync(space.directory, { recursive: true, force: true });
  }
});

test("coherently resealed premature complete state is rejected before resume can spawn", () => {
  const space = workspace();
  try {
    const state = startDesignExploration({
      statePath: space.statePath,
      briefPath: space.briefPath,
      baselinePath: space.baseline,
      root: space.directory
    });
    assert.equal(state.status, "manual_pending");
    assert.equal(state.results.length, 0);
    resealDesignState(space.statePath, (forged) => {
      forged.status = "complete";
      forged.phase = "complete";
      forged.blockers = [];
      forged.pending = [];
    });
    assert.throws(() => readDesignState(space.statePath),
      /complete design state requires an external approved Owner decision|exact canonical route/);
    assert.throws(() => resumeDesignExploration(space.statePath),
      /complete design state requires an external approved Owner decision|exact canonical route/);
    const raw = JSON.parse(fs.readFileSync(space.statePath, "utf8"));
    assert.equal(raw.attempts.length, 9,
      "invalid complete resume must not create an additional child attempt");
  } finally {
    fs.rmSync(space.directory, { recursive: true, force: true });
  }
});

test("direction and color reviewers are independent from the full creator provider union", () => {
  const cases = [{
    label: "direction reviewer is a color creator",
    mutate(brief) {
      brief.providers.direction_reviewer = brief.color_strategies[0].creator_provider_id;
    }
  }, {
    label: "color reviewer is a direction creator",
    mutate(brief) {
      brief.providers.color_reviewer = brief.directions[0].creator_provider_id;
    }
  }];
  for (const referenceBacked of [false, true]) {
    for (const fixtureCase of cases) {
      const space = workspace();
      try {
        if (referenceBacked) attachReferencePack(space);
        const brief = JSON.parse(fs.readFileSync(space.briefPath, "utf8"));
        fixtureCase.mutate(brief);
        fs.writeFileSync(space.briefPath, `${JSON.stringify(brief, null, 2)}\n`);
        assert.throws(() => dryRunDesignExploration({
          briefPath: space.briefPath,
          baselinePath: space.baseline
        }), /reviewer provider must be independent from every direction and color creator/,
        `${referenceBacked ? "reference-pack" : "no-pack"}: ${fixtureCase.label}`);
        assert.equal(fs.existsSync(space.statePath), false);
      } finally {
        fs.rmSync(space.directory, { recursive: true, force: true });
      }
    }
  }
});

test("design provider roles reject KillSlopRouter parent aliases before state creation", () => {
  const cases = [
    {
      label: "direction creator",
      mutate: (brief) => { brief.directions[0].creator_provider_id = "kill-slop-router"; }
    }, {
      label: "direction reviewer",
      mutate: (brief) => { brief.providers.direction_reviewer = "KillSlopRouter"; }
    }, {
      label: "color creator",
      mutate: (brief) => { brief.color_strategies[0].creator_provider_id = "killsloprouter"; }
    }, {
      label: "color reviewer",
      mutate: (brief) => {
        brief.providers.color_reviewer = "killsloprouter:kill-slop-router";
      }
    }, {
      label: "browser provider",
      mutate: (brief) => { brief.providers.browser_evidence = "킬슬롭라우터"; }
    }
  ];
  for (const fixtureCase of cases) {
    const space = workspace();
    try {
      const brief = JSON.parse(fs.readFileSync(space.briefPath, "utf8"));
      fixtureCase.mutate(brief);
      fs.writeFileSync(space.briefPath, `${JSON.stringify(brief, null, 2)}\n`);
      assert.throws(() => startDesignExploration({
        statePath: space.statePath,
        briefPath: space.briefPath,
        baselinePath: space.baseline,
        root: space.directory
      }), /cannot use the KillSlopRouter parent identity/,
      fixtureCase.label);
      const extension = path.extname(space.statePath);
      const stateDirectory = `${space.statePath.slice(0, -extension.length)}.design`;
      assert.equal(fs.existsSync(space.statePath), false, fixtureCase.label);
      assert.equal(fs.existsSync(stateDirectory), false, fixtureCase.label);
    } finally {
      fs.rmSync(space.directory, { recursive: true, force: true });
    }
  }
});

test("design result actors cannot impersonate the KillSlopRouter parent at any stage", () => {
  const colorFlow = workspace();
  try {
    const manifest = host(colorFlow.directory);
    let state = startDesignExploration({
      statePath: colorFlow.statePath,
      briefPath: colorFlow.briefPath,
      baselinePath: colorFlow.baseline,
      hostManifest: manifest,
      root: colorFlow.directory
    });
    assert.equal(state.phase, "direction-selection");
    state = resumeDesignExploration(colorFlow.statePath, {
      hostManifest: manifest,
      shortlistPath: writeShortlist(colorFlow, state)
    });
    assert.equal(state.status, "manual_pending");
    assert.equal(state.phase, "owner-approval");
    const resultCount = state.results.length;
    const cases = [
      ["direction-candidate", "kill-slop-router"],
      ["browser-evidence", "KillSlopRouter"],
      ["direction-review", "killsloprouter:kill-slop-router"],
      ["color-candidate", "킬 슬롭 라우터"],
      ["color-review", "killsloprouter"]
    ];
    for (const [kind, actorId] of cases) {
      const record = state.results.find((item) => item.normalized.kind === kind);
      assert.ok(record, kind);
      const packet = state.packets.find((item) => item.packet_id === record.packet_id);
      const input = structuredClone(record.normalized);
      input.actor.actor_id = actorId;
      assert.throws(() => validateDesignResult(
        state,
        packet,
        input,
        record.source.resolved_path
      ), /cannot use the KillSlopRouter parent identity/, kind);
    }
    assert.equal(state.results.length, resultCount);
    assert.deepEqual(state.outputs, {});
    assert.equal(state.final_receipt_digests, null);
  } finally {
    fs.rmSync(colorFlow.directory, { recursive: true, force: true });
  }
});

test("design start rejects an in-memory host declaration forgery before child intent", () => {
  const space = workspace();
  try {
    const marker = path.join(space.directory, "forged-design-child.marker");
    const manifest = host(space.directory, {
      direction: { spawn_marker: marker }
    });
    manifest.providers["design-direction-agent"].settings.in_memory_only = true;
    assert.throws(() => startDesignExploration({
      statePath: space.statePath,
      briefPath: space.briefPath,
      baselinePath: space.baseline,
      hostManifest: manifest,
      root: space.directory
    }), (error) => {
      assert.equal(error.exitCode, 4);
      assert.match(error.message,
        /host adapter manifest normalized authority was mutated in memory/);
      return true;
    });
    assert.equal(fs.existsSync(marker), false,
      "the forged design provider must be rejected before its child starts");
    const state = JSON.parse(fs.readFileSync(space.statePath, "utf8"));
    assert.equal(state.in_flight, null);
    assert.deepEqual(state.attempts, []);
    assert.deepEqual(state.results, []);
  } finally {
    fs.rmSync(space.directory, { recursive: true, force: true });
  }
});

test("design resume rejects coherent brief, baseline, and state-directory authority reseals before child spawn", () => {
  const space = workspace();
  try {
    startDesignExploration({
      statePath: space.statePath,
      briefPath: space.briefPath,
      baselinePath: space.baseline,
      root: space.directory
    });
    assert.equal(
      readDesignState(fs.realpathSync(space.statePath)).state_path,
      path.resolve(space.statePath),
      "physical macOS /var aliases must resolve to the same design state"
    );
    const originalState = fs.readFileSync(space.statePath, "utf8");
    const originalBriefDigest = hashArtifact(space.briefPath);
    const marker = path.join(space.directory, "authority-reseal-child.marker");
    const manifest = host(space.directory, {
      direction: { spawn_marker: marker }
    });
    const assertRejectedBeforeChild = (mutate, pattern) => {
      fs.writeFileSync(space.statePath, originalState);
      fs.rmSync(marker, { force: true });
      resealDesignState(space.statePath, mutate);
      assert.throws(() => resumeDesignExploration(space.statePath, {
        hostManifest: manifest
      }), pattern);
      assert.equal(fs.existsSync(marker), false,
        "authority reseal must fail before a child starts");
    };

    assertRejectedBeforeChild((state) => {
      state.brief.providers.color_reviewer = "forged-color-reviewer";
    }, /design brief state binding mismatch/);
    assert.equal(hashArtifact(space.briefPath), originalBriefDigest,
      "the digest-bound external brief must remain unchanged in the repro");

    const alternateBaseline = path.join(space.directory, "alternate-baseline");
    fs.mkdirSync(alternateBaseline);
    fs.writeFileSync(path.join(alternateBaseline, "app.html"),
      "<!doctype html><main>unauthorized alternate baseline</main>\n");
    assertRejectedBeforeChild((state) => {
      state.baseline = snapshotArtifact(alternateBaseline, { root: space.directory });
    }, /design packet baseline authority conflicts with state/);

    const redirectedStateDirectory = path.join(space.directory, "redirected-design-state");
    fs.mkdirSync(redirectedStateDirectory);
    assertRejectedBeforeChild((state) => {
      state.state_directory = redirectedStateDirectory;
    }, /design state directory does not match the derived resume directory/);

    const alternateBriefPath = path.join(space.directory, "alternate-design-brief.json");
    const alternateBrief = structuredClone(exampleBrief);
    alternateBrief.providers.color_reviewer = "forged-color-reviewer";
    fs.writeFileSync(alternateBriefPath, `${JSON.stringify(alternateBrief, null, 2)}\n`);
    assertRejectedBeforeChild((state) => {
      state.brief = alternateBrief;
      state.brief_source = snapshotArtifact(alternateBriefPath, { root: space.directory });
    }, /design packet brief authority conflicts with state/);
    assert.equal(hashArtifact(space.briefPath), originalBriefDigest);
  } finally {
    fs.rmSync(space.directory, { recursive: true, force: true });
  }
});

test("design state rejects phase-less shortlist and approval injection with immutable sources", () => {
  const space = workspace();
  try {
    startDesignExploration({
      statePath: space.statePath,
      briefPath: space.briefPath,
      baselinePath: space.baseline,
      root: space.directory
    });
    const state = JSON.parse(fs.readFileSync(space.statePath, "utf8"));
    const selectionScope = `sha256:${"1".repeat(64)}`;
    const approvalScope = `sha256:${"2".repeat(64)}`;
    const shortlistPath = path.join(space.directory, "injected-shortlist-source.json");
    const approvalPath = path.join(space.directory, "injected-approval-source.json");
    const shortlist = {
      design_shortlist_version: 1,
      run_id: state.run_id,
      journey_identity: state.journey_identity,
      selection_scope_digest: selectionScope,
      owner_id: "owner:product-design",
      candidate_ids: ["forged-a", "forged-b", "forged-c"],
      rationale: "This source remains immutable during the coherent state reseal repro.",
      decided_at: "2026-08-19T08:00:00.000Z"
    };
    const approval = {
      design_owner_decision_version: 1,
      run_id: state.run_id,
      journey_identity: state.journey_identity,
      approval_scope_digest: approvalScope,
      owner_id: "owner:product-design",
      status: "approved",
      selected_design_candidate_id: "forged-a",
      selected_color_candidate_id: "forged-color",
      note: "This source remains immutable during the coherent state reseal repro.",
      decided_at: "2026-08-19T09:00:00.000Z"
    };
    fs.writeFileSync(shortlistPath, `${JSON.stringify(shortlist, null, 2)}\n`);
    fs.writeFileSync(approvalPath, `${JSON.stringify(approval, null, 2)}\n`);
    const shortlistSourceDigest = hashArtifact(shortlistPath);
    const approvalSourceDigest = hashArtifact(approvalPath);
    resealDesignState(space.statePath, (forged) => {
      forged.selection_scope_digest = selectionScope;
      forged.shortlist = {
        normalized: shortlist,
        shortlist_digest: canonicalDigest(shortlist),
        source: snapshotArtifact(shortlistPath, { root: forged.state_directory })
      };
      forged.approval_scope_digest = approvalScope;
      forged.approval = {
        normalized: approval,
        approval_digest: canonicalDigest(approval),
        source: snapshotArtifact(approvalPath, { root: forged.state_directory })
      };
    });
    assert.throws(() => readDesignState(space.statePath),
      /design selection scope requires complete packet results/);
    assert.equal(hashArtifact(shortlistPath), shortlistSourceDigest);
    assert.equal(hashArtifact(approvalPath), approvalSourceDigest);
  } finally {
    fs.rmSync(space.directory, { recursive: true, force: true });
  }
});

test("digest-bound reference reasoning reaches creators without changing the exact-three matrix", () => {
  const space = workspace();
  try {
    const { packPath } = attachReferencePack(space);
    const report = dryRunDesignExploration({
      briefPath: space.briefPath,
      baselinePath: space.baseline,
      root: space.directory
    });
    assert.equal(report.direction_matrix.length, 9);
    assert.equal(report.reference_intelligence.authority_scope, "discovery-evidence-only");
    assert.equal(report.reference_intelligence.source_pixels_included, false);
    let state = startDesignExploration({
      statePath: space.statePath,
      briefPath: space.briefPath,
      baselinePath: space.baseline,
      root: space.directory
    });
    assert.equal(state.status, "manual_pending", JSON.stringify(state.blockers));
    assert.ok(state.packets.every((packet) =>
      packet.design_task.reference_intelligence?.pack_digest ===
        state.reference_pack.pack_digest));
    const creatorContract = state.packets[0].design_task.reference_intelligence;
    assert.equal(creatorContract.authority_scope, "discovery-evidence-only");
    assert.ok(creatorContract.causal_reasoning.length > 0);
    assert.ok(creatorContract.transferable_grammar.length > 0);
    assert.equal(Object.hasOwn(creatorContract, "verified_observations"), false);
    assert.equal(Object.hasOwn(creatorContract, "reasoning_lenses"), false);
    assert.doesNotMatch(JSON.stringify(creatorContract),
      /source-capture|screenshot|\.png|uibowl\.io|Flowdesk|Marketline|Proofgrid|Megashop/i);
    assert.deepEqual(state.packets[0].forbidden_permissions,
      ["network:external", "reference-evidence:read"]);
    fs.appendFileSync(packPath, " ");
    assert.throws(() => readDesignState(space.statePath),
      /reference intelligence pack changed after it was digest-bound/);
  } finally {
    fs.rmSync(space.directory, { recursive: true, force: true });
  }
});

test("metadata-only research pack blocks design before state or child creation", () => {
  const space = workspace();
  try {
    const { pack } = attachReferencePack(space, null, { includeCaptures: false });
    assert.deepEqual(pack.downstream_contract.reviewer_source_capture_readiness, {
      status: "manual_pending",
      capture_evidence_ids: [],
      uncovered_reference_ids: pack.references
        .map((item) => item.reference_id).sort((left, right) =>
          left.localeCompare(right, "en")),
      uncovered_observation_ids: pack.verified_observations
        .map((item) => item.observation_id).sort((left, right) =>
          left.localeCompare(right, "en")),
      revalidate_on_design_start: true
    });
    const assertManualPending = (operation) => assert.throws(operation, (error) => {
      assert.equal(error.exitCode, 6);
      assert.match(error.message,
        /research-complete but design-review source captures are manual_pending/);
      return true;
    });
    assertManualPending(() => dryRunDesignExploration({
      briefPath: space.briefPath,
      baselinePath: space.baseline,
      root: space.directory
    }));
    assertManualPending(() => startDesignExploration({
      statePath: space.statePath,
      briefPath: space.briefPath,
      baselinePath: space.baseline,
      root: space.directory
    }));
    assert.equal(fs.existsSync(space.statePath), false);
    assert.equal(fs.existsSync(space.statePath.replace(/\.json$/, ".design")), false);
  } finally {
    fs.rmSync(space.directory, { recursive: true, force: true });
  }
});

test("reference pack cannot grant authority or cross the project boundary", () => {
  for (const mutation of [
    (pack) => { pack.project_id = "other-project"; },
    (pack) => { pack.planning_target_id = "other-screen"; },
    (pack) => { pack.downstream_contract.visual_authority_granted = true; },
    (pack) => { pack.downstream_contract.required_design_checks.pop(); },
    (pack) => { pack.downstream_contract.design_check_contracts[0] = null; },
    (pack) => { delete pack.reasoning_lenses[0].question; },
    (pack) => { pack.references[0].popularity.computed_score = 0; },
    (pack) => { pack.references[0].product_fit.score = 0; },
    (pack) => {
      const reference = pack.references[0];
      reference.family.frames.push({
        frame_id: "frame-anchor-results-promo",
        role: "promotional",
        core_task: false,
        state: false
      });
      reference.family.frame_count = 3;
      reference.family.promotional_frame_count = 1;
      pack.verified_observations[0].frame_id = "frame-anchor-results-promo";
      pack.verified_observations[0].frame_role = "promotional";
      pack.evidence_manifest[0].frame_ids.push("frame-anchor-results-promo");
    },
    (pack) => { pack.unexpected = "schema bypass"; },
    (pack) => {
      pack.verified_hierarchy_reasoning[0].user_decision =
        "Choose the #0A84FF control at 12px.";
    },
    (pack) => {
      pack.verified_grammar[0].application_conditions = ["Copy the source at 8px spacing."];
    }
  ]) {
    const space = workspace();
    try {
      attachReferencePack(space, mutation);
      assert.throws(() => dryRunDesignExploration({
        briefPath: space.briefPath,
        baselinePath: space.baseline,
        root: space.directory
      }), /conflicts with the design project|conflicts with the design screen|weakens the downstream authority boundary|cannot weaken|popularity score is not router-reproducible|product_fit is not router-reproducible|promotional evidence for operational structure|unsupported field|source-specific copying instructions|source-specific styling literals|must be an object|must be a non-empty string/);
    } finally {
      fs.rmSync(space.directory, { recursive: true, force: true });
    }
  }
});

test("reference pack physical identity and grammar-to-reasoning edges remain fail closed", () => {
  const replaced = workspace();
  try {
    const { packPath } = attachReferencePack(replaced);
    startDesignExploration({
      statePath: replaced.statePath,
      briefPath: replaced.briefPath,
      baselinePath: replaced.baseline,
      root: replaced.directory
    });
    const bytes = fs.readFileSync(packPath);
    fs.renameSync(packPath, `${packPath}.old`);
    fs.writeFileSync(packPath, bytes);
    assert.throws(() => readDesignState(replaced.statePath),
      /reference intelligence pack changed.*physical-identity-mismatch/);
  } finally {
    fs.rmSync(replaced.directory, { recursive: true, force: true });
  }

  const producerReplaced = workspace();
  try {
    const { producerStatePath } = attachReferencePack(producerReplaced);
    startDesignExploration({
      statePath: producerReplaced.statePath,
      briefPath: producerReplaced.briefPath,
      baselinePath: producerReplaced.baseline,
      root: producerReplaced.directory
    });
    const bytes = fs.readFileSync(producerStatePath);
    fs.renameSync(producerStatePath, `${producerStatePath}.old`);
    fs.writeFileSync(producerStatePath, bytes);
    assert.throws(() => readDesignState(producerReplaced.statePath),
      /reference intelligence pack state binding mismatch/);
  } finally {
    fs.rmSync(producerReplaced.directory, { recursive: true, force: true });
  }

  const cachedResultRewritten = workspace();
  try {
    attachReferencePack(cachedResultRewritten);
    startDesignExploration({
      statePath: cachedResultRewritten.statePath,
      briefPath: cachedResultRewritten.briefPath,
      baselinePath: cachedResultRewritten.baseline,
      hostManifest: host(cachedResultRewritten.directory),
      root: cachedResultRewritten.directory
    });
    const state = JSON.parse(fs.readFileSync(cachedResultRewritten.statePath, "utf8"));
    const review = state.results.find((record) => record.packet_id === "direction-review");
    review.normalized.ranking.reverse();
    review.result_digest = canonicalDigest(review.normalized);
    const attempt = [...state.attempts].reverse().find((item) =>
      item.packet_id === review.packet_id && item.execution_status === "ran");
    attempt.result_digest = review.result_digest;
    const { state_digest: _stateDigest, ...body } = state;
    state.state_digest = canonicalDigest(body);
    fs.writeFileSync(cachedResultRewritten.statePath, `${JSON.stringify(state, null, 2)}\n`);
    assert.throws(() => readDesignState(cachedResultRewritten.statePath),
      /design result source binding mismatch: direction-review/);
  } finally {
    fs.rmSync(cachedResultRewritten.directory, { recursive: true, force: true });
  }

  const crosswired = workspace();
  try {
    attachReferencePack(crosswired);
    const state = startDesignExploration({
      statePath: crosswired.statePath,
      briefPath: crosswired.briefPath,
      baselinePath: crosswired.baseline,
      hostManifest: host(crosswired.directory, {
        direction: { crosswire_reference_trace: true }
      }),
      root: crosswired.directory
    });
    assert.equal(state.status, "blocked");
    assert.equal(state.phase, "direction-generation");
    assert.match(state.blockers.join(" "),
      /outside the digest-bound reference pack|does not preserve.*grammar-to-reasoning edges/);
  } finally {
    fs.rmSync(crosswired.directory, { recursive: true, force: true });
  }
});

test("bound reference reasoning requires creator traces and independent design checks", () => {
  const space = workspace();
  try {
    const { producerState } = attachReferencePack(space, null, {
      historicalFailedDiscoveryEntrypoint: writeFailingReferenceAdapter(space)
    });
    const failedSourceRecipient = producerState.attempts.find((attempt) =>
      attempt.execution_status.startsWith("blocked_")).provider_id;
    let state = startDesignExploration({
      statePath: space.statePath,
      briefPath: space.briefPath,
      baselinePath: space.baseline,
      hostManifest: host(space.directory),
      root: space.directory
    });
    assert.equal(state.status, "manual_pending");
    assert.equal(state.phase, "direction-selection");
    assert.ok(state.results
      .filter((item) => item.normalized.kind === "direction-candidate")
      .every((item) => item.normalized.reference_reasoning_trace.length > 0));
    const review = state.results.find((item) => item.normalized.kind === "direction-review");
    assert.equal(review.normalized.reference_checks.length, 9);
    assert.ok(review.normalized.reference_checks.every((item) =>
      item.checks.every((check) => check.passed && check.evidence_bindings.length > 0)));
    const reviewPacket = state.packets.find((item) => item.packet_id === "direction-review");
    assert.equal(reviewPacket.design_task.reference_intelligence.audience,
      "independent-reviewer");
    assert.equal(reviewPacket.design_task.reference_intelligence
      .source_pixels_available_to_participant, true);
    assert.ok(reviewPacket.required_permissions.includes("reference-evidence:read"));
    assert.ok(reviewPacket.forbidden_permissions.includes("network:external"));
    assert.doesNotMatch(JSON.stringify(reviewPacket),
      /uibowl\.io|reference-source\/evidence|\.png/i);
    assert.ok(review.normalized.evidence.some((item) =>
      item.kind === "source-composition-analysis"));
    assert.ok(review.normalized.reference_checks.every((item) =>
      item.checks.filter((check) => [
        "promotional-citation-firewall", "source-composition-independence"
      ].includes(check.check_id)).every((check) =>
        check.evidence_bindings.some((binding) =>
          binding.evidence_role === "reference-capture-set" &&
          binding.source_kind === "reference-authority"))));
    assert.ok(state.reference_pack.producer_state.review_source_authority
      .source_recipient_provider_ids.includes(failedSourceRecipient));
    assert.throws(() => resumeDesignExploration(space.statePath, {
      hostManifest: host(space.directory),
      shortlistPath: writeShortlist(space, state, failedSourceRecipient)
    }), /must be external to the KillSlopRouter parent and every routed participant/);
    state = readDesignState(space.statePath);
    assert.equal(state.shortlist, null);
  } finally {
    fs.rmSync(space.directory, { recursive: true, force: true });
  }

  const missing = workspace();
  try {
    attachReferencePack(missing);
    const state = startDesignExploration({
      statePath: missing.statePath,
      briefPath: missing.briefPath,
      baselinePath: missing.baseline,
      hostManifest: host(missing.directory, {
        directionReview: { omit_reference_checks: true }
      }),
      root: missing.directory
    });
    assert.equal(state.status, "blocked");
    assert.equal(state.phase, "direction-review");
    assert.match(state.blockers.join(" "), /reference checks for every candidate/);
  } finally {
    fs.rmSync(missing.directory, { recursive: true, force: true });
  }

  const missingTrace = workspace();
  try {
    attachReferencePack(missingTrace);
    const state = startDesignExploration({
      statePath: missingTrace.statePath,
      briefPath: missingTrace.briefPath,
      baselinePath: missingTrace.baseline,
      hostManifest: host(missingTrace.directory, {
        direction: { omit_reference_trace: true }
      }),
      root: missingTrace.directory
    });
    assert.equal(state.status, "blocked");
    assert.equal(state.phase, "direction-generation");
    assert.match(state.blockers.join(" "), /requires a reference reasoning trace/);
  } finally {
    fs.rmSync(missingTrace.directory, { recursive: true, force: true });
  }

  const unmatchedFailure = workspace();
  try {
    attachReferencePack(unmatchedFailure);
    const state = startDesignExploration({
      statePath: unmatchedFailure.statePath,
      briefPath: unmatchedFailure.briefPath,
      baselinePath: unmatchedFailure.baseline,
      hostManifest: host(unmatchedFailure.directory, {
        directionReview: {
          failed_reference_check: "decision-inventory",
          omit_reference_failure_blocker: true
        }
      }),
      root: unmatchedFailure.directory
    });
    assert.equal(state.status, "blocked");
    assert.equal(state.phase, "direction-review");
    assert.match(state.blockers.join(" "), /failure requires a matching hard blocker/);
  } finally {
    fs.rmSync(unmatchedFailure.directory, { recursive: true, force: true });
  }
});

test("bound reference reasoning remains mandatory through color review", () => {
  const space = workspace();
  try {
    const { pack, packPath } = attachReferencePack(space);
    const manifest = host(space.directory);
    let state = startDesignExploration({
      statePath: space.statePath,
      briefPath: space.briefPath,
      baselinePath: space.baseline,
      hostManifest: manifest,
      root: space.directory
    });
    const selectedDirectionId = state.results.find((item) =>
      item.normalized.kind === "direction-review").normalized.ranking[0];
    const selectedDirectionActor = state.results.find((item) =>
      item.normalized.kind === "direction-candidate" &&
      item.normalized.candidate_id === selectedDirectionId).normalized.actor.actor_id;
    state = resumeDesignExploration(space.statePath, {
      hostManifest: host(space.directory, {
        colorReview: { actor_id: selectedDirectionActor }
      }),
      shortlistPath: writeShortlist(space, state)
    });
    assert.equal(state.status, "blocked");
    assert.equal(state.phase, "color-review");
    assert.match(state.blockers.join(" "), /downstream candidate derived from its work/);
    state = resumeDesignExploration(space.statePath, {
      hostManifest: manifest,
      retry: "color-review"
    });
    assert.equal(state.status, "manual_pending", JSON.stringify(state.blockers));
    assert.equal(state.phase, "owner-approval");
    const review = state.results.find((item) => item.normalized.kind === "color-review");
    assert.equal(review.normalized.reference_checks.length, 9);
    assert.ok(review.normalized.reference_checks.every((item) =>
      item.checks.every((check) => check.passed && check.evidence_bindings.length > 0)));

    state = resumeDesignExploration(space.statePath, {
      hostManifest: manifest,
      approvalPath: writeApproval(space, state)
    });
    assert.equal(state.status, "complete");
    const decision = JSON.parse(fs.readFileSync(state.outputs.decision.resolved_path, "utf8"));
    const bindings = JSON.parse(fs.readFileSync(state.outputs.profile_bindings.resolved_path, "utf8"));
    const referenceBinding = decision.reference_intelligence_binding;
    const selectedDirection = state.results.find((item) =>
      item.normalized.kind === "direction-candidate" &&
      item.normalized.candidate_id === decision.selected_design_candidate_id);
    const selectedColor = state.results.find((item) =>
      item.normalized.kind === "color-candidate" &&
      item.normalized.candidate_id === decision.selected_color_candidate_id);
    const directionReview = state.results.find((item) => item.normalized.kind === "direction-review");
    const colorReview = state.results.find((item) => item.normalized.kind === "color-review");
    assert.equal(referenceBinding.authority_scope, "discovery-evidence-only");
    assert.equal(referenceBinding.visual_authority_granted, false);
    assert.equal(referenceBinding.planning_target_id, exampleBrief.screen_id);
    assert.equal(referenceBinding.product_frame_digest, pack.product_frame_digest);
    assert.equal(referenceBinding.pack_digest, pack.pack_digest);
    assert.equal(referenceBinding.reference_pack_source_digest, hashArtifact(packPath));
    assert.equal(decision.source_digests.reference_pack, hashArtifact(packPath));
    assert.equal(referenceBinding.reasoning_registry_digest,
      pack.provenance.reasoning_registry_digest);
    assert.equal(referenceBinding.selected_direction_trace.candidate_id,
      decision.selected_design_candidate_id);
    assert.equal(referenceBinding.selected_direction_trace.trace_digest,
      canonicalDigest(selectedDirection.normalized.reference_reasoning_trace));
    assert.equal(referenceBinding.selected_direction_trace.grammar_ids.length, 7);
    assert.ok(referenceBinding.selected_direction_trace.grammar_ids.every((id) =>
      /^grammar-[0-9]{3}$/.test(id)));
    assert.ok(referenceBinding.selected_direction_trace.reasoning_ids.every((id) =>
      /^causal-[0-9]{3}$/.test(id)));
    assert.ok(referenceBinding.selected_direction_trace.trace_ids.every((id) => /^sha256:/.test(id)));
    assert.equal(referenceBinding.selected_color_trace.candidate_id,
      decision.selected_color_candidate_id);
    assert.equal(referenceBinding.selected_color_trace.trace_digest,
      canonicalDigest(selectedColor.normalized.reference_reasoning_trace));
    assert.equal(referenceBinding.selected_color_trace.grammar_ids.length, 1);
    assert.ok(referenceBinding.selected_color_trace.grammar_ids.every((id) =>
      /^grammar-[0-9]{3}$/.test(id)));
    assert.ok(referenceBinding.selected_color_trace.reasoning_ids.every((id) =>
      /^causal-[0-9]{3}$/.test(id)));
    assert.ok(referenceBinding.selected_color_trace.trace_ids.every((id) => /^sha256:/.test(id)));
    assert.equal(referenceBinding.direction_review_result_digest, directionReview.result_digest);
    assert.equal(referenceBinding.color_review_result_digest, colorReview.result_digest);
    assert.equal(referenceBinding.review_source_capture_set_digest,
      state.reference_pack.producer_state.review_source_authority.capture_set_digest);
    assert.equal(referenceBinding.direction_source_composition_analysis_digest,
      directionReview.evidence.find((item) =>
        item.evidence_kind === "source-composition-analysis").digest);
    assert.equal(referenceBinding.color_source_composition_analysis_digest,
      colorReview.evidence.find((item) =>
        item.evidence_kind === "source-composition-analysis").digest);
    assert.doesNotMatch(JSON.stringify(referenceBinding),
      /\.png|resolved_path|uibowl\.io/i);
    const { binding_digest: bindingDigest, ...bindingBody } = referenceBinding;
    assert.equal(bindingDigest, canonicalDigest(bindingBody));
    assert.deepEqual(bindings.reference_intelligence_binding, referenceBinding);
  } finally {
    fs.rmSync(space.directory, { recursive: true, force: true });
  }

  const missing = workspace();
  try {
    attachReferencePack(missing);
    const directionHost = host(missing.directory);
    let state = startDesignExploration({
      statePath: missing.statePath,
      briefPath: missing.briefPath,
      baselinePath: missing.baseline,
      hostManifest: directionHost,
      root: missing.directory
    });
    state = resumeDesignExploration(missing.statePath, {
      hostManifest: host(missing.directory, {
        colorReview: { omit_reference_checks: true }
      }),
      shortlistPath: writeShortlist(missing, state)
    });
    assert.equal(state.status, "blocked");
    assert.equal(state.phase, "color-review");
    assert.match(state.blockers.join(" "), /reference checks for every candidate/);
  } finally {
    fs.rmSync(missing.directory, { recursive: true, force: true });
  }
});

test("reference-backed design closes trace, evidence, copy, network, and producer gaps", () => {
  const cases = [{
    name: "missing trace dimension",
    settings: { direction: { omit_trace_dimension: true } },
    phase: "direction-generation",
    message: /disposition every applicable reference grammar dimension/
  }, {
    name: "missing typed contract evidence",
    settings: { direction: { omit_contract_role: true } },
    phase: "direction-generation",
    message: /design contract omits required roles/
  }, {
    name: "misbound reviewer evidence",
    settings: { directionReview: { misbind_required_evidence: true } },
    phase: "direction-review",
    message: /does not resolve to digest-bound evidence/
  }, {
    name: "affirmative source composition copy",
    settings: { direction: { copy_source_composition: true } },
    phase: "direction-generation",
    message: /source-composition copying/
  }, {
    name: "missing source comparison report",
    settings: { directionReview: { omit_source_composition_analysis: true } },
    phase: "direction-review",
    message: /requires exactly one source-composition-analysis/
  }, {
    name: "wrong source capture authority",
    settings: { directionReview: { wrong_capture_set_digest: true } },
    phase: "direction-review",
    message: /authority binding mismatch/
  }, {
    name: "incomplete source capture coverage",
    settings: { directionReview: { omit_capture_alias: true } },
    phase: "direction-review",
    message: /exact capture set/
  }];
  for (const item of cases) {
    const space = workspace();
    try {
      attachReferencePack(space);
      const state = startDesignExploration({
        statePath: space.statePath,
        briefPath: space.briefPath,
        baselinePath: space.baseline,
        hostManifest: host(space.directory, item.settings),
        root: space.directory
      });
      assert.equal(state.status, "blocked", item.name);
      assert.equal(state.phase, item.phase, item.name);
      assert.match(state.blockers.join(" "), item.message, item.name);
    } finally {
      fs.rmSync(space.directory, { recursive: true, force: true });
    }
  }

  const notApplicable = workspace();
  try {
    attachReferencePack(notApplicable);
    const state = startDesignExploration({
      statePath: notApplicable.statePath,
      briefPath: notApplicable.briefPath,
      baselinePath: notApplicable.baseline,
      hostManifest: host(notApplicable.directory, {
        direction: { not_applicable_dimension: "navigation" }
      }),
      root: notApplicable.directory
    });
    assert.equal(state.status, "manual_pending");
    assert.equal(state.phase, "direction-selection");
    assert.ok(state.results.filter((record) =>
      record.normalized.kind === "direction-candidate").every((record) =>
      record.normalized.reference_reasoning_trace.some((trace) =>
        trace.dimension === "navigation" && trace.disposition === "not-applicable")));
  } finally {
    fs.rmSync(notApplicable.directory, { recursive: true, force: true });
  }

  const network = workspace();
  try {
    attachReferencePack(network);
    const marker = path.join(network.directory, "design-child-started.txt");
    const manifest = host(network.directory, { direction: { spawn_marker: marker } }, (value) => {
      value.granted_permissions.push("network:external");
      value.providers["design-direction-agent"].permissions.push("network:external");
    });
    const state = startDesignExploration({
      statePath: network.statePath,
      briefPath: network.briefPath,
      baselinePath: network.baseline,
      hostManifest: manifest,
      root: network.directory
    });
    assert.equal(state.status, "manual_pending");
    assert.equal(state.phase, "direction-generation");
    assert.equal(fs.existsSync(marker), false,
      "forbidden network permission must stop the design child before spawn");
    assert.ok(state.attempts.every((attempt) =>
      attempt.execution_status === "manual_pending"));
    assert.ok(state.packets.filter((packet) =>
      packet.design_task.reference_intelligence).every((packet) =>
      packet.forbidden_permissions.includes("network:external")));
  } finally {
    fs.rmSync(network.directory, { recursive: true, force: true });
  }

  const producer = workspace();
  try {
    const { producerStatePath } = attachReferencePack(producer);
    fs.appendFileSync(producerStatePath, " ");
    assert.throws(() => dryRunDesignExploration({
      briefPath: producer.briefPath,
      baselinePath: producer.baseline,
      root: producer.directory
    }), /reference producer state file digest mismatch/);
  } finally {
    fs.rmSync(producer.directory, { recursive: true, force: true });
  }

  const standalone = workspace();
  try {
    attachReferencePack(standalone);
    const brief = JSON.parse(fs.readFileSync(standalone.briefPath, "utf8"));
    delete brief.reference_pack.producer_state;
    fs.writeFileSync(standalone.briefPath, `${JSON.stringify(brief, null, 2)}\n`);
    assert.throws(() => dryRunDesignExploration({
      briefPath: standalone.briefPath,
      baselinePath: standalone.baseline,
      root: standalone.directory
    }), /reference_pack\.producer_state must be an object/);
  } finally {
    fs.rmSync(standalone.directory, { recursive: true, force: true });
  }
});

test("reference-backed reviewers require bounded source authority before spawn", () => {
  const unavailable = workspace();
  try {
    attachReferencePack(unavailable);
    const marker = path.join(unavailable.directory, "reference-reviewer-started.txt");
    const manifest = host(unavailable.directory, {
      directionReview: { spawn_marker: marker }
    }, (value) => {
      value.providers["design-direction-critic"].capabilities =
        capabilities.directionReview.filter((item) =>
          item !== "reference-source-composition-review");
      value.providers["design-direction-critic"].permissions = [
        "artifact:read", "evidence:write"
      ];
    });
    const state = startDesignExploration({
      statePath: unavailable.statePath,
      briefPath: unavailable.briefPath,
      baselinePath: unavailable.baseline,
      hostManifest: manifest,
      root: unavailable.directory
    });
    assert.equal(state.status, "manual_pending");
    assert.equal(state.phase, "direction-review");
    assert.equal(fs.existsSync(marker), false);
    const attempt = state.attempts.find((item) =>
      item.packet_id === "direction-review");
    assert.equal(attempt.execution_status, "manual_pending");
    assert.match(attempt.reason,
      /reference-evidence:read|reference-source-composition-review/);
  } finally {
    fs.rmSync(unavailable.directory, { recursive: true, force: true });
  }

  const tampered = workspace();
  try {
    attachReferencePack(tampered);
    assert.throws(() => startDesignExploration({
      statePath: tampered.statePath,
      briefPath: tampered.briefPath,
      baselinePath: tampered.baseline,
      hostManifest: host(tampered.directory, {
        directionReview: { tamper_reference_capture: true }
      }),
      root: tampered.directory
    }), /host run artifact .* changed after child execution|changed after it was digest-bound/);
    const lease = inspectDesignStateLease(tampered.statePath);
    assert.equal(lease.status, "locked");
    assert.equal(lease.phase, "child-execution");
  } finally {
    fs.rmSync(tampered.directory, { recursive: true, force: true });
  }
});

test("authorized read-only reference captures reach only the independent design critic", () => {
  const space = workspace();
  try {
    attachReferencePack(space, null, {
      accessMode: "authorized-read-only-adapter"
    });
    const report = dryRunDesignExploration({
      briefPath: space.briefPath,
      baselinePath: space.baseline,
      root: space.directory
    });
    assert.equal(report.reference_intelligence.source_pixels_included, false);
    const state = startDesignExploration({
      statePath: space.statePath,
      briefPath: space.briefPath,
      baselinePath: space.baseline,
      hostManifest: host(space.directory),
      root: space.directory
    });
    assert.equal(state.status, "manual_pending", JSON.stringify(state.blockers));
    assert.equal(state.phase, "direction-selection");
    const authority = state.reference_pack.producer_state.review_source_authority;
    assert.ok(authority.captures.length >= 3);
    assert.ok(state.results.find((record) =>
      record.packet_id === "direction-review").normalized.evidence.some((item) =>
      item.kind === "source-composition-analysis"));
    assert.ok(state.packets.filter((packet) =>
      packet.design_task.kind === "direction-candidate").every((packet) =>
      packet.design_task.reference_intelligence.audience === "creator" &&
      !Object.hasOwn(packet.design_task.reference_intelligence,
        "review_source_authority")));
  } finally {
    fs.rmSync(space.directory, { recursive: true, force: true });
  }
});

test("source-privileged reference participants cannot reappear as design creators or browser actors", () => {
  const providerReuse = workspace();
  try {
    const { producerStatePath } = attachReferencePack(providerReuse);
    const producer = JSON.parse(fs.readFileSync(producerStatePath, "utf8"));
    const sourceProvider = producer.results[0].provider_id;
    const brief = JSON.parse(fs.readFileSync(providerReuse.briefPath, "utf8"));
    brief.directions[0].creator_provider_id = sourceProvider;
    fs.writeFileSync(providerReuse.briefPath, `${JSON.stringify(brief, null, 2)}\n`);
    assert.throws(() => dryRunDesignExploration({
      briefPath: providerReuse.briefPath,
      baselinePath: providerReuse.baseline,
      root: providerReuse.directory
    }), /reference source recipient provider cannot serve as a design creator or browser provider/);
    assert.equal(fs.existsSync(providerReuse.statePath), false);
  } finally {
    fs.rmSync(providerReuse.directory, { recursive: true, force: true });
  }

  const actorReuse = workspace();
  try {
    const { producerStatePath } = attachReferencePack(actorReuse);
    const producer = JSON.parse(fs.readFileSync(producerStatePath, "utf8"));
    const sourceActor = producer.results[0].normalized.actor.actor_id;
    const state = startDesignExploration({
      statePath: actorReuse.statePath,
      briefPath: actorReuse.briefPath,
      baselinePath: actorReuse.baseline,
      hostManifest: host(actorReuse.directory, {
        direction: { actor_id: sourceActor }
      }),
      root: actorReuse.directory
    });
    assert.equal(state.status, "blocked");
    assert.equal(state.phase, "direction-generation");
    assert.match(state.blockers.join(" "),
      /reference source recipient actor cannot serve as a design creator or browser participant/);
  } finally {
    fs.rmSync(actorReuse.directory, { recursive: true, force: true });
  }
});

test("source-recipient executable authority cannot be aliased by design creators or browser providers", () => {
  const space = workspace();
  try {
    const { producerState } = attachReferencePack(space);
    const sourceProviders = new Set(producerState.attempts
      .filter((attempt) => attempt.execution_authority)
      .map((attempt) => attempt.provider_id));
    const sourceActors = new Set(producerState.results
      .map((record) => record.normalized.actor.actor_id));
    const restrictedProviders = [
      ["direction creator", "design-direction-agent"],
      ["color creator", "color-system-agent"],
      ["browser provider", "browser-evidence"]
    ];

    const aliasHost = (providerId) => host(space.directory, {}, (manifest) => {
      const declaration = manifest.providers[providerId];
      declaration.entrypoint = referenceFixture;
      declaration.entrypoint_digest = hashArtifact(referenceFixture);
      declaration.entrypoint_graph_digest = sealedEntrypointGraphDigest(referenceFixture);
      declaration.settings = {
        actor_id: `design-alias-${providerId}`
      };
    });

    for (const [role, providerId] of restrictedProviders) {
      assert.equal(sourceProviders.has(providerId), false,
        `${role} test must use a different provider id from every source recipient`);
      assert.equal(sourceActors.has(`design-alias-${providerId}`), false,
        `${role} test must use a different actor id from every source recipient`);
      assert.throws(() => dryRunDesignExploration({
        briefPath: space.briefPath,
        baselinePath: space.baseline,
        hostManifest: aliasHost(providerId),
        root: space.directory
      }), /reference source recipient executable cannot serve as a design/,
      `${role} should fail closed when its provider and actor aliases reuse a source executable graph`);
    }

    assert.throws(() => startDesignExploration({
      statePath: space.statePath,
      briefPath: space.briefPath,
      baselinePath: space.baseline,
      hostManifest: aliasHost("design-direction-agent"),
      root: space.directory
    }), /reference source recipient executable cannot serve as a design direction creator/);
    assert.equal(fs.existsSync(space.statePath), false,
      "executable alias rejection must happen before design state creation");
    assert.equal(fs.existsSync(space.statePath.replace(/\.json$/, ".design")), false,
      "executable alias rejection must happen before design packet or child directories exist");

    const reviewerReuse = dryRunDesignExploration({
      briefPath: space.briefPath,
      baselinePath: space.baseline,
      hostManifest: host(space.directory, {}, (manifest) => {
        const declaration = manifest.providers["design-direction-critic"];
        declaration.entrypoint = referenceFixture;
        declaration.entrypoint_digest = hashArtifact(referenceFixture);
        declaration.entrypoint_graph_digest = sealedEntrypointGraphDigest(referenceFixture);
      }),
      root: space.directory
    });
    assert.equal(reviewerReuse.status, "ready",
      "source executable overlap remains allowed for the independent reviewer role");

    const state = startDesignExploration({
      statePath: space.statePath,
      briefPath: space.briefPath,
      baselinePath: space.baseline,
      hostManifest: host(space.directory),
      root: space.directory
    });
    assert.equal(state.status, "manual_pending");
    assert.equal(state.phase, "direction-selection");

    const originalState = fs.readFileSync(space.statePath, "utf8");
    const tampered = JSON.parse(originalState);
    const sourceAuthority = tampered.reference_pack.producer_state
      .review_source_authority;
    const lineage = sourceAuthority.source_recipient_execution_lineage;
    assert.ok(lineage.attempts[0]?.adapter_entrypoint?.graph_digest);
    lineage.attempts[0].adapter_entrypoint.graph_digest =
      `sha256:${"7".repeat(64)}`;
    const { lineage_digest: _lineageDigest, ...lineageBody } = lineage;
    lineage.lineage_digest = canonicalDigest(lineageBody);
    const { capture_set_digest: _captureSetDigest, ...sourceAuthorityBody } =
      sourceAuthority;
    sourceAuthority.capture_set_digest = canonicalDigest(sourceAuthorityBody);
    const { state_digest: _stateDigest, ...stateBody } = tampered;
    tampered.state_digest = canonicalDigest(stateBody);
    fs.writeFileSync(space.statePath, `${JSON.stringify(tampered, null, 2)}\n`);
    assert.throws(() => readDesignState(space.statePath),
      /reference intelligence pack state binding mismatch/,
      "resealing cached source-recipient lineage cannot replace producer authority");
    fs.writeFileSync(space.statePath, originalState);

    const shortlistPath = writeShortlist(space, state);
    const stateDigestBeforeResume = hashArtifact(space.statePath);
    assert.throws(() => resumeDesignExploration(space.statePath, {
      hostManifest: aliasHost("color-system-agent"),
      shortlistPath
    }), /reference source recipient executable cannot serve as a design color creator/);
    assert.equal(hashArtifact(space.statePath), stateDigestBeforeResume,
      "resume executable alias rejection must precede state writes and child spawn");
    assert.equal(readDesignState(space.statePath).attempts.length, state.attempts.length,
      "resume executable alias rejection must not add a child attempt");
  } finally {
    fs.rmSync(space.directory, { recursive: true, force: true });
  }
});

test("a failed historical source executable remains forbidden after retry on a different graph", () => {
  const space = workspace();
  try {
    const { producerState } = attachReferencePack(space, null, {
      historicalFailedDiscoveryEntrypoint: fixture
    });
    const discoveryAttempts = producerState.attempts.filter((attempt) =>
      attempt.packet_id === "reference-discovery" && attempt.execution_authority);
    assert.equal(discoveryAttempts.length, 2);
    assert.ok(discoveryAttempts[0].execution_status.startsWith("blocked_"));
    assert.equal(discoveryAttempts[1].execution_status, "ran");
    assert.notEqual(
      discoveryAttempts[0].execution_authority.adapter_entrypoint.graph_digest,
      discoveryAttempts[1].execution_authority.adapter_entrypoint.graph_digest,
      "fixture must prove a failed graph A followed by a successful graph B"
    );
    assert.equal(
      discoveryAttempts[0].execution_authority.adapter_entrypoint.graph_digest,
      sealedEntrypointGraphDigest(fixture)
    );

    assert.throws(() => dryRunDesignExploration({
      briefPath: space.briefPath,
      baselinePath: space.baseline,
      hostManifest: host(space.directory),
      root: space.directory
    }), /reference source recipient executable cannot serve as a design direction creator.*attempt 1/,
    "design must reject the retained failed graph, not only the accepted retry graph");
    assert.throws(() => startDesignExploration({
      statePath: space.statePath,
      briefPath: space.briefPath,
      baselinePath: space.baseline,
      hostManifest: host(space.directory),
      root: space.directory
    }), /reference source recipient executable cannot serve as a design direction creator.*attempt 1/);
    assert.equal(fs.existsSync(space.statePath), false);
    assert.equal(fs.existsSync(space.statePath.replace(/\.json$/, ".design")), false);
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
    const journeyDigest = state.journey_identity.identity_digest;
    assert.ok(state.packets.every((packet) =>
      packet.run_id === state.run_id &&
      packet.journey_identity.identity_digest === journeyDigest &&
      packet.participant.provider_id === packet.provider.id &&
      packet.participant.visibility === "internal" &&
      packet.participant.orchestrator_id === "kill-slop-router"));
    assert.equal(state.results.filter((item) => item.normalized.kind === "direction-candidate").length, 9);
    assert.equal(state.results.filter((item) => item.normalized.kind === "browser-evidence").length, 9);
    assert.ok(state.attempts.filter((item) => item.execution_status === "ran")
      .every((item) => Number.isInteger(item.child_pid) && item.child_pid > 0));
    assert.ok(state.attempts.filter((item) => item.execution_status === "ran")
      .every((item) =>
        item.metadata.observed_journey_identity_digest === journeyDigest &&
        item.metadata.observed_participant.provider_id === item.provider_id &&
        item.metadata.observed_participant.visibility === "internal"));

    const internalShortlist = path.join(
      state.state_directory,
      "templates",
      "design-shortlist.json"
    );
    assert.throws(() => resumeDesignExploration(space.statePath, {
      hostManifest: manifest,
      shortlistPath: internalShortlist
    }), /must be copied outside the design run state directory/);
    state = readDesignState(space.statePath);

    const browserActor = state.results.find((record) =>
      record.normalized.kind === "browser-evidence").normalized.actor.actor_id;
    for (const ownerId of [
      "kill-slop-router",
      "design-direction-critic",
      "browser-evidence",
      browserActor
    ]) {
      assert.throws(() => resumeDesignExploration(space.statePath, {
        hostManifest: manifest,
        shortlistPath: writeShortlist(space, state, ownerId)
      }), /must be external to the KillSlopRouter parent and every routed participant|cannot use the KillSlopRouter parent identity/,
      ownerId);
      state = readDesignState(space.statePath);
    }

    state = resumeDesignExploration(space.statePath, {
      hostManifest: host(space.directory, { color: { weak_contrast: true } }),
      shortlistPath: writeShortlist(space, state)
    });
    assert.equal(state.status, "blocked");
    assert.equal(state.phase, "color-generation");
    assert.ok(state.blockers.some((item) => item.includes("text_muted/canvas")));

    const underlyingDirectionActor = state.results.find((record) =>
      record.normalized.kind === "direction-candidate" &&
      record.normalized.candidate_id ===
        state.shortlist.normalized.candidate_ids[0]).normalized.actor.actor_id;
    state = resumeDesignExploration(space.statePath, {
      hostManifest: host(space.directory, {
        colorReview: { actor_id: underlyingDirectionActor }
      }),
      retry: "all"
    });
    assert.equal(state.status, "blocked");
    assert.equal(state.phase, "color-review");
    assert.match(state.blockers.join(" "), /downstream candidate derived from its work/);

    state = resumeDesignExploration(space.statePath, {
      hostManifest: manifest,
      retry: "color-review"
    });
    assert.equal(state.status, "manual_pending");
    assert.equal(state.phase, "owner-approval");
    assert.equal(state.results.filter((item) => item.normalized.kind === "color-candidate").length, 9);
    assert.equal(state.results.filter((item) => item.normalized.kind === "browser-evidence").length, 18);

    const internalApproval = path.join(
      state.state_directory,
      "templates",
      "design-owner-decision.json"
    );
    assert.throws(() => resumeDesignExploration(space.statePath, {
      hostManifest: manifest,
      approvalPath: internalApproval
    }), /must be copied outside the design run state directory/);
    state = readDesignState(space.statePath);

    const colorReviewActor = state.results.find((record) =>
      record.normalized.kind === "color-review").normalized.actor.actor_id;
    for (const ownerId of ["color-system-critic", colorReviewActor]) {
      assert.throws(() => resumeDesignExploration(space.statePath, {
        hostManifest: manifest,
        approvalPath: writeApproval(space, state, ownerId)
      }), /must be external to the KillSlopRouter parent and every routed participant|cannot use the KillSlopRouter parent identity/,
      ownerId);
      state = readDesignState(space.statePath);
    }

    const ownerGateState = fs.readFileSync(space.statePath, "utf8");
    const shortlistSourceDigest = hashArtifact(state.shortlist.source.resolved_path);
    resealDesignState(space.statePath, (forged) => {
      forged.shortlist.normalized.owner_id = "owner:forged-product-design";
      forged.shortlist.normalized.rationale =
        "A coherent state reseal must not replace the immutable owner shortlist.";
      forged.shortlist.shortlist_digest = canonicalDigest(forged.shortlist.normalized);
    });
    assert.throws(() => readDesignState(space.statePath),
      /design shortlist state binding mismatch/);
    assert.equal(hashArtifact(state.shortlist.source.resolved_path), shortlistSourceDigest);
    fs.writeFileSync(space.statePath, ownerGateState);
    state = readDesignState(space.statePath);

    const rejectedApprovalPath = writeRejectedApproval(space, state);
    const rejectedApprovalDigest = hashArtifact(rejectedApprovalPath);
    const rejected = resumeDesignExploration(space.statePath, {
      hostManifest: manifest,
      approvalPath: rejectedApprovalPath
    });
    assert.equal(rejected.status, "blocked");
    assert.equal(rejected.phase, "owner-approval");
    assert.equal(rejected.approval.normalized.status, "rejected");
    assert.equal(readDesignState(space.statePath).approval.normalized.status, "rejected");
    resealDesignState(space.statePath, (forged) => {
      forged.approval.normalized.status = "approved";
      forged.approval.normalized.note =
        "A coherent state reseal must not replace the immutable owner rejection.";
      forged.approval.approval_digest = canonicalDigest(forged.approval.normalized);
    });
    assert.throws(() => readDesignState(space.statePath),
      /design owner decision state binding mismatch/);
    assert.equal(hashArtifact(rejectedApprovalPath), rejectedApprovalDigest);
    fs.writeFileSync(space.statePath, ownerGateState);
    state = readDesignState(space.statePath);

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
    assert.equal(decision.journey_identity.identity_digest, journeyDigest);
    assert.equal(Object.hasOwn(decision.source_digests, "reference_pack"), false);
    assert.equal(Object.hasOwn(decision, "reference_intelligence_binding"), false);
    assert.ok(state.packets.every((packet) =>
      Object.hasOwn(packet.design_task, "reference_intelligence") === false));
    assert.ok(state.packets.every((packet) =>
      Object.hasOwn(packet, "forbidden_permissions") === false),
    "no-pack packets must preserve the legacy byte/API shape without forbidden_permissions");
    assert.ok(state.packets.filter((packet) => packet.stage_id === "browser-evidence")
      .every((packet) => !Object.hasOwn(packet.provider, "resolved_to")),
    "no-pack browser packets must preserve the legacy provider shape");
    assert.ok(state.attempts.filter((attempt) => attempt.packet_id.startsWith("browser-"))
      .every((attempt) => attempt.execution_status === "ran" &&
        attempt.adapter === "browser-json-v1"),
    "no-pack browser evidence must still be a KSR-run sealed adapter attempt");
    assert.deepEqual(Object.keys(decision.source_bindings).sort(), [
      "color_browser", "color_candidate", "color_review",
      "direction_browser", "direction_candidate", "direction_review"
    ]);
    for (const binding of Object.values(decision.source_bindings)) {
      assert.equal(binding.participant.provider_id, binding.provider_id);
      assert.equal(binding.participant.visibility, "internal");
      assert.equal(binding.participant.orchestrator_id, "kill-slop-router");
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
    assert.equal(bindings.journey_identity.identity_digest, journeyDigest);
    assert.equal(Object.hasOwn(bindings, "reference_intelligence_binding"), false);
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
    assert.equal(signatureReceipt.journey_identity.identity_digest, journeyDigest);
    const intentReceipt = JSON.parse(fs.readFileSync(
      state.outputs.visual_intent_receipt.resolved_path,
      "utf8"
    ));
    assert.equal(intentReceipt.journey_identity.identity_digest, journeyDigest);
    const evidencePaths = signatureReceipt.evidence.map((item) => item.path);
    assert.ok(evidencePaths.some((item) => item.endsWith("-fonts.json")));
    assert.ok(evidencePaths.some((item) => item.endsWith("-tokens.json")));
    assert.equal(evidencePaths.filter((item) => item.endsWith(".html")).length, 2);
    const paletteCoverage = signatureReceipt.coverage.find((item) => item.aspect === "palette");
    const typographyCoverage = signatureReceipt.coverage.find((item) => item.aspect === "typography");
    assert.ok(paletteCoverage.evidence_paths.some((item) => item.endsWith("-tokens.json")));
    assert.ok(typographyCoverage.evidence_paths.some((item) => item.endsWith("-fonts.json")));

    const forgedDecision = structuredClone(decision);
    forgedDecision.authority.basis =
      "A forged but internally consistent replacement that lacks external Owner authority.";
    const { decision_digest: _decisionDigest, ...forgedDecisionBody } = forgedDecision;
    forgedDecision.decision_digest = canonicalDigest(forgedDecisionBody);
    fs.writeFileSync(state.outputs.decision.resolved_path,
      `${JSON.stringify(forgedDecision, null, 2)}\n`);
    const forgedDecisionFileDigest = hashArtifact(state.outputs.decision.resolved_path);
    const forgedIntent = structuredClone(intentReceipt);
    const forgedSignature = structuredClone(signatureReceipt);
    for (const receipt of [forgedIntent, forgedSignature]) {
      receipt.authority.basis = forgedDecision.authority.basis;
      const decisionEvidence = receipt.evidence.find((item) =>
        item.kind === "owner-direction");
      decisionEvidence.digest = forgedDecisionFileDigest;
    }
    fs.writeFileSync(state.outputs.visual_intent_receipt.resolved_path,
      `${JSON.stringify(forgedIntent, null, 2)}\n`);
    fs.writeFileSync(state.outputs.visual_signature_receipt.resolved_path,
      `${JSON.stringify(forgedSignature, null, 2)}\n`);
    const forgedBindings = structuredClone(bindings);
    forgedBindings.decision.digest = forgedDecisionFileDigest;
    forgedBindings.visual_intent.authority_digest =
      hashArtifact(state.outputs.visual_intent_receipt.resolved_path);
    forgedBindings.visual_signature.authority_digest =
      hashArtifact(state.outputs.visual_signature_receipt.resolved_path);
    fs.writeFileSync(state.outputs.profile_bindings.resolved_path,
      `${JSON.stringify(forgedBindings, null, 2)}\n`);
    resealDesignState(space.statePath, (forged) => {
      forged.outputs = Object.fromEntries(Object.entries(forged.outputs).map(
        ([key, output]) => [key, snapshotArtifact(output.resolved_path, {
          root: forged.state_directory
        })]
      ));
      forged.final_receipt_digests = {
        visual_intent: forgedBindings.visual_intent.authority_digest,
        visual_signature: forgedBindings.visual_signature.authority_digest,
        decision: forgedBindings.decision.digest
      };
    });
    assert.throws(() => readDesignState(space.statePath),
      /design final output (content|bytes) conflicts with canonical state/,
    "a self-consistent four-file rewrite cannot replace the immutable Owner decision");
  } finally {
    fs.rmSync(space.directory, { recursive: true, force: true });
  }
});

test("final approval compilation rejects evidence changed after the owner checkpoint", () => {
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
    state = resumeDesignExploration(space.statePath, {
      hostManifest: manifest,
      shortlistPath: writeShortlist(space, state)
    });
    assert.equal(state.phase, "owner-approval");
    const selectedId = state.shortlist.normalized.candidate_ids[0];
    const selected = state.results.find((record) =>
      record.normalized.kind === "direction-candidate" &&
      record.normalized.candidate_id === selectedId);
    const prototype = selected.normalized.evidence.find((item) =>
      item.kind === "prototype").path;
    let changedAfterApprovalWrite = false;
    assert.throws(() => resumeDesignExploration(space.statePath, {
      hostManifest: manifest,
      approvalPath: writeApproval(space, state),
      faultInjector(point) {
        if (point !== "after-state-write-before-lease-commit" ||
          changedAfterApprovalWrite) return;
        const checkpoint = JSON.parse(fs.readFileSync(space.statePath, "utf8"));
        if (!checkpoint.approval || Object.keys(checkpoint.outputs || {}).length > 0) return;
        fs.appendFileSync(prototype, "\n<!-- changed after owner checkpoint -->\n");
        changedAfterApprovalWrite = true;
      }
    }), /design evidence .*changed after it was digest-bound|design result evidence state binding mismatch/);
    assert.equal(changedAfterApprovalWrite, true);
    const raw = JSON.parse(fs.readFileSync(space.statePath, "utf8"));
    assert.notEqual(raw.status, "complete");
    assert.deepEqual(raw.outputs, {});
    assert.equal(fs.existsSync(path.join(raw.state_directory, "approved")), false);
    assert.equal(fs.readdirSync(raw.state_directory)
      .some((name) => name.startsWith("approved.staging-")), false);
  } finally {
    fs.rmSync(space.directory, { recursive: true, force: true });
  }
});

test("final approval publish revalidates evidence and removes untrusted staging output", () => {
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
    state = resumeDesignExploration(space.statePath, {
      hostManifest: manifest,
      shortlistPath: writeShortlist(space, state)
    });
    const selectedId = state.shortlist.normalized.candidate_ids[0];
    const selected = state.results.find((record) =>
      record.normalized.kind === "direction-candidate" &&
      record.normalized.candidate_id === selectedId);
    const prototype = selected.normalized.evidence.find((item) =>
      item.kind === "prototype").path;
    let changedBeforePublish = false;
    assert.throws(() => resumeDesignExploration(space.statePath, {
      hostManifest: manifest,
      approvalPath: writeApproval(space, state),
      faultInjector(point) {
        if (point !== "before-final-approval-publish" || changedBeforePublish) return;
        fs.appendFileSync(prototype, "\n<!-- changed before approval publish -->\n");
        changedBeforePublish = true;
      }
    }), /design evidence .*changed after it was digest-bound|design result evidence state binding mismatch/);
    assert.equal(changedBeforePublish, true);
    const raw = JSON.parse(fs.readFileSync(space.statePath, "utf8"));
    assert.notEqual(raw.status, "complete");
    assert.deepEqual(raw.outputs, {});
    assert.equal(fs.existsSync(path.join(raw.state_directory, "approved")), false);
    assert.equal(fs.readdirSync(raw.state_directory)
      .some((name) => name.startsWith("approved.staging-")), false);
  } finally {
    fs.rmSync(space.directory, { recursive: true, force: true });
  }
});

test("creator self-review and unofficial browser evidence fail closed", () => {
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

  const unofficialBrowser = workspace();
  try {
    attachReferencePack(unofficialBrowser);
    const genericBrowser = provider("browser-json-v1", capabilities.browser, 3,
      ["artifact:read", "evidence:write", "browser:control"], {});
    const state = startDesignExploration({
      statePath: unofficialBrowser.statePath,
      briefPath: unofficialBrowser.briefPath,
      baselinePath: unofficialBrowser.baseline,
      hostManifest: host(unofficialBrowser.directory, {}, (manifest) => {
        manifest.providers["browser-evidence"] = genericBrowser;
      }),
      root: unofficialBrowser.directory
    });
    assert.equal(state.status, "manual_pending");
    assert.equal(state.phase, "direction-browser-evidence");
    assert.equal(state.results.filter((record) =>
      record.normalized.kind === "browser-evidence").length, 0);
    const browserAttempts = state.attempts.filter((attempt) =>
      attempt.packet_id.startsWith("browser-"));
    assert.equal(browserAttempts.length, 9);
    assert.ok(browserAttempts.every((attempt) =>
      attempt.execution_status === "manual_pending" && attempt.child_pid === undefined));
    assert.ok(browserAttempts.every((attempt) =>
      /digest-locked official Playwright/.test(attempt.reason)));

  } finally {
    fs.rmSync(unofficialBrowser.directory, { recursive: true, force: true });
  }

  const manualBrowser = workspace();
  try {
    const state = startDesignExploration({
      statePath: manualBrowser.statePath,
      briefPath: manualBrowser.briefPath,
      baselinePath: manualBrowser.baseline,
      hostManifest: host(manualBrowser.directory, {}, (manifest) => {
        manifest.providers["browser-evidence"] = {
          adapter: "manual-v1",
          capabilities: capabilities.browser,
          strength: 3,
          permissions: []
        };
      }),
      root: manualBrowser.directory
    });
    assert.equal(state.status, "manual_pending");
    assert.equal(state.phase, "direction-browser-evidence");
    const claimedManualResult = path.join(manualBrowser.directory,
      "claimed-browser-result.json");
    fs.writeFileSync(claimedManualResult, `${JSON.stringify({
      packet_id: state.packets.find((packet) =>
        packet.stage_id === "browser-evidence").packet_id
    }, null, 2)}\n`);
    assert.throws(() => resumeDesignExploration(manualBrowser.statePath, {
      resultPaths: [claimedManualResult]
    }), /browser result cannot be manually recorded/);
    assert.equal(readDesignState(manualBrowser.statePath).results.filter((record) =>
      record.normalized.kind === "browser-evidence").length, 0);
  } finally {
    fs.rmSync(manualBrowser.directory, { recursive: true, force: true });
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

test("overlapping design resume is rejected before a second child starts", async () => {
  const space = workspace();
  try {
    startDesignExploration({
      statePath: space.statePath,
      briefPath: space.briefPath,
      baselinePath: space.baseline,
      root: space.directory
    });
    const marker = path.join(space.directory, "slow-child-started.txt");
    const slowAdapter = writeSlowFailingAdapter(space, marker);
    const configured = host(space.directory, {
      direction: { spawn_marker: marker }
    }, (manifest) => {
      const declaration = manifest.providers["design-direction-agent"];
      declaration.entrypoint = slowAdapter;
      declaration.entrypoint_digest = hashArtifact(slowAdapter);
      declaration.entrypoint_graph_digest = sealedEntrypointGraphDigest(slowAdapter);
      declaration.timeout_ms = 5_000;
    });
    const first = spawn(process.execPath, [
      cli, "design", "run", "--resume", space.statePath,
      "--host-config", configured.manifest_path, "--json"
    ], { encoding: "utf8" });
    let firstStdout = "";
    let firstStderr = "";
    first.stdout.on("data", (chunk) => { firstStdout += chunk; });
    first.stderr.on("data", (chunk) => { firstStderr += chunk; });
    assert.equal(await waitFor(() => fs.existsSync(marker)), true,
      "first design resume did not start its child");
    const second = spawnSync(process.execPath, [
      cli, "design", "run", "--resume", space.statePath,
      "--host-config", configured.manifest_path, "--json"
    ], { encoding: "utf8" });
    assert.equal(second.status, 5, second.stderr);
    assert.match(second.stderr, /active automation state lease blocks design-resume/);
    assert.equal(fs.readFileSync(marker, "utf8").trim().split("\n").length, 1,
      "overlapping resume must not start another child");
    const firstStatus = await new Promise((resolve, reject) => {
      first.once("error", reject);
      first.once("close", resolve);
    });
    assert.equal(firstStatus, 5, firstStderr || firstStdout);
    assert.equal(inspectDesignStateLease(space.statePath).status, "unlocked");
  } finally {
    fs.rmSync(space.directory, { recursive: true, force: true });
  }
});

test("design CLI inspects and recovers a stale child lease before explicit retry", () => {
  const space = workspace();
  try {
    const crashRunner = writeDesignCrashRunner(space);
    const configured = host(space.directory, {}, (manifest) => {
      manifest.providers["design-direction-agent"].timeout_ms = CHECKPOINT_CHILD_TIMEOUT_MS;
    });
    const crashed = spawnSync(process.execPath, [
      crashRunner, "start", "before-spawn", space.briefPath, space.baseline,
      space.statePath, configured.manifest_path, space.directory
    ], { encoding: "utf8" });
    assert.equal(crashed.status, 73, crashed.stderr);
    let lease = inspectDesignStateLease(space.statePath);
    assert.equal(lease.status, "locked");
    assert.equal(lease.phase, "child-execution");
    assert.equal(lease.owner_process_alive, false);
    const inspected = spawnSync(process.execPath, [
      cli, "design", "lease-status",
      "--state", space.statePath,
      "--json"
    ], { encoding: "utf8" });
    assert.equal(inspected.status, 0, inspected.stderr);
    assert.deepEqual(JSON.parse(inspected.stdout), lease);
    assert.throws(() => recoverDesignStateLease(space.statePath, {
      ownerToken: `${lease.owner_token}-wrong`,
      acquiredAt: lease.acquired_at,
      stateDigest: lease.state_digest
    }), /owner token does not match/);
    assert.throws(() => resumeDesignExploration(space.statePath),
      /active automation state lease blocks design-resume/);
    waitPast(lease.recover_after);
    const recoveryProcess = spawnSync(process.execPath, [
      cli, "design", "recover",
      "--state", space.statePath,
      "--owner-token", lease.owner_token,
      "--acquired-at", lease.acquired_at,
      "--state-digest", lease.state_digest,
      "--json"
    ], { encoding: "utf8" });
    assert.equal(recoveryProcess.status, 0, recoveryProcess.stderr);
    const recovered = JSON.parse(recoveryProcess.stdout);
    assert.equal(recovered.recovery.outcome, "abandoned_after_crash");
    assert.equal(recovered.recovery.retry_required, true);
    assert.equal(inspectDesignStateLease(space.statePath).status, "unlocked");
    let state = readDesignState(space.statePath);
    const abandonedPacket = recovered.recovery.abandoned_packet.packet_id;
    assert.equal(state.phase, "design-recovery");
    assert.equal(state.in_flight, null);
    assert.equal(state.lease_recoveries.length, 1);
    assert.ok(state.attempts.some((item) =>
      item.packet_id === abandonedPacket &&
      item.execution_status === "blocked_abandoned_after_crash"));

    state = resumeDesignExploration(space.statePath, { hostManifest: configured });
    assert.equal(state.status, "blocked");
    assert.equal(state.results.find((item) => item.packet_id === abandonedPacket), undefined);
    state = resumeDesignExploration(space.statePath, {
      hostManifest: configured,
      retry: abandonedPacket
    });
    assert.equal(state.status, "manual_pending");
    assert.equal(state.phase, "direction-selection");
    assert.equal(state.attempts.filter((item) =>
      item.packet_id === abandonedPacket && item.execution_status === "ran").length, 1);
  } finally {
    fs.rmSync(space.directory, { recursive: true, force: true });
  }
});

test("post-child design checkpoint recovery does not rerun an accepted child", () => {
  const space = workspace();
  try {
    const crashRunner = writeDesignCrashRunner(space);
    const configured = host(space.directory, {}, (manifest) => {
      manifest.providers["design-direction-agent"].timeout_ms = CHECKPOINT_CHILD_TIMEOUT_MS;
    });
    const crashed = spawnSync(process.execPath, [
      crashRunner, "start", "post-child-checkpoint", space.briefPath, space.baseline,
      space.statePath, configured.manifest_path, space.directory
    ], { encoding: "utf8" });
    assert.equal(crashed.status, 74, crashed.stderr);
    let state = readDesignState(space.statePath);
    assert.equal(state.in_flight, null);
    assert.equal(state.results.length, 1);
    assert.equal(state.attempts.length, 1);
    assert.equal(state.attempts[0].execution_status, "ran");
    const completedPacket = state.attempts[0].packet_id;
    const lease = inspectDesignStateLease(space.statePath);
    assert.equal(lease.phase, "child-execution");
    waitPast(lease.recover_after);
    const recovered = recoverDesignStateLease(space.statePath, {
      ownerToken: lease.owner_token,
      acquiredAt: lease.acquired_at,
      stateDigest: lease.state_digest
    });
    assert.equal(recovered.recovery.outcome, "checkpoint_recovered");
    assert.equal(recovered.recovery.retry_required, false);
    state = resumeDesignExploration(space.statePath, { hostManifest: configured });
    assert.equal(state.status, "manual_pending");
    assert.equal(state.phase, "direction-selection");
    assert.equal(state.attempts.filter((item) =>
      item.packet_id === completedPacket && item.execution_status === "ran").length, 1);
  } finally {
    fs.rmSync(space.directory, { recursive: true, force: true });
  }
});

test("fault-injected design state writes retain a recoverable exclusive lease", () => {
  for (const [crashPoint, exitCode] of [
    ["state-before-commit", 78],
    ["state-after-write", 79]
  ]) {
    const space = workspace();
    try {
      startDesignExploration({
        statePath: space.statePath,
        briefPath: space.briefPath,
        baselinePath: space.baseline,
        root: space.directory
      });
      const before = readDesignState(space.statePath).state_digest;
      const crashRunner = writeDesignCrashRunner(space);
      const crashed = spawnSync(process.execPath, [
        crashRunner, "resume", crashPoint, space.briefPath, space.baseline,
        space.statePath, "", space.directory
      ], { encoding: "utf8" });
      assert.equal(crashed.status, exitCode, `${crashPoint}: ${crashed.stderr}`);
      const lease = inspectDesignStateLease(space.statePath);
      assert.equal(lease.status, "locked", crashPoint);
      assert.equal(lease.phase, "state-write", crashPoint);
      assert.ok(lease.bound_state_digests.includes(before), crashPoint);
      assert.ok(lease.bound_state_digests.includes(lease.state_digest), crashPoint);
      assert.throws(() => resumeDesignExploration(space.statePath),
        /active automation state lease blocks design-resume/);
      waitPast(lease.recover_after);
      const recovered = recoverDesignStateLease(space.statePath, {
        ownerToken: lease.owner_token,
        acquiredAt: lease.acquired_at,
        stateDigest: lease.state_digest
      });
      assert.equal(recovered.recovery.outcome, "checkpoint_recovered", crashPoint);
      assert.equal(inspectDesignStateLease(space.statePath).status, "unlocked", crashPoint);
      const state = readDesignState(space.statePath);
      assert.equal(state.in_flight, null, crashPoint);
      assert.equal(state.lease_recoveries.length, 1, crashPoint);
    } finally {
      fs.rmSync(space.directory, { recursive: true, force: true });
    }
  }
});

test("pending and published final approval writes recover without duplicate publication", () => {
  for (const [crashPoint, exitCode, publishedBeforeCrash] of [
    ["pending-finalization-state-before-commit", 82, false],
    ["pending-finalization-state-after-write", 83, false],
    ["finalization-state-before-commit", 80, true],
    ["finalization-state-after-write", 81, true]
  ]) {
    const space = workspace();
    try {
      const configured = host(space.directory);
      let state = startDesignExploration({
        statePath: space.statePath,
        briefPath: space.briefPath,
        baselinePath: space.baseline,
        hostManifest: configured,
        root: space.directory
      });
      state = resumeDesignExploration(space.statePath, {
        hostManifest: configured,
        shortlistPath: writeShortlist(space, state)
      });
      assert.equal(state.phase, "owner-approval", crashPoint);
      const approvalPath = writeApproval(space, state);
      const crashRunner = writeDesignCrashRunner(space);
      const crashed = spawnSync(process.execPath, [
        crashRunner, "resume", crashPoint, space.briefPath, space.baseline,
        space.statePath, configured.manifest_path, space.directory,
        "", "", "", approvalPath
      ], { encoding: "utf8" });
      assert.equal(crashed.status, exitCode, `${crashPoint}: ${crashed.stderr}`);
      const lease = inspectDesignStateLease(space.statePath);
      assert.equal(lease.status, "locked", crashPoint);
      assert.equal(lease.phase, "state-write", crashPoint);
      assert.equal(fs.existsSync(path.join(state.state_directory, "approved")),
        publishedBeforeCrash, crashPoint);
      assert.equal(fs.existsSync(path.join(state.state_directory, "approved.staging")),
        !publishedBeforeCrash, crashPoint);
      assert.throws(() => resumeDesignExploration(space.statePath),
        /active automation state lease blocks design-resume/);
      waitPast(lease.recover_after);
      const recovered = recoverDesignStateLease(space.statePath, {
        ownerToken: lease.owner_token,
        acquiredAt: lease.acquired_at,
        stateDigest: lease.state_digest
      });
      assert.equal(recovered.recovery.outcome, "checkpoint_recovered", crashPoint);
      state = resumeDesignExploration(space.statePath, { hostManifest: configured });
      assert.equal(state.status, "complete", crashPoint);
      assert.equal(state.phase, "complete", crashPoint);
      assert.equal(state.pending_finalization, null, crashPoint);
      assert.deepEqual(fs.readdirSync(path.join(state.state_directory, "approved")).sort(),
        Object.values({
          decision: "design-direction-decision.json",
          intent: "visual-intent-approval.json",
          signature: "visual-signature-approval.json",
          bindings: "profile-bindings.json"
        }).sort(), crashPoint);
      assert.equal(inspectDesignStateLease(space.statePath).status, "unlocked", crashPoint);
      const bindings = JSON.parse(fs.readFileSync(
        state.outputs.profile_bindings.resolved_path, "utf8"
      ));
      assert.equal(bindings.decision.digest, state.final_receipt_digests.decision,
        crashPoint);
    } finally {
      fs.rmSync(space.directory, { recursive: true, force: true });
    }
  }
});

test("resealed design packet, result, evidence, and accepted-attempt lineage tamper fails closed", () => {
  const space = workspace();
  try {
    startDesignExploration({
      statePath: space.statePath,
      briefPath: space.briefPath,
      baselinePath: space.baseline,
      hostManifest: host(space.directory),
      root: space.directory
    });
    const original = fs.readFileSync(space.statePath, "utf8");
    const tamperState = (mutate) => {
      const state = JSON.parse(original);
      mutate(state);
      const { state_digest: _digest, ...body } = state;
      state.state_digest = canonicalDigest(body);
      fs.writeFileSync(space.statePath, `${JSON.stringify(state, null, 2)}\n`);
    };

    tamperState((state) => {
      const packet = state.packets[0];
      packet.design_task.project.user_job = "attacker rewrote the packet";
      const { packet_digest: _digest, ...body } = packet;
      packet.packet_digest = canonicalDigest(body);
    });
    assert.throws(() => readDesignState(space.statePath),
      /design packet source conflicts with cached packet/);
    fs.writeFileSync(space.statePath, original);

    tamperState((state) => {
      state.results[0].provider_id = "attacker-provider";
    });
    assert.throws(() => readDesignState(space.statePath),
      /design result provider conflicts with its packet/);
    fs.writeFileSync(space.statePath, original);

    tamperState((state) => {
      state.results[0].evidence[0].evidence_kind = "test-report";
    });
    assert.throws(() => readDesignState(space.statePath),
      /design result evidence state binding mismatch/);
    fs.writeFileSync(space.statePath, original);

    tamperState((state) => {
      const record = state.results[0];
      const attempt = state.attempts.find((item) =>
        item.packet_id === record.packet_id && item.result_digest === record.result_digest);
      attempt.provider_id = "attacker-provider";
    });
    assert.throws(() => readDesignState(space.statePath),
      /design attempt execution lineage conflicts with packet|exactly one packet-bound accepted attempt/);
    fs.writeFileSync(space.statePath, original);

    for (const mutateAttempt of [
      (attempt) => { attempt.strength += 1; },
      (attempt) => { attempt.capabilities = [...attempt.capabilities, "forged-capability"]; },
      (attempt) => { attempt.permission_scopes = [...attempt.permission_scopes, "network:external"]; },
      (attempt) => { attempt.host_manifest_digest = `sha256:${"0".repeat(64)}`; },
      (attempt) => { attempt.adapter_entrypoint.digest = `sha256:${"0".repeat(64)}`; },
      (attempt) => {
        attempt.execution_authority.provider_declaration_digest =
          `sha256:${"1".repeat(64)}`;
        const { authority_digest: _authorityDigest, ...authorityBody } =
          attempt.execution_authority;
        attempt.execution_authority.authority_digest = canonicalDigest(authorityBody);
      }
    ]) {
      tamperState((state) => {
        const attempt = state.attempts.find((item) =>
          item.execution_status === "ran" && item.execution_authority);
        assert.ok(attempt);
        mutateAttempt(attempt);
      });
      assert.throws(() => readDesignState(space.statePath),
        /execution authority|packet authority|host manifest/);
      fs.writeFileSync(space.statePath, original);
    }

    tamperState((state) => {
      const ran = state.attempts.filter((item) =>
        item.execution_status === "ran" && item.execution_authority);
      const first = ran[0];
      const laterOnSameHost = ran.slice(1).find((item) =>
        item.execution_authority.host_manifest.digest ===
          first.execution_authority.host_manifest.digest &&
        item.execution_authority.host_manifest.physical_identity_digest ===
          first.execution_authority.host_manifest.physical_identity_digest);
      assert.ok(laterOnSameHost,
        "cache regression requires two accepted attempts under one immutable host manifest");
      laterOnSameHost.execution_authority.provider_declaration_digest =
        `sha256:${"8".repeat(64)}`;
      const { authority_digest: _authorityDigest, ...authorityBody } =
        laterOnSameHost.execution_authority;
      laterOnSameHost.execution_authority.authority_digest =
        canonicalDigest(authorityBody);
    });
    assert.throws(() => readDesignState(space.statePath),
      /execution authority conflicts with its host manifest/,
      "per-read host caching must still verify each attempt's declaration binding");
    fs.writeFileSync(space.statePath, original);
  } finally {
    fs.rmSync(space.directory, { recursive: true, force: true });
  }
});

test("per-read authority caching revalidates nested module graphs at its final boundary", () => {
  const space = workspace();
  try {
    const adapter = writeDependencyBackedDesignAdapter(space);
    const manifest = host(space.directory, {}, (raw) => {
      const declaration = raw.providers["design-direction-agent"];
      declaration.entrypoint = adapter.entrypoint;
      declaration.entrypoint_digest = hashArtifact(adapter.entrypoint);
      declaration.entrypoint_graph_digest = sealedEntrypointGraphDigest(
        adapter.entrypoint
      );
    });
    const state = startDesignExploration({
      statePath: space.statePath,
      briefPath: space.briefPath,
      baselinePath: space.baseline,
      hostManifest: manifest,
      root: space.directory
    });
    assert.equal(state.status, "manual_pending");
    assert.ok(state.attempts.filter((attempt) =>
      attempt.execution_status === "ran" &&
      attempt.host_manifest_digest === manifest.manifest_digest).length > 1);

    let changed = false;
    assert.throws(() => readDesignState(space.statePath, {
      faultInjector(point) {
        if (point !== "before-final-read-authority-cache-verification" || changed) return;
        fs.appendFileSync(adapter.dependency,
          "export const changedDuringRead = true;\n");
        changed = true;
      }
    }), /module graph digest mismatch|module graph changed before final boundary/);
    assert.equal(changed, true);
  } finally {
    fs.rmSync(space.directory, { recursive: true, force: true });
  }
});

test("contrast ratios are recomputed locally instead of trusting adapter claims", () => {
  assert.ok(contrastRatio("#0F172A", "#FFFFFF") > 10);
  assert.ok(contrastRatio("#CBD5E1", "#FFFFFF") < 2);
});
