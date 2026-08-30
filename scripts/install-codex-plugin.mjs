#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
  createPluginInstallMarker,
  inspectSkillCatalog,
  migrateLegacySkillEntry,
  PLUGIN_BUNDLE_ENTRIES
} from "../src/skill-catalog.mjs";

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MARKER = ".killsloprouter-plugin-installed.json";
const RUNTIME_PACKAGES = ["axe-core", "playwright-core"];
const requireFromSource = createRequire(path.join(sourceRoot, "package.json"));

function parseArgs(argv) {
  const args = { activate: true };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--dry-run") args.dryRun = true;
    else if (token === "--force") args.force = true;
    else if (token === "--migrate-legacy-entry") args.migrateLegacyEntry = true;
    else if (token === "--no-activate") args.activate = false;
    else if (token === "--home") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error("--home requires a directory");
      args.home = value;
      index += 1;
    } else if (token === "--help" || token === "-h") args.help = true;
    else throw new Error(`unknown option: ${token}`);
  }
  return args;
}

function help() {
  return `Install the KillSlopRouter Codex plugin\n\nUsage:\n  node scripts/install-codex-plugin.mjs [--dry-run] [--force] [--migrate-legacy-entry] [--no-activate] [--home DIR]\n`;
}

function readJson(file, label) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`cannot read ${label} at ${file}: ${error.message}`);
  }
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

function timestamp() {
  return new Date().toISOString().replace(/[-:.]/g, "");
}

function marketplaceEntry() {
  return {
    name: "killsloprouter",
    source: { source: "local", path: "./plugins/killsloprouter" },
    policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
    category: "Developer Tools"
  };
}

function nextMarketplace(file) {
  const data = fs.existsSync(file)
    ? readJson(file, "personal marketplace")
    : { name: "personal", interface: { displayName: "Personal" }, plugins: [] };
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("personal marketplace root must be a JSON object");
  }
  if (!data.name || typeof data.name !== "string") data.name = "personal";
  if (!data.interface || typeof data.interface !== "object" || Array.isArray(data.interface)) {
    data.interface = { displayName: "Personal" };
  }
  if (!data.interface.displayName) data.interface.displayName = "Personal";
  if (!Array.isArray(data.plugins)) throw new Error("personal marketplace plugins must be an array");
  data.plugins = [
    ...data.plugins.filter((entry) => !(entry && typeof entry === "object" && entry.name === "killsloprouter")),
    marketplaceEntry()
  ];
  return data;
}

function copyBundle(target, { force }) {
  for (const entry of PLUGIN_BUNDLE_ENTRIES) {
    if (!fs.existsSync(path.join(sourceRoot, entry))) throw new Error(`plugin bundle is missing ${entry}`);
  }
  if (fs.existsSync(target)) {
    if (!force) throw new Error(`plugin target exists: ${target}; rerun with --force to refresh a marked install`);
    if (!fs.existsSync(path.join(target, MARKER))) {
      throw new Error(`refusing to replace unmarked plugin target: ${target}`);
    }
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });
  const staging = path.join(path.dirname(target), `.killsloprouter-install-${process.pid}-${crypto.randomUUID()}`);
  fs.mkdirSync(staging, { recursive: false });
  let backup = null;
  try {
    for (const entry of PLUGIN_BUNDLE_ENTRIES) {
      fs.cpSync(path.join(sourceRoot, entry), path.join(staging, entry), {
        recursive: true,
        errorOnExist: true,
        force: false
      });
    }
    const runtimeRoot = path.join(staging, ".runtime");
    for (const packageName of RUNTIME_PACKAGES) {
      let packageFile;
      try {
        packageFile = requireFromSource.resolve(`${packageName}/package.json`);
      } catch (error) {
        throw new Error(`runtime dependency ${packageName} is missing; run npm install --ignore-scripts (${error.message})`);
      }
      const source = path.dirname(packageFile);
      const destination = path.join(runtimeRoot, "node_modules", ...packageName.split("/"));
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.cpSync(source, destination, { recursive: true, errorOnExist: true, force: false });
    }
    writeJsonAtomic(path.join(runtimeRoot, "package.json"), {
      private: true,
      name: "killsloprouter-browser-runtime",
      version: "1.0.0"
    });
    const packageJson = readJson(path.join(sourceRoot, "package.json"), "package metadata");
    writeJsonAtomic(path.join(staging, MARKER), createPluginInstallMarker({
      root: staging,
      version: packageJson.version
    }));

    if (fs.existsSync(target)) {
      const backupRoot = path.join(path.dirname(target), ".killsloprouter-backups");
      fs.mkdirSync(backupRoot, { recursive: true });
      backup = path.join(backupRoot, `killsloprouter-${timestamp()}-${crypto.randomUUID()}`);
      fs.renameSync(target, backup);
    }
    fs.renameSync(staging, target);
    return backup;
  } catch (error) {
    if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
    if (backup && fs.existsSync(backup) && !fs.existsSync(target)) fs.renameSync(backup, target);
    throw error;
  }
}

function updateMarketplace(file, value) {
  let backup = null;
  if (fs.existsSync(file)) {
    backup = `${file}.bak.${timestamp()}-${crypto.randomUUID()}`;
    fs.copyFileSync(file, backup, fs.constants.COPYFILE_EXCL);
  }
  writeJsonAtomic(file, value);
  return backup;
}

function activatePlugin(marketplaceName) {
  const result = spawnSync("codex", ["plugin", "add", `killsloprouter@${marketplaceName}`, "--json"], {
    encoding: "utf8",
    shell: false,
    timeout: 30000
  });
  if (result.error || result.status !== 0) {
    return {
      ok: false,
      status: result.status,
      error: result.error?.message || null,
      stdout: result.stdout?.trim() || "",
      stderr: result.stderr?.trim() || ""
    };
  }
  try {
    return { ok: true, result: JSON.parse(result.stdout || "{}") };
  } catch {
    return { ok: true, stdout: result.stdout?.trim() || "" };
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(help());
    return;
  }
  const installHome = path.resolve(args.home || os.homedir());
  if (installHome === path.parse(installHome).root) {
    throw new Error("refusing to use a filesystem root as the plugin home");
  }
  const target = path.join(installHome, "plugins", "killsloprouter");
  const marketplace = path.join(installHome, ".agents", "plugins", "marketplace.json");
  const marketplaceValue = nextMarketplace(marketplace);
  const isDefaultHome = installHome === path.resolve(os.homedir());
  const catalogBefore = inspectSkillCatalog({ home: installHome, assumeCanonical: true });
  const canonicalBlocked = catalogBefore.canonical.status === "unsafe-or-incomplete" ||
    (catalogBefore.canonical.status === "refresh-required" && !args.force);
  const legacyConflict = ["full-entry", "invalid-shim", "refresh-required-shim", "unsafe"].includes(
    catalogBefore.legacy.status
  );
  const legacyBlocked = legacyConflict && !args.migrateLegacyEntry;
  if (canonicalBlocked || legacyBlocked) {
    process.stdout.write(`${JSON.stringify({
      ok: false,
      status: "identity_conflict",
      skill_catalog: catalogBefore,
      next: catalogBefore.canonical.status === "refresh-required"
        ? (legacyBlocked
            ? "killsloprouter plugin install --force --migrate-legacy-entry"
            : "killsloprouter plugin install --force")
        : canonicalBlocked
          ? "move the unverified canonical plugin aside, then reinstall"
        : catalogBefore.migration.command
    }, null, 2)}\n`);
    process.exitCode = 5;
    return;
  }
  if (args.dryRun) {
    process.stdout.write(`${JSON.stringify({
      ok: true,
      dry_run: true,
      source: sourceRoot,
      plugin_target: target,
      marketplace,
      marketplace_name: marketplaceValue.name,
      would_replace_marked_install: fs.existsSync(target) && Boolean(args.force),
      would_activate: args.activate && isDefaultHome,
      would_migrate_legacy_entry: Boolean(args.migrateLegacyEntry &&
        catalogBefore.legacy.status !== "absent" &&
        catalogBefore.legacy.status !== "verified-explicit-shim"),
      skill_catalog: catalogBefore
    }, null, 2)}\n`);
    return;
  }

  const pluginBackup = copyBundle(target, { force: Boolean(args.force) });
  const legacyMigration = args.migrateLegacyEntry
    ? migrateLegacySkillEntry({ home: installHome })
    : { status: "not_requested", backup: null };
  const marketplaceBackup = updateMarketplace(marketplace, marketplaceValue);
  const activation = args.activate && isDefaultHome
    ? activatePlugin(marketplaceValue.name)
    : { ok: true, skipped: true, reason: isDefaultHome ? "--no-activate" : "non-default home" };
  process.stdout.write(`${JSON.stringify({
    ok: activation.ok,
    plugin_target: target,
    plugin_backup: pluginBackup,
    legacy_migration: legacyMigration,
    marketplace,
    marketplace_backup: marketplaceBackup,
    marketplace_name: marketplaceValue.name,
    activation,
    skill_catalog: inspectSkillCatalog({ home: installHome }),
    next: "start a new Codex thread and invoke $killsloprouter:kill-slop-router"
  }, null, 2)}\n`);
  if (!activation.ok) process.exitCode = 5;
}

try {
  main();
} catch (error) {
  process.stderr.write(`KillSlopRouter plugin install: ${error.message}\n`);
  process.exitCode = 2;
}
