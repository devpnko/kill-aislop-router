import fs from "node:fs";
import path from "node:path";
import {
  identitiesMatch,
  verifyJourneyIdentity,
  verifyPacketJourney,
  verifyParticipant
} from "../../src/identity.mjs";

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

function evidence(kind, id, body) {
  return {
    evidence_id: id,
    kind,
    path: write(`${id}.json`, JSON.stringify(body))
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
    popularity: 96,
    fit: "exact",
    fitScore: 91
  },
  {
    reference_id: "marketline-proof",
    app_name: "Marketline",
    product_category: "verified marketplace",
    screen_family: "results",
    component_families: ["comparison-table", "evidence-panel"],
    patterns: ["confidence-disclosure"],
    popularity: 84,
    fit: "exact",
    fitScore: 94
  },
  {
    reference_id: "proofgrid-offers",
    app_name: "Proofgrid",
    product_category: "offer verification",
    screen_family: "results",
    component_families: ["tabs", "evidence-panel"],
    patterns: ["progressive-disclosure", "confidence-disclosure"],
    popularity: 72,
    fit: "exact",
    fitScore: 88
  },
  {
    reference_id: "megashop-ranking",
    app_name: "Megashop",
    product_category: "general shopping",
    screen_family: "ranked listing",
    component_families: ["tabs", "comparison-table", "evidence-panel"],
    patterns: ["progressive-disclosure", "confidence-disclosure"],
    popularity: 100,
    fit: "adjacent",
    fitScore: 80
  }
];

function discoveryResult() {
  const evidenceItems = referenceDefinitions.map((item) => evidence(
    "source-metadata",
    `source-${item.reference_id}`,
    { provider: "uibowl", record: item.reference_id, popularity: item.popularity }
  ));
  return {
    reference_result_version: 1,
    kind: "reference-discovery",
    packet_id: packet.packet_id,
    provider_id: packet.provider.id,
    actor: { actor_id: "researcher:uibowl-discovery", kind: "agent" },
    status: "completed",
    packet_digest: packet.packet_digest,
    references: referenceDefinitions.map((item) => ({
      reference_id: item.reference_id,
      source: {
        provider: "uibowl",
        uri: `https://uibowl.io/reference/${item.reference_id}`,
        record_id: item.reference_id,
        captured_at: "2026-09-04T01:00:00.000Z"
      },
      app_name: item.app_name,
      product_category: item.product_category,
      screen_family: item.screen_family,
      component_families: item.component_families,
      patterns: item.patterns,
      observed: [{
        observation_id: `obs-${item.reference_id}`,
        kind: "hierarchy",
        statement: "The result identity, comparable value, confidence, and drill-down evidence have visibly different priority.",
        evidence_ids: [`source-${item.reference_id}`]
      }],
      popularity: {
        signals: packet.reference_task.popularity_prior.signals.map((signal) => ({
          id: signal.id,
          metric: signal.metric,
          raw_value: item.popularity,
          normalized_score: item.popularity,
          scope: "UI Bowl released-product collection",
          category: item.product_category,
          as_of: "2026-09-04T01:00:00.000Z",
          evidence_ids: [`source-${item.reference_id}`]
        }))
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
    return {
      reference_id: reference.reference_id,
      product_fit: {
        band: definition.fit,
        score: definition.fitScore,
        dimensions: { user: 5, task: 5, screen: definition.fit === "exact" ? 5 : 3, trust: 4, density: 4 },
        rationale: "The pattern supports dense comparison while keeping evidence and uncertainty inspectable.",
        observed_ids: [`obs-${reference.reference_id}`]
      },
      inferred_rationale: [{
        inference_id: `why-${reference.reference_id}`,
        statement: "The hierarchy likely reduces comparison effort by separating primary value from proof detail.",
        confidence: "medium",
        observed_ids: [`obs-${reference.reference_id}`]
      }],
      grammar: dimensions.map((dimension) => ({
        grammar_id: `grammar-${reference.reference_id}-${dimension}`,
        dimension,
        principle: `${dimension} should make the main comparison and its confidence legible at a glance.`,
        application: `Apply the ${dimension} relationship to the service-planning object and required states.`,
        avoid: `Do not reuse the source brand expression or literal source styling for ${dimension}.`,
        observed_ids: [`obs-${reference.reference_id}`]
      }))
    };
  });
  if (settings.duplicate_reference) references[references.length - 1] = structuredClone(references[0]);
  return {
    reference_result_version: 1,
    kind: "reference-grammar",
    packet_id: packet.packet_id,
    provider_id: packet.provider.id,
    actor: {
      actor_id: settings.same_actor ? discovery.actor.actor_id : "researcher:grammar-analysis",
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
      actor_id: settings.self_review ? grammar.actor.actor_id : "critic:reference-independent",
      kind: "agent"
    },
    status: "completed",
    packet_digest: packet.packet_digest,
    discovery_result_digest: packet.reference_task.discovery_result_digest,
    grammar_result_digest: packet.reference_task.grammar_result_digest,
    dispositions: discovery.references.map((reference, index) => {
      const grammarEntry = grammar.references.find((item) => item.reference_id === reference.reference_id);
      const blocked = settings.low_coverage && index >= 2;
      return {
        reference_id: reference.reference_id,
        status: blocked ? "blocked" : "eligible",
        popularity_verified: true,
        product_fit_verified: true,
        verified_component_families: blocked
          ? []
          : settings.overclaim_component && index === 0
          ? [...reference.component_families, "invented-component"]
          : reference.component_families,
        verified_patterns: blocked ? [] : reference.patterns,
        verified_observation_ids: blocked
          ? [] : reference.observed.map((item) => item.observation_id),
        verified_inference_ids: blocked
          ? [] : grammarEntry.inferred_rationale.map((item) => item.inference_id),
        verified_grammar_ids: blocked
          ? [] : grammarEntry.grammar.map((item) => item.grammar_id),
        copy_risk: blocked ? "high" : "low",
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
