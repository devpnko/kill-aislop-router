import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  canonicalDigest,
  hashArtifact,
  readFilePinned,
  readJsonPinned,
  snapshotArtifact,
  writeJsonAtomic
} from "./integrity.mjs";
import { RouterError, readJson, validateProfile } from "./router.mjs";
import { sealedEntrypointGraphDigest } from "./sealed-entrypoint.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;

export const PLAYWRIGHT_ADAPTER_CONTRACT = "killsloprouter-playwright-v1";
export const PLAYWRIGHT_PROVIDER_TARGET = "official:playwright-browser-v1";
export const PLAYWRIGHT_CORE_VERSION = "1.62.1";
export const AXE_CORE_VERSION = "4.13.0";
export const PLAYWRIGHT_RUNTIME_PACKAGES = ["axe-core", "playwright-core"];
export const PLAYWRIGHT_CHANNELS = new Set(["chrome", "msedge", "chromium", "bundled"]);
export const PLAYWRIGHT_SUPPORTED_CHECKS = new Set([
  "keyboard",
  "state",
  "overflow",
  "contrast",
  "zoom-200",
  "visual-regression",
  "screen-reader",
  "aria-semantics",
  "console",
  "network"
]);
export const DEFAULT_PLAYWRIGHT_VIEWPORTS = {
  mobile: { width: 390, height: 844 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1440, height: 1000 }
};
export const DEFAULT_PLAYWRIGHT_CHECKS = [
  "keyboard",
  "state",
  "overflow",
  "contrast",
  "zoom-200",
  "visual-regression",
  "screen-reader",
  "console",
  "network"
];
export const MAX_PLAYWRIGHT_BASELINE_BYTES = 64 * 1024 * 1024;

export function playwrightVerificationContractDigest(settings) {
  return canonicalDigest({
    contract: settings?.contract || null,
    attestation_path: settings?.attestation_path || null,
    allowed_origins: settings?.allowed_origins || null,
    browser_channel: settings?.browser_channel || null,
    locale: settings?.locale || null,
    runtime_digest: settings?.runtime_digest || null,
    scenario_digest: settings?.scenario_digest || null,
    viewports: settings?.viewports || null,
    color_schemes: settings?.color_schemes || null,
    max_keyboard_tabs: settings?.max_keyboard_tabs || null,
    navigation_timeout_ms: settings?.navigation_timeout_ms || null
  });
}

const PLAYWRIGHT_ACTION_TYPES = new Set([
  "click", "fill", "press", "check", "uncheck", "select", "hover", "wait-for"
]);
const PLAYWRIGHT_ASSERTION_TYPES = new Set([
  "visible", "hidden", "text", "value", "checked", "url", "count", "no-overlap", "no-clipping",
  "computed-style"
]);
const PLAYWRIGHT_SCENARIO_KEYS = new Set(["id", "path", "actions", "assertions"]);
const PLAYWRIGHT_ACTION_KEYS = new Set(["type", "locator", "value"]);
const PLAYWRIGHT_ASSERTION_KEYS = new Set(["type", "locator", "property", "value"]);

const SETTINGS_KEYS = new Set([
  "contract",
  "base_url",
  "attestation_path",
  "allowed_origins",
  "browser_channel",
  "locale",
  "runtime_root",
  "runtime_digest",
  "runtime_physical_identity_digest",
  "scenario_file",
  "scenario_digest",
  "baseline_directory",
  "baseline_digest",
  "viewports",
  "color_schemes",
  "max_keyboard_tabs",
  "navigation_timeout_ms"
]);

function requireValue(condition, message, exitCode = 2) {
  if (!condition) throw new RouterError(message, exitCode);
}

function realRegularFile(file, label) {
  const absolute = path.resolve(file);
  requireValue(fs.existsSync(absolute), `${label} is missing: ${absolute}`, 4);
  const stat = fs.lstatSync(absolute);
  requireValue(stat.isFile() && !stat.isSymbolicLink(), `${label} must be a regular non-symlink file`, 4);
  return fs.realpathSync(absolute);
}

function realDirectory(directory, label) {
  const absolute = path.resolve(directory);
  requireValue(fs.existsSync(absolute), `${label} is missing: ${absolute}`, 4);
  const stat = fs.lstatSync(absolute);
  requireValue(stat.isDirectory() && !stat.isSymbolicLink(), `${label} must be a real non-symlink directory`, 4);
  return fs.realpathSync(absolute);
}

function runtimePackagePath(runtimeRoot, packageName) {
  return path.join(runtimeRoot, "node_modules", ...packageName.split("/"));
}

export function playwrightAdapterPath() {
  return path.join(packageRoot, "src", "adapters", "playwright-browser.mjs");
}

export function resolvePlaywrightRuntimeRoot() {
  const candidates = [path.join(packageRoot, ".runtime"), packageRoot];
  for (const candidate of candidates) {
    if (PLAYWRIGHT_RUNTIME_PACKAGES.every((name) =>
      fs.existsSync(path.join(runtimePackagePath(candidate, name), "package.json")))) {
      return realDirectory(candidate, "Playwright runtime root");
    }
  }
  throw new RouterError(
    "Playwright runtime is missing; install dependencies or reinstall the Codex plugin",
    4
  );
}

export function playwrightRuntimeDigest(runtimeRoot) {
  const root = realDirectory(runtimeRoot, "Playwright runtime root");
  const packages = {};
  for (const packageName of PLAYWRIGHT_RUNTIME_PACKAGES) {
    const directory = realDirectory(runtimePackagePath(root, packageName), `runtime package ${packageName}`);
    const metadata = readJson(path.join(directory, "package.json"), `runtime package ${packageName}`);
    const expectedVersion = packageName === "playwright-core" ? PLAYWRIGHT_CORE_VERSION : AXE_CORE_VERSION;
    requireValue(metadata.version === expectedVersion,
      `runtime package ${packageName} version ${metadata.version} does not match pinned ${expectedVersion}`, 4);
    packages[packageName] = {
      version: metadata.version,
      digest: hashArtifact(directory, { ignores: [] })
    };
  }
  return canonicalDigest({ playwright_runtime_version: 1, packages });
}

export function playwrightRuntimePhysicalIdentityDigest(runtimeRoot) {
  const root = realDirectory(runtimeRoot, "Playwright runtime root");
  const packages = {};
  for (const packageName of PLAYWRIGHT_RUNTIME_PACKAGES) {
    const directory = realDirectory(runtimePackagePath(root, packageName),
      `runtime package ${packageName}`);
    const snapshot = snapshotArtifact(directory, {
      root: path.dirname(directory),
      ignores: []
    });
    packages[packageName] = snapshot.physical_identity_digest;
  }
  return canonicalDigest({
    playwright_runtime_physical_identity_version: 1,
    packages
  });
}

export function createPlaywrightRuntimeSeal(settings, { faultInjector = null } = {}) {
  const sourceRoot = realDirectory(settings.runtime_root, "Playwright runtime root");
  const before = {
    digest: playwrightRuntimeDigest(sourceRoot),
    physical_identity_digest: playwrightRuntimePhysicalIdentityDigest(sourceRoot)
  };
  requireValue(before.digest === settings.runtime_digest,
    "official Playwright runtime digest mismatch before sealing", 4);
  requireValue(before.physical_identity_digest === settings.runtime_physical_identity_digest,
    "official Playwright runtime physical identity mismatch before sealing", 4);
  const sealedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-playwright-runtime-"));
  fs.chmodSync(sealedRoot, 0o700);
  const nodeModules = path.join(sealedRoot, "node_modules");
  fs.mkdirSync(nodeModules, { mode: 0o700 });
  let retained = false;
  try {
    for (const packageName of PLAYWRIGHT_RUNTIME_PACKAGES) {
      const source = runtimePackagePath(sourceRoot, packageName);
      const destination = runtimePackagePath(sealedRoot, packageName);
      fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
      fs.cpSync(source, destination, {
        recursive: true,
        dereference: false,
        preserveTimestamps: true,
        force: false,
        errorOnExist: true,
        mode: fs.constants.COPYFILE_FICLONE || 0
      });
    }
    faultInjector?.("after-playwright-runtime-copy-before-source-revalidation", {
      runtime_root: sourceRoot,
      sealed_runtime_root: sealedRoot
    });
    const after = {
      digest: playwrightRuntimeDigest(sourceRoot),
      physical_identity_digest: playwrightRuntimePhysicalIdentityDigest(sourceRoot)
    };
    requireValue(canonicalDigest(after) === canonicalDigest(before),
      "official Playwright runtime changed while its private execution seal was being created", 4);
    requireValue(playwrightRuntimeDigest(sealedRoot) === settings.runtime_digest,
      "sealed Playwright runtime content does not match configured authority", 4);
    const result = {
      runtimeRoot: sealedRoot,
      runtimePhysicalIdentityDigest: playwrightRuntimePhysicalIdentityDigest(sealedRoot),
      cleanup() {
        fs.rmSync(sealedRoot, { recursive: true, force: true });
      }
    };
    retained = true;
    return result;
  } finally {
    if (!retained) fs.rmSync(sealedRoot, { recursive: true, force: true });
  }
}

export function isLoopbackUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (!["http:", "https:"].includes(parsed.protocol)) return false;
  const hostname = parsed.hostname.toLowerCase();
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
}

function normalizedOrigin(value, label) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new RouterError(`${label} must be an absolute http(s) URL`, 2);
  }
  requireValue(["http:", "https:"].includes(parsed.protocol), `${label} must use http or https`);
  requireValue(parsed.username === "" && parsed.password === "", `${label} must not contain URL credentials`);
  return parsed.origin;
}

function validateViewportMap(value) {
  requireValue(value && typeof value === "object" && !Array.isArray(value),
    "Playwright settings.viewports must be an object");
  for (const [name, viewport] of Object.entries(value)) {
    requireValue(/^[A-Za-z0-9._-]+$/.test(name), `invalid Playwright viewport name: ${name}`);
    requireValue(viewport && typeof viewport === "object" && !Array.isArray(viewport),
      `Playwright viewport ${name} must be an object`);
    requireValue(Number.isInteger(viewport.width) && viewport.width >= 240 && viewport.width <= 4096,
      `Playwright viewport ${name} width must be between 240 and 4096`);
    requireValue(Number.isInteger(viewport.height) && viewport.height >= 240 && viewport.height <= 4096,
      `Playwright viewport ${name} height must be between 240 and 4096`);
  }
}

export function validateOfficialPlaywrightSettings(settings, {
  entrypoint,
  permissionScopes = [],
  manifestPath = process.cwd(),
  faultInjector = null
} = {}) {
  requireValue(settings?.contract === PLAYWRIGHT_ADAPTER_CONTRACT,
    `official Playwright adapter requires settings.contract ${PLAYWRIGHT_ADAPTER_CONTRACT}`);
  for (const key of Object.keys(settings)) {
    requireValue(SETTINGS_KEYS.has(key), `official Playwright settings contain unsupported field: ${key}`);
  }
  const expectedEntrypoint = realRegularFile(playwrightAdapterPath(), "official Playwright adapter");
  requireValue(realRegularFile(entrypoint, "Playwright adapter entrypoint") === expectedEntrypoint,
    "official Playwright contract must use the bundled adapter entrypoint", 4);

  const runtimeRoot = path.isAbsolute(settings.runtime_root || "")
    ? path.resolve(settings.runtime_root)
    : path.resolve(path.dirname(path.resolve(manifestPath)), settings.runtime_root || "");
  const trustedRuntimeRoot = resolvePlaywrightRuntimeRoot();
  requireValue(realDirectory(runtimeRoot, "Playwright runtime root") === trustedRuntimeRoot,
    "official Playwright runtime must use the bundled trusted runtime root", 4);
  const actualRuntimeDigest = playwrightRuntimeDigest(runtimeRoot);
  requireValue(settings.runtime_digest === actualRuntimeDigest,
    "official Playwright runtime digest mismatch", 4);
  const actualRuntimePhysicalIdentityDigest =
    playwrightRuntimePhysicalIdentityDigest(runtimeRoot);
  requireValue(settings.runtime_physical_identity_digest ===
    actualRuntimePhysicalIdentityDigest,
  "official Playwright runtime physical identity mismatch", 4);

  const scenarioFile = path.isAbsolute(settings.scenario_file || "")
    ? path.resolve(settings.scenario_file)
    : path.resolve(path.dirname(path.resolve(manifestPath)), settings.scenario_file || "");
  realRegularFile(scenarioFile, "Playwright scenario file");
  const pinnedScenario = readJsonPinned(scenarioFile, {
    label: "Playwright scenario file",
    faultInjector
  });
  requireValue(pinnedScenario.digest === settings.scenario_digest,
    "Playwright scenario file digest mismatch", 4);
  const scenarioDocument = validatePlaywrightScenarioDocument(
    pinnedScenario.input
  );

  const baselineDirectory = path.isAbsolute(settings.baseline_directory || "")
    ? path.resolve(settings.baseline_directory)
    : path.resolve(path.dirname(path.resolve(manifestPath)), settings.baseline_directory || "");
  realDirectory(baselineDirectory, "Playwright baseline directory");
  const baselineSnapshot = snapshotArtifact(baselineDirectory, {
    root: path.dirname(baselineDirectory),
    ignores: []
  });
  requireValue(baselineSnapshot.digest === settings.baseline_digest,
    "Playwright baseline directory digest mismatch", 4);
  const pinnedBaselines = pinnedBaselineFiles(
    baselineDirectory,
    faultInjector,
    { includeSource: false }
  );
  requireValue(baselineDirectoryDigest(pinnedBaselines.files) === settings.baseline_digest,
    "Playwright baseline directory cannot be represented by the child authority", 4);
  const confirmedBaselineSnapshot = snapshotArtifact(baselineDirectory, {
    root: path.dirname(baselineDirectory),
    ignores: []
  });
  requireValue(
    confirmedBaselineSnapshot.digest === baselineSnapshot.digest &&
      confirmedBaselineSnapshot.physical_identity_digest ===
        baselineSnapshot.physical_identity_digest,
    "Playwright baseline directory changed while it was being validated",
    4
  );

  const baseOrigin = normalizedOrigin(settings.base_url, "Playwright base_url");
  requireValue(typeof settings.attestation_path === "string" && settings.attestation_path.startsWith("/") &&
    !settings.attestation_path.startsWith("//"),
  "Playwright attestation_path must be an origin-relative path");
  requireValue(Array.isArray(settings.allowed_origins),
    "Playwright settings.allowed_origins must be an array");
  const allowedOrigins = [...new Set([baseOrigin, ...settings.allowed_origins.map((value) =>
    normalizedOrigin(value, "Playwright allowed origin"))])];
  const external = [settings.base_url, ...(settings.allowed_origins || [])]
    .some((value) => !isLoopbackUrl(value));
  requireValue(!external || permissionScopes.includes("network:external"),
    "external Playwright URLs require network:external permission", 4);
  requireValue(PLAYWRIGHT_CHANNELS.has(settings.browser_channel),
    `unsupported Playwright browser channel: ${settings.browser_channel || "missing"}`);
  requireValue(typeof settings.locale === "string" && settings.locale.length > 0,
    "Playwright settings.locale must be a non-empty string");
  validateViewportMap(settings.viewports);
  requireValue(Array.isArray(settings.color_schemes) && settings.color_schemes.length > 0,
    "Playwright settings.color_schemes must be a non-empty array");
  requireValue(new Set(settings.color_schemes).size === settings.color_schemes.length,
    "Playwright settings.color_schemes contains duplicates");
  for (const scheme of settings.color_schemes) {
    requireValue(["light", "dark", "no-preference"].includes(scheme),
      `unsupported Playwright color scheme: ${scheme}`);
  }
  requireValue(Number.isInteger(settings.max_keyboard_tabs) && settings.max_keyboard_tabs >= 1 &&
    settings.max_keyboard_tabs <= 200, "Playwright max_keyboard_tabs must be between 1 and 200");
  requireValue(Number.isInteger(settings.navigation_timeout_ms) && settings.navigation_timeout_ms >= 1000 &&
    settings.navigation_timeout_ms <= 120000,
  "Playwright navigation_timeout_ms must be between 1000 and 120000");

  return {
    runtimeRoot: realDirectory(runtimeRoot, "Playwright runtime root"),
    runtimePhysicalIdentityDigest: actualRuntimePhysicalIdentityDigest,
    scenarioFile: pinnedScenario.path,
    scenarioSnapshot: pinnedScenario.source_snapshot,
    scenarioIds: scenarioDocument.scenarios.map((scenario) => scenario.id),
    scenarioAssertions: Object.fromEntries(scenarioDocument.scenarios.map((scenario) => [
      scenario.id,
      (scenario.assertions || []).length
    ])),
    verificationContractDigest: playwrightVerificationContractDigest(settings),
    baselineDirectory: realDirectory(baselineDirectory, "Playwright baseline directory"),
    baselineSnapshot,
    baseOrigin,
    allowedOrigins,
    external
  };
}

function baselineDirectoryDigest(files) {
  return canonicalDigest({
    type: "directory",
    entries: files.map((file) => ({
      type: "file",
      path: file.name,
      bytes: file.bytes,
      digest: file.digest
    }))
  });
}

function pinnedBaselineFiles(directory, faultInjector = null, { includeSource = true } = {}) {
  const baselineRoot = realDirectory(directory, "Playwright baseline directory");
  const files = [];
  let totalBytes = 0;
  for (const entry of fs.readdirSync(baselineRoot, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))) {
    requireValue(entry.isFile() && !entry.isSymbolicLink(),
      `Playwright baseline authority accepts flat regular files only: ${entry.name}`, 4);
    requireValue(/^[A-Za-z0-9._-]+\.png$/.test(entry.name),
      `Playwright baseline authority accepts safe PNG filenames only: ${entry.name}`, 4);
    const pinned = readFilePinned(path.join(baselineRoot, entry.name), {
      label: `Playwright baseline ${entry.name}`,
      faultInjector
    });
    totalBytes += pinned.bytes;
    requireValue(totalBytes <= MAX_PLAYWRIGHT_BASELINE_BYTES,
      `Playwright baseline authority exceeds ${MAX_PLAYWRIGHT_BASELINE_BYTES} bytes`, 4);
    const file = {
      name: entry.name,
      bytes: pinned.bytes,
      digest: pinned.digest,
      physical_identity_digest: pinned.physical_identity_digest
    };
    if (includeSource) file.source_base64 = pinned.source.toString("base64");
    files.push(file);
  }
  return { baselineRoot, files, totalBytes };
}

export function createPlaywrightChildAuthority(settings, verified, {
  faultInjector = null,
  runtimeSeal = null
} = {}) {
  requireValue(verified?.scenarioFile && verified?.baselineDirectory,
    "verified Playwright authority is required before child handoff", 4);
  requireValue(runtimeSeal?.runtimeRoot &&
    DIGEST_PATTERN.test(runtimeSeal.runtimePhysicalIdentityDigest || ""),
  "sealed Playwright runtime authority is required before child handoff", 4);
  requireValue(playwrightRuntimeDigest(runtimeSeal.runtimeRoot) === settings.runtime_digest,
    "sealed Playwright runtime digest changed before child handoff", 4);
  requireValue(playwrightRuntimePhysicalIdentityDigest(runtimeSeal.runtimeRoot) ===
    runtimeSeal.runtimePhysicalIdentityDigest,
  "sealed Playwright runtime physical identity changed before child handoff", 4);
  const pinnedScenario = readFilePinned(verified.scenarioFile, {
    label: "Playwright scenario authority for child handoff",
    faultInjector
  });
  requireValue(pinnedScenario.digest === settings.scenario_digest,
    "Playwright scenario authority changed before child handoff", 4);
  requireValue(
    pinnedScenario.physical_identity_digest === verified.scenarioSnapshot?.physical_identity_digest,
    "Playwright scenario physical identity changed before child handoff",
    4
  );
  let scenarioDocument;
  try {
    scenarioDocument = JSON.parse(pinnedScenario.source.toString("utf8"));
  } catch (error) {
    throw new RouterError(`cannot parse Playwright scenario authority: ${error.message}`, 4);
  }
  validatePlaywrightScenarioDocument(scenarioDocument);

  const baselineBefore = snapshotArtifact(verified.baselineDirectory, {
    root: path.dirname(verified.baselineDirectory),
    ignores: []
  });
  requireValue(
    baselineBefore.digest === verified.baselineSnapshot?.digest &&
      baselineBefore.physical_identity_digest === verified.baselineSnapshot?.physical_identity_digest,
    "Playwright baseline physical identity changed before child handoff",
    4
  );
  const baselines = pinnedBaselineFiles(verified.baselineDirectory, faultInjector);
  const directoryDigest = baselineDirectoryDigest(baselines.files);
  requireValue(directoryDigest === settings.baseline_digest,
    "Playwright baseline authority changed before child handoff", 4);
  const confirmedScenario = readFilePinned(verified.scenarioFile, {
    label: "Playwright scenario authority immediately before child handoff"
  });
  requireValue(
    confirmedScenario.digest === pinnedScenario.digest &&
      confirmedScenario.physical_identity_digest === pinnedScenario.physical_identity_digest,
    "Playwright scenario path identity changed before child handoff",
    4
  );
  const baselineAfter = snapshotArtifact(verified.baselineDirectory, {
    root: path.dirname(verified.baselineDirectory),
    ignores: []
  });
  requireValue(
    baselineAfter.digest === directoryDigest &&
      baselineAfter.physical_identity_digest === baselineBefore.physical_identity_digest,
    "Playwright baseline path identity changed before child handoff",
    4
  );
  const body = {
    playwright_child_authority_version: 1,
    runtime_digest: settings.runtime_digest,
    runtime_source_physical_identity_digest: settings.runtime_physical_identity_digest,
    runtime_seal_physical_identity_digest: runtimeSeal.runtimePhysicalIdentityDigest,
    scenario: {
      digest: pinnedScenario.digest,
      bytes: pinnedScenario.bytes,
      physical_identity_digest: pinnedScenario.physical_identity_digest,
      source_base64: pinnedScenario.source.toString("base64")
    },
    baselines: {
      directory_digest: directoryDigest,
      physical_identity_digest: baselineAfter.physical_identity_digest,
      total_bytes: baselines.totalBytes,
      files: baselines.files
    }
  };
  return { ...body, authority_digest: canonicalDigest(body) };
}

export function verifyPlaywrightChildAuthoritySources(settings, authority) {
  requireValue(authority?.playwright_child_authority_version === 1,
    "Playwright child authority is missing before source confirmation", 4);
  const scenario = readFilePinned(settings.scenario_file, {
    label: "Playwright scenario authority at final child boundary"
  });
  requireValue(
    scenario.digest === authority.scenario?.digest &&
      scenario.physical_identity_digest === authority.scenario?.physical_identity_digest,
    "Playwright scenario content or physical identity changed at the final child boundary", 4);
  const baseline = snapshotArtifact(settings.baseline_directory, {
    root: path.dirname(settings.baseline_directory),
    ignores: []
  });
  requireValue(
    baseline.digest === authority.baselines?.directory_digest &&
      baseline.physical_identity_digest === authority.baselines?.physical_identity_digest,
  "Playwright baseline content or physical identity changed at the final child boundary", 4);
  requireValue(playwrightRuntimeDigest(settings.runtime_root) === authority.runtime_digest,
    "Playwright runtime authority changed at the final child boundary", 4);
  requireValue(playwrightRuntimePhysicalIdentityDigest(settings.runtime_root) ===
    authority.runtime_source_physical_identity_digest &&
    authority.runtime_source_physical_identity_digest ===
      settings.runtime_physical_identity_digest,
  "Playwright runtime physical authority changed at the final child boundary", 4);
}

function safeJsonFile(file, label) {
  const absolute = realRegularFile(file, label);
  return { absolute, value: readJson(absolute, label) };
}

function backupFile(file) {
  const backup = `${file}.bak.${new Date().toISOString().replace(/[-:.]/g, "")}-${crypto.randomUUID()}`;
  fs.copyFileSync(file, backup, fs.constants.COPYFILE_EXCL);
  return backup;
}

function defaultScenario() {
  return {
    playwright_scenario_version: 1,
    scenarios: [{
      id: "root",
      path: "/",
      actions: [],
      assertions: [{ type: "visible", locator: "body" }]
    }]
  };
}

export function validatePlaywrightScenarioDocument(value) {
  requireValue(value?.playwright_scenario_version === 1,
    "playwright_scenario_version must be 1");
  requireValue(Array.isArray(value.scenarios) && value.scenarios.length >= 1 && value.scenarios.length <= 50,
    "Playwright scenarios must contain between 1 and 50 entries");
  const ids = new Set();
  for (const scenario of value.scenarios) {
    requireValue(scenario && typeof scenario === "object" && !Array.isArray(scenario),
      "each Playwright scenario must be an object");
    for (const key of Object.keys(scenario)) {
      requireValue(PLAYWRIGHT_SCENARIO_KEYS.has(key),
        `Playwright scenario contains unsupported field: ${key}`);
    }
    requireValue(typeof scenario.id === "string" && /^[A-Za-z0-9._-]+$/.test(scenario.id),
      "each Playwright scenario requires a safe id");
    requireValue(!ids.has(scenario.id), `duplicate Playwright scenario id: ${scenario.id}`);
    ids.add(scenario.id);
    requireValue(typeof scenario.path === "string" && scenario.path.startsWith("/"),
      `Playwright scenario ${scenario.id} path must start with /`);
    requireValue(Array.isArray(scenario.actions) && scenario.actions.length <= 100,
      `Playwright scenario ${scenario.id} actions must be an array of at most 100 entries`);
    for (const action of scenario.actions) {
      requireValue(action && typeof action === "object" && !Array.isArray(action),
        `Playwright scenario ${scenario.id} actions must contain objects`);
      for (const key of Object.keys(action)) {
        requireValue(PLAYWRIGHT_ACTION_KEYS.has(key),
          `Playwright action contains unsupported field: ${key}`);
      }
      requireValue(PLAYWRIGHT_ACTION_TYPES.has(action?.type),
        `Playwright scenario ${scenario.id} has unsupported action: ${action?.type || "missing"}`);
      requireValue(typeof action.locator === "string" && action.locator.length >= 1 && action.locator.length <= 1000,
        `Playwright scenario ${scenario.id} action ${action.type} requires locator`);
      if (["fill", "press", "select"].includes(action.type)) {
        requireValue(typeof action.value === "string", `Playwright action ${action.type} requires a string value`);
      }
    }
    requireValue(scenario.assertions === undefined ||
      (Array.isArray(scenario.assertions) && scenario.assertions.length <= 100),
    `Playwright scenario ${scenario.id} assertions must be an array of at most 100 entries`);
    for (const assertion of scenario.assertions || []) {
      requireValue(assertion && typeof assertion === "object" && !Array.isArray(assertion),
        `Playwright scenario ${scenario.id} assertions must contain objects`);
      for (const key of Object.keys(assertion)) {
        requireValue(PLAYWRIGHT_ASSERTION_KEYS.has(key),
          `Playwright assertion contains unsupported field: ${key}`);
      }
      requireValue(PLAYWRIGHT_ASSERTION_TYPES.has(assertion?.type),
        `Playwright scenario ${scenario.id} has unsupported assertion: ${assertion?.type || "missing"}`);
      if (assertion.type !== "url") {
        requireValue(typeof assertion.locator === "string" && assertion.locator.length >= 1 &&
          assertion.locator.length <= 1000,
        `Playwright assertion ${assertion.type} requires locator`);
      }
      if (["text", "value", "url", "computed-style"].includes(assertion.type)) {
        requireValue(typeof assertion.value === "string",
          `Playwright assertion ${assertion.type} requires a string value`);
      }
      if (assertion.type === "computed-style") {
        requireValue(typeof assertion.property === "string" &&
          /^(?:--)?[a-z][a-z0-9-]{0,100}$/.test(assertion.property),
        "Playwright assertion computed-style requires a safe CSS property");
      }
      if (assertion.type === "count") {
        requireValue(Number.isInteger(assertion.value) && assertion.value >= 0,
          "Playwright assertion count requires a non-negative integer value");
      }
    }
  }
  return value;
}

function pathInside(candidate, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function requireRealOutputBoundary(directory, boundary) {
  const relative = path.relative(path.resolve(boundary), path.resolve(directory));
  requireValue(relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative)),
    "browser attestation output boundary is invalid");
  let current = path.resolve(boundary);
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (!fs.existsSync(current)) break;
    requireValue(!fs.lstatSync(current).isSymbolicLink(),
      `browser attestation output boundary contains a symlink: ${current}`, 4);
  }
}

export function createBrowserAttestation({
  artifacts,
  root = process.cwd(),
  outPath
}) {
  requireValue(Array.isArray(artifacts) && artifacts.length > 0,
    "browser attest requires at least one artifact");
  requireValue(typeof outPath === "string" && outPath.length > 0,
    "browser attest requires an output path");
  const absoluteRoot = path.resolve(root);
  const absoluteOut = path.resolve(absoluteRoot, outPath);
  const snapshots = artifacts.map((artifact) => snapshotArtifact(artifact, { root: absoluteRoot }));
  requireValue(new Set(snapshots.map((snapshot) => snapshot.path)).size === snapshots.length,
    "browser attest received duplicate artifacts");
  for (const snapshot of snapshots) {
    if (snapshot.kind === "file") {
      requireValue(path.resolve(snapshot.resolved_path) !== absoluteOut,
        "browser attestation output cannot replace an artifact");
      continue;
    }
    if (!pathInside(absoluteOut, snapshot.resolved_path)) continue;
    const relative = path.relative(snapshot.resolved_path, absoluteOut);
    requireValue(relative.split(path.sep)[0] === ".killsloprouter",
      "browser attestation inside a directory artifact must be under .killsloprouter");
    requireRealOutputBoundary(path.dirname(absoluteOut), snapshot.resolved_path);
  }
  const attestation = {
    killsloprouter_browser_attestation_version: 1,
    artifact_digests: Object.fromEntries(snapshots.map((snapshot) => [snapshot.path, snapshot.digest]))
  };
  writeJsonAtomic(absoluteOut, attestation);
  return {
    status: "written",
    path: absoluteOut,
    digest: hashArtifact(absoluteOut),
    artifact_digests: attestation.artifact_digests
  };
}

export function configurePlaywright({
  profilePath,
  hostManifestPath,
  baseUrl,
  browserChannel = "chrome",
  allowedOrigins = [],
  allowExternal = false,
  scenarioPath = null,
  baselineDirectory = null,
  requiredScenarios: requestedRequiredScenarios = null
}) {
  const profileSource = safeJsonFile(profilePath, "project profile");
  const hostSource = safeJsonFile(hostManifestPath, "host adapter manifest");
  validateProfile(profileSource.value);
  requireValue(hostSource.value?.host_adapter_version === 1, "host_adapter_version must be 1");
  requireValue(Array.isArray(hostSource.value.allowed_providers) && hostSource.value.allowed_providers.length > 0,
    "host adapter manifest requires allowed_providers");
  requireValue(Array.isArray(hostSource.value.granted_permissions),
    "host adapter manifest requires granted_permissions");
  requireValue(hostSource.value.providers && typeof hostSource.value.providers === "object" &&
    !Array.isArray(hostSource.value.providers), "host adapter manifest requires providers");
  requireValue(typeof baseUrl === "string" && baseUrl.length > 0,
    "browser configure requires a base URL");
  requireValue(Array.isArray(allowedOrigins), "browser configure allowed origins must be an array");
  requireValue(PLAYWRIGHT_CHANNELS.has(browserChannel),
    `unsupported Playwright browser channel: ${browserChannel}`);
  const external = [baseUrl, ...allowedOrigins].some((value) => !isLoopbackUrl(value));
  requireValue(!external || allowExternal,
    "external Playwright URLs require explicit --allow-external");
  normalizedOrigin(baseUrl, "Playwright base URL");
  const normalizedAllowedOrigins = allowedOrigins.map((value) =>
    normalizedOrigin(value, "Playwright allowed origin"));

  const configDirectory = path.dirname(profileSource.absolute);
  const scenarioFile = path.resolve(scenarioPath || path.join(configDirectory, "playwright-scenarios.json"));
  if (!fs.existsSync(scenarioFile)) writeJsonAtomic(scenarioFile, defaultScenario());
  realRegularFile(scenarioFile, "Playwright scenario file");
  const pinnedScenario = readJsonPinned(scenarioFile, {
    label: "Playwright scenario file"
  });
  const scenarioDocument = validatePlaywrightScenarioDocument(
    pinnedScenario.input
  );
  requireValue(requestedRequiredScenarios === null || (
    Array.isArray(requestedRequiredScenarios) &&
    requestedRequiredScenarios.length > 0 &&
    new Set(requestedRequiredScenarios).size === requestedRequiredScenarios.length
  ), "browser configure --required-scenarios must contain unique scenario IDs");
  const requiredScenarios = [...(
    requestedRequiredScenarios || profileSource.value.evidence?.required_scenarios || []
  )];
  requireValue(requiredScenarios.length > 0,
    "browser configure requires profile evidence.required_scenarios from the reviewed critical UI inventory");
  const scenariosById = new Map(scenarioDocument.scenarios.map((scenario) => [scenario.id, scenario]));
  for (const scenarioId of requiredScenarios) {
    const scenario = scenariosById.get(scenarioId);
    requireValue(scenario, `required Playwright scenario is missing from the scenario file: ${scenarioId}`);
    requireValue((scenario.assertions || []).length > 0,
      `required Playwright scenario needs at least one state assertion: ${scenarioId}`);
  }
  const baselineRoot = path.resolve(baselineDirectory || path.join(configDirectory, "playwright-baselines"));
  if (!fs.existsSync(baselineRoot)) fs.mkdirSync(baselineRoot, { recursive: true });
  realDirectory(baselineRoot, "Playwright baseline directory");

  const runtimeRoot = resolvePlaywrightRuntimeRoot();
  const entrypoint = realRegularFile(playwrightAdapterPath(), "official Playwright adapter");
  const capabilities = [
    "responsive-evidence",
    "keyboard-evidence",
    "state-evidence",
    "overflow-evidence",
    "contrast-evidence",
    "zoom-evidence"
  ];
  const permissions = ["artifact:read", "evidence:write", "browser:control"];
  if (external) permissions.push("network:external");

  const requiredViewports = [...new Set([
    ...(profileSource.value.evidence?.required_viewports || []),
    ...Object.keys(DEFAULT_PLAYWRIGHT_VIEWPORTS)
  ])];
  const requiredChecks = [...new Set([
    ...(profileSource.value.evidence?.required_checks || []),
    ...DEFAULT_PLAYWRIGHT_CHECKS
  ])];
  const browserSettings = {
    contract: PLAYWRIGHT_ADAPTER_CONTRACT,
    base_url: baseUrl,
    attestation_path: "/.well-known/killsloprouter-artifact.json",
    allowed_origins: [...new Set(normalizedAllowedOrigins)],
    browser_channel: browserChannel,
    locale: profileSource.value.default_locale,
    runtime_root: runtimeRoot,
    runtime_digest: playwrightRuntimeDigest(runtimeRoot),
    runtime_physical_identity_digest: playwrightRuntimePhysicalIdentityDigest(runtimeRoot),
    scenario_file: scenarioFile,
    scenario_digest: pinnedScenario.digest,
    baseline_directory: baselineRoot,
    baseline_digest: hashArtifact(baselineRoot, { ignores: [] }),
    viewports: Object.fromEntries(requiredViewports.map((name) => {
      requireValue(DEFAULT_PLAYWRIGHT_VIEWPORTS[name],
        `viewport ${name} requires an explicit adapter definition`);
      return [name, DEFAULT_PLAYWRIGHT_VIEWPORTS[name]];
    })),
    color_schemes: ["light"],
    max_keyboard_tabs: 200,
    navigation_timeout_ms: 30000
  };

  const profile = structuredClone(profileSource.value);
  profile.evidence = {
    browser: "playwright",
    required_viewports: requiredViewports,
    required_checks: requiredChecks,
    required_scenarios: requiredScenarios,
    scenario_digest: browserSettings.scenario_digest,
    browser_contract_digest: playwrightVerificationContractDigest(browserSettings)
  };
  if (profile.evidence.required_checks.includes("state")) {
    requireValue(scenarioDocument.scenarios.some((scenario) => (scenario.assertions || []).length > 0),
      "Playwright state evidence requires at least one scenario assertion");
  }
  profile.local_adapters ||= {};
  profile.local_adapters["browser-evidence"] = {
    target: PLAYWRIGHT_PROVIDER_TARGET,
    status: "available",
    version: `playwright-core@${PLAYWRIGHT_CORE_VERSION}`,
    executor: "browser-json-v1",
    strength: 3,
    capabilities,
    independent_from_creator: true
  };
  validateProfile(profile);

  const host = structuredClone(hostSource.value);
  host.allowed_providers = [...new Set([...(host.allowed_providers || []), "browser-evidence"])];
  host.granted_permissions = [...new Set([...(host.granted_permissions || []), ...permissions])];
  host.providers ||= {};
  host.providers["browser-evidence"] = {
    adapter: "browser-json-v1",
    entrypoint,
    entrypoint_digest: hashArtifact(entrypoint),
    entrypoint_graph_digest: sealedEntrypointGraphDigest(entrypoint, {
      trustedPackageRoot: packageRoot
    }),
    strength: 3,
    capabilities,
    permissions,
    timeout_ms: 900000,
    settings: browserSettings
  };
  validateOfficialPlaywrightSettings(host.providers["browser-evidence"].settings, {
    entrypoint,
    permissionScopes: permissions,
    manifestPath: hostSource.absolute
  });

  const profileBackup = backupFile(profileSource.absolute);
  const hostBackup = backupFile(hostSource.absolute);
  const receiptPath = path.join(configDirectory, "playwright-setup-receipt.json");
  try {
    if (canonicalDigest(profile) !== canonicalDigest(profileSource.value)) {
      writeJsonAtomic(profileSource.absolute, profile);
    }
    if (canonicalDigest(host) !== canonicalDigest(hostSource.value)) {
      writeJsonAtomic(hostSource.absolute, host);
    }
    const receipt = {
      playwright_setup_receipt_version: 1,
      status: "configured",
      generated_at: new Date().toISOString(),
      profile: { path: profileSource.absolute, digest: hashArtifact(profileSource.absolute), backup: profileBackup },
      host_manifest: { path: hostSource.absolute, digest: hashArtifact(hostSource.absolute), backup: hostBackup },
      adapter: {
        contract: PLAYWRIGHT_ADAPTER_CONTRACT,
        entrypoint,
        entrypoint_digest: hashArtifact(entrypoint),
        entrypoint_graph_digest: sealedEntrypointGraphDigest(entrypoint, {
          trustedPackageRoot: packageRoot
        }),
        runtime_root: runtimeRoot,
        runtime_digest: playwrightRuntimeDigest(runtimeRoot),
        runtime_physical_identity_digest: playwrightRuntimePhysicalIdentityDigest(runtimeRoot),
        playwright_version: PLAYWRIGHT_CORE_VERSION,
        axe_version: AXE_CORE_VERSION
      },
      browser: {
        base_url: baseUrl,
        attestation_path: "/.well-known/killsloprouter-artifact.json",
        allowed_origins: [...new Set(normalizedAllowedOrigins)],
        browser_channel: browserChannel,
        scenario_file: scenarioFile,
        scenario_digest: browserSettings.scenario_digest,
        required_scenarios: requiredScenarios,
        verification_contract_digest: profile.evidence.browser_contract_digest,
        baseline_directory: baselineRoot,
        baseline_digest: hashArtifact(baselineRoot, { ignores: [] }),
        external_network: external
      },
      receipt_path: receiptPath
    };
    receipt.receipt_digest = canonicalDigest(receipt);
    writeJsonAtomic(receiptPath, receipt);
    return receipt;
  } catch (error) {
    fs.copyFileSync(profileBackup, profileSource.absolute);
    fs.copyFileSync(hostBackup, hostSource.absolute);
    throw error;
  }
}
