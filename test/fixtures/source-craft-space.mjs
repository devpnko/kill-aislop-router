import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { referenceCandidateSpace } from "./reference-candidate-space.mjs";
import { host } from "../design-suite.mjs";
import { canonicalDigest, hashArtifact } from "../../src/integrity.mjs";
import { sealedEntrypointGraphDigest } from "../../src/sealed-entrypoint.mjs";
import { referenceCandidateTaskFrame } from "../../src/reference-candidates.mjs";
import { trustedPlatformPath } from "../../src/path-security.mjs";

export const SOURCE_CRAFT_PRIVATE_MARKER = "synthetic-source-craft-private-report-not-public";
export const SOURCE_CRAFT_LIMITATIONS = ["source-css-viewport-unknown", "source-device-pixel-ratio-unknown"];

export function sourceCraftScope(space) {
  return {
    task_frame_digest: canonicalDigest(referenceCandidateTaskFrame({ brief: space.brief,
      baseline: { digest: hashArtifact(space.baseline) } })),
    cohort_digest: canonicalDigest(space.brief.reference_candidate.planned_state_paths.map(trustedPlatformPath).sort())
  };
}

// Deliberately synthetic external authority. This grants only fixture protocol
// access and establishes neither real source rights nor a human taste verdict.
export function sourceCraftSpace(options = {}) {
  const space = referenceCandidateSpace(options);
  const pack = JSON.parse(fs.readFileSync(space.brief.reference_pack.path));
  const producer = JSON.parse(fs.readFileSync(space.brief.reference_pack.producer_state.path));
  const captures = pack.evidence_manifest.filter(item => item.kind === "source-capture" &&
    item.reference_id === space.brief.reference_candidate.primary_reference_id);
  assert.ok(captures.length);
  const rightsPath = path.join(space.directory, "synthetic-source-craft-rights.json");
  fs.writeFileSync(rightsPath, JSON.stringify({ synthetic_fixture_only: true,
    assertion: "Generated protocol pixels may be compared inside this synthetic test only; no real product, source license, redistribution, creator access, or Owner authority is asserted." }));
  const authorityPath = path.join(space.directory, "synthetic-source-craft-authority.json");
  const relationships = space.brief.component_craft.relationships;
  const authority = {
    source_craft_authority_version: 1, purpose: "source-target-component-craft", status: "authorized",
    issuer_id: "synthetic-external-source-rights-issuer", reviewer_provider_id: "source-craft-critic",
    reviewer_actor_id: "synthetic-independent-source-craft-actor",
    project_id: space.brief.project_id, screen_id: space.brief.screen_id,
    comparison_id: space.brief.reference_candidate.comparison_id,
    candidate_id: space.brief.specimen_feedback.candidate_id,
    primary_reference_id: space.brief.reference_candidate.primary_reference_id,
    pack_digest: pack.pack_digest, producer_state_digest: producer.state_digest,
    ...sourceCraftScope(space),
    capture_digests: [captures[0].digest],
    rights_basis: { assertion: "Synthetic fixture source/target component comparison only; no production rights or visual approval.",
      evidence: { path: path.basename(rightsPath), digest: hashArtifact(rightsPath) } },
    creator_access: false, browser_access: false, redistribution: false,
    network_external: false, source_duplication: false, human_authorship: false, owner_approval_granted: false,
    comparison_slots: relationships.filter(item => item.binding.kind === "recipe").flatMap(relation =>
      space.brief.evidence.required_viewports.flatMap(viewport =>
        space.brief.evidence.required_states.flatMap(state => space.brief.locales.map(locale => ({
          slot_id: `${relation.relationship_id}-${viewport}-${state}-${locale.toLowerCase()}`,
          relationship_id: relation.relationship_id, capture_digest: captures[0].digest, viewport, state, locale
        }))))),
    target_invention_relationship_ids: relationships.filter(item => item.binding.kind === "target-invention")
      .map(item => item.relationship_id)
  };
  space.brief.source_craft_review = { authority: { path: path.basename(authorityPath), digest: "" },
    provider_id: authority.reviewer_provider_id };
  const result = { ...space, authority, authorityPath, rightsPath, pack, producer };
  saveSourceCraftAuthority(result);
  return result;
}

export function saveSourceCraftAuthority(space) {
  fs.writeFileSync(space.authorityPath, JSON.stringify(space.authority));
  space.brief.source_craft_review.authority.digest = hashArtifact(space.authorityPath);
  fs.writeFileSync(space.briefPath, JSON.stringify(space.brief));
}

export function sourceCraftHost(space, { sourceCraft = {}, ...settings } = {}, mutate = null) {
  const fixturePath = path.join(space.directory, "independent-source-craft-adapter.mjs");
  const childSource = [
    'import assert from "node:assert/strict";', 'import fs from "node:fs";', 'import path from "node:path";',
    `import { hashArtifact } from ${JSON.stringify(new URL("../../src/integrity.mjs", import.meta.url).pathname)};`,
    `import { verifyJourneyIdentity, verifyPacketJourney, verifyParticipant } from ${JSON.stringify(new URL("../../src/identity.mjs", import.meta.url).pathname)};`,
    `const SOURCE_CRAFT_PRIVATE_MARKER = ${JSON.stringify(SOURCE_CRAFT_PRIVATE_MARKER)};`,
    `const SOURCE_CRAFT_LIMITATIONS = ${JSON.stringify(SOURCE_CRAFT_LIMITATIONS)};`,
    sourceCraftReviewForPacket.toString(), runSourceCraftChild.toString(), "await runSourceCraftChild();"
  ].join("\n");
  if (!fs.existsSync(fixturePath)) fs.writeFileSync(fixturePath, childSource, { mode: 0o600, flag: "wx" });
  else assert.equal(fs.readFileSync(fixturePath, "utf8"), childSource);
  return host(space.directory, settings, manifest => {
    manifest.allowed_providers.push(space.brief.source_craft_review.provider_id);
    manifest.providers[space.brief.source_craft_review.provider_id] = {
      adapter: "agent-json-v1", entrypoint: fixturePath,
      entrypoint_digest: hashArtifact(fixturePath),
      entrypoint_graph_digest: sealedEntrypointGraphDigest(fixturePath),
      capabilities: ["source-target-component-craft-review"], strength: 4,
      permissions: ["artifact:read", "evidence:write", "reference-evidence:read"],
      timeout_ms: 30_000,
      settings: { actor_id: space.authority.reviewer_actor_id, ...sourceCraft }
    };
    if (mutate) mutate(manifest);
  });
}

export function withoutBrowser(manifest) {
  delete manifest.providers["browser-evidence"];
  manifest.allowed_providers = manifest.allowed_providers.filter(id => id !== "browser-evidence");
}

export function sourceCraftReviewForPacket(packet, settings = {}) {
  const task = packet.design_task;
  const contract = task.source_craft_review;
  const authority = contract.obligations;
  const candidateId = task.candidate_id;
  const browser = task.browser_bindings[candidateId];
  const verdict = settings.verdict || "adapted";
  const adequacy = verdict === "unassessed" ? "insufficient" : "adequate";
  return {
    source_craft_review_version: 1,
    authority_digest: task.authority_digest ?? contract.authority_digest,
    candidate_result_digest: task.candidate_bindings[candidateId].result_digest,
    browser_result_digest: browser.result_digest,
    reviewer_provider_id: packet.provider.id,
    reviewer_actor_id: settings.actor_id || authority.reviewer_actor_id,
    adequacy,
    rationale: `${SOURCE_CRAFT_PRIVATE_MARKER}: Synthetic independent child exercised exact bound source/target slots; not an actual aesthetic judgment.`,
    limitations: [...SOURCE_CRAFT_LIMITATIONS],
    slots: authority.comparison_slots.map(slot => ({
      slot_id: slot.slot_id, relationship_id: slot.relationship_id,
      source_capture_digest: slot.capture_digest,
      target_screenshot_digest: browser.evidence.find(item => item.kind === "screenshot" &&
        item.viewport === slot.viewport && item.state === slot.state && item.locale === slot.locale)?.digest,
      viewport: slot.viewport, state: slot.state, locale: slot.locale, adequacy,
      limitations: [...SOURCE_CRAFT_LIMITATIONS], verdict,
      rationale: "Synthetic slot-level observation of permitted capture and exact executed target screenshot.",
      adaptation_justification: verdict === "adapted" ? "Synthetic fixture hue changes while comparison hierarchy and edge/depth relationships remain legible." : null
    })),
    target_invention_relationship_ids: [...authority.target_invention_relationship_ids],
    source_duplication: false, human_authorship: false, owner_approval_granted: false
  };
}

async function runSourceCraftChild() {
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  const request = JSON.parse(text);
  const { packet, settings = {} } = request;
  verifyJourneyIdentity(request.journey_identity, { runId: request.run_id, label: "synthetic source craft host journey" });
  verifyPacketJourney(packet, request.journey_identity, "synthetic source craft packet");
  verifyParticipant(request.participant, { providerId: packet.provider.id, stageId: packet.stage_id,
    designTaskKind: packet.design_task.kind, label: "synthetic independent source craft participant" });
  assert.deepEqual(request.participant, packet.participant);
  assert.equal(packet.design_task.kind, "source-craft-review");
  assert.deepEqual(request.packets.map(item => item.packet_id), [packet.packet_id]);
  assert.ok(request.permission_scopes.includes("reference-evidence:read"));
  assert.ok(!request.permission_scopes.includes("network:external"));
  assert.deepEqual(request.prior_results.map(item => item.kind).sort(), ["browser-evidence", "direction-candidate"]);
  const contract = packet.design_task.source_craft_review;
  const authority = contract.obligations;
  const captures = request.artifacts.filter(item => item.artifact_role === "reference-capture");
  assert.equal(captures.length, authority.capture_digests.length,
    "synthetic source critic received an extra capture, including a same-byte sibling alias");
  assert.deepEqual([...new Set(captures.map(item => item.digest))].sort(), [...authority.capture_digests].sort());
  for (const capture of captures) assert.equal(hashArtifact(capture.resolved_path), capture.digest);
  if (settings.spawn_marker) fs.writeFileSync(settings.spawn_marker, packet.packet_id);
  if (settings.tamper_reference_capture) fs.appendFileSync(captures[0].resolved_path, "synthetic substitution");
  const review = sourceCraftReviewForPacket(packet, settings);
  const report = {
    synthetic_protocol_only: true, private_marker: SOURCE_CRAFT_PRIVATE_MARKER,
    source_paths: captures.map(item => item.resolved_path),
    source_capture_digests: captures.map(item => item.digest),
    prior_result_kinds: request.prior_results.map(item => item.kind), source_craft_review: review
  };
  const reportPath = "source-craft-private-report.json";
  fs.writeFileSync(path.join(request.output_directory, reportPath), JSON.stringify(report));
  process.stdout.write(JSON.stringify({ host_adapter_response_version: 1, result: {
    design_result_version: 1, kind: "source-craft-review", packet_id: packet.packet_id,
    provider_id: packet.provider.id, actor: { actor_id: settings.actor_id, kind: "agent" },
    status: "completed", packet_digest: packet.packet_digest, source_craft_review: review,
    blockers: ["lost", "unassessed"].includes(settings.verdict) && !settings.omit_blocker ? [{
      candidate_id: packet.design_task.candidate_id, code: "source-craft-unresolved", hard: true,
      message: "Synthetic negative source/target component comparison remains unresolved."
    }] : [],
    evidence: [{ kind: "review-report", path: reportPath }]
  }, metadata: { child_pid: process.pid, transport: "node-json-stdio-independent-source-craft-fixture",
    observed_journey_identity_digest: request.journey_identity.identity_digest,
    observed_participant: request.participant } }));
}
