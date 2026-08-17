import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  RouterError,
  findProjectProfile,
  formatReceipt,
  planRoute,
  readJson
} from "./router.mjs";
import { runKillAiSlop } from "./adapters/kill-ai-slop.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultRouterPath = path.join(packageRoot, "router", "default-router.json");

function parseArgs(argv) {
  const args = { command: "plan", changes: [], risk: "standard", format: "text" };
  let index = 0;
  if (argv[0] && !argv[0].startsWith("-")) {
    args.command = argv[0];
    index = 1;
  }
  for (; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help" || token === "-h") {
      args.help = true;
      continue;
    }
    if (!token.startsWith("--")) throw new RouterError(`unexpected argument: ${token}`, 2);
    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new RouterError(`missing value for --${key}`, 2);
    index += 1;
    if (key === "changes") {
      args.changes = value.split(",").map((item) => item.trim()).filter(Boolean);
    } else {
      args[key] = value;
    }
  }
  return args;
}

function help() {
  return `KillSlopRouter\n\nUsage:\n  killsloprouter plan --surface SURFACE --task TASK [options]\n  killsloprouter scan --adapter kill-ai-slop --adapter-root DIR --target PATH\n  killsloprouter doctor [--profile FILE] [--format text|json]\n\nSurfaces:\n  operator-product-ui\n  consumer-product-ui\n  marketing-editorial\n\nTasks:\n  build, redesign, runtime-handoff, audit, copy, pr-hygiene\n\nOptions:\n  --direction approved|missing|reference|none\n  --changes source,copy,style,layout,interaction,state,data,authority\n  --risk standard|high\n  --profile /path/to/profile.json\n  --router /path/to/router.json\n  --format text|json\n`;
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
  const report = {
    status: "core-ready",
    router_id: context.router.router_id,
    router_version: context.router.router_version,
    router_path: context.routerPath,
    profile_path: context.profilePath,
    project_id: context.profile?.project_id || null,
    approved_design_system: context.profile?.approved_design_system ?? null,
    configured_local_adapters: Object.keys(context.profile?.local_adapters || {}),
    declared_external_adapters: context.profile?.external_adapters || {},
    execution_boundary: "allowlisted-read-only-adapters-only"
  };
  return args.format === "json" ? `${JSON.stringify(report, null, 2)}\n` : [
    `status: ${report.status}`,
    `router: ${report.router_id} ${report.router_version}`,
    `profile: ${report.project_id || "not found"}`,
    `local adapters: ${report.configured_local_adapters.length}`,
    `external adapters declared: ${Object.keys(report.declared_external_adapters).length}`,
    `boundary: ${report.execution_boundary}`
  ].join("\n") + "\n";
}

export async function main(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(help());
    return;
  }
  if (args.command === "doctor") {
    process.stdout.write(doctor(args));
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
    if (args.format === "json") {
      process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
    } else {
      process.stdout.write([
        `adapter: ${receipt.tool_id}`,
        `status: ${receipt.status}`,
        `artifact: ${receipt.artifact}`,
        `groups: ${receipt.summary?.groups ?? 0}`,
        `hits: ${receipt.summary?.hits ?? 0}`
      ].join("\n") + "\n");
    }
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
      risk: args.risk
    }
  });
  process.stdout.write(args.format === "json" ? `${JSON.stringify(receipt, null, 2)}\n` : formatReceipt(receipt));
}
