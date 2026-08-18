import path from "node:path";
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
  planRoute,
  readJson,
  resolveDesignSystem,
  validateProfile
} from "./router.mjs";
import { runKillAiSlop } from "./adapters/kill-ai-slop.mjs";
import {
  automationExitCode,
  dryRunAutomation,
  resumeAutomation,
  startAutomation
} from "./automation.mjs";
import { loadHostManifest } from "./execution.mjs";
import { hashArtifact } from "./integrity.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultRouterPath = path.join(packageRoot, "router", "default-router.json");
const BOOLEAN_OPTIONS = new Set(["replace", "require-owner", "dry-run", "json"]);

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
  if (args.command === "audit" && argv[index] && !argv[index].startsWith("-")) {
    args.subcommand = argv[index];
    index += 1;
  }
  for (; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help" || token === "-h") {
      args.help = true;
      continue;
    }
    if (!token.startsWith("--")) throw new RouterError(`unexpected argument: ${token}`, 2);
    const key = token.slice(2);
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
    } else {
      args[key] = value;
    }
  }
  return args;
}

function help() {
  return `KillSlopRouter

Usage:
  killsloprouter plan --surface SURFACE --task TASK [options]
  killsloprouter run --surface SURFACE --task TASK --artifact PATH --scope SCOPE --out FILE [options]
  killsloprouter run --resume FILE [--host-config FILE] [--triage FILE] [--approval FILE] [--retry SELECTOR]
  killsloprouter scan --adapter kill-ai-slop --adapter-root DIR --target PATH
  killsloprouter digest --target PATH [--json]
  killsloprouter doctor [--profile FILE] [--format text|json]
  killsloprouter audit init --plan FILE --artifact PATH --scope SCOPE --out FILE [options]
  killsloprouter audit dispatch --run FILE --out-dir DIR
  killsloprouter audit record --run FILE --result FILE [--replace]
  killsloprouter audit triage --run FILE --triage FILE [--replace]
  killsloprouter audit status --run FILE [--format text|json]
  killsloprouter audit finalize --run FILE [--approval FILE] [--out FILE] [--require-owner]

Surfaces:
  operator-product-ui
  consumer-product-ui
  marketing-editorial

Tasks:
  build, redesign, systemize, runtime-handoff, audit, copy, pr-hygiene

Audit scopes:
  mockup, runtime, source, document

Options:
  --direction approved|missing|reference|none
  --changes source,copy,style,layout,interaction,state,data,authority
  --risk standard|high
  --scope mockup|runtime|source|document
  --profile /path/to/profile.json
  --router /path/to/router.json
  --creator-id ID
  --host-config FILE
  --dry-run
  --resume FILE
  --retry all|PACKET|PROVIDER|STAGE
  --result FILE (repeatable manual audit result)
  --triage FILE
  --approval FILE
  --json
  --out FILE
  --packets-dir DIR
  --format text|json
`;
}

function loadContext(args) {
  const routerPath = path.resolve(args.router || defaultRouterPath);
  const profilePath = args.profile ? path.resolve(args.profile) : findProjectProfile(process.cwd());
  return {
    routerPath,
    router: readJson(routerPath, "router"),
    profilePath,
    profile: profilePath ? readJson(profilePath, "profile") : null
  };
}

function doctor(args) {
  const context = loadContext(args);
  validateProfile(context.profile);
  const report = {
    status: "automation-ready",
    router_id: context.router.router_id,
    router_version: context.router.router_version,
    router_path: context.routerPath,
    profile_path: context.profilePath,
    project_id: context.profile?.project_id || null,
    approved_design_system: context.profile?.approved_design_system ?? null,
    design_system: resolveDesignSystem(context.profile, context.profilePath),
    planning: context.profile?.planning || null,
    configured_local_adapters: Object.keys(context.profile?.local_adapters || {}),
    declared_external_adapters: context.profile?.external_adapters || {},
    fallback_adapters: context.profile?.fallback_adapters || {},
    capability_contracts: Object.keys(context.router.stage_capability_contracts || {}),
    execution_boundary: "allowlisted-digest-locked-host-adapters-no-arbitrary-profile-commands"
  };
  return args.format === "json" ? `${JSON.stringify(report, null, 2)}\n` : [
    `status: ${report.status}`,
    `router: ${report.router_id} ${report.router_version}`,
    `profile: ${report.project_id || "not found"}`,
    `planning bridge: ${report.planning ? "configured" : "not configured"}`,
    `design system: ${report.design_system ? `${report.design_system.id}@${report.design_system.version} (${report.design_system.status}; ${report.design_system.authority_status})` : "missing"}`,
    `local adapters: ${report.configured_local_adapters.length}`,
    `external adapters declared: ${Object.keys(report.declared_external_adapters).length}`,
    `fallback routes declared: ${Object.values(report.fallback_adapters).flat().length}`,
    `capability contracts: ${report.capability_contracts.length}`,
    `boundary: ${report.execution_boundary}`
  ].join("\n") + "\n";
}

function output(value, args, textFormatter = null) {
  if (args.out) writeJsonAtomic(args.out, value);
  if (args.format === "json") {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  } else if (textFormatter) {
    process.stdout.write(textFormatter(value));
  } else {
    const lines = Object.entries(value)
      .filter(([, item]) => ["string", "number", "boolean"].includes(typeof item))
      .map(([key, item]) => `${key}: ${item}`);
    if (args.out) lines.push(`written: ${path.resolve(args.out)}`);
    process.stdout.write(`${lines.join("\n") || "ok"}\n`);
  }
}

function defaultPacketsDir(runPath) {
  const absolute = path.resolve(runPath);
  const extension = path.extname(absolute);
  const stem = extension ? absolute.slice(0, -extension.length) : absolute;
  return `${stem}.packets`;
}

function formatAutomationState(state) {
  const lines = [
    `KillSlopRouter automation ${state.run_id || "dry-run"}`,
    `status: ${state.status}`
  ];
  if (state.final_audit_status) lines.push(`audit: ${state.final_audit_status}`);
  if (state.final_receipt_digest) lines.push(`receipt: ${state.final_receipt_digest}`);
  for (const blocker of state.blockers || []) lines.push(`blocker: ${blocker}`);
  for (const pending of state.pending || []) lines.push(`pending: ${pending}`);
  if (state.state_path) lines.push(`state: ${state.state_path}`);
  if (state.state_digest) lines.push(`state digest: ${state.state_digest}`);
  return `${lines.join("\n")}\n`;
}

function automationOutput(value, args) {
  if (args.json || args.format === "json") {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  } else {
    process.stdout.write(formatAutomationState(value));
  }
}

function runCommand(args) {
  const hostManifest = args["host-config"] ? loadHostManifest(args["host-config"]) : null;
  if (args.resume) {
    if (args["dry-run"]) throw new RouterError("--resume and --dry-run cannot be combined", 2);
    const state = resumeAutomation(args.resume, {
      hostManifest,
      resultPaths: args.results,
      triagePath: args.triage || null,
      approvalPath: args.approval || null,
      retry: args.retry || null
    });
    automationOutput(state, args);
    process.exitCode = automationExitCode(state);
    return;
  }

  const context = loadContext(args);
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
    hostManifest,
    root: args.root || process.cwd()
  };
  if (args["dry-run"]) {
    const report = dryRunAutomation(request);
    if (args.out) writeJsonAtomic(args.out, report);
    automationOutput(report, args);
    process.exitCode = report.status === "blocked" ? 5 : 0;
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

function auditCommand(args) {
  const command = args.subcommand;
  if (!command) throw new RouterError("audit requires init, dispatch, record, triage, status, or finalize", 2);

  if (command === "init") {
    if (!args.plan || !args.out || !args.scope || !args.artifacts.length) {
      throw new RouterError("audit init requires --plan, --artifact, --scope, and --out", 2);
    }
    const planPath = path.resolve(args.plan);
    const run = initializeAudit({
      plan: readJson(planPath, "route plan"),
      planPath,
      artifacts: args.artifacts,
      scope: args.scope,
      creatorActorId: args["creator-id"] || null,
      root: args.root || process.cwd()
    });
    writeJsonAtomic(args.out, run);
    const dispatched = dispatchAuditPackets(run, args["packets-dir"] || defaultPacketsDir(args.out));
    output({
      run_id: run.run_id,
      status: run.status,
      run_file: path.resolve(args.out),
      packets_directory: dispatched.directory,
      packet_count: dispatched.packets.length,
      approval_scope_digest: run.approval_scope_digest
    }, { ...args, out: null });
    return;
  }

  if (!args.run) throw new RouterError(`audit ${command} requires --run`, 2);
  const runPath = path.resolve(args.run);
  const run = readJson(runPath, "audit run");

  if (command === "dispatch") {
    const dispatched = dispatchAuditPackets(run, args["out-dir"] || defaultPacketsDir(runPath));
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
    const resultPath = path.resolve(args.result);
    const next = recordAuditResult(run, readJson(resultPath, "audit result"), resultPath, {
      replace: Boolean(args.replace)
    });
    writeJsonAtomic(runPath, next);
    output({ run_id: next.run_id, status: next.status, recorded_results: next.results.length }, args);
    return;
  }

  if (command === "triage") {
    if (!args.triage) throw new RouterError("audit triage requires --triage", 2);
    const triagePath = path.resolve(args.triage);
    const next = recordTriage(run, readJson(triagePath, "triage result"), triagePath, {
      replace: Boolean(args.replace)
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
    if (args.approval) {
      approvalPath = path.resolve(args.approval);
      approval = readJson(approvalPath, "owner approval");
    }
    const receipt = finalizeAudit(run, { approval, approvalPath });
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
  if (args.help) {
    process.stdout.write(help());
    return;
  }
  if (args.command === "audit") {
    auditCommand(args);
    return;
  }
  if (args.command === "run") {
    runCommand(args);
    return;
  }
  if (args.command === "doctor") {
    process.stdout.write(doctor(args));
    return;
  }
  if (args.command === "digest") {
    if (!args.target) throw new RouterError("digest requires --target", 2);
    const target = path.resolve(args.target);
    const receipt = { target, digest: hashArtifact(target) };
    if (args.out) writeJsonAtomic(args.out, receipt);
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

  const context = loadContext(args);
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
    }
  });
  output(receipt, args, formatReceipt);
}
