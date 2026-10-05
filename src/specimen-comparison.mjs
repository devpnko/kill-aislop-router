import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { RouterError } from "./router.mjs";
import { readDesignState, verifySourceCraftCohort } from "./design.mjs";
import { canonicalDigest, readJsonPinned, readFilePinned, snapshotArtifact, writeJsonAtomic } from "./integrity.mjs";
import { assertInternalIdentityIsNotOrchestrator, canonicalIdentitySet, canonicalIdentityKey } from "./identity.mjs";
import { secureWritablePath, ensureSecureDirectory, verifySecureDirectoryIdentity, trustedPlatformPath } from "./path-security.mjs";
import { referenceCandidateBinding, referenceCandidateTaskFrame } from "./reference-candidates.mjs";

const need = (value, message) => { if (!value) throw new RouterError(message, 4); };
const nonempty = value => typeof value === "string" && value.trim().length > 0;
const inside = (target, parent) => { const relative = path.relative(parent, target); return !relative || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative)); };
const record = (state, kind) => state.results.find(item => item.normalized.kind === kind);
const digestBody = (value, key) => { const { [key]: _digest, ...body } = value; return canonicalDigest(body); };

function browserContract(state, browser) {
  if (!browser) return null;
  const attempt = state.attempts.find(item => item.packet_id === browser.packet_id && item.result_digest === browser.result_digest && item.execution_status === "ran");
  need(attempt?.execution_authority, "comparison requires an accepted official browser execution authority");
  const source = attempt.execution_authority.host_manifest;
  const host = readJsonPinned(source.resolved_path, { label: "comparison executed browser host" });
  need(host.digest === source.digest && host.physical_identity_digest === source.physical_identity_digest, "comparison browser host changed");
  const provider = host.input.providers[browser.provider_id];
  need(canonicalDigest(provider) === attempt.execution_authority.provider_declaration_digest, "comparison browser declaration changed");
  const settings = provider.settings;
  return {
    contract: settings.contract, scenario_digest: settings.scenario_digest,
    browser_channel: settings.browser_channel, locale: settings.locale,
    runtime_digest: settings.runtime_digest, allowed_origins: settings.allowed_origins,
    max_keyboard_tabs: settings.max_keyboard_tabs,
    navigation_timeout_ms: settings.navigation_timeout_ms,
    viewports: Object.fromEntries(state.brief.evidence.required_viewports.map(name => [name, settings.viewports[name]])),
    color_schemes: [...settings.color_schemes].sort(),
    browser_engine_version: browser.normalized.browser_engine_version
  };
}

function cohortIndependence(states) {
  const creatorIds = canonicalIdentitySet(states.flatMap(state => [
    ...state.brief.directions.map(item => item.creator_provider_id),
    ...state.results.filter(item => item.normalized.kind === "direction-candidate").map(item => item.normalized.actor.actor_id)
  ]));
  const browserIds = canonicalIdentitySet(states.flatMap(state => [state.brief.providers.browser_evidence,
    ...state.results.filter(item => item.normalized.kind === "browser-evidence").map(item => item.normalized.actor.actor_id)]));
  const criticIds = canonicalIdentitySet(states.flatMap(state => [state.brief.providers.specimen_reviewer,
    ...state.results.filter(item => item.normalized.kind === "specimen-review").map(item => item.normalized.actor.actor_id)]));
  need([...creatorIds].every(id => !browserIds.has(id) && !criticIds.has(id)) && [...browserIds].every(id => !criticIds.has(id)), "cohort creators, browsers and specimen critics must remain independent across every candidate");
  const authorities = states.map(state => state.reference_pack.producer_state.review_source_authority);
  const craftIds = canonicalIdentitySet(states.flatMap(state => state.source_craft_authority ? [
    state.source_craft_authority.input.reviewer_provider_id, state.source_craft_authority.input.reviewer_actor_id
  ] : []));
  need([...creatorIds, ...browserIds, ...criticIds].every(id => !craftIds.has(id)),
    "cohort source craft recipients cannot create, browse or target-review any candidate");
  const sourceIds = canonicalIdentitySet([...authorities.flatMap(item => [...item.source_recipient_provider_ids, ...item.source_recipient_actor_ids]), ...craftIds]);
  need([...creatorIds, ...browserIds].every(id => !sourceIds.has(id)), "cohort source recipients cannot create or browse any candidate");
  const sourceAttempts = [...authorities.flatMap(item => item.source_recipient_execution_lineage.attempts),
    ...states.flatMap(state => state.attempts.filter(item => item.packet_id === "source-craft-review" && item.execution_authority)
      .map(item => ({ ...item, ...item.execution_authority })))];
  for (const state of states) for (const attempt of state.attempts) {
    const kind = state.packets.find(item => item.packet_id === attempt.packet_id)?.design_task.kind;
    if (!["direction-candidate", "browser-evidence"].includes(kind) || !attempt.execution_authority) continue;
    const authority = attempt.execution_authority;
    for (const source of sourceAttempts) {
      const left = authority.adapter_entrypoint, right = source.adapter_entrypoint;
      const sameExecutable = left && right && ["graph_digest", "digest", "physical_identity_digest"].some(key => left[key] && left[key] === right[key]);
      need(!sameExecutable && authority.provider_declaration_digest !== source.provider_declaration_digest &&
        !(!left && !right && attempt.adapter === source.adapter), "cohort source executable cannot alias any creator or browser authority");
    }
  }
}

// Publish complete immutable bytes with an atomic, exclusive link. Unlike
// rename, link cannot replace an existing target in a concurrent writer race.
function publishNew(filePath, value, verifyAuthority) {
  const target = secureWritablePath(trustedPlatformPath(filePath), "specimen decision output");
  need(!fs.existsSync(target), `specimen output already exists; immutable evidence cannot be overwritten: ${target}`);
  const parent = ensureSecureDirectory(path.dirname(target), "specimen output parent");
  const temporary = path.join(parent.real_path, `.specimen-${crypto.randomUUID()}.tmp`);
  try {
    writeJsonAtomic(temporary, value);
    verifyAuthority();
    verifySecureDirectoryIdentity(parent, "specimen output parent");
    need(secureWritablePath(target, "specimen output") === target, "specimen output path changed");
    fs.linkSync(temporary, target);
    fs.unlinkSync(temporary);
    verifySecureDirectoryIdentity(parent, "specimen output parent");
    return value;
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function entryFor(state) {
  need(state.brief.reference_candidate, "comparison requires explicitly planned reference-candidate runs, not a legacy matrix");
  need(!state.in_flight && ["specimen-feedback", "specimen-abandoned"].includes(state.phase), "comparison requires recorded specimen feedback or explicit abandonment for every planned candidate");
  const binding = referenceCandidateBinding(state);
  const candidate = record(state, "direction-candidate");
  const browser = record(state, "browser-evidence");
  const critic = record(state, "specimen-review");
  const sourceCraft = record(state, "source-craft-review");
  const sourceCraftEligible = !state.brief.source_craft_review || Boolean(sourceCraft &&
    !sourceCraft.normalized.blockers.some(item => item.hard));
  const prototype = candidate?.evidence.find(item => item.evidence_kind === "prototype") || null;
  const screenshots = browser?.evidence.filter(item => item.evidence_kind === "screenshot") || [];
  const executedBrowserContract = browserContract(state, browser);
  const rendered = Boolean(candidate && browser && prototype && screenshots.length);
  const eligible = Boolean(rendered && critic && !state.specimen_abandonment &&
    !critic.normalized.blockers.some(item => item.hard) && sourceCraftEligible && state.status === "manual_pending");
  const renderBinding = rendered ? {
    candidate_result_digest: candidate.result_digest, browser_result_digest: browser.result_digest,
    prototype_digest: prototype.digest,
    screenshot_digests: [...new Set(screenshots.map(item => item.digest))].sort()
  } : null;
  return {
    run_id: state.run_id, state_path: state.state_path, state_digest: state.state_digest,
    journey_identity: state.journey_identity, candidate_id: state.brief.specimen_feedback.candidate_id,
    reference_binding: binding,
    disposition: state.specimen_abandonment ? "abandoned" : eligible ? "critic-eligible" : "critic-rejected",
    abandonment: state.specimen_abandonment || null,
    prototype, screenshots, executed_browser_contract: executedBrowserContract,
    executed_browser_contract_digest: executedBrowserContract ? canonicalDigest(executedBrowserContract) : null,
    render_binding: renderBinding,
    render_binding_digest: renderBinding ? canonicalDigest(renderBinding) : null,
    candidate_result_digest: candidate?.result_digest || null,
    browser_result_digest: browser?.result_digest || null,
    critic_result_digest: critic?.result_digest || null,
    ...(state.brief.source_craft_review ? {
      source_craft_result_digest: sourceCraft?.result_digest || null,
      source_craft_review: sourceCraft ? {
        status: sourceCraftEligible ? "accepted" : "blocked",
        adequacy: sourceCraft.normalized.source_craft_review.adequacy,
        hard_blocker_count: sourceCraft.normalized.blockers.filter(item => item.hard).length,
        slots: sourceCraft.normalized.source_craft_review.slots.map(slot => ({
          slot_id: slot.slot_id, relationship_id: slot.relationship_id, verdict: slot.verdict,
          adequacy: slot.adequacy, viewport: slot.viewport, state: slot.state, locale: slot.locale
        }))
      } : null
    } : {}),
    critic_feedback: critic ? {
      visual_goal_review: critic.normalized.visual_goal_review,
      component_craft_review: critic.normalized.component_craft_review,
      constraint_audit_review: critic.normalized.constraint_audit_review,
      blockers: critic.normalized.blockers
    } : null,
    selectable: eligible,
    source_craft_parity_assessed: false
  };
}

// Pure report builder is also useful for protocol tests. Public command paths
// always read fully verified real design states; a saved report alone is never authority.
export function buildDesignSpecimenComparison(states) {
  need(Array.isArray(states) && states.length >= 1 && states.length <= 24, "comparison resource bound is 1..24 candidates");
  need(states.every(state => Boolean(state.brief.source_craft_review) === Boolean(states[0].brief.source_craft_review)),
    "comparison cannot mix source craft opted-in and unassessed cohort policies");
  for (const state of states) if (state.brief.source_craft_review && state.packets.some(packet => packet.packet_id === "source-craft-review"))
    verifySourceCraftCohort(state, { states });
  const entries = states.map(entryFor).sort((left, right) => left.run_id.localeCompare(right.run_id));
  cohortIndependence(states);
  need(new Set(entries.map(item => item.run_id)).size === entries.length && new Set(entries.map(item => item.state_path)).size === entries.length, "comparison cannot repeat a candidate run");
  const first = entries[0].reference_binding;
  need(entries.length === first.planned_candidate_count && entries.every(item =>
    item.reference_binding.planned_candidate_count === entries.length &&
    canonicalDigest(item.reference_binding.planned_state_paths) === canonicalDigest(first.planned_state_paths) &&
    item.reference_binding.comparison_id === first.comparison_id &&
    item.reference_binding.candidate_count_rationale === first.candidate_count_rationale),
  "comparison must account for the complete declared cohort, including rejected or abandoned candidates");
  need(canonicalDigest(entries.map(item => trustedPlatformPath(item.state_path)).sort()) === canonicalDigest(first.planned_state_paths), "comparison cannot omit or substitute a predeclared candidate state path");
  need(entries.every(item => item.reference_binding.task_frame_digest === first.task_frame_digest), "comparison task frame differs: project, surface, screen, product, baseline, policies, evidence and locales must match");
  const renderedContracts = entries.map(item => item.executed_browser_contract_digest).filter(Boolean);
  need(new Set(renderedContracts).size <= 1, "comparison executed browser scenario, viewport, color-scheme or browser settings differ");
  const body = {
    design_specimen_comparison_version: 1, comparison_id: first.comparison_id,
    planned_candidate_count: first.planned_candidate_count,
    candidate_count_rationale: first.candidate_count_rationale,
    task_frame: referenceCandidateTaskFrame(states[0]), task_frame_digest: first.task_frame_digest,
    executed_browser_contract_digest: renderedContracts[0] || null,
    candidates: entries,
    owner_selection_granted: false, final_design_approval_granted: false,
    source_craft_parity_assessed: false,
    decision_contract: {
      statuses: ["select", "reject-all"], default_selection: null,
      required_render_bindings: entries.filter(item => item.render_binding_digest).map(item => ({ run_id: item.run_id, render_binding_digest: item.render_binding_digest })),
      rule: "An external Owner must inspect the actual rendered candidates. Critic eligibility is not preference or approval. Preserve rejected candidates; reject-all is valid. Selection freezes an HTML-only specimen, not G7, a design system, or an automatically executable successor."
    }
  };
  return { ...body, comparison_digest: canonicalDigest(body) };
}

function statesFor(paths) { return paths.map(file => readDesignState(file)); }
function sameComparison(expected, states) {
  need(canonicalDigest(buildDesignSpecimenComparison(states)) === canonicalDigest(expected), "comparison evidence changed; create a new comparison after reviewing the current cohort");
}
function outsideRuns(target, states, label) {
  for (const state of states) need(!inside(target, fs.realpathSync(state.state_directory)) &&
    !inside(target, fs.realpathSync(state.baseline.resolved_path)), `${label} must remain outside child-writable evidence and creator baseline`);
}

export function compareDesignSpecimens(runPaths, outputPath) {
  const states = statesFor(runPaths);
  const report = buildDesignSpecimenComparison(states);
  const output = secureWritablePath(trustedPlatformPath(outputPath), "specimen comparison output");
  outsideRuns(output, states, "comparison output");
  return publishNew(output, report, () => sameComparison(report, statesFor(runPaths)));
}

export function validateSpecimenOwnerDecision(comparison, decision, states) {
  const fields = ["design_specimen_owner_decision_version", "comparison_digest", "owner_id", "status", "selected_run_id", "observed_render_bindings", "rationale", "planned_expansion", "decided_at", "acknowledges_not_final_approval"];
  need(decision && Object.keys(decision).length === fields.length && fields.every(key => Object.hasOwn(decision, key)), "specimen Owner decision fields are missing or unsupported");
  need(decision.design_specimen_owner_decision_version === 1 && decision.comparison_digest === comparison.comparison_digest, "specimen Owner decision comparison digest mismatch");
  need(["select", "reject-all"].includes(decision.status), "Owner must explicitly select or reject-all; no default winner");
  need(nonempty(decision.rationale) && nonempty(decision.owner_id) && !Number.isNaN(Date.parse(decision.decided_at)) && decision.acknowledges_not_final_approval === true, "Owner decision needs identity, rationale, timestamp and explicit non-final scope");
  for (const state of states) {
    assertInternalIdentityIsNotOrchestrator(decision.owner_id, { orchestratorId: state.journey_identity.orchestrator_id, label: "specimen Owner" });
    const sources = state.reference_pack.producer_state.review_source_authority;
    const participants = canonicalIdentitySet([
      state.journey_identity.orchestrator_id, state.journey_identity.display_name, state.journey_identity.canonical_entrypoint,
      ...Object.values(state.brief.providers), ...state.brief.directions.map(item => item.creator_provider_id),
      ...(state.source_craft_authority ? [state.source_craft_authority.input.reviewer_provider_id,
        state.source_craft_authority.input.reviewer_actor_id, state.source_craft_authority.input.issuer_id] : []),
      ...state.results.map(item => item.normalized.actor.actor_id),
      ...sources.source_recipient_provider_ids, ...sources.source_recipient_actor_ids
    ]);
    need(!participants.has(canonicalIdentityKey(decision.owner_id)), "specimen Owner must be external to every parent, creator, browser, critic and source recipient");
  }
  const required = comparison.decision_contract.required_render_bindings;
  need(Array.isArray(decision.observed_render_bindings) && decision.observed_render_bindings.length === required.length, "Owner must account for every actually rendered candidate, including rejected ones");
  const seen = new Set();
  for (const item of decision.observed_render_bindings) {
    need(Object.keys(item).length === 3 && nonempty(item.observation) && !seen.has(item.run_id) && required.some(expected => expected.run_id === item.run_id && expected.render_binding_digest === item.render_binding_digest), "Owner rendered observation must bind exact candidate/browser/screenshots, with no duplicates");
    seen.add(item.run_id);
  }
  if (decision.status === "reject-all") {
    need(decision.selected_run_id === null && decision.planned_expansion === null, "reject-all cannot freeze or expand a candidate");
    return null;
  }
  const selected = comparison.candidates.find(item => item.run_id === decision.selected_run_id);
  need(selected?.selectable && nonempty(decision.planned_expansion), "Owner can select only a rendered critic-eligible candidate, with an explicit successor plan");
  return selected;
}

export function selectDesignSpecimen(comparisonPath, decisionPath) {
  const pinnedComparison = readJsonPinned(comparisonPath, { label: "specimen comparison" });
  const comparison = pinnedComparison.input;
  need(comparison.design_specimen_comparison_version === 1 && digestBody(comparison, "comparison_digest") === comparison.comparison_digest, "specimen comparison digest mismatch");
  const paths = comparison.candidates.map(item => item.state_path);
  const states = statesFor(paths);
  sameComparison(comparison, states);
  const pinnedDecision = readJsonPinned(decisionPath, { label: "external specimen Owner decision" });
  outsideRuns(pinnedDecision.path, states, "Owner decision");
  outsideRuns(pinnedComparison.path, states, "comparison");
  const selected = validateSpecimenOwnerDecision(comparison, pinnedDecision.input, states);
  const prototype = selected ? readFilePinned(selected.prototype.resolved_path, { label: "selected specimen prototype", requireCallerOwned: false }) : null;
  need(!prototype || (prototype.digest === selected.prototype.digest && prototype.physical_identity_digest === selected.prototype.physical_identity_digest), "selected prototype changed before freeze");
  const receiptPath = `${pinnedComparison.path}.selection.json`;
  const body = {
    design_specimen_selection_version: 1, comparison_digest: comparison.comparison_digest,
    comparison_source: snapshotArtifact(pinnedComparison.path),
    owner_decision_source: snapshotArtifact(pinnedDecision.path), owner_decision: pinnedDecision.input,
    selected: selected ? {
      ...selected,
      frozen_artifact: { digest: prototype.digest, bytes: prototype.bytes, content_base64: prototype.source.toString("base64"),
        artifact_scope: "prototype-html-only; dependency closure not certified" },
      successor_plan: { baseline_prototype_digest: prototype.digest, reference_binding: selected.reference_binding,
        plan: pinnedDecision.input.planned_expansion, automatic_expansion_authorized: false }
    } : null,
    owner_selection_granted: Boolean(selected), final_design_approval_granted: false,
    design_system_approval_granted: false, source_craft_parity_assessed: false,
    receipt_path: receiptPath
  };
  const receipt = { ...body, selection_digest: canonicalDigest(body) };
  return publishNew(receiptPath, receipt, () => {
    sameComparison(comparison, statesFor(paths));
    for (const [pinned, label] of [[pinnedComparison, "comparison"], [pinnedDecision, "Owner decision"]]) {
      const current = readJsonPinned(pinned.path, { label });
      need(current.digest === pinned.digest && current.physical_identity_digest === pinned.physical_identity_digest, `${label} changed before selection commit`);
    }
  });
}
