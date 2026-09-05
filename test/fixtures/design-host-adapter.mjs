import fs from "node:fs";
import path from "node:path";
import {
  identitiesMatch,
  verifyJourneyIdentity,
  verifyPacketJourney,
  verifyParticipant
} from "../../src/identity.mjs";
import { canonicalDigest, hashArtifact } from "../../src/integrity.mjs";

let source = "";
for await (const chunk of process.stdin) source += chunk;
const request = JSON.parse(source);
const { packet, settings = {} } = request;

verifyJourneyIdentity(request.journey_identity, {
  runId: request.run_id,
  label: "design fixture host request journey_identity"
});
verifyPacketJourney(packet, request.journey_identity, "design fixture packet");
if (!identitiesMatch(packet.journey_identity, request.journey_identity)) {
  throw new Error("design fixture packet conflicts with the active journey identity");
}
verifyParticipant(request.participant, {
  providerId: packet.provider.id,
  stageId: packet.stage_id,
  designTaskKind: packet.design_task.kind,
  label: "design fixture host request participant"
});
if (JSON.stringify(request.participant) !== JSON.stringify(packet.participant)) {
  throw new Error("design fixture participant conflicts with the packet");
}

if (settings.spawn_marker) {
  fs.writeFileSync(settings.spawn_marker, `${packet.packet_id}\n`);
}

if ((settings.fail_attempts || []).includes(request.attempt)) {
  process.stderr.write(`design fixture failure on attempt ${request.attempt}\n`);
  process.exit(23);
}

function write(name, content) {
  fs.writeFileSync(path.join(request.output_directory, name), content);
  return name;
}

const designKind = packet.design_task.kind;
const forbiddenPermissions = packet.forbidden_permissions || [];
const sourceReviewer = designKind === "direction-review" || designKind === "color-review";
const sourceArtifacts = request.artifacts.filter((item) =>
  item.artifact_role === "reference-capture");
if (packet.design_task.reference_intelligence ||
  forbiddenPermissions.includes("reference-evidence:read")) {
  const prior = request.prior_results;
  const validPrior = (() => {
    if (designKind === "direction-candidate") return prior.length === 0;
    if (designKind === "browser-evidence") {
      return prior.length === 1 && prior[0].kind === packet.design_task.subject_kind &&
        prior[0].candidate_id === packet.design_task.subject_id;
    }
    if (designKind === "direction-review") {
      return prior.length === packet.design_task.candidate_ids.length * 2 &&
        prior.every((item) => item.kind === "direction-candidate" ||
          item.kind === "browser-evidence" &&
          item.subject_kind === "direction-candidate");
    }
    if (designKind === "color-candidate") {
      return prior.length === 1 && prior[0].kind === "direction-candidate" &&
        prior[0].candidate_id === packet.design_task.design_candidate_id;
    }
    if (designKind === "color-review") {
      return prior.length === packet.design_task.candidate_ids.length * 2 &&
        prior.every((item) => item.kind === "color-candidate" ||
          item.kind === "browser-evidence" && item.subject_kind === "color-candidate");
    }
    return false;
  })();
  if (!validPrior || request.packets.length !== 1 ||
    request.packets[0].packet_id !== packet.packet_id) {
    throw new Error("reference-backed design request leaked unrelated packet or result state");
  }
}
if (sourceReviewer && packet.design_task.reference_intelligence) {
  const expected = packet.design_task.reference_intelligence
    .review_source_authority.captures.map((item) => item.capture_alias).sort();
  const actual = sourceArtifacts.map((item) => item.capture_alias).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected) ||
    !request.permission_scopes.includes("reference-evidence:read") ||
    request.permission_scopes.includes("network:external")) {
    throw new Error("reference reviewer did not receive the exact bounded source authority");
  }
  if (settings.tamper_reference_capture) {
    fs.appendFileSync(sourceArtifacts[0].resolved_path, "tampered by fixture\n");
  }
} else if (sourceArtifacts.length ||
  forbiddenPermissions.includes("reference-evidence:read") &&
    request.permission_scopes.includes("reference-evidence:read")) {
  throw new Error("reference source captures leaked to a creator or browser participant");
}

const roles = {
  canvas: "#FFFFFF",
  surface: "#F8FAFC",
  surface_raised: "#FFFFFF",
  text_primary: "#0F172A",
  text_secondary: "#334155",
  text_muted: "#475569",
  text_inverse: "#FFFFFF",
  border_subtle: "#CBD5E1",
  border_default: "#64748B",
  border_strong: "#334155",
  focus_ring: "#1D4ED8",
  action_primary: "#1D4ED8",
  action_primary_hover: "#1E40AF",
  action_primary_pressed: "#1E3A8A",
  action_disabled: "#94A3B8",
  on_action: "#FFFFFF",
  accent: "#B42318",
  accent_hover: "#912018",
  on_accent: "#FFFFFF",
  success: "#166534",
  on_success: "#FFFFFF",
  warning: "#854D0E",
  on_warning: "#FFFFFF",
  danger: "#B42318",
  on_danger: "#FFFFFF",
  info: "#075985",
  on_info: "#FFFFFF"
};

if (settings.weak_contrast) roles.text_muted = "#CBD5E1";

function paletteFor(roleSet) {
  return {
  primary: [{ value: roleSet.action_primary, token: "--color-action-primary", usage: "primary actions and authority" }],
  accent: [{ value: roleSet.accent, token: "--color-accent", usage: "bounded attention" }],
  background: [{ value: roleSet.canvas, token: "--color-canvas", usage: "application canvas" }],
  surface: [{ value: roleSet.surface, token: "--color-surface", usage: "work surfaces" }],
  text: [
    { value: roleSet.text_primary, token: "--color-text-primary", usage: "primary text" },
    { value: roleSet.text_secondary, token: "--color-text-secondary", usage: "secondary text" }
  ],
  semantic: [
    { role: "success", value: roleSet.success, token: "--color-success", usage: "successful state" },
    { role: "warning", value: roleSet.warning, token: "--color-warning", usage: "warning state" },
    { role: "danger", value: roleSet.danger, token: "--color-danger", usage: "danger state" },
    { role: "info", value: roleSet.info, token: "--color-info", usage: "informational state" }
  ]
  };
}

const palette = paletteFor(roles);

function signature(task) {
  const depth = task.direction.allowed_depth[0];
  return {
    palette,
    typography: {
      families: [
        { family: "Inter", role: "Latin interface and numeric data" },
        { family: "Noto Sans KR", role: "Korean interface fallback" }
      ],
      scale: "1.2 modular scale with tabular data exceptions",
      weights: ["400", "500", "650"],
      treatments: ["tabular numerals", "sentence-case controls", "compact labels"]
    },
    density: {
      mode: "compact",
      characteristics: ["dense rows", "stable comparison columns", "progressive disclosure"]
    },
    shape: {
      radii: ["4px controls", "8px panels"],
      geometry: ["rectilinear work surfaces", "anchored evidence spine"],
      strokes: ["1px default separators", "2px selected-state rail"]
    },
    elevation: {
      strategy: depth === "flat" ? "border-led" : depth,
      shadows: ["0 4px 12px rgb(15 23 42 / 0.12)"],
      separation: ["borders for peers", "shadow only for transient overlays"]
    },
    imagery: {
      strategy: "functional",
      characteristics: ["evidence thumbnails only", "no decorative stock imagery"]
    },
    motion: {
      intensity: "restrained",
      characteristics: ["120ms state feedback", "no ambient motion"]
    },
    style_keywords: [task.direction.name, task.direction.signature_element, "domain-specific operations"],
    forbidden_transformations: [...request.packet.design_task.baseline_policy.forbid]
  };
}

function referenceTrace(task, { color = false } = {}) {
  if (!task.reference_intelligence || settings.omit_reference_trace) return undefined;
  const dimensions = task.reference_intelligence.trace_dimensions;
  const selected = settings.omit_trace_dimension ? dimensions.slice(0, -1) : dimensions;
  return selected.map((dimension, index) => {
    const grammar = task.reference_intelligence.transferable_grammar
      .filter((item) => item.dimension === dimension);
    const reasoningIds = [...new Set(grammar.flatMap((item) => item.reasoning_ids))];
    if (settings.crosswire_reference_trace && index === 0) {
      reasoningIds.splice(0, reasoningIds.length, "causal-unbound");
    }
    if (settings.not_applicable_dimension === dimension) {
      return {
        dimension,
        disposition: "not-applicable",
        target_rationale: `The ${dimension} grammar does not apply to this target candidate's bounded task and state model.`,
        grammar_ids: grammar.map((item) => item.grammar_id),
        reasoning_ids: reasoningIds
      };
    }
    return {
      dimension,
      disposition: "applied",
      target_rationale: `The target ${dimension} choice follows its own decision inventory and content bounds.`,
      design_choice: color
        ? "Assign target action, status, selection, and depth colors distinct jobs."
        : `Apply ${dimension} to the target object's evidence and action hierarchy.`,
      user_decision: color
        ? "Recognize the safe target action and current state without relying on color alone."
        : "Choose which target exception requires action before opening its proof.",
      target_constraint: color
        ? "Target semantic states and brand expression must coexist at accessible contrast."
        : "High-trust target objects must remain comparable in a dense workspace.",
      consequence_if_flattened: color
        ? "One accent would ambiguously represent action, status, and decoration."
        : "Target evidence, status, and action would compete at equal visual weight.",
      grammar_ids: grammar.map((item) => item.grammar_id),
      reasoning_ids: reasoningIds
    };
  });
}

function designContractEvidence(task, candidateId) {
  if (!task.reference_intelligence) return null;
  const contractRoles = [...task.reference_intelligence.required_contract_roles];
  if (contractRoles.length === 0) return null;
  if (settings.omit_contract_role) contractRoles.splice(0, 1);
  const document = {
    design_contract_evidence_version: 1,
    candidate_id: candidateId,
    contract_roles: contractRoles,
    claims: Object.fromEntries(contractRoles.map((role) => [
      role,
      `${role} is derived from the target decision, state, data, and responsive contract.`
    ]))
  };
  const target = write(`${candidateId}-design-contract.json`, JSON.stringify(document));
  return { kind: "design-contract", path: target, contract_roles: contractRoles };
}

function directionResult() {
  const task = packet.design_task;
  const prototypeContent = settings.duplicate_prototype
    ? "<!doctype html><html lang=\"en-US\"><head><meta name=\"viewport\" content=\"width=device-width\"><title>duplicate</title><style>body{color:#111827;background:#fff;font:16px sans-serif}button{padding:12px;color:#fff;background:#1d4ed8}</style></head><body><main><button>Review</button><p data-killsloprouter-locale=\"ko-KR\">검토</p><section data-killsloprouter-state=\"default selected loading empty error permission-denied\">duplicate fixture prototype</section></main></body></html>"
    : `<!doctype html><html lang="en-US"><head><meta name="viewport" content="width=device-width"><title>${task.candidate_id}</title><style>body{color:#111827;background:#fff;font:16px sans-serif}main{padding:24px}button{padding:12px;color:#fff;background:#1d4ed8}</style></head><body><main><button>Review</button><p data-killsloprouter-locale="ko-KR">검토</p>${task.required_states.map((state) => `<section data-killsloprouter-state="${state}">${state}</section>`).join("")}<p>${task.candidate_id} fixture prototype</p></main></body></html>`;
  const prototype = write(`${task.candidate_id}.html`, prototypeContent);
  const candidateSignature = signature(task);
  const fontReportDocument = {
    font_report_version: 1,
    required_locales: task.locales,
    all_required_locales_covered: true,
    families: candidateSignature.typography.families.map((item) => ({
      family: item.family,
      role: item.role,
      source: item.family === "Inter" ? "bundled test font" : "bundled locale fallback",
      availability: "bundled",
      locales: task.locales,
      fallback: item.family === "Inter" ? "Noto Sans KR, system-ui, sans-serif" : "system-ui, sans-serif",
      license: {
        status: "cleared",
        identifier: "OFL-1.1",
        basis: "fixture font metadata is reviewed for the test artifact"
      }
    }))
  };
  if (settings.invalid_font_report) fontReportDocument.families[0].license.status = "unknown";
  const fontReport = write(`${task.candidate_id}-fonts.json`, JSON.stringify(fontReportDocument));
  const treatment = task.editorial_boundary.treatment;
  const contractEvidence = designContractEvidence(task, task.candidate_id);
  const trace = referenceTrace(task);
  return {
    design_result_version: 1,
    kind: "direction-candidate",
    packet_id: packet.packet_id,
    provider_id: packet.provider.id,
    actor: {
      actor_id: settings.actor_id || `direction:${task.candidate_id}`,
      kind: "agent"
    },
    status: "completed",
    packet_digest: packet.packet_digest,
    candidate_id: task.candidate_id,
    baseline_digest: task.baseline_digest,
    intent: {
      mode: treatment === "required" ? "editorial" : "product-native",
      editorial_treatment: treatment,
      editorial_scope: [...task.editorial_boundary.scope],
      energy: task.direction.allowed_energy[0],
      depth: task.direction.allowed_depth[0],
      preserve: [...task.baseline_policy.preserve],
      avoid: [...task.baseline_policy.forbid]
    },
    signature: candidateSignature,
    rationale: settings.copy_source_composition
      ? "Copy the source screen layout and composition."
      : `${task.direction.thesis} at ${task.redesign_depth} depth`,
    ...(trace ? { reference_reasoning_trace: trace } : {}),
    evidence: [
      { kind: "prototype", path: prototype },
      { kind: "font-report", path: fontReport },
      ...(contractEvidence ? [contractEvidence] : [])
    ]
  };
}

function browserResult() {
  const task = packet.design_task;
  const evidence = [];
  const viewports = [...packet.evidence_contract.required_viewports];
  if (settings.omit_last_viewport) viewports.pop();
  for (const viewport of viewports) {
    const screenshot = write(`${task.subject_id}-${viewport}.png`, `playwright screenshot ${viewport}\n`);
    evidence.push({ kind: "screenshot", path: screenshot, viewport });
  }
  const report = write(`${task.subject_id}-playwright.json`, JSON.stringify({ passed: true, pid: process.pid }));
  evidence.push({ kind: "test-report", path: report, checks: packet.evidence_contract.required_checks });
  return {
    design_result_version: 1,
    kind: "browser-evidence",
    packet_id: packet.packet_id,
    provider_id: packet.provider.id,
    actor: {
      actor_id: settings.actor_id || `playwright:${task.subject_id}`,
      kind: "agent"
    },
    status: "completed",
    packet_digest: packet.packet_digest,
    candidate_id: task.subject_id,
    subject_kind: task.subject_kind,
    subject_id: task.subject_id,
    subject_result_digest: task.subject_result_digest,
    browser_engine: settings.wrong_browser_engine ? "screenshot-tool" : "playwright",
    browser_engine_version: "1.62.1",
    checks: Object.fromEntries(packet.evidence_contract.required_checks.map((check) => [check, true])),
    locales_tested: [...task.locales],
    states_tested: [...task.required_states],
    evidence
  };
}

function reviewResult(kind) {
  const task = packet.design_task;
  const report = write(`${kind}.json`, JSON.stringify({ candidates: task.candidate_ids, pid: process.pid }));
  const reportDigest = hashArtifact(path.join(request.output_directory, report));
  const direction = kind === "direction-review";
  const criteria = direction
    ? ["beauty_lift", "product_fit", "trust_clarity", "density_fit", "responsiveness", "implementation", "distinctiveness", "redesign_depth_fidelity", "typography_fit"]
    : ["project_fit", "harmony", "role_clarity", "contrast", "semantic_separation", "locale_resilience", "distinctiveness"];
  const firstCreator = request.prior_results.find((result) =>
    result.kind === (direction ? "direction-candidate" : "color-candidate"))?.actor.actor_id;
  let sourceComposition = null;
  let sourceCompositionDigest = null;
  if (task.reference_intelligence && !settings.omit_source_composition_analysis) {
    const captureAliases = task.reference_intelligence.review_source_authority
      .captures.map((item) => item.capture_alias);
    const sourceDocument = {
      design_source_composition_analysis_version: 1,
      stage: kind,
      packet_digest: packet.packet_digest,
      pack_digest: task.reference_intelligence.pack_digest,
      producer_state_digest: task.reference_intelligence
        .review_source_authority.producer_state_digest,
      capture_set_digest: settings.wrong_capture_set_digest
        ? `sha256:${"0".repeat(64)}`
        : task.reference_intelligence.review_source_authority.capture_set_digest,
      captures: settings.omit_capture_alias ? captureAliases.slice(0, -1) : captureAliases,
      candidates: task.candidate_ids.map((candidateId) => ({
        candidate_id: candidateId,
        candidate_result_digest: task.candidate_bindings[candidateId].result_digest,
        browser_result_digest: task.browser_bindings[candidateId].result_digest,
        capture_aliases: captureAliases,
        dimensions: [...task.reference_intelligence.trace_dimensions],
        source_composition_independence:
          settings.source_composition_verdict || "pass",
        promotional_citation_firewall:
          settings.promotional_firewall_verdict || "pass",
        rationale: "Target composition and source captures were compared under the bounded critic authority.",
        structural_differences: [
          "The target decision order follows its own state and evidence model.",
          "Target responsive grouping differs from every reviewed source capture."
        ]
      }))
    };
    sourceComposition = write(
      `${kind}-source-composition.json`, JSON.stringify(sourceDocument)
    );
    sourceCompositionDigest = hashArtifact(
      path.join(request.output_directory, sourceComposition)
    );
  }
  function evidenceBinding(candidateId, role) {
    const candidate = task.candidate_bindings[candidateId];
    const browser = task.browser_bindings[candidateId];
    let binding;
    if (role === "candidate-rationale") {
      binding = ["candidate-field", "rationale", candidate.fields.rationale];
    } else if (role === "reference-reasoning-trace") {
      binding = ["candidate-field", "reference-reasoning-trace",
        candidate.fields.reference_reasoning_trace];
    } else if (role === "prototype") {
      const evidence = candidate.evidence.find((item) => item.kind === "prototype");
      binding = ["candidate-evidence", "prototype", evidence.digest];
    } else if (role === "review-report") {
      binding = ["review-evidence", "review-report", reportDigest];
    } else if (role === "browser-evidence") {
      binding = ["browser-result", "result", browser.result_digest];
    } else if (["state-evidence", "playwright-evidence", "contrast-report"].includes(role)) {
      const evidence = browser.evidence.find((item) => item.kind === "test-report");
      binding = ["browser-evidence", "test-report", evidence.digest];
    } else if (role === "color-role-map") {
      const evidence = candidate.evidence.find((item) => item.kind === "token-spec");
      binding = ["candidate-evidence", "token-spec", evidence.digest];
    } else if (role === "reference-capture-set") {
      binding = ["reference-authority", "source-capture-set",
        task.reference_intelligence.review_source_authority.capture_set_digest];
    } else if (role === "source-composition-analysis") {
      binding = ["review-evidence", "source-composition-analysis",
        sourceCompositionDigest];
    } else {
      const evidence = candidate.evidence.find((item) =>
        item.kind === "design-contract" && item.contract_roles.includes(role));
      binding = ["candidate-evidence", "design-contract", evidence?.digest];
    }
    return {
      evidence_role: role,
      source_kind: binding[0],
      evidence_kind: binding[1],
      subject_id: candidateId,
      digest: settings.misbind_required_evidence && role ===
        task.reference_intelligence.design_check_contracts[0].required_evidence[0]
        ? `sha256:${"0".repeat(64)}` : binding[2]
    };
  }
  return {
    design_result_version: 1,
    kind,
    packet_id: packet.packet_id,
    provider_id: packet.provider.id,
    actor: {
      actor_id: settings.actor_id ||
        (settings.self_review ? firstCreator : `critic:${kind}`),
      kind: "agent"
    },
    status: "completed",
    packet_digest: packet.packet_digest,
    scores: task.candidate_ids.map((candidateId) => ({
      candidate_id: candidateId,
      criteria: Object.fromEntries(criteria.map((criterion) => [
        criterion,
        settings.low_criterion === criterion ? 2 : criterion === "contrast" ? 5 : 4
      ])),
      rationale: "fixture candidate clears the independent review threshold"
    })),
    ranking: [...task.candidate_ids],
    blockers: [
      ...(settings.failed_reference_check && !settings.omit_reference_failure_blocker
        ? task.candidate_ids.map((candidateId) => ({
          candidate_id: candidateId,
          code: `reference-check-failed:${settings.failed_reference_check}`,
          message: `fixture failure for ${settings.failed_reference_check}`,
          hard: true
        })) : []),
      ...(["fail", "inconclusive"].includes(settings.source_composition_verdict)
        ? task.candidate_ids.map((candidateId) => ({
          candidate_id: candidateId,
          code: "reference-check-failed:source-composition-independence",
          message: "fixture source composition comparison did not pass",
          hard: true
        })) : []),
      ...(["fail", "inconclusive"].includes(settings.promotional_firewall_verdict)
        ? task.candidate_ids.map((candidateId) => ({
          candidate_id: candidateId,
          code: "reference-check-failed:promotional-citation-firewall",
          message: "fixture promotional citation comparison did not pass",
          hard: true
        })) : [])
    ],
    ...(task.reference_intelligence && !settings.omit_reference_checks ? {
      reference_checks: task.candidate_ids.map((candidateId) => ({
        candidate_id: candidateId,
        checks: task.reference_intelligence.design_check_contracts.map((contract) => ({
          check_id: contract.check_id,
          passed: contract.check_id !== settings.failed_reference_check,
          evidence_bindings: contract.required_evidence
            .filter((role, index) => !(settings.omit_required_evidence &&
              contract === task.reference_intelligence.design_check_contracts[0] && index === 0))
            .map((role) => evidenceBinding(candidateId, role))
        })),
        rationale: "The fixture reviewer traced every required human-design check to the candidate."
      }))
    } : {}),
    evidence: [
      { kind: "review-report", path: report },
      ...(sourceComposition ? [{
        kind: "source-composition-analysis", path: sourceComposition
      }] : [])
    ]
  };
}

function rolesForStrategy(strategyId) {
  const candidate = { ...roles };
  if (settings.duplicate_palette) return candidate;
  if (strategyId === "trust-complement") {
    Object.assign(candidate, {
      action_primary: "#0F766E",
      action_primary_hover: "#115E59",
      action_primary_pressed: "#134E4A",
      focus_ring: "#0F766E",
      accent: "#7E22CE",
      accent_hover: "#6B21A8"
    });
  }
  if (strategyId === "semantic-triad") {
    Object.assign(candidate, {
      action_primary: "#6D28D9",
      action_primary_hover: "#5B21B6",
      action_primary_pressed: "#4C1D95",
      focus_ring: "#6D28D9",
      accent: "#9A3412",
      accent_hover: "#7C2D12"
    });
  }
  return candidate;
}

function colorResult() {
  const task = packet.design_task;
  const candidateRoles = rolesForStrategy(task.color_strategy.id);
  const candidatePalette = paletteFor(candidateRoles);
  const toneScales = [
    { role: "action", stops: ["#EFF6FF", "#BFDBFE", "#60A5FA", "#2563EB", "#1E3A8A"] },
    { role: "accent", stops: ["#FEF2F2", "#FECACA", "#F87171", "#DC2626", "#7F1D1D"] },
    { role: "neutral", stops: ["#F8FAFC", "#CBD5E1", "#94A3B8", "#475569", "#0F172A"] }
  ];
  const gamutTargets = ["srgb", "display-p3-progressive"];
  const prototype = write(`${task.candidate_id}.html`, `<!doctype html><html lang="en-US"><head><meta name="viewport" content="width=device-width"><title>${task.candidate_id}</title><style>body{color:${candidateRoles.text_primary};background:${candidateRoles.canvas};font:16px sans-serif}main{padding:24px}button{padding:12px;color:${candidateRoles.on_action};background:${candidateRoles.action_primary}}</style></head><body><main><p data-killsloprouter-locale="ko-KR">검토</p>${task.required_states.map((state) => `<section data-killsloprouter-state="${state}">${state}</section>`).join("")}<p>${task.candidate_id} color fixture</p><button>Decide</button></main></body></html>`);
  const tokenDocument = {
    design_token_spec_version: 1,
    color_space: task.color_strategy.color_space,
    harmony_strategy: task.color_strategy.harmony_strategy,
    tokens: Object.fromEntries(Object.entries(candidateRoles).map(([role, value]) => [
      role,
      { token: `--color-${role.replaceAll("_", "-")}`, value }
    ])),
    tone_scales: toneScales,
    gamut_targets: gamutTargets
  };
  if (settings.token_mismatch) tokenDocument.tokens.canvas.value = "#000000";
  const tokenSpec = write(`${task.candidate_id}-tokens.json`, JSON.stringify(tokenDocument));
  const contractEvidence = designContractEvidence(task, task.candidate_id);
  const trace = referenceTrace(task, { color: true });
  return {
    design_result_version: 1,
    kind: "color-candidate",
    packet_id: packet.packet_id,
    provider_id: packet.provider.id,
    actor: {
      actor_id: settings.actor_id || `color:${task.candidate_id}`,
      kind: "agent"
    },
    status: "completed",
    packet_digest: packet.packet_digest,
    candidate_id: task.candidate_id,
    design_candidate_id: task.design_candidate_id,
    color_strategy_id: task.color_strategy.id,
    source_design_digest: task.source_design_digest,
    palette: candidatePalette,
    color_system: {
      color_space: task.color_strategy.color_space,
      harmony_strategy: task.color_strategy.harmony_strategy,
      neutral_temperature: "cool-neutral",
      roles: candidateRoles,
      tone_scales: toneScales,
      color_only_meaning: false,
      gamut_targets: gamutTargets
    },
    rationale: "fixture role palette preserves hierarchy and semantic separation",
    ...(trace ? { reference_reasoning_trace: trace } : {}),
    evidence: [
      { kind: "prototype", path: prototype },
      { kind: "token-spec", path: tokenSpec },
      ...(contractEvidence ? [contractEvidence] : [])
    ]
  };
}

let result;
if (packet.design_task.kind === "direction-candidate") result = directionResult();
if (packet.design_task.kind === "browser-evidence") result = browserResult();
if (packet.design_task.kind === "direction-review") result = reviewResult("direction-review");
if (packet.design_task.kind === "color-candidate") result = colorResult();
if (packet.design_task.kind === "color-review") result = reviewResult("color-review");

process.stdout.write(JSON.stringify({
  host_adapter_response_version: 1,
  result,
  metadata: {
    child_pid: process.pid,
    transport: "node-json-stdio-design-fixture",
    observed_journey_identity_digest: request.journey_identity.identity_digest,
    observed_participant: request.participant
  }
}));
