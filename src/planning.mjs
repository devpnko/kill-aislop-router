import fs from "node:fs";
import path from "node:path";
import { hashArtifact } from "./integrity.mjs";

const VALID_PHASES = new Set(["phase_1", "phase_2"]);
const VALID_GATE_STATUSES = new Set([
  "not_started",
  "in_progress",
  "pending",
  "passed",
  "approved",
  "blocked",
  "locked"
]);
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;

const GATE_CONTRACTS = {
  G6: {
    statuses: ["passed", "approved"],
    evidence_kinds: ["mockup"],
    purpose: "versioned all-scope mockup exists"
  },
  G6T: {
    statuses: ["passed", "approved"],
    evidence_kinds: ["audit-receipt"],
    purpose: "task, accessibility, and anti-slop checks passed"
  },
  G7: {
    statuses: ["approved"],
    evidence_kinds: ["approved-artifact", "owner-approval"],
    purpose: "the owner approved an exact artifact version"
  },
  G8: {
    statuses: ["passed", "approved"],
    evidence_kinds: ["implementation-contract"],
    purpose: "final data, API, event, migration, and system contracts are fixed"
  },
  G9A: {
    statuses: ["passed", "approved"],
    evidence_kinds: ["implementation"],
    purpose: "the runtime implementation exists"
  }
};

function uniqueRequirements(requirements) {
  const seen = new Set();
  return requirements.filter((requirement) => {
    if (seen.has(requirement.gate)) return false;
    seen.add(requirement.gate);
    return true;
  });
}

export function planningRequirements(input, scope = input?.scope || null) {
  if (input?.task === "systemize") {
    return ["G6T", "G7"].map((gate) => ({ gate, ...GATE_CONTRACTS[gate] }));
  }
  if (input?.task === "runtime-handoff") {
    return ["G7", "G8"].map((gate) => ({ gate, ...GATE_CONTRACTS[gate] }));
  }
  if (input?.task === "audit" && scope === "mockup") {
    return [{ gate: "G6", ...GATE_CONTRACTS.G6 }];
  }
  if (input?.task === "audit" && scope === "runtime") {
    return ["G7", "G8", "G9A"].map((gate) => ({ gate, ...GATE_CONTRACTS[gate] }));
  }
  return [];
}

function validateReceipt(receipt, expectedProjectId, expectedSurface) {
  const errors = [];
  if (receipt?.planning_gate_version !== 1) errors.push("planning_gate_version must be 1");
  if (!receipt?.protocol?.id || !receipt?.protocol?.version || !receipt?.protocol?.authority) {
    errors.push("protocol id, version, and authority are required");
  }
  if (!receipt?.project_id) errors.push("project_id is required");
  if (expectedProjectId && receipt?.project_id !== expectedProjectId) {
    errors.push(`project_id mismatch: expected ${expectedProjectId}, received ${receipt?.project_id || "missing"}`);
  }
  if (!receipt?.surface) errors.push("surface is required");
  if (expectedSurface && receipt?.surface !== expectedSurface) {
    errors.push(`surface mismatch: expected ${expectedSurface}, received ${receipt?.surface || "missing"}`);
  }
  if (!receipt?.scope_id) errors.push("scope_id is required");
  if (!VALID_PHASES.has(receipt?.phase)) errors.push("phase must be phase_1 or phase_2");
  if (!receipt?.updated_at || Number.isNaN(Date.parse(receipt.updated_at))) {
    errors.push("updated_at must be a valid timestamp");
  }
  if (!receipt?.gates || typeof receipt.gates !== "object" || Array.isArray(receipt.gates)) {
    errors.push("gates must be an object");
    return errors;
  }
  for (const [gateId, gate] of Object.entries(receipt.gates)) {
    if (!gate || typeof gate !== "object" || Array.isArray(gate)) {
      errors.push(`${gateId} must be an object`);
      continue;
    }
    if (!VALID_GATE_STATUSES.has(gate.status)) errors.push(`${gateId} has an invalid status`);
    if (gate.evidence !== undefined && !Array.isArray(gate.evidence)) {
      errors.push(`${gateId}.evidence must be an array`);
      continue;
    }
    for (const [index, evidence] of (gate.evidence || []).entries()) {
      if (!evidence?.kind || !evidence?.path || !DIGEST_PATTERN.test(evidence?.digest || "")) {
        errors.push(`${gateId}.evidence[${index}] requires kind, path, and a sha256 digest`);
      }
    }
  }
  return errors;
}

function verifyRequiredGate(receipt, receiptPath, requirement) {
  const errors = [];
  const gate = receipt.gates?.[requirement.gate];
  if (!gate) return [`${requirement.gate} is missing (${requirement.purpose})`];
  if (!requirement.statuses.includes(gate.status)) {
    errors.push(
      `${requirement.gate} must be ${requirement.statuses.join(" or ")}; current status is ${gate.status}`
    );
  }
  const evidence = gate.evidence || [];
  const evidenceKinds = new Set(evidence.map((item) => item.kind));
  for (const kind of requirement.evidence_kinds) {
    if (!evidenceKinds.has(kind)) errors.push(`${requirement.gate} is missing ${kind} evidence`);
  }
  for (const item of evidence) {
    const evidencePath = path.isAbsolute(item.path)
      ? item.path
      : path.resolve(path.dirname(receiptPath), item.path);
    if (!fs.existsSync(evidencePath)) {
      errors.push(`${requirement.gate} evidence is missing: ${item.path}`);
      continue;
    }
    try {
      const digest = hashArtifact(evidencePath);
      if (digest !== item.digest) {
        errors.push(`${requirement.gate} evidence digest changed: ${item.path}`);
        continue;
      }
      if (item.kind === "owner-approval") {
        try {
          const approval = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
          const ownerId = approval.owner_id || approval.owner_approval?.owner_id;
          if (approval.status !== "approved" || !ownerId) {
            errors.push(`${requirement.gate} owner-approval evidence is not an explicit approved owner decision`);
          }
        } catch (error) {
          errors.push(`${requirement.gate} owner-approval evidence must be machine-readable JSON`);
        }
      }
    } catch (error) {
      errors.push(`${requirement.gate} evidence cannot be verified: ${item.path} (${error.message})`);
    }
  }
  return errors;
}

function evaluateReceipt({ receiptPath, expectedDigest = null, projectId, surface, requirements }) {
  const errors = [];
  if (!fs.existsSync(receiptPath)) {
    return { receipt: null, digest: null, errors: [`planning receipt not found: ${receiptPath}`] };
  }
  let digest;
  let receipt;
  try {
    digest = hashArtifact(receiptPath);
    receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
  } catch (error) {
    return { receipt: null, digest: null, errors: [`cannot read planning receipt: ${error.message}`] };
  }
  if (expectedDigest && digest !== expectedDigest) {
    errors.push("planning receipt changed after route planning; generate a new route plan");
  }
  errors.push(...validateReceipt(receipt, projectId, surface));
  if (!errors.length) {
    for (const requirement of requirements) {
      errors.push(...verifyRequiredGate(receipt, receiptPath, requirement));
    }
  }
  return { receipt, digest, errors };
}

function selectReceipt(profile, profilePath, surface) {
  const planning = profile?.planning;
  if (!planning) return null;
  const configured = planning.surface_receipts?.[surface] || planning.receipt || null;
  if (!configured) return null;
  const base = profilePath ? path.dirname(path.resolve(profilePath)) : process.cwd();
  return path.isAbsolute(configured) ? configured : path.resolve(base, configured);
}

export function resolvePlanningGate({ profile, profilePath = null, input }) {
  const configured = Boolean(profile?.planning);
  const intrinsicallyRequired = input.task === "systemize";
  const requirements = planningRequirements(input);
  const policyRequired = profile?.planning?.required === true;
  const enforced = intrinsicallyRequired || (policyRequired && requirements.length > 0);

  if (!configured && !intrinsicallyRequired) {
    return {
      enabled: false,
      policy_required: false,
      enforced: false,
      status: "not-configured",
      requirements: [],
      unresolved: [],
      warnings: []
    };
  }

  const receiptPath = selectReceipt(profile, profilePath, input.surface);
  if (!receiptPath) {
    const message = `no planning receipt is configured for ${input.surface}`;
    return {
      enabled: configured,
      policy_required: policyRequired,
      enforced,
      status: enforced ? "blocked" : "not-configured",
      requirements,
      receipt_path: null,
      receipt_digest: null,
      gate_statuses: {},
      unresolved: enforced ? [message] : [],
      warnings: enforced ? [] : [message]
    };
  }

  const evaluated = evaluateReceipt({
    receiptPath,
    projectId: profile?.project_id || null,
    surface: input.surface,
    requirements
  });
  const failures = evaluated.errors;
  const gateStatuses = Object.fromEntries(
    Object.entries(evaluated.receipt?.gates || {}).map(([gate, value]) => [gate, value.status])
  );
  return {
    enabled: true,
    policy_required: policyRequired,
    enforced,
    status: failures.length ? (enforced ? "blocked" : "observed_with_findings") : "ready",
    protocol: evaluated.receipt?.protocol || null,
    phase: evaluated.receipt?.phase || null,
    scope_id: evaluated.receipt?.scope_id || null,
    receipt_path: receiptPath,
    receipt_digest: evaluated.digest,
    gate_statuses: gateStatuses,
    requirements,
    unresolved: enforced ? failures : [],
    warnings: enforced ? [] : failures
  };
}

export function verifyPlanningGateForAudit(plan, scope) {
  const planning = plan?.planning_gate;
  const requirements = uniqueRequirements([
    ...(planning?.requirements || []),
    ...planningRequirements(plan.input, scope)
  ]);
  const enforced = plan?.input?.task === "systemize" || (
    planning?.policy_required === true && requirements.length > 0
  );
  if (!planning?.enabled && !enforced) return planning || null;
  if (!enforced) return planning || null;
  if (!planning?.receipt_path || !planning.receipt_digest) {
    throw new Error("the route plan has no verifiable planning receipt");
  }
  const evaluated = evaluateReceipt({
    receiptPath: planning.receipt_path,
    expectedDigest: planning.receipt_digest,
    projectId: plan.project_id,
    surface: plan.input?.surface,
    requirements
  });
  if (evaluated.errors.length) {
    throw new Error(`planning gate verification failed: ${evaluated.errors.join("; ")}`);
  }
  return {
    enabled: true,
    policy_required: planning.policy_required === true,
    enforced: true,
    status: "ready",
    receipt_path: planning.receipt_path,
    receipt_digest: planning.receipt_digest,
    protocol: planning.protocol,
    phase: planning.phase,
    scope_id: planning.scope_id,
    requirements,
    gate_statuses: planning.gate_statuses
  };
}
