import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  canonicalDigest,
  hashArtifact,
  readFilePinned,
  writeJsonAtomic
} from "./integrity.mjs";
import { RouterError, readJson, validateProfile } from "./router.mjs";
import { sealedEntrypointGraphDigest } from "./sealed-entrypoint.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const PROVIDER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const CODEX_VERSION_PATTERN = /^codex-cli\s+(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$/;
const MIN_CODEX_VERSION = [0, 144, 0];
const DEFAULT_RUNTIME_TIMEOUT_MS = 600_000;
const MAX_RUNTIME_TIMEOUT_MS = 840_000;
const DEFAULT_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const SETTINGS_KEYS = new Set([
  "contract",
  "runtime_path",
  "runtime_digest",
  "runtime_physical_identity_digest",
  "runtime_root",
  "runtime_root_digest",
  "runtime_root_physical_identity_digest",
  "runtime_version",
  "model",
  "reviewer_mode",
  "output_schema_path",
  "output_schema_digest",
  "runtime_timeout_ms",
  "max_output_bytes",
  "skill_name",
  "skill_root",
  "skill_digest"
]);
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
const HOST_ADAPTER_TYPES = new Set([
  "kill-ai-slop-v1",
  "agent-json-v1",
  "skill-json-v1",
  "browser-json-v1",
  "manual-v1"
]);
const HOST_PERMISSION_SCOPES = new Set([
  "artifact:read",
  "evidence:write",
  "browser:control",
  "network:external"
]);
const RESERVED_PROVIDERS = new Set([
  "kill-ai-slop",
  "browser-evidence",
  "owner-approval",
  "project-design-system",
  "project-systemizer",
  "design-direction-agent",
  "design-direction-critic",
  "color-system-agent",
  "color-system-critic"
]);
const SKILL_ONLY_PROVIDERS = new Set(["anti-slop"]);
const runtimeProbeCache = new Map();

export const CODEX_REVIEW_ADAPTER_CONTRACT = "killsloprouter-codex-review-v1";

function requireValue(condition, message, exitCode = 2) {
  if (!condition) throw new RouterError(message, exitCode);
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function inside(candidate, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function runtimeTree(root, relative = "") {
  const directory = path.join(root, relative);
  const entries = fs.readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name));
  const manifest = [];
  for (const entry of entries) {
    const entryRelative = path.join(relative, entry.name);
    const absolute = path.join(root, entryRelative);
    const portablePath = entryRelative.split(path.sep).join("/");
    if (entry.isSymbolicLink()) {
      const target = fs.readlinkSync(absolute);
      const resolvedTarget = path.resolve(path.dirname(absolute), target);
      requireValue(inside(resolvedTarget, root),
        `Codex runtime symlink escapes its locked root: ${absolute}`, 4);
      requireValue(fs.existsSync(resolvedTarget),
        `Codex runtime symlink target is missing: ${absolute}`, 4);
      requireValue(inside(fs.realpathSync(resolvedTarget), root),
        `Codex runtime symlink resolves outside its locked root: ${absolute}`, 4);
      manifest.push({ type: "symlink", path: portablePath, target });
    } else if (entry.isDirectory()) {
      manifest.push({ type: "directory", path: portablePath });
      manifest.push(...runtimeTree(root, entryRelative));
    } else if (entry.isFile()) {
      manifest.push({
        type: "file",
        path: portablePath,
        bytes: fs.statSync(absolute).size,
        digest: hashArtifact(absolute)
      });
    } else {
      throw new RouterError(`unsupported entry in Codex runtime root: ${absolute}`, 4);
    }
  }
  return manifest;
}

function runtimeEntryIdentity(stat) {
  return {
    device: String(stat.dev),
    inode: String(stat.ino),
    links: String(stat.nlink),
    owner_uid: String(stat.uid),
    mode: Number(stat.mode & 0o777n),
    size: String(stat.size),
    mtime_ns: String(stat.mtimeNs),
    ctime_ns: String(stat.ctimeNs)
  };
}

function runtimePhysicalTree(root, relative = "") {
  const directory = path.join(root, relative);
  const entries = fs.readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name));
  const manifest = [];
  for (const entry of entries) {
    const entryRelative = path.join(relative, entry.name);
    const absolute = path.join(root, entryRelative);
    const portablePath = entryRelative.split(path.sep).join("/");
    const stat = fs.lstatSync(absolute, { bigint: true });
    if (entry.isSymbolicLink()) {
      const target = fs.readlinkSync(absolute);
      const resolvedTarget = path.resolve(path.dirname(absolute), target);
      requireValue(inside(resolvedTarget, root),
        `Codex runtime symlink escapes its locked root: ${absolute}`, 4);
      requireValue(fs.existsSync(resolvedTarget),
        `Codex runtime symlink target is missing: ${absolute}`, 4);
      requireValue(inside(fs.realpathSync(resolvedTarget), root),
        `Codex runtime symlink resolves outside its locked root: ${absolute}`, 4);
      manifest.push({
        type: "symlink",
        path: portablePath,
        target,
        identity: runtimeEntryIdentity(stat)
      });
    } else if (entry.isDirectory()) {
      manifest.push({ type: "directory", path: portablePath, identity: runtimeEntryIdentity(stat) });
      manifest.push(...runtimePhysicalTree(root, entryRelative));
    } else if (entry.isFile()) {
      manifest.push({ type: "file", path: portablePath, identity: runtimeEntryIdentity(stat) });
    } else {
      throw new RouterError(`unsupported entry in Codex runtime root: ${absolute}`, 4);
    }
  }
  return manifest;
}

export function codexRuntimeRootDigest(runtimeRoot) {
  const root = realDirectory(runtimeRoot, "Codex runtime root");
  return canonicalDigest({
    codex_runtime_root_digest_version: 1,
    entries: runtimeTree(root)
  });
}

export function codexRuntimeRootPhysicalIdentityDigest(runtimeRoot) {
  const root = realDirectory(runtimeRoot, "Codex runtime root");
  return canonicalDigest({
    codex_runtime_root_physical_identity_version: 1,
    root: runtimeEntryIdentity(fs.lstatSync(root, { bigint: true })),
    entries: runtimePhysicalTree(root)
  });
}

export function codexRuntimePhysicalIdentityDigest(runtimePath) {
  const runtime = realRegularFile(runtimePath, "Codex runtime");
  return canonicalDigest({
    codex_runtime_physical_identity_version: 1,
    identity: runtimeEntryIdentity(fs.lstatSync(runtime, { bigint: true }))
  });
}

function copyRuntimeTree(sourceRoot, destinationRoot, relative = "") {
  const sourceDirectory = path.join(sourceRoot, relative);
  const entries = fs.readdirSync(sourceDirectory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const entryRelative = path.join(relative, entry.name);
    const source = path.join(sourceRoot, entryRelative);
    const destination = path.join(destinationRoot, entryRelative);
    const sourceStat = fs.lstatSync(source);
    if (entry.isDirectory()) {
      fs.mkdirSync(destination, { mode: sourceStat.mode & 0o777 });
      copyRuntimeTree(sourceRoot, destinationRoot, entryRelative);
      fs.chmodSync(destination, sourceStat.mode & 0o777);
      continue;
    }
    if (entry.isFile()) {
      fs.copyFileSync(source, destination,
        fs.constants.COPYFILE_EXCL | (fs.constants.COPYFILE_FICLONE || 0));
      fs.chmodSync(destination, sourceStat.mode & 0o777);
      continue;
    }
    if (entry.isSymbolicLink()) {
      const target = fs.readlinkSync(source);
      const resolvedTarget = path.resolve(path.dirname(source), target);
      requireValue(inside(resolvedTarget, sourceRoot),
        `Codex runtime symlink escapes its locked root: ${source}`, 4);
      const sealedTarget = path.join(destinationRoot, path.relative(sourceRoot, resolvedTarget));
      const sealedLink = path.relative(path.dirname(destination), sealedTarget) || ".";
      fs.symlinkSync(sealedLink, destination);
      continue;
    }
    throw new RouterError(`unsupported entry in Codex runtime root: ${source}`, 4);
  }
}

export function createCodexRuntimeSeal({
  runtimeRoot,
  runtimePath,
  runtimeRootDigest,
  runtimeRootPhysicalIdentityDigest,
  runtimeDigest,
  runtimePhysicalIdentityDigest: expectedRuntimePhysicalIdentityDigest,
  faultInjector = null
}) {
  const sourceRoot = realDirectory(runtimeRoot, "Codex runtime root");
  const sourceRuntime = realRegularFile(runtimePath, "Codex runtime");
  requireValue(inside(sourceRuntime, sourceRoot),
    "Codex runtime must be inside its digest-locked runtime root", 4);
  const runtimeRelative = path.relative(sourceRoot, sourceRuntime);
  const before = {
    root_digest: codexRuntimeRootDigest(sourceRoot),
    root_physical_identity_digest: codexRuntimeRootPhysicalIdentityDigest(sourceRoot),
    runtime_digest: hashArtifact(sourceRuntime),
    runtime_physical_identity_digest: codexRuntimePhysicalIdentityDigest(sourceRuntime)
  };
  requireValue(before.root_digest === runtimeRootDigest,
    "official Codex runtime root digest mismatch before sealing", 4);
  requireValue(before.root_physical_identity_digest === runtimeRootPhysicalIdentityDigest,
    "official Codex runtime root physical identity mismatch before sealing", 4);
  requireValue(before.runtime_digest === runtimeDigest,
    "official Codex runtime digest mismatch before sealing", 4);
  requireValue(before.runtime_physical_identity_digest === expectedRuntimePhysicalIdentityDigest,
    "official Codex runtime physical identity mismatch before sealing", 4);

  const container = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-codex-runtime-"));
  fs.chmodSync(container, 0o700);
  const sealedRoot = path.join(container, "runtime");
  const sourceRootStat = fs.lstatSync(sourceRoot);
  fs.mkdirSync(sealedRoot, { mode: sourceRootStat.mode & 0o777 });
  let retained = false;
  try {
    copyRuntimeTree(sourceRoot, sealedRoot);
    fs.chmodSync(sealedRoot, sourceRootStat.mode & 0o777);
    faultInjector?.("after-codex-runtime-copy-before-source-revalidation", {
      runtime_path: sourceRuntime,
      runtime_root: sourceRoot,
      sealed_runtime_path: path.join(sealedRoot, runtimeRelative)
    });
    const after = {
      root_digest: codexRuntimeRootDigest(sourceRoot),
      root_physical_identity_digest: codexRuntimeRootPhysicalIdentityDigest(sourceRoot),
      runtime_digest: hashArtifact(sourceRuntime),
      runtime_physical_identity_digest: codexRuntimePhysicalIdentityDigest(sourceRuntime)
    };
    requireValue(canonicalDigest(after) === canonicalDigest(before),
      "official Codex runtime changed while its private execution seal was being created", 4);
    const sealedCanonicalRoot = realDirectory(sealedRoot, "sealed Codex runtime root");
    const sealedRuntime = realRegularFile(path.join(sealedRoot, runtimeRelative),
      "sealed Codex runtime");
    requireValue(codexRuntimeRootDigest(sealedCanonicalRoot) === runtimeRootDigest,
      "sealed Codex runtime root content does not match configured authority", 4);
    requireValue(hashArtifact(sealedRuntime) === runtimeDigest,
      "sealed Codex runtime content does not match configured authority", 4);
    const result = {
      runtimeRoot: sealedCanonicalRoot,
      runtimePath: sealedRuntime,
      sealedRuntimeRootPhysicalIdentityDigest:
        codexRuntimeRootPhysicalIdentityDigest(sealedCanonicalRoot),
      sealedRuntimePhysicalIdentityDigest: codexRuntimePhysicalIdentityDigest(sealedRuntime),
      cleanup() {
        fs.rmSync(container, { recursive: true, force: true });
      }
    };
    retained = true;
    return result;
  } finally {
    if (!retained) fs.rmSync(container, { recursive: true, force: true });
  }
}

export function verifyCodexRuntimeSeal(seal, settings) {
  requireValue(seal && typeof seal === "object",
    "official Codex runtime seal is missing at the child boundary", 4);
  const sealedRoot = realDirectory(seal.runtimeRoot, "sealed Codex runtime root");
  const sealedRuntime = realRegularFile(seal.runtimePath, "sealed Codex runtime");
  requireValue(inside(sealedRuntime, sealedRoot),
    "sealed Codex runtime escaped its private runtime root", 4);
  requireValue(codexRuntimeRootDigest(sealedRoot) === settings.runtime_root_digest,
    "sealed Codex runtime root content changed before child execution", 4);
  requireValue(codexRuntimeRootPhysicalIdentityDigest(sealedRoot) ===
    seal.sealedRuntimeRootPhysicalIdentityDigest,
  "sealed Codex runtime root physical identity changed before child execution", 4);
  requireValue(hashArtifact(sealedRuntime) === settings.runtime_digest,
    "sealed Codex runtime content changed before child execution", 4);
  requireValue(codexRuntimePhysicalIdentityDigest(sealedRuntime) ===
    seal.sealedRuntimePhysicalIdentityDigest,
  "sealed Codex runtime physical identity changed before child execution", 4);
  return {
    runtimeRoot: sealedRoot,
    runtimePath: sealedRuntime
  };
}

export function verifyOfficialCodexRuntimeSources(settings, expected = null) {
  const runtimeRoot = realDirectory(settings.runtime_root, "Codex runtime root");
  const runtimePath = realRegularFile(settings.runtime_path, "Codex runtime");
  requireValue(inside(runtimePath, runtimeRoot),
    "Codex runtime must be inside its digest-locked runtime root", 4);
  const observed = {
    runtimeRoot,
    runtimePath,
    runtimeRootDigest: codexRuntimeRootDigest(runtimeRoot),
    runtimeRootPhysicalIdentityDigest: codexRuntimeRootPhysicalIdentityDigest(runtimeRoot),
    runtimeDigest: hashArtifact(runtimePath),
    runtimePhysicalIdentityDigest: codexRuntimePhysicalIdentityDigest(runtimePath)
  };
  requireValue(observed.runtimeRootDigest === settings.runtime_root_digest,
    "official Codex runtime root changed at the final child boundary", 4);
  requireValue(observed.runtimeRootPhysicalIdentityDigest ===
    settings.runtime_root_physical_identity_digest,
  "official Codex runtime root physical identity changed at the final child boundary", 4);
  requireValue(observed.runtimeDigest === settings.runtime_digest,
    "official Codex runtime changed at the final child boundary", 4);
  requireValue(observed.runtimePhysicalIdentityDigest ===
    settings.runtime_physical_identity_digest,
  "official Codex runtime physical identity changed at the final child boundary", 4);
  if (expected) {
    requireValue(observed.runtimeRoot === expected.sourceRuntimeRoot &&
      observed.runtimePath === expected.sourceRuntimePath,
    "official Codex runtime path authority changed before child execution", 4);
    requireValue(observed.runtimeRootPhysicalIdentityDigest ===
      expected.sourceRuntimeRootPhysicalIdentityDigest &&
      observed.runtimePhysicalIdentityDigest === expected.sourceRuntimePhysicalIdentityDigest,
    "official Codex runtime physical authority changed before child execution", 4);
  }
  return observed;
}

function resolveFromManifest(value, manifestPath) {
  if (!value) return null;
  return path.isAbsolute(value)
    ? path.resolve(value)
    : path.resolve(path.dirname(path.resolve(manifestPath)), value);
}

function safeJsonFile(file, label) {
  const absolute = path.resolve(file);
  requireValue(fs.existsSync(absolute), `${label} is missing: ${absolute}`, 4);
  const stat = fs.lstatSync(absolute);
  requireValue(stat.isFile() && !stat.isSymbolicLink(), `${label} must be a regular non-symlink file`, 4);
  return { absolute: fs.realpathSync(absolute), value: readJson(absolute, label) };
}

function realRegularFile(file, label) {
  const absolute = path.resolve(file);
  requireValue(fs.existsSync(absolute), `${label} is missing: ${absolute}`, 4);
  const real = fs.realpathSync(absolute);
  const stat = fs.lstatSync(real);
  requireValue(stat.isFile() && !stat.isSymbolicLink(), `${label} must be a regular non-symlink file`, 4);
  return real;
}

function realDirectory(directory, label) {
  const absolute = path.resolve(directory);
  requireValue(fs.existsSync(absolute), `${label} is missing: ${absolute}`, 4);
  const real = fs.realpathSync(absolute);
  const stat = fs.lstatSync(real);
  requireValue(stat.isDirectory() && !stat.isSymbolicLink(), `${label} must be a real non-symlink directory`, 4);
  return real;
}

function backupFile(file) {
  const backup = `${file}.bak.${new Date().toISOString().replace(/[-:.]/g, "")}-${crypto.randomUUID()}`;
  fs.copyFileSync(file, backup, fs.constants.COPYFILE_EXCL);
  return backup;
}

function versionAtLeast(version, minimum) {
  for (let index = 0; index < minimum.length; index += 1) {
    if (version[index] > minimum[index]) return true;
    if (version[index] < minimum[index]) return false;
  }
  return true;
}

export function codexReviewAdapterPath() {
  return path.join(packageRoot, "src", "adapters", "codex-review.mjs");
}

export function codexReviewOutputSchemaPath() {
  return path.join(packageRoot, "schemas", "codex-review-output.schema.json");
}

function sourceCodexHome() {
  return path.resolve(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"));
}

export function createIsolatedCodexHome() {
  const sourceHome = sourceCodexHome();
  const sourceAuth = path.join(sourceHome, "auth.json");
  if (!fs.existsSync(sourceAuth)) {
    return {
      status: "manual_pending",
      reason: "Codex authentication is unavailable: the host auth.json is missing"
    };
  }
  const authStat = fs.lstatSync(sourceAuth);
  if (!authStat.isFile() || authStat.isSymbolicLink()) {
    return {
      status: "manual_pending",
      reason: "Codex authentication is unavailable: auth.json must be a regular non-symlink file"
    };
  }
  const isolatedHome = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-codex-home-"));
  fs.chmodSync(isolatedHome, 0o700);
  const isolatedAuth = path.join(isolatedHome, "auth.json");
  try {
    try {
      fs.symlinkSync(sourceAuth, isolatedAuth, "file");
    } catch {
      fs.linkSync(sourceAuth, isolatedAuth);
    }
  } catch (error) {
    fs.rmSync(isolatedHome, { recursive: true, force: true });
    return {
      status: "manual_pending",
      reason: `Codex authentication isolation is unavailable: ${error.message}`
    };
  }
  return {
    status: "ready",
    path: isolatedHome,
    cleanup() {
      fs.rmSync(isolatedHome, { recursive: true, force: true });
    }
  };
}

export function codexRuntimeEnvironment({ isolatedHome = null } = {}) {
  const environment = {
    PATH: process.env.PATH || ""
  };
  if (isolatedHome) {
    environment.CODEX_HOME = isolatedHome;
    environment.HOME = isolatedHome;
    return environment;
  }
  if (process.env.CODEX_HOME) environment.CODEX_HOME = process.env.CODEX_HOME;
  if (process.env.HOME) environment.HOME = process.env.HOME;
  return environment;
}

function runtimeVersion(runtimePath) {
  const result = spawnSync(runtimePath, ["--version"], {
    encoding: "utf8",
    shell: false,
    timeout: 10_000,
    maxBuffer: 1024 * 1024,
    env: codexRuntimeEnvironment()
  });
  requireValue(!result.error && result.status === 0,
    `Codex runtime version probe failed: ${result.error?.message || result.stderr?.trim() || result.status}`, 4);
  const value = result.stdout.trim();
  const match = value.match(CODEX_VERSION_PATTERN);
  requireValue(match, `unsupported Codex runtime version output: ${value || "empty"}`, 4);
  const version = match.slice(1, 4).map(Number);
  requireValue(versionAtLeast(version, MIN_CODEX_VERSION),
    `Codex runtime ${value} is older than required codex-cli ${MIN_CODEX_VERSION.join(".")}`, 4);
  return value;
}

function authenticationProbeIdentity() {
  const authPath = path.join(sourceCodexHome(), "auth.json");
  let stat;
  try {
    stat = fs.lstatSync(authPath, { bigint: true });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return canonicalDigest({
        codex_auth_probe_identity_version: 1,
        path: authPath,
        state: "missing"
      });
    }
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    return canonicalDigest({
      codex_auth_probe_identity_version: 1,
      path: authPath,
      state: "unsupported",
      device: String(stat.dev),
      inode: String(stat.ino),
      links: String(stat.nlink),
      mode: String(stat.mode),
      size: String(stat.size),
      mtime_ns: String(stat.mtimeNs),
      ctime_ns: String(stat.ctimeNs)
    });
  }
  const pinned = readFilePinned(authPath, {
    label: "Codex authentication readiness source",
    requireCallerOwned: false,
    requireSingleLink: false
  });
  return canonicalDigest({
    codex_auth_probe_identity_version: 1,
    path: authPath,
    state: "regular-file",
    content_digest: pinned.digest,
    device: pinned.file_identity.device,
    inode: pinned.file_identity.inode,
    owner_uid: pinned.file_identity.owner_uid,
    mode: String(pinned.file_identity.mode),
    size: pinned.file_identity.size,
    mtime_ns: pinned.file_identity.mtime_ns
  });
}

function probeRuntime(runtimePath, runtimeAuthorityDigest) {
  const authIdentityBefore = authenticationProbeIdentity();
  const cacheKey = `${runtimeAuthorityDigest}\n${authIdentityBefore}`;
  if (runtimeProbeCache.has(cacheKey)) return runtimeProbeCache.get(cacheKey);
  const version = runtimeVersion(runtimePath);
  const isolated = createIsolatedCodexHome();
  if (isolated.status !== "ready") {
    const result = { version, authenticated: false, auth_reason: isolated.reason };
    if (authenticationProbeIdentity() === authIdentityBefore) {
      runtimeProbeCache.set(cacheKey, result);
    }
    return result;
  }
  let auth;
  try {
    auth = spawnSync(runtimePath, ["login", "status"], {
      encoding: "utf8",
      shell: false,
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
      env: codexRuntimeEnvironment({ isolatedHome: isolated.path })
    });
  } finally {
    isolated.cleanup();
  }
  const authOutput = `${auth.stdout || ""}\n${auth.stderr || ""}`;
  const authenticated = !auth.error && auth.status === 0 && /^Logged in\b/m.test(authOutput);
  const result = {
    version,
    authenticated,
    auth_reason: authenticated
      ? null
      : auth.error?.message || auth.stderr?.trim() || auth.stdout?.trim() || "Codex authentication is unavailable"
  };
  const authIdentityAfter = authenticationProbeIdentity();
  if (authIdentityAfter !== authIdentityBefore) {
    return {
      version,
      authenticated: false,
      auth_reason: "Codex authentication authority changed during the readiness probe"
    };
  }
  runtimeProbeCache.set(cacheKey, result);
  return result;
}

function inferRuntimeRoot(runtimePath) {
  const binDirectory = path.dirname(runtimePath);
  const candidate = path.basename(binDirectory) === "bin" ? path.dirname(binDirectory) : binDirectory;
  return candidate;
}

function validateRuntimeBoundary(runtimeRoot) {
  const root = path.resolve(runtimeRoot);
  requireValue(root !== path.parse(root).root,
    "Codex runtime root cannot be a filesystem root", 4);
  const authPath = path.join(sourceCodexHome(), "auth.json");
  requireValue(!inside(authPath, root),
    "Codex runtime root cannot contain the host authentication store", 4);
}

function providerContract(router, profile, providerId) {
  const fallback = Object.values(profile.fallback_adapters || {})
    .flat()
    .find((candidate) => candidate?.id === providerId);
  const routed = router.provider_capabilities?.[providerId] || null;
  const local = profile.local_adapters?.[providerId];
  const external = profile.external_adapters?.[providerId];
  const declared = [fallback, local, external].find((candidate) =>
    candidate && typeof candidate === "object" && Array.isArray(candidate.capabilities));
  const contract = declared || routed;
  requireValue(contract, `provider has no capability contract: ${providerId}`);
  requireValue(Number.isInteger(contract.strength) && contract.strength >= 1 && contract.strength <= 4,
    `provider ${providerId} has no valid strength contract`);
  requireValue(Array.isArray(contract.capabilities) && contract.capabilities.length > 0,
    `provider ${providerId} has no capability contract`);
  return {
    strength: contract.strength,
    capabilities: unique(contract.capabilities),
    independent_from_creator: Boolean(contract.independent_from_creator || routed?.independent_from_creator)
  };
}

function validateHostDocument(host) {
  requireValue(host?.host_adapter_version === 1, "host_adapter_version must be 1");
  for (const key of Object.keys(host || {})) {
    requireValue(HOST_KEYS.has(key), `host manifest contains unsupported field: ${key}`);
  }
  requireValue(Array.isArray(host.allowed_providers) && host.allowed_providers.length > 0,
    "host manifest requires allowed_providers");
  requireValue(new Set(host.allowed_providers).size === host.allowed_providers.length,
    "host manifest allowed_providers contains duplicates");
  requireValue(Array.isArray(host.granted_permissions), "host manifest requires granted_permissions");
  requireValue(new Set(host.granted_permissions).size === host.granted_permissions.length,
    "host manifest granted_permissions contains duplicates");
  for (const permission of host.granted_permissions) {
    requireValue(HOST_PERMISSION_SCOPES.has(permission),
      `host manifest contains unsupported permission: ${permission}`);
  }
  requireValue(host.providers && typeof host.providers === "object" && !Array.isArray(host.providers),
    "host manifest requires providers");
  for (const [providerId, declaration] of Object.entries(host.providers)) {
    requireValue(host.allowed_providers.includes(providerId),
      `host provider ${providerId} is configured but not allowlisted`);
    requireValue(declaration && typeof declaration === "object" && !Array.isArray(declaration),
      `host provider ${providerId} must be an object`);
    for (const key of Object.keys(declaration)) {
      requireValue(PROVIDER_KEYS.has(key),
        `host provider ${providerId} contains unsupported field: ${key}`);
    }
    requireValue(HOST_ADAPTER_TYPES.has(declaration.adapter),
      `host provider ${providerId} has unsupported adapter: ${declaration.adapter || "missing"}`);
    requireValue(Number.isInteger(declaration.strength) && declaration.strength >= 1 &&
      declaration.strength <= 4,
    `host provider ${providerId} strength must be an integer from 1 to 4`);
    requireValue(Array.isArray(declaration.capabilities) && declaration.capabilities.length > 0 &&
      new Set(declaration.capabilities).size === declaration.capabilities.length,
    `host provider ${providerId} requires unique capabilities`);
    requireValue(Array.isArray(declaration.permissions) &&
      new Set(declaration.permissions).size === declaration.permissions.length,
    `host provider ${providerId} permissions must be unique`);
    for (const permission of declaration.permissions) {
      requireValue(HOST_PERMISSION_SCOPES.has(permission),
        `host provider ${providerId} contains unsupported permission: ${permission}`);
      requireValue(host.granted_permissions.includes(permission),
        `host provider ${providerId} requests ungranted permission: ${permission}`);
    }
    requireValue(declaration.settings === undefined || (
      declaration.settings && typeof declaration.settings === "object" && !Array.isArray(declaration.settings)
    ), `host provider ${providerId} settings must be an object`);
  }
  return host;
}

export function validateOfficialCodexSettings(settings, {
  entrypoint,
  adapterType,
  permissionScopes = [],
  manifestPath = process.cwd(),
  probeAuthentication = true,
  retainRuntimeSeal = false
} = {}) {
  requireValue(settings?.contract === CODEX_REVIEW_ADAPTER_CONTRACT,
    `official Codex adapter requires settings.contract ${CODEX_REVIEW_ADAPTER_CONTRACT}`);
  for (const key of Object.keys(settings)) {
    requireValue(SETTINGS_KEYS.has(key), `official Codex settings contain unsupported field: ${key}`);
  }
  requireValue(["agent-json-v1", "skill-json-v1"].includes(adapterType),
    "official Codex review requires agent-json-v1 or skill-json-v1");
  const expectedEntrypoint = realRegularFile(codexReviewAdapterPath(), "official Codex review adapter");
  requireValue(realRegularFile(entrypoint, "Codex review adapter entrypoint") === expectedEntrypoint,
    "official Codex contract must use the bundled adapter entrypoint", 4);
  requireValue(permissionScopes.includes("artifact:read"),
    "official Codex review requires artifact:read permission", 4);
  requireValue(permissionScopes.includes("network:external"),
    "official Codex review requires network:external permission", 4);
  requireValue(!permissionScopes.includes("browser:control"),
    "official Codex review cannot receive browser:control permission", 4);

  requireValue(typeof settings.runtime_path === "string" && settings.runtime_path.length > 0,
    "official Codex settings require runtime_path");
  requireValue(path.isAbsolute(settings.runtime_path),
    "official Codex runtime_path must be absolute");
  requireValue(DIGEST_PATTERN.test(settings.runtime_digest || ""),
    "official Codex settings require runtime_digest");
  requireValue(DIGEST_PATTERN.test(settings.runtime_physical_identity_digest || ""),
    "official Codex settings require runtime_physical_identity_digest");
  requireValue(typeof settings.runtime_root === "string" && settings.runtime_root.length > 0,
    "official Codex settings require runtime_root");
  requireValue(path.isAbsolute(settings.runtime_root),
    "official Codex runtime_root must be absolute");
  requireValue(DIGEST_PATTERN.test(settings.runtime_root_digest || ""),
    "official Codex settings require runtime_root_digest");
  requireValue(DIGEST_PATTERN.test(settings.runtime_root_physical_identity_digest || ""),
    "official Codex settings require runtime_root_physical_identity_digest");
  requireValue(typeof settings.runtime_version === "string" && CODEX_VERSION_PATTERN.test(settings.runtime_version),
    "official Codex settings require a codex-cli runtime_version");
  requireValue(MODEL_PATTERN.test(settings.model || ""),
    "official Codex settings require a safe explicit model name");
  requireValue(settings.reviewer_mode === (adapterType === "skill-json-v1" ? "skill" : "agent"),
    `official Codex reviewer_mode does not match ${adapterType}`);
  requireValue(Number.isInteger(settings.runtime_timeout_ms) && settings.runtime_timeout_ms >= 10_000 &&
    settings.runtime_timeout_ms <= MAX_RUNTIME_TIMEOUT_MS,
  `official Codex runtime_timeout_ms must be between 10000 and ${MAX_RUNTIME_TIMEOUT_MS}`);
  requireValue(Number.isInteger(settings.max_output_bytes) && settings.max_output_bytes >= 1024 &&
    settings.max_output_bytes <= MAX_OUTPUT_BYTES,
  `official Codex max_output_bytes must be between 1024 and ${MAX_OUTPUT_BYTES}`);

  const outputSchema = resolveFromManifest(settings.output_schema_path, manifestPath);
  requireValue(path.isAbsolute(settings.output_schema_path || ""),
    "official Codex output_schema_path must be absolute");
  const expectedSchema = realRegularFile(codexReviewOutputSchemaPath(), "official Codex output schema");
  requireValue(outputSchema && fs.existsSync(outputSchema),
    `official Codex output schema is missing: ${outputSchema || "unconfigured"}`, 4);
  requireValue(realRegularFile(outputSchema, "Codex output schema") === expectedSchema,
    "official Codex contract must use the bundled output schema", 4);
  requireValue(DIGEST_PATTERN.test(settings.output_schema_digest || "") &&
    hashArtifact(outputSchema) === settings.output_schema_digest,
  "official Codex output schema digest mismatch", 4);

  const runtimePath = resolveFromManifest(settings.runtime_path, manifestPath);
  const runtimeRoot = resolveFromManifest(settings.runtime_root, manifestPath);
  if (!runtimePath || !runtimeRoot || !fs.existsSync(runtimePath) || !fs.existsSync(runtimeRoot)) {
    return {
      runtimePath,
      runtimeRoot,
      outputSchema,
      skillRoot: null,
      readiness: {
        status: "manual_pending",
        reason: "official Codex runtime is missing"
      }
    };
  }

  const realRoot = realDirectory(runtimeRoot, "Codex runtime root");
  validateRuntimeBoundary(realRoot);
  const realRuntime = realRegularFile(runtimePath, "Codex runtime");
  requireValue(inside(realRuntime, realRoot), "Codex runtime must be inside its digest-locked runtime root", 4);
  requireValue(codexRuntimeRootDigest(realRoot) === settings.runtime_root_digest,
    "official Codex runtime root digest mismatch", 4);
  requireValue(codexRuntimeRootPhysicalIdentityDigest(realRoot) ===
    settings.runtime_root_physical_identity_digest,
  "official Codex runtime root physical identity mismatch", 4);
  requireValue(hashArtifact(realRuntime) === settings.runtime_digest,
    "official Codex runtime digest mismatch", 4);
  requireValue(codexRuntimePhysicalIdentityDigest(realRuntime) ===
    settings.runtime_physical_identity_digest,
  "official Codex runtime physical identity mismatch", 4);
  try {
    fs.accessSync(realRuntime, fs.constants.X_OK);
  } catch {
    return {
      runtimePath: realRuntime,
      runtimeRoot: realRoot,
      outputSchema,
      skillRoot: null,
      readiness: { status: "manual_pending", reason: "official Codex runtime is not executable" }
    };
  }

  let skillRoot = null;
  if (adapterType === "skill-json-v1") {
    requireValue(PROVIDER_ID_PATTERN.test(settings.skill_name || ""),
      "official Codex skill reviewer requires a safe skill_name");
    requireValue(typeof settings.skill_root === "string" && settings.skill_root.length > 0,
      "official Codex skill reviewer requires skill_root");
    requireValue(path.isAbsolute(settings.skill_root),
      "official Codex skill_root must be absolute");
    requireValue(DIGEST_PATTERN.test(settings.skill_digest || ""),
      "official Codex skill reviewer requires skill_digest");
    const configuredSkillRoot = resolveFromManifest(settings.skill_root, manifestPath);
    if (!configuredSkillRoot || !fs.existsSync(configuredSkillRoot)) {
      return {
        runtimePath: realRuntime,
        runtimeRoot: realRoot,
        outputSchema,
        skillRoot: configuredSkillRoot,
        readiness: { status: "manual_pending", reason: `Codex review skill is missing: ${settings.skill_name}` }
      };
    }
    skillRoot = realDirectory(configuredSkillRoot, `Codex review skill ${settings.skill_name}`);
    requireValue(fs.existsSync(path.join(skillRoot, "SKILL.md")),
      `Codex review skill ${settings.skill_name} is missing SKILL.md`, 4);
    requireValue(hashArtifact(skillRoot, { ignores: [] }) === settings.skill_digest,
      `Codex review skill digest mismatch: ${settings.skill_name}`, 4);
  } else {
    requireValue(settings.skill_name === undefined && settings.skill_root === undefined &&
      settings.skill_digest === undefined,
    "official Codex agent reviewer cannot declare skill settings");
  }

  const probeCacheIdentity = canonicalDigest({
    runtime_digest: settings.runtime_digest,
    runtime_physical_identity_digest: settings.runtime_physical_identity_digest,
    runtime_root_digest: settings.runtime_root_digest,
    runtime_root_physical_identity_digest: settings.runtime_root_physical_identity_digest
  });

  // Manifest validation is read-only readiness inspection. The source runtime
  // was content- and physical-identity checked above, and the adapter creates a
  // retained private seal at the actual child boundary. Cloning the complete
  // runtime here would repeat once per configured provider even when the probe
  // result is cached.
  if (!retainRuntimeSeal) {
    const probe = probeAuthentication
      ? probeRuntime(realRuntime, probeCacheIdentity)
      : { version: runtimeVersion(realRuntime), authenticated: true, auth_reason: null };
    requireValue(probe.version === settings.runtime_version,
      `official Codex runtime version changed: expected ${settings.runtime_version}, got ${probe.version}`, 4);
    return {
      runtimePath: realRuntime,
      runtimeRoot: realRoot,
      sourceRuntimePath: realRuntime,
      sourceRuntimeRoot: realRoot,
      sourceRuntimePhysicalIdentityDigest: settings.runtime_physical_identity_digest,
      sourceRuntimeRootPhysicalIdentityDigest: settings.runtime_root_physical_identity_digest,
      outputSchema,
      skillRoot,
      readiness: probe.authenticated
        ? { status: "ready", reason: null }
        : { status: "manual_pending", reason: `Codex authentication is unavailable: ${probe.auth_reason}` }
    };
  }

  const runtimeSeal = createCodexRuntimeSeal({
    runtimeRoot: realRoot,
    runtimePath: realRuntime,
    runtimeRootDigest: settings.runtime_root_digest,
    runtimeRootPhysicalIdentityDigest: settings.runtime_root_physical_identity_digest,
    runtimeDigest: settings.runtime_digest,
    runtimePhysicalIdentityDigest: settings.runtime_physical_identity_digest
  });
  try {
    const probe = probeAuthentication
      ? probeRuntime(runtimeSeal.runtimePath, probeCacheIdentity)
      : { version: runtimeVersion(runtimeSeal.runtimePath), authenticated: true, auth_reason: null };
    requireValue(probe.version === settings.runtime_version,
      `official Codex runtime version changed: expected ${settings.runtime_version}, got ${probe.version}`, 4);
    return {
      runtimePath: runtimeSeal.runtimePath,
      runtimeRoot: runtimeSeal.runtimeRoot,
      sourceRuntimePath: realRuntime,
      sourceRuntimeRoot: realRoot,
      sourceRuntimePhysicalIdentityDigest: settings.runtime_physical_identity_digest,
      sourceRuntimeRootPhysicalIdentityDigest: settings.runtime_root_physical_identity_digest,
      sealedRuntimePhysicalIdentityDigest: runtimeSeal.sealedRuntimePhysicalIdentityDigest,
      sealedRuntimeRootPhysicalIdentityDigest: runtimeSeal.sealedRuntimeRootPhysicalIdentityDigest,
      outputSchema,
      skillRoot,
      readiness: probe.authenticated
        ? { status: "ready", reason: null }
        : { status: "manual_pending", reason: `Codex authentication is unavailable: ${probe.auth_reason}` },
      cleanup: runtimeSeal.cleanup
    };
  } catch (error) {
    runtimeSeal.cleanup();
    throw error;
  }
}

export function configureCodexReviewers({
  router,
  profilePath,
  hostManifestPath,
  runtimePath,
  runtimeRoot = null,
  model,
  agentProviders = [],
  skillProviders = [],
  allowExternal = false,
  replace = false,
  runtimeTimeoutMs = DEFAULT_RUNTIME_TIMEOUT_MS,
  maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES
}) {
  requireValue(allowExternal,
    "Codex review sends artifact context to an external model and requires explicit --allow-external");
  requireValue(MODEL_PATTERN.test(model || ""), "host configure-codex requires a safe explicit --model");
  requireValue(Number.isInteger(runtimeTimeoutMs) && runtimeTimeoutMs >= 10_000 &&
    runtimeTimeoutMs <= MAX_RUNTIME_TIMEOUT_MS,
  `Codex runtime timeout must be between 10000 and ${MAX_RUNTIME_TIMEOUT_MS}`);
  requireValue(Number.isInteger(maxOutputBytes) && maxOutputBytes >= 1024 && maxOutputBytes <= MAX_OUTPUT_BYTES,
    `Codex max output bytes must be between 1024 and ${MAX_OUTPUT_BYTES}`);
  const profileSource = safeJsonFile(profilePath, "project profile");
  const hostSource = safeJsonFile(hostManifestPath, "host adapter manifest");
  validateProfile(profileSource.value);
  validateHostDocument(hostSource.value);

  const resolvedRuntime = realRegularFile(runtimePath, "Codex runtime");
  const resolvedRuntimeRoot = realDirectory(runtimeRoot || inferRuntimeRoot(resolvedRuntime), "Codex runtime root");
  validateRuntimeBoundary(resolvedRuntimeRoot);
  requireValue(inside(resolvedRuntime, resolvedRuntimeRoot),
    "Codex runtime must be inside --runtime-root", 4);
  const outputSchema = realRegularFile(codexReviewOutputSchemaPath(), "official Codex output schema");
  const entrypoint = realRegularFile(codexReviewAdapterPath(), "official Codex review adapter");

  const normalizedAgents = unique(agentProviders.map((providerId) => String(providerId).trim()));
  const normalizedSkills = skillProviders.map((binding) => ({
    providerId: String(binding.providerId || "").trim(),
    skillRoot: realDirectory(binding.skillRoot, `Codex review skill ${binding.providerId}`)
  }));
  const providerIds = [...normalizedAgents, ...normalizedSkills.map((binding) => binding.providerId)];
  requireValue(providerIds.length > 0,
    "host configure-codex requires --agent-providers or at least one --skill-provider");
  requireValue(new Set(providerIds).size === providerIds.length,
    "Codex reviewer providers must be unique across agent and skill bindings");
  for (const providerId of normalizedAgents) {
    requireValue(!SKILL_ONLY_PROVIDERS.has(providerId),
      `provider ${providerId} is a Router-scoped skill critic; bind it with --skill-provider ${providerId}=/absolute/skill/root`);
  }
  for (const providerId of providerIds) {
    requireValue(PROVIDER_ID_PATTERN.test(providerId), `invalid Codex reviewer provider ID: ${providerId}`);
    requireValue(!RESERVED_PROVIDERS.has(providerId),
      `provider ${providerId} requires its dedicated manual, scanner, browser, owner, or design adapter`);
  }
  for (const binding of normalizedSkills) {
    requireValue(fs.existsSync(path.join(binding.skillRoot, "SKILL.md")),
      `Codex review skill ${binding.providerId} is missing SKILL.md`);
  }

  const runtimeDigest = hashArtifact(resolvedRuntime);
  const runtimeRootDigest = codexRuntimeRootDigest(resolvedRuntimeRoot);
  const runtimePhysicalIdentityDigest = codexRuntimePhysicalIdentityDigest(resolvedRuntime);
  const runtimeRootPhysicalIdentityDigest =
    codexRuntimeRootPhysicalIdentityDigest(resolvedRuntimeRoot);
  const configurationSeal = createCodexRuntimeSeal({
    runtimeRoot: resolvedRuntimeRoot,
    runtimePath: resolvedRuntime,
    runtimeRootDigest,
    runtimeRootPhysicalIdentityDigest,
    runtimeDigest,
    runtimePhysicalIdentityDigest
  });
  let version;
  try {
    version = runtimeVersion(configurationSeal.runtimePath);
  } finally {
    configurationSeal.cleanup();
  }
  const outputSchemaDigest = hashArtifact(outputSchema);
  const entrypointDigest = hashArtifact(entrypoint);
  const entrypointGraphDigest = sealedEntrypointGraphDigest(entrypoint, {
    trustedPackageRoot: packageRoot
  });
  const host = structuredClone(hostSource.value);
  host.allowed_providers = unique([...(host.allowed_providers || []), ...providerIds]);
  host.granted_permissions = unique([
    ...(host.granted_permissions || []),
    "artifact:read",
    "network:external"
  ]);
  host.providers ||= {};
  const configuredProviders = [];

  for (const providerId of providerIds) {
    const current = host.providers[providerId];
    const sameOfficialContract = current?.settings?.contract === CODEX_REVIEW_ADAPTER_CONTRACT;
    requireValue(!current || current.adapter === "manual-v1" || sameOfficialContract || replace,
      `provider ${providerId} already has a non-manual adapter; rerun with --replace to replace it`);
    const contract = providerContract(router, profileSource.value, providerId);
    const skillBinding = normalizedSkills.find((binding) => binding.providerId === providerId);
    const adapter = skillBinding ? "skill-json-v1" : "agent-json-v1";
    const permissions = ["artifact:read", "network:external"];
    const settings = {
      contract: CODEX_REVIEW_ADAPTER_CONTRACT,
      runtime_path: resolvedRuntime,
      runtime_digest: runtimeDigest,
      runtime_physical_identity_digest: runtimePhysicalIdentityDigest,
      runtime_root: resolvedRuntimeRoot,
      runtime_root_digest: runtimeRootDigest,
      runtime_root_physical_identity_digest: runtimeRootPhysicalIdentityDigest,
      runtime_version: version,
      model,
      reviewer_mode: skillBinding ? "skill" : "agent",
      output_schema_path: outputSchema,
      output_schema_digest: outputSchemaDigest,
      runtime_timeout_ms: runtimeTimeoutMs,
      max_output_bytes: maxOutputBytes,
      ...(skillBinding ? {
        skill_name: providerId,
        skill_root: skillBinding.skillRoot,
        skill_digest: hashArtifact(skillBinding.skillRoot, { ignores: [] })
      } : {})
    };
    const declaration = {
      adapter,
      entrypoint,
      entrypoint_digest: entrypointDigest,
      entrypoint_graph_digest: entrypointGraphDigest,
      strength: contract.strength,
      capabilities: contract.capabilities,
      permissions,
      timeout_ms: Math.min(runtimeTimeoutMs + 30_000, 900_000),
      settings
    };
    const inspection = validateOfficialCodexSettings(settings, {
      entrypoint,
      adapterType: adapter,
      permissionScopes: permissions,
      manifestPath: hostSource.absolute
    });
    host.providers[providerId] = declaration;
    configuredProviders.push({
      provider_id: providerId,
      adapter,
      strength: contract.strength,
      capabilities: contract.capabilities,
      independent_from_creator: contract.independent_from_creator,
      skill_digest: settings.skill_digest || null,
      readiness: inspection.readiness
    });
  }
  validateHostDocument(host);

  const hostBackup = backupFile(hostSource.absolute);
  const configDirectory = path.dirname(profileSource.absolute);
  const receiptPath = path.join(configDirectory, "codex-host-setup-receipt.json");
  const receiptBackup = fs.existsSync(receiptPath) ? backupFile(receiptPath) : null;
  try {
    writeJsonAtomic(hostSource.absolute, host);
    const pending = configuredProviders.find((provider) => provider.readiness.status !== "ready");
    const receiptBody = {
      codex_host_setup_receipt_version: 1,
      status: pending ? "manual_pending" : "configured",
      generated_at: new Date().toISOString(),
      profile: { path: profileSource.absolute, digest: hashArtifact(profileSource.absolute) },
      host_manifest: {
        path: hostSource.absolute,
        digest: hashArtifact(hostSource.absolute),
        backup: hostBackup
      },
      adapter: {
        contract: CODEX_REVIEW_ADAPTER_CONTRACT,
        entrypoint,
        entrypoint_digest: entrypointDigest,
        entrypoint_graph_digest: entrypointGraphDigest,
        output_schema: outputSchema,
        output_schema_digest: outputSchemaDigest
      },
      runtime: {
        path: resolvedRuntime,
        digest: runtimeDigest,
        physical_identity_digest: runtimePhysicalIdentityDigest,
        root: resolvedRuntimeRoot,
        root_digest: runtimeRootDigest,
        root_physical_identity_digest: runtimeRootPhysicalIdentityDigest,
        version,
        model,
        sandbox: "read-only",
        ephemeral: true
      },
      providers: configuredProviders,
      privacy: {
        external_network_explicitly_granted: true,
        credentials_stored: false,
        project_profile_commands_executed: false,
        browser_or_owner_gate_substitution: false
      },
      pending_reason: pending?.readiness.reason || null,
      receipt_path: receiptPath,
      ...(receiptBackup ? { previous_receipt_backup: receiptBackup } : {})
    };
    const receipt = {
      ...receiptBody,
      receipt_digest: canonicalDigest(receiptBody)
    };
    writeJsonAtomic(receiptPath, receipt);
    return receipt;
  } catch (error) {
    fs.copyFileSync(hostBackup, hostSource.absolute);
    if (receiptBackup) fs.copyFileSync(receiptBackup, receiptPath);
    throw error;
  }
}
