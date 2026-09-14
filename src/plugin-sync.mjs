import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { canonicalDigest, readJsonPinned, writeJsonAtomic } from "./integrity.mjs";
import { ensureSecureDirectory, secureExistingDirectory, secureExistingRegularFile, secureWritablePath, trustedPlatformPath, verifySecureDirectoryIdentity } from "./path-security.mjs";
import { createPluginInstallMarker, inspectSkillCatalog } from "./skill-catalog.mjs";

const MODES = ["shared", "per-account"];
const MAX_ACCOUNTS = 32;

function syncPaths(home) {
  const root = secureExistingDirectory(home, "plugin sync home");
  return {
    home: root,
    config: path.join(root, ".killsloprouter", "plugin-sync.json"),
    lock: path.join(root, ".killsloprouter", "plugin-sync.lock"),
    receipts: path.join(root, ".killsloprouter", "plugin-sync-receipts")
  };
}

function inside(child, parent) {
  const relative = path.relative(parent, child);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function accountPath(value, home) {
  if (typeof value !== "string" || !path.isAbsolute(value)) throw new Error("account home must be an absolute directory");
  const resolved = secureExistingDirectory(value, "Codex account home");
  if (!inside(resolved, home)) throw new Error("account home must be below the selected user home");
  const config = path.join(resolved, "config.toml");
  const plugins = path.join(resolved, "plugins");
  if (fs.existsSync(config)) secureExistingRegularFile(config, "Codex account configuration");
  else if (fs.existsSync(plugins)) secureExistingDirectory(plugins, "Codex account plugins");
  else throw new Error(`not an existing Codex account home: ${resolved}`);
  return resolved;
}

function validatePolicy(value, home) {
  if (!value || Object.keys(value).sort().join(",") !== "accounts,mode,plugin_sync_version" ||
      value.plugin_sync_version !== 1 || !MODES.includes(value.mode) ||
      !Array.isArray(value.accounts) || value.accounts.length > MAX_ACCOUNTS) {
    throw new Error("invalid plugin sync policy; expected version 1, mode shared|per-account, and accounts");
  }
  const accounts = value.accounts.map((entry) => {
    if (typeof entry !== "string" || !path.isAbsolute(entry)) throw new Error("account home must be an absolute directory");
    const resolved = trustedPlatformPath(entry);
    if (!inside(resolved, home)) throw new Error("account home must be below the selected user home");
    return resolved;
  });
  if (new Set(accounts).size !== accounts.length || accounts.some((a) => accounts.some((b) => a !== b && inside(a, b)))) {
    throw new Error("account homes must be unique and must not overlap");
  }
  if (value.mode === "shared" && !accounts.length) throw new Error("shared mode requires at least one enrolled account");
  return { plugin_sync_version: 1, mode: value.mode, accounts };
}

export function readPluginSyncPolicy(home = os.homedir()) {
  // Preserve the installer's supported first-install --home path, which may
  // not exist yet. Reading policy must not create that directory during preview.
  secureWritablePath(home, "plugin sync home");
  if (!fs.existsSync(home)) return { plugin_sync_version: 1, mode: "per-account", accounts: [] };
  const locations = syncPaths(home);
  secureWritablePath(locations.config, "plugin sync policy");
  if (!fs.existsSync(locations.config)) return { plugin_sync_version: 1, mode: "per-account", accounts: [] };
  return validatePolicy(readJsonPinned(locations.config).input, locations.home);
}

export function discoverPluginAccounts(home = os.homedir()) {
  const locations = syncPaths(home);
  const candidates = [path.join(locations.home, ".codex")];
  const parent = path.join(locations.home, ".codex-accounts");
  if (fs.existsSync(parent)) {
    secureExistingDirectory(parent, "Codex accounts directory");
    for (const entry of fs.readdirSync(parent, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.isSymbolicLink()) candidates.push(path.join(parent, entry.name));
    }
  }
  return candidates.filter((candidate) => {
    try { accountPath(candidate, locations.home); return true; } catch { return false; }
  }).sort();
}

function withSyncLock(locations, action) {
  const lock = secureWritablePath(locations.lock, "plugin sync lock");
  const parent = ensureSecureDirectory(path.dirname(lock), "plugin sync lock parent");
  verifySecureDirectoryIdentity(parent);
  let fd;
  try { fd = fs.openSync(lock, "wx", 0o600); } catch (error) {
    if (error.code === "EEXIST") throw new Error(`plugin sync already locked: ${lock}; inspect its owner before explicitly moving a stale lock aside`);
    throw error;
  }
  const token = crypto.randomUUID();
  try {
    verifySecureDirectoryIdentity(parent);
    const contents = JSON.stringify({ pid: process.pid, token, acquired_at: new Date().toISOString() });
    fs.writeFileSync(fd, contents);
    fs.fsyncSync(fd);
    const identity = fs.fstatSync(fd);
    try { return action(); } finally {
      verifySecureDirectoryIdentity(parent);
      const current = fs.lstatSync(lock);
      if (current.dev !== identity.dev || current.ino !== identity.ino || fs.readFileSync(lock,"utf8") !== contents) {
        throw new Error("plugin sync lock ownership changed; preserve the lock for inspection");
      }
      fs.unlinkSync(lock);
    }
  } finally { fs.closeSync(fd); }
}

function codexJson(account, args) {
  // CODEX_HOME is the child CLI's documented account selector, never a shared
  // credential directory or an executable taken from the sync policy.
  const result = spawnSync("codex", ["plugin", ...args, "--json"], {
    env: { ...process.env, CODEX_HOME: account },
    shell: false, encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024
  });
  if (result.error || result.status !== 0) throw new Error(`Codex plugin ${args[0]} failed (${result.error?.code || result.status}); retry after checking this account's CLI`);
  try { return JSON.parse(result.stdout); } catch { throw new Error(`Codex plugin ${args[0]} returned invalid JSON`); }
}

function targetPlugin(home) {
  const catalog = inspectSkillCatalog({ home });
  if (catalog.status !== "ready" || catalog.canonical.status !== "installed") {
    throw new Error(`canonical plugin is ${catalog.canonical.status}; complete the explicit plugin installation/migration first`);
  }
  const source = secureExistingDirectory(catalog.canonical.path, "canonical plugin");
  const manifest = readJsonPinned(path.join(source, ".codex-plugin", "plugin.json")).input;
  if (manifest.name !== "killsloprouter" || !/^[a-zA-Z0-9][a-zA-Z0-9.+_-]*$/.test(manifest.version || "")) throw new Error("invalid canonical plugin version");
  const marketplace = readJsonPinned(path.join(home, ".agents", "plugins", "marketplace.json")).input;
  const entries = marketplace.plugins?.filter((entry) => entry.name === "killsloprouter");
  if (!/^[a-zA-Z0-9_-]+$/.test(marketplace.name || "") || entries?.length !== 1 ||
      entries[0].source?.source !== "local" || entries[0].source?.path !== "./plugins/killsloprouter") {
    throw new Error("plugin sync requires one canonical local marketplace entry");
  }
  return {
    version: manifest.version, package_version: catalog.canonical.version,
    source, marketplace: marketplace.name,
    marker_digest: catalog.canonical.marker_digest,
    payload_digest: catalog.canonical.payload_digest,
    runtime_digest: catalog.canonical.runtime_digest,
    canonical_skill_digest: catalog.canonical.canonical_skill_digest
  };
}

function accountStorage(account, enrolled) {
  const plugins = path.join(account, "plugins");
  const stat = fs.lstatSync(plugins, { throwIfNoEntry: false });
  if (!stat?.isSymbolicLink()) return { root: secureWritablePath(plugins, "account plugins"), shared_with: null };
  const link = fs.readlinkSync(plugins);
  const destination = trustedPlatformPath(path.resolve(path.dirname(plugins), link));
  const owner = enrolled.find((candidate) => candidate !== account && path.join(candidate, "plugins") === destination);
  if (!owner) throw new Error("shared plugin folder must point directly to another enrolled account's real plugins directory");
  if (process.getuid && stat.uid !== process.getuid()) throw new Error("shared plugin folder link must belong to the current user");
  return {
    root: secureExistingDirectory(destination, "enrolled shared plugin folder"), shared_with: owner,
    link_path: plugins, link_value: link, link_device: stat.dev, link_inode: stat.ino
  };
}

function verifyStorage(storage, target) {
  if (storage.link_path) {
    const stat = fs.lstatSync(storage.link_path);
    if (!stat.isSymbolicLink() || stat.dev !== storage.link_device || stat.ino !== storage.link_inode ||
        fs.readlinkSync(storage.link_path) !== storage.link_value) throw new Error("shared plugin folder link changed during synchronization");
  }
  return secureWritablePath(path.join(storage.root, "cache", target.marketplace, "killsloprouter", target.version), "account plugin cache");
}

function verifyCache(storage, entry, target) {
  if (entry.source?.source !== "local" || typeof entry.source.path !== "string" ||
      secureExistingDirectory(entry.source.path, "account plugin source") !== target.source) throw new Error("account plugin points at a different source");
  if (entry.version !== target.version) return false;
  const cache = verifyStorage(storage, target);
  secureExistingDirectory(cache, "account plugin cache");
  const marker = createPluginInstallMarker({ root: cache, version: target.package_version });
  if (["marker_digest", "payload_digest", "runtime_digest", "canonical_skill_digest"].some((key) => marker[key] !== target[key])) {
    throw new Error("account cache does not match the canonical payload; do not overwrite a conflicting cache silently");
  }
  return true;
}

function inspectCachedAccount(account, target, storage) {
  const cache = verifyStorage(storage, target);
  const present = fs.existsSync(cache);
  if (present) verifyCache(storage, { version: target.version, source: { source: "local", path: target.source } }, target);
  return {
    account_home: account, status: present ? "cached" : "cache_missing",
    cached_version: present ? target.version : null, activation_verified: false,
    cache_shared_with: storage.shared_with
  };
}

function inspectAccount(account, target, storage) {
  verifyStorage(storage, target);
  const response = codexJson(account, ["list", "--marketplace", target.marketplace]);
  verifyStorage(storage, target);
  if (!Array.isArray(response.installed)) throw new Error("unrecognized Codex plugin list response");
  const entries = response.installed.filter((entry) => entry.pluginId === `killsloprouter@${target.marketplace}`);
  if (entries.length > 1) throw new Error("duplicate account plugin entries");
  if (!entries.length) return { account_home: account, status: "missing", installed_version: null };
  const entry = entries[0];
  if (entry.installed !== true || typeof entry.enabled !== "boolean") throw new Error("invalid Codex installed-plugin metadata");
  // Disabled plugins stay disabled; add would otherwise silently enable them.
  if (!entry.enabled) return { account_home: account, status: "disabled", installed_version: entry.version };
  const matches = verifyCache(storage, entry, target);
  return { account_home: account, status: matches ? "synced" : "outdated", installed_version: entry.version };
}

function sameTarget(home, target) {
  if (canonicalDigest(targetPlugin(home)) !== canonicalDigest(target)) throw new Error("canonical plugin changed during account sync; retry against one installed version");
}

function inspectOrSyncAccount(account, target, { apply, home, enrolled }) {
  try {
    accountPath(account, home);
    const storage = accountStorage(account, enrolled);
    sameTarget(home, target);
    // Inspect existing bytes before any CLI call: list can refresh local caches
    // and must not erase evidence of a conflicting same-version payload.
    const cached = inspectCachedAccount(account, target, storage);
    if (!apply) return cached;
    // Codex can refresh local caches while listing plugins. Query it only on
    // explicit apply, after validating every filesystem destination.
    const before = inspectAccount(account, target, storage);
    if (!["missing", "outdated"].includes(before.status)) return { ...before, cache_shared_with: storage.shared_with };
    verifyStorage(storage, target);
    const result = codexJson(account, ["add", `killsloprouter@${target.marketplace}`]);
    if (result.pluginId !== `killsloprouter@${target.marketplace}` || result.version !== target.version) throw new Error("Codex installed a different plugin or version");
    sameTarget(home, target);
    const after = inspectAccount(account, target, storage);
    if (after.status !== "synced") throw new Error("account plugin was not verified after installation");
    return { ...after, previous_version: before.installed_version, changed: true, cache_shared_with: storage.shared_with };
  } catch (error) {
    return { account_home: account, status: "failed", error: error.message };
  }
}

function performSync(locations, policy, apply) {
  const report = {
    plugin_sync_receipt_version: 1,
    mode: policy.mode, policy_digest: canonicalDigest(policy),
    config_path: locations.config, applied: apply && policy.mode === "shared",
    accounts: [], target: null, blockers: [],
    next: "start a new Codex thread after syncing; existing threads keep their loaded skills"
  };
  try {
    report.target = targetPlugin(locations.home);
    report.accounts = policy.accounts.map((account) => inspectOrSyncAccount(account, report.target, {
      home: locations.home, apply: report.applied, enrolled: policy.accounts
    }));
    sameTarget(locations.home, report.target);
    if (apply && canonicalDigest(readPluginSyncPolicy(locations.home)) !== report.policy_digest) throw new Error("plugin sync policy changed during activation");
  } catch (error) { report.blockers.push(error.message); }
  report.status = report.blockers.length || report.accounts.some((account) => account.status === "failed")
    ? "blocked"
    : policy.mode === "per-account" ? "per-account"
    : report.accounts.every((account) => account.status === "synced") ? "synced"
    : report.accounts.every((account) => account.status === "cached") ? "verification_required" : "sync_required";
  report.ok = ["synced", "per-account"].includes(report.status);
  if (apply) {
    report.recorded_at = new Date().toISOString();
    const file = path.join(locations.receipts, `${crypto.randomUUID()}.json`);
    report.receipt_path = file;
    report.receipt_digest = canonicalDigest(report);
    writeJsonAtomic(secureWritablePath(file, "plugin sync receipt"), report);
  }
  return report;
}

// Exported for a settings UI: dry-run previews the toggle, configure saves it,
// and apply performs bounded official Codex plugin installs for enrolled homes.
export function pluginAccountSync({ home = os.homedir(), mode, accounts, discover = false, dryRun = false, apply = false } = {}) {
  const locations = syncPaths(home);
  const work = () => {
    const previous = readPluginSyncPolicy(locations.home);
    if (discover && accounts !== undefined) throw new Error("choose explicit account homes or discovery, not both");
    const requested = accounts ?? (discover ? discoverPluginAccounts(locations.home) : previous.accounts);
    const policy = validatePolicy({ ...previous, mode: mode ?? previous.mode, accounts: requested }, locations.home);
    if (accounts !== undefined || discover) policy.accounts = policy.accounts.map((account) => accountPath(account, locations.home));
    const changing = mode !== undefined || accounts !== undefined || discover;
    if (changing && !dryRun) {
      if (fs.existsSync(locations.config)) {
        const backup = secureWritablePath(`${locations.config}.bak.${crypto.randomUUID()}`, "plugin sync policy backup");
        fs.copyFileSync(locations.config, backup, fs.constants.COPYFILE_EXCL);
      }
      writeJsonAtomic(locations.config, policy);
    }
    const report = performSync(locations, policy, apply && !dryRun);
    return { ...report, dry_run: dryRun, policy_saved: changing && !dryRun, discovered_accounts: discoverPluginAccounts(locations.home) };
  };
  return (apply && !dryRun) || ((mode !== undefined || accounts !== undefined || discover) && !dryRun)
    ? withSyncLock(locations, work) : work();
}
