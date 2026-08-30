import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { canonicalDigest, hashArtifact, sha256, writeJsonAtomic } from "./integrity.mjs";

export const CANONICAL_SKILL_ENTRYPOINT = "killsloprouter:kill-slop-router";
export const LEGACY_SKILL_ENTRYPOINT = "kill-slop-router";
export const LEGACY_SHIM_MARKER = ".killsloprouter-legacy-shim.json";
export const PLUGIN_INSTALL_MARKER = ".killsloprouter-plugin-installed.json";
export const PLUGIN_BUNDLE_ENTRIES = [
  ".codex-plugin",
  "bin",
  "src",
  "router",
  "schemas",
  "registry",
  "skills",
  "scripts",
  "docs",
  "examples",
  "package.json",
  "README.md",
  "SECURITY.md",
  "LICENSE",
  "THIRD_PARTY.md",
  "CHANGELOG.md"
];

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requireFromPackage = createRequire(path.join(packageRoot, "package.json"));
const PLUGIN_RUNTIME_PACKAGES = ["axe-core", "playwright-core"];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const PLUGIN_MARKER_KEYS = new Set([
  "plugin_install_marker_version",
  "name",
  "version",
  "install_contract",
  "canonical_entrypoint",
  "payload_digest",
  "runtime_digest",
  "canonical_skill_digest",
  "marker_digest"
]);
const PREVIOUS_PLUGIN_MARKER_KEYS = new Set([
  "plugin_install_marker_version",
  "name",
  "version",
  "installed_by",
  "installed_at",
  "source",
  "canonical_entrypoint",
  "payload_digest",
  "runtime_digest",
  "canonical_skill_digest",
  "marker_digest"
]);
const LEGACY_PLUGIN_MARKER_KEYS = new Set([
  "name", "version", "installed_by", "installed_at", "source"
]);
const LEGACY_SHIM_MARKER_KEYS = new Set([
  "legacy_shim_version",
  "migration_contract",
  "migration_id",
  "migrated_at",
  "legacy_entrypoint",
  "canonical_entrypoint",
  "original_digest",
  "backup",
  "canonical_install",
  "files",
  "migration_digest"
]);
const PREVIOUS_LEGACY_SHIM_MARKER_KEYS = new Set([
  "legacy_shim_version",
  "migration_id",
  "migrated_at",
  "legacy_entrypoint",
  "canonical_entrypoint",
  "original_digest",
  "backup",
  "files",
  "migration_digest"
]);

function realDirectory(target) {
  if (!fs.existsSync(target)) return false;
  const stat = fs.lstatSync(target);
  return stat.isDirectory() && !stat.isSymbolicLink();
}

function fileDigest(target) {
  return fs.existsSync(target) && fs.lstatSync(target).isFile() && !fs.lstatSync(target).isSymbolicLink()
    ? hashArtifact(target)
    : null;
}

function inside(candidate, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function insideRealDirectory(candidate, parent) {
  if (!realDirectory(candidate) || !realDirectory(parent)) return false;
  return inside(fs.realpathSync(candidate), fs.realpathSync(parent));
}

function readJson(target) {
  try {
    return JSON.parse(fs.readFileSync(target, "utf8"));
  } catch {
    return null;
  }
}

function exactKeys(value, expected) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value)) &&
    Object.keys(value).length === expected.size &&
    Object.keys(value).every((key) => expected.has(key));
}

function validTimestamp(value) {
  return typeof value === "string" && value.length > 0 && !Number.isNaN(Date.parse(value));
}

function pluginPayloadDigest(root) {
  const entries = {};
  for (const entry of PLUGIN_BUNDLE_ENTRIES) {
    const target = path.join(root, entry);
    if (!fs.existsSync(target)) return null;
    entries[entry] = hashArtifact(target, { ignores: [] });
  }
  return canonicalDigest({ plugin_payload_version: 1, entries });
}

function pluginRuntimeDigest(root) {
  const runtime = path.join(root, ".runtime");
  return realDirectory(runtime) ? hashArtifact(runtime, { ignores: [] }) : null;
}

function trustedCanonicalSkillDigest() {
  return fileDigest(path.join(packageRoot, "skills", "kill-slop-router", "SKILL.md"));
}

function trustedPluginPayloadDigest() {
  return pluginPayloadDigest(packageRoot);
}

function runtimePackageRoot(root) {
  const installed = path.join(root, ".runtime", "node_modules");
  if (realDirectory(installed)) return installed;
  const development = path.join(root, "node_modules");
  return realDirectory(development) ? development : null;
}

function runtimeMatchesTrustedPackage(root) {
  const installedRoot = runtimePackageRoot(root);
  if (!installedRoot) return false;
  return PLUGIN_RUNTIME_PACKAGES.every((packageName) => {
    const installed = path.join(installedRoot, packageName);
    let trusted;
    try {
      trusted = path.dirname(requireFromPackage.resolve(`${packageName}/package.json`));
    } catch {
      return false;
    }
    return realDirectory(installed) && realDirectory(trusted) &&
      hashArtifact(installed, { ignores: [] }) === hashArtifact(trusted, { ignores: [] });
  });
}

export function createPluginInstallMarker({ root, version }) {
  const canonicalSkill = path.join(root, "skills", "kill-slop-router", "SKILL.md");
  const body = {
    plugin_install_marker_version: 2,
    name: "killsloprouter",
    version,
    install_contract: "trusted-package-payload-v1",
    canonical_entrypoint: CANONICAL_SKILL_ENTRYPOINT,
    payload_digest: pluginPayloadDigest(root),
    runtime_digest: pluginRuntimeDigest(root),
    canonical_skill_digest: fileDigest(canonicalSkill)
  };
  if (!body.payload_digest || !body.runtime_digest || !body.canonical_skill_digest) {
    throw new Error("cannot issue a KillSlopRouter plugin marker for an incomplete bundle");
  }
  return { ...body, marker_digest: canonicalDigest(body) };
}

function inspectCanonicalInstall(canonicalPath, markerPath, skillPath) {
  if (!realDirectory(canonicalPath)) {
    return fs.existsSync(canonicalPath)
      ? { status: "unsafe-or-incomplete", reason: "canonical plugin path is not a real directory" }
      : { status: "absent" };
  }
  const marker = readJson(markerPath);
  const packageMetadata = readJson(path.join(canonicalPath, "package.json"));
  const markerBody = marker && typeof marker === "object"
    ? Object.fromEntries(Object.entries(marker).filter(([key]) => key !== "marker_digest"))
    : null;
  const boundMarker = exactKeys(marker, PLUGIN_MARKER_KEYS) &&
    marker.plugin_install_marker_version === 2 &&
    marker.name === "killsloprouter" &&
    marker.install_contract === "trusted-package-payload-v1" &&
    marker.canonical_entrypoint === CANONICAL_SKILL_ENTRYPOINT &&
    typeof marker.version === "string" && marker.version === packageMetadata?.version &&
    DIGEST_PATTERN.test(marker.payload_digest || "") &&
    marker.payload_digest === pluginPayloadDigest(canonicalPath) &&
    DIGEST_PATTERN.test(marker.runtime_digest || "") &&
    marker.runtime_digest === pluginRuntimeDigest(canonicalPath) &&
    DIGEST_PATTERN.test(marker.canonical_skill_digest || "") &&
    marker.canonical_skill_digest === fileDigest(skillPath) &&
    marker.marker_digest === canonicalDigest(markerBody);
  const trustedMarker = boundMarker &&
    marker.payload_digest === trustedPluginPayloadDigest() &&
    runtimeMatchesTrustedPackage(canonicalPath) &&
    marker.canonical_skill_digest === trustedCanonicalSkillDigest();
  if (trustedMarker) {
    return {
      status: "installed",
      marker_digest: marker.marker_digest,
      payload_digest: marker.payload_digest,
      runtime_digest: marker.runtime_digest,
      canonical_skill_digest: marker.canonical_skill_digest,
      version: marker.version
    };
  }
  const previousBoundMarker = exactKeys(marker, PREVIOUS_PLUGIN_MARKER_KEYS) &&
    marker.plugin_install_marker_version === 1 &&
    marker.name === "killsloprouter" &&
    marker.installed_by === "scripts/install-codex-plugin.mjs" &&
    marker.canonical_entrypoint === CANONICAL_SKILL_ENTRYPOINT &&
    validTimestamp(marker.installed_at) &&
    typeof marker.source === "string" && marker.source.length > 0 &&
    typeof marker.version === "string" && marker.version === packageMetadata?.version &&
    DIGEST_PATTERN.test(marker.payload_digest || "") &&
    marker.payload_digest === pluginPayloadDigest(canonicalPath) &&
    DIGEST_PATTERN.test(marker.runtime_digest || "") &&
    marker.runtime_digest === pluginRuntimeDigest(canonicalPath) &&
    DIGEST_PATTERN.test(marker.canonical_skill_digest || "") &&
    marker.canonical_skill_digest === fileDigest(skillPath) &&
    marker.marker_digest === canonicalDigest(markerBody);
  const legacyMarker = exactKeys(marker, LEGACY_PLUGIN_MARKER_KEYS) &&
    marker.name === "killsloprouter" &&
    marker.installed_by === "scripts/install-codex-plugin.mjs" &&
    validTimestamp(marker.installed_at) &&
    typeof marker.version === "string" && marker.version.length > 0 &&
    typeof marker.source === "string" && marker.source.length > 0 &&
    fileDigest(skillPath) !== null;
  const trustedLegacyMarker = legacyMarker &&
    pluginPayloadDigest(canonicalPath) === trustedPluginPayloadDigest() &&
    runtimeMatchesTrustedPackage(canonicalPath) &&
    fileDigest(skillPath) === trustedCanonicalSkillDigest();
  return boundMarker || previousBoundMarker || trustedLegacyMarker
    ? {
        status: "refresh-required",
        reason: boundMarker || previousBoundMarker
          ? (boundMarker
              ? "canonical plugin is internally bound but differs from this reviewed installer payload; rerun with --force"
              : "canonical plugin uses the provenance-bearing marker v1; rerun with --force for deterministic payload identity")
          : "canonical plugin uses a pre-integrity marker over the exact trusted payload; rerun the installer with --force"
      }
    : {
        status: "unsafe-or-incomplete",
        reason: "canonical plugin marker, payload, runtime, or canonical skill failed integrity verification"
      };
}

function canonicalInstallBinding(canonical) {
  if (canonical?.status !== "installed") return null;
  return {
    marker_digest: canonical.marker_digest,
    payload_digest: canonical.payload_digest,
    runtime_digest: canonical.runtime_digest,
    canonical_skill_digest: canonical.canonical_skill_digest
  };
}

function validPreviousLegacyShim(marker, {
  skillPath,
  metadataPath,
  expectedBackupRoot,
  expectedBackupName,
  expectedSkillDigest,
  expectedMetadataDigest,
  backupSkillPath,
  markerBody
}) {
  return exactKeys(marker, PREVIOUS_LEGACY_SHIM_MARKER_KEYS) &&
    marker?.legacy_shim_version === 1 &&
    UUID_PATTERN.test(marker.migration_id || "") &&
    validTimestamp(marker.migrated_at) &&
    marker.canonical_entrypoint === CANONICAL_SKILL_ENTRYPOINT &&
    marker.legacy_entrypoint === LEGACY_SKILL_ENTRYPOINT &&
    exactKeys(marker.files, new Set(["skill", "metadata"])) &&
    marker.files?.skill === expectedSkillDigest &&
    marker.files?.skill === fileDigest(skillPath) &&
    marker.files?.metadata === expectedMetadataDigest &&
    marker.files?.metadata === fileDigest(metadataPath) &&
    exactKeys(marker.backup, new Set(["path", "digest"])) &&
    typeof marker.backup?.path === "string" &&
    path.basename(marker.backup.path) === expectedBackupName &&
    insideRealDirectory(marker.backup.path, expectedBackupRoot) &&
    fileDigest(backupSkillPath) !== null &&
    marker.backup?.digest === hashArtifact(marker.backup.path) &&
    marker.original_digest === marker.backup.digest &&
    marker.migration_digest === canonicalDigest(markerBody);
}

function inspectLegacyEntry(legacyPath, canonical) {
  if (!fs.existsSync(legacyPath)) return { status: "absent", path: legacyPath };
  if (!realDirectory(legacyPath)) {
    return { status: "unsafe", path: legacyPath, reason: "legacy entry is not a real directory" };
  }
  const markerPath = path.join(legacyPath, LEGACY_SHIM_MARKER);
  if (!fs.existsSync(markerPath)) {
    return {
      status: "full-entry",
      path: legacyPath,
      digest: hashArtifact(legacyPath),
      reason: "legacy local KillSlopRouter entry can compete with the namespaced V1 entry"
    };
  }
  const marker = readJson(markerPath);
  const skillPath = path.join(legacyPath, "SKILL.md");
  const metadataPath = path.join(legacyPath, "agents", "openai.yaml");
  const expectedBackupRoot = path.join(path.dirname(legacyPath), ".killsloprouter-backups");
  const markerBody = marker && typeof marker === "object"
    ? Object.fromEntries(Object.entries(marker).filter(([key]) => key !== "migration_digest"))
    : null;
  const expectedSkillDigest = sha256(Buffer.from(shimSkill()));
  const expectedMetadataDigest = sha256(Buffer.from(shimMetadata()));
  const backupSkillPath = typeof marker?.backup?.path === "string"
    ? path.join(marker.backup.path, "SKILL.md")
    : null;
  const expectedStamp = validTimestamp(marker?.migrated_at)
    ? marker.migrated_at.replace(/[-:.]/g, "")
    : null;
  const expectedBackupName = expectedStamp && UUID_PATTERN.test(marker?.migration_id || "")
    ? `kill-slop-router-${expectedStamp}-${marker.migration_id}`
    : null;
  const canonicalBinding = canonicalInstallBinding(canonical);
  const valid = exactKeys(marker, LEGACY_SHIM_MARKER_KEYS) &&
    marker?.legacy_shim_version === 2 &&
    marker.migration_contract === "explicit-backup-only-canonical-bound-v2" &&
    UUID_PATTERN.test(marker.migration_id || "") &&
    validTimestamp(marker.migrated_at) &&
    marker.canonical_entrypoint === CANONICAL_SKILL_ENTRYPOINT &&
    marker.legacy_entrypoint === LEGACY_SKILL_ENTRYPOINT &&
    exactKeys(marker.files, new Set(["skill", "metadata"])) &&
    marker.files?.skill === expectedSkillDigest &&
    marker.files?.skill === fileDigest(skillPath) &&
    marker.files?.metadata === expectedMetadataDigest &&
    marker.files?.metadata === fileDigest(metadataPath) &&
    exactKeys(marker.backup, new Set(["path", "digest"])) &&
    typeof marker.backup?.path === "string" &&
    path.basename(marker.backup.path) === expectedBackupName &&
    insideRealDirectory(marker.backup.path, expectedBackupRoot) &&
    fileDigest(backupSkillPath) !== null &&
    marker.backup?.digest === hashArtifact(marker.backup.path) &&
    marker.original_digest === marker.backup.digest &&
    canonicalBinding !== null &&
    exactKeys(marker.canonical_install, new Set([
      "marker_digest", "payload_digest", "runtime_digest", "canonical_skill_digest"
    ])) &&
    canonicalDigest(marker.canonical_install) === canonicalDigest(canonicalBinding) &&
    marker.migration_digest === canonicalDigest(markerBody);
  const previousValid = validPreviousLegacyShim(marker, {
    skillPath,
    metadataPath,
    expectedBackupRoot,
    expectedBackupName,
    expectedSkillDigest,
    expectedMetadataDigest,
    backupSkillPath,
    markerBody
  });
  return valid
    ? {
        status: "verified-explicit-shim",
        path: legacyPath,
        marker_path: markerPath,
        backup: marker.backup,
        original_digest: marker.original_digest,
        canonical_install: marker.canonical_install
      }
    : previousValid
      ? {
          status: "refresh-required-shim",
          path: legacyPath,
          marker_path: markerPath,
          backup: marker.backup,
          original_digest: marker.original_digest,
          previous_marker: marker,
          reason: "legacy shim uses marker v1 and must be explicitly rebound to the installed canonical payload"
        }
    : {
        status: "invalid-shim",
        path: legacyPath,
        marker_path: markerPath,
        reason: "legacy shim or its backup no longer matches its digest-bound migration receipt"
      };
}

export function inspectSkillCatalog({ home, assumeCanonical = false } = {}) {
  const resolvedHome = path.resolve(home);
  const canonicalPath = path.join(resolvedHome, "plugins", "killsloprouter");
  const canonicalMarker = path.join(canonicalPath, PLUGIN_INSTALL_MARKER);
  const canonicalSkill = path.join(canonicalPath, "skills", "kill-slop-router", "SKILL.md");
  const canonicalInspection = inspectCanonicalInstall(canonicalPath, canonicalMarker, canonicalSkill);
  let canonicalStatus = canonicalInspection.status;
  if (canonicalStatus === "absent" && assumeCanonical) canonicalStatus = "planned";

  const legacy = inspectLegacyEntry(
    path.join(resolvedHome, ".codex", "skills", LEGACY_SKILL_ENTRYPOINT),
    canonicalInspection
  );
  const canonicalActive = ["installed", "planned"].includes(canonicalStatus);
  const legacyConflict = [
    "full-entry", "invalid-shim", "refresh-required-shim", "unsafe"
  ].includes(legacy.status);
  const conflict = ["installed", "planned", "refresh-required"].includes(canonicalStatus) &&
    legacyConflict;
  const unsafeCanonical = ["unsafe-or-incomplete", "refresh-required"].includes(canonicalStatus);
  const status = conflict || unsafeCanonical
    ? "identity_conflict"
    : canonicalActive
      ? "ready"
      : "canonical_not_installed";
  const antislopPath = path.join(resolvedHome, ".codex", "skills", "antislop");
  let migration = { required: false };
  if (canonicalStatus === "unsafe-or-incomplete") {
    migration = {
      required: true,
      explicit_only: true,
      backup_only: true,
      kind: "manual-canonical-quarantine",
      command: null,
      reason: "move the unverified canonical plugin aside, then reinstall a reviewed commit"
    };
  } else if (canonicalStatus === "refresh-required") {
    migration = {
      required: true,
      explicit_only: true,
      backup_only: true,
      kind: conflict ? "canonical-refresh-and-legacy-shim" : "canonical-refresh",
      command: conflict
        ? "killsloprouter plugin install --force --migrate-legacy-entry"
        : "killsloprouter plugin install --force"
    };
  } else if (conflict) {
    migration = {
      required: true,
      explicit_only: true,
      backup_only: true,
      kind: "legacy-shim",
      command: "killsloprouter plugin install --force --migrate-legacy-entry"
    };
  }
  return {
    skill_catalog_version: 1,
    status,
    orchestrator: "KillSlopRouter",
    canonical_entrypoint: CANONICAL_SKILL_ENTRYPOINT,
    canonical: {
      ...canonicalInspection,
      status: canonicalStatus,
      path: canonicalPath,
      marker_path: canonicalMarker,
      skill_path: canonicalSkill
    },
    legacy,
    standalone_antislop: {
      status: realDirectory(antislopPath) ? "preserved" : "absent",
      path: antislopPath
    },
    identity_conflict: conflict || unsafeCanonical,
    migration
  };
}

export function shimSkill() {
  return `---
name: kill-slop-router
description: Compatibility shim for an explicit legacy $kill-slop-router invocation. Immediately hand control to the namespaced KillSlopRouter V1 entrypoint; never use this shim implicitly or execute creator, critic, browser, or approval work itself.
---

# KillSlopRouter legacy compatibility shim

This entry exists only for an explicit \`$kill-slop-router\` invocation.

Immediately continue with \`$${CANONICAL_SKILL_ENTRYPOINT}\` as the sole top-level
workflow. Present the active workflow as KillSlopRouter. Do not execute or expose
antislop, anti-slop, a creator, critic, scanner, or browser provider as a mode or
orchestrator. Those providers may run only as digest-bound internal participants
of the namespaced V1 journey.
`;
}

export function shimMetadata() {
  return `interface:
  display_name: "KillSlopRouter (legacy shim)"
  short_description: "Explicit compatibility handoff to namespaced V1"
  default_prompt: "Immediately continue with $${CANONICAL_SKILL_ENTRYPOINT} as the sole top-level KillSlopRouter workflow."

policy:
  allow_implicit_invocation: false
`;
}

export function migrateLegacySkillEntry({ home }) {
  const resolvedHome = path.resolve(home);
  const before = inspectSkillCatalog({ home: resolvedHome });
  if (before.canonical.status !== "installed") {
    throw new Error("legacy migration requires an installed, trusted canonical KillSlopRouter payload");
  }
  if (before.legacy.status === "absent") {
    return { status: "not_needed", before, after: before, backup: null };
  }
  if (before.legacy.status === "verified-explicit-shim") {
    return { status: "already_migrated", before, after: before, backup: before.legacy.backup };
  }
  const canonicalBinding = canonicalInstallBinding(before.canonical);
  if (before.legacy.status === "refresh-required-shim") {
    const previous = before.legacy.previous_marker;
    const marker = {
      legacy_shim_version: 2,
      migration_contract: "explicit-backup-only-canonical-bound-v2",
      migration_id: previous.migration_id,
      migrated_at: previous.migrated_at,
      legacy_entrypoint: LEGACY_SKILL_ENTRYPOINT,
      canonical_entrypoint: CANONICAL_SKILL_ENTRYPOINT,
      original_digest: previous.original_digest,
      backup: previous.backup,
      canonical_install: canonicalBinding,
      files: previous.files
    };
    marker.migration_digest = canonicalDigest(marker);
    writeJsonAtomic(before.legacy.marker_path, marker);
    const after = inspectSkillCatalog({ home: resolvedHome });
    if (after.legacy.status !== "verified-explicit-shim") {
      throw new Error("legacy shim marker refresh did not bind the installed canonical payload");
    }
    return { status: "rebound", before, after, backup: after.legacy.backup };
  }
  if (!realDirectory(before.legacy.path)) {
    throw new Error(`refusing to migrate unsafe legacy entry: ${before.legacy.path}`);
  }

  const originalDigest = hashArtifact(before.legacy.path);
  const backupRoot = path.join(resolvedHome, ".codex", "skills", ".killsloprouter-backups");
  fs.mkdirSync(backupRoot, { recursive: true });
  if (!realDirectory(backupRoot)) {
    throw new Error(`refusing a symlink or non-directory legacy backup root: ${backupRoot}`);
  }
  const migratedAt = new Date().toISOString();
  const stamp = migratedAt.replace(/[-:.]/g, "");
  const migrationId = crypto.randomUUID();
  const backupPath = path.join(backupRoot, `kill-slop-router-${stamp}-${migrationId}`);
  const staging = `${before.legacy.path}.shim-${process.pid}-${crypto.randomUUID()}`;
  let installedShim = false;
  try {
    fs.renameSync(before.legacy.path, backupPath);
    if (hashArtifact(backupPath) !== originalDigest) {
      throw new Error("legacy backup digest does not match the original entry");
    }
    fs.mkdirSync(path.join(staging, "agents"), { recursive: true });
    fs.writeFileSync(path.join(staging, "SKILL.md"), shimSkill(), { mode: 0o600 });
    fs.writeFileSync(path.join(staging, "agents", "openai.yaml"), shimMetadata(), { mode: 0o600 });
    const marker = {
      legacy_shim_version: 2,
      migration_contract: "explicit-backup-only-canonical-bound-v2",
      migration_id: migrationId,
      migrated_at: migratedAt,
      legacy_entrypoint: LEGACY_SKILL_ENTRYPOINT,
      canonical_entrypoint: CANONICAL_SKILL_ENTRYPOINT,
      original_digest: originalDigest,
      backup: { path: backupPath, digest: hashArtifact(backupPath) },
      canonical_install: canonicalBinding,
      files: {
        skill: hashArtifact(path.join(staging, "SKILL.md")),
        metadata: hashArtifact(path.join(staging, "agents", "openai.yaml"))
      }
    };
    marker.migration_digest = canonicalDigest(marker);
    writeJsonAtomic(path.join(staging, LEGACY_SHIM_MARKER), marker);
    fs.renameSync(staging, before.legacy.path);
    installedShim = true;
  } catch (error) {
    if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
    if (installedShim && fs.existsSync(before.legacy.path)) {
      fs.rmSync(before.legacy.path, { recursive: true, force: true });
    }
    if (fs.existsSync(backupPath)) fs.renameSync(backupPath, before.legacy.path);
    throw error;
  }
  const after = inspectSkillCatalog({ home: resolvedHome });
  if (after.legacy.status !== "verified-explicit-shim") {
    throw new Error("legacy entry migration did not produce a verified explicit-only shim");
  }
  return { status: "migrated", before, after, backup: after.legacy.backup };
}
