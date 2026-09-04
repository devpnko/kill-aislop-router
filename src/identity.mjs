import { canonicalDigest } from "./integrity.mjs";
import { RouterError } from "./router.mjs";

export const KILLSLOPROUTER_ORCHESTRATOR_ID = "kill-slop-router";
export const KILLSLOPROUTER_DISPLAY_NAME = "KillSlopRouter";
export const KILLSLOPROUTER_CANONICAL_ENTRYPOINT = "killsloprouter:kill-slop-router";

const INVOCATIONS = new Set(["explicit", "implicit", "resume", "legacy-migrated"]);
const PARTICIPANT_ROLES = new Set([
  "creator",
  "researcher",
  "critic",
  "scanner",
  "browser-evidence",
  "adjudicator"
]);

const PRESENTATION = Object.freeze({
  active_workflow: KILLSLOPROUTER_DISPLAY_NAME,
  participant_rule: "internal-role-only"
});

function requireValue(condition, message, exitCode = 4) {
  if (!condition) throw new RouterError(message, exitCode);
}

function identityBody(identity) {
  const { identity_digest: _digest, ...body } = identity || {};
  return body;
}

function sameIdentity(left, right) {
  return Boolean(left && right && canonicalDigest(left) === canonicalDigest(right));
}

export function createJourneyIdentity({
  runId,
  routerId = KILLSLOPROUTER_ORCHESTRATOR_ID,
  routerVersion,
  invocation = "explicit"
}) {
  requireValue(routerId === KILLSLOPROUTER_ORCHESTRATOR_ID,
    `orchestrator identity requires router_id ${KILLSLOPROUTER_ORCHESTRATOR_ID}`, 3);
  requireValue(typeof routerVersion === "string" && routerVersion.length > 0,
    "orchestrator identity requires router_version", 3);
  requireValue(typeof runId === "string" && runId.length > 0,
    "orchestrator identity requires run_id", 3);
  requireValue(INVOCATIONS.has(invocation),
    `unsupported KillSlopRouter invocation identity: ${invocation}`, 3);
  const identity = {
    journey_identity_version: 1,
    orchestrator_id: KILLSLOPROUTER_ORCHESTRATOR_ID,
    orchestrator_version: routerVersion,
    display_name: KILLSLOPROUTER_DISPLAY_NAME,
    canonical_entrypoint: KILLSLOPROUTER_CANONICAL_ENTRYPOINT,
    invocation,
    run_id: runId,
    presentation: { ...PRESENTATION }
  };
  identity.identity_digest = canonicalDigest(identity);
  return identity;
}

export function verifyJourneyIdentity(identity, {
  runId = null,
  routerId = KILLSLOPROUTER_ORCHESTRATOR_ID,
  routerVersion = null,
  label = "journey_identity"
} = {}) {
  requireValue(identity && typeof identity === "object" && !Array.isArray(identity),
    `${label} is missing`);
  requireValue(identity.journey_identity_version === 1,
    `${label}.journey_identity_version must be 1`);
  requireValue(identity.orchestrator_id === KILLSLOPROUTER_ORCHESTRATOR_ID &&
    identity.orchestrator_id === routerId,
  `${label} does not identify KillSlopRouter`);
  requireValue(typeof identity.orchestrator_version === "string" && identity.orchestrator_version.length > 0,
    `${label}.orchestrator_version is missing`);
  if (routerVersion !== null) {
    requireValue(identity.orchestrator_version === routerVersion,
      `${label}.orchestrator_version conflicts with the routed version`);
  }
  requireValue(identity.display_name === KILLSLOPROUTER_DISPLAY_NAME,
    `${label}.display_name must remain ${KILLSLOPROUTER_DISPLAY_NAME}`);
  requireValue(identity.canonical_entrypoint === KILLSLOPROUTER_CANONICAL_ENTRYPOINT,
    `${label}.canonical_entrypoint is not the namespaced V1 entrypoint`);
  requireValue(INVOCATIONS.has(identity.invocation), `${label}.invocation is invalid`);
  requireValue(typeof identity.run_id === "string" && identity.run_id.length > 0,
    `${label}.run_id is missing`);
  if (runId !== null) requireValue(identity.run_id === runId, `${label}.run_id conflicts with the run`);
  requireValue(identity.presentation?.active_workflow === KILLSLOPROUTER_DISPLAY_NAME &&
    identity.presentation?.participant_rule === "internal-role-only",
  `${label}.presentation weakens the parent-versus-participant contract`);
  requireValue(canonicalDigest(identityBody(identity)) === identity.identity_digest,
    `${label} digest mismatch`);
  return identity;
}

export function identitiesMatch(left, right) {
  try {
    verifyJourneyIdentity(left);
    verifyJourneyIdentity(right);
    return sameIdentity(left, right);
  } catch {
    return false;
  }
}

export function participantRoleForStage(stageId, designTaskKind = null) {
  if (["reference-discovery", "reference-grammar"].includes(stageId)) return "researcher";
  if (["direction-candidate", "color-candidate"].includes(designTaskKind)) return "creator";
  if (designTaskKind === "browser-evidence" || stageId === "browser-evidence") return "browser-evidence";
  if (["direction-review", "color-review"].includes(designTaskKind)) return "critic";
  if (stageId === "static-discovery") return "scanner";
  if (stageId === "adjudication") return "adjudicator";
  return "critic";
}

export function createParticipant({ providerId, stageId = null, designTaskKind = null, role = null }) {
  requireValue(typeof providerId === "string" && providerId.length > 0,
    "participant requires provider_id", 3);
  const resolvedRole = role || participantRoleForStage(stageId, designTaskKind);
  requireValue(PARTICIPANT_ROLES.has(resolvedRole), `unsupported participant role: ${resolvedRole}`, 3);
  return {
    participant_version: 1,
    provider_id: providerId,
    role: resolvedRole,
    visibility: "internal",
    orchestrator_id: KILLSLOPROUTER_ORCHESTRATOR_ID
  };
}

export function verifyParticipant(participant, {
  providerId,
  stageId = null,
  designTaskKind = null,
  role = null,
  label = "participant"
} = {}) {
  requireValue(participant && typeof participant === "object" && !Array.isArray(participant),
    `${label} is missing`);
  requireValue(participant.participant_version === 1, `${label}.participant_version must be 1`);
  requireValue(participant.provider_id === providerId, `${label}.provider_id conflicts with the packet provider`);
  const expectedRole = role || participantRoleForStage(stageId, designTaskKind);
  requireValue(participant.role === expectedRole, `${label}.role must be ${expectedRole}`);
  requireValue(participant.visibility === "internal", `${label}.visibility must remain internal`);
  requireValue(participant.orchestrator_id === KILLSLOPROUTER_ORCHESTRATOR_ID,
    `${label}.orchestrator_id must remain ${KILLSLOPROUTER_ORCHESTRATOR_ID}`);
  return participant;
}

export function verifyPacketJourney(packet, identity, label = "packet") {
  verifyJourneyIdentity(identity, { runId: identity?.run_id, label: `${label}.journey_identity` });
  requireValue(packet?.run_id === identity.run_id,
    `${label}.run_id conflicts with the active KillSlopRouter journey`);
  requireValue(identitiesMatch(packet?.journey_identity, identity),
    `${label}.journey_identity conflicts with the active KillSlopRouter run`);
  verifyParticipant(packet.participant, {
    providerId: packet.provider?.id,
    stageId: packet.stage_id,
    designTaskKind: packet.design_task?.kind || null,
    label: `${label}.participant`
  });
  const { packet_digest: packetDigest, ...body } = packet || {};
  requireValue(typeof packetDigest === "string" && canonicalDigest(body) === packetDigest,
    `${label}.packet_digest does not bind its journey identity and participant`);
  return packet;
}

function escaped(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function presentationViolations(text, {
  identity = null,
  participants = []
} = {}) {
  if (identity) verifyJourneyIdentity(identity);
  const source = String(text || "");
  const violations = [];
  const providerIds = [...new Set(participants.map((item) => item?.provider_id).filter(Boolean))];
  for (const providerId of providerIds) {
    const provider = providerId.split(/[-\s]+/).map(escaped).join("[- ]?");
    if (!new RegExp(provider, "i").test(source)) continue;
    if (!source.includes(KILLSLOPROUTER_DISPLAY_NAME)) {
      violations.push(`participant ${providerId} is named without the KillSlopRouter parent`);
    }
    const childAsMode = new RegExp(
      `(?:${provider}).{0,32}(?:모드|워크플로|오케스트레이터|orchestrator|active mode|top[- ]level|로 진행|으로 진행|실행 주체)`,
      "i"
    );
    const qualified = new RegExp(
      `(?:${KILLSLOPROUTER_DISPLAY_NAME}).{0,80}(?:내부|internal|child|critic|비평|검토).{0,80}(?:${provider})|` +
      `(?:${provider}).{0,80}(?:내부|internal|child|critic|비평|검토)`,
      "i"
    );
    if (childAsMode.test(source) && !qualified.test(source)) {
      violations.push(`participant ${providerId} is presented as the active workflow`);
    }
  }
  return [...new Set(violations)];
}

export function assertJourneyPresentation(text, options = {}) {
  const violations = presentationViolations(text, options);
  requireValue(violations.length === 0, `KillSlopRouter presentation invariant failed: ${violations.join("; ")}`);
  return text;
}

export function resolveJourneyPresentation({ utterance, activeJourneyIdentity = null }) {
  if (activeJourneyIdentity) {
    verifyJourneyIdentity(activeJourneyIdentity);
    return { active_workflow: KILLSLOPROUTER_DISPLAY_NAME, journey_identity: activeJourneyIdentity };
  }
  const source = String(utterance || "");
  if (/(?:KillSlopRouter|killsloprouter|kill[- ]slop[- ]router|킬슬롭(?:라우터)?)/i.test(source)) {
    return { active_workflow: KILLSLOPROUTER_DISPLAY_NAME, journey_identity: null };
  }
  if (/\$(?:anti[- ]?slop|antislop)\b/i.test(source)) {
    return { active_workflow: "antislop (standalone)", journey_identity: null };
  }
  return { active_workflow: null, journey_identity: null };
}
