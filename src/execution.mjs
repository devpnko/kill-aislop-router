import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runKillAiSlop, findKillAiSlopScanner } from "./adapters/kill-ai-slop.mjs";
import {
  canonicalDigest,
  hashArtifact,
  publicSnapshot,
  readFilePinned,
  readJsonPinned,
  snapshotArtifact,
  verifySnapshot
} from "./integrity.mjs";
import { RouterError } from "./router.mjs";
import {
  ensureSecureDirectory,
  secureExistingDirectory
} from "./path-security.mjs";
import {
  PLAYWRIGHT_ADAPTER_CONTRACT,
  PLAYWRIGHT_PROVIDER_TARGET,
  PLAYWRIGHT_SUPPORTED_CHECKS,
  createPlaywrightChildAuthority,
  createPlaywrightRuntimeSeal,
  validateOfficialPlaywrightSettings,
  verifyPlaywrightChildAuthoritySources
} from "./playwright.mjs";
import {
  CODEX_REVIEW_ADAPTER_CONTRACT,
  validateOfficialCodexSettings,
  verifyOfficialCodexRuntimeSources
} from "./codex.mjs";
import {
  identitiesMatch,
  verifyJourneyIdentity,
  verifyPacketJourney
} from "./identity.mjs";
import {
  baselineLineagesMatch,
  planningAuthoritiesMatch,
  verifyBaselineLineage,
  verifyPlanningGateForAudit
} from "./planning.mjs";
import { verifyAuditJourneyIdentity } from "./audit.mjs";
import {
  createSealedEntrypointAuthority,
  spawnSealedNodeEntrypoint,
  verifySealedEntrypointAuthority
} from "./sealed-entrypoint.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const HOST_ADAPTER_TYPES = new Set([
  "kill-ai-slop-v1",
  "agent-json-v1",
  "skill-json-v1",
  "browser-json-v1",
  "manual-v1"
]);

export const HOST_PERMISSION_SCOPES = new Set([
  "artifact:read",
  "evidence:write",
  "browser:control",
  "reference-evidence:read",
  "network:external"
]);

const PROCESS_ADAPTERS = new Set(["agent-json-v1", "skill-json-v1", "browser-json-v1"]);
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;

function readPinnedExecutionJson(target, label, faultInjector = null) {
  try {
    return readJsonPinned(target, { label, faultInjector });
  } catch (error) {
    throw new RouterError(error.message, 4);
  }
}
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 900_000;
const HOST_KEYS = new Set([
  "host_adapter_version",
  "allowed_providers",
  "granted_permissions",
  "providers"
]);
const PROVIDER_KEYS = new Set([
  "adapter",
  "entrypoint",
  "entrypoint_digest",
  "entrypoint_graph_digest",
  "adapter_root",
  "capabilities",
  "strength",
  "permissions",
  "timeout_ms",
  "settings"
]);

function requireValue(condition, message, exitCode = 2) {
  if (!condition) throw new RouterError(message, exitCode);
}

function verifyRunArtifacts(run, phase) {
  requireValue(Array.isArray(run?.artifacts),
    `host run artifacts must be an array at ${phase}`, 4);
  for (const [index, artifact] of run.artifacts.entries()) {
    requireValue(artifact && typeof artifact === "object" &&
      typeof artifact.resolved_path === "string" &&
      DIGEST_PATTERN.test(artifact.digest || "") &&
      DIGEST_PATTERN.test(artifact.physical_identity_digest || ""),
    `host run artifact ${index + 1} is not a digest-bound physical snapshot at ${phase}`, 4);
    const verified = verifySnapshot(artifact);
    requireValue(verified.ok,
      `host run artifact ${index + 1} changed ${phase} (${verified.reason})`, 4);
  }
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function inside(candidate, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function physicalDirectoryIdentity(directory) {
  const absolute = path.resolve(directory);
  let realPath;
  try {
    realPath = secureExistingDirectory(absolute, "granted output directory");
  } catch (error) {
    throw new RouterError(error.message, 4);
  }
  const physicalStat = fs.statSync(realPath, { bigint: true });
  return {
    lexical_path: absolute,
    real_path: realPath,
    device: String(physicalStat.dev),
    inode: String(physicalStat.ino)
  };
}

function samePhysicalDirectory(left, right) {
  return left.lexical_path === right.lexical_path &&
    left.real_path === right.real_path &&
    left.device === right.device &&
    left.inode === right.inode;
}

function verifyPhysicalPathComponents(grantRoot, target, { allowMissing = false } = {}) {
  const absoluteGrant = path.resolve(grantRoot);
  const absoluteTarget = path.resolve(target);
  requireValue(inside(absoluteTarget, absoluteGrant),
    `output path escapes its granted root: ${absoluteTarget}`, 4);
  const relative = path.relative(absoluteGrant, absoluteTarget);
  let cursor = absoluteGrant;
  for (const component of relative ? relative.split(path.sep) : []) {
    cursor = path.join(cursor, component);
    if (!fs.existsSync(cursor)) {
      requireValue(allowMissing, `granted output path is missing: ${cursor}`, 4);
      break;
    }
    const stat = fs.lstatSync(cursor);
    requireValue(!stat.isSymbolicLink(),
      `granted output path contains a symlink component: ${cursor}`, 4);
  }
}

function defaultOutputGrantRoot(outputDirectory) {
  let cursor = path.dirname(path.resolve(outputDirectory));
  while (!fs.existsSync(cursor)) {
    const parent = path.dirname(cursor);
    requireValue(parent !== cursor,
      `adapter output directory has no existing filesystem anchor: ${outputDirectory}`, 4);
    cursor = parent;
  }
  return cursor;
}

function createOutputBoundary(outputDirectory, outputGrantRoot) {
  const grantRoot = outputGrantRoot
    ? path.resolve(outputGrantRoot)
    : defaultOutputGrantRoot(outputDirectory);
  const grantBoundary = physicalDirectoryIdentity(grantRoot);
  verifyPhysicalPathComponents(grantBoundary.lexical_path, outputDirectory, { allowMissing: true });
  try {
    ensureSecureDirectory(outputDirectory, "adapter output directory", {
      boundary: grantBoundary.real_path
    });
  } catch (error) {
    throw new RouterError(error.message, 4);
  }
  verifyPhysicalPathComponents(grantBoundary.lexical_path, outputDirectory);
  const outputBoundary = physicalDirectoryIdentity(outputDirectory);
  requireValue(inside(outputBoundary.real_path, grantBoundary.real_path),
    `granted output directory escapes its physical grant root: ${outputDirectory}`, 4);
  return { ...outputBoundary, grant: grantBoundary };
}

function verifyPreparedOutputBoundary(outputBoundary, outputDirectory, outputGrantRoot) {
  requireValue(outputBoundary?.lexical_path && outputBoundary?.grant,
    "prepared execution output boundary is missing", 4);
  requireValue(
    path.resolve(outputBoundary.lexical_path) === path.resolve(outputDirectory),
    "prepared execution output boundary targets a different directory",
    4
  );
  if (outputGrantRoot) {
    requireValue(
      path.resolve(outputBoundary.grant.lexical_path) === path.resolve(outputGrantRoot),
      "prepared execution output boundary targets a different grant root",
      4
    );
  } else {
    requireValue(
      inside(path.dirname(path.resolve(outputDirectory)), outputBoundary.grant.lexical_path),
      "prepared execution output boundary does not retain an ancestor grant root",
      4
    );
  }
  verifyPhysicalEvidencePath(outputBoundary.lexical_path, outputBoundary);
  return outputBoundary;
}

export function prepareExecutionOutputBoundary(outputDirectory, outputGrantRoot = null) {
  return createOutputBoundary(outputDirectory, outputGrantRoot);
}

function verifyPhysicalEvidenceTree(target) {
  const stat = fs.lstatSync(target);
  requireValue(!stat.isSymbolicLink(),
    `returned evidence contains a symlink component: ${target}`, 4);
  if (stat.isFile()) {
    requireValue(stat.nlink === 1,
      `returned evidence must not be a hard-linked file: ${target}`, 4);
    return;
  }
  requireValue(stat.isDirectory(),
    `returned evidence must be a regular file or directory: ${target}`, 4);
  for (const entry of fs.readdirSync(target)) {
    verifyPhysicalEvidenceTree(path.join(target, entry));
  }
}

function verifyPhysicalEvidencePath(resolved, outputBoundary) {
  const currentGrant = physicalDirectoryIdentity(outputBoundary.grant.lexical_path);
  requireValue(samePhysicalDirectory(currentGrant, outputBoundary.grant),
    "granted output root changed across the child process boundary", 4);
  verifyPhysicalPathComponents(outputBoundary.grant.lexical_path, outputBoundary.lexical_path);
  const currentBoundary = physicalDirectoryIdentity(outputBoundary.lexical_path);
  requireValue(samePhysicalDirectory(currentBoundary, outputBoundary),
    "granted output directory changed across the child process boundary",
    4
  );
  const relative = path.relative(outputBoundary.lexical_path, resolved);
  const components = relative === "" ? [] : relative.split(path.sep);
  let cursor = outputBoundary.lexical_path;
  for (const component of components) {
    cursor = path.join(cursor, component);
    requireValue(fs.existsSync(cursor), `returned evidence is missing: ${cursor}`, 4);
    const stat = fs.lstatSync(cursor);
    requireValue(!stat.isSymbolicLink(),
      `returned evidence contains a symlink component: ${cursor}`, 4);
  }
  const realTarget = fs.realpathSync.native(resolved);
  requireValue(inside(realTarget, outputBoundary.real_path),
    `returned evidence escapes the physical output directory: ${resolved}`, 4);
  verifyPhysicalEvidenceTree(resolved);
}

function physicalEvidenceIdentity(target) {
  const entries = [];
  function walk(current, relative = ".") {
    const stat = fs.lstatSync(current, { bigint: true });
    entries.push({
      path: relative,
      type: stat.isDirectory() ? "directory" : stat.isFile() ? "file" : "other",
      device: String(stat.dev),
      inode: String(stat.ino),
      links: String(stat.nlink),
      size: String(stat.size),
      mtime_ns: String(stat.mtimeNs)
    });
    if (!stat.isDirectory()) return;
    for (const entry of fs.readdirSync(current).sort()) {
      walk(path.join(current, entry), relative === "." ? entry : path.join(relative, entry));
    }
  }
  walk(target);
  return canonicalDigest(entries);
}

export function createBoundEvidenceSnapshotter(outputBoundary) {
  requireValue(outputBoundary?.lexical_path && outputBoundary?.grant,
    "bound evidence snapshotter requires an execution output boundary", 4);
  const sealedBoundary = structuredClone(outputBoundary);
  return (target, options = {}) => {
    const absolute = path.resolve(target);
    requireValue(inside(absolute, sealedBoundary.lexical_path),
      `returned evidence escapes the granted output directory at ingest: ${absolute}`, 4);
    verifyPhysicalEvidencePath(absolute, sealedBoundary);
    const before = physicalEvidenceIdentity(absolute);
    const snapshot = snapshotArtifact(absolute, options);
    verifyPhysicalEvidencePath(absolute, sealedBoundary);
    const after = physicalEvidenceIdentity(absolute);
    requireValue(before === after,
      `returned evidence changed while it was being ingested: ${absolute}`, 4);
    requireValue(hashArtifact(absolute) === snapshot.digest,
      `returned evidence changed after its ingest snapshot: ${absolute}`, 4);
    return snapshot;
  };
}

function resolveManifestPath(value, manifestPath) {
  if (!value) return null;
  return path.isAbsolute(value)
    ? path.resolve(value)
    : path.resolve(path.dirname(path.resolve(manifestPath)), value);
}

function validatePermissions(value, label) {
  requireValue(Array.isArray(value), `${label} must be an array`);
  const scopes = unique(value);
  requireValue(scopes.length === value.length, `${label} contains duplicate permission scopes`);
  for (const scope of scopes) {
    requireValue(HOST_PERMISSION_SCOPES.has(scope), `${label} contains unsupported scope: ${scope}`);
  }
  return scopes;
}

function requiredPermissions(adapter) {
  if (adapter === "browser-json-v1") {
    return ["artifact:read", "evidence:write", "browser:control"];
  }
  if (adapter === "kill-ai-slop-v1") return ["artifact:read"];
  if (PROCESS_ADAPTERS.has(adapter)) return ["artifact:read"];
  return [];
}

function freezeAuthority(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) freezeAuthority(nested);
  return Object.freeze(value);
}

function sealedAuthorityCacheKey({
  entrypoint,
  expectedDigest,
  expectedGraphDigest,
  trustedPackageRoot
}) {
  return canonicalDigest({
    sealed_entrypoint_authority_cache_key_version: 1,
    entrypoint: path.resolve(entrypoint),
    expected_digest: expectedDigest,
    expected_graph_digest: expectedGraphDigest || null,
    trusted_package_root: trustedPackageRoot
      ? path.resolve(trustedPackageRoot)
      : null
  });
}

function createCachedSealedEntrypointAuthority(cache, entrypoint, expectedDigest, {
  label,
  expectedGraphDigest = null,
  trustedPackageRoot = null
}) {
  const key = sealedAuthorityCacheKey({
    entrypoint,
    expectedDigest,
    expectedGraphDigest,
    trustedPackageRoot
  });
  if (!cache.has(key)) {
    cache.set(key, freezeAuthority(createSealedEntrypointAuthority(
      entrypoint,
      expectedDigest,
      { label, expectedGraphDigest, trustedPackageRoot }
    )));
  }
  // Never expose the cached object itself. Provider declarations remain
  // independently mutable so one caller-side mutation cannot alias another
  // provider or corrupt the per-load cache.
  return structuredClone(cache.get(key));
}

function validateProviderDeclaration(
  providerId,
  declaration,
  config,
  manifestPath,
  entrypointAuthorityCache
) {
  requireValue(declaration && typeof declaration === "object" && !Array.isArray(declaration),
    `host provider ${providerId} must be an object`);
  for (const key of Object.keys(declaration)) {
    requireValue(PROVIDER_KEYS.has(key),
      `host provider ${providerId} contains unsupported field: ${key}`);
  }
  requireValue(HOST_ADAPTER_TYPES.has(declaration.adapter),
    `host provider ${providerId} has unsupported adapter: ${declaration.adapter || "missing"}`);
  requireValue(Number.isInteger(declaration.strength) && declaration.strength >= 1 && declaration.strength <= 4,
    `host provider ${providerId} strength must be an integer from 1 to 4`);
  requireValue(Array.isArray(declaration.capabilities) && declaration.capabilities.length > 0,
    `host provider ${providerId} requires capabilities`);
  const capabilities = unique(declaration.capabilities);
  requireValue(capabilities.length === declaration.capabilities.length,
    `host provider ${providerId} contains duplicate capabilities`);
  const permissions = validatePermissions(declaration.permissions,
    `host provider ${providerId} permissions`);
  for (const permission of permissions) {
    requireValue(config.granted_permissions.includes(permission),
      `host provider ${providerId} requests ungranted permission: ${permission}`);
  }
  for (const permission of requiredPermissions(declaration.adapter)) {
    requireValue(permissions.includes(permission),
      `host provider ${providerId} adapter ${declaration.adapter} requires ${permission}`);
  }

  let entrypoint = null;
  let entrypointAuthority = null;
  let adapterRoot = null;
  if (PROCESS_ADAPTERS.has(declaration.adapter)) {
    requireValue(typeof declaration.entrypoint === "string" && declaration.entrypoint.length > 0,
      `host provider ${providerId} requires entrypoint`);
    requireValue(DIGEST_PATTERN.test(declaration.entrypoint_digest || ""),
      `host provider ${providerId} requires entrypoint_digest`);
    entrypoint = resolveManifestPath(declaration.entrypoint, manifestPath);
    requireValue(fs.existsSync(entrypoint), `host provider ${providerId} entrypoint is missing: ${entrypoint}`, 4);
    const stat = fs.lstatSync(entrypoint);
    requireValue(stat.isFile() && !stat.isSymbolicLink(),
      `host provider ${providerId} entrypoint must be a regular non-symlink file`, 4);
  }
  if (declaration.adapter === "kill-ai-slop-v1") {
    requireValue(typeof declaration.adapter_root === "string" && declaration.adapter_root.length > 0,
      `host provider ${providerId} requires adapter_root`);
    requireValue(DIGEST_PATTERN.test(declaration.entrypoint_digest || ""),
      `host provider ${providerId} requires entrypoint_digest`);
    adapterRoot = resolveManifestPath(declaration.adapter_root, manifestPath);
    entrypoint = findKillAiSlopScanner(adapterRoot);
    requireValue(Boolean(entrypoint),
      `host provider ${providerId} kill-ai-slop scanner is missing under ${adapterRoot}`, 4);
  }
  if (entrypoint) {
    const bundledContract = [
      CODEX_REVIEW_ADAPTER_CONTRACT,
      PLAYWRIGHT_ADAPTER_CONTRACT
    ].includes(declaration.settings?.contract);
    entrypointAuthority = createCachedSealedEntrypointAuthority(
      entrypointAuthorityCache,
      entrypoint,
      declaration.entrypoint_digest,
      {
        label: `host provider ${providerId} entrypoint`,
        expectedGraphDigest: declaration.entrypoint_graph_digest || null,
        trustedPackageRoot: bundledContract ? packageRoot : null
      }
    );
  }

  const timeoutMs = declaration.timeout_ms ?? DEFAULT_TIMEOUT_MS;
  requireValue(Number.isInteger(timeoutMs) && timeoutMs >= 100 && timeoutMs <= MAX_TIMEOUT_MS,
    `host provider ${providerId} timeout_ms must be between 100 and ${MAX_TIMEOUT_MS}`);
  requireValue(declaration.settings === undefined || (
    declaration.settings && typeof declaration.settings === "object" && !Array.isArray(declaration.settings)
  ), `host provider ${providerId} settings must be an object`);
  let normalizedSettings = declaration.settings
    ? structuredClone(declaration.settings)
    : {};
  let officialPlaywright = null;
  if (declaration.adapter === "browser-json-v1" &&
    declaration.settings?.contract === PLAYWRIGHT_ADAPTER_CONTRACT) {
    officialPlaywright = validateOfficialPlaywrightSettings(declaration.settings, {
      entrypoint,
      permissionScopes: permissions,
      manifestPath
    });
    normalizedSettings = {
      ...normalizedSettings,
      runtime_root: officialPlaywright.runtimeRoot,
      scenario_file: officialPlaywright.scenarioFile,
      baseline_directory: officialPlaywright.baselineDirectory
    };
  }
  let officialCodex = null;
  if (PROCESS_ADAPTERS.has(declaration.adapter) &&
    declaration.settings?.contract === CODEX_REVIEW_ADAPTER_CONTRACT) {
    officialCodex = validateOfficialCodexSettings(declaration.settings, {
      entrypoint,
      adapterType: declaration.adapter,
      permissionScopes: permissions,
      manifestPath
    });
  }

  return {
    ...declaration,
    provider_id: providerId,
    capabilities,
    permissions,
    entrypoint,
    entrypoint_authority: entrypointAuthority,
    adapter_root: adapterRoot,
    timeout_ms: timeoutMs,
    settings: normalizedSettings,
    official_playwright: officialPlaywright,
    official_codex: officialCodex
  };
}

export function loadHostManifest(manifestPath) {
  const absolute = path.resolve(manifestPath);
  requireValue(fs.existsSync(absolute), `host adapter manifest is missing: ${absolute}`);
  const stat = fs.lstatSync(absolute);
  requireValue(stat.isFile() && !stat.isSymbolicLink(),
    "host adapter manifest must be a regular non-symlink file", 4);
  let raw;
  let source;
  let pinned;
  try {
    pinned = readFilePinned(absolute, { label: "host adapter manifest" });
    source = pinned.source.toString("utf8");
    raw = JSON.parse(source);
  } catch (error) {
    throw new RouterError(`cannot read host adapter manifest at ${absolute}: ${error.message}`, 2);
  }
  requireValue(raw?.host_adapter_version === 1, "host_adapter_version must be 1");
  for (const key of Object.keys(raw || {})) {
    requireValue(HOST_KEYS.has(key), `host manifest contains unsupported field: ${key}`);
  }
  requireValue(Array.isArray(raw.allowed_providers) && raw.allowed_providers.length > 0,
    "host manifest requires allowed_providers");
  const allowedProviders = unique(raw.allowed_providers);
  requireValue(allowedProviders.length === raw.allowed_providers.length,
    "host manifest allowed_providers contains duplicates");
  const grantedPermissions = validatePermissions(raw.granted_permissions,
    "host manifest granted_permissions");
  requireValue(raw.providers && typeof raw.providers === "object" && !Array.isArray(raw.providers),
    "host manifest requires providers");
  for (const providerId of Object.keys(raw.providers)) {
    requireValue(allowedProviders.includes(providerId),
      `host provider ${providerId} is configured but not allowlisted`);
  }
  const base = { ...raw, allowed_providers: allowedProviders, granted_permissions: grantedPermissions };
  // Scope this cache to one synchronous manifest load. Every later inspection
  // and execution boundary reloads the manifest and revalidates the graph.
  const entrypointAuthorityCache = new Map();
  const providers = Object.fromEntries(Object.entries(raw.providers).map(([providerId, declaration]) => [
    providerId,
    validateProviderDeclaration(
      providerId,
      declaration,
      base,
      absolute,
      entrypointAuthorityCache
    )
  ]));
  return {
    host_adapter_version: 1,
    manifest_path: absolute,
    manifest_digest: pinned.digest,
    manifest_physical_identity_digest: pinned.physical_identity_digest,
    manifest_source: publicSnapshot(pinned.source_snapshot),
    allowed_providers: allowedProviders,
    granted_permissions: grantedPermissions,
    providers
  };
}

function verifyLoadedHostManifest(manifest, phase) {
  // A caller retains and can mutate the object returned by loadHostManifest().
  // Reconstruct authority from the pinned file and use only that fresh value.
  requireValue(manifest && typeof manifest === "object" && !Array.isArray(manifest),
    `host adapter manifest authority is missing ${phase}`, 4);
  requireValue(typeof manifest.manifest_path === "string" && manifest.manifest_path.length > 0,
    `host adapter manifest path is missing ${phase}`, 4);
  let reloaded;
  try {
    reloaded = loadHostManifest(manifest.manifest_path);
  } catch (error) {
    throw new RouterError(
      `host adapter manifest cannot be reloaded ${phase}: ${error.message}`,
      4
    );
  }
  requireValue(
    reloaded.manifest_digest === manifest.manifest_digest &&
      reloaded.manifest_physical_identity_digest === manifest.manifest_physical_identity_digest,
    `host adapter manifest changed ${phase}`,
    4
  );
  requireValue(
    stableHostManifestAuthorityDigest(reloaded) ===
      stableHostManifestAuthorityDigest(manifest),
    `host adapter manifest normalized authority was mutated in memory or an entrypoint authority changed ${phase}`,
    4
  );
  return reloaded;
}

function stableHostManifestAuthorityDigest(manifest) {
  const authority = structuredClone(manifest);
  for (const declaration of Object.values(authority.providers || {})) {
    // Codex authentication is a live host observation, not manifest authority.
    // A reload may legitimately move between ready and manual_pending when
    // CODEX_HOME changes. It must be recomputed and used only from `reloaded`,
    // while every digest-bound provider, path, permission, capability, setting,
    // and entrypoint authority remains covered by this comparison.
    if (declaration?.official_codex) delete declaration.official_codex.readiness;
  }
  return canonicalDigest(authority);
}

function verifyHostManifestBoundary(manifest) {
  return verifyLoadedHostManifest(manifest, "before child execution");
}

function manualPending(packet, reason, manifest = null) {
  return {
    execution_status: "manual_pending",
    packet_id: packet.packet_id,
    provider_id: packet.provider.id,
    participant: packet.participant,
    adapter: null,
    host_manifest_digest: manifest?.manifest_digest || null,
    reason
  };
}

function inspectVerifiedPacketAdapter(packet, manifest) {
  verifyPacketJourney(packet, packet?.journey_identity, `packet ${packet?.packet_id || "unknown"}`);
  if (!manifest) return manualPending(packet, "no host adapter manifest was supplied");
  if (!manifest.allowed_providers.includes(packet.provider.id)) {
    return manualPending(packet, `provider is not allowlisted: ${packet.provider.id}`, manifest);
  }
  const declaration = manifest.providers[packet.provider.id];
  if (!declaration) {
    return manualPending(packet, `allowlisted provider has no host adapter: ${packet.provider.id}`, manifest);
  }
  if (declaration.adapter === "manual-v1") {
    return manualPending(packet, `provider is explicitly manual: ${packet.provider.id}`, manifest);
  }
  if (packet.provider.id === "kill-ai-slop" && declaration.adapter !== "kill-ai-slop-v1") {
    return manualPending(packet, "kill-ai-slop requires the kill-ai-slop-v1 adapter", manifest);
  }
  if (packet.provider.id === "anti-slop" && declaration.adapter !== "skill-json-v1") {
    return manualPending(packet,
      "anti-slop must run as a packet-bound skill-json-v1 child critic, not as a standalone or agent provider",
      manifest);
  }
  if (packet.provider.id === "anti-slop" && packet.stage_id !== "functional-human-review") {
    return manualPending(packet,
      "anti-slop may only satisfy the routed functional-human-review stage",
      manifest);
  }
  if (packet.stage_id === "browser-evidence" && declaration.adapter !== "browser-json-v1") {
    return manualPending(packet, "browser-evidence requires the browser-json-v1 adapter", manifest);
  }
  if (packet.stage_id === "browser-evidence" &&
    packet.provider.resolved_to === PLAYWRIGHT_PROVIDER_TARGET &&
    declaration.settings?.contract !== PLAYWRIGHT_ADAPTER_CONTRACT) {
    return manualPending(packet,
      "official Playwright routing requires the digest-locked official Playwright host adapter", manifest);
  }
  if (packet.stage_id === "browser-evidence" &&
    !packet.design_task &&
    packet.provider.resolved_to === PLAYWRIGHT_PROVIDER_TARGET) {
    const expectedContract = packet.evidence_contract?.browser_contract_digest;
    if (!DIGEST_PATTERN.test(expectedContract || "")) {
      return manualPending(packet,
        "official Playwright routing requires a profile-bound browser verification contract digest", manifest);
    }
    if (declaration.official_playwright?.verificationContractDigest !== expectedContract) {
      return manualPending(packet,
        "official Playwright host does not match the profile-bound browser verification contract", manifest);
    }
  }
  if (packet.stage_id !== "browser-evidence" && declaration.adapter === "browser-json-v1") {
    return manualPending(packet, "browser-json-v1 may only satisfy browser-evidence packets", manifest);
  }
  if (declaration.settings?.contract === PLAYWRIGHT_ADAPTER_CONTRACT) {
    const missingViewports = (packet.evidence_contract?.required_viewports || [])
      .filter((viewport) => !declaration.settings.viewports?.[viewport]);
    if (missingViewports.length) {
      return manualPending(packet,
        `official Playwright adapter lacks viewports: ${missingViewports.join(", ")}`, manifest);
    }
    const unsupportedChecks = (packet.evidence_contract?.required_checks || [])
      .filter((check) => !PLAYWRIGHT_SUPPORTED_CHECKS.has(check));
    if (unsupportedChecks.length) {
      return manualPending(packet,
        `official Playwright adapter cannot prove checks: ${unsupportedChecks.join(", ")}`, manifest);
    }
    const missingScenarios = (packet.evidence_contract?.required_scenarios || [])
      .filter((scenario) => !declaration.official_playwright?.scenarioIds.includes(scenario));
    if (missingScenarios.length) {
      return manualPending(packet,
        `official Playwright adapter lacks required scenarios: ${missingScenarios.join(", ")}`, manifest);
    }
    const assertionlessScenarios = (packet.evidence_contract?.required_scenarios || [])
      .filter((scenario) => !declaration.official_playwright?.scenarioAssertions[scenario]);
    if (assertionlessScenarios.length) {
      return manualPending(packet,
        `official Playwright scenarios lack state assertions: ${assertionlessScenarios.join(", ")}`, manifest);
    }
    const unsupportedDesignChecks = packet.design_task?.kind === "browser-evidence"
      ? (packet.evidence_contract?.required_checks || [])
        .filter((check) => ["screen-reader", "visual-regression"].includes(check))
      : [];
    if (unsupportedDesignChecks.length) {
      return manualPending(packet,
        `official static-design Playwright adapter cannot prove checks: ${unsupportedDesignChecks.join(", ")}`,
        manifest);
    }
  }
  if (declaration.settings?.contract === CODEX_REVIEW_ADAPTER_CONTRACT && packet.design_packet_version === 1) {
    return manualPending(packet,
      "official Codex review adapter is read-only and cannot create or review design-exploration candidates",
      manifest);
  }
  const missingPermissions = (packet.required_permissions || []).filter(
    (permission) => !declaration.permissions.includes(permission)
  );
  if (missingPermissions.length) {
    return manualPending(packet,
      `host adapter lacks required permissions: ${missingPermissions.join(", ")}`,
      manifest);
  }
  const forbiddenPermissions = (packet.forbidden_permissions || []).filter(
    (permission) => declaration.permissions.includes(permission)
  );
  if (forbiddenPermissions.length) {
    return manualPending(packet,
      `host adapter has permissions forbidden for this packet: ${forbiddenPermissions.join(", ")}`,
      manifest);
  }
  if (declaration.strength < (packet.minimum_strength || 1)) {
    return manualPending(packet,
      `host adapter strength ${declaration.strength} is below required ${packet.minimum_strength || 1}`,
      manifest);
  }
  const missingCapabilities = packet.assigned_capabilities.filter(
    (capability) => !declaration.capabilities.includes(capability)
  );
  if (missingCapabilities.length) {
    return manualPending(packet,
      `host adapter lacks assigned capabilities: ${missingCapabilities.join(", ")}`,
      manifest);
  }
  if (declaration.settings?.contract === CODEX_REVIEW_ADAPTER_CONTRACT &&
    declaration.official_codex?.readiness.status !== "ready") {
    return manualPending(packet,
      declaration.official_codex?.readiness.reason || "official Codex reviewer is unavailable",
      manifest);
  }
  return {
    execution_status: "ready",
    packet_id: packet.packet_id,
    provider_id: packet.provider.id,
    participant: packet.participant,
    adapter: declaration.adapter,
    host_manifest_digest: manifest.manifest_digest,
    declaration
  };
}

export function inspectPacketAdapter(packet, manifest) {
  const verifiedManifest = manifest
    ? verifyLoadedHostManifest(manifest, "before packet adapter inspection")
    : null;
  return inspectVerifiedPacketAdapter(packet, verifiedManifest);
}

function normalizeReturnedEvidence(result, outputDirectory, outputBoundary) {
  const normalized = structuredClone(result);
  normalized.evidence = (normalized.evidence || []).map((item, index) => {
    requireValue(item?.path, `returned evidence ${index + 1} requires path`, 4);
    const resolved = path.isAbsolute(item.path)
      ? path.resolve(item.path)
      : path.resolve(outputDirectory, item.path);
    requireValue(inside(resolved, outputDirectory),
      `returned evidence escapes the granted output directory: ${item.path}`, 4);
    requireValue(fs.existsSync(resolved), `returned evidence is missing: ${resolved}`, 4);
    verifyPhysicalEvidencePath(resolved, outputBoundary);
    return { ...item, path: resolved };
  });
  return normalized;
}

function runJsonProcess({
  declaration,
  manifest,
  packet,
  run,
  attempt,
  outputDirectory,
  outputGrantRoot,
  preparedOutputBoundary = null,
  authorityFaultInjector = null
}) {
  verifyJourneyIdentity(run.journey_identity, { runId: run.run_id, label: "host run journey_identity" });
  verifyPacketJourney(packet, run.journey_identity, `packet ${packet.packet_id}`);
  if (!identitiesMatch(packet.journey_identity, run.journey_identity)) {
    throw new RouterError("host packet journey identity conflicts with the run", 4);
  }
  verifyRunArtifacts(run, "before child authority preparation");
  const outputBoundary = preparedOutputBoundary
    ? verifyPreparedOutputBoundary(
      preparedOutputBoundary,
      outputDirectory,
      outputGrantRoot
    )
    : createOutputBoundary(outputDirectory, outputGrantRoot);
  const request = {
    host_adapter_request_version: 1,
    run_id: run.run_id,
    journey_identity: run.journey_identity,
    participant: packet.participant,
    attempt,
    packet,
    packets: run.packets,
    creator: run.creator,
    scope: run.scope,
    artifacts: run.artifacts,
    prior_results: run.results.map((record) => record.normalized),
    output_directory: outputDirectory,
    permission_scopes: declaration.permissions,
    settings: structuredClone(declaration.settings)
  };
  if (run.baseline_lineage) request.baseline_lineage = run.baseline_lineage;
  const startedAt = new Date().toISOString();
  const childEnvironment = {
    PATH: process.env.PATH || "",
    KILLSLOPROUTER_HOST_ADAPTER: "1"
  };
  if (declaration.settings?.contract === CODEX_REVIEW_ADAPTER_CONTRACT) {
    if (process.env.CODEX_HOME) childEnvironment.CODEX_HOME = process.env.CODEX_HOME;
    if (process.env.HOME) childEnvironment.HOME = process.env.HOME;
  }
  verifyExecutionLineageBoundary(run, packet, authorityFaultInjector);
  if (declaration.settings?.contract === CODEX_REVIEW_ADAPTER_CONTRACT) {
    verifyOfficialCodexRuntimeSources(declaration.settings, declaration.official_codex);
    authorityFaultInjector?.("after-codex-runtime-authority-before-final-confirmation", {
      runtime_path: declaration.official_codex.sourceRuntimePath,
      runtime_root: declaration.official_codex.sourceRuntimeRoot,
      runtime_digest: declaration.settings.runtime_digest,
      runtime_physical_identity_digest:
        declaration.settings.runtime_physical_identity_digest
    });
  }
  let verifiedPlaywright = null;
  if (declaration.settings?.contract === PLAYWRIGHT_ADAPTER_CONTRACT) {
    verifiedPlaywright = validateOfficialPlaywrightSettings(declaration.settings, {
      entrypoint: declaration.entrypoint,
      permissionScopes: declaration.permissions,
      manifestPath: manifest.manifest_path,
      faultInjector: authorityFaultInjector
    });
    requireValue(
      verifiedPlaywright.runtimeRoot === declaration.official_playwright.runtimeRoot &&
        verifiedPlaywright.scenarioFile === declaration.official_playwright.scenarioFile &&
        verifiedPlaywright.baselineDirectory === declaration.official_playwright.baselineDirectory &&
        verifiedPlaywright.verificationContractDigest ===
          declaration.official_playwright.verificationContractDigest,
      "official Playwright authority paths or verification contract changed before child execution",
      4
    );
    requireValue(
      verifiedPlaywright.scenarioSnapshot?.physical_identity_digest ===
        declaration.official_playwright.scenarioSnapshot?.physical_identity_digest,
      "official Playwright scenario physical identity changed before child execution",
      4
    );
    requireValue(
      verifiedPlaywright.baselineSnapshot?.physical_identity_digest ===
        declaration.official_playwright.baselineSnapshot?.physical_identity_digest,
      "official Playwright baseline physical identity changed before child execution",
      4
    );
  }
  authorityFaultInjector?.("after-child-authority-preflight-before-final-confirmation", {
    run_id: run.run_id,
    packet_id: packet.packet_id,
    entrypoint: declaration.entrypoint
  });
  verifyExecutionLineageBoundary(run, packet);
  verifyRunArtifacts(run, "at the final child execution boundary");
  verifyHostManifestBoundary(manifest);
  if (declaration.settings?.contract === CODEX_REVIEW_ADAPTER_CONTRACT) {
    verifyOfficialCodexRuntimeSources(declaration.settings, declaration.official_codex);
  }
  verifySealedEntrypointAuthority(declaration.entrypoint_authority);
  let playwrightRuntimeSeal = null;
  if (verifiedPlaywright) {
    try {
      playwrightRuntimeSeal = createPlaywrightRuntimeSeal(declaration.settings, {
        faultInjector: authorityFaultInjector
      });
      request.playwright_authority = createPlaywrightChildAuthority(
        declaration.settings,
        verifiedPlaywright,
        {
          faultInjector: authorityFaultInjector,
          runtimeSeal: playwrightRuntimeSeal
        }
      );
      authorityFaultInjector?.("after-playwright-authority-handoff-before-final-confirmation", {
        scenario_file: verifiedPlaywright.scenarioFile,
        baseline_directory: verifiedPlaywright.baselineDirectory,
        runtime_root: declaration.settings.runtime_root,
        authority_digest: request.playwright_authority.authority_digest
      });
      verifyPlaywrightChildAuthoritySources(declaration.settings, request.playwright_authority);
      verifyExecutionLineageBoundary(run, packet);
      verifyHostManifestBoundary(manifest);
      verifySealedEntrypointAuthority(declaration.entrypoint_authority);
      request.settings.runtime_root = playwrightRuntimeSeal.runtimeRoot;
    } catch (error) {
      playwrightRuntimeSeal?.cleanup();
      throw error;
    }
  }
  let child;
  try {
    child = spawnSealedNodeEntrypoint(declaration.entrypoint_authority, [], {
      input: `${JSON.stringify(request)}\n`,
      encoding: "utf8",
      cwd: outputDirectory,
      env: childEnvironment,
      shell: false,
      timeout: declaration.timeout_ms,
      maxBuffer: 16 * 1024 * 1024
    });
  } finally {
    playwrightRuntimeSeal?.cleanup();
  }
  const finishedAt = new Date().toISOString();
  try {
    verifyRunArtifacts(run, "after child execution before result ingest");
    verifyPreparedOutputBoundary(outputBoundary, outputDirectory, outputGrantRoot);
  } catch (error) {
    return {
      execution_status: "blocked_execution_error",
      started_at: startedAt,
      finished_at: finishedAt,
      child_pid: child.pid || null,
      exit_code: child.status,
      signal: child.signal || null,
      error: error.message
    };
  }
  if (child.error || child.status !== 0) {
    const rawError = child.error?.message || child.stderr?.trim() || `child exited ${child.status}`;
    const boundaryError = child.error?.code === "ENOBUFS" ||
      /(?:EAGAIN|resource temporarily unavailable)[\s\S]*(?:write|buffer)|(?:write|buffer)[\s\S]*(?:EAGAIN|resource temporarily unavailable)/i
        .test(rawError);
    return {
      execution_status: "blocked_execution_error",
      started_at: startedAt,
      finished_at: finishedAt,
      child_pid: child.pid || null,
      exit_code: child.status,
      signal: child.signal || null,
      error: boundaryError
        ? `child output exceeded the maxBuffer process boundary: ${rawError}`
        : rawError
    };
  }
  let response;
  try {
    response = JSON.parse(child.stdout);
  } catch (error) {
    return {
      execution_status: "blocked_execution_error",
      started_at: startedAt,
      finished_at: finishedAt,
      child_pid: child.pid || null,
      exit_code: child.status,
      signal: child.signal || null,
      error: `host adapter emitted invalid JSON: ${error.message}`
    };
  }
  if (response?.host_adapter_response_version === 1 &&
    response.execution_status === "manual_pending" &&
    declaration.settings?.contract === CODEX_REVIEW_ADAPTER_CONTRACT &&
    typeof response.reason === "string" && response.reason.length > 0) {
    return {
      execution_status: "manual_pending",
      started_at: startedAt,
      finished_at: finishedAt,
      child_pid: child.pid || response.metadata?.child_pid || null,
      exit_code: child.status,
      signal: child.signal || null,
      metadata: response.metadata || {},
      reason: response.reason
    };
  }
  if (response?.host_adapter_response_version !== 1 || !response.result) {
    return {
      execution_status: "blocked_execution_error",
      started_at: startedAt,
      finished_at: finishedAt,
      child_pid: child.pid || response?.metadata?.child_pid || null,
      exit_code: child.status,
      signal: child.signal || null,
      error: "host adapter response requires host_adapter_response_version 1 and result"
    };
  }
  try {
    return {
      execution_status: "ran",
      started_at: startedAt,
      finished_at: finishedAt,
      child_pid: child.pid || response.metadata?.child_pid || null,
      exit_code: child.status,
      signal: child.signal || null,
      metadata: response.metadata || {},
      result: normalizeReturnedEvidence(response.result, outputDirectory, outputBoundary),
      evidence_boundary: outputBoundary
    };
  } catch (error) {
    return {
      execution_status: "blocked_execution_error",
      started_at: startedAt,
      finished_at: finishedAt,
      child_pid: child.pid || response.metadata?.child_pid || null,
      exit_code: child.status,
      signal: child.signal || null,
      error: error.message
    };
  }
}

function runScanner({ declaration, manifest, packet, run, authorityFaultInjector = null }) {
  if (run.artifacts.length !== 1) {
    return {
      execution_status: "blocked_execution_error",
      error: "kill-ai-slop-v1 requires exactly one root artifact"
    };
  }
  verifyExecutionLineageBoundary(run, packet, authorityFaultInjector);
  authorityFaultInjector?.("after-child-authority-preflight-before-final-confirmation", {
    run_id: run.run_id,
    packet_id: packet.packet_id,
    entrypoint: declaration.entrypoint
  });
  verifyExecutionLineageBoundary(run, packet);
  verifyHostManifestBoundary(manifest);
  verifySealedEntrypointAuthority(declaration.entrypoint_authority);
  const receipt = runKillAiSlop({
    adapterRoot: declaration.adapter_root,
    scannerPath: declaration.entrypoint,
    entrypointAuthority: declaration.entrypoint_authority,
    expectedArtifactSnapshot: run.artifacts[0],
    target: run.artifacts[0].resolved_path,
    version: packet.provider.version || null,
    environment: {
      PATH: process.env.PATH || "",
      KILLSLOPROUTER_HOST_ADAPTER: "1"
    }
  });
  if (String(receipt.status).startsWith("blocked")) {
    return {
      execution_status: "blocked_execution_error",
      started_at: receipt.started_at,
      finished_at: receipt.finished_at,
      child_pid: null,
      exit_code: null,
      signal: null,
      error: receipt.error || receipt.status
    };
  }
  return {
    execution_status: "ran",
    started_at: receipt.started_at,
    finished_at: receipt.finished_at,
    child_pid: null,
    exit_code: 0,
    signal: null,
    metadata: { transport: "built-in-kill-ai-slop" },
    result: {
      ...receipt,
      run_id: run.run_id,
      packet_digest: packet.packet_digest,
      journey_identity: run.journey_identity,
      participant: packet.participant,
      ...(run.baseline_lineage
        ? { baseline_lineage_digest: run.baseline_lineage.lineage_digest }
        : {})
    }
  };
}

function verifyExecutionLineageBoundary(run, packet, authorityFaultInjector = null) {
  if (run?.audit_run_version === 1) {
    verifyAuditJourneyIdentity(run, {
      faultInjector: authorityFaultInjector,
      verifyExternalAuthorities: true
    });
  }
  const runLineage = run.baseline_lineage || null;
  const packetLineage = packet.baseline_lineage || null;
  requireValue(
    baselineLineagesMatch(packetLineage, runLineage),
    "packet baseline_lineage conflicts with the run at the child execution boundary",
    4
  );
  if (runLineage) {
    try {
      verifyBaselineLineage(runLineage, "execution baseline_lineage");
    } catch (error) {
      throw new RouterError(error.message, 4);
    }
    requireValue(Boolean(run.planning_gate),
      "lineaged child execution requires verified planning authority", 4);
  }
  if (run.audit_run_version === 1) {
    requireValue(Boolean(run.route?.plan_source),
      "audit child execution requires a digest-bound canonical route plan source", 4);
  }
  let sourcePlan = null;
  if (run.route?.plan_source) {
    const pinnedPlan = readPinnedExecutionJson(
      run.route.plan_source.resolved_path,
      "route plan authority before child execution",
      authorityFaultInjector
    );
  requireValue(pinnedPlan.digest === run.route.plan_source.digest,
      "route plan authority changed before child execution: digest-mismatch", 4);
    requireValue(
      pinnedPlan.physical_identity_digest === run.route.plan_source.physical_identity_digest,
      "route plan authority changed before child execution: physical-identity-mismatch",
      4
    );
    sourcePlan = pinnedPlan.input;
    requireValue(canonicalDigest(sourcePlan) === run.route.plan_digest,
      "route plan digest changed before child execution", 4);
    requireValue(
      sourcePlan.router_id === run.route.router_id &&
      sourcePlan.router_version === run.route.router_version &&
      sourcePlan.route_id === run.route.route_id &&
      sourcePlan.project_id === run.route.project_id,
      "run route identity conflicts with the digest-bound route plan before child execution",
      4
    );
    requireValue(canonicalDigest(sourcePlan.input) === canonicalDigest(run.route.input),
      "run route input conflicts with the digest-bound route plan before child execution", 4);
    if (sourcePlan.input?.scope) {
      requireValue(sourcePlan.input.scope === run.scope?.kind,
        "run scope conflicts with the digest-bound route plan before child execution", 4);
    }
    requireValue(
      baselineLineagesMatch(sourcePlan.baseline_lineage || null, runLineage),
      "run baseline_lineage conflicts with the digest-bound route plan before child execution",
      4
    );
  }
  if (!sourcePlan && !run.planning_gate) return;
  if (sourcePlan?.baseline_lineage) {
    requireValue(Boolean(sourcePlan.input?.scope),
      "lineaged route plan must bind its audit scope before child execution", 4);
  }
  const planningPlan = sourcePlan || {
    project_id: run.route?.project_id,
    input: run.route?.input,
    planning_gate: run.planning_gate
  };
  const planningScope = sourcePlan?.input?.scope || run.scope?.kind;
  let verifiedPlanning;
  try {
    verifiedPlanning = verifyPlanningGateForAudit(planningPlan, planningScope, {
      artifacts: run.artifacts,
      root: run.root || process.cwd()
    });
  } catch (error) {
    throw new RouterError(`child execution planning verification failed: ${error.message}`, 4);
  }
  requireValue(
    baselineLineagesMatch(verifiedPlanning?.baseline_lineage || null, runLineage),
    "run baseline_lineage conflicts with verified planning authority before child execution",
    4
  );
  requireValue(
    planningAuthoritiesMatch(verifiedPlanning || null, run.planning_gate || null),
    "run planning authority conflicts with the digest-bound route plan before child execution",
    4
  );
  if (run?.audit_run_version === 1) {
    verifyAuditJourneyIdentity(run, { verifyExternalAuthorities: true });
  }
}

export function executeAuditPacket({
  run,
  packet,
  manifest = null,
  attempt = 1,
  outputDirectory,
  outputGrantRoot = null,
  outputBoundary = null,
  authorityFaultInjector = null
}) {
  verifyJourneyIdentity(run?.journey_identity, { runId: run?.run_id, label: "execution journey_identity" });
  verifyPacketJourney(packet, run.journey_identity, `packet ${packet?.packet_id || "unknown"}`);
  const verifiedManifest = manifest
    ? verifyLoadedHostManifest(manifest, "before packet execution")
    : null;
  const inspection = inspectVerifiedPacketAdapter(packet, verifiedManifest);
  if (inspection.execution_status !== "ready") return inspection;
  const declaration = inspection.declaration;
  if (declaration.entrypoint) {
    try {
      verifySealedEntrypointAuthority(declaration.entrypoint_authority);
    } catch (error) {
      return {
        packet_id: packet.packet_id,
        provider_id: packet.provider.id,
        adapter: declaration.adapter,
        host_manifest_digest: verifiedManifest.manifest_digest,
        attempt,
        execution_status: "blocked_execution_error",
        error: error.message
      };
    }
  }
  const base = {
    packet_id: packet.packet_id,
    provider_id: packet.provider.id,
    participant: packet.participant,
    adapter: declaration.adapter,
    adapter_entrypoint: declaration.entrypoint
      ? publicSnapshot({
        path: declaration.entrypoint,
        resolved_path: declaration.entrypoint,
        kind: "file",
        bytes: declaration.entrypoint_authority.bytes,
        digest: declaration.entrypoint_authority.digest,
        physical_identity_digest: declaration.entrypoint_authority.physical_identity_digest
      })
      : null,
    host_manifest_digest: verifiedManifest.manifest_digest,
    permission_scopes: declaration.permissions,
    strength: declaration.strength,
    capabilities: declaration.capabilities,
    attempt
  };
  try {
    const executed = declaration.adapter === "kill-ai-slop-v1"
      ? runScanner({
        declaration,
        manifest: verifiedManifest,
        packet,
        run,
        authorityFaultInjector
      })
      : runJsonProcess({
        declaration,
        manifest: verifiedManifest,
        packet,
        run,
        attempt,
        outputDirectory,
        outputGrantRoot,
        preparedOutputBoundary: outputBoundary,
        authorityFaultInjector
      });
    return { ...base, ...executed };
  } catch (error) {
    return {
      ...base,
      execution_status: "blocked_execution_error",
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
      child_pid: null,
      exit_code: null,
      signal: null,
      error: error.message
    };
  }
}

export function hostReadiness(run, manifest = null) {
  const verifiedManifest = manifest
    ? verifyLoadedHostManifest(manifest, "before host readiness inspection")
    : null;
  return run.packets.map((packet) => {
    const inspected = inspectVerifiedPacketAdapter(packet, verifiedManifest);
    const { declaration: _declaration, ...publicInspection } = inspected;
    return publicInspection;
  });
}

export function hostManifestSchemaPath() {
  return fileURLToPath(new URL("../schemas/host-adapter.schema.json", import.meta.url));
}
