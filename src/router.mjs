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

function resolveActor(actor, profile) {
  if (actor.kind === "local") {
    const resolved = profile?.local_adapters?.[actor.id];
    return {
      ...actor,
      resolved_to: resolved || null,
      availability: resolved ? "declared-by-profile" : "blocked-unconfigured"
    };
  }
  const declared = profile?.external_adapters?.[actor.id];
  return {
    ...actor,
    version: declared?.version || null,
    availability: declared?.status || "not-checked"
  };
}

function resolveStages(route, creator, profile, override, input) {
  const excluded = new Set([...(route.excluded_tools || []), ...(override.exclude_tools || [])]);
  const stages = [];

  for (const stage of route.stages) {
    if (stage.when_creator && !stage.when_creator.includes(creator)) continue;
    const actors = stage.actors
      .filter((actor) => !excluded.has(actor.id))
      .filter((actor) => !(actor.skip_if_creator && actor.id === creator))
      .map((actor) => resolveActor(actor, profile));
    if (actors.length) stages.push({ ...stage, actors });
  }

  if (input.risk === "high") {
    const represented = new Set(stages.flatMap((stage) => stage.actors.map((actor) => actor.id)));
    const actors = (profile?.high_risk_gates || [])
      .filter((id) => !represented.has(id))
      .map((id) => resolveActor({ id, kind: "local" }, profile));
    if (actors.length) {
      const highRiskStage = {
        id: "high-risk-project-gates",
        question: "Have project-specific privacy, authority, contract, and external-action gates passed?",
        actors
      };
      const browserIndex = stages.findIndex((stage) => stage.id === "browser-evidence");
      stages.splice(browserIndex >= 0 ? browserIndex : stages.length, 0, highRiskStage);
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
  const stages = resolveStages(route, creator, profile, override, normalized);
  const required = requiredStages(router, normalized, profile);
  const represented = new Set(stages.flatMap((stage) => [stage.id, ...stage.actors.map((actor) => actor.id)]));
  const warnings = required
    .filter((id) => !represented.has(id))
    .map((id) => `required stage or gate is not represented in selected route: ${id}`);

  for (const stage of stages) {
    for (const actor of stage.actors) {
      if (actor.availability === "blocked-unconfigured") {
        unresolved.push(`local adapter is not configured: ${actor.id}`);
      }
    }
  }

  return {
    receipt_version: 1,
    router_id: router.router_id,
    router_version: router.router_version,
    router_path: routerPath,
    profile_path: profilePath,
    project_id: profile?.project_id || null,
    status: unresolved.length ? "unresolved" : "planned",
    route_id: route.id,
    input: normalized,
    creator,
    stages,
    required_stage_ids: required,
    unresolved: [...new Set(unresolved)],
    warnings,
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
    const actors = stage.actors.map((actor) => actor.resolved_to || actor.id).join(", ");
    lines.push(`  - ${stage.id}: ${actors}`);
  }
  if (receipt.required_stage_ids.length) {
    lines.push(`required by change/risk: ${receipt.required_stage_ids.join(", ")}`);
  }
  for (const item of receipt.unresolved) lines.push(`unresolved: ${item}`);
  for (const item of receipt.warnings) lines.push(`warning: ${item}`);
  return `${lines.join("\n")}\n`;
}
