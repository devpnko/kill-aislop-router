import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { canonicalDigest, hashArtifact, writeJsonAtomic } from "./integrity.mjs";

export const CANONICAL_SKILL_ENTRYPOINT = "killsloprouter:kill-slop-router";
export const LEGACY_SKILL_ENTRYPOINT = "kill-slop-router";
export const LEGACY_SHIM_MARKER = ".killsloprouter-legacy-shim.json";
export const PLUGIN_INSTALL_MARKER = ".killsloprouter-plugin-installed.json";

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

function inspectLegacyEntry(legacyPath) {
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
  const valid = marker?.legacy_shim_version === 1 &&
    marker.canonical_entrypoint === CANONICAL_SKILL_ENTRYPOINT &&
    marker.legacy_entrypoint === LEGACY_SKILL_ENTRYPOINT &&
    marker.files?.skill === fileDigest(skillPath) &&
    marker.files?.metadata === fileDigest(metadataPath) &&
    typeof marker.backup?.path === "string" &&
    insideRealDirectory(marker.backup.path, expectedBackupRoot) &&
    marker.backup?.digest === hashArtifact(marker.backup.path) &&
    marker.original_digest === marker.backup.digest &&
    marker.migration_digest === canonicalDigest(markerBody);
  return valid
    ? {
        status: "verified-explicit-shim",
        path: legacyPath,
        marker_path: markerPath,
        backup: marker.backup,
        original_digest: marker.original_digest
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
  const canonicalExists = realDirectory(canonicalPath);
  const canonicalMarked = canonicalExists && fileDigest(canonicalMarker) !== null;
  const canonicalSkillExists = canonicalExists && fileDigest(canonicalSkill) !== null;
  let canonicalStatus = "absent";
  if (canonicalExists && canonicalMarked && canonicalSkillExists) canonicalStatus = "installed";
  else if (canonicalExists) canonicalStatus = "unsafe-or-incomplete";
  else if (assumeCanonical) canonicalStatus = "planned";

  const legacy = inspectLegacyEntry(path.join(resolvedHome, ".codex", "skills", LEGACY_SKILL_ENTRYPOINT));
  const canonicalActive = ["installed", "planned"].includes(canonicalStatus);
  const conflict = canonicalActive && ["full-entry", "invalid-shim", "unsafe"].includes(legacy.status);
  const unsafeCanonical = canonicalStatus === "unsafe-or-incomplete";
  const status = conflict || unsafeCanonical
    ? "identity_conflict"
    : canonicalActive
      ? "ready"
      : "canonical_not_installed";
  const antislopPath = path.join(resolvedHome, ".codex", "skills", "antislop");
  return {
    skill_catalog_version: 1,
    status,
    orchestrator: "KillSlopRouter",
    canonical_entrypoint: CANONICAL_SKILL_ENTRYPOINT,
    canonical: {
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
    migration: conflict
      ? {
          required: true,
          explicit_only: true,
          backup_only: true,
          command: "killsloprouter plugin install --force --migrate-legacy-entry"
        }
      : { required: false }
  };
}

function shimSkill() {
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

function shimMetadata() {
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
  const before = inspectSkillCatalog({ home: resolvedHome, assumeCanonical: true });
  if (before.legacy.status === "absent") {
    return { status: "not_needed", before, after: before, backup: null };
  }
  if (before.legacy.status === "verified-explicit-shim") {
    return { status: "already_migrated", before, after: before, backup: before.legacy.backup };
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
  const stamp = new Date().toISOString().replace(/[-:.]/g, "");
  const backupPath = path.join(backupRoot, `kill-slop-router-${stamp}-${crypto.randomUUID()}`);
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
      legacy_shim_version: 1,
      migration_id: crypto.randomUUID(),
      migrated_at: new Date().toISOString(),
      legacy_entrypoint: LEGACY_SKILL_ENTRYPOINT,
      canonical_entrypoint: CANONICAL_SKILL_ENTRYPOINT,
      original_digest: originalDigest,
      backup: { path: backupPath, digest: hashArtifact(backupPath) },
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
