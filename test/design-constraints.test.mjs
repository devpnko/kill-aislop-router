import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { designConstraintInventory, validateConstraintAudit, verifyConstraintEvidence,
  constraintPacketContract, assertConstraintPacket, validateConstraintReview,
  assertConstraintAuditRequirement, validateConstraintPreserveInstructions } from "../src/design-constraints.mjs";
import { startDesignExploration, dryRunDesignExploration, readDesignState, resumeDesignExploration,
  dispatchDesignPackets, validateDesignBrief } from "../src/design.mjs";
import { canonicalDigest, hashArtifact } from "../src/integrity.mjs";
import { createJourneyIdentity, createParticipant } from "../src/identity.mjs";
import { workspace, attachReferencePack, host } from "./design-suite.mjs";
import { assertPublishedSchema } from "./fixtures/schema-validation.mjs";

// Protocol injection only: this test authority does not certify a real product,
// real Owner, independent aesthetic judgment, or natural-language truth.
function classify(brief, evidence) {
  brief.constraint_audit = {
    version: 1, context: "exploration", evidence: [evidence], released_proposals: [],
    entries: designConstraintInventory(brief).map(({ pointer, hard, value_digest }) => ({
      pointer, value_digest, role: hard ? "functional" : "design-proposal",
      rationale: "Synthetic scoped classification for protocol verification, not product authority.",
      evidence_ids: hard ? [evidence.evidence_id] : []
    }))
  };
  return brief;
}
function setup({ recipe = false } = {}) {
  const space = workspace();
  if (recipe) {
    const brief = JSON.parse(fs.readFileSync(space.briefPath));
    brief.evidence.required_viewports = ["mobile", "tablet", "desktop"];
    fs.writeFileSync(space.briefPath, JSON.stringify(brief));
    attachReferencePack(space, null, { componentRecipes: true });
  }
  const source = path.join(space.directory, "constraint-evidence.json");
  fs.writeFileSync(source, JSON.stringify({ synthetic: true, claim: "Target obligations, not an Owner approval." }));
  const brief = classify(JSON.parse(fs.readFileSync(space.briefPath)),
    { evidence_id: "synthetic-target", path: "constraint-evidence.json", digest: hashArtifact(source) });
  fs.writeFileSync(space.briefPath, JSON.stringify(brief));
  return { ...space, baselinePath: space.baseline, root: space.directory, brief, source, requireConstraintAudit: true };
}
function save(space) { fs.writeFileSync(space.briefPath, JSON.stringify(space.brief)); }
function cleanup(space) { fs.rmSync(space.directory, { recursive: true, force: true }); }
function reviewFor(brief) {
  return { version: 1, contract_digest: canonicalDigest(brief.constraint_audit),
    entries: brief.constraint_audit.entries.map(({ pointer }) => ({ pointer, supported: true,
      note: "Synthetic independent-review message, not a real visual verdict." })),
    released_proposals_not_reintroduced: true };
}
function reseal(packet) {
  const { packet_digest: _old, ...body } = packet;
  packet.packet_digest = canonicalDigest(body);
}

// Small module fixtures exercise provenance without product execution, a host
// subprocess, source imagery, browser claims, or an actual aesthetic verdict.
function moduleBrief() {
  const brief = {
    product: { name: "Synthetic task", requirement: "Keep the comparison task" },
    editorial_boundary: { policy: "Do not invent live facts" },
    baseline_policy: { preserve: ["Keep keyboard access"], forbid: ["Expose private data"], may_change: ["Explore the treatment"] },
    directions: [{ id: "reference-study", thesis: "Try broad colored planes and purposeful depth" }],
    color_strategies: [],
    component_craft: {
      parts: [{ part_id: "record", role: "Comparison row" }],
      relationships: [{ relationship_id: "record-controls", expectation: "Distinct task hierarchy", decision: {
        basis: "parent-preference", disposition: "adapt", target_treatment: "Try layered color",
        preserves: ["Task hierarchy"], changes: ["Color and depth"], evidence_ids: []
      } }]
    },
    visual_goal_contract: { visual_goal_contract_version: 1, goals: [{
      goal_id: "readable-character", intent: "Try a distinctive task treatment",
      unacceptable_outcomes: ["An unresolved task hierarchy"], relationship_ids: ["record-controls"]
    }] }
  };
  return classify(brief, { evidence_id: "synthetic-target", path: "synthetic.json", digest: canonicalDigest({ synthetic: true }) });
}
function modulePacket(brief, kind) {
  const task = { kind };
  if (kind !== "browser-evidence") task.constraint_audit = constraintPacketContract(brief,
    { reviewer: ["direction-review", "color-review", "specimen-review"].includes(kind) });
  if (["direction-review", "color-review", "specimen-review"].includes(kind)) {
    task.constraint_evidence = [];
    task.constraint_released_proposals = structuredClone(brief.constraint_audit.released_proposals);
  }
  if (kind === "direction-candidate") Object.assign(task, {
    project: structuredClone(brief.product), baseline_policy: structuredClone(brief.baseline_policy),
    editorial_boundary: structuredClone(brief.editorial_boundary), direction: structuredClone(brief.directions[0])
  });
  return { design_task: task };
}
function schemaPacket(brief, kind) {
  return {
    design_packet_version: 1, packet_id: "synthetic-packet", run_id: "synthetic-run", stage_id: kind,
    provider: { id: "synthetic-provider", kind: "external", version: null },
    journey_identity: createJourneyIdentity({ runId: "synthetic-run", routerVersion: "1.0.0" }),
    participant: createParticipant({ providerId: "synthetic-provider", stageId: kind, designTaskKind: kind }),
    assigned_capabilities: ["synthetic-protocol"], minimum_strength: 4,
    required_permissions: ["artifact:read"], forbidden_permissions: ["reference-evidence:read"],
    evidence_contract: { required_viewports: [], required_checks: [] },
    ...modulePacket(brief, kind), packet_digest: canonicalDigest({ synthetic: true })
  };
}

test("constraint module: one direction, no color sweep, and proposed visual goals remain valid", () => {
  const brief = moduleBrief();
  assertPublishedSchema("design-constraint-audit", brief.constraint_audit);
  assert.doesNotThrow(() => validateConstraintAudit(brief));
  const unit = designConstraintInventory(brief).find(item => item.pointer === "/visual_goal_contract/goals/0");
  assert.equal(unit.hard, false);
  assert.equal(brief.constraint_audit.entries.find(item => item.pointer === unit.pointer).role, "design-proposal");
  assert.doesNotThrow(() => assertConstraintPacket(modulePacket(brief, "direction-candidate"), brief, []));
  brief.visual_goal_contract.goals[0].unacceptable_outcomes.push("Only gray surfaces are allowed");
  assert.throws(() => validateConstraintAudit(brief), /visual_goal_contract\/goals\/0.*stale/);
});

test("constraint module: claimed functional visual goals still require scoped evidence", () => {
  const brief = moduleBrief();
  const entry = brief.constraint_audit.entries.find(item => item.pointer === "/visual_goal_contract/goals/0");
  entry.role = "functional";
  assert.throws(() => validateConstraintAudit(brief), /without evidence/);
  entry.evidence_ids = ["synthetic-target"];
  assert.doesNotThrow(() => validateConstraintAudit(brief));
});

test("constraint module: shared unapproved palette restrictions cannot masquerade as hard requirements", () => {
  for (const instruction of ["No gradients", "Only neutral surfaces with small accents", "Keep every corner below 8px"]) {
    const brief = moduleBrief();
    brief.baseline_policy.forbid.push(instruction);
    classify(brief, brief.constraint_audit.evidence[0]);
    const entry = brief.constraint_audit.entries.find(item => item.pointer === "/baseline_policy/forbid/1");
    entry.role = "design-proposal"; entry.evidence_ids = [];
    assert.throws(() => validateConstraintAudit(brief), /unapproved appearance proposal/);
  }
});

for (const kind of ["direction-review", "color-review", "specimen-review"]) {
  test(`constraint module: ${kind} preserves negative origins/carryover judgments as ineligible evidence`, () => {
    const brief = moduleBrief();
    assert.equal(validateConstraintReview(reviewFor(brief), brief, kind), true);
    assert.throws(() => validateConstraintReview(undefined, brief, kind), /invalid shape/);
    const unsupported = reviewFor(brief); unsupported.entries[0].supported = false;
    assert.equal(validateConstraintReview(unsupported, brief, kind), false);
    const carryover = reviewFor(brief); carryover.released_proposals_not_reintroduced = false;
    assert.equal(validateConstraintReview(carryover, brief, kind), false);
    const invalid = reviewFor(brief); invalid.entries[0].supported = "false";
    assert.throws(() => validateConstraintReview(invalid, brief, kind), /must be boolean/);
    const incomplete = reviewFor(brief); incomplete.entries.pop();
    assert.throws(() => validateConstraintReview(incomplete, brief, kind), /coverage is incomplete/);
  });
  test(`constraint module: ${kind} receives exactly its bound reviewer-only evidence`, () => {
    const brief = moduleBrief();
    const packet = modulePacket(brief, kind);
    assert.doesNotThrow(() => assertConstraintPacket(packet, brief, []));
    packet.design_task.constraint_evidence = [{ path: "invented.json" }];
    assert.throws(() => assertConstraintPacket(packet, brief, []), /changed or leaked reviewer-only/);
    packet.design_task.constraint_evidence = [];
    delete packet.design_task.constraint_released_proposals;
    assert.throws(() => assertConstraintPacket(packet, brief, []), /changed or leaked discarded/);
  });
}

test("constraint module: creator and browser do not inherit independent provenance review authority", () => {
  const brief = moduleBrief();
  for (const kind of ["direction-candidate", "browser-evidence"]) {
    const packet = modulePacket(brief, kind);
    assert.doesNotThrow(() => assertConstraintPacket(packet, brief, []));
    packet.design_task.constraint_evidence = [];
    assert.throws(() => assertConstraintPacket(packet, brief, []), /changed or leaked reviewer-only/);
    assert.throws(() => validateConstraintReview(reviewFor(brief), brief, kind), /non-review result/);
  }
  const browser = modulePacket(brief, "browser-evidence");
  browser.design_task.constraint_audit = constraintPacketContract(brief);
  assert.throws(() => assertConstraintPacket(browser, brief, []), /lost, changed or invented/);
});

test("constraint module: reviewer preserve cannot promote a proposed skin into a bound obligation", () => {
  const brief = moduleBrief();
  const relation = brief.component_craft.relationships[0];
  const instruction = { relationship_id: relation.relationship_id, mode: "bound-obligation",
    text: relation.decision.preserves[0], decision_digest: canonicalDigest(relation.decision) };
  const review = { candidates: [{ preserve_instructions: [instruction] }] };
  assert.throws(() => validateConstraintPreserveInstructions(review, brief), /cannot promote an unapproved/);
  instruction.mode = "suggestion"; delete instruction.decision_digest;
  assert.doesNotThrow(() => validateConstraintPreserveInstructions(review, brief));
  instruction.mode = "bound-obligation"; instruction.decision_digest = canonicalDigest(relation.decision);
  const entry = brief.constraint_audit.entries.find(item => item.pointer === "/component_craft/relationships/0");
  entry.role = "functional"; entry.evidence_ids = ["synthetic-target"];
  assert.doesNotThrow(() => validateConstraintPreserveInstructions(review, brief));
  instruction.text = "Keep an unrelated neutral skin";
  assert.throws(() => validateConstraintPreserveInstructions(review, brief), /exact evidenced decision/);
  instruction.text = relation.decision.preserves[0]; instruction.relationship_id = "unbound";
  assert.throws(() => validateConstraintPreserveInstructions(review, brief), /unsupported reviewer preservation/);
});

test("constraint module: claimed relationship authority must agree with its provenance classification", () => {
  for (const [basis, role] of [["functional", "functional"], ["accessibility", "accessibility"], ["approved-brand", "approved-visual"]]) {
    const brief = moduleBrief();
    brief.component_craft.relationships[0].decision.basis = basis;
    classify(brief, brief.constraint_audit.evidence[0]);
    assert.throws(() => validateConstraintAudit(brief), /disguises/);
    const entry = brief.constraint_audit.entries.find(item => item.pointer === "/component_craft/relationships/0");
    entry.role = role; entry.evidence_ids = ["synthetic-target"];
    assert.doesNotThrow(() => validateConstraintAudit(brief));
  }
});

test("constraint module: released exact instructions cannot hide inside a nested shared hard field", () => {
  const brief = moduleBrief();
  brief.product.requirement = "Only neutral surfaces";
  classify(brief, brief.constraint_audit.evidence[0]);
  brief.constraint_audit.context = "reconsideration-after-rejection";
  brief.constraint_audit.released_proposals = [{ instruction: "Only neutral surfaces", reason: "Synthetic unsupported appearance release" }];
  assert.throws(() => validateConstraintAudit(brief), /still present as an exact shared hard rule/);
});

test("constraint module: final packet cannot replace the single audited direction or invent a color sweep", () => {
  const brief = moduleBrief();
  const packet = modulePacket(brief, "direction-candidate");
  packet.design_task.direction.thesis = "Only neutral surfaces and small accents";
  assert.throws(() => assertConstraintPacket(packet, brief, []), /audited direction/);
  const color = modulePacket(brief, "color-candidate");
  color.design_task.color_strategy = { id: "invented", harmony_strategy: "Neutral only" };
  assert.throws(() => assertConstraintPacket(color, brief, []), /audited color strategy/);
});

test("constraint module: explicit strict assertion does not fabricate a legacy audit", () => {
  const brief = moduleBrief(); delete brief.constraint_audit;
  assert.doesNotThrow(() => assertConstraintAuditRequirement(brief, false));
  assert.throws(() => assertConstraintAuditRequirement(brief, true), /requires a classified/);
  assert.equal(constraintPacketContract(brief), null);
  assert.doesNotThrow(() => validateConstraintReview(undefined, brief, "specimen-review"));
  assert.throws(() => validateConstraintReview({ version: 1 }, brief, "specimen-review"), /unbound/);
});

test("constraint module: published audit schema rejects false hard-rule roles and unsupported authority shape", () => {
  const brief = moduleBrief();
  assertPublishedSchema("design-constraint-audit", brief.constraint_audit);
  const unsupported = structuredClone(brief.constraint_audit); unsupported.entries[0].evidence_ids = [];
  assert.throws(() => assertPublishedSchema("design-constraint-audit", unsupported), /evidence_ids/);
  const proposedHardRule = structuredClone(brief.constraint_audit); proposedHardRule.entries[0].role = "design-proposal";
  assert.throws(() => assertPublishedSchema("design-constraint-audit", proposedHardRule), /role/);
  const rejected = structuredClone(brief.constraint_audit); rejected.context = "reconsideration-after-rejection";
  assert.throws(() => assertPublishedSchema("design-constraint-audit", rejected), /released_proposals/);
});

test("constraint module: published packet schema denies creator/browser provenance leaks and missing reviewer evidence", () => {
  const brief = moduleBrief();
  for (const kind of ["direction-candidate", "browser-evidence", "direction-review", "color-review", "specimen-review"]) {
    const packet = schemaPacket(brief, kind);
    assertPublishedSchema("design-packet", packet);
    if (["direction-candidate", "browser-evidence"].includes(kind)) {
      packet.design_task.constraint_evidence = [];
      assert.throws(() => assertPublishedSchema("design-packet", packet), /design_task/);
    } else {
      delete packet.design_task.constraint_released_proposals;
      assert.throws(() => assertPublishedSchema("design-packet", packet), /constraint_released_proposals/);
    }
  }
  const browser = schemaPacket(brief, "browser-evidence");
  browser.design_task.constraint_audit = constraintPacketContract(brief);
  assert.throws(() => assertPublishedSchema("design-packet", browser), /design_task/);
});

test("constraint module: published candidate scope keeps exact task pins and no parity claim", () => {
  const packet = schemaPacket(moduleBrief(), "direction-candidate");
  packet.design_task.reference_candidate_scope = {
    binding_digest: canonicalDigest("binding"), task_frame_digest: canonicalDigest("task"),
    primary_only: true, source_craft_parity_assessed: false
  };
  assertPublishedSchema("design-packet", packet);
  packet.design_task.reference_candidate_scope.source_craft_parity_assessed = true;
  assert.throws(() => assertPublishedSchema("design-packet", packet), /source_craft_parity_assessed/);
  packet.design_task.reference_candidate_scope.source_craft_parity_assessed = false;
  packet.design_task.reference_candidate_scope.task_frame_digest = "unpinned";
  assert.throws(() => assertPublishedSchema("design-packet", packet), /task_frame_digest/);
});

test("constraint module: published result schema permits only reviewers to return provenance judgments", () => {
  const brief = moduleBrief();
  const result = {
    design_result_version: 1, kind: "direction-review", packet_id: "synthetic-packet", provider_id: "synthetic-provider",
    actor: { actor_id: "synthetic-reviewer", kind: "agent" }, status: "completed", packet_digest: canonicalDigest("packet"),
    evidence: [{ kind: "review-report", path: "synthetic.json" }], scores: [], ranking: ["candidate"], blockers: [],
    constraint_audit_review: reviewFor(brief)
  };
  assertPublishedSchema("design-result", result);
  const malformed = structuredClone(result); malformed.constraint_audit_review.contract_digest = "unpinned";
  assert.throws(() => assertPublishedSchema("design-result", malformed), /contract_digest/);
  result.kind = "direction-candidate";
  Object.assign(result, { candidate_id: "candidate", baseline_digest: canonicalDigest("baseline"), intent: {}, signature: {}, rationale: "Synthetic" });
  delete result.scores; delete result.ranking; delete result.blockers;
  assert.throws(() => assertPublishedSchema("design-result", result), /must NOT be valid/);
  delete result.constraint_audit_review;
  assertPublishedSchema("design-result", result);
});

test("constraint module: reviewers get every exact value and re-sealed inventory removal or alteration fails", () => {
  const brief = moduleBrief();
  brief.color_strategies = [{ id: "task-color", harmony_strategy: "Explore broad color" }];
  classify(brief, brief.constraint_audit.evidence[0]);
  const expected = designConstraintInventory(brief).map(({ pointer, value_digest, value }) => ({ pointer, value_digest, value }));
  for (const kind of ["direction-review", "color-review", "specimen-review"]) {
    const packet = schemaPacket(brief, kind);
    assert.deepEqual(packet.design_task.constraint_audit.review_inventory, expected);
    assert.doesNotThrow(() => assertConstraintPacket(packet, brief, []));
    for (const mutate of [
      item => { delete item.design_task.constraint_audit.review_inventory; },
      item => { item.design_task.constraint_audit.review_inventory.pop(); },
      item => { item.design_task.constraint_audit.review_inventory.find(unit => unit.pointer === "/directions/0").value.thesis = "Only gray is permitted"; },
      item => { item.design_task.constraint_audit.review_inventory[0].value_digest = canonicalDigest("invented"); }
    ]) {
      const altered = structuredClone(packet); mutate(altered); reseal(altered);
      assert.throws(() => assertConstraintPacket(altered, brief, []), /lost, changed or invented/);
    }
    const missing = structuredClone(packet); delete missing.design_task.constraint_audit.review_inventory;
    assert.throws(() => assertPublishedSchema("design-packet", missing), /review_inventory/);
  }
  const creator = schemaPacket(brief, "direction-candidate");
  assert.equal(creator.design_task.constraint_audit.review_inventory, undefined);
  creator.design_task.constraint_audit.review_inventory = expected;
  assert.throws(() => assertConstraintPacket(creator, brief, []), /lost, changed or invented/);
  assert.throws(() => assertPublishedSchema("design-packet", creator), /must NOT be valid/);
  assert.equal(schemaPacket(brief, "browser-evidence").design_task.constraint_audit, undefined);
});

test("constraint module: fresh reviewer children inspect actual source-neutral thesis/editorial/color values", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ksr-constraint-child-"));
  try {
    const brief = moduleBrief();
    brief.editorial_boundary = { policy: "Synthetic exact editorial obligation" };
    brief.directions[0].thesis = "Synthetic exact direction proposal";
    brief.color_strategies = [{ id: "task-color", harmony_strategy: "Synthetic exact color proposal" }];
    classify(brief, brief.constraint_audit.evidence[0]);
    for (const kind of ["direction-review", "color-review", "specimen-review"]) {
      const packet = schemaPacket(brief, kind);
      packet.design_task.candidate_ids = ["synthetic-candidate"];
      reseal(packet);
      const candidateKind = kind === "color-review" ? "color-candidate" : "direction-candidate";
      const response = spawnSync(process.execPath, [path.resolve("test/fixtures/design-host-adapter.mjs")], {
        encoding: "utf8", input: JSON.stringify({ packet, packets: [packet], run_id: packet.run_id,
          journey_identity: packet.journey_identity, participant: packet.participant,
          output_directory: directory, artifacts: [], permission_scopes: ["artifact:read", "evidence:write"],
          prior_results: [{ kind: candidateKind, actor: { actor_id: "synthetic-creator" } },
            { kind: "browser-evidence", subject_kind: candidateKind }],
          settings: kind === "specimen-review" ? { constraint_audit_supported: false } : {} })
      });
      assert.equal(response.status, 0, response.stderr);
      const message = JSON.parse(response.stdout);
      assert.notEqual(message.metadata.child_pid, process.pid);
      const report = JSON.parse(fs.readFileSync(path.join(directory, `${kind}.json`)));
      assert.deepEqual(report.constraint_review_inventory, packet.design_task.constraint_audit.review_inventory);
      for (const [pointer, value] of [["/editorial_boundary", brief.editorial_boundary], ["/directions/0", brief.directions[0]], ["/color_strategies/0", brief.color_strategies[0]]]) {
        assert.deepEqual(report.constraint_review_inventory.find(item => item.pointer === pointer).value, value);
      }
      assert.equal(validateConstraintReview(message.result.constraint_audit_review, brief, kind), kind !== "specimen-review");
      if (kind === "specimen-review") assert.deepEqual(message.result.blockers.map(item => [item.code, item.hard]), [["constraint-audit-unresolved", true]]);
    }
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("reviewer-wide inventory source-neutral guard rejects source identity in an otherwise undispatched color proposal", () => {
  const space = setup({ recipe: true });
  try {
    const pack = JSON.parse(fs.readFileSync(path.resolve(space.directory, space.brief.reference_pack.path)));
    space.brief.color_strategies[0].harmony_strategy = pack.verified_grammar[0].reference_id;
    classify(space.brief, space.brief.constraint_audit.evidence[0]);
    save(space);
    assert.throws(() => startDesignExploration(space), /source|identity|reference/);
    assert.equal(fs.existsSync(space.statePath), false);
  } finally { cleanup(space); }
});

test("all constraint-bearing units are inventoried, including complete color/thesis and component treatment", () => {
  const space = setup({ recipe: true });
  try {
    assertPublishedSchema("design-constraint-audit", space.brief.constraint_audit);
    assertPublishedSchema("design-brief", space.brief);
    assert.doesNotThrow(() => validateDesignBrief(space.brief));
    const units = designConstraintInventory(space.brief);
    for (const prefix of ["/product", "/editorial_boundary", "/baseline_policy/forbid/", "/baseline_policy/preserve/",
      "/directions/", "/color_strategies/", "/component_craft/parts/", "/component_craft/relationships/"]) {
      assert.ok(units.some((item) => item.pointer.startsWith(prefix)), prefix);
    }
    space.brief.color_strategies[0].role_intent.push("Only small accents on neutral surfaces");
    assert.throws(() => validateDesignBrief(space.brief), /color_strategies\/0.*stale/);
  } finally { cleanup(space); }
});

for (const instruction of ["No gradients", "Card radius at most 8px", "Only neutral surfaces with small accents"]) {
  test(`shared unapproved prohibition is rejected: ${instruction}`, () => {
    const space = setup();
    try {
      space.brief.baseline_policy.forbid.push(instruction);
      classify(space.brief, space.brief.constraint_audit.evidence[0]);
      const entry = space.brief.constraint_audit.entries.find((item) =>
        item.pointer === `/baseline_policy/forbid/${space.brief.baseline_policy.forbid.length - 1}`);
      entry.role = "design-proposal"; entry.evidence_ids = [];
      save(space);
      assert.throws(() => dryRunDesignExploration(space), /unapproved appearance proposal/);
      assert.throws(() => startDesignExploration(space), /unapproved appearance proposal/);
      assert.equal(fs.existsSync(space.statePath), false);
    } finally { cleanup(space); }
  });
}

test("candidate-specific gradients, broad color and rounded shapes are allowed; release does not choose a new skin", () => {
  const space = setup();
  try {
    space.brief.directions[0].thesis = "Try broad colored planes with a purposeful gradient and 16px corners while preserving the task.";
    classify(space.brief, space.brief.constraint_audit.evidence[0]);
    space.brief.constraint_audit.context = "reconsideration-after-rejection";
    space.brief.constraint_audit.released_proposals = [{ instruction: "No gradients", reason: "Unapproved model preference, not a task or brand requirement." }];
    save(space);
    const state = startDesignExploration(space);
    assert.equal(state.status, "manual_pending");
    assert.equal(state.approval, null);
    assert.equal(state.packets[0].design_task.constraint_audit.owner_approval_granted, false);
    assert.doesNotMatch(JSON.stringify(state.packets), /No gradients|constraint-evidence\.json/);
    assert.match(state.packets[0].design_task.direction.thesis, /16px/);
    assert.equal(readDesignState(space.statePath).state_digest, state.state_digest);
  } finally { cleanup(space); }
});

for (const role of ["functional", "accessibility", "privacy", "source-rights", "approved-visual", "host-requirement"]) {
  test(`${role} requires a bound source, not a label, and survives a valid new brief`, () => {
    const space = setup();
    try {
      const entry = space.brief.constraint_audit.entries.find((item) => item.pointer === "/baseline_policy/preserve/0");
      entry.role = role; entry.evidence_ids = [];
      assert.throws(() => validateConstraintAudit(space.brief), /without evidence/);
      entry.evidence_ids = ["synthetic-target"];
      save(space);
      const report = dryRunDesignExploration(space);
      assert.equal(report.status, "manual_pending");
      assert.deepEqual(space.brief.baseline_policy.preserve,
        JSON.parse(fs.readFileSync(space.briefPath)).baseline_policy.preserve);
    } finally { cleanup(space); }
  });
}

test("coverage omission, duplicate pointer, unknown evidence and exact released-rule recurrence fail closed", () => {
  const space = setup();
  try {
    const original = structuredClone(space.brief.constraint_audit);
    space.brief.constraint_audit.entries.pop();
    assert.throws(() => validateConstraintAudit(space.brief), /inventory is incomplete/);
    space.brief.constraint_audit = structuredClone(original);
    space.brief.constraint_audit.entries[1] = space.brief.constraint_audit.entries[0];
    assert.throws(() => validateConstraintAudit(space.brief), /unique strings/);
    space.brief.constraint_audit = structuredClone(original);
    space.brief.constraint_audit.entries[0].evidence_ids = ["made-up"];
    assert.throws(() => validateConstraintAudit(space.brief), /unbound evidence/);
    space.brief.constraint_audit = structuredClone(original);
    space.brief.constraint_audit.released_proposals = [{ instruction: space.brief.baseline_policy.forbid[0], reason: "It was supposedly removed." }];
    assert.throws(() => validateConstraintAudit(space.brief), /still present/);
    space.brief.constraint_audit = structuredClone(original);
    space.brief.constraint_audit.context = "reconsideration-after-rejection";
    assert.throws(() => validateConstraintAudit(space.brief), /must identify/);
  } finally { cleanup(space); }
});

test("new CLI/API assertion blocks an unclassified brief while compatible historical inspection remains available", () => {
  const space = setup();
  try {
    delete space.brief.constraint_audit;
    save(space);
    assert.throws(() => dryRunDesignExploration(space), /requires a classified/);
    assert.throws(() => startDesignExploration(space), /requires a classified/);
    const cli = spawnSync(process.execPath, [path.resolve("bin/killsloprouter.mjs"), "design", "run",
      "--brief", space.briefPath, "--baseline", space.baseline, "--dry-run", "--require-constraint-audit", "--json"],
    { encoding: "utf8", cwd: space.directory });
    assert.equal(cli.status, 5, cli.stderr);
    assert.match(cli.stderr, /requires a classified/);
    const state = startDesignExploration({ ...space, requireConstraintAudit: false });
    assert.equal(readDesignState(space.statePath).state_digest, state.state_digest);
    assert.throws(() => resumeDesignExploration(space.statePath, { requireConstraintAudit: true }), /requires a classified/);
    assert.equal(hashArtifact(space.statePath), hashArtifact(state.state_path));
  } finally { cleanup(space); }
});

test("evidence remains digest/physical-identity bound at resume without deriving a replacement pin", () => {
  const space = setup();
  try {
    const state = startDesignExploration(space);
    assertPublishedSchema("design-exploration-run", state);
    const saved = fs.readFileSync(space.source);
    fs.writeFileSync(space.source, JSON.stringify({ synthetic: true, changed: true }));
    assert.throws(() => readDesignState(space.statePath), /evidence bytes\/digest mismatch/);
    fs.writeFileSync(space.source, saved);
    assert.throws(() => readDesignState(space.statePath), /changed physical identity/);
  } finally { cleanup(space); }
});

test("constraint evidence cannot be inside a creator baseline, escape its lane, or use a symlink", () => {
  const space = setup();
  try {
    const pin = space.brief.constraint_audit.evidence[0];
    const privateBytes = fs.readFileSync(space.source);
    fs.writeFileSync(path.join(space.baseline, "leak.json"), privateBytes);
    pin.path = "project/leak.json";
    assert.throws(() => verifyConstraintEvidence(space.brief, space.briefPath, { baselinePath: space.baseline }), /outside the creator-readable baseline/);
    pin.path = "../outside.json";
    assert.throws(() => verifyConstraintEvidence(space.brief, space.briefPath), /inside the brief lane/);
    fs.symlinkSync(space.source, path.join(space.directory, "alias.json"));
    pin.path = "alias.json";
    assert.throws(() => verifyConstraintEvidence(space.brief, space.briefPath), /non-symlink/);
  } finally { cleanup(space); }
});

test("final real packets reject re-sealed removal, policy change and reviewer-evidence leakage before dispatch", () => {
  const space = setup();
  try {
    const state = startDesignExploration(space);
    for (const packet of state.packets) assertPublishedSchema("design-packet", packet);
    const directory = path.join(space.directory, "malicious-dispatch");
    for (const mutate of [
      (p) => { delete p.design_task.constraint_audit; },
      (p) => { p.design_task.baseline_policy.forbid = []; },
      (p) => { p.design_task.constraint_evidence = state.constraint_sources; },
      (p) => { p.design_task.constraint_released_proposals = []; }
    ]) {
      const altered = JSON.parse(JSON.stringify(state));
      mutate(altered.packets[0]); reseal(altered.packets[0]);
      assert.throws(() => dispatchDesignPackets(altered, directory), /final packet/);
      assert.equal(fs.existsSync(directory), false);
    }
  } finally { cleanup(space); }
});

test("independent review records negative origins and carryover without treating technical PASS as satisfaction", () => {
  const space = setup();
  try {
    let review = reviewFor(space.brief);
    assert.doesNotThrow(() => validateConstraintReview(review, space.brief, "direction-review"));
    assert.throws(() => validateConstraintReview(review, space.brief, "direction-candidate"), /non-review/);
    assert.throws(() => validateConstraintReview(undefined, space.brief, "direction-review"), /invalid shape/);
    review.entries[0].supported = false;
    assert.equal(validateConstraintReview(review, space.brief, "direction-review"), false);
    review = reviewFor(space.brief); review.released_proposals_not_reintroduced = false;
    assert.equal(validateConstraintReview(review, space.brief, "color-review"), false);
    review = reviewFor(space.brief); review.entries.pop();
    assert.throws(() => validateConstraintReview(review, space.brief, "color-review"), /coverage is incomplete/);
  } finally { cleanup(space); }
});

test("reviewer alone receives pinned evidence and discarded instructions; browser and creator do not", () => {
  const space = setup();
  try {
    const contract = constraintPacketContract(space.brief, { reviewer: true });
    const evidence = verifyConstraintEvidence(space.brief, space.briefPath).map(({ input: _input, ...item }) => item);
    const packet = { design_task: { kind: "direction-review", constraint_audit: contract,
      constraint_evidence: evidence, constraint_released_proposals: [] } };
    assert.doesNotThrow(() => assertConstraintPacket(packet, space.brief, evidence));
    packet.design_task.kind = "browser-evidence";
    assert.throws(() => assertConstraintPacket(packet, space.brief, evidence), /final packet/);
    assert.doesNotThrow(() => assertConstraintPacket({ design_task: { kind: "browser-evidence" } }, space.brief, evidence));
  } finally { cleanup(space); }
});

test("unapproved relationship preserve, disguised brand role and unused evidence cannot pass the new audit", () => {
  const space = setup({ recipe: true });
  try {
    const decision = space.brief.component_craft.relationships[0].decision;
    decision.disposition = "preserve"; decision.changes = [];
    classify(space.brief, space.brief.constraint_audit.evidence[0]);
    assert.throws(() => validateConstraintAudit(space.brief), /freeze an unapproved/);
    decision.disposition = "adapt"; decision.changes = ["accessible contrast"];
    decision.basis = "approved-brand";
    classify(space.brief, space.brief.constraint_audit.evidence[0]);
    assert.throws(() => validateConstraintAudit(space.brief), /disguises .*approved-brand/);
    decision.basis = "accessibility"; decision.evidence_ids = ["synthetic-target"];
    classify(space.brief, space.brief.constraint_audit.evidence[0]);
    const entry = space.brief.constraint_audit.entries.find((item) => item.pointer === "/component_craft/relationships/0");
    entry.role = "accessibility"; entry.evidence_ids = ["synthetic-target"];
    assert.doesNotThrow(() => validateConstraintAudit(space.brief));
    space.brief.constraint_audit.evidence.push({ ...space.brief.constraint_audit.evidence[0], evidence_id: "unused" });
    assert.throws(() => validateConstraintAudit(space.brief), /unused evidence/);
  } finally { cleanup(space); }
});

test("audited color packet cannot be re-sealed with a restrictive replacement strategy", () => {
  const space = setup();
  try {
    const packet = { design_task: { kind: "color-candidate", constraint_audit: constraintPacketContract(space.brief),
      color_strategy: structuredClone(space.brief.color_strategies[0]) } };
    assert.doesNotThrow(() => assertConstraintPacket(packet, space.brief, []));
    packet.design_task.color_strategy.harmony_strategy = "Force neutral surfaces and small accents for every design";
    assert.throws(() => assertConstraintPacket(packet, space.brief, []), /audited color strategy/);
  } finally { cleanup(space); }
});

test("real child creators retain provenance without receiving private evidence; no browser evidence is fabricated", () => {
  const space = setup({ recipe: true });
  try {
    const manifest = host(space.directory, {}, (value) => {
      delete value.providers["browser-evidence"];
      value.allowed_providers = value.allowed_providers.filter((id) => id !== "browser-evidence");
    });
    const state = startDesignExploration({ ...space, hostManifest: manifest });
    assert.equal(state.results.filter((item) => item.normalized.kind === "direction-candidate").length, 9, JSON.stringify(state.blockers));
    assert.equal(state.results.some((item) => item.normalized.kind === "browser-evidence"), false);
    assert.equal(state.phase, "direction-browser-evidence");
    assert.equal(state.status, "manual_pending");
    assert.equal(readDesignState(space.statePath).state_digest, state.state_digest);
  } finally { cleanup(space); }
});
