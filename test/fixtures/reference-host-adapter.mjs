import fs from "node:fs";
import path from "node:path";
import {
  identitiesMatch,
  verifyJourneyIdentity,
  verifyPacketJourney,
  verifyParticipant
} from "../../src/identity.mjs";
import {
  referenceCaptureBytes,
  referenceMetadataBytes
} from "./reference-source-fixture.mjs";

let source = "";
for await (const chunk of process.stdin) source += chunk;
const request = JSON.parse(source);
const { packet, settings = {} } = request;

verifyJourneyIdentity(request.journey_identity, {
  runId: request.run_id,
  label: "reference fixture journey_identity"
});
verifyPacketJourney(packet, request.journey_identity, "reference fixture packet");
if (!identitiesMatch(packet.journey_identity, request.journey_identity)) {
  throw new Error("reference fixture packet conflicts with its KillSlopRouter journey");
}
verifyParticipant(request.participant, {
  providerId: packet.provider.id,
  stageId: packet.stage_id,
  role: packet.participant.role,
  label: "reference fixture participant"
});

if (settings.delay_ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, settings.delay_ms);
}

function write(name, content) {
  fs.writeFileSync(path.join(request.output_directory, name), content);
  return name;
}

function evidence(kind, id, body, binding = null) {
  const extension = kind === "source-capture" ? ".png" : ".json";
  const content = kind === "source-capture"
    ? body
    : Buffer.isBuffer(body) ? body : JSON.stringify(body);
  return {
    evidence_id: id,
    kind,
    path: write(`${id}${extension}`, content),
    ...(binding || {})
  };
}

const referenceDefinitions = [
  {
    reference_id: "flowdesk-results",
    app_name: "Flowdesk",
    product_category: "commerce comparison",
    screen_family: "results",
    component_families: ["tabs", "comparison-table"],
    patterns: ["progressive-disclosure"],
    screenRole: "transactional",
    evidenceStrength: "strong",
    ecosystem: "flowdesk",
    cohorts: ["task-fit", "high-bookmark"],
    popularity: 96,
    fitDimensions: { user: 5, task: 5, screen: 5, trust: 4, density: 4, locale: 5 }
  },
  {
    reference_id: "marketline-proof",
    app_name: "Marketline",
    product_category: "verified marketplace",
    screen_family: "results",
    component_families: ["comparison-table", "evidence-panel"],
    patterns: ["confidence-disclosure"],
    screenRole: "operational",
    evidenceStrength: "strong",
    ecosystem: "marketline",
    cohorts: ["task-fit", "high-reach"],
    popularity: 84,
    fitDimensions: { user: 5, task: 5, screen: 5, trust: 5, density: 4, locale: 5 }
  },
  {
    reference_id: "proofgrid-offers",
    app_name: "Proofgrid",
    product_category: "offer verification",
    screen_family: "results",
    component_families: ["tabs", "evidence-panel"],
    patterns: ["progressive-disclosure", "confidence-disclosure"],
    screenRole: "operational",
    evidenceStrength: "strong",
    ecosystem: "proofgrid",
    cohorts: ["cross-domain", "high-bookmark"],
    popularity: 72,
    fitDimensions: { user: 5, task: 5, screen: 4, trust: 4, density: 4, locale: 5 }
  },
  {
    reference_id: "megashop-ranking",
    app_name: "Megashop",
    product_category: "general shopping",
    screen_family: "ranked listing",
    component_families: ["tabs", "comparison-table", "evidence-panel"],
    patterns: ["progressive-disclosure", "confidence-disclosure"],
    screenRole: "transactional",
    evidenceStrength: "strong",
    ecosystem: "megashop",
    cohorts: ["competent-baseline", "high-reach"],
    popularity: 100,
    fitDimensions: { user: 4, task: 4, screen: 2, trust: 3, density: 3, locale: 4 }
  }
];

function fitScore(dimensions) {
  return Math.round((Object.values(dimensions).reduce((sum, value) => sum + value, 0) / 30) * 100);
}

function isPromotionalOnly(item) {
  const explicitCount = Number.isInteger(settings.promotional_reference_count)
    ? settings.promotional_reference_count
    : settings.promotional_first ? 1 : 0;
  return referenceDefinitions.indexOf(item) < explicitCount;
}

function familyFor(item) {
  const familyId = `family-${item.reference_id}`;
  if (isPromotionalOnly(item)) {
    return {
      family_id: familyId,
      frame_count: 1,
      core_task_frame_count: 0,
      state_frame_count: 0,
      promotional_frame_count: 1,
      frames: [{
        frame_id: `frame-${item.reference_id}-primary`,
        role: "promotional",
        core_task: false,
        state: false
      }]
    };
  }
  if (settings.single_frame_first && item === referenceDefinitions[0]) {
    return {
      family_id: familyId,
      frame_count: 1,
      core_task_frame_count: 1,
      state_frame_count: 0,
      promotional_frame_count: 0,
      frames: [{
        frame_id: `frame-${item.reference_id}-primary`,
        role: item.screenRole,
        core_task: true,
        state: false
      }]
    };
  }
  if (settings.mixed_promotional_first && item === referenceDefinitions[0]) {
    return {
      family_id: familyId,
      frame_count: 2,
      core_task_frame_count: 1,
      state_frame_count: 0,
      promotional_frame_count: 1,
      frames: [{
        frame_id: `frame-${item.reference_id}-primary`,
        role: item.screenRole,
        core_task: true,
        state: false
      }, {
        frame_id: `frame-${item.reference_id}-promo`,
        role: "promotional",
        core_task: false,
        state: false
      }]
    };
  }
  return {
    family_id: familyId,
    frame_count: 2,
    core_task_frame_count: 1,
    state_frame_count: 1,
    promotional_frame_count: 0,
    frames: [{
      frame_id: `frame-${item.reference_id}-primary`,
      role: item.screenRole,
      core_task: true,
      state: false
    }, {
      frame_id: `frame-${item.reference_id}-state`,
      role: "state",
      core_task: false,
      state: true
    }]
  };
}

function discoveryResult() {
  const evidenceItems = referenceDefinitions.flatMap((item, index) => {
    const family = familyFor(item);
    const screenRecordId = settings.duplicate_source_identity &&
      index === referenceDefinitions.length - 1
      ? referenceDefinitions[0].reference_id : item.reference_id;
    const binding = {
        reference_id: settings.misbind_first_evidence && index === 0
          ? referenceDefinitions[1].reference_id : item.reference_id,
        product_record_id: `product-${item.reference_id}`,
        screen_record_id: screenRecordId,
        frame_ids: family.frames.map((frame) => frame.frame_id),
        subject_bindings: [{
          subject_kind: "screen",
          subject_record_id: screenRecordId
        }, {
          subject_kind: "product",
          subject_record_id: settings.wrong_product_evidence_subject && index === 0
            ? "product-not-flowdesk" : `product-${item.reference_id}`
        }]
      };
    const popularityRecords = packet.reference_task.popularity_prior.signals.map((signal) => ({
      record_kind: "signal",
      signal_id: signal.id,
      metric: signal.metric,
      subject_kind: signal.subject_kind,
      subject_record_id: signal.subject_kind === "product"
        ? `product-${item.reference_id}` : item.reference_id,
      raw_value: settings.metric_specific_popularity && signal.metric === "bookmark-count"
        ? 100 - item.popularity : item.popularity,
      scope: signal.scope,
      category: signal.category,
      as_of: "2026-09-04T01:00:00.000Z",
      snapshot_at: "2026-09-04T01:00:00.000Z",
      normalization: signal.normalization,
      evidence_ids: [`metadata-${item.reference_id}`]
    }));
    if (settings.popularity_conflict_first && index === 0) {
      const signal = packet.reference_task.popularity_prior.signals[0];
      popularityRecords.push({
        record_kind: "conflict",
        signal_id: signal.id,
        subject_kind: signal.subject_kind,
        subject_record_id: signal.subject_kind === "product"
          ? `product-${item.reference_id}` : item.reference_id,
        raw_value: item.popularity + 10,
        as_of: "2026-09-03T01:00:00.000Z",
        evidence_ids: [`metadata-${item.reference_id}`]
      });
    }
    const metadata = referenceMetadataBytes({
      productRecordId: `product-${item.reference_id}`,
      screenRecordId: item.reference_id,
      capturedAt: "2026-09-04T01:00:00.000Z",
      frames: family.frames,
      popularityRecords
    });
    if (settings.fabricated_source_evidence_first && index === 0) {
      metadata[metadata.length - 2] ^= 1;
    }
    return [
      ...(!settings.metadata_only ? [
        evidence("source-capture", `source-${item.reference_id}`,
          referenceCaptureBytes(index), binding)
      ] : []),
      evidence("source-metadata", `metadata-${item.reference_id}`, metadata, binding)
    ];
  });
  return {
    reference_result_version: 1,
    kind: "reference-discovery",
    packet_id: packet.packet_id,
    provider_id: packet.provider.id,
    actor: {
      actor_id: settings.actor_id || "researcher:uibowl-discovery",
      kind: "agent"
    },
    status: "completed",
    packet_digest: packet.packet_digest,
    references: referenceDefinitions.map((item, index) => ({
      reference_id: item.reference_id,
      source: {
        provider: "uibowl",
        uri: settings.duplicate_source_identity && index === referenceDefinitions.length - 1
          ? `https://uibowl.io/reference/${referenceDefinitions[0].reference_id}`
          : `https://uibowl.io/reference/${item.reference_id}`,
        record_id: settings.duplicate_source_identity && index === referenceDefinitions.length - 1
          ? referenceDefinitions[0].reference_id : item.reference_id,
        product_record_id: `product-${item.reference_id}`,
        screen_record_id: settings.duplicate_source_identity && index === referenceDefinitions.length - 1
          ? referenceDefinitions[0].reference_id : item.reference_id,
        captured_at: "2026-09-04T01:00:00.000Z"
      },
      app_name: item.app_name,
      product_category: item.product_category,
      screen_family: item.screen_family,
      platform: "responsive",
      environment_of_use: "Personal device used during deliberate price comparison.",
      business_model: "Marketplace or comparison service.",
      session_shape: "multi-session",
      locale: "ko-KR",
      sampled_because: item.cohorts.includes("task-fit")
        ? "Task-fit evidence for comparable result hierarchy."
        : item.cohorts.includes("cross-domain")
          ? "Cross-domain evidence used to challenge task-fit conclusions."
          : "Competent baseline used to detect unnecessary novelty.",
      family: familyFor(item),
      screen_role: isPromotionalOnly(item)
        ? "promotional" : item.screenRole,
      evidence_strength: isPromotionalOnly(item)
        ? "weak" : item.evidenceStrength,
      sampling: {
        ecosystem_id: settings.duplicate_ecosystem && item === referenceDefinitions[3]
          ? referenceDefinitions[0].ecosystem : item.ecosystem,
        cohorts: item.cohorts
      },
      component_families: item.component_families,
      patterns: item.patterns,
      observed: [{
        observation_id: `obs-${item.reference_id}`,
        frame_id: `frame-${item.reference_id}-primary`,
        frame_role: isPromotionalOnly(item)
          ? "promotional" : item.screenRole,
        kind: "hierarchy",
        priority: "primary",
        statement: "The result identity, comparable value, confidence, and drill-down evidence have visibly different priority.",
        evidence_ids: [`${settings.metadata_only ? "metadata" : "source"}-${item.reference_id}`]
      }, ...(settings.mixed_promotional_first && item === referenceDefinitions[0] ? [{
        observation_id: `obs-${item.reference_id}-promo`,
        frame_id: `frame-${item.reference_id}-promo`,
        frame_role: "promotional",
        kind: "hierarchy",
        priority: "primary",
        statement: "A promotional frame gives brand expression visual priority.",
        evidence_ids: [`${settings.metadata_only ? "metadata" : "source"}-${item.reference_id}`]
      }] : [])],
      popularity: {
        status: settings.popularity_conflict_first && item === referenceDefinitions[0]
          ? "conflicted" : "verified-snapshot",
        signals: packet.reference_task.popularity_prior.signals.map((signal) => {
          const rawValue = settings.metric_specific_popularity &&
            signal.metric === "bookmark-count"
            ? 100 - item.popularity : item.popularity;
          const normalization = settings.arbitrary_popularity_normalization && index === 0
            ? { ...signal.normalization, upper_bound: signal.normalization.upper_bound * 2 }
            : signal.normalization;
          const bounded = Math.min(normalization.upper_bound,
            Math.max(normalization.lower_bound, rawValue));
          const ratio = (bounded - normalization.lower_bound) /
            (normalization.upper_bound - normalization.lower_bound);
          const normalizedScore = Number(((normalization.direction === "higher-is-better"
            ? ratio : 1 - ratio) * 100).toFixed(6));
          return {
            id: signal.id,
            metric: signal.metric,
            raw_value: rawValue,
            normalized_score: settings.forged_popularity_score && index === 0
              ? Math.min(100, normalizedScore + 1) : normalizedScore,
            scope: settings.arbitrary_popularity_scope && index === 0
              ? "Unbound arbitrary collection" : signal.scope,
            category: signal.category,
            as_of: "2026-09-04T01:00:00.000Z",
            subject_kind: signal.subject_kind,
            subject_record_id: signal.subject_kind === "product"
              ? `product-${item.reference_id}` : item.reference_id,
            snapshot_at: "2026-09-04T01:00:00.000Z",
            normalization,
            evidence_ids: [`metadata-${item.reference_id}`]
          };
        }),
        conflicts: settings.popularity_conflict_first && item === referenceDefinitions[0]
          ? [{
              signal_id: packet.reference_task.popularity_prior.signals[0].id,
              subject_kind: packet.reference_task.popularity_prior.signals[0].subject_kind,
              subject_record_id:
                packet.reference_task.popularity_prior.signals[0].subject_kind === "product"
                  ? `product-${item.reference_id}` : item.reference_id,
              raw_value: item.popularity + 10,
              as_of: "2026-09-03T01:00:00.000Z",
              note: "A second UI Bowl record reports a different value; do not rank it as verified.",
              evidence_ids: [`metadata-${item.reference_id}`]
            }]
          : []
      },
      rights: {
        status: "reference-only",
        redistribution: false,
        creator_pixel_access: false
      }
    })),
    evidence: evidenceItems
  };
}

const dimensions = [
  "information-hierarchy", "navigation", "data-comparison", "evidence-presentation",
  "typography", "color-roles", "density", "responsive"
];

function grammarResult() {
  const discovery = request.prior_results.find((item) => item.kind === "reference-discovery");
  const report = evidence("analysis-report", "grammar-analysis", {
    references: discovery.references.map((item) => item.reference_id)
  });
  const references = discovery.references.map((reference) => {
    const definition = referenceDefinitions.find((item) => item.reference_id === reference.reference_id);
    const score = fitScore(definition.fitDimensions);
    const fit = score >= 80 ? "exact" : score >= 50 ? "adjacent" : "weak";
    const grammarObservationId = settings.cite_promotional_observation &&
      reference.reference_id === referenceDefinitions[0].reference_id
      ? `obs-${reference.reference_id}-promo`
      : `obs-${reference.reference_id}`;
    const reasoningObservationId = settings.reasoning_cites_promotional_observation &&
      reference.reference_id === referenceDefinitions[0].reference_id
      ? `obs-${reference.reference_id}-promo`
      : `obs-${reference.reference_id}`;
    const referenceDimensions = reference.screen_role === "promotional" &&
      !settings.promotional_operational_overclaim
      ? ["typography", "color-roles", "density"] : dimensions;
    return {
      reference_id: reference.reference_id,
      product_fit: {
        band: fit,
        score,
        dimensions: definition.fitDimensions,
        rationale: "The pattern supports dense comparison while keeping evidence and uncertainty inspectable.",
        observed_ids: [`obs-${reference.reference_id}`]
      },
      inferred_rationale: [{
        inference_id: `why-${reference.reference_id}`,
        statement: "The hierarchy likely reduces comparison effort by separating primary value from proof detail.",
        confidence: "medium",
        observed_ids: [`obs-${reference.reference_id}`]
      }],
      locale_analysis: {
        source_locale: reference.locale,
        target_locales: [...packet.reference_task.locales],
        transferability: settings.unsupported_locale &&
          reference.reference_id === referenceDefinitions[0].reference_id
          ? "unsupported" : "direct",
        risks: ["Long Korean labels and numeric conditions can change wrapping and scan order."],
        verification_requirements: [
          "Verify every target locale in the later browser and font evidence gates."
        ]
      },
      hierarchy_reasoning: [{
        reasoning_id: `hierarchy-${reference.reference_id}`,
        observed_priority: "primary",
        user_decision: settings.source_style_literal &&
          reference.reference_id === referenceDefinitions[0].reference_id
          ? "Choose the #0A84FF action at 12px before opening proof detail."
          : "Choose which offer deserves inspection before opening proof detail.",
        likely_constraint: "Comparable value and uncertainty must remain scannable across repeated offers.",
        consequence_if_flattened: "Price, evidence, and secondary metadata would compete and slow trustworthy comparison.",
        confidence: "medium",
        observed_ids: [reasoningObservationId]
      }],
      grammar: referenceDimensions.map((dimension) => ({
        grammar_id: `grammar-${reference.reference_id}-${dimension}`,
        dimension,
        principle: `${dimension} should make the main comparison and its confidence legible at a glance.`,
        application: `Apply the ${dimension} relationship to the service-planning object and required states.`,
        application_conditions: [
          "The target user compares repeated objects before inspecting source evidence.",
          "Missing and low-confidence values remain explicit."
        ],
        tradeoff: "Stronger alignment improves scanning but reduces expressive variation between result objects.",
        harmful_when: [
          "The target task does not compare repeated objects or expose uncertainty."
        ],
        requires_live_data: false,
        avoid: `Do not reuse the source brand expression or literal source styling for ${dimension}.`,
        observed_ids: [grammarObservationId],
        reasoning_ids: [`hierarchy-${reference.reference_id}`]
      }))
    };
  });
  if (settings.missing_hierarchy_reasoning) {
    references[0].hierarchy_reasoning = [];
  }
  if (settings.forged_fit_score) {
    references[0].product_fit.score = 0;
    references[0].product_fit.band = "weak";
  }
  if (settings.missing_tradeoff) {
    delete references[0].grammar[0].tradeoff;
  }
  if (settings.duplicate_reference) references[references.length - 1] = structuredClone(references[0]);
  return {
    reference_result_version: 1,
    kind: "reference-grammar",
    packet_id: packet.packet_id,
    provider_id: packet.provider.id,
    actor: {
      actor_id: settings.actor_id ||
        (settings.same_actor ? discovery.actor.actor_id : "researcher:grammar-analysis"),
      kind: "agent"
    },
    status: "completed",
    packet_digest: packet.packet_digest,
    subject_result_digest: packet.reference_task.subject_result_digest,
    references,
    evidence: [report]
  };
}

function reviewResult() {
  const discovery = request.prior_results.find((item) => item.kind === "reference-discovery");
  const grammar = request.prior_results.find((item) => item.kind === "reference-grammar");
  const report = evidence("review-report", "independent-review", { passed: !settings.self_review });
  return {
    reference_result_version: 1,
    kind: "reference-review",
    packet_id: packet.packet_id,
    provider_id: packet.provider.id,
    actor: {
      actor_id: settings.actor_id ||
        (settings.self_review ? grammar.actor.actor_id : "critic:reference-independent"),
      kind: "agent"
    },
    status: "completed",
    packet_digest: packet.packet_digest,
    discovery_result_digest: packet.reference_task.discovery_result_digest,
    grammar_result_digest: packet.reference_task.grammar_result_digest,
    dispositions: discovery.references.map((reference, index) => {
      const grammarEntry = grammar.references.find((item) => item.reference_id === reference.reference_id);
      const blocked = settings.low_coverage && index >= 2;
      const weakEvidence = reference.screen_role === "promotional" ||
        reference.evidence_strength === "weak";
      const verifiedGrammar = weakEvidence && !settings.promotional_operational_overclaim
        ? grammarEntry.grammar.filter((item) =>
            ["typography", "color-roles", "density"].includes(item.dimension))
        : grammarEntry.grammar;
      return {
        reference_id: reference.reference_id,
        status: blocked ? "blocked" : "eligible",
        popularity_verified: !blocked &&
          (reference.popularity.status === "verified-snapshot" ||
            Boolean(settings.verify_conflicted_popularity)),
        product_fit_verified: !blocked,
        source_identity_verified: !blocked,
        sampling_verified: !blocked,
        locale_transferability_verified: !blocked && !settings.reject_locale_transfer,
        verified_component_families: blocked
          ? []
          : settings.partial_verified_labels && index === 0
          ? reference.component_families.slice(0, 1)
          : settings.overclaim_component && index === 0
          ? [...reference.component_families, "invented-component"]
          : reference.component_families,
        verified_patterns: blocked ? []
          : settings.partial_verified_labels && index === 0
            ? reference.patterns.slice(0, 1) : reference.patterns,
        verified_evidence_ids: blocked ||
          (settings.omit_first_evidence_verification && index === 0)
          ? []
          : discovery.evidence
            .filter((item) => item.reference_id === reference.reference_id)
            .map((item) => item.evidence_id),
        verified_observation_ids: blocked
          ? []
          : settings.omit_first_observation_verification && index === 0
          ? reference.observed.slice(1).map((item) => item.observation_id)
          : reference.observed.map((item) => item.observation_id),
        verified_inference_ids: blocked
          ? [] : grammarEntry.inferred_rationale.map((item) => item.inference_id),
        verified_hierarchy_reasoning_ids: blocked
          ? [] : grammarEntry.hierarchy_reasoning.map((item) => item.reasoning_id),
        verified_grammar_ids: blocked
          ? [] : verifiedGrammar.map((item) => item.grammar_id),
        copy_risk: blocked ? "high" : settings.medium_copy_risk ? "medium" : "low",
        blockers: blocked ? ["fixture copy-risk blocker"] : []
      };
    }),
    evidence: [report]
  };
}

let result;
if (packet.reference_task.kind === "reference-discovery") result = discoveryResult();
if (packet.reference_task.kind === "reference-grammar") result = grammarResult();
if (packet.reference_task.kind === "reference-review") result = reviewResult();
if (!result) throw new Error(`unsupported reference fixture task: ${packet.reference_task.kind}`);

process.stdout.write(JSON.stringify({
  host_adapter_response_version: 1,
  result,
  metadata: {
    child_pid: process.pid,
    transport: "reference-fixture-json",
    observed_journey_identity_digest: request.journey_identity.identity_digest,
    observed_participant: request.participant
  }
}));
