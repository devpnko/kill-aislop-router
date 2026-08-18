import fs from "node:fs";
import path from "node:path";

export const VALID_SURFACES = new Set([
  "operator-product-ui",
  "consumer-product-ui",
  "marketing-editorial"
]);

export const VALID_TASKS = new Set([
  "build",
  "redesign",
  "runtime-handoff",
  "audit",
  "copy",
  "pr-hygiene"
]);

export const VALID_DIRECTIONS = new Set(["approved", "missing", "reference", "none"]);
export const VALID_RISKS = new Set(["standard", "high"]);

export class RouterError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.name = "RouterError";
    this.exitCode = exitCode;
  }
}

export function readJson(filePath, label = "JSON") {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new RouterError(`cannot read ${label} at ${filePath}: ${error.message}`);
  }
}

export function findProjectProfile(startDir = process.cwd()) {
  let current = path.resolve(startDir);
  while (true) {
    const candidate = path.join(current, ".killsloprouter", "profile.json");
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export function validateProfile(profile) {
  if (!profile) return;
  if (profile.profile_version !== 1) throw new RouterError("profile_version must be 1", 2);
  if (!profile.project_id || typeof profile.project_id !== "string") {
    throw new RouterError("profile project_id is required", 2);
  }
  if (typeof profile.approved_design_system !== "boolean") {
    throw new RouterError("profile approved_design_system must be boolean", 2);
  }
  if (!profile.local_adapters || typeof profile.local_adapters !== "object") {
    throw new RouterError("profile local_adapters is required", 2);
  }
  if (profile.fallback_adapters && typeof profile.fallback_adapters !== "object") {
    throw new RouterError("profile fallback_adapters must be an object", 2);
  }
  if (profile.evidence) {
    if (typeof profile.evidence !== "object" || Array.isArray(profile.evidence)) {
      throw new RouterError("profile evidence must be an object", 2);
    }
    for (const key of ["required_viewports", "required_checks"]) {
      if (profile.evidence[key] && !Array.isArray(profile.evidence[key])) {
        throw new RouterError(`profile evidence.${key} must be an array`, 2);
      }
    }
  }
  for (const [missingActor, fallbacks] of Object.entries(profile.fallback_adapters || {})) {
    if (!Array.isArray(fallbacks)) {
      throw new RouterError(`fallback_adapters.${missingActor} must be an array`, 2);
    }
    for (const fallback of fallbacks) {
      if (!fallback.id || !fallback.status || !Number.isInteger(fallback.strength)) {
        throw new RouterError(`fallback_adapters.${missingActor} has an invalid provider`, 2);
      }
      if (!Array.isArray(fallback.capabilities) || fallback.capabilities.length === 0) {
        throw new RouterError(`fallback_adapters.${missingActor}.${fallback.id} requires capabilities`, 2);
      }
      if (typeof fallback.independent_from_creator !== "boolean") {
        throw new RouterError(
          `fallback_adapters.${missingActor}.${fallback.id} requires independent_from_creator`,
          2
        );
      }
    }
  }
}

export function normalizeInput(input) {
  const normalized = {
    surface: input.surface,
    task: input.task,
    direction: input.direction || "none",
    changes: [...new Set(input.changes || [])],
    risk: input.risk || "standard"
  };
  if (!VALID_SURFACES.has(normalized.surface)) throw new RouterError("provide a valid surface", 2);
  if (!VALID_TASKS.has(normalized.task)) throw new RouterError("provide a valid task", 2);
  if (!VALID_DIRECTIONS.has(normalized.direction)) throw new RouterError("provide a valid direction", 2);
  if (!VALID_RISKS.has(normalized.risk)) throw new RouterError("risk must be standard or high", 2);
  return normalized;
}

function matches(actual, expected) {
  if (expected === undefined) return true;
  return Array.isArray(expected) ? expected.includes(actual) : expected === actual;
}

function selectRoute(router, input) {
  return router.routes.find((route) =>
    matches(input.surface, route.match.surface) && matches(input.task, route.match.task)
  );
}

function resolveCreator(route, input, profile, override, unresolved) {
  const policy = route.creator_policy;
  if (policy.type === "none") return null;
  if (override.creator) return override.creator;
  if (override.creator_by_direction?.[input.direction]) {
    return override.creator_by_direction[input.direction];
  }
  if (policy.type === "fixed") {
    if (policy.requires_profile_flag && !profile?.[policy.requires_profile_flag]) {
      unresolved.push(`creator requires project profile flag: ${policy.requires_profile_flag}`);
      return null;
    }
    return policy.tool;
  }
  if (policy.type === "by-direction") {
    const selected = policy.cases.find((item) => item.direction === input.direction);
    if (!selected) {
      unresolved.push(`no creator case for direction: ${input.direction}`);
      return null;
    }
    if (selected.requires_profile_flag && !profile?.[selected.requires_profile_flag]) {
      unresolved.push(`creator requires project profile flag: ${selected.requires_profile_flag}`);
      return null;
    }
    return selected.tool;
  }
  unresolved.push(`unsupported creator policy: ${policy.type}`);
  return null;
}

const AVAILABLE_STATUSES = new Set(["available", "routable", "declared-by-profile"]);

function providerContract(router, id) {
  return router.provider_capabilities?.[id] || {};
}

function mergeCapabilities(...sources) {
  return [...new Set(sources.flat().filter(Boolean))];
}

function verifiedAvailability(declaration, fallbackStatus) {
  const availability = declaration?.status || fallbackStatus;
  const localTarget = declaration?.root || declaration?.target || declaration?.resolved_to;
  if (
    AVAILABLE_STATUSES.has(availability) &&
    typeof localTarget === "string" &&
    path.isAbsolute(localTarget) &&
    !fs.existsSync(localTarget)
  ) {
    return "blocked-missing-target";
  }
  return availability;
}

function resolveActor(actor, profile, router) {
  const contract = providerContract(router, actor.id);
  if (actor.kind === "local") {
    const configured = profile?.local_adapters?.[actor.id];
    const declaration = typeof configured === "string" ? { target: configured } : configured;
    return {
      ...actor,
      resolved_to: declaration?.target || declaration?.resolved_to || null,
      availability: verifiedAvailability(
        declaration,
        declaration ? "declared-by-profile" : "blocked-unconfigured"
      ),
      version: declaration?.version || contract.version || null,
      strength: declaration?.strength ?? contract.strength ?? 1,
      capabilities: mergeCapabilities(contract.capabilities, actor.capabilities, declaration?.capabilities),
      independent_from_creator: declaration?.independent_from_creator ?? contract.independent_from_creator ?? false,
      executor: declaration?.executor || null
    };
  }
  const declared = profile?.external_adapters?.[actor.id];
  return {
    ...actor,
    version: declared?.version || contract.version || null,
    availability: verifiedAvailability(declared, "not-checked"),
    strength: declared?.strength ?? contract.strength ?? 1,
    capabilities: mergeCapabilities(contract.capabilities, actor.capabilities, declared?.capabilities),
    independent_from_creator: declared?.independent_from_creator ?? contract.independent_from_creator ?? true,
    executor: declared?.executor || null
  };
}

function resolveFallback(fallback, missingActorId, router) {
  const contract = providerContract(router, fallback.id);
  return {
    id: fallback.id,
    kind: fallback.kind || "local",
    fallback_for: missingActorId,
    resolved_to: fallback.target || fallback.resolved_to || null,
    availability: verifiedAvailability(fallback, "not-checked"),
    version: fallback.version || contract.version || null,
    strength: fallback.strength ?? contract.strength ?? 1,
    capabilities: mergeCapabilities(contract.capabilities, fallback.capabilities),
    independent_from_creator: fallback.independent_from_creator ?? contract.independent_from_creator ?? false,
    executor: fallback.executor || null
  };
}

function capabilityContract(router, stage) {
  const configured = router.stage_capability_contracts?.[stage.id] || {};
  return {
    required: mergeCapabilities(configured.required, stage.required_capabilities),
    minimumStrength: stage.minimum_strength ?? configured.minimum_strength ?? 1,
    requiresIndependentCritic:
      stage.requires_independent_critic ?? configured.requires_independent_critic ?? false,
    evidenceRequired: stage.evidence_required ?? configured.evidence_required ?? false,
    requiredEvidenceKinds: mergeCapabilities(
      configured.required_evidence_kinds,
      stage.required_evidence_kinds
    )
  };
}

function coverStage(stage, primaryActors, creator, profile, router) {
  const contract = capabilityContract(router, stage);
  const selected = primaryActors.filter(
    (actor) => AVAILABLE_STATUSES.has(actor.availability) && actor.strength >= contract.minimumStrength
  );
  const requiredSelected = () => selected.filter((actor) => !actor.optional);
  const unavailable = primaryActors
    .filter((actor) => !AVAILABLE_STATUSES.has(actor.availability) || actor.strength < contract.minimumStrength)
    .map((actor) => ({
      ...actor,
      routing_issue: !AVAILABLE_STATUSES.has(actor.availability)
        ? `availability:${actor.availability}`
        : `strength:${actor.strength}<${contract.minimumStrength}`
    }));
  const fallbackCandidates = unavailable.filter((actor) => !actor.optional).flatMap((actor) =>
    (profile?.fallback_adapters?.[actor.id] || []).map((fallback) =>
      resolveFallback(fallback, actor.id, router)
    )
  );
  const selectedIds = new Set(selected.map((actor) => actor.id));
  const covered = new Set(requiredSelected().flatMap((actor) => actor.capabilities || []));
  const substitutions = [];

  const eligibleFallbacks = fallbackCandidates
    .filter((candidate) => AVAILABLE_STATUSES.has(candidate.availability))
    .filter((candidate) => candidate.strength >= contract.minimumStrength)
    .filter((candidate) => candidate.id !== creator)
    .filter((candidate) => !contract.requiresIndependentCritic || candidate.independent_from_creator)
    .sort((a, b) => {
      const aCoverage = a.capabilities.filter((item) => contract.required.includes(item)).length;
      const bCoverage = b.capabilities.filter((item) => contract.required.includes(item)).length;
      return bCoverage - aCoverage || b.strength - a.strength || a.id.localeCompare(b.id);
    });

  for (const candidate of eligibleFallbacks) {
    const addsCoverage = candidate.capabilities.some(
      (capability) => contract.required.includes(capability) && !covered.has(capability)
    );
    const suppliesIndependentCritic =
      contract.requiresIndependentCritic &&
      candidate.independent_from_creator &&
      !requiredSelected().some((actor) => actor.independent_from_creator && actor.id !== creator);
    if (!addsCoverage && !suppliesIndependentCritic) continue;
    if (!selectedIds.has(candidate.id)) {
      selected.push(candidate);
      selectedIds.add(candidate.id);
      substitutions.push({
        missing_actor: candidate.fallback_for,
        selected_actor: candidate.id,
        strength: candidate.strength,
        capabilities: candidate.capabilities
      });
    }
    for (const capability of candidate.capabilities) covered.add(capability);
  }

  const missingCapabilities = contract.required.filter((capability) => !covered.has(capability));
  const hasIndependentCritic =
    !contract.requiresIndependentCritic ||
    requiredSelected().some((actor) => actor.independent_from_creator && actor.id !== creator);
  const blockedForNoActor = primaryActors.some((actor) => !actor.optional) && requiredSelected().length === 0;
  const blocked = missingCapabilities.length > 0 || !hasIndependentCritic || blockedForNoActor;

  return {
    ...stage,
    actors: primaryActors,
    selected_actors: selected,
    unavailable_actors: unavailable,
    fallback_candidates: fallbackCandidates,
    substitutions,
    required_capabilities: contract.required,
    covered_capabilities: contract.required.filter((capability) => covered.has(capability)),
    missing_capabilities: missingCapabilities,
    minimum_strength: contract.minimumStrength,
    requires_independent_critic: contract.requiresIndependentCritic,
    evidence_required: contract.evidenceRequired,
    required_evidence_kinds: contract.requiredEvidenceKinds,
    routing_status: blocked
      ? "blocked"
      : substitutions.length
        ? "ready_with_fallback"
        : "ready_primary"
  };
}

function resolveStages(route, creator, profile, override, input, router) {
  const excluded = new Set([...(route.excluded_tools || []), ...(override.exclude_tools || [])]);
  const stages = [];

  for (const stage of route.stages) {
    if (stage.when_creator && !stage.when_creator.includes(creator)) continue;
    const actors = stage.actors
      .filter((actor) => !excluded.has(actor.id))
      .filter((actor) => !(actor.skip_if_creator && actor.id === creator))
      .map((actor) => resolveActor(actor, profile, router));
    if (actors.length) stages.push(coverStage(stage, actors, creator, profile, router));
  }

  if (input.risk === "high") {
    const represented = new Set(stages.flatMap((stage) => stage.actors.map((actor) => actor.id)));
    const actors = (profile?.high_risk_gates || [])
      .filter((id) => !represented.has(id))
      .map((id) => resolveActor({ id, kind: "local" }, profile, router));
    if (actors.length) {
      const highRiskStage = {
        id: "high-risk-project-gates",
        question: "Have project-specific privacy, authority, contract, and external-action gates passed?",
        actors
      };
      const browserIndex = stages.findIndex((stage) => stage.id === "browser-evidence");
      stages.splice(
        browserIndex >= 0 ? browserIndex : stages.length,
        0,
        coverStage(highRiskStage, actors, creator, profile, router)
      );
    }
  }
  return stages;
}

function requiredStages(router, input, profile) {
  const ids = new Set();
  for (const change of input.changes) {
    for (const id of router.change_requirements?.[change] || []) ids.add(id);
  }
  if (input.risk === "high") {
    for (const id of [
      "project-contract",
      "domain-authority-review",
      "browser-evidence",
      "owner-approval",
      ...(profile?.high_risk_gates || [])
    ]) ids.add(id);
  }
  return [...ids];
}

export function planRoute({ router, profile = null, input, routerPath = null, profilePath = null }) {
  validateProfile(profile);
  const normalized = normalizeInput(input);
  const route = selectRoute(router, normalized);
  if (!route) throw new RouterError(`no route matches ${normalized.surface}/${normalized.task}`, 3);

  const override = profile?.surface_overrides?.[normalized.surface] || {};
  const unresolved = [];
  const creator = resolveCreator(route, normalized, profile, override, unresolved);
  const stages = resolveStages(route, creator, profile, override, normalized, router);
  const required = requiredStages(router, normalized, profile);
  const represented = new Set(stages.flatMap((stage) => [stage.id, ...stage.actors.map((actor) => actor.id)]));
  const missingRequired = required
    .filter((id) => !represented.has(id))
    .map((id) => `required stage or gate is not represented in selected route: ${id}`);
  unresolved.push(...missingRequired);
  const warnings = [];

  for (const stage of stages) {
    if (stage.routing_status !== "blocked" || stage.optional) continue;
    const details = [];
    if (stage.missing_capabilities.length) {
      details.push(`missing capabilities: ${stage.missing_capabilities.join(", ")}`);
    }
    if (stage.requires_independent_critic && !stage.selected_actors.some(
      (actor) => !actor.optional && actor.independent_from_creator && actor.id !== creator
    )) {
      details.push("independent critic unavailable");
    }
    if (!details.length) details.push("no available provider or sufficient fallback");
    unresolved.push(`${stage.id} blocked (${details.join("; ")})`);
  }

  return {
    receipt_version: 1,
    router_id: router.router_id,
    router_version: router.router_version,
    router_path: routerPath,
    profile_path: profilePath,
    project_id: profile?.project_id || null,
    status: unresolved.length ? "blocked" : "planned",
    route_id: route.id,
    input: normalized,
    creator,
    stages,
    required_stage_ids: required,
    unresolved: [...new Set(unresolved)],
    warnings,
    evidence_contract: profile?.evidence || null,
    adjudication: router.adjudication,
    invariants: router.invariants
  };
}

export function formatReceipt(receipt) {
  const lines = [
    `KillSlopRouter ${receipt.router_version}`,
    `status: ${receipt.status}`,
    `route: ${receipt.route_id}`,
    `project: ${receipt.project_id || "unprofiled"}`,
    `creator: ${receipt.creator || "none"}`,
    `surface/task: ${receipt.input.surface} / ${receipt.input.task}`,
    `direction/risk: ${receipt.input.direction} / ${receipt.input.risk}`,
    "stages:"
  ];
  for (const stage of receipt.stages) {
    const actors = stage.selected_actors.map((actor) => actor.resolved_to || actor.id).join(", ");
    const fallback = stage.routing_status === "ready_with_fallback" ? " fallback" : "";
    lines.push(`  - ${stage.id} [${stage.routing_status}${fallback}]: ${actors || "none"}`);
    if (stage.missing_capabilities.length) {
      lines.push(`    missing: ${stage.missing_capabilities.join(", ")}`);
    }
  }
  if (receipt.required_stage_ids.length) {
    lines.push(`required by change/risk: ${receipt.required_stage_ids.join(", ")}`);
  }
  for (const item of receipt.unresolved) lines.push(`unresolved: ${item}`);
  for (const item of receipt.warnings) lines.push(`warning: ${item}`);
  return `${lines.join("\n")}\n`;
}
