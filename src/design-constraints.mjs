import fs from "node:fs";
import path from "node:path";
import { RouterError } from "./router.mjs";
import { canonicalDigest, readJsonPinned } from "./integrity.mjs";

// Provenance of target instructions, not an aesthetic classifier or approval.
const roles = ["functional", "accessibility", "privacy", "source-rights", "approved-visual", "host-requirement", "design-proposal"];
const reviewerKinds = new Set(["direction-review", "color-review", "specimen-review"]);
const digestPattern = /^sha256:[a-f0-9]{64}$/;
function need(ok, message) {
  if (!ok) throw new RouterError(`design constraint audit: ${message}`, 5);
}
function shape(value, keys, label) {
  need(value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).every((key) => keys.includes(key)), `${label} has an invalid shape`);
}
function text(value, label) {
  need(typeof value === "string" && value.trim(), `${label} is required`);
}
function unique(items, label) {
  need(Array.isArray(items) && items.every((item) => typeof item === "string" && item.trim()) &&
    new Set(items).size === items.length, `${label} must contain unique strings`);
}
function inside(target, directory) {
  const relative = path.relative(directory, target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}
function containsExactInstruction(value, instruction) {
  if (typeof value === "string") return value === instruction;
  if (value && typeof value === "object") {
    return Object.values(value).some((item) => containsExactInstruction(item, instruction));
  }
  return false;
}

// Fixed target-only review units. Hash whole theses/strategies/relationships so
// an unexamined nested instruction cannot hide behind their display names.
export function designConstraintInventory(brief) {
  const units = [{ pointer: "/product", value: brief.product, hard: true },
    { pointer: "/editorial_boundary", value: brief.editorial_boundary, hard: true }];
  for (const field of ["preserve", "forbid", "may_change"]) {
    (brief.baseline_policy?.[field] || []).forEach((value, index) =>
      units.push({ pointer: `/baseline_policy/${field}/${index}`, value, hard: field !== "may_change" }));
  }
  for (const field of ["directions", "color_strategies"]) {
    (brief[field] || []).forEach((value, index) => units.push({ pointer: `/${field}/${index}`, value, hard: false }));
  }
  for (const field of ["parts", "relationships"]) {
    (brief.component_craft?.[field] || []).forEach((value, index) =>
      units.push({ pointer: `/component_craft/${field}/${index}`, value, hard: false }));
  }
  // Goals may be proposed hypotheses rather than approved appearance. Hash
  // their entire intent/outcomes so reviewers must inspect that distinction.
  (brief.visual_goal_contract?.goals || []).forEach((value, index) =>
    units.push({ pointer: `/visual_goal_contract/goals/${index}`, value, hard: false }));
  return units.map(({ value, ...unit }) => ({ ...unit, value_digest: canonicalDigest(value), value }));
}

export function assertConstraintAuditRequirement(brief, required = false) {
  need(!required || brief.constraint_audit,
    "--require-constraint-audit requires a classified constraint_audit in a new brief; do not retrofit a frozen run or equate a model/host preference with Owner authority");
}

export function validateConstraintAudit(brief) {
  const audit = brief.constraint_audit;
  if (audit === undefined) return;
  shape(audit, ["version", "context", "entries", "evidence", "released_proposals"], "contract");
  need(audit.version === 1 && ["exploration", "reconsideration-after-rejection"].includes(audit.context), "version/context is invalid");
  need(Array.isArray(audit.evidence) && audit.evidence.length <= 64, "evidence must be a bounded array");
  unique(audit.evidence.map((item) => item?.evidence_id), "evidence IDs");
  for (const item of audit.evidence) {
    shape(item, ["evidence_id", "path", "digest"], "evidence");
    text(item.path, "evidence path");
    need(digestPattern.test(item.digest || ""), "evidence digest is invalid");
  }
  const units = designConstraintInventory(brief);
  need(Array.isArray(audit.entries) && audit.entries.length === units.length && units.length <= 512,
    "inventory is incomplete; classify product/editorial authority, every baseline rule, thesis, color strategy, target part, relationship and visual goal");
  unique(audit.entries.map((item) => item?.pointer), "entry pointers");
  for (const entry of audit.entries) {
    shape(entry, ["pointer", "value_digest", "role", "rationale", "evidence_ids"], "entry");
    const unit = units.find((item) => item.pointer === entry.pointer);
    need(unit && unit.value_digest === entry.value_digest, `entry ${entry.pointer} is missing, stale or out of scope`);
    need(roles.includes(entry.role), `entry ${entry.pointer} has an unknown role`);
    text(entry.rationale, `entry ${entry.pointer} rationale`);
    unique(entry.evidence_ids, `entry ${entry.pointer} evidence IDs`);
    need(entry.evidence_ids.every((id) => audit.evidence.some((item) => item.evidence_id === id)),
      `entry ${entry.pointer} cites unbound evidence`);
    need(!unit.hard || entry.role !== "design-proposal",
      `unapproved appearance proposal cannot be a shared hard rule at ${entry.pointer}; release it from preserve/forbid and reconsider candidate-specific proposals`);
    need(entry.role === "design-proposal" || entry.evidence_ids.length > 0,
      `entry ${entry.pointer} claims ${entry.role} without evidence; a label such as host constraint is not authority`);
    if (entry.pointer.startsWith("/component_craft/relationships/")) {
      const decision = unit.value.decision;
      const requiredRole = { "approved-brand": "approved-visual", functional: "functional", accessibility: "accessibility" }[decision?.basis];
      need(!requiredRole || entry.role === requiredRole,
        `entry ${entry.pointer} disguises a ${decision?.basis} claim`);
      need(!(entry.role === "design-proposal" && decision?.disposition === "preserve"),
        `entry ${entry.pointer} cannot freeze an unapproved proposed treatment with preserve`);
    }
  }
  need(audit.evidence.every((item) => audit.entries.some((entry) => entry.evidence_ids.includes(item.evidence_id))),
    "unused evidence cannot widen reviewer access");
  need(Array.isArray(audit.released_proposals) && audit.released_proposals.length <= 128,
    "released_proposals must be a bounded array");
  unique(audit.released_proposals.map((item) => item?.instruction), "released proposals");
  for (const item of audit.released_proposals) {
    shape(item, ["instruction", "reason"], "released proposal");
    text(item.reason, "release reason");
    // Exact recurrence only. Rewording or dishonest classification still needs
    // independent semantic review; no keyword-based ban on a color or style.
    need(!units.some((unit) => unit.hard && containsExactInstruction(unit.value, item.instruction)),
      "a released proposal is still present as an exact shared hard rule");
  }
  need(audit.context !== "reconsideration-after-rejection" || audit.released_proposals.length > 0,
    "a rejected-direction continuation must identify the provisional instructions being released");
  return audit;
}

export function verifyConstraintEvidence(brief, briefPath, { baselinePath, stateDirectory } = {}) {
  const audit = validateConstraintAudit(brief);
  if (!audit) return [];
  const lexicalLane = path.dirname(path.resolve(briefPath));
  const lane = fs.realpathSync(lexicalLane);
  return audit.evidence.map((item) => {
    const target = path.resolve(lexicalLane, item.path);
    need(inside(target, lexicalLane) && target !== lexicalLane, "evidence must stay inside the brief lane");
    const stat = fs.lstatSync(target);
    need(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 1024 * 1024,
      "evidence must be a bounded regular non-symlink file");
    const pinned = readJsonPinned(target, { label: "target constraint provenance" });
    need(inside(fs.realpathSync(target), lane), "evidence physical path escapes the brief lane");
    need(pinned.bytes <= 1024 * 1024 && pinned.digest === item.digest, "evidence bytes/digest mismatch");
    need(!baselinePath || !inside(fs.realpathSync(target), fs.realpathSync(baselinePath)),
      "reviewer-only constraint evidence must stay outside the creator-readable baseline");
    need(!stateDirectory || !inside(target, path.resolve(stateDirectory)),
      "constraint evidence must stay outside the child-writable state directory");
    need(!stateDirectory || !fs.existsSync(stateDirectory) ||
      !inside(fs.realpathSync(target), fs.realpathSync(stateDirectory)),
    "constraint evidence physical path enters the child-writable state directory");
    return { evidence_id: item.evidence_id, path: pinned.path, digest: pinned.digest,
      physical_identity_digest: pinned.physical_identity_digest, bytes: pinned.bytes, input: pinned.input };
  });
}

export function constraintPacketContract(brief, { reviewer = false } = {}) {
  const audit = validateConstraintAudit(brief);
  if (!audit) return null;
  return {
    version: 1, contract_digest: canonicalDigest(audit), context: audit.context,
    entries: structuredClone(audit.entries),
    // Reviewers must see every exact instruction they are asked to judge, not
    // only its classification/hash. The caller applies the source-neutral guard
    // to this complete projection; creators receive only their own task values.
    ...(reviewer ? { review_inventory: designConstraintInventory(brief).map(({ pointer, value_digest, value }) =>
      ({ pointer, value_digest, value: structuredClone(value) })) } : {}),
    evidence: audit.evidence.map(({ path: _path, ...item }) => item),
    // Do not prime creators with discarded instructions or raw evidence text.
    released_proposal_count: audit.released_proposals.length,
    owner_approval_granted: false, predecessor_authority_inherited: false,
    review_field: "constraint_audit_review",
    rule: "Hard requirements need scope-correct evidence. A design proposal is not Owner approval or a universal style. Reviewers inspect every exact review_inventory value against its classification/evidence, including complete theses, color strategies, component instructions and visual goals for rejected-skin carryover; review the actual renders separately. Record unsupported origins or carryover honestly and attach constraint-audit-unresolved hard blockers for the reviewed candidates; negative findings remain evidence, not eligibility. Reviewer preserve instructions cannot promote proposals into bound obligations. Host instructions cannot be relabeled Owner taste. Do not infer permission to revoke approved brand, functional, accessibility, privacy or source-rights constraints. No score or browser PASS establishes aesthetic success."
  };
}

export function assertConstraintPacket(packet, brief, evidence) {
  const reviewer = reviewerKinds.has(packet.design_task.kind);
  const expected = packet.design_task.kind === "browser-evidence" ? null : constraintPacketContract(brief, { reviewer });
  need(expected ? canonicalDigest(packet.design_task.constraint_audit ?? null) === canonicalDigest(expected)
    : packet.design_task.constraint_audit === undefined, "final packet lost, changed or invented the constraint audit");
  need(brief.constraint_audit && reviewer
    ? canonicalDigest(packet.design_task.constraint_evidence ?? null) === canonicalDigest(evidence)
    : packet.design_task.constraint_evidence === undefined,
  "final packet changed or leaked reviewer-only constraint evidence");
  need(brief.constraint_audit && reviewer
    ? canonicalDigest(packet.design_task.constraint_released_proposals ?? null) === canonicalDigest(brief.constraint_audit.released_proposals)
    : packet.design_task.constraint_released_proposals === undefined,
  "final packet changed or leaked discarded instructions");
  // In addition to the digest, compare the actual constraint-bearing dispatch
  // fields. Re-sealing a packet after dropping a policy must not authorize it.
  if (!brief.constraint_audit) return;
  const task = packet.design_task;
  if (task.kind === "direction-candidate") {
    for (const [key, expectedValue] of Object.entries({ product: brief.product,
      baseline_policy: brief.baseline_policy, editorial_boundary: brief.editorial_boundary,
      direction: brief.directions.find((item) => item.id === task.direction?.id) })) {
      need(expectedValue && canonicalDigest(task[key === "product" ? "project" : key] ?? null) === canonicalDigest(expectedValue),
        `final packet changed the audited ${key}`);
    }
  }
  if (task.kind === "color-candidate") {
    const strategy = brief.color_strategies?.find((item) => item.id === task.color_strategy?.id);
    need(strategy && canonicalDigest(task.color_strategy) === canonicalDigest(strategy), "final packet changed the audited color strategy");
  }
}

export function validateConstraintReview(review, brief, kind) {
  const audit = validateConstraintAudit(brief);
  const reviewer = reviewerKinds.has(kind);
  if (!audit || !reviewer) {
    need(review === undefined, "unbound/non-review result cannot claim independent constraint review");
    return true;
  }
  shape(review, ["version", "contract_digest", "entries", "released_proposals_not_reintroduced"], "independent review");
  need(review.version === 1 && review.contract_digest === canonicalDigest(audit), "independent review binding mismatch");
  need(Array.isArray(review.entries) && review.entries.length === audit.entries.length, "independent review coverage is incomplete");
  unique(review.entries.map((item) => item?.pointer), "review pointers");
  let satisfied = true;
  for (const item of review.entries) {
    shape(item, ["pointer", "supported", "note"], "review entry");
    need(audit.entries.some((entry) => entry.pointer === item.pointer), "review entry is out of scope");
    text(item.note, "review reasoning");
    need(typeof item.supported === "boolean", `constraint classification judgment at ${item.pointer} must be boolean`);
    satisfied = item.supported && satisfied;
  }
  need(typeof review.released_proposals_not_reintroduced === "boolean", "rejected-skin carryover judgment must be boolean");
  return satisfied && review.released_proposals_not_reintroduced;
}

// Visual review may suggest preserving a treatment, but only an evidenced
// non-proposal classification can substantiate a bound preservation obligation.
// Existing visual-goal validation still owns candidate/browser/decision binding.
export function validateConstraintPreserveInstructions(review, brief) {
  const audit = validateConstraintAudit(brief);
  if (!audit || review === undefined) return;
  need(Array.isArray(review?.candidates), "visual review candidates are missing");
  for (const candidate of review.candidates) {
    need(Array.isArray(candidate?.preserve_instructions), "review preserve instructions must be explicit");
    for (const instruction of candidate.preserve_instructions) {
      if (instruction?.mode !== "bound-obligation") continue;
      const index = brief.component_craft?.relationships.findIndex((item) =>
        item.relationship_id === instruction.relationship_id);
      const relation = brief.component_craft?.relationships[index];
      const entry = audit.entries.find((item) => item.pointer === `/component_craft/relationships/${index}`);
      need(relation && entry && entry.role !== "design-proposal" && entry.evidence_ids.length > 0,
        "unsupported reviewer preservation cannot promote an unapproved visual proposal into a bound obligation");
      need(instruction.decision_digest === canonicalDigest(relation.decision) &&
        relation.decision.preserves?.includes(instruction.text),
      "reviewer preservation must repeat an exact evidenced decision obligation");
    }
  }
}
