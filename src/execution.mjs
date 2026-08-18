import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runKillAiSlop, findKillAiSlopScanner } from "./adapters/kill-ai-slop.mjs";
import { hashArtifact, publicSnapshot, sha256, snapshotArtifact } from "./integrity.mjs";
import { RouterError } from "./router.mjs";
import {
  PLAYWRIGHT_ADAPTER_CONTRACT,
  PLAYWRIGHT_SUPPORTED_CHECKS,
  validateOfficialPlaywrightSettings
} from "./playwright.mjs";

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
  "network:external"
]);

const PROCESS_ADAPTERS = new Set(["agent-json-v1", "skill-json-v1", "browser-json-v1"]);
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
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

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function inside(candidate, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
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

function validateProviderDeclaration(providerId, declaration, config, manifestPath) {
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
    const actualDigest = hashArtifact(entrypoint);
    requireValue(actualDigest === declaration.entrypoint_digest,
      `host provider ${providerId} entrypoint digest mismatch`, 4);
  }

  const timeoutMs = declaration.timeout_ms ?? DEFAULT_TIMEOUT_MS;
  requireValue(Number.isInteger(timeoutMs) && timeoutMs >= 100 && timeoutMs <= MAX_TIMEOUT_MS,
    `host provider ${providerId} timeout_ms must be between 100 and ${MAX_TIMEOUT_MS}`);
  requireValue(declaration.settings === undefined || (
    declaration.settings && typeof declaration.settings === "object" && !Array.isArray(declaration.settings)
  ), `host provider ${providerId} settings must be an object`);
  if (declaration.adapter === "browser-json-v1" &&
    declaration.settings?.contract === PLAYWRIGHT_ADAPTER_CONTRACT) {
    validateOfficialPlaywrightSettings(declaration.settings, {
      entrypoint,
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
    adapter_root: adapterRoot,
    timeout_ms: timeoutMs,
    settings: declaration.settings || {}
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
  try {
    source = fs.readFileSync(absolute, "utf8");
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
  const providers = Object.fromEntries(Object.entries(raw.providers).map(([providerId, declaration]) => [
    providerId,
    validateProviderDeclaration(providerId, declaration, base, absolute)
  ]));
  return {
    host_adapter_version: 1,
    manifest_path: absolute,
    manifest_digest: sha256(source),
    allowed_providers: allowedProviders,
    granted_permissions: grantedPermissions,
    providers
  };
}

function manualPending(packet, reason, manifest = null) {
  return {
    execution_status: "manual_pending",
    packet_id: packet.packet_id,
    provider_id: packet.provider.id,
    adapter: null,
    host_manifest_digest: manifest?.manifest_digest || null,
    reason
  };
}

export function inspectPacketAdapter(packet, manifest) {
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
  if (packet.stage_id === "browser-evidence" && declaration.adapter !== "browser-json-v1") {
    return manualPending(packet, "browser-evidence requires the browser-json-v1 adapter", manifest);
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
  return {
    execution_status: "ready",
    packet_id: packet.packet_id,
    provider_id: packet.provider.id,
    adapter: declaration.adapter,
    host_manifest_digest: manifest.manifest_digest,
    declaration
  };
}

function normalizeReturnedEvidence(result, outputDirectory) {
  const normalized = structuredClone(result);
  normalized.evidence = (normalized.evidence || []).map((item, index) => {
    requireValue(item?.path, `returned evidence ${index + 1} requires path`, 4);
    const resolved = path.isAbsolute(item.path)
      ? path.resolve(item.path)
      : path.resolve(outputDirectory, item.path);
    requireValue(inside(resolved, outputDirectory),
      `returned evidence escapes the granted output directory: ${item.path}`, 4);
    requireValue(fs.existsSync(resolved), `returned evidence is missing: ${resolved}`, 4);
    return { ...item, path: resolved };
  });
  return normalized;
}

function runJsonProcess({ declaration, packet, run, attempt, outputDirectory }) {
  fs.mkdirSync(outputDirectory, { recursive: true });
  const request = {
    host_adapter_request_version: 1,
    run_id: run.run_id,
    attempt,
    packet,
    packets: run.packets,
    creator: run.creator,
    scope: run.scope,
    artifacts: run.artifacts,
    prior_results: run.results.map((record) => record.normalized),
    output_directory: outputDirectory,
    permission_scopes: declaration.permissions,
    settings: declaration.settings
  };
  const startedAt = new Date().toISOString();
  const child = spawnSync(process.execPath, [declaration.entrypoint], {
    input: `${JSON.stringify(request)}\n`,
    encoding: "utf8",
    cwd: outputDirectory,
    env: {
      PATH: process.env.PATH || "",
      KILLSLOPROUTER_HOST_ADAPTER: "1"
    },
    shell: false,
    timeout: declaration.timeout_ms,
    maxBuffer: 16 * 1024 * 1024
  });
  const finishedAt = new Date().toISOString();
  if (child.error || child.status !== 0) {
    return {
      execution_status: "blocked_execution_error",
      started_at: startedAt,
      finished_at: finishedAt,
      child_pid: child.pid || null,
      exit_code: child.status,
      signal: child.signal || null,
      error: child.error?.message || child.stderr?.trim() || `child exited ${child.status}`
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
      result: normalizeReturnedEvidence(response.result, outputDirectory)
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

function runScanner({ declaration, packet, run }) {
  if (run.artifacts.length !== 1) {
    return {
      execution_status: "blocked_execution_error",
      error: "kill-ai-slop-v1 requires exactly one root artifact"
    };
  }
  const receipt = runKillAiSlop({
    adapterRoot: declaration.adapter_root,
    scannerPath: declaration.entrypoint,
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
    result: receipt
  };
}

export function executeAuditPacket({ run, packet, manifest = null, attempt = 1, outputDirectory }) {
  const inspection = inspectPacketAdapter(packet, manifest);
  if (inspection.execution_status !== "ready") return inspection;
  const declaration = inspection.declaration;
  if (declaration.entrypoint) {
    const actualDigest = hashArtifact(declaration.entrypoint);
    if (actualDigest !== declaration.entrypoint_digest) {
      return {
        packet_id: packet.packet_id,
        provider_id: packet.provider.id,
        adapter: declaration.adapter,
        host_manifest_digest: manifest.manifest_digest,
        attempt,
        execution_status: "blocked_execution_error",
        error: "host adapter entrypoint changed after manifest verification"
      };
    }
  }
  const base = {
    packet_id: packet.packet_id,
    provider_id: packet.provider.id,
    adapter: declaration.adapter,
    adapter_entrypoint: declaration.entrypoint
      ? publicSnapshot(snapshotArtifact(declaration.entrypoint, { root: path.dirname(declaration.entrypoint) }))
      : null,
    host_manifest_digest: manifest.manifest_digest,
    permission_scopes: declaration.permissions,
    strength: declaration.strength,
    capabilities: declaration.capabilities,
    attempt
  };
  try {
    const executed = declaration.adapter === "kill-ai-slop-v1"
      ? runScanner({ declaration, packet, run })
      : runJsonProcess({ declaration, packet, run, attempt, outputDirectory });
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
  return run.packets.map((packet) => {
    const inspected = inspectPacketAdapter(packet, manifest);
    const { declaration: _declaration, ...publicInspection } = inspected;
    return publicInspection;
  });
}

export function hostManifestSchemaPath() {
  return fileURLToPath(new URL("../schemas/host-adapter.schema.json", import.meta.url));
}
