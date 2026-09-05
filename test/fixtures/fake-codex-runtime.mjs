#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const modePath = path.join(root, "mode.json");
const mode = fs.existsSync(modePath) ? JSON.parse(fs.readFileSync(modePath, "utf8")) : {};
const args = process.argv.slice(2);

function requireIsolatedHome({ allowReviewSchema = false } = {}) {
  if (!process.env.CODEX_HOME || process.env.HOME !== process.env.CODEX_HOME) {
    process.stderr.write("fake Codex requires matching isolated HOME and CODEX_HOME\n");
    process.exit(3);
  }
  const entries = fs.readdirSync(process.env.CODEX_HOME).sort();
  const expected = allowReviewSchema
    ? ["auth.json", "review-output.schema.json"]
    : ["auth.json"];
  if (entries.length !== expected.length || entries.some((entry, index) => entry !== expected[index])) {
    process.stderr.write(`fake Codex received non-auth user state: ${entries.join(",")}\n`);
    process.exit(3);
  }
  if (!fs.existsSync(path.join(process.env.CODEX_HOME, "auth.json"))) {
    process.stderr.write("fake Codex isolated auth link is missing\n");
    process.exit(3);
  }
  if (mode.forbidden_env && process.env[mode.forbidden_env] !== undefined) {
    process.stderr.write(`fake Codex inherited forbidden environment variable: ${mode.forbidden_env}\n`);
    process.exit(3);
  }
}

if (args[0] === "--version") {
  process.stdout.write(`${mode.version || "codex-cli 0.144.1"}\n`);
  process.exit(0);
}

if (args[0] === "login" && args[1] === "status") {
  requireIsolatedHome();
  let authenticated = mode.authenticated !== false;
  let authProbeCount = null;
  if (mode.auth_counter_path) {
    const count = fs.existsSync(mode.auth_counter_path)
      ? Number(fs.readFileSync(mode.auth_counter_path, "utf8"))
      : 0;
    const next = count + 1;
    fs.writeFileSync(mode.auth_counter_path, `${next}\n`);
    authProbeCount = next;
    authenticated = next <= (mode.auth_successes ?? 0);
  }
  if (authProbeCount === mode.mutate_auth_on_status_call) {
    fs.appendFileSync(path.join(process.env.CODEX_HOME, "auth.json"), " \n");
  }
  if (!authenticated) {
    process.stderr.write("Not logged in\n");
    process.exit(1);
  }
  process.stdout.write("Logged in using fixture auth\n");
  process.exit(0);
}

if (args[0] !== "exec") {
  process.stderr.write(`unexpected fake Codex command: ${args.join(" ")}\n`);
  process.exit(2);
}

requireIsolatedHome({ allowReviewSchema: true });

const required = [
  "--json",
  "--ephemeral",
  "--ignore-user-config",
  "--ignore-rules",
  "--strict-config",
  "--skip-git-repo-check",
  "--output-schema"
];
for (const option of required) {
  if (!args.includes(option)) {
    process.stderr.write(`missing required fixed option: ${option}\n`);
    process.exit(3);
  }
}
const sandboxIndex = args.indexOf("--sandbox");
if (sandboxIndex < 0 || args[sandboxIndex + 1] !== "read-only") {
  process.stderr.write("fake Codex requires read-only sandbox\n");
  process.exit(3);
}
for (const feature of [
  "multi_agent",
  "apps",
  "browser_use",
  "browser_use_external",
  "computer_use",
  "image_generation",
  "in_app_browser",
  "hooks",
  "plugins",
  "tool_suggest",
  "workspace_dependencies",
  "skill_mcp_dependency_install",
  "tool_call_mcp_elicitation",
  "auth_elicitation",
  "shell_snapshot"
]) {
  const disabled = args.some((value, index) => value === "--disable" && args[index + 1] === feature);
  if (!disabled) {
    process.stderr.write(`fake Codex expected disabled feature: ${feature}\n`);
    process.exit(3);
  }
}
for (const fixedConfig of [
  "project_doc_max_bytes=0",
  "approval_policy=\"never\"",
  "shell_environment_policy.inherit=\"none\"",
  "tools.web_search=false",
  "skills.include_instructions=false",
  "skills.bundled.enabled=false"
]) {
  const configured = args.some((value, index) => value === "--config" && args[index + 1] === fixedConfig);
  if (!configured) {
    process.stderr.write(`fake Codex expected fixed config: ${fixedConfig}\n`);
    process.exit(3);
  }
}
if (mode.exec_auth_failure) {
  process.stderr.write("Authentication failed: not logged in; please run codex login\n");
  process.exit(1);
}

let prompt = "";
for await (const chunk of process.stdin) prompt += chunk;
const match = prompt.match(/<killsloprouter-review-contract>\s*([\s\S]*?)\s*<\/killsloprouter-review-contract>/);
if (!match) {
  process.stderr.write("missing KillSlopRouter review contract\n");
  process.exit(4);
}
const contract = JSON.parse(match[1]);
const outputSchemaIndex = args.indexOf("--output-schema");
const outputSchemaPath = args[outputSchemaIndex + 1];
if (path.resolve(outputSchemaPath) !== path.join(process.env.CODEX_HOME, "review-output.schema.json")) {
  process.stderr.write("review output schema was not isolated with the packet runtime\n");
  process.exit(4);
}
const outputSchema = JSON.parse(fs.readFileSync(outputSchemaPath, "utf8"));
const resolutionMaxItems = outputSchema?.properties?.resolutions?.maxItems;
if (contract.packet.stage_id === "adjudication" ? resolutionMaxItems !== undefined : resolutionMaxItems !== 0) {
  process.stderr.write("review output schema does not enforce the packet resolution boundary\n");
  process.exit(4);
}
if (mode.schema_observation_path) {
  fs.appendFileSync(mode.schema_observation_path, `${JSON.stringify({
    packet_id: contract.packet.packet_id,
    stage_id: contract.packet.stage_id,
    resolution_max_items: resolutionMaxItems ?? null
  })}\n`);
}
if (contract.packet.stage_id !== "adjudication" &&
  (contract.output_rules?.resolutions !== "must_be_empty_array" ||
    !prompt.includes("The resolutions field MUST be the empty JSON array []"))) {
  process.stderr.write("non-adjudication packet did not receive the empty resolutions contract\n");
  process.exit(4);
}
if (contract.packet.provider.id === "anti-slop" && !prompt.includes("This is a skill-backed review")) {
  process.stderr.write("skill-backed provider did not receive its locked skill instruction\n");
  process.exit(4);
}
if (contract.packet.provider.id === "anti-slop" &&
  (!prompt.includes("packet-bound anti-slop child critic selected by KillSlopRouter") ||
    !prompt.includes("already selected AFTER/audit usage"))) {
  process.stderr.write("anti-slop provider was not constrained to the Router child-review mode\n");
  process.exit(4);
}
if (mode.mutate_artifact) {
  fs.appendFileSync(contract.artifacts[0].resolved_path, "<!-- fake runtime mutation -->\n");
}

const threadId = `fixture-${contract.packet.provider.id}-${crypto.randomUUID()}`;
const review = mode.review || {
  verdict: "pass",
  capabilities_checked: contract.packet.assigned_capabilities,
  findings: [],
  resolutions: []
};
const events = [
  { type: "thread.started", thread_id: threadId },
  { type: "turn.started" },
  ...(mode.forbidden_event ? [{
    type: "item.completed",
    item: { id: "forbidden", type: mode.forbidden_event }
  }] : []),
  {
    type: "item.completed",
    item: { id: "message", type: "agent_message", text: JSON.stringify(review) }
  },
  { type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } }
];
process.stdout.write(`${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
