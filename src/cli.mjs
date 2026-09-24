import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  auditExitCode,
  dispatchAuditPackets,
  finalizeAudit,
  formatAuditReceipt,
  initializeAudit,
  recordAuditResult,
  recordTriage,
  writeJsonAtomic
} from "./audit.mjs";
import {
  RouterError,
  findProjectProfile,
  formatReceipt,
  inspectSurfaceContract,
  inspectVisualIntents,
  inspectVisualSignatures,
  planRoute,
  readJson,
  resolveDesignSystem,
  validateProfile
} from "./router.mjs";
import { runKillAiSlop } from "./adapters/kill-ai-slop.mjs";
import {
  automationExitCode,
  dryRunAutomation,
  inspectAutomationStateLease,
  recoverAutomationStateLease,
  resumeAutomation,
  startAutomation
} from "./automation.mjs";
import { loadHostManifest } from "./execution.mjs";
import { hashArtifact, readJsonPinned } from "./integrity.mjs";
import { bootstrapProject } from "./bootstrap.mjs";
import { configurePlaywright, createBrowserAttestation } from "./playwright.mjs";
import {
  assertDesignReferenceRequirement,
  designReferenceDelivery,
  designExitCode,
  dispatchDesignPackets,
  dryRunDesignExploration,
  inspectDesignStateLease,
  readDesignState,
  recoverDesignStateLease,
  resumeDesignExploration,
  startDesignExploration
} from "./design.mjs";
import {
  dispatchReferencePackets,
  dryRunReferenceIntelligence,
  readReferenceChoices,
  readReferenceState,
  recoverReferenceStateLease,
  referenceExitCode,
  resumeReferenceIntelligence,
  startReferenceIntelligence
} from "./reference.mjs";
import { configureCodexReviewers } from "./codex.mjs";
import { inspectSkillCatalog } from "./skill-catalog.mjs";
import { pluginAccountSync } from "./plugin-sync.mjs";
import { secureExistingRegularFile, secureWritablePath } from "./path-security.mjs";
import { sealedEntrypointGraphDigest } from "./sealed-entrypoint.mjs";
import {
  automationGuidance, designReferenceGuidance, doctorNextActions, referenceChoicesGuidance
} from "./usage-guidance.mjs";
import { inspectDistribution } from "./distribution.mjs";
import { loadReferenceLibrary, referenceLibraryReport, formatReferenceLibrary } from "./reference-library.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultRouterPath = path.join(packageRoot, "router", "default-router.json");
const BOOLEAN_OPTIONS = new Set([
  "replace",
  "require-owner",
  "dry-run",
  "json",
  "force",
  "no-activate",
  "apply",
  "discover-accounts",
  "allow-external",
  "migrate-identity",
  "migrate-legacy-entry",
  "module-graph",
  "require-reference"
]);
const PLUGIN_SYNC_OPTIONS = new Set([
  "home", "mode", "account-home", "discover-accounts", "apply", "dry-run", "json", "format"
]);

function parseArgs(argv) {
  const args = {
    command: "plan",
    subcommand: null,
    changes: [],
    artifacts: [],
    results: [],
    risk: "standard",
    format: "text"
  };
  let index = 0;
  if (argv[0] && !argv[0].startsWith("-")) {
    args.command = argv[0];
    index = 1;
  }
  if (["audit", "browser", "design", "host", "lease", "plugin", "reference"].includes(args.command) && argv[index] && !argv[index].startsWith("-")) {
    args.subcommand = argv[index];
    index += 1;
  }
  const libraryLookup = args.command === "reference" && args.subcommand === "library";
  const libraryOptions = new Set(["component", "source", "query", "details", "json", "format", "help"]);
  const librarySeen = new Set();
  for (; index < argv.length; index += 1) {
    const token = argv[index];
    if (libraryLookup) {
      const key = token === "-h" ? "help" : token.startsWith("--") ? token.slice(2) : null;
      if (!libraryOptions.has(key) || librarySeen.has(key)) throw new RouterError(`unknown or repeated reference library option: ${token}`, 2);
      librarySeen.add(key);
      if (key === "details") { args.details = true; continue; }
    }
    if (token === "--help" || token === "-h") {
      args.help = true;
      continue;
    }
    if (!token.startsWith("--")) throw new RouterError(`unexpected argument: ${token}`, 2);
    const key = token.slice(2);
    if (key === "require-reference" &&
        !(args.command === "design" && ["run", "status", "provenance", "dispatch"].includes(args.subcommand))) {
      throw new RouterError("--require-reference is only supported by design run/status/provenance/dispatch", 2);
    }
    if (args.command === "plugin" && args.subcommand === "sync" && !PLUGIN_SYNC_OPTIONS.has(key)) {
      throw new RouterError(`unknown plugin sync option: --${key}`, 2);
    }
    if (BOOLEAN_OPTIONS.has(key)) {
      args[key] = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new RouterError(`missing value for --${key}`, 2);
    index += 1;
    if (key === "changes") {
      args.changes = value.split(",").map((item) => item.trim()).filter(Boolean);
    } else if (key === "artifact") {
      args.artifacts.push(value);
    } else if (key === "result") {
      args.results.push(value);
      args.result = value;
    } else if (["skill-provider", "account-home"].includes(key)) {
      args[key] ||= [];
      args[key].push(value);
    } else {
      args[key] = value;
    }
  }
  if (libraryLookup && (!["text", "json"].includes(args.format) ||
      (librarySeen.has("format") && args.json && args.format !== "json"))) {
    throw new RouterError("reference library format must be text or json and agree with --json", 2);
  }
  return args;
}

function help() {
  return `KillSlopRouter

Start here:
  1. Install the reviewed Codex plugin once (see README.md#codex-plugin).
  2. In your project, start a new Codex thread and say:
     Use $killsloprouter:kill-slop-router to inspect this project's current UI and continue the safest eligible journey.
  3. For direct CLI use, run "killsloprouter doctor" before "run --dry-run".

The plugin is the parent workflow; reviewers such as anti-slop are internal children.
Missing visual authority, adapters, browser evidence, or owner approval are hard stops.
Account plugin versions default to shared; an explicit per-account OFF preference is preserved.
For a new visual direction, review UI Bowl choices before creation; a ranked reference is not Owner approval.
Guide (bundled): ${path.join(packageRoot, "docs", "getting-started.md")}
Project setup (bundled): ${path.join(packageRoot, "docs", "project-setup.md")}

Usage:
  killsloprouter capabilities [--json]
  killsloprouter plugin install [--dry-run] [--force] [--migrate-legacy-entry] [--no-activate] [--home DIR]
  killsloprouter plugin sync [--mode shared|per-account] [--account-home DIR ... | --discover-accounts] [--apply] [--dry-run] [--json]
  killsloprouter host configure-codex --runtime FILE --model MODEL --agent-providers ID,ID [options]
  killsloprouter host configure-codex --runtime FILE --model MODEL --skill-provider ID=DIR [options]
  killsloprouter browser configure --base-url URL --required-scenarios ID,ID [--scenario FILE] [options]
  killsloprouter browser attest --artifact PATH --out FILE [--root DIR]
  killsloprouter design run --brief FILE --baseline PATH --out FILE [--host-config FILE] [--require-reference]
  killsloprouter design run --resume FILE [--host-config FILE] [--shortlist FILE] [--approval FILE]
  killsloprouter design status --run FILE [--json]
  killsloprouter design provenance --run FILE [--json]
  killsloprouter design dispatch --run FILE --out-dir DIR
  killsloprouter design lease-status --state FILE [--json]
  killsloprouter design recover --state FILE --owner-token TOKEN --acquired-at TIMESTAMP --state-digest DIGEST [--json]
  killsloprouter reference run --brief FILE --out FILE [--host-config FILE]
  killsloprouter reference run --resume FILE [--host-config FILE] [--selection FILE]
  killsloprouter reference status --run FILE [--json]
  killsloprouter reference choices --run FILE [--json]
  killsloprouter reference library [--component ID] [--source ID] [--query TEXT] [--details] [--json]
  killsloprouter reference dispatch --run FILE --out-dir DIR
  killsloprouter reference recover --state FILE --owner-token TOKEN --acquired-at TIMESTAMP --state-digest DIGEST
  killsloprouter bootstrap --project-id ID --locale LOCALE --surface SURFACE [--root DIR] [--json]
  killsloprouter plan [--surface SURFACE] --task TASK [--artifact PATH] [options]
  killsloprouter run [--surface SURFACE] --task TASK --artifact PATH --scope SCOPE --out FILE [options]
  killsloprouter run --task redesign --scope runtime --observation-run FILE [options]
  killsloprouter run --resume FILE --authority-digest SHA256 [--host-config FILE] [--triage FILE] [--approval FILE] [--retry SELECTOR]
  killsloprouter lease status --state FILE [--json]
  killsloprouter lease recover --state FILE --owner-token TOKEN --acquired-at TIMESTAMP --state-digest DIGEST [--authority-digest SHA256] [--legacy-backup FILE] [--json]
  killsloprouter scan --adapter kill-ai-slop --adapter-root DIR --target PATH
  killsloprouter digest --target PATH [--module-graph] [--json]
  killsloprouter doctor [--profile FILE] [--format text|json]
  killsloprouter audit init --plan FILE --artifact PATH --scope SCOPE --out FILE [options]
  killsloprouter audit dispatch --run FILE --out-dir DIR --authority-digest SHA256
  killsloprouter audit record --run FILE --result FILE --authority-digest SHA256 [--replace]
  killsloprouter audit triage --run FILE --triage FILE --authority-digest SHA256 [--replace]
  killsloprouter audit status --run FILE --authority-digest SHA256 [--format text|json]
  killsloprouter audit finalize --run FILE --authority-digest SHA256 [--approval FILE] [--out FILE] [--require-owner]

Surfaces:
  operator-product-ui
  consumer-product-ui
  marketing-editorial

Tasks:
  build, redesign, systemize, runtime-handoff, audit, copy, pr-hygiene

Audit scopes:
  mockup, runtime, source, document

Options:
  --project-id ID
  --locale LOCALE
  --surface operator-product-ui|consumer-product-ui|marketing-editorial
  --root DIR
  --direction approved|missing|reference|none
  --changes source,copy,style,layout,interaction,state,data,authority
  --risk standard|high
  --scope mockup|runtime|source|document
  --profile /path/to/profile.json
  --router /path/to/router.json
  --creator-id ID
  --observation-run FILE (required for runtime redesign; points to the pre-change audit state)
  --host-config FILE
  --runtime FILE
  --runtime-root DIR
  --model MODEL
  --agent-providers ID,ID
  --skill-provider ID=DIR (repeatable; anti-slop must use this form)
  --timeout-ms NUMBER
  --max-output-bytes NUMBER
  --brief FILE
  --baseline PATH
  --shortlist FILE
  --base-url URL
  --channel chrome|msedge|chromium|bundled
  --scenario FILE
  --required-scenarios ID,ID
  --baseline-dir DIR
  --allowed-origins URL,URL
  --allow-external
  --module-graph (digest the explicit local adapter dependency graph)
  --dry-run
  --resume FILE
  --authority-digest SHA256  Original modern/audit authority, or SHA-256 of the external legacy backup
  --legacy-backup FILE (byte-identical pre-mutation state backup outside the state directory)
  --migrate-identity (migrate a genuine supported pre-identity state; requires both values above)
  --state FILE (automation state target for lease status/recovery)
  --owner-token TOKEN (exact stale lease owner token)
  --acquired-at TIMESTAMP (exact stale lease acquisition time)
  --state-digest DIGEST|absent (exact current lease-bound state digest)
  --invocation explicit|implicit
  --retry all|PACKET|PROVIDER|STAGE
  --result FILE (repeatable manual audit or design result)
  --triage FILE
  --approval FILE
  --json
  --out FILE
  --out-dir DIR
  --packets-dir DIR
  --format text|json
`;
}

function browserCommand(args) {
  if (args.subcommand === "attest") {
    if (!args.out) throw new RouterError("browser attest requires --out", 2);
    const result = createBrowserAttestation({
      artifacts: args.artifacts,
      root: args.root || process.cwd(),
      outPath: args.out
    });
    if (args.json || args.format === "json") {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    process.stdout.write([
      "KillSlopRouter browser attestation",
      `status: ${result.status}`,
      `path: ${result.path}`,
      `digest: ${result.digest}`
    ].join("\n") + "\n");
    return;
  }
  if (args.subcommand !== "configure") {
    throw new RouterError("browser requires the configure or attest subcommand", 2);
  }
  if (!args["base-url"]) throw new RouterError("browser configure requires --base-url", 2);
  const profilePath = projectProfilePath(args);
  if (!profilePath) throw new RouterError("browser configure requires a project profile", 2);
  const hostManifestPath = path.resolve(args["host-config"] ||
    path.join(path.dirname(profilePath), "host-adapters.json"));
  const receipt = configurePlaywright({
    profilePath,
    hostManifestPath,
    baseUrl: args["base-url"],
    browserChannel: args.channel || "chrome",
    allowedOrigins: (args["allowed-origins"] || "").split(",").map((item) => item.trim()).filter(Boolean),
    allowExternal: Boolean(args["allow-external"]),
    scenarioPath: args.scenario || null,
    baselineDirectory: args["baseline-dir"] || null,
    requiredScenarios: args["required-scenarios"]
      ? args["required-scenarios"].split(",").map((item) => item.trim()).filter(Boolean)
      : null
  });
  if (args.json || args.format === "json") {
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
    return;
  }
  process.stdout.write([
    "KillSlopRouter Playwright browser",
    `status: ${receipt.status}`,
    `base URL: ${receipt.browser.base_url}`,
    `channel: ${receipt.browser.browser_channel}`,
    `scenario: ${receipt.browser.scenario_file} (${receipt.browser.scenario_digest})`,
    `required scenarios: ${receipt.browser.required_scenarios.join(", ")}`,
    `baselines: ${receipt.browser.baseline_directory} (${receipt.browser.baseline_digest})`,
    `host: ${receipt.host_manifest.path} (${receipt.host_manifest.digest})`,
    `receipt: ${receipt.receipt_path}`,
    `receipt digest: ${receipt.receipt_digest}`
  ].join("\n") + "\n");
}

function integerOption(value, label, fallback) {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) throw new RouterError(`${label} must be an integer`, 2);
  return Number(value);
}

function skillProviderBindings(values = []) {
  return values.map((value) => {
    const separator = value.indexOf("=");
    if (separator <= 0 || separator === value.length - 1) {
      throw new RouterError("--skill-provider requires PROVIDER_ID=/absolute/skill/root", 2);
    }
    return {
      providerId: value.slice(0, separator),
      skillRoot: value.slice(separator + 1)
    };
  });
}

function hostCommand(args) {
  if (args.subcommand !== "configure-codex") {
    throw new RouterError("host requires the configure-codex subcommand", 2);
  }
  if (!args.runtime || !args.model) {
    throw new RouterError("host configure-codex requires --runtime and --model", 2);
  }
  const profilePath = projectProfilePath(args);
  if (!profilePath) throw new RouterError("host configure-codex requires a project profile", 2);
  const hostManifestPath = path.resolve(args["host-config"] ||
    path.join(path.dirname(profilePath), "host-adapters.json"));
  const router = readJson(path.resolve(args.router || defaultRouterPath), "router");
  const receipt = configureCodexReviewers({
    router,
    profilePath,
    hostManifestPath,
    runtimePath: args.runtime,
    runtimeRoot: args["runtime-root"] || null,
    model: args.model,
    agentProviders: (args["agent-providers"] || "").split(",")
      .map((providerId) => providerId.trim()).filter(Boolean),
    skillProviders: skillProviderBindings(args["skill-provider"] || []),
    allowExternal: Boolean(args["allow-external"]),
    replace: Boolean(args.replace),
    runtimeTimeoutMs: integerOption(args["timeout-ms"], "--timeout-ms", 600_000),
    maxOutputBytes: integerOption(args["max-output-bytes"], "--max-output-bytes", 8 * 1024 * 1024)
  });
  if (args.json || args.format === "json") {
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  } else {
    process.stdout.write([
      "KillSlopRouter Codex review host",
      `status: ${receipt.status}`,
      `runtime: ${receipt.runtime.version} (${receipt.runtime.digest})`,
      `model: ${receipt.runtime.model}`,
      `providers: ${receipt.providers.map((provider) => provider.provider_id).join(", ")}`,
      `host: ${receipt.host_manifest.path} (${receipt.host_manifest.digest})`,
      `receipt: ${receipt.receipt_path}`,
      `receipt digest: ${receipt.receipt_digest}`,
      ...(receipt.pending_reason ? [`pending: ${receipt.pending_reason}`] : [])
    ].join("\n") + "\n");
  }
  if (receipt.status === "manual_pending") process.exitCode = 6;
}

function pluginCommand(args) {
  if (args.subcommand === "sync") {
    const result = pluginAccountSync({
      home: args.home || os.homedir(), mode: args.mode,
      accounts: args["account-home"], discover: Boolean(args["discover-accounts"]),
      dryRun: Boolean(args["dry-run"]), apply: Boolean(args.apply)
    });
    if (args.json || args.format === "json") process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    else process.stdout.write([
      "KillSlopRouter account version sync",
      `mode: ${result.mode === "shared" ? "shared (ON)" : "per-account (KSR auto-sync OFF)"}`,
      `status: ${result.status}${result.dry_run ? " (preview)" : ""}`,
      `version: ${result.target?.version || "unavailable"}`,
      ...result.accounts.map((account) => `${account.account_home}: ${account.status}${account.error ? ` — ${account.error}` : ""}`),
      ...result.blockers.map((blocker) => `blocker: ${blocker}`),
      `settings: ${result.config_path}`,
      ...(result.receipt_path ? [`receipt: ${result.receipt_path} (${result.receipt_digest})`] : []),
      "next: plugin sync --apply to sync enrolled accounts; --mode per-account turns automatic updates off"
    ].join("\n") + "\n");
    process.exitCode = result.ok ? 0 : 5;
    return;
  }
  if (args.subcommand !== "install") {
    throw new RouterError("plugin requires the install subcommand or sync", 2);
  }
  const installer = path.join(packageRoot, "scripts", "install-codex-plugin.mjs");
  const installerArgs = [installer];
  if (args["dry-run"]) installerArgs.push("--dry-run");
  if (args.force) installerArgs.push("--force");
  if (args["migrate-legacy-entry"]) installerArgs.push("--migrate-legacy-entry");
  if (args["no-activate"]) installerArgs.push("--no-activate");
  if (args.home) installerArgs.push("--home", args.home);
  const result = spawnSync(process.execPath, installerArgs, {
    encoding: "utf8",
    shell: false,
    timeout: 3_000_000
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw new RouterError(`plugin installer failed: ${result.error.message}`, 5);
  process.exitCode = result.status ?? 5;
}

function projectProfilePath(args) {
  if (args.root) {
    try {
      if (!fs.statSync(path.resolve(args.root)).isDirectory()) throw new Error("not a directory");
    } catch {
      throw new RouterError("--root must be an existing directory", 2);
    }
  }
  if (args.profile) return path.resolve(args.profile);
  if (!args.root) return findProjectProfile(process.cwd());
  // An explicit project root is a discovery boundary, not a request to inherit
  // the invoking or enclosing project's authority. Explicit --profile is the
  // compatibility path for a deliberately shared/custom configuration.
  const candidate = path.join(path.resolve(args.root), ".killsloprouter", "profile.json");
  return fs.existsSync(candidate) ? candidate : null;
}

function loadContext(args) {
  const routerPath = path.resolve(args.router || defaultRouterPath);
  const profilePath = projectProfilePath(args);
  return {
    routerPath,
    router: readJson(routerPath, "router"),
    profilePath,
    profile: profilePath ? readJson(profilePath, "profile") : null
  };
}

function routingRoot(profilePath, requestedRoot = null) {
  if (requestedRoot) return path.resolve(requestedRoot);
  if (profilePath && path.basename(path.dirname(profilePath)) === ".killsloprouter") {
    return path.dirname(path.dirname(profilePath));
  }
  return process.cwd();
}

function doctor(args) {
  if (args["host-config"]) {
    throw new RouterError(
      "doctor validates project/profile authority only; use killsloprouter run --dry-run to inspect host execution readiness",
      2
    );
  }
  const context = loadContext(args);
  validateProfile(context.profile);
  const surfaceBoundary = inspectSurfaceContract({
    profile: context.profile,
    root: routingRoot(context.profilePath, args.root || null)
  });
  const visualIntents = inspectVisualIntents({
    profile: context.profile,
    profilePath: context.profilePath
  });
  const visualIntentsReady = visualIntents.length > 0 && visualIntents.every((intent) =>
    intent.status === "approved" && intent.authority_status === "verified"
  );
  const visualSignatures = inspectVisualSignatures({
    profile: context.profile,
    profilePath: context.profilePath
  });
  const visualSignaturesReady = visualSignatures.length > 0 && visualSignatures.every((signature) =>
    signature.status === "approved" && signature.authority_status === "verified"
  );
  const skillCatalog = inspectSkillCatalog({
    home: path.resolve(args.home || os.homedir()),
    assumeCanonical: true
  });
  const catalogReady = skillCatalog.status === "ready";
  const report = {
    status: visualIntentsReady && visualSignaturesReady && catalogReady
      ? "automation-ready"
      : "configuration_required",
    router_id: context.router.router_id,
    router_version: context.router.router_version,
    router_path: context.routerPath,
    skill_catalog: skillCatalog,
    profile_path: context.profilePath,
    project_root: routingRoot(context.profilePath, args.root || null),
    project_id: context.profile?.project_id || null,
    surface_contract: context.profile?.surface_contract || null,
    surface_boundary: surfaceBoundary,
    visual_intents: visualIntents,
    visual_signatures: visualSignatures,
    approved_design_system: context.profile?.approved_design_system ?? null,
    design_system: resolveDesignSystem(context.profile, context.profilePath),
    planning: context.profile?.planning || null,
    configured_local_adapters: Object.keys(context.profile?.local_adapters || {}),
    declared_external_adapters: context.profile?.external_adapters || {},
    fallback_adapters: context.profile?.fallback_adapters || {},
    capability_contracts: Object.keys(context.router.stage_capability_contracts || {}),
    execution_boundary: "allowlisted-digest-locked-host-adapters-no-arbitrary-profile-commands",
    execution_readiness: "not_evaluated_use_integrated_dry_run",
    completion_eligible: false,
    next_required_command: !catalogReady
      ? (skillCatalog.migration.command || skillCatalog.migration.reason)
      : !context.profilePath
        ? "killsloprouter bootstrap"
        : visualIntentsReady && visualSignaturesReady
          ? "killsloprouter run --dry-run"
          : "resolve and digest-lock project visual authority"
  };
  report.next_actions = doctorNextActions(report);
  const rendered = args.format === "json" ? `${JSON.stringify(report, null, 2)}\n` : [
    `status: ${report.status}`,
    `router: ${report.router_id} ${report.router_version}`,
    `entrypoint: ${report.skill_catalog.canonical_entrypoint} (${report.skill_catalog.status})`,
    `profile: ${report.project_id || "not found"}`,
    `surface: ${report.surface_contract?.primary || "unbound"}`,
    `surface bindings: ${report.surface_boundary?.artifact_bindings.length || 0}`,
    `visual intents: ${report.visual_intents.filter((intent) => intent.authority_status === "verified").length}/${report.visual_intents.length} verified`,
    `visual signatures: ${report.visual_signatures.filter((signature) => signature.authority_status === "verified").length}/${report.visual_signatures.length} verified`,
    ...report.visual_signatures.map((signature) =>
      `signature ${signature.surface}: primary ${signature.palette?.primary?.[0]?.value || "unresolved"}; ` +
      `type ${signature.typography?.families?.[0]?.family || "unresolved"}; ` +
      `density ${signature.density?.mode || "unresolved"}; elevation ${signature.elevation?.strategy || "unresolved"}`
    ),
    `planning bridge: ${report.planning ? "configured" : "not configured"}`,
    `design system: ${report.design_system ? `${report.design_system.id}@${report.design_system.version} (${report.design_system.status}; ${report.design_system.authority_status})` : "missing"}`,
    `local adapters: ${report.configured_local_adapters.length}`,
    `external adapters declared: ${Object.keys(report.declared_external_adapters).length}`,
    `fallback routes declared: ${Object.values(report.fallback_adapters).flat().length}`,
    `capability contracts: ${report.capability_contracts.length}`,
    `boundary: ${report.execution_boundary}`,
    `execution readiness: ${report.execution_readiness}`,
    `completion eligible: ${report.completion_eligible}`,
    `next: ${report.next_required_command}`,
    ...report.next_actions.map((action) => `setup ${action.id}: ${action.instruction} (${action.documentation})`)
  ].join("\n") + "\n";
  return { status: report.status, output: rendered };
}

function output(value, args, textFormatter = null) {
  let outputPath = null;
  if (args.out) {
    outputPath = secureCliWritablePath(args.out, "CLI JSON output path");
    writeJsonAtomic(outputPath, value);
  }
  if (args.format === "json") {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  } else if (textFormatter) {
    process.stdout.write(textFormatter(value));
  } else {
    const lines = Object.entries(value)
      .filter(([, item]) => ["string", "number", "boolean"].includes(typeof item))
      .map(([key, item]) => `${key}: ${item}`);
    if (outputPath) lines.push(`written: ${outputPath}`);
    process.stdout.write(`${lines.join("\n") || "ok"}\n`);
  }
}

function secureCliExistingFile(target, label) {
  try {
    return secureExistingRegularFile(target, label, { singleLink: true });
  } catch (error) {
    throw new RouterError(error.message, 4);
  }
}

function secureCliWritablePath(target, label) {
  try {
    return secureWritablePath(target, label);
  } catch (error) {
    throw new RouterError(error.message, 4);
  }
}

export function readCliPinnedJson(target, label, {
  faultInjector = null
} = {}) {
  try {
    return readJsonPinned(target, {
      label,
      faultInjector,
      securePath: (candidate, candidateLabel) =>
        secureCliExistingFile(candidate, candidateLabel)
    });
  } catch (error) {
    if (error instanceof RouterError) throw error;
    throw new RouterError(error.message, 4);
  }
}

export function readAuditRunForCommand(target, options = {}) {
  return readCliPinnedJson(target, "audit run path", options);
}

function defaultPacketsDir(runPath) {
  const absolute = path.resolve(runPath);
  const extension = path.extname(absolute);
  const stem = extension ? absolute.slice(0, -extension.length) : absolute;
  return `${stem}.packets`;
}

function formatAutomationState(state, args) {
  const lines = [
    `KillSlopRouter automation ${state.run_id || "dry-run"}`,
    `status: ${state.status}`
  ];
  if (state.journey_identity) {
    lines.push(`orchestrator: ${state.journey_identity.display_name}`);
    lines.push(`journey identity: ${state.journey_identity.identity_digest}`);
  }
  if (state.final_audit_status) lines.push(`audit: ${state.final_audit_status}`);
  if (state.final_receipt_digest) lines.push(`receipt: ${state.final_receipt_digest}`);
  if (state.resume_authority_digest) {
    lines.push(`resume authority: ${state.resume_authority_digest}`);
  }
  if (state.resume_authority_receipt?.path) {
    lines.push(`resume authority receipt: ${state.resume_authority_receipt.path}`);
  }
  for (const blocker of state.blockers || []) lines.push(`blocker: ${blocker}`);
  for (const pending of state.pending || []) lines.push(`pending: ${pending}`);
  if (state.state_path) lines.push(`state: ${state.state_path}`);
  if (state.state_digest) lines.push(`state digest: ${state.state_digest}`);
  lines.push(...automationGuidance(state, {
    hostConfig: args["host-config"] ? path.resolve(args["host-config"]) : null,
    commandPrefix: [process.execPath, path.join(packageRoot, "bin", "killsloprouter.mjs")]
  }));
  return `${lines.join("\n")}\n`;
}

function automationOutput(value, args) {
  if (args.json || args.format === "json") {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  } else {
    process.stdout.write(formatAutomationState(value, args));
  }
}

function bootstrapCommand(args) {
  const router = readJson(path.resolve(args.router || defaultRouterPath), "router");
  const receipt = bootstrapProject({
    router,
    root: args.root || process.cwd(),
    projectId: args["project-id"],
    locale: args.locale,
    surface: args.surface
  });
  if (args.json || args.format === "json") {
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
    return;
  }
  process.stdout.write([
    "KillSlopRouter bootstrap",
    `status: ${receipt.status}`,
    `surface: ${receipt.surface}`,
    `profile: ${receipt.profile.path} (${receipt.profile.digest})`,
    `host: ${receipt.host_manifest.path} (${receipt.host_manifest.execution_mode})`,
    `receipt: ${receipt.receipt_path}`,
    `receipt digest: ${receipt.receipt_digest}`
  ].join("\n") + "\n");
}

function runCommand(args) {
  const hostManifest = args["host-config"] ? loadHostManifest(args["host-config"]) : null;
  if (args.resume) {
    if (args["dry-run"]) throw new RouterError("--resume and --dry-run cannot be combined", 2);
    if (args["observation-run"]) {
      throw new RouterError("--observation-run is immutable after a run starts", 2);
    }
    const state = resumeAutomation(args.resume, {
      hostManifest,
      resultPaths: args.results,
      triagePath: args.triage || null,
      approvalPath: args.approval || null,
      retry: args.retry || null,
      authorityDigest: args["authority-digest"] || null,
      legacyBackupPath: args["legacy-backup"] || null,
      migrateIdentity: Boolean(args["migrate-identity"])
    });
    automationOutput(state, args);
    process.exitCode = automationExitCode(state);
    return;
  }

  const context = loadContext(args);
  const projectRoot = routingRoot(context.profilePath, args.root || null);
  const request = {
    router: context.router,
    profile: context.profile,
    routerPath: context.routerPath,
    profilePath: context.profilePath,
    input: {
      surface: args.surface,
      task: args.task,
      direction: args.direction,
      changes: args.changes,
      risk: args.risk,
      scope: args.scope || null
    },
    artifacts: args.artifacts,
    scope: args.scope,
    creatorActorId: args["creator-id"] || null,
    observationRunPath: args["observation-run"] || null,
    hostManifest,
    invocation: args.invocation || "explicit",
    root: projectRoot
  };
  if (args["dry-run"]) {
    const report = dryRunAutomation(request);
    if (args.out) {
      writeJsonAtomic(
        secureCliWritablePath(args.out, "CLI JSON output path"),
        report
      );
    }
    automationOutput(report, args);
    process.exitCode = automationExitCode(report);
    return;
  }
  if (!args.out) throw new RouterError("run requires --out for its resumable automation state", 2);
  const state = startAutomation({
    ...request,
    statePath: args.out,
    resultPaths: args.results,
    triagePath: args.triage || null,
    approvalPath: args.approval || null,
    retry: args.retry || null
  });
  automationOutput(state, args);
  process.exitCode = automationExitCode(state);
}

function leaseCommand(args) {
  if (!args.subcommand || !["status", "recover"].includes(args.subcommand)) {
    throw new RouterError("lease requires status or recover", 2);
  }
  if (!args.state) throw new RouterError(`lease ${args.subcommand} requires --state`, 2);
  if (args.subcommand === "status") {
    output(inspectAutomationStateLease(args.state), args, (value) => [
      "KillSlopRouter automation state lease",
      `status: ${value.status}`,
      `state: ${value.state_path}`,
      `state digest: ${value.state_digest}`,
      ...(value.status === "locked" ? [
        `operation: ${value.operation}`,
        `phase: ${value.phase}`,
        `owner pid: ${value.owner_pid}`,
        `owner pid in use: ${value.owner_pid_in_use}`,
        `owner process alive: ${value.owner_process_alive}`,
        `owner process identity matches: ${value.owner_process_identity_matches}`,
        `acquired at: ${value.acquired_at}`,
        `recover after: ${value.recover_after}`,
        `lease digest: ${value.lease_digest}`
      ] : [])
    ].join("\n") + "\n");
    return;
  }
  const result = recoverAutomationStateLease(args.state, {
    ownerToken: args["owner-token"],
    acquiredAt: args["acquired-at"],
    stateDigest: args["state-digest"],
    authorityDigest: args["authority-digest"] || null,
    legacyBackupPath: args["legacy-backup"] || null
  });
  output(result, args, (value) => [
    "KillSlopRouter automation state lease recovery",
    `status: ${value.status}`,
    `state: ${value.state_path}`,
    `state digest: ${value.state_digest}`,
    `receipt: ${value.receipt_path}`,
    `receipt digest: ${value.receipt_digest}`,
    ...(value.abandoned_packet ? [
      `abandoned child: ${value.abandoned_packet.packet_id} attempt ${value.abandoned_packet.attempt}`,
      "retry: explicit selector required"
    ] : [])
  ].join("\n") + "\n");
}

function formatDesignState(state) {
  const lines = [
    `KillSlopRouter design exploration ${state.run_id || "dry-run"}`,
    `status: ${state.status}`
  ];
  if (state.journey_identity) {
    lines.push(`orchestrator: ${state.journey_identity.display_name}`);
    lines.push(`journey identity: ${state.journey_identity.identity_digest}`);
  }
  if (state.phase) lines.push(`phase: ${state.phase}`);
  const reference = state.design_exploration_run_version === 1
    ? designReferenceDelivery(state)
    : state.design_exploration_dry_run_version === 1 ? state.reference_delivery : null;
  if (reference) {
    lines.push(`reference delivery: ${reference.status}`);
    lines.push(reference.note);
    if (reference.pack_digest) lines.push(`reference pack: ${reference.pack_digest}`);
    lines.push(...designReferenceGuidance(reference));
  }
  if (state.selection_scope_digest) lines.push(`shortlist scope: ${state.selection_scope_digest}`);
  if (state.approval_scope_digest) lines.push(`approval scope: ${state.approval_scope_digest}`);
  for (const blocker of state.blockers || []) lines.push(`blocker: ${blocker}`);
  for (const pending of state.pending || []) lines.push(`pending: ${pending}`);
  if (state.state_path) lines.push(`state: ${state.state_path}`);
  if (state.state_digest) lines.push(`state digest: ${state.state_digest}`);
  for (const [name, snapshot] of Object.entries(state.outputs || {})) {
    lines.push(`${name}: ${snapshot.resolved_path || snapshot.path} (${snapshot.digest})`);
  }
  return `${lines.join("\n")}\n`;
}

function designOutput(value, args) {
  if (args.json || args.format === "json") process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  else process.stdout.write(formatDesignState(value));
}

function designCommand(args) {
  const command = args.subcommand;
  if (!command || !["run", "status", "provenance", "dispatch", "lease-status", "recover"].includes(command)) {
    throw new RouterError("design requires run, status, provenance, dispatch, lease-status, or recover", 2);
  }
  if (command === "lease-status") {
    if (!args.state) throw new RouterError("design lease-status requires --state", 2);
    output(inspectDesignStateLease(args.state), args, (value) => [
      "KillSlopRouter design state lease",
      `status: ${value.status}`,
      `state: ${value.state_path}`,
      `state digest: ${value.state_digest}`,
      ...(value.status === "locked" ? [
        `operation: ${value.operation}`,
        `phase: ${value.phase}`,
        `owner pid: ${value.owner_pid}`,
        `owner pid in use: ${value.owner_pid_in_use}`,
        `owner process alive: ${value.owner_process_alive}`,
        `owner process identity matches: ${value.owner_process_identity_matches}`,
        `acquired at: ${value.acquired_at}`,
        `recover after: ${value.recover_after}`,
        `lease digest: ${value.lease_digest}`
      ] : [])
    ].join("\n") + "\n");
    return;
  }
  if (command === "recover") {
    if (!args.state) throw new RouterError("design recover requires --state", 2);
    const result = recoverDesignStateLease(args.state, {
      ownerToken: args["owner-token"],
      acquiredAt: args["acquired-at"],
      stateDigest: args["state-digest"]
    });
    output(result, args, (value) => [
      "KillSlopRouter design state lease recovery",
      `status: ${value.status}`,
      `state: ${value.state_path}`,
      `state digest: ${value.state_digest}`,
      ...(value.recovery ? [
        `outcome: ${value.recovery.outcome}`,
        `recovery digest: ${value.recovery.recovery_digest}`,
        `retry required: ${value.recovery.retry_required}`
      ] : []),
      ...(value.blocker ? [`blocker: ${value.blocker}`] : [])
    ].join("\n") + "\n");
    return;
  }
  if (["status", "provenance", "dispatch"].includes(command)) {
    if (!args.run) throw new RouterError(`design ${command} requires --run`, 2);
    const state = readDesignState(args.run);
    assertDesignReferenceRequirement(state.brief, args["require-reference"]);
    if (command === "provenance") {
      output(designReferenceDelivery(state), args, (value) =>
        [`KillSlopRouter reference delivery: ${value.status}`, value.note,
          ...designReferenceGuidance(value)].join("\n") + "\n");
      return;
    }
    if (command === "status") {
      designOutput(state, args);
      return;
    }
    if (!args["out-dir"]) throw new RouterError("design dispatch requires --out-dir", 2);
    output(dispatchDesignPackets(state, args["out-dir"]), args);
    return;
  }

  const hostManifest = args["host-config"] ? loadHostManifest(args["host-config"]) : null;
  if (args.resume) {
    if (args["dry-run"]) throw new RouterError("--resume and --dry-run cannot be combined", 2);
    const state = resumeDesignExploration(args.resume, {
      requireReference: Boolean(args["require-reference"]),
      hostManifest,
      resultPaths: args.results,
      shortlistPath: args.shortlist || null,
      approvalPath: args.approval || null,
      retry: args.retry || null
    });
    designOutput(state, args);
    process.exitCode = designExitCode(state);
    return;
  }
  if (!args.brief || !args.baseline) {
    throw new RouterError("design run requires --brief and --baseline", 2);
  }
  const router = readJson(defaultRouterPath, "default router");
  const request = {
    briefPath: args.brief,
    requireReference: Boolean(args["require-reference"]),
    baselinePath: args.baseline,
    hostManifest,
    routerId: router.router_id,
    routerVersion: router.router_version,
    invocation: args.invocation || "explicit",
    root: args.root || process.cwd()
  };
  if (args["dry-run"]) {
    const report = dryRunDesignExploration(request);
    designOutput(report, args);
    process.exitCode = designExitCode(report);
    return;
  }
  if (!args.out) throw new RouterError("design run requires --out for resumable state", 2);
  const state = startDesignExploration({
    ...request,
    statePath: args.out,
    resultPaths: args.results,
    shortlistPath: args.shortlist || null,
    approvalPath: args.approval || null,
    retry: args.retry || null
  });
  designOutput(state, args);
  process.exitCode = designExitCode(state);
}

function formatReferenceState(state) {
  const lines = [
    `KillSlopRouter reference intelligence ${state.run_id || "dry-run"}`,
    `status: ${state.status}`
  ];
  if (state.journey_identity) {
    lines.push(`orchestrator: ${state.journey_identity.display_name}`);
    lines.push(`journey identity: ${state.journey_identity.identity_digest}`);
  }
  if (state.phase) lines.push(`phase: ${state.phase}`);
  if (state.selection_scope_digest) lines.push(`selection scope: ${state.selection_scope_digest}`);
  if (state.reference_intelligence_run_version === 1) {
    lines.push(...referenceChoicesGuidance(readReferenceChoices(state.state_path, {
      expectedStateDigest: state.state_digest
    })));
  } else {
    for (const blocker of state.blockers || []) lines.push(`blocker: ${blocker}`);
    for (const pending of state.pending || []) lines.push(`pending: ${pending}`);
  }
  if (state.state_path) lines.push(`state: ${state.state_path}`);
  if (state.state_digest) lines.push(`state digest: ${state.state_digest}`);
  if (state.outputs?.reference_pack) {
    lines.push(`reference pack: ${state.outputs.reference_pack.resolved_path || state.outputs.reference_pack.path} (${state.outputs.reference_pack.digest})`);
  }
  if (state.downstream) lines.push(`downstream: ${state.downstream}`);
  return `${lines.join("\n")}\n`;
}

function referenceOutput(value, args) {
  if (args.json || args.format === "json") process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  else process.stdout.write(formatReferenceState(value));
}

function referenceCommand(args) {
  const command = args.subcommand;
  if (!command || !["run", "status", "choices", "library", "dispatch", "recover"].includes(command)) {
    throw new RouterError("reference requires run, status, choices, library, dispatch, or recover", 2);
  }
  if (command === "library") {
    const filters = Object.fromEntries(["component", "source", "query", "details"]
      .filter(key => args[key] !== undefined).map(key => [key, args[key]]));
    output(referenceLibraryReport(loadReferenceLibrary(), filters), args, formatReferenceLibrary);
    return;
  }
  if (command === "choices") {
    if (!args.run) throw new RouterError("reference choices requires --run", 2);
    output(readReferenceChoices(args.run), args, (value) =>
      ["KillSlopRouter", ...referenceChoicesGuidance(value)].join("\n") + "\n");
    return;
  }
  if (command === "recover") {
    if (!args.state) throw new RouterError("reference recover requires --state", 2);
    const result = recoverReferenceStateLease(args.state, {
      ownerToken: args["owner-token"],
      acquiredAt: args["acquired-at"],
      stateDigest: args["state-digest"]
    });
    output(result, args, (value) => [
      "KillSlopRouter reference state lease recovery",
      `status: ${value.status}`,
      `state: ${value.state_path}`,
      `state digest: ${value.state_digest}`,
      ...(value.recovery ? [
        `outcome: ${value.recovery.outcome}`,
        `recovery digest: ${value.recovery.recovery_digest}`,
        `retry required: ${value.recovery.retry_required}`
      ] : []),
      ...(value.blocker ? [`blocker: ${value.blocker}`] : [])
    ].join("\n") + "\n");
    return;
  }
  if (command === "status" || command === "dispatch") {
    if (!args.run) throw new RouterError(`reference ${command} requires --run`, 2);
    const state = readReferenceState(args.run);
    if (command === "status") {
      referenceOutput(state, args);
      return;
    }
    if (!args["out-dir"]) throw new RouterError("reference dispatch requires --out-dir", 2);
    output(dispatchReferencePackets(state, args["out-dir"]), args);
    return;
  }

  const hostManifest = args["host-config"] ? loadHostManifest(args["host-config"]) : null;
  if (args.resume) {
    if (args["dry-run"]) throw new RouterError("--resume and --dry-run cannot be combined", 2);
    const state = resumeReferenceIntelligence(args.resume, {
      hostManifest,
      resultPaths: args.results,
      selectionPath: args.selection || null,
      retry: args.retry || null
    });
    referenceOutput(state, args);
    process.exitCode = referenceExitCode(state);
    return;
  }
  if (!args.brief) throw new RouterError("reference run requires --brief", 2);
  const router = readJson(defaultRouterPath, "default router");
  const request = {
    briefPath: args.brief,
    hostManifest,
    routerId: router.router_id,
    routerVersion: router.router_version,
    invocation: args.invocation || "explicit",
    root: args.root || process.cwd()
  };
  if (args["dry-run"]) {
    const report = dryRunReferenceIntelligence(request);
    referenceOutput(report, args);
    process.exitCode = referenceExitCode(report);
    return;
  }
  if (!args.out) throw new RouterError("reference run requires --out for resumable state", 2);
  const state = startReferenceIntelligence({
    ...request,
    statePath: args.out,
    resultPaths: args.results,
    selectionPath: args.selection || null,
    retry: args.retry || null
  });
  referenceOutput(state, args);
  process.exitCode = referenceExitCode(state);
}

function auditCommand(args) {
  const command = args.subcommand;
  if (!command) throw new RouterError("audit requires init, dispatch, record, triage, status, or finalize", 2);

  if (command === "init") {
    if (!args.plan || !args.out || !args.scope || !args.artifacts.length) {
      throw new RouterError("audit init requires --plan, --artifact, --scope, and --out", 2);
    }
    const planPath = secureCliExistingFile(args.plan, "audit route plan source");
    const runPath = secureCliWritablePath(args.out, "audit run output path");
    const packetsPath = secureCliWritablePath(
      args["packets-dir"] || defaultPacketsDir(runPath),
      "audit packet output directory"
    );
    const run = initializeAudit({
      plan: readJson(planPath, "route plan"),
      planPath,
      artifacts: args.artifacts,
      scope: args.scope,
      creatorActorId: args["creator-id"] || null,
      invocation: args.invocation || "explicit",
      root: args.root || process.cwd()
    });
    writeJsonAtomic(runPath, run);
    const dispatched = dispatchAuditPackets(
      run,
      packetsPath,
      { authorityDigest: run.audit_authority_digest }
    );
    output({
      run_id: run.run_id,
      journey_identity: run.journey_identity,
      status: run.status,
      run_file: runPath,
      packets_directory: dispatched.directory,
      packet_count: dispatched.packets.length,
      audit_authority_digest: run.audit_authority_digest,
      approval_scope_digest: run.approval_scope_digest
    }, { ...args, out: null });
    return;
  }

  if (!args.run) throw new RouterError(`audit ${command} requires --run`, 2);
  const runAuthority = readAuditRunForCommand(args.run);
  const runPath = runAuthority.path;
  const run = runAuthority.input;

  if (command === "dispatch") {
    const packetsPath = secureCliWritablePath(
      args["out-dir"] || defaultPacketsDir(runPath),
      "audit packet output directory"
    );
    const dispatched = dispatchAuditPackets(
      run,
      packetsPath,
      { authorityDigest: args["authority-digest"] || null }
    );
    output({
      run_id: run.run_id,
      packets_directory: dispatched.directory,
      packet_count: dispatched.packets.length,
      approval_template: dispatched.approval_template
    }, args);
    return;
  }

  if (command === "record") {
    if (!args.result) throw new RouterError("audit record requires --result", 2);
    const resultEvidence = readCliPinnedJson(args.result, "audit result source");
    const next = recordAuditResult(run, resultEvidence.input, resultEvidence.path, {
      replace: Boolean(args.replace),
      authorityDigest: args["authority-digest"] || null,
      sourceSnapshot: resultEvidence.source_snapshot
    });
    writeJsonAtomic(runPath, next);
    output({ run_id: next.run_id, status: next.status, recorded_results: next.results.length }, args);
    return;
  }

  if (command === "triage") {
    if (!args.triage) throw new RouterError("audit triage requires --triage", 2);
    const triageEvidence = readCliPinnedJson(args.triage, "audit triage source");
    const next = recordTriage(run, triageEvidence.input, triageEvidence.path, {
      replace: Boolean(args.replace),
      authorityDigest: args["authority-digest"] || null,
      sourceSnapshot: triageEvidence.source_snapshot
    });
    writeJsonAtomic(runPath, next);
    output({
      run_id: next.run_id,
      status: next.status,
      triage_decisions: next.triage.flatMap((entry) => entry.decisions).length
    }, args);
    return;
  }

  if (command === "status" || command === "finalize") {
    let approval = null;
    let approvalPath = null;
    let approvalSourceSnapshot = null;
    if (args.approval) {
      const approvalEvidence = readCliPinnedJson(args.approval, "audit owner approval source");
      approvalPath = approvalEvidence.path;
      approval = approvalEvidence.input;
      approvalSourceSnapshot = approvalEvidence.source_snapshot;
    }
    const receipt = finalizeAudit(run, {
      approval,
      approvalPath,
      approvalSourceSnapshot,
      authorityDigest: args["authority-digest"] || null
    });
    output(receipt, args, formatAuditReceipt);
    if (command === "finalize") {
      process.exitCode = auditExitCode(receipt, { requireOwner: Boolean(args["require-owner"]) });
    }
    return;
  }

  throw new RouterError(`unknown audit command: ${command}`, 2);
}

export async function main(argv) {
  const args = parseArgs(argv);
  if (args.json) args.format = "json";
  if (args.help || argv.length === 0) {
    process.stdout.write(help());
    return;
  }
  if (args.command === "capabilities") {
    const report = inspectDistribution();
    output(report, args, (value) => [
      `KillSlopRouter ${value.plugin_version}`,
      `distribution: ${value.status} (${value.distribution_digest})`,
      ...value.features.map((feature) => `${feature.id}: ${feature.status}`),
      value.note
    ].join("\n") + "\n");
    process.exitCode = report.status === "available" ? 0 : 5;
    return;
  }
  if (args.command === "bootstrap") {
    bootstrapCommand(args);
    return;
  }
  if (args.command === "plugin") {
    pluginCommand(args);
    return;
  }
  if (args.command === "host") {
    hostCommand(args);
    return;
  }
  if (args.command === "browser") {
    browserCommand(args);
    return;
  }
  if (args.command === "design") {
    designCommand(args);
    return;
  }
  if (args.command === "reference") {
    referenceCommand(args);
    return;
  }
  if (args.command === "audit") {
    auditCommand(args);
    return;
  }
  if (args.command === "lease") {
    leaseCommand(args);
    return;
  }
  if (args.command === "run") {
    runCommand(args);
    return;
  }
  if (args.command === "doctor") {
    const result = doctor(args);
    process.stdout.write(result.output);
    if (result.status === "configuration_required") process.exitCode = 5;
    return;
  }
  if (args.command === "digest") {
    if (!args.target) throw new RouterError("digest requires --target", 2);
    const target = path.resolve(args.target);
    const receipt = {
      target,
      digest: args["module-graph"]
        ? sealedEntrypointGraphDigest(target, {
            trustedPackageRoot: (() => {
              const relative = path.relative(packageRoot, target);
              return relative !== ".." && !relative.startsWith(`..${path.sep}`) &&
                !path.isAbsolute(relative)
                ? packageRoot
                : null;
            })()
          })
        : hashArtifact(target)
    };
    if (args["module-graph"]) receipt.kind = "sealed-entrypoint-module-graph";
    if (args.out) {
      writeJsonAtomic(
        secureCliWritablePath(args.out, "CLI JSON output path"),
        receipt
      );
    }
    if (args.format === "json") process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
    else process.stdout.write(`${receipt.digest}  ${receipt.target}\n`);
    return;
  }
  if (args.command === "scan") {
    if (args.adapter !== "kill-ai-slop") {
      throw new RouterError("scan currently supports only --adapter kill-ai-slop", 2);
    }
    const context = loadContext(args);
    const declared = context.profile?.external_adapters?.[args.adapter];
    const adapterRoot = args["adapter-root"] || declared?.root;
    if (!adapterRoot || !args.target) {
      throw new RouterError("scan requires --target and an adapter root from --adapter-root or the project profile", 2);
    }
    const receipt = runKillAiSlop({
      adapterRoot,
      target: args.target,
      version: args.version || declared?.version || null
    });
    output(receipt, args, (value) => [
      `adapter: ${value.tool_id}`,
      `status: ${value.status}`,
      `artifact: ${value.artifact}`,
      `groups: ${value.summary?.groups ?? 0}`,
      `hits: ${value.summary?.hits ?? 0}`
    ].join("\n") + "\n");
    return;
  }
  if (args.command !== "plan") throw new RouterError(`unknown command: ${args.command}`, 2);
  if (args["dry-run"]) {
    throw new RouterError(
      "plan --dry-run does not execute or inspect host adapters; use killsloprouter run --dry-run",
      2
    );
  }
  if (args["host-config"]) {
    throw new RouterError(
      "plan does not inspect --host-config; use killsloprouter run --dry-run for execution readiness",
      2
    );
  }

  const context = loadContext(args);
  const projectRoot = routingRoot(context.profilePath, args.root || null);
  const receipt = planRoute({
    router: context.router,
    profile: context.profile,
    routerPath: context.routerPath,
    profilePath: context.profilePath,
    input: {
      surface: args.surface,
      task: args.task,
      direction: args.direction,
      changes: args.changes,
      risk: args.risk,
      scope: args.scope || null
    },
    artifacts: args.artifacts,
    root: projectRoot
  });
  output(receipt, args, formatReceipt);
}
