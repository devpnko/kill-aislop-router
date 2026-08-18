import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AXE_CORE_VERSION, PLAYWRIGHT_CORE_VERSION } from "../src/playwright.mjs";

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
const packageLock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
const pluginJson = JSON.parse(fs.readFileSync(path.join(root, ".codex-plugin", "plugin.json"), "utf8"));
const router = JSON.parse(fs.readFileSync(path.join(root, "router", "default-router.json"), "utf8"));
const toolLock = JSON.parse(fs.readFileSync(path.join(root, "registry", "tool-lock.json"), "utf8"));
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
assert.equal(packageLock.lockfileVersion, 3, "npm lockfile version must remain explicit");
assert.equal(packageLock.packages[""].dependencies["playwright-core"], "1.62.1");
assert.equal(packageLock.packages[""].dependencies["axe-core"], "4.13.0");
assert.equal(packageLock.packages["node_modules/playwright-core"].version, "1.62.1");
assert.equal(packageLock.packages["node_modules/axe-core"].version, "4.13.0");
assert.equal(PLAYWRIGHT_CORE_VERSION, packageJson.dependencies["playwright-core"]);
assert.equal(AXE_CORE_VERSION, packageJson.dependencies["axe-core"]);
for (const packageName of ["playwright-core", "axe-core"]) {
  const lockedTool = toolLock.tools.find((tool) => tool.id === packageName);
  const lockedPackage = packageLock.packages[`node_modules/${packageName}`];
  assert.equal(lockedTool.version, lockedPackage.version, `${packageName} registry version must match npm lock`);
  assert.equal(lockedTool.integrity, lockedPackage.integrity,
    `${packageName} registry integrity must match npm lock`);
}

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
assert.match(ci, /npm ci --ignore-scripts/, "CI must install from the exact lockfile");
assert.match(ci, /playwright-core install --with-deps chromium/,
  "CI must install its browser explicitly");
assert.match(ci, /KSR_PLAYWRIGHT_CHANNEL:\s*bundled/,
  "CI must use the explicitly installed Playwright Chromium build");

process.stdout.write(`static checks: ${jsonFiles.length} JSON files, ${markdownFiles.length} Markdown files\n`);
