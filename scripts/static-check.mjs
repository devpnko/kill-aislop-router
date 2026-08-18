import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function filesBelow(relative, extension) {
  const start = path.join(root, relative);
  if (!fs.existsSync(start)) return [];
  const found = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) walk(absolute);
      if (entry.isFile() && absolute.endsWith(extension)) found.push(absolute);
    }
  };
  walk(start);
  return found;
}

const jsonFiles = [
  path.join(root, "package.json"),
  path.join(root, ".codex-plugin", "plugin.json"),
  ...filesBelow("router", ".json"),
  ...filesBelow("registry", ".json"),
  ...filesBelow("schemas", ".json"),
  ...filesBelow("examples", ".json")
];
for (const file of jsonFiles) JSON.parse(fs.readFileSync(file, "utf8"));

const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const pluginJson = JSON.parse(fs.readFileSync(path.join(root, ".codex-plugin", "plugin.json"), "utf8"));
const router = JSON.parse(fs.readFileSync(path.join(root, "router", "default-router.json"), "utf8"));
assert.equal(packageJson.version, router.router_version, "package and router versions must agree");
const pluginBaseVersion = pluginJson.version.replace(/\+codex\.[0-9A-Za-z.-]+$/, "");
assert.equal(packageJson.version, pluginBaseVersion, "package and plugin base versions must agree");
assert.match(
  pluginJson.version,
  new RegExp(`^${packageJson.version.replace(/\./g, "\\.")}(?:\\+codex\\.[0-9A-Za-z.-]+)?$`),
  "plugin version may contain only the Codex development cachebuster"
);
assert.equal(pluginJson.name, "killsloprouter", "plugin name must match its folder and package identity");
assert.equal(pluginJson.skills, "./skills/", "plugin must expose its bundled skills");
assert.equal("mcpServers" in pluginJson, false, "V1 plugin must not declare an MCP server");
assert.ok(
  pluginJson.interface.defaultPrompt.every((prompt) => prompt.includes("$killsloprouter:kill-slop-router")),
  "plugin prompts must use the namespaced skill invocation"
);
assert.ok(fs.existsSync(path.join(root, "skills", "kill-slop-router", "SKILL.md")), "plugin skill is missing");
assert.ok(fs.existsSync(path.join(root, "scripts", "install-codex-plugin.mjs")), "plugin installer is missing");
assert.equal(packageJson.engines.node, ">=20", "V1 Node engine floor must remain explicit");

const markdownFiles = [
  ...filesBelow("docs", ".md"),
  path.join(root, "README.md"),
  path.join(root, "SECURITY.md"),
  path.join(root, "CHANGELOG.md")
];
const linkPattern = /\[[^\]]+\]\(([^)]+)\)/g;
for (const file of markdownFiles) {
  const source = fs.readFileSync(file, "utf8");
  for (const match of source.matchAll(linkPattern)) {
    const target = match[1].trim();
    if (/^(?:https?:|mailto:|#)/.test(target)) continue;
    const withoutAnchor = target.split("#")[0];
    const resolved = path.resolve(path.dirname(file), decodeURIComponent(withoutAnchor));
    assert.ok(fs.existsSync(resolved), `${path.relative(root, file)} has a broken link: ${target}`);
  }
}

const ci = fs.readFileSync(path.join(root, ".github", "workflows", "ci.yml"), "utf8");
assert.match(ci, /node:\s*\[20, 22\]/, "CI must test Node 20 and 22");
assert.match(ci, /contents:\s*read/, "CI repository permission must remain read-only");

process.stdout.write(`static checks: ${jsonFiles.length} JSON files, ${markdownFiles.length} Markdown files\n`);
