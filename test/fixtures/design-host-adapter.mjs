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

if ((settings.fail_attempts || []).includes(request.attempt)) {
  process.stderr.write(`design fixture failure on attempt ${request.attempt}\n`);
  process.exit(23);
}

function write(name, content) {
  fs.writeFileSync(path.join(request.output_directory, name), content);
  return name;
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

function directionResult() {
  const task = packet.design_task;
  const prototypeContent = settings.duplicate_prototype
    ? "<!doctype html><title>duplicate</title><main>duplicate fixture prototype</main>"
    : `<!doctype html><title>${task.candidate_id}</title><main>${task.candidate_id} fixture prototype</main>`;
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
  return {
    design_result_version: 1,
    kind: "direction-candidate",
    packet_id: packet.packet_id,
    provider_id: packet.provider.id,
    actor: { actor_id: `direction:${task.candidate_id}`, kind: "agent" },
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
    rationale: `${task.direction.thesis} at ${task.redesign_depth} depth`,
    evidence: [
      { kind: "prototype", path: prototype },
      { kind: "font-report", path: fontReport }
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
    actor: { actor_id: `playwright:${task.subject_id}`, kind: "agent" },
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
  const direction = kind === "direction-review";
  const criteria = direction
    ? ["beauty_lift", "product_fit", "trust_clarity", "density_fit", "responsiveness", "implementation", "distinctiveness", "redesign_depth_fidelity", "typography_fit"]
    : ["project_fit", "harmony", "role_clarity", "contrast", "semantic_separation", "locale_resilience", "distinctiveness"];
  const firstCreator = request.prior_results.find((result) =>
    result.kind === (direction ? "direction-candidate" : "color-candidate"))?.actor.actor_id;
  return {
    design_result_version: 1,
    kind,
    packet_id: packet.packet_id,
    provider_id: packet.provider.id,
    actor: {
      actor_id: settings.self_review ? firstCreator : `critic:${kind}`,
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
    blockers: [],
    evidence: [{ kind: "review-report", path: report }]
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
  const prototype = write(`${task.candidate_id}.html`, `<!doctype html><title>${task.candidate_id}</title><style>body{color:${candidateRoles.text_primary};background:${candidateRoles.canvas}}button{color:${candidateRoles.on_action};background:${candidateRoles.action_primary}}</style><main>${task.candidate_id} color fixture <button>Decide</button></main>`);
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
  return {
    design_result_version: 1,
    kind: "color-candidate",
    packet_id: packet.packet_id,
    provider_id: packet.provider.id,
    actor: { actor_id: `color:${task.candidate_id}`, kind: "agent" },
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
    evidence: [
      { kind: "prototype", path: prototype },
      { kind: "token-spec", path: tokenSpec }
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
