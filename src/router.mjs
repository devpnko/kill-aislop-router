import fs from "node:fs";
import path from "node:path";
import { canonicalDigest, hashArtifact } from "./integrity.mjs";
import { resolvePlanningGate } from "./planning.mjs";

export const VALID_SURFACES = new Set([
  "operator-product-ui",
  "consumer-product-ui",
  "marketing-editorial"
]);

export const VALID_VISUAL_INTENT_MODES = new Set([
  "unresolved",
  "product-native",
  "brand-expressive",
  "editorial",
  "campaign",
  "reference-led"
]);
export const VALID_EDITORIAL_TREATMENTS = new Set(["forbidden", "bounded", "required"]);
export const VALID_VISUAL_ENERGY = new Set(["preserve", "quiet", "balanced", "high"]);
export const VALID_VISUAL_DEPTH = new Set(["preserve", "flat", "layered", "immersive"]);
export const VALID_VISUAL_DENSITY = new Set(["preserve", "compact", "balanced", "spacious", "mixed"]);
export const VALID_ELEVATION_STRATEGIES = new Set([
  "preserve",
  "flat",
  "border-led",
  "layered",
  "immersive",
  "mixed"
]);
export const VALID_IMAGERY_STRATEGIES = new Set([
  "preserve",
  "none",
  "functional",
  "brand",
  "editorial",
  "campaign",
  "mixed"
]);
export const VALID_MOTION_INTENSITIES = new Set([
  "preserve",
  "none",
  "restrained",
  "balanced",
  "expressive"
]);
const VISUAL_INTENT_TASKS = new Set(["build", "redesign", "systemize", "runtime-handoff", "audit"]);

export const VALID_TASKS = new Set([
  "build",
  "redesign",
  "systemize",
  "runtime-handoff",
  "audit",
  "copy",
  "pr-hygiene"
]);

export const VALID_DIRECTIONS = new Set(["approved", "missing", "reference", "none"]);
export const VALID_RISKS = new Set(["standard", "high"]);
export const VALID_SCOPES = new Set(["mockup", "runtime", "source", "document"]);
const FORBIDDEN_PROFILE_EXECUTION_FIELDS = new Set([
  "command",
  "cmd",
  "args",
  "shell",
  "entrypoint",
  "executable"
]);
const SURFACE_CONTRACT_KEYS = new Set([
  "surface_contract_version",
  "primary",
  "allowed",
  "artifact_bindings"
]);
const SURFACE_BINDING_KEYS = new Set(["root", "surface"]);
const VISUAL_INTENT_KEYS = new Set([
  "visual_intent_version",
  "status",
  "mode",
  "editorial_treatment",
  "editorial_scope",
  "energy",
  "depth",
  "preserve",
  "avoid",
  "authority_receipt",
  "authority_digest"
]);
const REQUIRED_VISUAL_INTENT_KEYS = [
  "visual_intent_version",
  "status",
  "mode",
  "editorial_treatment",
  "editorial_scope",
  "energy",
  "depth",
  "preserve",
  "avoid"
];
const VISUAL_INTENT_RECEIPT_KEYS = new Set([
  "visual_intent_receipt_version",
  "project_id",
  "surface",
  "status",
  "intent",
  "authority",
  "evidence"
]);
const VISUAL_INTENT_AUTHORITY_KEYS = new Set(["kind", "authority_id", "basis", "decided_at"]);
const VISUAL_INTENT_EVIDENCE_KEYS = new Set(["kind", "path", "digest"]);
const VISUAL_INTENT_AUTHORITY_KINDS = new Set([
  "project-contract",
  "brand-system",
  "owner-direction",
  "approved-reference"
]);
const VISUAL_INTENT_EVIDENCE_KINDS = new Set([
  "project-contract",
  "brand-system",
  "owner-direction",
  "approved-reference",
  "approved-artifact",
  "owner-approval"
]);
const VISUAL_SIGNATURE_KEYS = new Set([
  "visual_signature_version",
  "status",
  "palette",
  "typography",
  "density",
  "shape",
  "elevation",
  "imagery",
  "motion",
  "style_keywords",
  "forbidden_transformations",
  "authority_receipt",
  "authority_digest"
]);
const REQUIRED_VISUAL_SIGNATURE_KEYS = [
  "visual_signature_version",
  "status",
  "palette",
  "typography",
  "density",
  "shape",
  "elevation",
  "imagery",
  "motion",
  "style_keywords",
  "forbidden_transformations"
];
const VISUAL_SIGNATURE_RECEIPT_KEYS = new Set([
  "visual_signature_receipt_version",
  "project_id",
  "surface",
  "status",
  "signature",
  "authority",
  "evidence",
  "coverage"
]);
const VISUAL_SIGNATURE_AUTHORITY_KINDS = new Set([
  "project-contract",
  "brand-system",
  "design-system",
  "owner-direction",
  "approved-reference"
]);
const VISUAL_SIGNATURE_EVIDENCE_KINDS = new Set([
  "project-contract",
  "brand-system",
  "design-system",
  "design-tokens",
  "owner-direction",
  "approved-reference",
  "approved-artifact",
  "owner-approval"
]);
const VISUAL_SIGNATURE_ASPECTS = new Set([
  "palette",
  "typography",
  "density",
  "shape",
  "elevation",
  "imagery",
  "motion",
  "style_keywords",
  "forbidden_transformations"
]);
const PALETTE_KEYS = new Set(["primary", "accent", "background", "surface", "text", "semantic"]);
const COLOR_REFERENCE_KEYS = new Set(["value", "token", "usage"]);
const SEMANTIC_COLOR_REFERENCE_KEYS = new Set(["role", "value", "token", "usage"]);
const TYPOGRAPHY_KEYS = new Set(["families", "scale", "weights", "treatments"]);
const FONT_REFERENCE_KEYS = new Set(["family", "role"]);
const DENSITY_KEYS = new Set(["mode", "characteristics"]);
const SHAPE_KEYS = new Set(["radii", "geometry", "strokes"]);
const ELEVATION_KEYS = new Set(["strategy", "shadows", "separation"]);
const IMAGERY_KEYS = new Set(["strategy", "characteristics"]);
const MOTION_KEYS = new Set(["intensity", "characteristics"]);
const SIGNATURE_COVERAGE_KEYS = new Set(["aspect", "evidence_paths"]);
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;

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

function normalizedBindingRoot(value, label) {
  if (typeof value !== "string" || !value.trim() || value.includes("\0")) {
    throw new RouterError(`${label}.root must be a non-empty relative path`, 2);
  }
  const portable = value.replaceAll("\\", "/");
  if (path.isAbsolute(value) || /^[A-Za-z]:\//.test(portable) ||
    portable.split("/").includes("..")) {
    throw new RouterError(`${label}.root must stay inside the project root`, 2);
  }
  const normalized = path.normalize(value);
  return normalized === "" ? "." : normalized;
}

export function validateSurfaceContract(profile) {
  const contract = profile?.surface_contract;
  if (!contract || typeof contract !== "object" || Array.isArray(contract)) {
    throw new RouterError(
      "profile surface_contract is required; bind the project surface before routing",
      2
    );
  }
  for (const key of Object.keys(contract)) {
    if (!SURFACE_CONTRACT_KEYS.has(key)) {
      throw new RouterError(`profile surface_contract contains unsupported field: ${key}`, 2);
    }
  }
  if (contract.surface_contract_version !== 1) {
    throw new RouterError("profile surface_contract.surface_contract_version must be 1", 2);
  }
  if (!VALID_SURFACES.has(contract.primary)) {
    throw new RouterError("profile surface_contract.primary must be a valid surface", 2);
  }
  if (!Array.isArray(contract.allowed) || contract.allowed.length === 0 ||
    new Set(contract.allowed).size !== contract.allowed.length ||
    contract.allowed.some((surface) => !VALID_SURFACES.has(surface))) {
    throw new RouterError("profile surface_contract.allowed must contain unique valid surfaces", 2);
  }
  if (!contract.allowed.includes(contract.primary)) {
    throw new RouterError("profile surface_contract.allowed must include primary", 2);
  }
  if (!Array.isArray(contract.artifact_bindings) || contract.artifact_bindings.length === 0) {
    throw new RouterError("profile surface_contract.artifact_bindings must not be empty", 2);
  }
  const roots = new Set();
  const boundSurfaces = new Set();
  for (const [index, binding] of contract.artifact_bindings.entries()) {
    const label = `profile surface_contract.artifact_bindings[${index}]`;
    if (!binding || typeof binding !== "object" || Array.isArray(binding)) {
      throw new RouterError(`${label} must be an object`, 2);
    }
    for (const key of Object.keys(binding)) {
      if (!SURFACE_BINDING_KEYS.has(key)) {
        throw new RouterError(`${label} contains unsupported field: ${key}`, 2);
      }
    }
    const normalizedRoot = normalizedBindingRoot(binding.root, label);
    if (roots.has(normalizedRoot)) {
      throw new RouterError(`profile surface_contract has duplicate artifact root: ${binding.root}`, 2);
    }
    roots.add(normalizedRoot);
    if (!contract.allowed.includes(binding.surface)) {
      throw new RouterError(`${label}.surface is not allowed by the surface contract`, 2);
    }
    boundSurfaces.add(binding.surface);
  }
  for (const surface of contract.allowed) {
    if (!boundSurfaces.has(surface)) {
      throw new RouterError(`profile surface_contract has no artifact binding for ${surface}`, 2);
    }
  }
  return contract;
}

function requireUniqueStrings(value, label, { allowEmpty = false } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0) ||
    value.some((item) => typeof item !== "string" || !item.trim()) ||
    new Set(value).size !== value.length) {
    throw new RouterError(`${label} must contain ${allowEmpty ? "unique" : "one or more unique"} non-empty strings`, 2);
  }
}

export function visualIntentBody(contract) {
  return {
    mode: contract.mode,
    editorial_treatment: contract.editorial_treatment,
    editorial_scope: [...(contract.editorial_scope || [])],
    energy: contract.energy,
    depth: contract.depth,
    preserve: [...contract.preserve],
    avoid: [...contract.avoid]
  };
}

export function validateVisualIntentContract(contract, label = "visual intent contract") {
  if (!contract || typeof contract !== "object" || Array.isArray(contract)) {
    throw new RouterError(`${label} must be an object`, 2);
  }
  for (const key of Object.keys(contract)) {
    if (!VISUAL_INTENT_KEYS.has(key)) {
      throw new RouterError(`${label} contains unsupported field: ${key}`, 2);
    }
  }
  for (const key of REQUIRED_VISUAL_INTENT_KEYS) {
    if (!Object.hasOwn(contract, key)) throw new RouterError(`${label}.${key} is required`, 2);
  }
  if (contract.visual_intent_version !== 1) {
    throw new RouterError(`${label}.visual_intent_version must be 1`, 2);
  }
  if (!["unresolved", "approved"].includes(contract.status)) {
    throw new RouterError(`${label}.status must be unresolved or approved`, 2);
  }
  if (!VALID_VISUAL_INTENT_MODES.has(contract.mode)) {
    throw new RouterError(`${label}.mode is invalid`, 2);
  }
  if (!VALID_EDITORIAL_TREATMENTS.has(contract.editorial_treatment)) {
    throw new RouterError(`${label}.editorial_treatment is invalid`, 2);
  }
  if (!VALID_VISUAL_ENERGY.has(contract.energy)) {
    throw new RouterError(`${label}.energy is invalid`, 2);
  }
  if (!VALID_VISUAL_DEPTH.has(contract.depth)) {
    throw new RouterError(`${label}.depth is invalid`, 2);
  }
  requireUniqueStrings(contract.editorial_scope || [], `${label}.editorial_scope`, { allowEmpty: true });
  requireUniqueStrings(contract.preserve, `${label}.preserve`);
  requireUniqueStrings(contract.avoid, `${label}.avoid`);

  if (contract.editorial_treatment === "bounded" && !(contract.editorial_scope || []).length) {
    throw new RouterError(`${label}.editorial_scope is required for bounded editorial treatment`, 2);
  }
  if (contract.editorial_treatment === "forbidden" && (contract.editorial_scope || []).length) {
    throw new RouterError(`${label}.editorial_scope must be empty when editorial treatment is forbidden`, 2);
  }
  if (contract.mode === "editorial" && contract.editorial_treatment !== "required") {
    throw new RouterError(`${label} editorial mode requires editorial_treatment required`, 2);
  }
  if (contract.mode !== "editorial" && contract.editorial_treatment === "required") {
    throw new RouterError(`${label} required editorial treatment requires editorial mode`, 2);
  }

  if (contract.status === "unresolved") {
    if (contract.mode !== "unresolved" || contract.editorial_treatment !== "forbidden" ||
      contract.energy !== "preserve" || contract.depth !== "preserve") {
      throw new RouterError(
        `${label} unresolved contracts must preserve energy/depth and forbid editorial treatment`,
        2
      );
    }
    if (contract.authority_receipt !== undefined || contract.authority_digest !== undefined) {
      throw new RouterError(`${label} unresolved contracts cannot claim authority`, 2);
    }
  } else {
    if (contract.mode === "unresolved" || contract.energy === "preserve" || contract.depth === "preserve") {
      throw new RouterError(`${label} approved contracts require resolved mode, energy, and depth`, 2);
    }
    if (typeof contract.authority_receipt !== "string" || !contract.authority_receipt) {
      throw new RouterError(`${label} approved contracts require authority_receipt`, 2);
    }
    if (!DIGEST_PATTERN.test(contract.authority_digest || "")) {
      throw new RouterError(`${label} approved contracts require a sha256 authority_digest`, 2);
    }
  }
  return contract;
}

export function validateVisualIntents(profile, surfaceContract = validateSurfaceContract(profile)) {
  const declarations = profile?.visual_intents;
  if (declarations === undefined) return null;
  if (!declarations || typeof declarations !== "object" || Array.isArray(declarations)) {
    throw new RouterError("profile visual_intents must be an object keyed by allowed surface", 2);
  }
  for (const [surface, contract] of Object.entries(declarations)) {
    if (!VALID_SURFACES.has(surface) || !surfaceContract.allowed.includes(surface)) {
      throw new RouterError(`profile visual_intents.${surface} is outside surface_contract.allowed`, 2);
    }
    validateVisualIntentContract(contract, `profile visual_intents.${surface}`);
  }
  for (const surface of surfaceContract.allowed) {
    if (!declarations[surface]) {
      throw new RouterError(`profile visual_intents has no contract for ${surface}`, 2);
    }
  }
  return declarations;
}

function requireUniqueObjects(value, label, { allowEmpty = false } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0) ||
    value.some((item) => !item || typeof item !== "object" || Array.isArray(item)) ||
    new Set(value.map((item) => canonicalDigest(item))).size !== value.length) {
    throw new RouterError(
      `${label} must contain ${allowEmpty ? "unique" : "one or more unique"} objects`,
      2
    );
  }
}

function validateColorReferences(value, label, { allowEmpty = false, semantic = false } = {}) {
  requireUniqueObjects(value, label, { allowEmpty });
  const keys = semantic ? SEMANTIC_COLOR_REFERENCE_KEYS : COLOR_REFERENCE_KEYS;
  for (const [index, item] of value.entries()) {
    const itemLabel = `${label}[${index}]`;
    exactObjectKeys(item, keys, itemLabel);
    if (semantic && (typeof item.role !== "string" || !item.role.trim())) {
      throw new RouterError(`${itemLabel}.role must be a non-empty string`, 2);
    }
    for (const key of ["value", "usage"]) {
      if (typeof item[key] !== "string" || !item[key].trim()) {
        throw new RouterError(`${itemLabel}.${key} must be a non-empty string`, 2);
      }
    }
    if (item.token !== undefined && (typeof item.token !== "string" || !item.token.trim())) {
      throw new RouterError(`${itemLabel}.token must be a non-empty string`, 2);
    }
  }
}

export function visualSignatureBody(contract) {
  return {
    palette: {
      primary: (contract.palette?.primary || []).map((item) => ({ ...item })),
      accent: (contract.palette?.accent || []).map((item) => ({ ...item })),
      background: (contract.palette?.background || []).map((item) => ({ ...item })),
      surface: (contract.palette?.surface || []).map((item) => ({ ...item })),
      text: (contract.palette?.text || []).map((item) => ({ ...item })),
      semantic: (contract.palette?.semantic || []).map((item) => ({ ...item }))
    },
    typography: {
      families: (contract.typography?.families || []).map((item) => ({ ...item })),
      scale: contract.typography?.scale,
      weights: [...(contract.typography?.weights || [])],
      treatments: [...(contract.typography?.treatments || [])]
    },
    density: {
      mode: contract.density?.mode,
      characteristics: [...(contract.density?.characteristics || [])]
    },
    shape: {
      radii: [...(contract.shape?.radii || [])],
      geometry: [...(contract.shape?.geometry || [])],
      strokes: [...(contract.shape?.strokes || [])]
    },
    elevation: {
      strategy: contract.elevation?.strategy,
      shadows: [...(contract.elevation?.shadows || [])],
      separation: [...(contract.elevation?.separation || [])]
    },
    imagery: {
      strategy: contract.imagery?.strategy,
      characteristics: [...(contract.imagery?.characteristics || [])]
    },
    motion: {
      intensity: contract.motion?.intensity,
      characteristics: [...(contract.motion?.characteristics || [])]
    },
    style_keywords: [...(contract.style_keywords || [])],
    forbidden_transformations: [...(contract.forbidden_transformations || [])]
  };
}

export function validateVisualSignatureContract(contract, label = "visual signature contract") {
  if (!contract || typeof contract !== "object" || Array.isArray(contract)) {
    throw new RouterError(`${label} must be an object`, 2);
  }
  exactObjectKeys(contract, VISUAL_SIGNATURE_KEYS, label);
  for (const key of REQUIRED_VISUAL_SIGNATURE_KEYS) {
    if (!Object.hasOwn(contract, key)) throw new RouterError(`${label}.${key} is required`, 2);
  }
  if (contract.visual_signature_version !== 1) {
    throw new RouterError(`${label}.visual_signature_version must be 1`, 2);
  }
  if (!["unresolved", "approved"].includes(contract.status)) {
    throw new RouterError(`${label}.status must be unresolved or approved`, 2);
  }
  const approved = contract.status === "approved";

  exactObjectKeys(contract.palette, PALETTE_KEYS, `${label}.palette`);
  for (const key of PALETTE_KEYS) {
    if (!Object.hasOwn(contract.palette, key)) {
      throw new RouterError(`${label}.palette.${key} is required`, 2);
    }
  }
  for (const key of ["primary", "accent", "background", "surface", "text"]) {
    validateColorReferences(contract.palette[key], `${label}.palette.${key}`, {
      allowEmpty: !approved || key === "accent"
    });
  }
  validateColorReferences(contract.palette.semantic, `${label}.palette.semantic`, {
    allowEmpty: true,
    semantic: true
  });

  exactObjectKeys(contract.typography, TYPOGRAPHY_KEYS, `${label}.typography`);
  for (const key of TYPOGRAPHY_KEYS) {
    if (!Object.hasOwn(contract.typography, key)) {
      throw new RouterError(`${label}.typography.${key} is required`, 2);
    }
  }
  requireUniqueObjects(contract.typography.families, `${label}.typography.families`, {
    allowEmpty: !approved
  });
  for (const [index, item] of contract.typography.families.entries()) {
    const itemLabel = `${label}.typography.families[${index}]`;
    exactObjectKeys(item, FONT_REFERENCE_KEYS, itemLabel);
    for (const key of FONT_REFERENCE_KEYS) {
      if (typeof item[key] !== "string" || !item[key].trim()) {
        throw new RouterError(`${itemLabel}.${key} must be a non-empty string`, 2);
      }
    }
  }
  if (typeof contract.typography.scale !== "string" || !contract.typography.scale.trim()) {
    throw new RouterError(`${label}.typography.scale must be a non-empty string`, 2);
  }
  requireUniqueStrings(contract.typography.weights, `${label}.typography.weights`, {
    allowEmpty: !approved
  });
  requireUniqueStrings(contract.typography.treatments, `${label}.typography.treatments`, {
    allowEmpty: !approved
  });

  exactObjectKeys(contract.density, DENSITY_KEYS, `${label}.density`);
  if (!VALID_VISUAL_DENSITY.has(contract.density.mode)) {
    throw new RouterError(`${label}.density.mode is invalid`, 2);
  }
  requireUniqueStrings(contract.density.characteristics, `${label}.density.characteristics`, {
    allowEmpty: !approved
  });

  exactObjectKeys(contract.shape, SHAPE_KEYS, `${label}.shape`);
  for (const key of SHAPE_KEYS) {
    requireUniqueStrings(contract.shape[key], `${label}.shape.${key}`, { allowEmpty: !approved });
  }

  exactObjectKeys(contract.elevation, ELEVATION_KEYS, `${label}.elevation`);
  if (!VALID_ELEVATION_STRATEGIES.has(contract.elevation.strategy)) {
    throw new RouterError(`${label}.elevation.strategy is invalid`, 2);
  }
  requireUniqueStrings(contract.elevation.shadows, `${label}.elevation.shadows`, {
    allowEmpty: !approved
  });
  requireUniqueStrings(contract.elevation.separation, `${label}.elevation.separation`, {
    allowEmpty: !approved
  });

  exactObjectKeys(contract.imagery, IMAGERY_KEYS, `${label}.imagery`);
  if (!VALID_IMAGERY_STRATEGIES.has(contract.imagery.strategy)) {
    throw new RouterError(`${label}.imagery.strategy is invalid`, 2);
  }
  requireUniqueStrings(contract.imagery.characteristics, `${label}.imagery.characteristics`, {
    allowEmpty: !approved
  });

  exactObjectKeys(contract.motion, MOTION_KEYS, `${label}.motion`);
  if (!VALID_MOTION_INTENSITIES.has(contract.motion.intensity)) {
    throw new RouterError(`${label}.motion.intensity is invalid`, 2);
  }
  requireUniqueStrings(contract.motion.characteristics, `${label}.motion.characteristics`, {
    allowEmpty: !approved
  });
  requireUniqueStrings(contract.style_keywords, `${label}.style_keywords`, { allowEmpty: !approved });
  requireUniqueStrings(contract.forbidden_transformations, `${label}.forbidden_transformations`);

  if (!approved) {
    const paletteValues = [...PALETTE_KEYS].flatMap((key) => contract.palette[key]);
    if (paletteValues.length || contract.typography.families.length ||
      contract.typography.scale !== "preserve" || contract.typography.weights.length ||
      contract.typography.treatments.length || contract.density.mode !== "preserve" ||
      contract.density.characteristics.length || [...SHAPE_KEYS].some((key) => contract.shape[key].length) ||
      contract.elevation.strategy !== "preserve" || contract.elevation.shadows.length ||
      contract.elevation.separation.length || contract.imagery.strategy !== "preserve" ||
      contract.imagery.characteristics.length || contract.motion.intensity !== "preserve" ||
      contract.motion.characteristics.length || contract.style_keywords.length) {
      throw new RouterError(
        `${label} unresolved signatures must preserve existing values without guessed style tokens`,
        2
      );
    }
    if (contract.authority_receipt !== undefined || contract.authority_digest !== undefined) {
      throw new RouterError(`${label} unresolved signatures cannot claim authority`, 2);
    }
  } else {
    if (contract.typography.scale === "preserve" || contract.density.mode === "preserve" ||
      contract.elevation.strategy === "preserve" || contract.imagery.strategy === "preserve" ||
      contract.motion.intensity === "preserve") {
      throw new RouterError(`${label} approved signatures require resolved style values`, 2);
    }
    if (typeof contract.authority_receipt !== "string" || !contract.authority_receipt) {
      throw new RouterError(`${label} approved signatures require authority_receipt`, 2);
    }
    if (!DIGEST_PATTERN.test(contract.authority_digest || "")) {
      throw new RouterError(`${label} approved signatures require a sha256 authority_digest`, 2);
    }
  }
  return contract;
}

export function validateVisualSignatures(profile, surfaceContract = validateSurfaceContract(profile)) {
  const declarations = profile?.visual_signatures;
  if (declarations === undefined) return null;
  if (!declarations || typeof declarations !== "object" || Array.isArray(declarations)) {
    throw new RouterError("profile visual_signatures must be an object keyed by allowed surface", 2);
  }
  for (const [surface, contract] of Object.entries(declarations)) {
    if (!VALID_SURFACES.has(surface) || !surfaceContract.allowed.includes(surface)) {
      throw new RouterError(`profile visual_signatures.${surface} is outside surface_contract.allowed`, 2);
    }
    validateVisualSignatureContract(contract, `profile visual_signatures.${surface}`);
  }
  for (const surface of surfaceContract.allowed) {
    if (!declarations[surface]) {
      throw new RouterError(`profile visual_signatures has no contract for ${surface}`, 2);
    }
  }
  return declarations;
}

export function validateProfile(profile) {
  if (!profile) return;
  if (profile.profile_version !== 1) throw new RouterError("profile_version must be 1", 2);
  if (!profile.project_id || typeof profile.project_id !== "string") {
    throw new RouterError("profile project_id is required", 2);
  }
  const surfaceContract = validateSurfaceContract(profile);
  validateVisualIntents(profile, surfaceContract);
  validateVisualSignatures(profile, surfaceContract);
  if (typeof profile.approved_design_system !== "boolean") {
    throw new RouterError("profile approved_design_system must be boolean", 2);
  }
  if (profile.design_system) {
    if (typeof profile.design_system !== "object" || Array.isArray(profile.design_system)) {
      throw new RouterError("profile design_system must be an object", 2);
    }
    if (!profile.design_system.id || !profile.design_system.version) {
      throw new RouterError("profile design_system requires id and version", 2);
    }
    if (!["candidate", "approved", "deprecated"].includes(profile.design_system.status)) {
      throw new RouterError("profile design_system.status must be candidate, approved, or deprecated", 2);
    }
    if (profile.approved_design_system !== (profile.design_system.status === "approved")) {
      throw new RouterError(
        "approved_design_system must agree with design_system.status",
        2
      );
    }
    if (profile.design_system.status === "approved") {
      if (!profile.design_system.authority_receipt) {
        throw new RouterError("approved design_system requires authority_receipt", 2);
      }
      if (!/^sha256:[a-f0-9]{64}$/.test(profile.design_system.authority_digest || "")) {
        throw new RouterError("approved design_system requires a sha256 authority_digest", 2);
      }
    }
  }
  if (profile.planning) {
    if (typeof profile.planning !== "object" || Array.isArray(profile.planning)) {
      throw new RouterError("profile planning must be an object", 2);
    }
    if (typeof profile.planning.required !== "boolean") {
      throw new RouterError("profile planning.required must be boolean", 2);
    }
    if (profile.planning.receipt !== undefined && typeof profile.planning.receipt !== "string") {
      throw new RouterError("profile planning.receipt must be a string", 2);
    }
    if (profile.planning.surface_receipts) {
      if (typeof profile.planning.surface_receipts !== "object" || Array.isArray(profile.planning.surface_receipts)) {
        throw new RouterError("profile planning.surface_receipts must be an object", 2);
      }
      for (const [surface, receiptPath] of Object.entries(profile.planning.surface_receipts)) {
        if (!VALID_SURFACES.has(surface) || typeof receiptPath !== "string" || !receiptPath) {
          throw new RouterError(`profile planning.surface_receipts.${surface} is invalid`, 2);
        }
        if (!surfaceContract.allowed.includes(surface)) {
          throw new RouterError(
            `profile planning.surface_receipts.${surface} is outside surface_contract.allowed`,
            2
          );
        }
      }
    }
  }
  if (!profile.local_adapters || typeof profile.local_adapters !== "object") {
    throw new RouterError("profile local_adapters is required", 2);
  }
  const assertRoutingDeclarationOnly = (declaration, label) => {
    if (!declaration || typeof declaration !== "object" || Array.isArray(declaration)) return;
    for (const field of Object.keys(declaration)) {
      if (FORBIDDEN_PROFILE_EXECUTION_FIELDS.has(field)) {
        throw new RouterError(
          `${label}.${field} is forbidden; executable configuration belongs in an explicit host adapter manifest`,
          2
        );
      }
    }
  };
  for (const [providerId, declaration] of Object.entries(profile.local_adapters || {})) {
    assertRoutingDeclarationOnly(declaration, `local_adapters.${providerId}`);
  }
  for (const [providerId, declaration] of Object.entries(profile.external_adapters || {})) {
    assertRoutingDeclarationOnly(declaration, `external_adapters.${providerId}`);
  }
  if (profile.fallback_adapters && typeof profile.fallback_adapters !== "object") {
    throw new RouterError("profile fallback_adapters must be an object", 2);
  }
  if (profile.evidence) {
    if (typeof profile.evidence !== "object" || Array.isArray(profile.evidence)) {
      throw new RouterError("profile evidence must be an object", 2);
    }
    for (const key of ["required_viewports", "required_checks", "required_scenarios"]) {
      if (profile.evidence[key] && !Array.isArray(profile.evidence[key])) {
        throw new RouterError(`profile evidence.${key} must be an array`, 2);
      }
    }
    if (profile.evidence.required_scenarios) {
      requireUniqueStrings(profile.evidence.required_scenarios, "profile evidence.required_scenarios", {
        allowEmpty: true
      });
      for (const scenario of profile.evidence.required_scenarios) {
        if (!/^[A-Za-z0-9._-]+$/.test(scenario)) {
          throw new RouterError(
            `profile evidence.required_scenarios contains an unsafe scenario id: ${scenario}`,
            2
          );
        }
      }
    }
    for (const key of ["scenario_digest", "browser_contract_digest"]) {
      if (profile.evidence[key] !== undefined &&
        !/^sha256:[a-f0-9]{64}$/.test(profile.evidence[key])) {
        throw new RouterError(`profile evidence.${key} must be a sha256 digest`, 2);
      }
    }
  }
  for (const surface of Object.keys(profile.surface_overrides || {})) {
    if (!surfaceContract.allowed.includes(surface)) {
      throw new RouterError(`profile surface_overrides.${surface} is outside surface_contract.allowed`, 2);
    }
  }
  for (const [missingActor, fallbacks] of Object.entries(profile.fallback_adapters || {})) {
    if (!Array.isArray(fallbacks)) {
      throw new RouterError(`fallback_adapters.${missingActor} must be an array`, 2);
    }
    for (const fallback of fallbacks) {
      assertRoutingDeclarationOnly(fallback, `fallback_adapters.${missingActor}.${fallback.id || "unknown"}`);
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

function bindProfileSource(profile, profilePath) {
  if (!profilePath) return { path: null, digest: null };
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
    throw new RouterError("profile_path must contain a project profile object", 2);
  }
  const absolute = path.resolve(profilePath);
  let sourceProfile;
  try {
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error("profile source must be a regular non-symlink file");
    }
    sourceProfile = JSON.parse(fs.readFileSync(absolute, "utf8"));
  } catch (error) {
    throw new RouterError(`cannot bind routed project profile: ${error.message}`, 4);
  }
  if (canonicalDigest(sourceProfile) !== canonicalDigest(profile)) {
    throw new RouterError("profile object does not match profile_path", 4);
  }
  return { path: absolute, digest: hashArtifact(absolute) };
}

function pathInside(candidate, parent) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function assertNoSymlinkComponents(projectRoot, target, label, exitCode) {
  const relative = path.relative(projectRoot, target);
  if (!pathInside(target, projectRoot)) {
    throw new RouterError(`${label} escapes the project root`, exitCode);
  }
  let current = projectRoot;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (fs.lstatSync(current).isSymbolicLink()) {
      throw new RouterError(`${label} contains a symlink: ${current}`, exitCode);
    }
  }
}

function realProjectRoot(root) {
  const absolute = path.resolve(root || process.cwd());
  if (!fs.existsSync(absolute) || !fs.lstatSync(absolute).isDirectory()) {
    throw new RouterError(`surface contract project root is not a directory: ${absolute}`, 2);
  }
  if (fs.lstatSync(absolute).isSymbolicLink()) {
    throw new RouterError("surface contract project root must not be a symlink", 2);
  }
  return fs.realpathSync(absolute);
}

function resolveBindingRoots(contract, projectRoot) {
  return contract.artifact_bindings.map((binding, index) => {
    const normalizedRoot = normalizedBindingRoot(
      binding.root,
      `profile surface_contract.artifact_bindings[${index}]`
    );
    const absolute = path.resolve(projectRoot, normalizedRoot);
    if (!pathInside(absolute, projectRoot)) {
      throw new RouterError(`surface binding escapes the project root: ${binding.root}`, 2);
    }
    if (!fs.existsSync(absolute)) {
      throw new RouterError(`surface binding root does not exist: ${binding.root}`, 2);
    }
    assertNoSymlinkComponents(projectRoot, absolute, "surface binding path", 2);
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new RouterError(`surface binding root must be a real directory: ${binding.root}`, 2);
    }
    const resolved = fs.realpathSync(absolute);
    if (!pathInside(resolved, projectRoot)) {
      throw new RouterError(`surface binding resolves outside the project root: ${binding.root}`, 2);
    }
    return {
      root: normalizedRoot.split(path.sep).join("/"),
      surface: binding.surface,
      resolved,
      specificity: normalizedRoot === "." ? 0 : normalizedRoot.split(path.sep).length
    };
  });
}

export function inspectSurfaceContract({ profile, root = process.cwd() }) {
  if (!profile) return null;
  const contract = validateSurfaceContract(profile);
  const projectRoot = realProjectRoot(root);
  const bindings = resolveBindingRoots(contract, projectRoot);
  return {
    status: "ready",
    project_root: projectRoot,
    primary_surface: contract.primary,
    allowed_surfaces: [...contract.allowed],
    contract_digest: canonicalDigest(contract),
    artifact_bindings: bindings.map(({ root: bindingRoot, surface }) => ({
      root: bindingRoot,
      surface
    }))
  };
}

export function resolveSurfaceContract({
  profile,
  requestedSurface = null,
  artifacts = [],
  root = process.cwd()
}) {
  if (!profile) {
    if (!VALID_SURFACES.has(requestedSurface)) throw new RouterError("provide a valid surface", 2);
    return {
      status: "unprofiled-explicit",
      requested_surface: requestedSurface,
      resolved_surface: requestedSurface,
      contract_digest: null,
      artifact_bindings: []
    };
  }

  const contract = validateSurfaceContract(profile);
  const projectRoot = realProjectRoot(root);
  const bindings = resolveBindingRoots(contract, projectRoot);
  const artifactList = Array.isArray(artifacts) ? artifacts : [];
  const resolvedArtifacts = [];

  if (artifactList.length === 0) {
    if (contract.allowed.length > 1) {
      throw new RouterError(
        "surface contract allows multiple surfaces; provide --artifact so routing can resolve an exact binding",
        3
      );
    }
  } else {
    for (const artifact of artifactList) {
      const absolute = path.resolve(projectRoot, artifact);
      if (!fs.existsSync(absolute)) throw new RouterError(`surface routing artifact not found: ${absolute}`, 3);
      if (fs.lstatSync(absolute).isSymbolicLink()) {
        throw new RouterError(`surface routing artifact must not be a symlink: ${artifact}`, 3);
      }
      const resolved = fs.realpathSync(absolute);
      if (!pathInside(resolved, projectRoot)) {
        throw new RouterError(`surface routing artifact resolves outside the project root: ${artifact}`, 3);
      }
      // macOS may expose the same temporary path through /var and /private/var.
      // Inspect the lexical path when it is under the canonical root so nested
      // project symlinks still fail, otherwise inspect the canonical equivalent.
      assertNoSymlinkComponents(
        projectRoot,
        pathInside(absolute, projectRoot) ? absolute : resolved,
        "surface routing artifact path",
        3
      );
      const matches = bindings.filter((binding) => pathInside(resolved, binding.resolved));
      if (matches.length === 0) {
        throw new RouterError(`artifact has no surface binding: ${artifact}`, 3);
      }
      const maxSpecificity = Math.max(...matches.map((binding) => binding.specificity));
      const strongest = matches.filter((binding) => binding.specificity === maxSpecificity);
      const surfaces = [...new Set(strongest.map((binding) => binding.surface))];
      if (surfaces.length !== 1) {
        throw new RouterError(`artifact surface binding is ambiguous: ${artifact}`, 3);
      }
      resolvedArtifacts.push({
        path: path.relative(projectRoot, resolved).split(path.sep).join("/") || ".",
        binding_root: strongest[0].root,
        surface: surfaces[0]
      });
    }
  }

  const artifactSurfaces = [...new Set(resolvedArtifacts.map((artifact) => artifact.surface))];
  if (artifactSurfaces.length > 1) {
    throw new RouterError(
      `artifacts resolve to multiple surfaces (${artifactSurfaces.join(", ")}); split them into separate runs`,
      3
    );
  }
  const resolvedSurface = artifactSurfaces[0] || contract.primary;
  if (!contract.allowed.includes(resolvedSurface)) {
    throw new RouterError(`resolved surface is outside surface_contract.allowed: ${resolvedSurface}`, 3);
  }
  if (requestedSurface && requestedSurface !== resolvedSurface) {
    throw new RouterError(
      `surface mismatch: contract resolved ${resolvedSurface}, CLI requested ${requestedSurface}`,
      3
    );
  }
  return {
    status: "locked",
    requested_surface: requestedSurface || null,
    resolved_surface: resolvedSurface,
    primary_surface: contract.primary,
    allowed_surfaces: [...contract.allowed],
    contract_digest: canonicalDigest(contract),
    artifact_bindings: resolvedArtifacts
  };
}

export function normalizeInput(input) {
  const normalized = {
    surface: input.surface,
    task: input.task,
    direction: input.direction || "none",
    changes: [...new Set(input.changes || [])],
    risk: input.risk || "standard",
    scope: input.scope || null
  };
  if (!VALID_SURFACES.has(normalized.surface)) throw new RouterError("provide a valid surface", 2);
  if (!VALID_TASKS.has(normalized.task)) throw new RouterError("provide a valid task", 2);
  if (!VALID_DIRECTIONS.has(normalized.direction)) throw new RouterError("provide a valid direction", 2);
  if (!VALID_RISKS.has(normalized.risk)) throw new RouterError("risk must be standard or high", 2);
  if (normalized.scope && !VALID_SCOPES.has(normalized.scope)) {
    throw new RouterError("scope must be mockup, runtime, source, or document", 2);
  }
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

function hasProfileFlag(profile, flag) {
  if (flag === "approved_design_system" && profile?.design_system) {
    return profile.design_system.status === "approved";
  }
  return Boolean(profile?.[flag]);
}

function hasProfileAdapter(profile, adapterId) {
  const declaration = profile?.local_adapters?.[adapterId] || profile?.external_adapters?.[adapterId];
  if (!declaration) return false;
  if (typeof declaration === "string") return true;
  return AVAILABLE_STATUSES.has(declaration.status);
}

export function resolveDesignSystem(profile, profilePath) {
  if (!profile?.design_system) {
    return profile?.approved_design_system
      ? { id: null, version: null, status: "approved", authority_status: "legacy-unverified", legacy: true }
      : null;
  }
  const contract = { ...profile.design_system };
  if (contract.status !== "approved") return { ...contract, authority_status: "not-approved" };
  const base = profilePath ? path.dirname(path.resolve(profilePath)) : process.cwd();
  const authorityPath = path.isAbsolute(contract.authority_receipt)
    ? contract.authority_receipt
    : path.resolve(base, contract.authority_receipt);
  if (!fs.existsSync(authorityPath)) {
    return { ...contract, authority_status: "missing", authority_path: authorityPath };
  }
  try {
    const actual = hashArtifact(authorityPath);
    return {
      ...contract,
      authority_status: actual === contract.authority_digest ? "verified" : "digest-mismatch",
      authority_path: authorityPath,
      authority_actual_digest: actual
    };
  } catch (error) {
    return { ...contract, authority_status: "unreadable", authority_path: authorityPath };
  }
}

export function visualIntentRequired(input) {
  return VISUAL_INTENT_TASKS.has(input?.task);
}

function exactObjectKeys(value, allowed, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RouterError(`${label} must be an object`, 2);
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new RouterError(`${label} contains unsupported field: ${key}`, 2);
  }
}

function verifiedAuthoritySource(filePath, expectedDigest, kind, label) {
  if (!fs.existsSync(filePath)) throw new Error(`${label} is missing: ${filePath}`);
  const stat = fs.lstatSync(filePath);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`${label} must be a regular non-symlink file: ${filePath}`);
  }
  const digest = hashArtifact(filePath);
  if (digest !== expectedDigest) throw new Error(`${label} digest changed: ${filePath}`);
  return { kind, path: filePath, digest };
}

function visualIntentResolutionBase(contract, surface) {
  if (!contract) {
    return {
      visual_intent_version: 1,
      surface,
      status: "missing",
      contract_digest: null,
      authority_status: "missing",
      issues: [`visual intent contract is missing for ${surface}`],
      sources: []
    };
  }
  const body = visualIntentBody(contract);
  return {
    visual_intent_version: contract.visual_intent_version,
    surface,
    status: contract.status,
    ...body,
    contract_digest: canonicalDigest({
      visual_intent_version: contract.visual_intent_version,
      surface,
      status: contract.status,
      ...body
    }),
    authority_status: contract.status === "approved" ? "not-verified" : "unresolved",
    issues: contract.status === "approved"
      ? []
      : [`visual intent contract is unresolved for ${surface}`],
    sources: []
  };
}

export function resolveVisualIntent(profile, profilePath, surface) {
  if (!profile) return visualIntentResolutionBase(null, surface);
  const contract = profile.visual_intents?.[surface] || null;
  const base = visualIntentResolutionBase(contract, surface);
  if (!contract || contract.status !== "approved") return base;

  try {
    const profileBase = profilePath ? path.dirname(path.resolve(profilePath)) : process.cwd();
    const receiptPath = path.isAbsolute(contract.authority_receipt)
      ? contract.authority_receipt
      : path.resolve(profileBase, contract.authority_receipt);
    const receiptSource = verifiedAuthoritySource(
      receiptPath,
      contract.authority_digest,
      "authority-receipt",
      "visual intent authority receipt"
    );
    const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
    exactObjectKeys(receipt, VISUAL_INTENT_RECEIPT_KEYS, "visual intent authority receipt");
    if (receipt.visual_intent_receipt_version !== 1) {
      throw new Error("visual intent authority receipt version must be 1");
    }
    if (receipt.project_id !== profile.project_id) {
      throw new Error(`visual intent project mismatch: expected ${profile.project_id}`);
    }
    if (receipt.surface !== surface) {
      throw new Error(`visual intent surface mismatch: expected ${surface}`);
    }
    if (receipt.status !== "approved") {
      throw new Error("visual intent authority receipt is not approved");
    }
    const bodyKeys = new Set(Object.keys(visualIntentBody(contract)));
    exactObjectKeys(receipt.intent, bodyKeys, "visual intent authority receipt.intent");
    if (Object.keys(receipt.intent).length !== bodyKeys.size ||
      canonicalDigest(receipt.intent) !== canonicalDigest(visualIntentBody(contract))) {
      throw new Error("visual intent authority receipt does not match the profile contract");
    }
    exactObjectKeys(receipt.authority, VISUAL_INTENT_AUTHORITY_KEYS, "visual intent authority receipt.authority");
    if (!VISUAL_INTENT_AUTHORITY_KINDS.has(receipt.authority.kind) ||
      !receipt.authority.authority_id || !receipt.authority.basis ||
      !receipt.authority.decided_at || Number.isNaN(Date.parse(receipt.authority.decided_at))) {
      throw new Error("visual intent authority requires kind, authority_id, basis, and decided_at");
    }
    if (!Array.isArray(receipt.evidence) || receipt.evidence.length === 0) {
      throw new Error("visual intent authority receipt requires evidence");
    }
    const sources = [receiptSource];
    const evidence = [];
    const seenEvidence = new Set();
    for (const [index, item] of receipt.evidence.entries()) {
      const label = `visual intent authority receipt.evidence[${index}]`;
      exactObjectKeys(item, VISUAL_INTENT_EVIDENCE_KEYS, label);
      if (!VISUAL_INTENT_EVIDENCE_KINDS.has(item.kind) ||
        typeof item.path !== "string" || !item.path || !DIGEST_PATTERN.test(item.digest || "")) {
        throw new Error(`${label} requires kind, path, and a sha256 digest`);
      }
      const evidencePath = path.isAbsolute(item.path)
        ? item.path
        : path.resolve(path.dirname(receiptPath), item.path);
      if (seenEvidence.has(evidencePath)) throw new Error(`${label} duplicates an evidence path`);
      seenEvidence.add(evidencePath);
      const source = verifiedAuthoritySource(
        evidencePath,
        item.digest,
        `authority-evidence:${item.kind}`,
        `${label} (${item.kind})`
      );
      sources.push(source);
      evidence.push({ kind: item.kind, path: evidencePath, digest: source.digest });
      if (item.kind === "owner-approval") {
        const approval = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
        const ownerId = approval.owner_id || approval.owner_approval?.owner_id;
        if (approval.status !== "approved" || !ownerId) {
          throw new Error(`${label} is not an explicit approved owner decision`);
        }
      }
    }
    const evidenceKinds = new Set(evidence.map((item) => item.kind));
    const authorityEvidence = {
      "project-contract": ["project-contract"],
      "brand-system": ["brand-system"],
      "owner-direction": ["owner-direction", "owner-approval"],
      "approved-reference": ["approved-reference", "approved-artifact"]
    }[receipt.authority.kind];
    if (!authorityEvidence.some((kind) => evidenceKinds.has(kind))) {
      throw new Error(
        `visual intent authority ${receipt.authority.kind} lacks matching evidence`
      );
    }
    return {
      ...base,
      authority_status: "verified",
      issues: [],
      authority: {
        ...receipt.authority,
        receipt_path: receiptPath,
        receipt_digest: receiptSource.digest,
        evidence
      },
      sources
    };
  } catch (error) {
    return {
      ...base,
      authority_status: "invalid",
      issues: [error.message],
      sources: []
    };
  }
}

export function inspectVisualIntents({ profile, profilePath = null }) {
  if (!profile) return [];
  const surfaces = profile.surface_contract?.allowed || [];
  return surfaces.map((surface) => resolveVisualIntent(profile, profilePath, surface));
}

function visualSignatureResolutionBase(contract, surface) {
  if (!contract) {
    return {
      visual_signature_version: 1,
      surface,
      status: "missing",
      contract_digest: null,
      authority_status: "missing",
      issues: [`visual signature contract is missing for ${surface}`],
      sources: []
    };
  }
  const body = visualSignatureBody(contract);
  return {
    visual_signature_version: contract.visual_signature_version,
    surface,
    status: contract.status,
    ...body,
    contract_digest: canonicalDigest({
      visual_signature_version: contract.visual_signature_version,
      surface,
      status: contract.status,
      ...body
    }),
    authority_status: contract.status === "approved" ? "not-verified" : "unresolved",
    issues: contract.status === "approved"
      ? []
      : [`visual signature contract is unresolved for ${surface}`],
    sources: []
  };
}

export function resolveVisualSignature(profile, profilePath, surface) {
  if (!profile) return visualSignatureResolutionBase(null, surface);
  const contract = profile.visual_signatures?.[surface] || null;
  const base = visualSignatureResolutionBase(contract, surface);
  if (!contract || contract.status !== "approved") return base;

  try {
    const profileBase = profilePath ? path.dirname(path.resolve(profilePath)) : process.cwd();
    const receiptPath = path.isAbsolute(contract.authority_receipt)
      ? contract.authority_receipt
      : path.resolve(profileBase, contract.authority_receipt);
    const receiptSource = verifiedAuthoritySource(
      receiptPath,
      contract.authority_digest,
      "signature-authority-receipt",
      "visual signature authority receipt"
    );
    const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
    exactObjectKeys(receipt, VISUAL_SIGNATURE_RECEIPT_KEYS, "visual signature authority receipt");
    if (receipt.visual_signature_receipt_version !== 1) {
      throw new Error("visual signature authority receipt version must be 1");
    }
    if (receipt.project_id !== profile.project_id) {
      throw new Error(`visual signature project mismatch: expected ${profile.project_id}`);
    }
    if (receipt.surface !== surface) {
      throw new Error(`visual signature surface mismatch: expected ${surface}`);
    }
    if (receipt.status !== "approved") {
      throw new Error("visual signature authority receipt is not approved");
    }
    const bodyKeys = new Set(Object.keys(visualSignatureBody(contract)));
    exactObjectKeys(receipt.signature, bodyKeys, "visual signature authority receipt.signature");
    if (Object.keys(receipt.signature).length !== bodyKeys.size ||
      canonicalDigest(receipt.signature) !== canonicalDigest(visualSignatureBody(contract))) {
      throw new Error("visual signature authority receipt does not match the profile contract");
    }
    exactObjectKeys(receipt.authority, VISUAL_INTENT_AUTHORITY_KEYS, "visual signature authority receipt.authority");
    if (!VISUAL_SIGNATURE_AUTHORITY_KINDS.has(receipt.authority.kind) ||
      !receipt.authority.authority_id || !receipt.authority.basis ||
      !receipt.authority.decided_at || Number.isNaN(Date.parse(receipt.authority.decided_at))) {
      throw new Error("visual signature authority requires kind, authority_id, basis, and decided_at");
    }
    if (!Array.isArray(receipt.evidence) || receipt.evidence.length === 0) {
      throw new Error("visual signature authority receipt requires evidence");
    }
    const sources = [receiptSource];
    const evidence = [];
    const evidenceByReceiptPath = new Map();
    const seenEvidence = new Set();
    for (const [index, item] of receipt.evidence.entries()) {
      const label = `visual signature authority receipt.evidence[${index}]`;
      exactObjectKeys(item, VISUAL_INTENT_EVIDENCE_KEYS, label);
      if (!VISUAL_SIGNATURE_EVIDENCE_KINDS.has(item.kind) ||
        typeof item.path !== "string" || !item.path || !DIGEST_PATTERN.test(item.digest || "")) {
        throw new Error(`${label} requires kind, path, and a sha256 digest`);
      }
      if (evidenceByReceiptPath.has(item.path)) throw new Error(`${label} duplicates an evidence path`);
      const evidencePath = path.isAbsolute(item.path)
        ? item.path
        : path.resolve(path.dirname(receiptPath), item.path);
      if (seenEvidence.has(evidencePath)) throw new Error(`${label} resolves to duplicate evidence`);
      seenEvidence.add(evidencePath);
      const source = verifiedAuthoritySource(
        evidencePath,
        item.digest,
        `signature-authority-evidence:${item.kind}`,
        `${label} (${item.kind})`
      );
      sources.push(source);
      const resolved = { kind: item.kind, path: evidencePath, digest: source.digest };
      evidence.push(resolved);
      evidenceByReceiptPath.set(item.path, resolved);
      if (item.kind === "owner-approval") {
        const approval = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
        const ownerId = approval.owner_id || approval.owner_approval?.owner_id;
        if (approval.status !== "approved" || !ownerId) {
          throw new Error(`${label} is not an explicit approved owner decision`);
        }
      }
    }
    const evidenceKinds = new Set(evidence.map((item) => item.kind));
    const authorityEvidence = {
      "project-contract": ["project-contract"],
      "brand-system": ["brand-system"],
      "design-system": ["design-system", "design-tokens"],
      "owner-direction": ["owner-direction", "owner-approval"],
      "approved-reference": ["approved-reference", "approved-artifact"]
    }[receipt.authority.kind];
    if (!authorityEvidence.some((kind) => evidenceKinds.has(kind))) {
      throw new Error(
        `visual signature authority ${receipt.authority.kind} lacks matching evidence`
      );
    }
    if (!Array.isArray(receipt.coverage)) {
      throw new Error("visual signature authority receipt requires aspect coverage");
    }
    const seenAspects = new Set();
    const usedEvidencePaths = new Set();
    const coverage = receipt.coverage.map((item, index) => {
      const label = `visual signature authority receipt.coverage[${index}]`;
      exactObjectKeys(item, SIGNATURE_COVERAGE_KEYS, label);
      if (!VISUAL_SIGNATURE_ASPECTS.has(item.aspect) || seenAspects.has(item.aspect)) {
        throw new Error(`${label}.aspect must be a unique visual signature aspect`);
      }
      seenAspects.add(item.aspect);
      requireUniqueStrings(item.evidence_paths, `${label}.evidence_paths`);
      const coveredEvidence = item.evidence_paths.map((evidencePath) => {
        const match = evidenceByReceiptPath.get(evidencePath);
        if (!match) throw new Error(`${label} references unknown evidence path: ${evidencePath}`);
        usedEvidencePaths.add(evidencePath);
        return { kind: match.kind, digest: match.digest };
      });
      return { aspect: item.aspect, evidence: coveredEvidence };
    });
    const missingAspects = [...VISUAL_SIGNATURE_ASPECTS]
      .filter((aspect) => !seenAspects.has(aspect));
    if (missingAspects.length) {
      throw new Error(`visual signature evidence coverage is missing: ${missingAspects.join(", ")}`);
    }
    const unusedEvidence = [...evidenceByReceiptPath.keys()]
      .filter((evidencePath) => !usedEvidencePaths.has(evidencePath));
    if (unusedEvidence.length) {
      throw new Error(`visual signature evidence is not assigned to an aspect: ${unusedEvidence.join(", ")}`);
    }
    return {
      ...base,
      authority_status: "verified",
      issues: [],
      authority: {
        ...receipt.authority,
        receipt_path: receiptPath,
        receipt_digest: receiptSource.digest,
        evidence,
        coverage
      },
      sources
    };
  } catch (error) {
    return {
      ...base,
      authority_status: "invalid",
      issues: [error.message],
      sources: []
    };
  }
}

export function inspectVisualSignatures({ profile, profilePath = null }) {
  if (!profile) return [];
  const surfaces = profile.surface_contract?.allowed || [];
  return surfaces.map((surface) => resolveVisualSignature(profile, profilePath, surface));
}

function visualContractCompatibilityIssues(intent, signature) {
  if (intent?.status !== "approved" || intent.authority_status !== "verified" ||
    signature?.status !== "approved" || signature.authority_status !== "verified") return [];
  const issues = [];
  if (intent.editorial_treatment === "forbidden" && signature.imagery.strategy === "editorial") {
    issues.push("visual signature requests editorial imagery while visual intent forbids editorial treatment");
  }
  const allowedElevation = {
    flat: new Set(["flat", "border-led"]),
    layered: new Set(["layered", "mixed"]),
    immersive: new Set(["immersive", "mixed"])
  }[intent.depth];
  if (allowedElevation && !allowedElevation.has(signature.elevation.strategy)) {
    issues.push(
      `visual signature elevation ${signature.elevation.strategy} conflicts with visual intent depth ${intent.depth}`
    );
  }
  return issues;
}

function resolveCreator(route, input, profile, override, unresolved) {
  const policy = route.creator_policy;
  if (policy.type === "none") return null;
  if (policy.allow_surface_override !== false) {
    if (override.creator) return override.creator;
    if (override.creator_by_direction?.[input.direction]) {
      return override.creator_by_direction[input.direction];
    }
  }
  if (policy.type === "fixed") {
    if (policy.requires_profile_flag && !hasProfileFlag(profile, policy.requires_profile_flag)) {
      unresolved.push(policy.requires_profile_flag === "approved_design_system"
        ? "creator requires an approved project design system or an explicit project surface creator; `killsloprouter design run` resolves direction but does not confer design-system authority"
        : `creator requires project profile flag: ${policy.requires_profile_flag}`);
      return null;
    }
    if (policy.requires_profile_adapter && !hasProfileAdapter(profile, policy.requires_profile_adapter)) {
      unresolved.push(`creator requires routable project adapter: ${policy.requires_profile_adapter}`);
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
    if (selected.requires_profile_flag && !hasProfileFlag(profile, selected.requires_profile_flag)) {
      unresolved.push(selected.requires_profile_flag === "approved_design_system"
        ? "creator requires an approved project design system or an explicit project surface creator; `killsloprouter design run` resolves direction but does not confer design-system authority"
        : `creator requires project profile flag: ${selected.requires_profile_flag}`);
      return null;
    }
    if (selected.requires_profile_adapter && !hasProfileAdapter(profile, selected.requires_profile_adapter)) {
      unresolved.push(`creator requires routable project adapter: ${selected.requires_profile_adapter}`);
      return null;
    }
    if (selected.requires_design_exploration) {
      unresolved.push(
        "visual direction is missing; complete `killsloprouter design run` and bind its approved receipts"
      );
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
    if (stage.when_visual_intent && !visualIntentRequired(input)) continue;
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

export function planRoute({
  router,
  profile = null,
  input,
  routerPath = null,
  profilePath = null,
  artifacts = [],
  root = process.cwd()
}) {
  validateProfile(profile);
  const profileSource = bindProfileSource(profile, profilePath);
  const surfaceResolution = resolveSurfaceContract({
    profile,
    requestedSurface: input.surface || null,
    artifacts,
    root
  });
  const normalized = normalizeInput({ ...input, surface: surfaceResolution.resolved_surface });
  const route = selectRoute(router, normalized);
  if (!route) throw new RouterError(`no route matches ${normalized.surface}/${normalized.task}`, 3);

  const override = profile?.surface_overrides?.[normalized.surface] || {};
  const unresolved = [];
  const visualIntent = resolveVisualIntent(profile, profileSource.path, normalized.surface);
  const visualSignature = resolveVisualSignature(profile, profileSource.path, normalized.surface);
  if (visualIntentRequired(normalized) &&
    (visualIntent.status !== "approved" || visualIntent.authority_status !== "verified")) {
    unresolved.push(...visualIntent.issues);
  }
  if (visualIntentRequired(normalized) &&
    (visualSignature.status !== "approved" || visualSignature.authority_status !== "verified")) {
    unresolved.push(...visualSignature.issues);
  }
  if (visualIntentRequired(normalized)) {
    unresolved.push(...visualContractCompatibilityIssues(visualIntent, visualSignature));
  }
  const creator = resolveCreator(route, normalized, profile, override, unresolved);
  const stages = resolveStages(route, creator, profile, override, normalized, router);
  const required = requiredStages(router, normalized, profile);
  if (normalized.scope && required.includes("browser-evidence") &&
    !(profile?.evidence?.required_scenarios || []).length) {
    unresolved.push(
      "browser-evidence requires a non-empty profile evidence.required_scenarios inventory for this scoped UI run"
    );
  }
  const represented = new Set(stages.flatMap((stage) => [stage.id, ...stage.actors.map((actor) => actor.id)]));
  const missingRequired = required
    .filter((id) => !represented.has(id))
    .map((id) => `required stage or gate is not represented in selected route: ${id}`);
  unresolved.push(...missingRequired);
  const warnings = [];
  const designSystem = resolveDesignSystem(profile, profileSource.path);

  if (profile?.approved_design_system && !profile.design_system) {
    warnings.push(
      "approved_design_system uses the legacy unversioned boolean; add design_system id, version, status, and authority_receipt"
    );
  }
  if (creator === "project-design-system" && designSystem?.authority_status !== "verified") {
    if (designSystem?.legacy) {
      warnings.push("project-design-system authority is not hash-verified under the legacy profile contract");
    } else {
      unresolved.push(
        `project-design-system authority is ${designSystem?.authority_status || "missing"}`
      );
    }
  }

  const planningGate = resolvePlanningGate({
    profile,
    profilePath: profileSource.path,
    input: normalized
  });
  unresolved.push(...planningGate.unresolved);
  warnings.push(...planningGate.warnings);

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
    execution_status: "not_started",
    completion_eligible: false,
    next_required_command: "killsloprouter run --dry-run",
    router_id: router.router_id,
    router_version: router.router_version,
    router_path: routerPath,
    profile_path: profileSource.path,
    profile_digest: profileSource.digest,
    project_id: profile?.project_id || null,
    status: unresolved.length ? "blocked" : "planned",
    route_id: route.id,
    input: normalized,
    surface_resolution: surfaceResolution,
    visual_intent: visualIntent,
    visual_signature: visualSignature,
    creator,
    stages,
    required_stage_ids: required,
    unresolved: [...new Set(unresolved)],
    warnings,
    planning_gate: planningGate,
    design_system: designSystem,
    evidence_contract: profile?.evidence || null,
    adjudication: router.adjudication,
    invariants: router.invariants
  };
}

export function formatReceipt(receipt) {
  const lines = [
    `KillSlopRouter ${receipt.router_version}`,
    `status: ${receipt.status}`,
    `execution: ${receipt.execution_status || "not_started"} (completion eligible: ${Boolean(receipt.completion_eligible)})`,
    `route: ${receipt.route_id}`,
    `project: ${receipt.project_id || "unprofiled"}`,
    `creator: ${receipt.creator || "none"}`,
    `surface/task: ${receipt.input.surface} / ${receipt.input.task}`,
    `surface contract: ${receipt.surface_resolution?.status || "unbound"} (${receipt.surface_resolution?.contract_digest || "none"})`,
    `visual intent: ${receipt.visual_intent?.status || "missing"} (${receipt.visual_intent?.authority_status || "missing"}; ${receipt.visual_intent?.mode || "unresolved"})`,
    `visual signature: ${receipt.visual_signature?.status || "missing"} ` +
      `(${receipt.visual_signature?.authority_status || "missing"}; ` +
      `primary ${receipt.visual_signature?.palette?.primary?.[0]?.value || "unresolved"}; ` +
      `type ${receipt.visual_signature?.typography?.families?.[0]?.family || "unresolved"}; ` +
      `density ${receipt.visual_signature?.density?.mode || "unresolved"}; ` +
      `elevation ${receipt.visual_signature?.elevation?.strategy || "unresolved"})`,
    `direction/risk: ${receipt.input.direction} / ${receipt.input.risk}`,
    `scope: ${receipt.input.scope || "deferred"}`,
    `next: ${receipt.next_required_command || "killsloprouter run --dry-run"}`,
    `planning gate: ${receipt.planning_gate?.status || "not-configured"}`,
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
